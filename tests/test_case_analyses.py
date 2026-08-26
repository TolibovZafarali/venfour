"""Owned case-analysis orchestration, persistence, and API tests."""

from __future__ import annotations

import copy
import io
import json
import os
import tempfile
import unittest
import unittest.mock
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from starlette.testclient import TestClient

from venfour.analysis_runs import (
    AnalysisRunArtifact,
    AnalysisRunNotFoundError,
    InvalidAnalysisRunArtifactError,
)
from venfour.api import create_app
from venfour.case_analyses import (
    CaseAnalysisConflictError,
    CaseAnalysisContractError,
    CaseAnalysisService,
    SupabaseAnalysisRunRepository,
)
from venfour.creation import (
    AnalysisCreationProviderError,
    AnalysisUnsupportedReportError,
)
from venfour.market import MarketProviderDiagnostic
from venfour.report_ingestion import ReportIngestionResult
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseReportInvalidError,
    SupabaseReportNotFoundError,
)
from venfour.valuation_inputs import empty_normalized_report


USER_ID = "10000000-0000-4000-8000-000000000001"
OTHER_USER_ID = "10000000-0000-4000-8000-000000000002"
CASE_ID = "20000000-0000-4000-8000-000000000002"
JOB_ID = "30000000-0000-4000-8000-000000000003"
TOKEN_ID = "40000000-0000-4000-8000-000000000004"
RUN_ID = "50000000-0000-4000-8000-000000000005"
REPORT_UPLOAD_ID = "60000000-0000-4000-8000-000000000006"
POSTAL_CODE = "60611"
PDF_BYTES = b"%PDF-1.7\nsynthetic report\n%%EOF\n"
SOURCE_ARTIFACT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "analysis-runs"
    / "00000000-0000-4000-8000-000000000001.json"
)


def valid_artifact(run_id: str = RUN_ID) -> AnalysisRunArtifact:
    payload = json.loads(SOURCE_ARTIFACT.read_text(encoding="utf-8"))
    payload["runId"] = run_id
    return AnalysisRunArtifact.from_dict(payload)


def ingestion_result(*, partial: bool = False) -> ReportIngestionResult:
    normalized = empty_normalized_report()
    normalized["report"].update(
        {
            "provider": "Acme Valuations",
            "providerId": "OTHER",
            "insurer": "Example Insurance",
            "lossDate": "2026-05-19",
        }
    )
    normalized["vehicle"].update(
        {
            "year": 2020,
            "make": "Toyota",
            "model": "Camry",
            "trim": None if partial else "SE",
            "vin": "4T1G11AK0LU000001",
            "mileage": 51_000,
            "equipment": ["Convenience package"],
        }
    )
    normalized["condition"]["preLossCondition"] = "Good"
    normalized["valuation"]["adjustedVehicleValue"] = 18_500
    missing = ("vehicle.trim",) if partial else ()
    return ReportIngestionResult(
        normalized_report=normalized,
        adapter="GENERIC",
        provider="Acme Valuations",
        provider_id="OTHER",
        confidence="MEDIUM" if partial else "HIGH",
        partial=partial,
        warnings=("Confirm extracted facts.",),
        missing_required_fields=missing,
        document_sha256="a" * 64,
        model="fixture-model",
    )


def confirmed_snapshot(intake_mode: str) -> dict[str, Any]:
    return {
        "case_id": CASE_ID,
        "analysis_input_id": "70000000-0000-4000-8000-000000000007",
        "analysis_input_revision": 2,
        "intake_mode": intake_mode,
        "vin": "4T1G11AK0LU000001",
        "vehicle_year": 2020,
        "vehicle_make": "Toyota",
        "vehicle_model": "Camry",
        "vehicle_trim": "SE",
        "mileage_at_loss": 51_000,
        "postal_code": POSTAL_CODE,
        "date_of_loss": "2026-05-19",
        "insurer_name": "Example Insurance",
        "insurer_vehicle_valuation": 17_750,
        "vehicle_condition": "Good",
        "vehicle_options_packages": [],
        "report_provider_name": (
            "Acme Valuations" if intake_mode == "report" else None
        ),
        "intake_completed_at": "2026-08-23T12:00:00+00:00",
    }


class FixedReportIngestionService:
    def __init__(self, result: ReportIngestionResult) -> None:
        self.result = result
        self.calls: list[Path] = []

    def ingest(self, path: Path) -> ReportIngestionResult:
        self.calls.append(path)
        return self.result


