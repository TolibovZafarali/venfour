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

from scripts.extract_report_ai import AIExtractionResult, PrototypeError
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
    AnalysisCreationService,
    AnalysisSearchSettings,
    create_live_analysis_creation_service,
)
from venfour.discrepancy import CURRENT_MARKET
from venfour.market import MarketProviderRateLimitError
from venfour.marketcheck import MARKETCHECK_ACTIVE_MAX_RADIUS_MILES
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
    def test_search_settings_default_to_adaptive_server_policy(self) -> None:
        self.assertIs(
            AnalysisSearchSettings().search_policies,
            DEFAULT_ADAPTIVE_SEARCH_POLICIES,
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

    def test_requires_multipart_report_and_verified_postal_code(self) -> None:
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
        self.assert_error(missing_postal, 400, "POSTAL_CODE_REQUIRED")
        self.assert_error(blank_postal, 400, "POSTAL_CODE_REQUIRED")
        self.assertEqual(self.extractor.paths, [])

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
            patch("venfour.api.MAX_PDF_BYTES", len(PDF_BYTES) + 1),
            TestClient(self.app) as client,
        ):
            below_limit = self.post_report(client)

        with (
            patch("venfour.api.MAX_PDF_BYTES", len(PDF_BYTES)),
            TestClient(self.app) as client,
        ):
            at_limit = self.post_report(client)

        self.assertEqual(below_limit.status_code, 201)
        self.assert_error(at_limit, 413, "REPORT_TOO_LARGE")
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
    def test_live_factory_builds_providers_with_server_configuration(self) -> None:
        extractor = RecordingExtractor(make_report())
        current = RecordingCurrentProvider()
        current.maximum_search_radius_miles = MARKETCHECK_ACTIVE_MAX_RADIUS_MILES
        historical = RecordingHistoricalProvider()
        current_keys: list[str | None] = []
        historical_arguments: list[tuple[str | None, date | None]] = []

        def current_factory(api_key: str | None) -> RecordingCurrentProvider:
            current_keys.append(api_key)
            return current

        def historical_factory(
            api_key: str | None,
            *,
            as_of_date: date | None = None,
        ) -> RecordingHistoricalProvider:
            historical_arguments.append((api_key, as_of_date))
            return historical

        observed_date = date.fromisoformat(CURRENT_OBSERVED_DATE)
        service = create_live_analysis_creation_service(
            self.repository,
            date_factory=lambda: observed_date,
        )
        report_path = self.root / "report.pdf"
        report_path.write_bytes(PDF_BYTES)

        with (
            patch.dict(
                os.environ,
                {
                    "OPENAI_API_KEY": "fixture-extraction-key",
                    "MARKETCHECK_API_KEY": "fixture-market-key",
                },
                clear=False,
            ),
            patch.object(service, "_extractor", extractor),
            patch("venfour.creation.MarketCheckProvider", side_effect=current_factory),
            patch(
                "venfour.creation.MarketCheckHistoricalProvider",
                side_effect=historical_factory,
            ),
        ):
            result = service.create(report_path, POSTAL_CODE)

        self.assertEqual(current_keys, ["fixture-market-key"])
        self.assertEqual(
            historical_arguments,
            [("fixture-market-key", observed_date)],
        )
        expected_current_stages = [
            (stage.radius_miles, stage.result_limit)
            for stage in DEFAULT_SEARCH_STAGES
            if stage.radius_miles <= MARKETCHECK_ACTIVE_MAX_RADIUS_MILES
        ]
        expected_historical_stages = [
            (stage.radius_miles, stage.result_limit)
            for stage in HISTORICAL_SEARCH_STAGES
        ]
        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in current.requests
            ],
            expected_current_stages,
        )
        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in historical.requests
            ],
            expected_historical_stages,
        )
        self.assertEqual(self.repository.get(result.run_id).run_id, result.run_id)


if __name__ == "__main__":
    unittest.main()
