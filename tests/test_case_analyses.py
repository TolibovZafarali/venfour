"""Owned case-analysis orchestration, persistence, and API tests."""

from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
import unittest.mock
from contextlib import contextmanager
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
    CaseAnalysisService,
    SupabaseAnalysisRunRepository,
)
from venfour.creation import AnalysisCreationProviderError
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseReportInvalidError,
    SupabaseReportNotFoundError,
)


USER_ID = "10000000-0000-4000-8000-000000000001"
OTHER_USER_ID = "10000000-0000-4000-8000-000000000002"
CASE_ID = "20000000-0000-4000-8000-000000000002"
JOB_ID = "30000000-0000-4000-8000-000000000003"
TOKEN_ID = "40000000-0000-4000-8000-000000000004"
RUN_ID = "50000000-0000-4000-8000-000000000005"
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
        self.artifacts: dict[tuple[str, str], dict[str, Any] | str] = {}
        self.report_error: Exception | None = None
        self.creation_owner = USER_ID
        self.complete_result = True
        self.fail_result = True

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


class CaseAnalysisServiceTests(unittest.TestCase):
    def make_service(
        self,
        gateway: FakeCaseGateway,
        factory: PersistingCreationFactory | None = None,
    ) -> CaseAnalysisService:
        return CaseAnalysisService(
            gateway,
            creation_service_factory=factory or PersistingCreationFactory(),
            token_factory=lambda: TOKEN_ID,
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
