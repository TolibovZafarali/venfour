"""Offline coverage for synchronous analysis creation and multipart upload."""

from __future__ import annotations

import copy
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from typing import Any
from unittest.mock import patch

from starlette.testclient import TestClient

from scripts.extract_report_ai import (
    AIExtractionResult,
    PrototypeError,
    validate_input,
)
from tests.test_analysis_runs import (
    CURRENT_OBSERVED_DATE,
    FIXED_CREATED_AT,
    POSTAL_CODE,
    RUN_ID_1,
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    make_report,
)
from venfour.analysis_runs import AnalysisRunNotFoundError, FileAnalysisRunRepository
from venfour.adaptive_search import (
    DEFAULT_ADAPTIVE_SEARCH_POLICIES,
    DEFAULT_SEARCH_STAGES,
    HISTORICAL_SEARCH_STAGES,
    AdaptiveSearchPolicy,
    AdaptiveSearchPolicies,
    SearchStage,
)
from venfour.api import create_app
from venfour.creation import (
    AnalysisCreationInputError,
    AnalysisCreationProviderError,
    AnalysisCreationService,
    AnalysisCreationUnavailableError,
    AnalysisSearchSettings,
    create_live_analysis_creation_service,
)
from venfour.discrepancy import CURRENT_MARKET
from venfour.market import MarketProviderDiagnostic, MarketProviderRateLimitError
from venfour.marketcheck import MARKETCHECK_ACTIVE_MAX_RADIUS_MILES
from venfour.market_request_budget import MemoryMarketRequestGateway
from venfour.orchestration import AnalysisOrchestrator
from venfour.presentation import validate_analysis_presentation


PDF_BYTES = b"%PDF-1.7\n% synthetic upload\n%%EOF\n"


class RecordingExtractor:
    def __init__(
        self,
        report: dict[str, Any],
        *,
        error: Exception | None = None,
    ) -> None:
        self.report = report
        self.error = error
        self.paths: list[Path] = []
        self.payloads: list[bytes] = []

    def __call__(
        self, path: Path, _schema: dict[str, Any]
    ) -> AIExtractionResult:
        self.paths.append(path)
        self.payloads.append(path.read_bytes())
        if self.error is not None:
            raise self.error
        return AIExtractionResult(
            data=copy.deepcopy(self.report),
            model="fixture-extractor",
            usage=None,
        )


class FailingSaveRepository:
    def __init__(
        self,
        repository: FileAnalysisRunRepository,
        error: Exception,
    ) -> None:
        self.repository = repository
        self.error = error

    def save(self, _artifact: Any) -> None:
        raise self.error

    def get(self, run_id: str) -> Any:
        return self.repository.get(run_id)


class AnalysisCreationTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.repository = FileAnalysisRunRepository(self.root / "runs")

    def make_service(
        self,
        extractor: RecordingExtractor,
        *,
        current_provider: RecordingCurrentProvider | None = None,
        historical_provider: RecordingHistoricalProvider | None = None,
        settings: AnalysisSearchSettings | None = None,
    ) -> tuple[
        AnalysisCreationService,
        RecordingCurrentProvider,
        RecordingHistoricalProvider,
        list[date],
    ]:
        current = current_provider or RecordingCurrentProvider()
        historical = historical_provider or RecordingHistoricalProvider()
        observed_dates: list[date] = []

        def orchestrator_factory(as_of_date: date) -> AnalysisOrchestrator:
            observed_dates.append(as_of_date)
            return AnalysisOrchestrator(
                self.repository,
                current_provider=current,
                historical_provider=historical,
                current_provider_version="fixture-current-1",
                historical_provider_version="fixture-historical-1",
                run_id_factory=lambda: RUN_ID_1,
                clock=lambda: FIXED_CREATED_AT,
            )

        service = AnalysisCreationService(
            orchestrator_factory,
            extractor=extractor,
            date_factory=lambda: date.fromisoformat(CURRENT_OBSERVED_DATE),
            search_settings=settings,
        )
        return service, current, historical, observed_dates

    def post_report(
        self,
        client: TestClient,
        *,
        report_bytes: bytes = PDF_BYTES,
        postal_code: str = POSTAL_CODE,
    ) -> Any:
        return client.post(
            "/api/v1/analyses",
            files={"report": ("report.pdf", report_bytes, "application/pdf")},
            data={"postalCode": postal_code},
        )