class FakeCaseGateway:
    def __init__(self) -> None:
        self.tokens = {
            "valid-token": USER_ID,
            "other-token": OTHER_USER_ID,
        }
        self.claim_row: dict[str, Any] = {
            "outcome": "claimed",
            "job_id": JOB_ID,
            "status": "processing",
            "attempt_count": 1,
            "run_id": RUN_ID,
            "postal_code": POSTAL_CODE,
            "failure_code": None,
            "retryable": None,
            "processing_expires_at": "2026-08-19T17:00:00+00:00",
        }
        self.status_row: dict[str, Any] = {
            "outcome": "processing",
            "job_id": JOB_ID,
            "status": "processing",
            "attempt_count": 1,
            "run_id": RUN_ID,
            "postal_code": POSTAL_CODE,
            "failure_code": None,
            "retryable": None,
            "processing_expires_at": "2026-08-19T17:00:00+00:00",
        }
        self.claims: list[tuple[str, str, str]] = []
        self.completions: list[tuple[str, str, str, dict[str, Any]]] = []
        self.failures: list[tuple[str, str, str, bool]] = []
        self.report_requests: list[tuple[str, str, str]] = []
        self.materialized_report_path: str | None = None
        self.artifacts: dict[tuple[str, str], dict[str, Any] | str] = {}
        self.report_error: Exception | None = None
        self.creation_owner = USER_ID
        self.complete_result = True
        self.fail_result = True
        self.extraction_rows: dict[tuple[str, str, int], dict[str, Any]] = {}
        self.extraction_requests: list[tuple[str, str, int]] = []
        self.persisted_extractions: list[tuple[Any, ...]] = []
        self.locator = {
            "case_id": CASE_ID,
            "bucket_id": "case-files",
            "storage_owner_id": USER_ID,
            "canonical_object_path": (
                f"{USER_ID}/{CASE_ID}/valuation-report.pdf"
            ),
            "backup_object_path": (
                f"{USER_ID}/{CASE_ID}/valuation-report-backup.pdf"
            ),
            "finalized_upload_id": REPORT_UPLOAD_ID,
        }

    def authenticate(self, access_token: str) -> str:
        try:
            return self.tokens[access_token]
        except KeyError as exc:
            raise SupabaseAuthenticationError("invalid") from exc

    def claim_total_loss_analysis(
        self, case_id: str, user_id: str, processing_token: str
    ) -> dict[str, Any]:
        self.claims.append((case_id, user_id, processing_token))
        if case_id != CASE_ID or user_id != USER_ID:
            return {"outcome": "not_found"}
        if self.status_row.get("status") in {"completed", "failed"}:
            return copy.deepcopy(self.status_row)
        return copy.deepcopy(self.claim_row)

    def get_total_loss_analysis_status(
        self, case_id: str, user_id: str
    ) -> dict[str, Any]:
        if case_id != CASE_ID or user_id != USER_ID:
            return {"outcome": "not_found"}
        return copy.deepcopy(self.status_row)

    def complete_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        artifact: dict[str, Any],
    ) -> bool:
        payload = copy.deepcopy(artifact)
        self.completions.append((job_id, processing_token, run_id, payload))
        if self.complete_result:
            self.artifacts[(self.creation_owner, run_id)] = payload
            self.status_row = {
                "outcome": "completed",
                "job_id": job_id,
                "status": "completed",
                "attempt_count": 1,
                "run_id": run_id,
                "postal_code": POSTAL_CODE,
                "failure_code": None,
                "retryable": None,
                "processing_expires_at": None,
            }
        return self.complete_result

    def fail_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        failure_code: str,
        retryable: bool,
    ) -> bool:
        self.failures.append(
            (job_id, processing_token, failure_code, retryable)
        )
        if self.fail_result:
            self.status_row = {
                "outcome": "failed",
                "job_id": job_id,
                "status": "failed",
                "attempt_count": 1,
                "run_id": RUN_ID,
                "postal_code": POSTAL_CODE,
                "failure_code": failure_code,
                "retryable": retryable,
                "processing_expires_at": None,
            }
        return self.fail_result

    def get_owned_analysis_run(
        self, run_id: str, user_id: str
    ) -> dict[str, Any] | str | None:
        return copy.deepcopy(self.artifacts.get((user_id, run_id)))

    def get_owned_total_loss_report_storage_locator(
        self, case_id: str, access_token: str
    ) -> dict[str, Any]:
        if case_id != CASE_ID or access_token != "valid-token":
            return {}
        return copy.deepcopy(self.locator)

    def get_total_loss_report_extraction(
        self, case_id: str, report_upload_id: str, analysis_input_revision: int
    ) -> dict[str, Any] | None:
        self.extraction_requests.append(
            (case_id, report_upload_id, analysis_input_revision)
        )
        return copy.deepcopy(
            self.extraction_rows.get(
                (case_id, report_upload_id, analysis_input_revision)
            )
        )

    def persist_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
        provider_name: str | None,
        extraction_status: str,
        confidence: float,
        extraction_schema_version: str,
        normalized_report: dict[str, Any],
    ) -> dict[str, Any]:
        self.persisted_extractions.append(
            (
                case_id,
                report_upload_id,
                analysis_input_revision,
                provider_name,
                extraction_status,
                confidence,
                extraction_schema_version,
                copy.deepcopy(normalized_report),
            )
        )
        row = {
            "case_id": case_id,
            "report_upload_id": report_upload_id,
            "analysis_input_revision": analysis_input_revision,
            "provider_name": provider_name,
            "extraction_status": extraction_status,
            "confidence": confidence,
            "extraction_schema_version": extraction_schema_version,
            "normalized_report": copy.deepcopy(normalized_report),
        }
        self.extraction_rows[(case_id, report_upload_id, analysis_input_revision)] = row
        return copy.deepcopy(row)

    @contextmanager
    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: dict[str, Any],
        cache_nonce: str,
    ):
        owner_id = storage_locator.get("storage_owner_id")
        bucket = storage_locator.get(
            "storage_bucket", storage_locator.get("bucket_id")
        )
        object_path = storage_locator.get(
            "storage_object_path",
            storage_locator.get("canonical_object_path"),
        )
        if (
            bucket != "case-files"
            or object_path
            != f"{owner_id}/{case_id}/valuation-report.pdf"
        ):
            raise AssertionError("unexpected storage locator")
        self.report_requests.append((owner_id, case_id, cache_nonce))
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "report.pdf"
            path.write_bytes(PDF_BYTES)
            yield path

    @contextmanager
    def materialize_total_loss_report(
        self, user_id: str, case_id: str, cache_nonce: str
    ):
        self.report_requests.append((user_id, case_id, cache_nonce))
        if self.report_error is not None:
            raise self.report_error
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "report.pdf"
            path.write_bytes(PDF_BYTES)
            self.materialized_report_path = str(path)
            yield path


