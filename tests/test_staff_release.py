"""Offline service and HTTP coverage for staff release exceptions."""

from __future__ import annotations

import json
import unittest
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from venfour.api import (
    MAX_STAFF_RELEASE_REQUEST_BODY_BYTES,
    create_app,
)
from venfour.package_processing import PackageProcessingUnavailableError
from venfour.staff_release import (
    APPROVE_UNCHANGED,
    MAX_STAFF_ACCESS_TOKEN_CHARACTERS,
    MAX_STAFF_RELEASE_RATIONALE_CHARACTERS,
    NEW_EVIDENCE_REQUIRED,
    NOT_SUPPORTABLE,
    REQUEST_REVISION,
    StaffReleaseContractError,
    StaffReleaseInputError,
    StaffReleaseNotFoundError,
    StaffReleaseReviewService,
    StaffReleaseUnavailableError,
)
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
)


RELEASE_REVIEW_ID = "10000000-0000-4000-8000-000000000001"
CASE_ID = "20000000-0000-4000-8000-000000000002"
STAFF_USER_ID = "30000000-0000-4000-8000-000000000003"
AI_REVIEW_RUN_ID = "40000000-0000-4000-8000-000000000004"
REPORT_VERSION_ID = "50000000-0000-4000-8000-000000000005"
RESULTING_REPORT_VERSION_ID = "51000000-0000-4000-8000-000000000005"
SOURCE_SNAPSHOT_ID = "60000000-0000-4000-8000-000000000006"
FINAL_ASSESSMENT_ID = "70000000-0000-4000-8000-000000000007"
GENERATION_WORK_ITEM_ID = "80000000-0000-4000-8000-000000000008"
UPDATED_AT = "2026-08-26T22:30:00+00:00"
ACCESS_TOKEN = "staff-browser-access-token"
DIGEST_A = "a" * 64
DIGEST_B = "b" * 64
DIGEST_C = "c" * 64
DIGEST_D = "d" * 64


def review_row() -> dict[str, Any]:
    return {
        "release_review_id": RELEASE_REVIEW_ID,
        "case_id": CASE_ID,
        "review_status": "queued",
        "assigned_staff_user_id": STAFF_USER_ID,
        "decision": None,
        "rationale": None,
        "due_at": "2026-08-27T22:30:00+00:00",
        "resolved_at": None,
        "updated_at": UPDATED_AT,
        "ai_review_run_id": AI_REVIEW_RUN_ID,
        "report_version_id": REPORT_VERSION_ID,
        "resulting_report_version_id": None,
        "report_status": "human_review_required",
        "report": {"schemaVersion": "valuation-evidence-report-v1"},
        "report_digest": DIGEST_A,
        "validation_manifest": {"status": "PASS"},
        "pdf_digest": DIGEST_B,
        "storage_bucket_id": "case-deliverables",
        "storage_object_name": "cases/private/report.pdf",
        "source_snapshot_id": SOURCE_SNAPSHOT_ID,
        "source_snapshot_digest": DIGEST_C,
        "final_assessment_id": FINAL_ASSESSMENT_ID,
        "assessment_digest": DIGEST_D,
        "final_assessment": {"continuationStatus": "REVIEW_REQUIRED"},
        "review_result": {"recommendation": "HOLD"},
        "release_gate_manifest": {"disposition": "HUMAN_REVIEW"},
        "failure_stage": "release_gate",
        "failure_code": None,
        "artifact_availability": {
            "report": True,
            "validationManifest": True,
            "pdf": True,
            "aiReview": True,
            "reviewResult": True,
            "releaseGateManifest": True,
        },
    }