class AnalysisCreationApplicationFlowTests(AnalysisCreationTestCase):
    def test_source_pdf_validator_allows_the_exact_size_limit(self) -> None:
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)

        with patch(
            "scripts.extract_report_ai.MAX_PDF_BYTES", len(PDF_BYTES)
        ):
            validate_input(report_path)

        report_path.write_bytes(PDF_BYTES + b"x")
        with (
            patch("scripts.extract_report_ai.MAX_PDF_BYTES", len(PDF_BYTES)),
            self.assertRaises(PrototypeError),
        ):
            validate_input(report_path)

    def test_service_rejects_malformed_zip_before_report_processing(self) -> None:
        extractor = RecordingExtractor(make_report())
        service, current, historical, _ = self.make_service(extractor)
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)

        for postal_code in ("", "ABCDE", "6061", "60611 1234"):
            with self.subTest(postal_code=postal_code), self.assertRaises(
                AnalysisCreationInputError
            ):
                service.create(report_path, postal_code)

        self.assertEqual(extractor.paths, [])
        self.assertEqual(current.requests, [])
        self.assertEqual(historical.requests, [])

    def test_provider_failure_preserves_only_safe_classification_metadata(
        self,
    ) -> None:
        diagnostic = MarketProviderDiagnostic(
            endpoint_category="active",
            http_status=429,
            radius=50,
            start=0,
            rows=25,
        )
        current = RecordingCurrentProvider(
            failure=MarketProviderRateLimitError(
                "private provider detail", diagnostic=diagnostic
            )
        )
        extractor = RecordingExtractor(make_report())
        service, current, _, _ = self.make_service(
            extractor,
            current_provider=current,
        )
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)

        with self.assertRaises(AnalysisCreationProviderError) as raised:
            service.create(report_path, POSTAL_CODE)

        self.assertEqual(raised.exception.stream, "current")
        self.assertEqual(
            raised.exception.provider_error_type,
            "MarketProviderRateLimitError",
        )
        self.assertEqual(raised.exception.diagnostic, diagnostic)
        self.assertEqual(len(current.requests), 1)

    def test_search_settings_default_to_adaptive_server_policy(self) -> None:
        self.assertIs(
            AnalysisSearchSettings().search_policies,
            DEFAULT_ADAPTIVE_SEARCH_POLICIES,
        )

    def test_non_ccc_provider_is_not_an_analysis_gate(self) -> None:
        report = make_report()
        report["report"]["provider"] = "Another valuation provider"
        extractor = RecordingExtractor(report)
        service, current, historical, _ = self.make_service(extractor)
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)

        result = service.create(report_path, POSTAL_CODE)

        self.assertEqual(result.run_id, RUN_ID_1)
        self.assertTrue(current.requests)
        self.assertTrue(historical.requests)
        self.assertEqual(
            result.artifact.to_dict()["evidenceContext"]["reportAdapter"],
            "GENERIC",
        )

    def test_uploaded_pdf_creates_persisted_run_and_retrievable_presentation(
        self,
    ) -> None:
        extractor = RecordingExtractor(make_report())
        settings = AnalysisSearchSettings(
            search_policies=AdaptiveSearchPolicies(
                current=AdaptiveSearchPolicy(
                    stages=(SearchStage(61, 17), SearchStage(123, 33)),
                    minimum_strong_matches=6,
                    max_unique_candidates=100,
                ),
                historical=AdaptiveSearchPolicy(
                    stages=(SearchStage(41, 13), SearchStage(88, 29)),
                    minimum_strong_matches=6,
                    max_unique_candidates=100,
                ),
            )
        )
        service, current, historical, observed_dates = self.make_service(
            extractor,
            settings=settings,
        )

        with TestClient(
            create_app(repository=self.repository, creation_service=service)
        ) as client:
            created = self.post_report(client)
            fetched = client.get(f"/api/v1/analyses/{RUN_ID_1}")

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json(), {"runId": RUN_ID_1})
        self.assertEqual(
            created.headers["location"], f"/api/v1/analyses/{RUN_ID_1}"
        )
        self.assertEqual(fetched.status_code, 200)
        validate_analysis_presentation(fetched.json())
        self.assertEqual(fetched.json()["runId"], RUN_ID_1)
        self.assertEqual(extractor.payloads, [PDF_BYTES])
        self.assertEqual(len(extractor.paths), 1)
        self.assertFalse(extractor.paths[0].exists())
        self.assertEqual(
            observed_dates, [date.fromisoformat(CURRENT_OBSERVED_DATE)]
        )
        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in current.requests
            ],
            [(61, 17), (123, 33)],
        )
        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in historical.requests
            ],
            [(41, 13), (88, 29)],
        )
        self.assertEqual(
            {request.evidence_date for request in historical.requests},
            {"2026-05-19"},
        )
        persisted_request = self.repository.get(RUN_ID_1).to_dict()["request"]
        self.assertEqual(
            persisted_request["currentObservedDate"], CURRENT_OBSERVED_DATE
        )
        self.assertEqual(
            persisted_request["searchPolicies"], settings.search_policies.to_dict()
        )

    def test_missing_report_loss_date_creates_current_market_only_run(self) -> None:
        report = make_report()
        report["report"]["lossDate"] = None
        extractor = RecordingExtractor(report)
        service, current, historical, _ = self.make_service(extractor)

        with TestClient(
            create_app(repository=self.repository, creation_service=service)
        ) as client:
            created = self.post_report(client)
            fetched = client.get(f"/api/v1/analyses/{RUN_ID_1}")

        self.assertEqual(created.status_code, 201)
        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in current.requests
            ],
            [
                (stage.radius_miles, stage.result_limit)
                for stage in DEFAULT_SEARCH_STAGES
            ],
        )
        self.assertEqual(historical.requests, [])
        artifact = self.repository.get(RUN_ID_1).to_dict()
        self.assertIsNone(artifact["request"]["historicalSearchRequest"])
        self.assertIsNone(artifact["result"]["historicalMarketResult"])
        self.assertIsNone(artifact["result"]["discrepancyRequest"]["lossDate"])
        self.assertEqual(
            artifact["result"]["discrepancyResult"]["evidenceBasis"],
            CURRENT_MARKET,
        )
        self.assertEqual(fetched.status_code, 200)
        self.assertIsNone(fetched.json()["vehicle"]["lossDate"])
        self.assertFalse(extractor.paths[0].exists())


