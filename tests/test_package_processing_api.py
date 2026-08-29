"""Offline HTTP coverage for the private package-worker execution seam."""

from __future__ import annotations

import unittest

from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.package_processing import (
    InternalCallerAuthenticationError,
    PackageExecutionResult,
    PackageProcessingContractError,
    PackageWorkBusyError,
)
from venfour.report_processing import ReportWorkExecutionResult


WORK_ITEM_ID = "10000000-0000-4000-8000-000000000001"
PACKAGE_JOB_ID = "20000000-0000-4000-8000-000000000001"
SOURCE_SNAPSHOT_ID = "30000000-0000-4000-8000-000000000001"
FINAL_ASSESSMENT_ID = "40000000-0000-4000-8000-000000000001"
STAGING_PROXY_SECRET = "package-worker-staging-proxy-secret-value"


class _CaseService:
    def authenticate(self, _token: str) -> None:
        raise AssertionError("internal execution must not use customer auth")

    def submit(self, _case_id: str, _user_id: str) -> None:
        raise AssertionError("internal execution must not submit analysis")

    def status(self, _case_id: str, _user_id: str) -> None:
        raise AssertionError("internal execution must not read analysis status")

    def get_presentation(self, _run_id: str, _user_id: str) -> None:
        raise AssertionError("internal execution must not read presentation")


class _Verifier:
    def __init__(self, *, valid_token: str = "valid-oidc-token") -> None:
        self.valid_token = valid_token
        self.tokens: list[str] = []

    def verify(self, token: str) -> str:
        self.tokens.append(token)
        if token != self.valid_token:
            raise InternalCallerAuthenticationError("invalid")
        return "worker@project.iam.gserviceaccount.com"


class _Processor:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.work_item_ids: list[str] = []

    def execute(self, work_item_id: str) -> PackageExecutionResult:
        self.work_item_ids.append(work_item_id)
        if self.error is not None:
            raise self.error
        return PackageExecutionResult(
            state="completed",
            work_item_id=work_item_id,
            package_job_id=PACKAGE_JOB_ID,
            package_status="assessment_ready",
            attempt_count=1,
            source_snapshot_id=SOURCE_SNAPSHOT_ID,
            final_assessment_id=FINAL_ASSESSMENT_ID,
        )


class _ReportProcessor(_Processor):
    def execute(self, work_item_id: str) -> ReportWorkExecutionResult:
        self.work_item_ids.append(work_item_id)
        return ReportWorkExecutionResult(
            state="completed",
            work_item_id=work_item_id,
            work_type="total_loss_report_review",
            package_job_id=PACKAGE_JOB_ID,
            package_status="ready",
            attempt_count=2,
            report_version_id=FINAL_ASSESSMENT_ID,
            ai_review_run_id=SOURCE_SNAPSHOT_ID,
            release_disposition="PUBLISHED",
        )


class PackageProcessingApiTests(unittest.TestCase):
    @staticmethod
    def app(processor: _Processor, verifier: _Verifier, **kwargs: object):
        return create_app(
            case_analysis_service=_CaseService(),
            package_processor=processor,
            internal_caller_verifier=verifier,
            enable_legacy_api=False,
            **kwargs,
        )

    def test_valid_oidc_caller_executes_opaque_work_item(self) -> None:
        verifier = _Verifier()
        processor = _Processor()

        with TestClient(self.app(processor, verifier)) as client:
            response = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "state": "completed",
                "workItemId": WORK_ITEM_ID,
                "packageJobId": PACKAGE_JOB_ID,
                "packageStatus": "assessment_ready",
                "attemptCount": 1,
                "sourceSnapshotId": SOURCE_SNAPSHOT_ID,
                "finalAssessmentId": FINAL_ASSESSMENT_ID,
            },
        )
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(verifier.tokens, ["valid-oidc-token"])
        self.assertEqual(processor.work_item_ids, [WORK_ITEM_ID])

    def test_report_work_result_uses_the_private_bounded_contract(self) -> None:
        verifier = _Verifier()
        processor = _ReportProcessor()

        with TestClient(self.app(processor, verifier)) as client:
            response = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "state": "completed",
                "workItemId": WORK_ITEM_ID,
                "workType": "total_loss_report_review",
                "packageJobId": PACKAGE_JOB_ID,
                "packageStatus": "ready",
                "attemptCount": 2,
                "reportVersionId": FINAL_ASSESSMENT_ID,
                "aiReviewRunId": SOURCE_SNAPSHOT_ID,
                "releaseDisposition": "PUBLISHED",
            },
        )
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(verifier.tokens, ["valid-oidc-token"])
        self.assertEqual(processor.work_item_ids, [WORK_ITEM_ID])

    def test_missing_or_invalid_oidc_is_rejected_before_processing(self) -> None:
        verifier = _Verifier()
        processor = _Processor()

        with TestClient(self.app(processor, verifier)) as client:
            missing = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute"
            )
            invalid = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"Authorization": "Bearer wrong-token"},
            )

        for response in (missing, invalid):
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers["www-authenticate"], "Bearer")
        self.assertEqual(processor.work_item_ids, [])

    def test_staging_proxy_credential_never_authorizes_internal_execution(self) -> None:
        verifier = _Verifier()
        processor = _Processor()

        with TestClient(
            self.app(
                processor,
                verifier,
                staging_proxy_secret=STAGING_PROXY_SECRET,
            )
        ) as client:
            response = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"X-Venfour-Staging-Proxy": STAGING_PROXY_SECRET},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(processor.work_item_ids, [])

    def test_malformed_identifier_and_nonempty_body_are_rejected(self) -> None:
        verifier = _Verifier()
        processor = _Processor()

        with TestClient(self.app(processor, verifier)) as client:
            malformed = client.post(
                "/internal/v1/work-items/not-a-uuid/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )
            body = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
                content=b"{}",
            )

        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(
            malformed.json()["error"]["code"], "INVALID_WORK_ITEM_ID"
        )
        self.assertEqual(body.status_code, 400)
        self.assertEqual(
            body.json()["error"]["code"], "INVALID_INTERNAL_WORK_REQUEST"
        )
        self.assertEqual(verifier.tokens, [])
        self.assertEqual(processor.work_item_ids, [])

    def test_busy_work_is_retryable_and_contract_failure_is_neutral(self) -> None:
        verifier = _Verifier()
        busy_processor = _Processor(error=PackageWorkBusyError("private"))
        failed_processor = _Processor(
            error=PackageProcessingContractError("private lineage detail")
        )

        with TestClient(self.app(busy_processor, verifier)) as client:
            busy = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )
        with TestClient(self.app(failed_processor, verifier)) as client:
            failed = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(busy.status_code, 503)
        self.assertEqual(busy.headers["retry-after"], "60")
        self.assertEqual(
            busy.json()["error"]["code"], "PACKAGE_PROCESSING_UNAVAILABLE"
        )
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(
            failed.json()["error"]["code"], "PACKAGE_PROCESSING_FAILED"
        )
        self.assertNotIn("private", failed.text)

    def test_internal_route_is_absent_when_identity_configuration_is_absent(
        self,
    ) -> None:
        with TestClient(
            create_app(
                case_analysis_service=_CaseService(),
                package_processor=_Processor(),
                enable_legacy_api=False,
            )
        ) as client:
            response = client.post(
                f"/internal/v1/work-items/{WORK_ITEM_ID}/execute"
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "ROUTE_NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