def decision_row(
    database_decision: str,
    *,
    outcome: str = "completed",
    package_status: str | None = None,
) -> dict[str, Any]:
    defaults = {
        "approved": ("published", "ready", "report_ready", None),
        "revision_requested": (
            "superseded",
            "assessment_ready",
            "report_generation_queued",
            GENERATION_WORK_ITEM_ID,
        ),
        "not_supportable": (
            "published",
            "refund_pending",
            "refund_pending",
            None,
        ),
        "new_evidence_required": (
            "superseded",
            "new_evidence_required",
            "exception_review",
            None,
        ),
    }
    report_status, default_package, workflow_task, generation_id = defaults[
        database_decision
    ]
    return {
        "outcome": outcome,
        "release_review_id": RELEASE_REVIEW_ID,
        "case_id": CASE_ID,
        "decision": database_decision,
        "report_version_id": REPORT_VERSION_ID,
        "resulting_report_version_id": (
            RESULTING_REPORT_VERSION_ID
            if database_decision == "revision_requested"
            else None
        ),
        "report_status": report_status,
        "package_status": package_status or default_package,
        "workflow_task": workflow_task,
        "generation_work_item_id": generation_id,
        "order_id": "private-order-id",
        "payment_transaction_id": "private-payment-id",
        "refund_client_request_id": "private-refund-key",
    }


class _Gateway:
    def __init__(self) -> None:
        self.review_result: Mapping[str, Any] | None = review_row()
        self.review_error: Exception | None = None
        self.decision_results: list[Mapping[str, Any]] = [
            decision_row("approved")
        ]
        self.decision_error: Exception | None = None
        self.review_calls: list[tuple[str, str]] = []
        self.decision_calls: list[tuple[str, str, str, str, str]] = []

    def get_total_loss_release_review(
        self, release_review_id: str, access_token: str
    ) -> Mapping[str, Any] | None:
        self.review_calls.append((release_review_id, access_token))
        if self.review_error is not None:
            raise self.review_error
        return self.review_result

    def decide_total_loss_release_review(
        self,
        release_review_id: str,
        expected_updated_at: str,
        decision: str,
        rationale: str,
        access_token: str,
    ) -> Mapping[str, Any]:
        self.decision_calls.append(
            (
                release_review_id,
                expected_updated_at,
                decision,
                rationale,
                access_token,
            )
        )
        if self.decision_error is not None:
            raise self.decision_error
        if len(self.decision_results) > 1:
            return self.decision_results.pop(0)
        return self.decision_results[0]


class _Coordinator:
    def __init__(self) -> None:
        self.calls = 0
        self.error: Exception | None = None

    def reconcile_due(self) -> None:
        self.calls += 1
        if self.error is not None:
            raise self.error


class _RefundRecovery:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.results: list[Mapping[str, Any] | Exception] = [
            {
                "outcome": "completed",
                "package_status": "not_supportable",
                "workflow_task": "no_dispute_resolved",
            }
        ]

    def resume_no_dispute_refund(
        self, report_version_id: str
    ) -> Mapping[str, Any]:
        self.calls.append(report_version_id)
        selected = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(selected, Exception):
            raise selected
        return selected