class AnalysisCreationApiValidationTests(AnalysisCreationTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.extractor = RecordingExtractor(make_report())
        self.service, _, _, _ = self.make_service(self.extractor)
        self.app = create_app(
            repository=self.repository,
            creation_service=self.service,
        )

    def assert_error(
        self,
        response: Any,
        status_code: int,
        code: str,
    ) -> None:
        self.assertEqual(response.status_code, status_code)
        self.assertEqual(response.headers["content-type"], "application/json")
        self.assertEqual(response.json()["error"]["code"], code)
        self.assertEqual(set(response.json()["error"]), {"code", "message"})

    def test_requires_multipart_report_and_postal_code(self) -> None:
        with TestClient(self.app) as client:
            unsupported = client.post(
                "/api/v1/analyses",
                content=PDF_BYTES,
                headers={"Content-Type": "application/pdf"},
            )
            missing_report = client.post(
                "/api/v1/analyses",
                files={"postalCode": (None, POSTAL_CODE)},
            )
            missing_postal = client.post(
                "/api/v1/analyses",
                files={"report": ("report.pdf", PDF_BYTES, "application/pdf")},
            )
            blank_postal = self.post_report(client, postal_code="   ")

        self.assert_error(unsupported, 415, "UNSUPPORTED_MEDIA_TYPE")
        self.assert_error(missing_report, 400, "REPORT_REQUIRED")
        self.assertEqual(
            missing_report.json()["error"]["message"],
            "A valuation report is required.",
        )
        self.assert_error(missing_postal, 400, "POSTAL_CODE_REQUIRED")
        self.assert_error(blank_postal, 400, "POSTAL_CODE_REQUIRED")
        self.assertEqual(self.extractor.paths, [])

    def test_rejects_malformed_us_zip_codes(self) -> None:
        malformed_zip_codes = (
            "6061",
            "606111",
            "60611 1234",
            "60611-123",
            "ABCDE",
            "+60611",
        )

        with TestClient(self.app) as client:
            responses = [
                self.post_report(client, postal_code=postal_code)
                for postal_code in malformed_zip_codes
            ]

        for response in responses:
            self.assert_error(response, 400, "INVALID_POSTAL_CODE")
        self.assertEqual(self.extractor.paths, [])

    def test_accepts_and_trims_zip_plus_four(self) -> None:
        with TestClient(self.app) as client:
            response = self.post_report(client, postal_code=" 63026-1234 ")

        self.assertEqual(response.status_code, 201)
        artifact = self.repository.get(RUN_ID_1).to_dict()
        self.assertEqual(
            artifact["result"]["discrepancyRequest"]["lossVehicle"][
                "postalCode"
            ],
            "63026-1234",
        )

    def test_rejects_duplicate_and_client_controlled_extra_fields(self) -> None:
        duplicate_parts = [
            ("report", ("one.pdf", PDF_BYTES, "application/pdf")),
            ("report", ("two.pdf", PDF_BYTES, "application/pdf")),
            ("postalCode", (None, POSTAL_CODE)),
        ]
        with TestClient(self.app) as client:
            duplicate = client.post(
                "/api/v1/analyses",
                files=duplicate_parts,
            )
            extra = client.post(
                "/api/v1/analyses",
                files={"report": ("report.pdf", PDF_BYTES, "application/pdf")},
                data={"postalCode": POSTAL_CODE, "resultLimit": "1000"},
            )

        self.assert_error(duplicate, 400, "INVALID_MULTIPART_REQUEST")
        self.assert_error(extra, 400, "INVALID_MULTIPART_REQUEST")
        self.assertEqual(self.extractor.paths, [])

    def test_rejects_empty_invalid_and_declared_oversized_reports(self) -> None:
        with TestClient(self.app) as client:
            empty = self.post_report(client, report_bytes=b"")
            invalid = self.post_report(client, report_bytes=b"not a pdf")
            oversized = client.post(
                "/api/v1/analyses",
                content=b"",
                headers={
                    "Content-Type": "multipart/form-data; boundary=unused",
                    "Content-Length": str(52 * 1024 * 1024),
                },
            )

        self.assert_error(empty, 400, "INVALID_REPORT")
        self.assert_error(invalid, 400, "INVALID_REPORT")
        self.assert_error(oversized, 413, "REPORT_TOO_LARGE")
        self.assertEqual(self.extractor.paths, [])

    def test_enforces_the_exact_report_file_size_boundary(self) -> None:
        with (
            patch("venfour.api.MAX_PDF_BYTES", len(PDF_BYTES)),
            TestClient(self.app) as client,
        ):
            at_limit = self.post_report(client)

        with (
            patch("venfour.api.MAX_PDF_BYTES", len(PDF_BYTES) - 1),
            TestClient(self.app) as client,
        ):
            above_limit = self.post_report(client)

        self.assertEqual(at_limit.status_code, 201)
        self.assert_error(above_limit, 413, "REPORT_TOO_LARGE")
        self.assertEqual(self.extractor.payloads, [PDF_BYTES])

    def test_actual_stream_limit_does_not_depend_on_content_length(self) -> None:
        boundary = "venfour-boundary"
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="report"; filename="r.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode() + PDF_BYTES + (
            f"\r\n--{boundary}\r\n"
            'Content-Disposition: form-data; name="postalCode"\r\n\r\n'
            f"{POSTAL_CODE}\r\n--{boundary}--\r\n"
        ).encode()

        with (
            patch("venfour.api.MAX_UPLOAD_BODY_BYTES", len(body) - 1),
            TestClient(self.app) as client,
        ):
            response = client.post(
                "/api/v1/analyses",
                content=(chunk for chunk in (body[:10], body[10:])),
                headers={
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Content-Length": "1",
                },
            )

        self.assert_error(response, 413, "REPORT_TOO_LARGE")
        self.assertEqual(self.extractor.paths, [])

    def test_temporary_storage_failure_is_a_neutral_server_error(self) -> None:
        secret = "private-temporary-storage-detail"
        original_open = Path.open

        def fail_temporary_pdf_open(path: Path, *args: Any, **kwargs: Any) -> Any:
            if path.name == "report.pdf":
                raise OSError(secret)
            return original_open(path, *args, **kwargs)

        with (
            patch("venfour.api.Path.open", new=fail_temporary_pdf_open),
            TestClient(self.app) as client,
        ):
            response = self.post_report(client)

        self.assert_error(response, 500, "ANALYSIS_CREATION_FAILED")
        self.assertNotIn(secret, response.text)
        self.assertEqual(self.extractor.paths, [])

    def test_invalid_extraction_and_analysis_input_are_neutral(self) -> None:
        invalid_report = make_report()
        invalid_report["vehicle"]["year"] = None
        invalid_extractor = RecordingExtractor(invalid_report)
        invalid_service, _, _, _ = self.make_service(invalid_extractor)
        secret = "private-extraction-detail"
        failed_extractor = RecordingExtractor(
            make_report(),
            error=PrototypeError(secret),
        )

        with TestClient(
            create_app(repository=self.repository, creation_service=invalid_service)
        ) as client:
            invalid = self.post_report(client)
        self.assertFalse(invalid_extractor.paths[0].exists())

        second_repository = FileAnalysisRunRepository(self.root / "second-runs")
        self.repository = second_repository
        failed_service, _, _, _ = self.make_service(failed_extractor)
        with TestClient(
            create_app(repository=second_repository, creation_service=failed_service)
        ) as client:
            failed = self.post_report(client)
        self.assertFalse(failed_extractor.paths[0].exists())

        self.assert_error(invalid, 422, "REPORT_NOT_ANALYZABLE")
        self.assert_error(failed, 502, "REPORT_EXTRACTION_FAILED")
        self.assertNotIn(secret, failed.text)

    def test_non_ccc_provider_returns_a_normal_created_result(self) -> None:
        report = make_report()
        report["report"]["provider"] = "Another valuation provider"
        extractor = RecordingExtractor(report)
        service, _, _, _ = self.make_service(extractor)

        with TestClient(
            create_app(repository=self.repository, creation_service=service)
        ) as client:
            response = self.post_report(client)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"runId": RUN_ID_1})

    def test_provider_failure_saves_nothing_and_cleans_temporary_pdf(self) -> None:
        secret = "private-provider-detail"
        current = RecordingCurrentProvider(
            failure=MarketProviderRateLimitError(secret)
        )
        extractor = RecordingExtractor(make_report())
        service, _, _, _ = self.make_service(
            extractor,
            current_provider=current,
        )

        with TestClient(
            create_app(repository=self.repository, creation_service=service)
        ) as client:
            response = self.post_report(client)

        self.assert_error(response, 503, "MARKET_PROVIDER_UNAVAILABLE")
        self.assertNotIn(secret, response.text)
        self.assertFalse(extractor.paths[0].exists())
        with self.assertRaises(AnalysisRunNotFoundError):
            self.repository.get(RUN_ID_1)

    def test_persistence_failure_is_neutral_and_cleans_temporary_pdf(self) -> None:
        secret = "private-storage-detail"
        persisted_repository = self.repository
        failing_repository = FailingSaveRepository(
            persisted_repository,
            OSError(secret),
        )
        extractor = RecordingExtractor(make_report())
        self.repository = failing_repository
        service, _, _, _ = self.make_service(extractor)

        with TestClient(
            create_app(repository=failing_repository, creation_service=service)
        ) as client:
            response = self.post_report(client)

        self.assert_error(response, 500, "ANALYSIS_CREATION_FAILED")
        self.assertNotIn(secret, response.text)
        self.assertFalse(extractor.paths[0].exists())
        with self.assertRaises(AnalysisRunNotFoundError):
            persisted_repository.get(RUN_ID_1)

    def test_future_report_loss_date_is_not_misreported_as_provider_failure(
        self,
    ) -> None:
        report = make_report()
        report["report"]["lossDate"] = "08/11/2026"
        extractor = RecordingExtractor(report)
        service, current, historical, _ = self.make_service(extractor)

        with TestClient(
            create_app(repository=self.repository, creation_service=service)
        ) as client:
            response = self.post_report(client)

        self.assert_error(response, 422, "REPORT_NOT_ANALYZABLE")
        self.assertEqual(current.requests, [])
        self.assertEqual(historical.requests, [])
        self.assertFalse(extractor.paths[0].exists())

    def test_default_live_service_is_lazy_and_reports_missing_configuration(
        self,
    ) -> None:
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(repository=self.repository)
            with TestClient(app) as client:
                health = client.get("/health")
                creation = self.post_report(client)

        self.assertEqual(health.status_code, 200)
        self.assert_error(creation, 503, "ANALYSIS_CREATION_UNAVAILABLE")


