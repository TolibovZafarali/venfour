"""Offline HTTP coverage for insurer-response analysis scheduling."""

from __future__ import annotations

import os
import threading
import unittest
from collections.abc import Awaitable, Callable, Mapping
from typing import Any
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from venfour.api import (
    INSURER_RESPONSE_DISPATCH_SECRET_ENVIRONMENT_NAME,
    INSURER_RESPONSE_SCHEDULED_RECONCILIATION_LIMIT,
    create_app,
)
from venfour.insurer_response_analysis import (
    INSURER_RESPONSE_ANALYSIS_MODEL_ENV,
)
from venfour.insurer_response_processing import (
    InsurerResponseDispatchResult,
    InsurerResponseJobExecutionResult,
    InsurerResponseProcessingUnavailableError,
)
from venfour.package_processing import InternalCallerAuthenticationError
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseConflictError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
)


CASE_ID = "20000000-0000-4000-8000-000000000002"
CLIENT_REQUEST_ID = "60000000-0000-4000-8000-000000000006"
RESPONSE_ID = "80000000-0000-4000-8000-000000000008"
ACCESS_TOKEN = "browser-access-token"
USER_ID = "10000000-0000-4000-8000-000000000001"
NOW = "2026-09-01T12:00:00Z"
DISPATCH_SECRET = "insurer-response-dispatch-test-secret-123456"


def _insurer_response(processing_state: str) -> dict[str, Any]:
    return {
        "responseId": RESPONSE_ID,
        "canCorrect": True,
        "negotiationRoundId": "90000000-0000-4000-8000-000000000009",
        "outboundCommunicationId": "82000000-0000-4000-8000-000000000008",
        "clientRequestId": CLIENT_REQUEST_ID,
        "receivedAt": NOW,
        "sourceType": "pasted_message",
        "text": "The insurer provided a revised position.",
        "document": None,
        "revisedOffer": None,
        "processingState": processing_state,
        "failureReason": (
            "generic"
            if processing_state in {"retryable_failed", "terminal_failed"}
            else "unsupported_document"
            if processing_state == "unsupported"
            else None
        ),
        "supersedesResponseId": None,
        "recommendation": None,
        "usableOffer": None,
        "decision": None,
    }


def _claim_projection(processing_state: str) -> dict[str, Any]:
    return {
        "state": (
            "insurer_response_reviewed"
            if processing_state == "completed"
            else "insurer_response_unavailable"
            if processing_state == "terminal_failed"
            else "insurer_response_reviewing"
        ),
        "caseId": CASE_ID,
        "contactEmail": "owner@example.test",
        "workflow": {
            "phase": "negotiation",
            "currentTask": "insurer_response_reviewing",
            "revision": 5,
        },
        "commerce": None,
        "journey": {
            "nextState": "insurer_response_reviewing",
            "fulfillmentState": "insurer_response_reviewing",
            "retryable": processing_state == "retryable_failed",
        },
        "report": None,
        "education": None,
        "sendingDetails": None,
        "messageDraft": None,
        "insurerResponse": _insurer_response(processing_state),
    }


class _Projection:
    def __init__(self, value: Mapping[str, Any]) -> None:
        self._value = dict(value)

    def to_dict(self) -> dict[str, Any]:
        return dict(self._value)


class _ClaimService:
    def __init__(
        self,
        *,
        processing_state: str = "pending",
        events: list[str] | None = None,
    ) -> None:
        self.processing_state = processing_state
        self.events = events
        self.authenticated_tokens: list[str] = []
        self.resolve_calls: list[tuple[str, str]] = []

    def authenticate(self, access_token: str) -> str:
        self.authenticated_tokens.append(access_token)
        return USER_ID

    def resolve(self, case_id: str, access_token: str) -> _Projection:
        self.resolve_calls.append((case_id, access_token))
        if self.events is not None:
            self.events.append("resolve")
        return _Projection(_claim_projection(self.processing_state))

    def access_link(self, *_args: Any) -> None:
        raise AssertionError("access-link work is outside this test seam")

    def recover(self, *_args: Any) -> None:
        raise AssertionError("recovery work is outside this test seam")