class StaffReleaseServiceTests(unittest.TestCase):
    def test_staff_read_uses_user_rpc_and_omits_private_storage_locator(
        self,
    ) -> None:
        gateway = _Gateway()
        service = StaffReleaseReviewService(gateway)

        projection = service.get_review(RELEASE_REVIEW_ID, ACCESS_TOKEN).to_dict()

        self.assertEqual(
            gateway.review_calls, [(RELEASE_REVIEW_ID, ACCESS_TOKEN)]
        )
        self.assertEqual(projection["releaseReviewId"], RELEASE_REVIEW_ID)
        self.assertEqual(projection["reportVersionId"], REPORT_VERSION_ID)
        self.assertEqual(projection["reportStatus"], "human_review_required")
        serialized = json.dumps(projection)
        self.assertNotIn("storage", serialized.casefold())
        self.assertNotIn("case-deliverables", serialized)
        self.assertNotIn("cases/private/report.pdf", serialized)

    def test_generation_failure_packet_truthfully_omits_uncreated_artifacts(
        self,
    ) -> None:
        gateway = _Gateway()
        gateway.review_result = {
            **review_row(),
            "ai_review_run_id": None,
            "report_status": "failed",
            "report": None,
            "report_digest": None,
            "validation_manifest": None,
            "pdf_digest": None,
            "review_result": None,
            "release_gate_manifest": None,
            "failure_stage": "report_generation",
            "failure_code": "REPORT_SCHEMA_VALIDATION_FAILED",
            "artifact_availability": {
                "report": False,
                "validationManifest": False,
                "pdf": False,
                "aiReview": False,
                "reviewResult": False,
                "releaseGateManifest": False,
            },
        }
        service = StaffReleaseReviewService(gateway)

        projection = service.get_review(RELEASE_REVIEW_ID, ACCESS_TOKEN).to_dict()

        self.assertEqual(projection["failureStage"], "report_generation")
        self.assertEqual(
            projection["failureCode"], "REPORT_SCHEMA_VALIDATION_FAILED"
        )
        self.assertIsNone(projection["aiReviewRunId"])
        self.assertIsNone(projection["report"])
        self.assertIsNone(projection["validationManifest"])
        self.assertIsNone(projection["pdfDigest"])
        self.assertEqual(
            projection["artifactAvailability"],
            {
                "report": False,
                "validationManifest": False,
                "pdf": False,
                "aiReview": False,
                "reviewResult": False,
                "releaseGateManifest": False,
            },
        )

    def test_database_authorization_and_absent_review_fail_closed(self) -> None:
        gateway = _Gateway()
        gateway.review_error = SupabaseAuthenticationError("not staff")
        service = StaffReleaseReviewService(gateway)

        with self.assertRaises(SupabaseAuthenticationError):
            service.get_review(RELEASE_REVIEW_ID, ACCESS_TOKEN)

        gateway.review_error = None
        gateway.review_result = None
        with self.assertRaises(StaffReleaseNotFoundError):
            service.get_review(RELEASE_REVIEW_ID, ACCESS_TOKEN)

    def test_service_rejects_unbounded_tokens_before_the_database(self) -> None:
        gateway = _Gateway()
        service = StaffReleaseReviewService(gateway)

        with self.assertRaises(SupabaseAuthenticationError):
            service.get_review(
                RELEASE_REVIEW_ID,
                "x" * (MAX_STAFF_ACCESS_TOKEN_CHARACTERS + 1),
            )

        self.assertEqual(gateway.review_calls, [])

    def test_all_public_decisions_map_to_exact_database_values(self) -> None:
        cases = (
            (APPROVE_UNCHANGED, "approved"),
            (REQUEST_REVISION, "revision_requested"),
            (NOT_SUPPORTABLE, "not_supportable"),
            (NEW_EVIDENCE_REQUIRED, "new_evidence_required"),
        )
        for public_decision, database_decision in cases:
            with self.subTest(decision=public_decision):
                gateway = _Gateway()
                gateway.decision_results = [decision_row(database_decision)]
                coordinator = _Coordinator()
                refund = _RefundRecovery()
                service = StaffReleaseReviewService(
                    gateway,
                    work_coordinator=coordinator,
                    refund_recovery=refund,
                )

                result = service.decide(
                    RELEASE_REVIEW_ID,
                    ACCESS_TOKEN,
                    expected_updated_at=UPDATED_AT,
                    decision=public_decision,
                    rationale="  Confirmed against the sealed evidence.  ",
                )

                self.assertEqual(result.decision, public_decision)
                self.assertEqual(gateway.decision_calls[0][2], database_decision)
                self.assertEqual(
                    gateway.decision_calls[0][3],
                    "Confirmed against the sealed evidence.",
                )
                self.assertEqual(
                    coordinator.calls,
                    1 if public_decision == REQUEST_REVISION else 0,
                )
                self.assertEqual(
                    result.resulting_report_version_id,
                    RESULTING_REPORT_VERSION_ID
                    if public_decision == REQUEST_REVISION
                    else None,
                )
                self.assertEqual(
                    refund.calls,
                    [REPORT_VERSION_ID]
                    if public_decision == NOT_SUPPORTABLE
                    else [],
                )

    def test_revision_dispatch_failure_replays_and_converges(self) -> None:
        gateway = _Gateway()
        gateway.decision_results = [
            decision_row("revision_requested"),
            {
                **decision_row(
                    "revision_requested",
                    outcome="existing",
                    package_status="waiting_ai_review",
                ),
            },
        ]
        coordinator = _Coordinator()
        coordinator.error = PackageProcessingUnavailableError(
            "Dispatcher unavailable"
        )
        service = StaffReleaseReviewService(
            gateway, work_coordinator=coordinator
        )

        with self.assertRaises(StaffReleaseUnavailableError):
            service.decide(
                RELEASE_REVIEW_ID,
                ACCESS_TOKEN,
                expected_updated_at=UPDATED_AT,
                decision=REQUEST_REVISION,
                rationale="Correct the identified exhibit mismatch.",
            )
        coordinator.error = None
        replay = service.decide(
            RELEASE_REVIEW_ID,
            ACCESS_TOKEN,
            expected_updated_at=UPDATED_AT,
            decision=REQUEST_REVISION,
            rationale="Correct the identified exhibit mismatch.",
        )

        self.assertEqual(replay.outcome, "existing")
        self.assertEqual(coordinator.calls, 2)
        self.assertEqual(replay.package_status, "waiting_ai_review")
        self.assertEqual(replay.generation_work_item_id, GENERATION_WORK_ITEM_ID)
        self.assertEqual(
            replay.resulting_report_version_id,
            RESULTING_REPORT_VERSION_ID,
        )

    def test_revision_missing_replacement_lineage_fails_before_dispatch(
        self,
    ) -> None:
        for missing_field in (
            "resulting_report_version_id",
            "generation_work_item_id",
        ):
            with self.subTest(missing_field=missing_field):
                gateway = _Gateway()
                gateway.decision_results = [
                    {
                        **decision_row("revision_requested"),
                        missing_field: None,
                    }
                ]
                coordinator = _Coordinator()
                service = StaffReleaseReviewService(
                    gateway, work_coordinator=coordinator
                )

                with self.assertRaisesRegex(
                    StaffReleaseContractError,
                    "replacement lineage is incomplete",
                ):
                    service.decide(
                        RELEASE_REVIEW_ID,
                        ACCESS_TOKEN,
                        expected_updated_at=UPDATED_AT,
                        decision=REQUEST_REVISION,
                        rationale="Correct the identified exhibit mismatch.",
                    )

                self.assertEqual(coordinator.calls, 0)

    def test_non_revision_replacement_lineage_fails_before_side_effects(
        self,
    ) -> None:
        gateway = _Gateway()
        gateway.decision_results = [
            {
                **decision_row("not_supportable"),
                "resulting_report_version_id": RESULTING_REPORT_VERSION_ID,
            }
        ]
        refund = _RefundRecovery()
        service = StaffReleaseReviewService(
            gateway, refund_recovery=refund
        )

        with self.assertRaisesRegex(
            StaffReleaseContractError,
            "Non-revision decision contains replacement lineage",
        ):
            service.decide(
                RELEASE_REVIEW_ID,
                ACCESS_TOKEN,
                expected_updated_at=UPDATED_AT,
                decision=NOT_SUPPORTABLE,
                rationale="No material dispute is supportable.",
            )

        self.assertEqual(refund.calls, [])

    def test_refund_failure_replays_and_converges_without_private_ids(self) -> None:
        gateway = _Gateway()
        gateway.decision_results = [
            decision_row("not_supportable"),
            decision_row("not_supportable", outcome="existing"),
        ]
        refund = _RefundRecovery()
        refund.results = [
            PackageProcessingUnavailableError("provider unavailable"),
            {
                "outcome": "existing",
                "package_status": "not_supportable",
                "workflow_task": "no_dispute_resolved",
            },
        ]
        service = StaffReleaseReviewService(
            gateway, refund_recovery=refund
        )

        with self.assertRaises(StaffReleaseUnavailableError):
            service.decide(
                RELEASE_REVIEW_ID,
                ACCESS_TOKEN,
                expected_updated_at=UPDATED_AT,
                decision=NOT_SUPPORTABLE,
                rationale="No material dispute is supportable.",
            )
        replay = service.decide(
            RELEASE_REVIEW_ID,
            ACCESS_TOKEN,
            expected_updated_at=UPDATED_AT,
            decision=NOT_SUPPORTABLE,
            rationale="No material dispute is supportable.",
        )

        self.assertEqual(refund.calls, [REPORT_VERSION_ID, REPORT_VERSION_ID])
        self.assertEqual(replay.outcome, "existing")
        self.assertEqual(replay.package_status, "not_supportable")
        self.assertEqual(replay.workflow_task, "no_dispute_resolved")
        serialized = json.dumps(replay.to_dict())
        self.assertNotIn("private-order-id", serialized)
        self.assertNotIn("private-payment-id", serialized)
        self.assertNotIn("private-refund-key", serialized)

    def test_decision_inputs_are_strict_and_bounded(self) -> None:
        gateway = _Gateway()
        service = StaffReleaseReviewService(gateway)
        invalid_cases = (
            {
                "release_review_id": "not-a-uuid",
                "expected_updated_at": UPDATED_AT,
                "decision": APPROVE_UNCHANGED,
                "rationale": "Approved.",
            },
            {
                "release_review_id": RELEASE_REVIEW_ID,
                "expected_updated_at": "2026-08-26T22:30:00",
                "decision": APPROVE_UNCHANGED,
                "rationale": "Approved.",
            },
            {
                "release_review_id": RELEASE_REVIEW_ID,
                "expected_updated_at": UPDATED_AT,
                "decision": "approved",
                "rationale": "Approved.",
            },
            {
                "release_review_id": RELEASE_REVIEW_ID,
                "expected_updated_at": UPDATED_AT,
                "decision": APPROVE_UNCHANGED,
                "rationale": " ",
            },
            {
                "release_review_id": RELEASE_REVIEW_ID,
                "expected_updated_at": UPDATED_AT,
                "decision": APPROVE_UNCHANGED,
                "rationale": "x"
                * (MAX_STAFF_RELEASE_RATIONALE_CHARACTERS + 1),
            },
        )
        for values in invalid_cases:
            with self.subTest(values=values):
                with self.assertRaises(StaffReleaseInputError):
                    service.decide(
                        values["release_review_id"],
                        ACCESS_TOKEN,
                        expected_updated_at=values["expected_updated_at"],
                        decision=values["decision"],
                        rationale=values["rationale"],
                    )
        self.assertEqual(gateway.decision_calls, [])