class PersistingCreationFactory:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[Any, str]] = []

    def __call__(self, repository: Any, run_id: str) -> Any:
        self.calls.append((repository, run_id))
        error = self.error

        class Service:
            def create(self, _path: Path, postal_code: str) -> Any:
                if postal_code != POSTAL_CODE:
                    raise AssertionError("postal code was not normalized")
                if error is not None:
                    raise error
                repository.save(valid_artifact(run_id))
                return SimpleNamespace(run_id=run_id)

        return Service()


class ConfirmedCreationFactory:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, Any], dict[str, Any]]] = []

    def __call__(self, repository: Any, run_id: str) -> Any:
        calls = self.calls

        class Service:
            def create_from_confirmed_input(
                self,
                input_snapshot: dict[str, Any],
                **options: Any,
            ) -> Any:
                calls.append((copy.deepcopy(input_snapshot), copy.deepcopy(options)))
                repository.save(valid_artifact(run_id))
                return SimpleNamespace(run_id=run_id)

        return Service()


class SequenceClock:
    def __init__(self, *values: float) -> None:
        self.values = list(values)
        self.calls = 0

    def __call__(self) -> float:
        self.calls += 1
        if not self.values:
            raise AssertionError("monotonic clock was called too many times")
        return self.values.pop(0)