class _CustomerDeliveryService:
    def __init__(
        self,
        *,
        processing_state: str = "pending",
        events: list[str] | None = None,
    ) -> None:
        self.processing_state = processing_state
        self.events = events
        self.record_calls: list[tuple[str, Mapping[str, Any], str]] = []

    def record_insurer_response(
        self,
        case_id: str,
        values: Mapping[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        if self.events is not None:
            self.events.append("record:start")
        self.record_calls.append((case_id, dict(values), access_token))
        if self.events is not None:
            self.events.append("record:end")
        return {
            "state": "insurer_response_received",
            "response": _insurer_response(self.processing_state),
            "workflowRevision": 5,
        }

    def _unused(self, *_args: Any) -> None:
        raise AssertionError("unrelated customer-delivery method was called")

    education = _unused
    reports = _unused
    download = _unused
    save_sending_details = _unused
    draft = _unused
    edit_draft = _unused
    prepare = _unused
    opened = _unused
    sent = _unused
    prepare_response_upload = _unused


class _Processor:
    def __init__(
        self,
        *,
        events: list[str] | None = None,
        retry_error: Exception | None = None,
    ) -> None:
        self.events = events
        self.retry_error = retry_error
        self.execute_calls: list[str] = []
        self.retry_calls: list[tuple[str, str, int, str]] = []

    def execute(self, case_id: str) -> None:
        self.execute_calls.append(case_id)
        if self.events is not None:
            self.events.append("execute")

    def retry(
        self,
        case_id: str,
        client_request_id: str,
        workflow_revision: int,
        access_token: str,
    ) -> dict[str, Any]:
        self.retry_calls.append(
            (
                case_id,
                client_request_id,
                workflow_revision,
                access_token,
            )
        )
        if self.events is not None:
            self.events.append("retry")
        if access_token == "invalid-token":
            raise SupabaseAuthenticationError("private authentication detail")
        if self.retry_error is not None:
            raise self.retry_error
        return {
            "state": "insurer_response_reviewing",
            "processingState": "pending",
            "workflowRevision": workflow_revision,
        }


class _Coordinator:
    def __init__(
        self,
        *,
        dispatcher_configured: bool = True,
        events: list[str] | None = None,
        execute_error: Exception | None = None,
    ) -> None:
        self.dispatcher_configured = dispatcher_configured
        self.events = events
        self.execute_error = execute_error
        self.reconcile_calls = 0
        self.reconcile_limits: list[int] = []
        self.execute_calls: list[str] = []
        self.dispatch_result = InsurerResponseDispatchResult(
            due=0,
            dispatched=0,
            failed=0,
            dispatcher_configured=dispatcher_configured,
        )
        self.execution_result = InsurerResponseJobExecutionResult(
            state="completed",
            job_id=RESPONSE_ID,
            attempt_count=1,
        )

    def reconcile_due(self, *, limit: int = 25) -> InsurerResponseDispatchResult:
        self.reconcile_calls += 1
        self.reconcile_limits.append(limit)
        if self.events is not None:
            self.events.append("reconcile")
        return self.dispatch_result

    def execute(self, job_id: str) -> InsurerResponseJobExecutionResult:
        self.execute_calls.append(job_id)
        if self.execute_error is not None:
            raise self.execute_error
        return self.execution_result


class _InternalVerifier:
    def __init__(self) -> None:
        self.tokens: list[str] = []

    def verify(self, token: str) -> str:
        self.tokens.append(token)
        if token != "valid-oidc-token":
            raise InternalCallerAuthenticationError("invalid")
        return "case-worker@example.test"


class _ResponseSendRecorder:
    def __init__(self, app: Any, events: list[str]) -> None:
        self.app = app
        self.events = events

    async def __call__(
        self,
        scope: Mapping[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        async def recording_send(message: dict[str, Any]) -> None:
            await send(message)
            if (
                message.get("type") == "http.response.body"
                and not message.get("more_body", False)
            ):
                self.events.append("response:sent")

        await self.app(scope, receive, recording_send)


class InsurerResponseAnalysisApiTests(unittest.TestCase):
    @staticmethod
    def _app(
        processor: _Processor,
        claim_service: _ClaimService,
        *,
        delivery_service: _CustomerDeliveryService | None = None,
        coordinator: _Coordinator | None = None,
        verifier: _InternalVerifier | None = None,
    ) -> Any:
        return create_app(
            case_claim_access_service=claim_service,
            customer_delivery_service=(
                delivery_service or _CustomerDeliveryService()
            ),
            insurer_response_processor=processor,
            insurer_response_coordinator=coordinator,
            internal_caller_verifier=verifier,
            enable_legacy_api=False,
        )

    @staticmethod
    def _authorization(token: str = ACCESS_TOKEN) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    @staticmethod
    def _response_payload() -> dict[str, Any]:
        return {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 4,
            "responseText": "The insurer provided a revised position.",
            "revisedOfferMinorUnits": None,
            "documentId": None,
            "retainedDocumentId": None,
            "supersedesResponseId": None,
            "outboundCommunicationId": "82000000-0000-4000-8000-000000000008",
        }

    @staticmethod
    def _retry_payload() -> dict[str, Any]:
        return {
            "clientRequestId": CLIENT_REQUEST_ID,
            "expectedWorkflowRevision": 5,
        }

    def assert_private(self, response: Any) -> None:
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    def test_submission_emits_response_before_background_execution(self) -> None:
        events: list[str] = []
        processor = _Processor(events=events)
        delivery = _CustomerDeliveryService(events=events)
        app = _ResponseSendRecorder(
            self._app(processor, _ClaimService(), delivery_service=delivery),
            events,
        )

        with TestClient(app) as client:
            response = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/insurer-response",
                headers=self._authorization(),
                json=self._response_payload(),
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["response"]["processingState"], "pending")
        self.assert_private(response)
        self.assertEqual(
            events,
            ["record:start", "record:end", "response:sent", "execute"],
        )
        self.assertEqual(processor.execute_calls, [CASE_ID])

    def test_owner_resume_safely_schedules_pending_and_processing_work(self) -> None:
        for processing_state in ("pending", "processing"):
            with self.subTest(processing_state=processing_state):
                processor = _Processor()
                claim_service = _ClaimService(processing_state=processing_state)
                with TestClient(self._app(processor, claim_service)) as client:
                    response = client.get(
                        f"/api/v1/appraisal-cases/{CASE_ID}/claim",
                        headers=self._authorization(),
                    )

                self.assertEqual(response.status_code, 200)
                self.assert_private(response)
                self.assertEqual(
                    response.json()["insurerResponse"]["processingState"],
                    processing_state,
                )
                self.assertEqual(processor.execute_calls, [CASE_ID])
                self.assertEqual(
                    claim_service.resolve_calls,
                    [(CASE_ID, ACCESS_TOKEN)],
                )

    def test_retryable_failure_requires_explicit_retry_before_scheduling(
        self,
    ) -> None:
        processor = _Processor()
        claim_service = _ClaimService(processing_state="retryable_failed")
        with TestClient(self._app(processor, claim_service)) as client:
            response = client.get(
                f"/api/v1/appraisal-cases/{CASE_ID}/claim",
                headers=self._authorization(),
            )

        self.assertEqual(response.status_code, 200)
        self.assert_private(response)
        self.assertEqual(processor.execute_calls, [])

    def test_completed_and_terminal_resumes_do_not_schedule_work(self) -> None:
        for processing_state in ("completed", "terminal_failed"):
            with self.subTest(processing_state=processing_state):
                processor = _Processor()
                claim_service = _ClaimService(processing_state=processing_state)
                with TestClient(self._app(processor, claim_service)) as client:
                    response = client.get(
                        f"/api/v1/appraisal-cases/{CASE_ID}/claim",
                        headers=self._authorization(),
                    )

                self.assertEqual(response.status_code, 200)
                self.assert_private(response)
                self.assertEqual(processor.execute_calls, [])

    def test_retry_requires_auth_and_rejects_invalid_input(self) -> None:
        processor = _Processor()
        with TestClient(self._app(processor, _ClaimService())) as client:
            missing_auth = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/"
                "insurer-response-analysis/retry",
                json=self._retry_payload(),
            )
            invalid_auth = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/"
                "insurer-response-analysis/retry",
                headers=self._authorization("invalid-token"),
                json=self._retry_payload(),
            )
            invalid_input = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/"
                "insurer-response-analysis/retry",
                headers=self._authorization(),
                json={"clientRequestId": CLIENT_REQUEST_ID},
            )
            invalid_revision = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/"
                "insurer-response-analysis/retry",
                headers=self._authorization(),
                json={
                    "clientRequestId": CLIENT_REQUEST_ID,
                    "expectedWorkflowRevision": "5",
                },
            )

        self.assertEqual(missing_auth.status_code, 401)
        self.assertEqual(
            missing_auth.json()["error"]["code"], "AUTHENTICATION_REQUIRED"
        )
        self.assertEqual(invalid_auth.status_code, 401)
        self.assertEqual(
            invalid_auth.json()["error"]["code"], "AUTHENTICATION_INVALID"
        )
        self.assertEqual(invalid_input.status_code, 400)
        self.assertEqual(
            invalid_input.json()["error"]["code"],
            "INVALID_CUSTOMER_DELIVERY_REQUEST",
        )
        self.assertEqual(invalid_revision.status_code, 400)
        self.assertEqual(
            invalid_revision.json()["error"]["code"],
            "INVALID_CUSTOMER_DELIVERY_REQUEST",
        )
        for response in (
            missing_auth,
            invalid_auth,
            invalid_input,
            invalid_revision,
        ):
            self.assert_private(response)
        self.assertEqual(len(processor.retry_calls), 1)
        self.assertEqual(processor.execute_calls, [])

    def test_retry_conflict_is_private_and_does_not_schedule_work(self) -> None:
        processor = _Processor(
            retry_error=SupabaseConflictError("private revision detail")
        )
        with TestClient(self._app(processor, _ClaimService())) as client:
            response = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/"
                "insurer-response-analysis/retry",
                headers=self._authorization(),
                json=self._retry_payload(),
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["error"]["code"], "CUSTOMER_DELIVERY_CONFLICT"
        )
        self.assertNotIn("revision detail", response.text)
        self.assert_private(response)
        self.assertEqual(processor.execute_calls, [])

    def test_retry_is_idempotent_at_http_boundary_and_schedules_after_resolve(
        self,
    ) -> None:
        events: list[str] = []
        processor = _Processor(events=events)
        claim_service = _ClaimService(events=events)
        app = _ResponseSendRecorder(
            self._app(processor, claim_service),
            events,
        )
        path = (
            f"/api/v1/appraisal-cases/{CASE_ID}/"
            "insurer-response-analysis/retry"
        )

        with TestClient(app) as client:
            first = client.post(
                path,
                headers=self._authorization(),
                json=self._retry_payload(),
            )
            second = client.post(
                path,
                headers=self._authorization(),
                json=self._retry_payload(),
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assert_private(first)
        self.assert_private(second)
        expected_retry = (
            CASE_ID,
            CLIENT_REQUEST_ID,
            5,
            ACCESS_TOKEN,
        )
        self.assertEqual(processor.retry_calls, [expected_retry, expected_retry])
        self.assertEqual(processor.execute_calls, [CASE_ID, CASE_ID])
        self.assertEqual(
            events,
            [
                "retry",
                "resolve",
                "response:sent",
                "execute",
                "retry",
                "resolve",
                "response:sent",
                "execute",
            ],
        )

    def test_queue_reconciliation_is_scheduled_after_intake_and_retry(
        self,
    ) -> None:
        processor = _Processor()
        coordinator = _Coordinator()
        claim_service = _ClaimService()
        with TestClient(
            self._app(
                processor,
                claim_service,
                coordinator=coordinator,
            )
        ) as client:
            self.assertEqual(coordinator.reconcile_calls, 1)
            intake = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/insurer-response",
                headers=self._authorization(),
                json=self._response_payload(),
            )
            retry = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/"
                "insurer-response-analysis/retry",
                headers=self._authorization(),
                json=self._retry_payload(),
            )

        self.assertEqual(intake.status_code, 200)
        self.assertEqual(retry.status_code, 200)
        self.assert_private(intake)
        self.assert_private(retry)
        self.assertEqual(coordinator.reconcile_calls, 3)
        self.assertEqual(processor.execute_calls, [])

    def test_dispatcher_reconciliation_runs_during_startup(self) -> None:
        coordinator = _Coordinator()
        with TestClient(
            self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
            )
        ):
            self.assertEqual(coordinator.reconcile_calls, 1)
            self.assertEqual(
                coordinator.reconcile_limits,
                [INSURER_RESPONSE_SCHEDULED_RECONCILIATION_LIMIT],
            )

    def test_dispatcher_reconciliation_repeats_without_owner_traffic(
        self,
    ) -> None:
        reconciled_again = threading.Event()

        class _PeriodicCoordinator(_Coordinator):
            def reconcile_due(
                self, *, limit: int = 25
            ) -> InsurerResponseDispatchResult:
                result = super().reconcile_due(limit=limit)
                if self.reconcile_calls >= 2:
                    reconciled_again.set()
                return result

        coordinator = _PeriodicCoordinator()
        with patch(
            "venfour.api."
            "DEFAULT_RESPONSE_ANALYSIS_RECONCILIATION_INTERVAL_SECONDS",
            0.01,
        ):
            with TestClient(
                self._app(
                    _Processor(),
                    _ClaimService(),
                    coordinator=coordinator,
                )
            ):
                self.assertTrue(reconciled_again.wait(timeout=1))

        self.assertGreaterEqual(coordinator.reconcile_calls, 2)

    def test_scheduled_reconciliation_requires_secret_and_dispatches_bounded_work(
        self,
    ) -> None:
        coordinator = _Coordinator()
        path = "/internal/v1/insurer-response-analysis/dispatch"
        with patch.dict(
            os.environ,
            {
                INSURER_RESPONSE_DISPATCH_SECRET_ENVIRONMENT_NAME: (
                    DISPATCH_SECRET
                )
            },
            clear=True,
        ):
            app = self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
            )
        with TestClient(app) as client:
            missing = client.post(path, content=b"{}")
            invalid = client.post(
                path,
                headers={
                    "X-Venfour-Insurer-Response-Dispatch": "x" * 40
                },
                content=b"{}",
            )
            invalid_body = client.post(
                path,
                headers={
                    "X-Venfour-Insurer-Response-Dispatch": DISPATCH_SECRET
                },
                content=b" { } ",
            )
            valid = client.post(
                path,
                headers={
                    "X-Venfour-Insurer-Response-Dispatch": DISPATCH_SECRET
                },
                content=b"{}",
            )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(invalid_body.status_code, 400)
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.json(), {"due": 0, "dispatched": 0})
        for response in (missing, invalid, invalid_body, valid):
            self.assert_private(response)
        self.assertEqual(coordinator.reconcile_calls, 2)
        self.assertEqual(
            coordinator.reconcile_limits[-1],
            INSURER_RESPONSE_SCHEDULED_RECONCILIATION_LIMIT,
        )

    def test_scheduled_reconciliation_retries_partial_dispatch_failure(
        self,
    ) -> None:
        coordinator = _Coordinator()
        coordinator.dispatch_result = InsurerResponseDispatchResult(
            due=2,
            dispatched=1,
            failed=1,
            dispatcher_configured=True,
        )
        with patch.dict(
            os.environ,
            {
                INSURER_RESPONSE_DISPATCH_SECRET_ENVIRONMENT_NAME: (
                    DISPATCH_SECRET
                )
            },
            clear=True,
        ):
            app = self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
            )
        with TestClient(app) as client:
            response = client.post(
                "/internal/v1/insurer-response-analysis/dispatch",
                headers={
                    "X-Venfour-Insurer-Response-Dispatch": DISPATCH_SECRET
                },
                content=b"{}",
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "60")
        self.assertNotIn("failed", response.text)
        self.assert_private(response)

    def test_internal_callback_requires_oidc_and_executes_only_the_job_id(
        self,
    ) -> None:
        coordinator = _Coordinator()
        verifier = _InternalVerifier()
        path = (
            "/internal/v1/insurer-response-analysis-jobs/"
            f"{RESPONSE_ID}/execute"
        )
        with TestClient(
            self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
                verifier=verifier,
            )
        ) as client:
            missing = client.post(path)
            invalid = client.post(
                path,
                headers={"Authorization": "Bearer wrong-token"},
            )
            body = client.post(
                path,
                headers={"Authorization": "Bearer valid-oidc-token"},
                json={},
            )
            valid = client.post(
                path,
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(body.status_code, 400)
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(
            valid.json(),
            {"state": "completed", "jobId": RESPONSE_ID, "attemptCount": 1},
        )
        for response in (missing, invalid, body, valid):
            self.assert_private(response)
        self.assertEqual(coordinator.execute_calls, [RESPONSE_ID])
        self.assertEqual(
            verifier.tokens,
            ["wrong-token", "valid-oidc-token"],
        )

    def test_internal_callback_maps_transient_failure_without_detail(self) -> None:
        coordinator = _Coordinator(
            execute_error=InsurerResponseProcessingUnavailableError(
                "private provider detail"
            )
        )
        with TestClient(
            self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
                verifier=_InternalVerifier(),
            )
        ) as client:
            response = client.post(
                "/internal/v1/insurer-response-analysis-jobs/"
                f"{RESPONSE_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "60")
        self.assertNotIn("provider detail", response.text)
        self.assert_private(response)

    def test_internal_callback_keeps_active_lease_recovery_retryable(self) -> None:
        coordinator = _Coordinator()
        coordinator.execution_result = InsurerResponseJobExecutionResult(
            state="processing",
            job_id=RESPONSE_ID,
            attempt_count=1,
        )
        with TestClient(
            self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
                verifier=_InternalVerifier(),
            )
        ) as client:
            response = client.post(
                "/internal/v1/insurer-response-analysis-jobs/"
                f"{RESPONSE_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "60")
        self.assert_private(response)

    def test_successful_internal_callback_chains_bounded_queue_drain(self) -> None:
        coordinator = _Coordinator()
        with TestClient(
            self._app(
                _Processor(),
                _ClaimService(),
                coordinator=coordinator,
                verifier=_InternalVerifier(),
            )
        ) as client:
            self.assertEqual(coordinator.reconcile_calls, 1)
            response = client.post(
                "/internal/v1/insurer-response-analysis-jobs/"
                f"{RESPONSE_ID}/execute",
                headers={"Authorization": "Bearer valid-oidc-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(coordinator.reconcile_calls, 2)
        self.assert_private(response)

    def test_model_configuration_is_inert_when_absent_and_fails_loudly_when_broken(
        self,
    ) -> None:
        client = httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(500)
            )
        )
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(
            SupabaseServerConfiguration(
                url="https://project.supabase.co",
                publishable_key="publishable-test-key",
                service_role_key="service-role-test-key",
            ),
            client=client,
        )

        with patch.dict(os.environ, {}, clear=True):
            app = create_app(
                supabase_gateway=gateway,
                enable_legacy_api=False,
            )
        self.assertIsNone(app.state.insurer_response_processor)
        self.assertIsNone(app.state.insurer_response_coordinator)

        with patch.dict(
            os.environ,
            {INSURER_RESPONSE_ANALYSIS_MODEL_ENV: "gpt-response-test"},
            clear=True,
        ), self.assertRaisesRegex(ValueError, "OPENAI_API_KEY"):
            create_app(supabase_gateway=gateway, enable_legacy_api=False)

        with patch.dict(
            os.environ,
            {INSURER_RESPONSE_ANALYSIS_MODEL_ENV: " invalid-model"},
            clear=True,
        ), self.assertRaises(ValueError):
            create_app(supabase_gateway=gateway, enable_legacy_api=False)

        with patch.dict(
            os.environ,
            {INSURER_RESPONSE_DISPATCH_SECRET_ENVIRONMENT_NAME: "too-short"},
            clear=True,
        ), self.assertRaisesRegex(
            ValueError, "insurer response dispatch secret"
        ):
            create_app(supabase_gateway=gateway, enable_legacy_api=False)

        with patch.dict(
            os.environ,
            {
                INSURER_RESPONSE_ANALYSIS_MODEL_ENV: "gpt-response-test",
                "OPENAI_API_KEY": "provider-test-key",
            },
            clear=True,
        ), patch(
            "venfour.api.OpenAIInsurerResponseAnalyzer",
            side_effect=TypeError("invalid analyzer configuration"),
        ), self.assertRaisesRegex(TypeError, "invalid analyzer configuration"):
            create_app(supabase_gateway=gateway, enable_legacy_api=False)


if __name__ == "__main__":
    unittest.main()