class _CaseService:
    def authenticate(self, _token: str) -> None:
        raise AssertionError("staff route must use only its staff RPC token")

    def submit(self, _case_id: str, _user_id: str) -> None:
        raise AssertionError("staff route must not submit analysis")

    def status(self, _case_id: str, _user_id: str) -> None:
        raise AssertionError("staff route must not read analysis status")

    def get_presentation(self, _run_id: str, _user_id: str) -> None:
        raise AssertionError("staff route must not read analysis presentation")


class _ApiStaffService:
    def __init__(self) -> None:
        self.get_error: Exception | None = None
        self.decision_error: Exception | None = None
        self.get_calls: list[tuple[str, str]] = []
        self.decision_calls: list[dict[str, Any]] = []

    def get_review(self, release_review_id: str, access_token: str) -> Any:
        self.get_calls.append((release_review_id, access_token))
        if self.get_error is not None:
            raise self.get_error
        return SimpleNamespace(
            to_dict=lambda: {
                "releaseReviewId": release_review_id,
                "reviewStatus": "queued",
            }
        )

    def decide(
        self,
        release_review_id: str,
        access_token: str,
        **kwargs: Any,
    ) -> Any:
        self.decision_calls.append(
            {
                "release_review_id": release_review_id,
                "access_token": access_token,
                **kwargs,
            }
        )
        if self.decision_error is not None:
            raise self.decision_error
        return SimpleNamespace(
            to_dict=lambda: {
                "outcome": "completed",
                "releaseReviewId": release_review_id,
                "decision": kwargs["decision"],
            }
        )