class CaseAnalysisServiceTests(unittest.TestCase):
    def make_service(
        self,
        gateway: FakeCaseGateway,
        factory: Any = None,
        *,
        monotonic_clock: Any = None,
        lifecycle_event_sink: Any = None,
    ) -> CaseAnalysisService:
        return CaseAnalysisService(
            gateway,
            creation_service_factory=factory or PersistingCreationFactory(),
            token_factory=lambda: TOKEN_ID,
            monotonic_clock=(
                monotonic_clock if monotonic_clock is not None else (lambda: 0.0)
            ),
            lifecycle_event_sink=(
                lifecycle_event_sink
                if lifecycle_event_sink is not None
                else (lambda _line: None)
            ),
        )

    def test_confirmed_manual_claim_never_materializes_or_claims_report_evidence(self) -> None:
        gateway = FakeCaseGateway()
        snapshot = confirmed_snapshot("manual")
        gateway.claim_row.update(
            {
                "intake_mode": "manual",
                "source_report_upload_id": None,
                "analysis_input_id": snapshot["analysis_input_id"],
                "analysis_input_revision": 2,
                "input_snapshot": snapshot,
                "storage_bucket": None,
                "storage_owner_id": None,
                "storage_object_path": None,
                "report_extraction_available": False,
            }
        )
        factory = ConfirmedCreationFactory()
        service = self.make_service(gateway, factory)

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertEqual(len(factory.calls), 1)
        self.assertEqual(factory.calls[0][0]["intake_mode"], "manual")
        self.assertEqual(factory.calls[0][1], {})
        self.assertEqual(gateway.report_requests, [])
        self.assertEqual(gateway.extraction_requests, [])

    def test_confirmed_report_claim_uses_only_fenced_confirmed_cache(self) -> None:
        gateway = FakeCaseGateway()
        snapshot = confirmed_snapshot("report")
        gateway.claim_row.update(
            {
                "intake_mode": "report",
                "source_report_upload_id": REPORT_UPLOAD_ID,
                "analysis_input_id": snapshot["analysis_input_id"],
                "analysis_input_revision": 2,
                "input_snapshot": snapshot,
                "storage_bucket": "case-files",
                "storage_owner_id": USER_ID,
                "storage_object_path": (
                    f"{USER_ID}/{CASE_ID}/valuation-report.pdf"
                ),
                "report_extraction_available": True,
            }
        )
        extraction = ingestion_result(partial=True)
        gateway.extraction_rows[(CASE_ID, REPORT_UPLOAD_ID, 2)] = {
            "case_id": CASE_ID,
            "report_upload_id": REPORT_UPLOAD_ID,
            "analysis_input_revision": 2,
            "extraction_status": "confirmed",
            "normalized_report": extraction.to_dict(),
        }
        factory = ConfirmedCreationFactory()
        service = self.make_service(gateway, factory)

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertEqual(gateway.report_requests, [])
        self.assertEqual(
            gateway.extraction_requests,
            [(CASE_ID, REPORT_UPLOAD_ID, 2)],
        )
        options = factory.calls[0][1]
        self.assertEqual(options["report_adapter"], "GENERIC")
        self.assertTrue(options["partial_extraction"])
        self.assertEqual(
            options["normalized_report"]["report"]["provider"],
            "Acme Valuations",
        )

    def test_confirmed_report_claim_processes_fenced_report_when_cache_is_unavailable(self) -> None:
        gateway = FakeCaseGateway()
        snapshot = confirmed_snapshot("report")
        snapshot.update(
            {
                "vin": None,
                "vehicle_year": None,
                "vehicle_make": None,
                "vehicle_model": None,
                "vehicle_trim": None,
                "mileage_at_loss": None,
                "date_of_loss": None,
                "insurer_name": None,
                "insurer_vehicle_valuation": None,
                "vehicle_condition": None,
                "vehicle_options_packages": None,
                "report_provider_name": None,
            }
        )
        gateway.claim_row.update(
            {
                "intake_mode": "report",
                "source_report_upload_id": REPORT_UPLOAD_ID,
                "analysis_input_id": snapshot["analysis_input_id"],
                "analysis_input_revision": 2,
                "input_snapshot": snapshot,
                "storage_bucket": "case-files",
                "storage_owner_id": USER_ID,
                "storage_object_path": (
                    f"{USER_ID}/{CASE_ID}/valuation-report.pdf"
                ),
                "report_extraction_available": False,
            }
        )
        factory = PersistingCreationFactory()
        service = self.make_service(gateway, factory)

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertEqual(
            gateway.report_requests,
            [(USER_ID, CASE_ID, JOB_ID)],
        )
        self.assertEqual(gateway.extraction_requests, [])
        self.assertEqual(len(factory.calls), 1)

    def test_confirmed_report_claim_materializes_when_advertised_cache_is_missing(self) -> None:
        gateway = FakeCaseGateway()
        snapshot = confirmed_snapshot("report")
        gateway.claim_row.update(
            {
                "intake_mode": "report",
                "source_report_upload_id": REPORT_UPLOAD_ID,
                "analysis_input_id": snapshot["analysis_input_id"],
                "analysis_input_revision": 2,
                "input_snapshot": snapshot,
                "storage_bucket": "case-files",
                "storage_owner_id": USER_ID,
                "storage_object_path": (
                    f"{USER_ID}/{CASE_ID}/valuation-report.pdf"
                ),
                "report_extraction_available": True,
            }
        )
        factory = PersistingCreationFactory()
        service = self.make_service(gateway, factory)

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertEqual(
            gateway.extraction_requests,
            [(CASE_ID, REPORT_UPLOAD_ID, 2)],
        )
        self.assertEqual(
            gateway.report_requests,
            [(USER_ID, CASE_ID, JOB_ID)],
        )

    def test_confirmed_report_claim_preserves_transferred_storage_namespace(self) -> None:
        gateway = FakeCaseGateway()
        snapshot = confirmed_snapshot("report")
        gateway.claim_row.update(
            {
                "intake_mode": "report",
                "source_report_upload_id": REPORT_UPLOAD_ID,
                "analysis_input_id": snapshot["analysis_input_id"],
                "analysis_input_revision": 2,
                "input_snapshot": snapshot,
                "storage_bucket": "case-files",
                "storage_owner_id": OTHER_USER_ID,
                "storage_object_path": (
                    f"{OTHER_USER_ID}/{CASE_ID}/valuation-report.pdf"
                ),
                "report_extraction_available": False,
            }
        )
        factory = PersistingCreationFactory()
        service = self.make_service(gateway, factory)

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertEqual(
            gateway.report_requests,
            [(OTHER_USER_ID, CASE_ID, JOB_ID)],
        )

    def test_claim_emits_exact_started_and_completed_lifecycle_events(self) -> None:
        gateway = FakeCaseGateway()
        clock = SequenceClock(100.0, 101.25)
        event_lines: list[str] = []

        def capture_after_durable_state(event_line: str) -> None:
            self.assertNotIn("\n", event_line)
            event = json.loads(event_line)
            if event["event"] == "case_analysis_started":
                self.assertEqual(gateway.status_row["status"], "processing")
            else:
                self.assertEqual(gateway.status_row["status"], "completed")
                self.assertIn((USER_ID, RUN_ID), gateway.artifacts)
            event_lines.append(event_line)

        service = self.make_service(
            gateway,
            monotonic_clock=clock,
            lifecycle_event_sink=capture_after_durable_state,
        )

        first = service.submit(CASE_ID, USER_ID)
        second = service.submit(CASE_ID, USER_ID)
        service.authenticate("valid-token")
        service.status(CASE_ID, USER_ID)
        service.get_presentation(RUN_ID, USER_ID)

        self.assertEqual(first.status, "completed")
        self.assertEqual(second.status, "completed")
        self.assertEqual(clock.calls, 2)
        self.assertEqual(
            [json.loads(line) for line in event_lines],
            [
                {
                    "severity": "INFO",
                    "event": "case_analysis_started",
                    "jobId": JOB_ID,
                    "runId": RUN_ID,
                    "attemptCount": 1,
                },
                {
                    "severity": "INFO",
                    "event": "case_analysis_completed",
                    "jobId": JOB_ID,
                    "runId": RUN_ID,
                    "attemptCount": 1,
                    "durationMs": 1250,
                },
            ],
        )
        artifact = gateway.artifacts[(USER_ID, RUN_ID)]
        self.assertIsInstance(artifact, dict)
        artifact_text = json.dumps(artifact)
        lifecycle_text = "\n".join(event_lines)
        self.assertIsNotNone(gateway.materialized_report_path)
        for prohibited_value in (
            "valid-token",
            USER_ID,
            CASE_ID,
            TOKEN_ID,
            POSTAL_CODE,
            gateway.materialized_report_path,
            Path(gateway.materialized_report_path or "").name,
            PDF_BYTES.decode("utf-8"),
            "SYNTHETICCCCVIN01",
            "synthetic-current",
            "https://listings.invalid/synthetic-current/1",
        ):
            if prohibited_value in {
                "SYNTHETICCCCVIN01",
                "synthetic-current",
                "https://listings.invalid/synthetic-current/1",
            }:
                self.assertIn(prohibited_value, artifact_text)
            self.assertNotIn(prohibited_value, lifecycle_text)

    def test_claim_failure_event_is_exact_durable_and_privacy_safe(self) -> None:
        credential = "provider-credential-secret"
        provider_parameter = "provider-request-parameter"
        response_body = "provider-response-body"
        exception_text = (
            f"private exception: credential={credential}; "
            f"parameter={provider_parameter}; response={response_body}"
        )
        gateway = FakeCaseGateway()
        clock = SequenceClock(10.0, 10.5)
        event_lines: list[str] = []

        def capture_after_durable_state(event_line: str) -> None:
            event = json.loads(event_line)
            if event["event"] == "case_analysis_failed":
                self.assertEqual(gateway.status_row["status"], "failed")
            event_lines.append(event_line)

        status = self.make_service(
            gateway,
            PersistingCreationFactory(
                AnalysisCreationProviderError(
                    exception_text,
                    stream="current",
                    provider_error_type="MarketProviderResponseError",
                    diagnostic=MarketProviderDiagnostic(
                        endpoint_category="active",
                        http_status=422,
                        radius=100,
                        start=0,
                        rows=50,
                    ),
                )
            ),
            monotonic_clock=clock,
            lifecycle_event_sink=capture_after_durable_state,
        ).submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "failed")
        self.assertEqual(
            [json.loads(line) for line in event_lines],
            [
                {
                    "severity": "INFO",
                    "event": "case_analysis_started",
                    "jobId": JOB_ID,
                    "runId": RUN_ID,
                    "attemptCount": 1,
                },
                {
                    "severity": "ERROR",
                    "event": "case_analysis_failed",
                    "jobId": JOB_ID,
                    "runId": RUN_ID,
                    "attemptCount": 1,
                    "durationMs": 500,
                    "failureCode": "MARKET_PROVIDER_UNAVAILABLE",
                    "retryable": False,
                    "providerStream": "current",
                    "providerErrorClass": "MarketProviderResponseError",
                    "providerStage": "current_inventory_search",
                    "endpointCategory": "active",
                    "httpStatus": 422,
                    "radius": 100,
                    "start": 0,
                    "rows": 50,
                },
            ],
        )
        serialized = "\n".join(event_lines)
        for prohibited_value in (
            exception_text,
            credential,
            provider_parameter,
            response_body,
            "valid-token",
            USER_ID,
            CASE_ID,
            TOKEN_ID,
            POSTAL_CODE,
            "SYNTHETICCCCVIN01",
            "report.pdf",
            PDF_BYTES.decode("utf-8"),
        ):
            self.assertNotIn(prohibited_value, serialized)
        prohibited_fields = {
            "accessToken",
            "caseId",
            "credentials",
            "exception",
            "postalCode",
            "processingToken",
            "providerParameters",
            "reportContent",
            "reportName",
            "reportPath",
            "responseBody",
            "userId",
            "vin",
            "zip",
        }
        for event in map(json.loads, event_lines):
            self.assertTrue(prohibited_fields.isdisjoint(event))
            self.assertTrue(
                set(event)
                <= {
                    "severity",
                    "event",
                    "jobId",
                    "runId",
                    "attemptCount",
                    "durationMs",
                    "failureCode",
                    "retryable",
                    "providerStream",
                    "providerErrorClass",
                    "providerStage",
                    "endpointCategory",
                    "httpStatus",
                    "radius",
                    "start",
                    "rows",
                    "page",
                }
            )

    def test_failure_racing_with_durable_completion_emits_completed(self) -> None:
        class CompletionRaceGateway(FakeCaseGateway):
            def fail_total_loss_analysis(
                self,
                job_id: str,
                processing_token: str,
                failure_code: str,
                retryable: bool,
            ) -> bool:
                self.failures.append(
                    (job_id, processing_token, failure_code, retryable)
                )
                self.status_row = {
                    "outcome": "completed",
                    "job_id": job_id,
                    "status": "completed",
                    "attempt_count": 1,
                    "run_id": RUN_ID,
                    "postal_code": POSTAL_CODE,
                    "failure_code": None,
                    "retryable": None,
                    "processing_expires_at": None,
                }
                return False

        gateway = CompletionRaceGateway()
        clock = SequenceClock(20.0, 20.75)
        event_lines: list[str] = []
        status = self.make_service(
            gateway,
            PersistingCreationFactory(
                AnalysisCreationProviderError("private provider detail")
            ),
            monotonic_clock=clock,
            lifecycle_event_sink=event_lines.append,
        ).submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertEqual(
            json.loads(event_lines[-1]),
            {
                "severity": "INFO",
                "event": "case_analysis_completed",
                "jobId": JOB_ID,
                "runId": RUN_ID,
                "attemptCount": 1,
                "durationMs": 750,
            },
        )
        self.assertNotIn("failureCode", json.loads(event_lines[-1]))
        self.assertNotIn("retryable", json.loads(event_lines[-1]))

    def test_reads_nonclaims_and_invalid_claim_ids_emit_no_events(self) -> None:
        gateway = FakeCaseGateway()
        event_lines: list[str] = []
        clock = SequenceClock()
        service = self.make_service(
            gateway,
            monotonic_clock=clock,
            lifecycle_event_sink=event_lines.append,
        )

        service.status(CASE_ID, USER_ID)
        gateway.status_row = {
            "outcome": "completed",
            "status": "completed",
            "attempt_count": 1,
            "run_id": RUN_ID,
        }
        self.assertEqual(service.submit(CASE_ID, USER_ID).status, "completed")

        gateway.status_row = {
            "outcome": "processing",
            "status": "processing",
            "attempt_count": 1,
            "processing_expires_at": "2026-08-19T17:00:00+00:00",
        }
        gateway.claim_row = {
            "outcome": "processing",
            "status": "processing",
            "attempt_count": 1,
            "processing_expires_at": "2026-08-19T17:00:00+00:00",
        }
        self.assertEqual(service.submit(CASE_ID, USER_ID).status, "processing")

        for invalid_field in ("job_id", "run_id"):
            with self.subTest(invalid_field=invalid_field):
                gateway.claim_row = {
                    "outcome": "claimed",
                    "job_id": JOB_ID,
                    "run_id": RUN_ID,
                    "attempt_count": 1,
                }
                gateway.claim_row[invalid_field] = f"invalid-{invalid_field}"
                with self.assertRaises(CaseAnalysisContractError):
                    service.submit(CASE_ID, USER_ID)

        self.assertEqual(event_lines, [])
        self.assertEqual(clock.calls, 0)

    def test_default_sink_writes_complete_compact_json_lines(self) -> None:
        gateway = FakeCaseGateway()
        output = io.StringIO()
        service = CaseAnalysisService(
            gateway,
            creation_service_factory=PersistingCreationFactory(),
            token_factory=lambda: TOKEN_ID,
            monotonic_clock=SequenceClock(30.0, 30.25),
        )

        with redirect_stdout(output):
            status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(status.status, "completed")
        self.assertTrue(output.getvalue().endswith("\n"))
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        for line in lines:
            event = json.loads(line)
            self.assertEqual(
                line,
                json.dumps(event, sort_keys=True, separators=(",", ":")),
            )

    def test_claim_executes_once_completes_and_is_naturally_idempotent(self) -> None:
        gateway = FakeCaseGateway()
        factory = PersistingCreationFactory()
        service = self.make_service(gateway, factory)

        first = service.submit(CASE_ID, USER_ID)
        second = service.submit(CASE_ID, USER_ID)

        self.assertEqual(
            first.to_dict(),
            {
                "status": "completed",
                "attemptCount": 1,
                "runId": RUN_ID,
            },
        )
        self.assertEqual(second.to_dict(), first.to_dict())
        self.assertEqual(len(factory.calls), 1)
        self.assertEqual(len(gateway.completions), 1)
        self.assertEqual(
            gateway.claims,
            [(CASE_ID, USER_ID, TOKEN_ID), (CASE_ID, USER_ID, TOKEN_ID)],
        )
        self.assertEqual(
            gateway.report_requests, [(USER_ID, CASE_ID, JOB_ID)]
        )
        job_id, token, run_id, artifact = gateway.completions[0]
        self.assertEqual((job_id, token, run_id), (JOB_ID, TOKEN_ID, RUN_ID))
        self.assertEqual(artifact["runId"], RUN_ID)

    def test_missing_and_invalid_private_reports_are_safely_failed(self) -> None:
        cases = (
            (
                SupabaseReportNotFoundError("private detail"),
                "REPORT_UNAVAILABLE",
                True,
            ),
            (
                SupabaseReportInvalidError("private detail"),
                "INVALID_REPORT",
                False,
            ),
        )
        for report_error, code, retryable in cases:
            with self.subTest(code=code):
                gateway = FakeCaseGateway()
                gateway.report_error = report_error
                status = self.make_service(gateway).submit(CASE_ID, USER_ID)

                self.assertEqual(status.status, "failed")
                self.assertEqual(status.failure_code, code)
                self.assertEqual(status.retryable, retryable)
                self.assertEqual(
                    gateway.failures,
                    [(JOB_ID, TOKEN_ID, code, retryable)],
                )
                self.assertNotIn("private detail", json.dumps(status.to_dict()))

    def test_provider_failure_is_retryable_and_durably_recorded(self) -> None:
        gateway = FakeCaseGateway()
        service = self.make_service(
            gateway,
            PersistingCreationFactory(
                AnalysisCreationProviderError("private provider detail")
            ),
        )

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(
            status.to_dict(),
            {
                "status": "failed",
                "attemptCount": 1,
                "error": {
                    "code": "MARKET_PROVIDER_UNAVAILABLE",
                    "message": "Market evidence is temporarily unavailable.",
                },
                "retryable": True,
            },
        )

    def test_provider_failure_retryability_uses_the_provider_error_class(
        self,
    ) -> None:
        cases = (
            ("MarketProviderAuthenticationError", False),
            ("MarketProviderResponseError", False),
            ("MarketProviderRateLimitError", True),
            ("MarketProviderUnavailableError", True),
        )
        for provider_error_type, expected_retryable in cases:
            with self.subTest(provider_error_type=provider_error_type):
                gateway = FakeCaseGateway()
                service = self.make_service(
                    gateway,
                    PersistingCreationFactory(
                        AnalysisCreationProviderError(
                            "private provider detail",
                            stream="current",
                            provider_error_type=provider_error_type,
                        )
                    ),
                )

                status = service.submit(CASE_ID, USER_ID)

                self.assertEqual(status.status, "failed")
                self.assertEqual(status.retryable, expected_retryable)
                self.assertEqual(
                    gateway.failures,
                    [
                        (
                            JOB_ID,
                            TOKEN_ID,
                            "MARKET_PROVIDER_UNAVAILABLE",
                            expected_retryable,
                        )
                    ],
                )

    def test_unsupported_report_is_nonretryable_and_durably_recorded(self) -> None:
        gateway = FakeCaseGateway()
        service = self.make_service(
            gateway,
            PersistingCreationFactory(
                AnalysisUnsupportedReportError("private provider detail")
            ),
        )

        status = service.submit(CASE_ID, USER_ID)

        self.assertEqual(
            status.to_dict(),
            {
                "status": "failed",
                "attemptCount": 1,
                "error": {
                    "code": "UNSUPPORTED_REPORT",
                    "message": "The valuation report could not be processed.",
                },
                "retryable": False,
            },
        )
        self.assertEqual(
            gateway.failures,
            [(JOB_ID, TOKEN_ID, "UNSUPPORTED_REPORT", False)],
        )

    def test_prerequisite_outcomes_do_not_touch_storage_or_creation(self) -> None:
        cases = (
            ("postal_code_required", "POSTAL_CODE_REQUIRED"),
            ("invalid_postal_code", "INVALID_POSTAL_CODE"),
        )
        for outcome, code in cases:
            with self.subTest(outcome=outcome):
                gateway = FakeCaseGateway()
                gateway.claim_row = {
                    "outcome": outcome,
                    "status": "not_submitted",
                }
                factory = PersistingCreationFactory()

                with self.assertRaises(CaseAnalysisConflictError) as raised:
                    self.make_service(gateway, factory).submit(CASE_ID, USER_ID)

                self.assertEqual(raised.exception.code, code)
                self.assertEqual(factory.calls, [])
                self.assertEqual(gateway.report_requests, [])

    def test_repository_enforces_owner_and_strict_artifact_validation(self) -> None:
        gateway = FakeCaseGateway()
        artifact = valid_artifact()
        gateway.artifacts[(USER_ID, RUN_ID)] = artifact.to_dict()
        owner_repository = SupabaseAnalysisRunRepository(gateway, USER_ID)
        other_repository = SupabaseAnalysisRunRepository(gateway, OTHER_USER_ID)

        self.assertEqual(owner_repository.get(RUN_ID).run_id, RUN_ID)
        with self.assertRaises(AnalysisRunNotFoundError):
            other_repository.get(RUN_ID)

        serialized = json.dumps(artifact.to_dict(), separators=(",", ":"))
        gateway.artifacts[(USER_ID, RUN_ID)] = serialized.replace(
            "{", f'{{"runId":"{RUN_ID}",', 1
        )
        with self.assertRaises(InvalidAnalysisRunArtifactError):
            owner_repository.get(RUN_ID)


class OwnedCaseAnalysisApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.gateway = FakeCaseGateway()
        self.factory = PersistingCreationFactory()
        self.service = CaseAnalysisService(
            self.gateway,
            creation_service_factory=self.factory,
            token_factory=lambda: TOKEN_ID,
            lifecycle_event_sink=lambda _line: None,
        )
        self.app = create_app(
            case_analysis_service=self.service,
            enable_legacy_api=False,
        )

    @staticmethod
    def authorization(token: str = "valid-token") -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def test_case_routes_require_a_valid_supabase_bearer(self) -> None:
        with TestClient(self.app) as client:
            missing = client.get(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis"
            )
            invalid = client.get(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers=self.authorization("invalid-token"),
            )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(
            missing.json()["error"]["code"], "AUTHENTICATION_REQUIRED"
        )
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(
            invalid.json()["error"]["code"], "AUTHENTICATION_INVALID"
        )
        for response in (missing, invalid):
            self.assertEqual(
                response.headers["cache-control"], "private, no-store"
            )

    def test_owned_report_ingestion_normalizes_equipment_and_returns_allowlisted_facts(self) -> None:
        snapshot = confirmed_snapshot("report")
        self.gateway.status_row.update(
            {
                "analysis_input_revision": 2,
                "analysis_input_id": snapshot["analysis_input_id"],
                "input_snapshot": snapshot,
            }
        )
        ingestion_service = FixedReportIngestionService(
            ingestion_result(partial=True)
        )
        service = CaseAnalysisService(
            self.gateway,
            creation_service_factory=self.factory,
            report_ingestion_service=ingestion_service,
            token_factory=lambda: TOKEN_ID,
            lifecycle_event_sink=lambda _line: None,
        )
        app = create_app(case_analysis_service=service, enable_legacy_api=False)

        with TestClient(app) as client:
            first = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/report-ingestion",
                headers=self.authorization(),
            )
            second = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/report-ingestion",
                headers=self.authorization(),
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), first.json())
        self.assertEqual(
            first.json(),
            {
                "status": "partial",
                "provider": "Acme Valuations",
                "adapter": "generic",
                "confidence": "medium",
                "warnings": ["Confirm extracted facts."],
                "missingFields": ["trim"],
                "facts": {
                    "vin": "4T1G11AK0LU000001",
                    "vehicleYear": 2020,
                    "make": "Toyota",
                    "model": "Camry",
                    "trim": "SE",
                    "mileageAtLoss": 51_000,
                    "zipCode": POSTAL_CODE,
                    "dateOfLoss": "2026-05-19",
                    "insurerName": "Example Insurance",
                    "insurerVehicleValuation": 18_500,
                    "vehicleCondition": "Good",
                    "optionsPackages": "Convenience package",
                },
            },
        )
        self.assertIsInstance(first.json()["facts"]["optionsPackages"], str)
        self.assertEqual(len(ingestion_service.calls), 1)
        self.assertEqual(len(self.gateway.persisted_extractions), 1)
        self.assertNotIn("object_path", first.text)
        self.assertNotIn("storage", first.text.casefold())
        self.assertEqual(first.headers["cache-control"], "private, no-store")

    def test_status_and_submit_use_only_authenticated_case_identifiers(self) -> None:
        with TestClient(self.app) as client:
            status = client.get(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers=self.authorization(),
            )
            submitted = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers=self.authorization(),
            )

        self.assertEqual(
            status.json(),
            {
                "status": "processing",
                "attemptCount": 1,
                "processingExpiresAt": "2026-08-19T17:00:00+00:00",
            },
        )
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["status"], "completed")
        self.assertEqual(
            submitted.headers["location"], f"/api/v1/analyses/{RUN_ID}"
        )
        for response in (status, submitted):
            self.assertEqual(
                response.headers["cache-control"], "private, no-store"
            )
        self.assertEqual(self.gateway.claims[0][0:2], (CASE_ID, USER_ID))

    def test_submit_rejects_client_controlled_body_before_claiming(self) -> None:
        with TestClient(self.app) as client:
            response = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers=self.authorization(),
                json={
                    "userId": OTHER_USER_ID,
                    "path": "/tmp/client-selected.pdf",
                    "postalCode": "99999",
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"]["code"], "INVALID_ANALYSIS_REQUEST"
        )
        self.assertEqual(self.gateway.claims, [])
        self.assertEqual(self.gateway.report_requests, [])

    def test_case_routes_return_not_found_for_a_non_owner(self) -> None:
        with TestClient(self.app) as client:
            status = client.get(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers=self.authorization("other-token"),
            )
            submitted = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers=self.authorization("other-token"),
            )

        for response in (status, submitted):
            self.assertEqual(response.status_code, 404)
            self.assertEqual(
                response.json()["error"]["code"], "CASE_NOT_FOUND"
            )
        self.assertEqual(self.gateway.report_requests, [])
        self.assertEqual(self.factory.calls, [])

    def test_postal_code_prerequisites_are_safe_conflicts(self) -> None:
        cases = (
            ("postal_code_required", "POSTAL_CODE_REQUIRED"),
            ("invalid_postal_code", "INVALID_POSTAL_CODE"),
        )
        with TestClient(self.app) as client:
            for outcome, code in cases:
                with self.subTest(outcome=outcome):
                    self.gateway.claim_row = {
                        "outcome": outcome,
                        "status": "not_submitted",
                    }
                    response = client.post(
                        f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                        headers=self.authorization(),
                    )
                    self.assertEqual(response.status_code, 409)
                    self.assertEqual(response.json()["error"]["code"], code)

        self.assertEqual(self.gateway.report_requests, [])
        self.assertEqual(self.factory.calls, [])

    def test_analysis_get_is_owned_and_returns_not_found_for_other_user(self) -> None:
        artifact = valid_artifact()
        self.gateway.artifacts[(USER_ID, RUN_ID)] = artifact.to_dict()
        with TestClient(self.app) as client:
            owner = client.get(
                f"/api/v1/analyses/{RUN_ID}",
                headers=self.authorization(),
            )
            other = client.get(
                f"/api/v1/analyses/{RUN_ID}",
                headers=self.authorization("other-token"),
            )

        self.assertEqual(owner.status_code, 200)
        self.assertEqual(owner.json()["runId"], RUN_ID)
        self.assertEqual(other.status_code, 404)
        self.assertEqual(other.json()["error"]["code"], "ANALYSIS_NOT_FOUND")
        for response in (owner, other):
            self.assertEqual(
                response.headers["cache-control"], "private, no-store"
            )

    def test_legacy_unauthenticated_upload_is_disabled_by_default(self) -> None:
        with unittest.mock.patch.dict(os.environ, {}, clear=True):
            default_app = create_app()
        with TestClient(default_app) as client:
            response = client.post("/api/v1/analyses")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "ROUTE_NOT_FOUND")

    def test_legacy_upload_requires_explicit_opt_in(self) -> None:
        with TestClient(create_app(enable_legacy_api=True)) as client:
            response = client.post("/api/v1/analyses")

        self.assertEqual(response.status_code, 415)
        self.assertEqual(
            response.json()["error"]["code"], "UNSUPPORTED_MEDIA_TYPE"
        )


if __name__ == "__main__":
    unittest.main()