class AnalysisCreationLiveCompositionTests(AnalysisCreationTestCase):
    def test_verified_account_radius_is_used_by_live_runtime_composition(self) -> None:
        observed_date = date.fromisoformat(CURRENT_OBSERVED_DATE)
        for maximum in (50, 100, 175, 200, 250, 500):
            with self.subTest(maximum=maximum), patch.dict(
                os.environ,
                {
                    "MARKETCHECK_API_KEY": "fixture-market-key",
                    "MARKETCHECK_ACCOUNT_MAX_RADIUS_MILES": str(maximum),
                    "MARKETCHECK_ACCOUNT_IDENTIFIER": "fixture-account",
                    "MARKETCHECK_ACCOUNT_METERED": "true",
                    "MARKETCHECK_RATE_LIMIT_REQUESTS": "1000",
                    "MARKETCHECK_RATE_LIMIT_WINDOW_SECONDS": "1",
                },
                clear=True,
            ):
                service = create_live_analysis_creation_service(self.repository)
                service = create_live_analysis_creation_service(
                    self.repository, market_request_gateway=MemoryMarketRequestGateway(),
                    market_case_id="10000000-0000-4000-8000-000000000001",
                )
                orchestrator = service._orchestrator_factory(observed_date)
                self.assertEqual(
                    orchestrator._current_provider.maximum_search_radius_miles, maximum,
                )
                self.assertEqual(
                    orchestrator._historical_provider.maximum_search_radius_miles,
                    min(maximum, 100),
                )

    def test_invalid_account_radius_fails_before_report_ingestion(self) -> None:
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)
        for invalid in ("0", "-1", "250.0", "untrusted-radius-value"):
            with self.subTest(invalid=invalid), patch.dict(
                os.environ,
                {
                    "MARKETCHECK_API_KEY": "fixture-market-key",
                    "MARKETCHECK_ACCOUNT_MAX_RADIUS_MILES": invalid,
                },
                clear=True,
            ):
                service = create_live_analysis_creation_service(self.repository)
                with patch.object(service, "_ingestion_service") as ingestion:
                    with self.assertRaises(AnalysisCreationUnavailableError) as raised:
                        service.create(report_path, POSTAL_CODE)
                ingestion.ingest.assert_not_called()
                self.assertNotIn(invalid, str(raised.exception))

    def test_live_factory_builds_providers_with_shared_case_budget(self) -> None:
        gateway = MemoryMarketRequestGateway()
        service = create_live_analysis_creation_service(
            self.repository, market_request_gateway=gateway,
            market_case_id="10000000-0000-4000-8000-000000000001",
            market_job_id="10000000-0000-4000-8000-000000000002",
            market_processing_token="10000000-0000-4000-8000-000000000003",
        )
        environment = {
            "MARKETCHECK_API_KEY": "fixture-market-key",
            "MARKETCHECK_ACCOUNT_IDENTIFIER": "fixture-account",
            "MARKETCHECK_ACCOUNT_METERED": "true",
            "MARKETCHECK_RATE_LIMIT_REQUESTS": "1000",
            "MARKETCHECK_RATE_LIMIT_WINDOW_SECONDS": "1",
            "MARKETCHECK_ACCOUNT_MAX_RADIUS_MILES": "100",
        }
        with patch.dict(os.environ, environment, clear=True):
            service._availability_check()
            orchestrator = service._orchestrator_factory(date.fromisoformat(CURRENT_OBSERVED_DATE))
        engine = orchestrator._market_search
        self.assertIs(engine.providers["current"], orchestrator._current_provider)
        self.assertIs(engine.providers["historical"], orchestrator._historical_provider)
        self.assertIs(engine.budget, orchestrator._current_provider.request_budget)
        self.assertIs(engine.budget, orchestrator._historical_provider.request_budget)
        self.assertEqual(engine.budget.policy.total_attempts, 60)
        self.assertEqual(engine.budget.snapshot()["totalAttempts"], 0)
        self.assertEqual(engine.policy.local_radius_miles, 100)
        self.assertEqual(engine.policy.additional_centers, 4)

    def test_owned_factory_preserves_job_fence_and_case_identity(self) -> None:
        from tests.test_case_analyses import FakeCaseGateway, USER_ID, CASE_ID, JOB_ID, TOKEN_ID
        from venfour.case_analyses import SupabaseAnalysisRunRepository, _live_creation_factory
        repository = SupabaseAnalysisRunRepository(FakeCaseGateway(), USER_ID, case_id=CASE_ID,
                                                    job_id=JOB_ID, processing_token=TOKEN_ID)
        with patch("venfour.case_analyses.create_live_analysis_creation_service") as factory:
            _live_creation_factory(repository, RUN_ID_1)
        self.assertEqual(factory.call_args.kwargs["market_case_id"], CASE_ID)
        self.assertEqual(factory.call_args.kwargs["market_job_id"], JOB_ID)
        self.assertEqual(factory.call_args.kwargs["market_processing_token"], TOKEN_ID)
        self.assertIsNone(repository.market_search_progress(None))

    def test_live_factory_requires_account_and_case_before_ingestion(self) -> None:
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)
        with patch.dict(os.environ, {"MARKETCHECK_API_KEY": "fixture-market-key"}, clear=True):
            service = create_live_analysis_creation_service(self.repository)
            with patch.object(service, "_ingestion_service") as ingestion:
                with self.assertRaises(AnalysisCreationUnavailableError):
                    service.create(report_path, POSTAL_CODE)
            ingestion.ingest.assert_not_called()


if __name__ == "__main__":
    unittest.main()