class StaffReleaseApiTests(unittest.TestCase):
    @staticmethod
    def app(service: _ApiStaffService):
        return create_app(
            case_analysis_service=_CaseService(),
            staff_release_review_service=service,
            enable_legacy_api=False,
        )

    def test_routes_require_bearer_auth_and_propagate_database_auth(self) -> None:
        service = _ApiStaffService()
        path = (
            "/api/v1/staff/total-loss/release-reviews/"
            f"{RELEASE_REVIEW_ID}"
        )
        with TestClient(self.app(service)) as client:
            missing = client.get(path)
            service.get_error = SupabaseAuthenticationError("not staff")
            rejected = client.get(
                path, headers={"Authorization": "Bearer ordinary-token"}
            )

        for response in (missing, rejected):
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers["www-authenticate"], "Bearer")
            self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(
            service.get_calls,
            [(RELEASE_REVIEW_ID, "ordinary-token")],
        )

    def test_read_and_decision_routes_forward_opaque_tokens_without_domain_auth(
        self,
    ) -> None:
        service = _ApiStaffService()
        base = (
            "/api/v1/staff/total-loss/release-reviews/"
            f"{RELEASE_REVIEW_ID}"
        )
        headers = {"Authorization": "Bearer opaque-jwt-not-an-email"}
        with TestClient(self.app(service)) as client:
            read = client.get(base, headers=headers)
            decided = client.post(
                f"{base}/decision",
                headers=headers,
                json={
                    "expectedUpdatedAt": UPDATED_AT,
                    "decision": REQUEST_REVISION,
                    "rationale": "Regenerate the corrected report.",
                },
            )

        self.assertEqual(read.status_code, 200)
        self.assertEqual(decided.status_code, 200)
        self.assertEqual(
            service.get_calls,
            [(RELEASE_REVIEW_ID, "opaque-jwt-not-an-email")],
        )
        self.assertEqual(
            service.decision_calls[0],
            {
                "release_review_id": RELEASE_REVIEW_ID,
                "access_token": "opaque-jwt-not-an-email",
                "expected_updated_at": UPDATED_AT,
                "decision": REQUEST_REVISION,
                "rationale": "Regenerate the corrected report.",
            },
        )
        self.assertEqual(read.headers["cache-control"], "private, no-store")
        self.assertEqual(decided.headers["cache-control"], "private, no-store")

    def test_decision_body_is_strict_and_bounded_before_service_call(self) -> None:
        service = _ApiStaffService()
        path = (
            "/api/v1/staff/total-loss/release-reviews/"
            f"{RELEASE_REVIEW_ID}/decision"
        )
        headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
        with TestClient(self.app(service)) as client:
            extra = client.post(
                path,
                headers=headers,
                json={
                    "expectedUpdatedAt": UPDATED_AT,
                    "decision": APPROVE_UNCHANGED,
                    "rationale": "Approved.",
                    "email": "staff@example.test",
                },
            )
            oversized = client.post(
                path,
                headers={**headers, "Content-Type": "application/json"},
                content=b"x" * (MAX_STAFF_RELEASE_REQUEST_BODY_BYTES + 1),
            )

        for response in (extra, oversized):
            self.assertEqual(response.status_code, 400)
            self.assertEqual(
                response.json()["error"]["code"],
                "INVALID_STAFF_RELEASE_REVIEW_REQUEST",
            )
        self.assertEqual(service.decision_calls, [])

    def test_unconfigured_staff_service_fails_closed(self) -> None:
        app = create_app(
            case_analysis_service=_CaseService(),
            enable_legacy_api=False,
        )
        with TestClient(app) as client:
            response = client.get(
                "/api/v1/staff/total-loss/release-reviews/"
                f"{RELEASE_REVIEW_ID}",
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json()["error"]["code"],
            "STAFF_RELEASE_REVIEW_UNAVAILABLE",
        )

    def test_default_supabase_composition_includes_staff_lifecycle(self) -> None:
        http_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(503)
            )
        )
        gateway = SupabaseHttpGateway(
            SupabaseServerConfiguration(
                url="http://127.0.0.1:54321",
                publishable_key="publishable-test-key",
                service_role_key="service-role-test-key",
            ),
            client=http_client,
        )
        self.addCleanup(gateway.close)

        with patch.dict("os.environ", {}, clear=True):
            app = create_app(
                supabase_gateway=gateway,
                enable_legacy_api=False,
            )

        self.assertIsInstance(
            app.state.staff_release_review_service,
            StaffReleaseReviewService,
        )
        self.assertEqual(
            type(app.state.package_processor).__name__,
            "TotalLossWorkItemProcessor",
        )


if __name__ == "__main__":
    unittest.main()
