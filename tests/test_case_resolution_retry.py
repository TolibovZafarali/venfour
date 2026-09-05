"""Closure-specific retry, cancellation, and deadline regression tests."""

from __future__ import annotations

import json
import unittest
from threading import Event
from unittest.mock import patch

import httpx

from venfour.supabase_gateway import (
    CASE_RESOLUTION_MAX_ATTEMPTS,
    CASE_RESOLUTION_TIMEOUT_SECONDS,
    SupabaseAuthenticationError,
    SupabaseCaseResolutionConflictError,
    SupabaseConflictError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
    SupabaseUnavailableError,
    resolution_request_scope,
)


CASE_ID = "20000000-0000-4000-8000-000000000002"
USER_ID = "10000000-0000-4000-8000-000000000001"
VALUES = {
    "clientRequestId": "12000000-0000-4000-8000-000000000012",
    "resolutionCode": "CUSTOMER_STOPPED_PURSUING",
    "workflowRevision": 13,
}
RESULT = {"case_id": CASE_ID, "state": "resolved"}


def transient_response() -> httpx.Response:
    return httpx.Response(400, json={"code": "PVR01", "message": "retry"})


class CaseResolutionRetryTests(unittest.TestCase):
    def gateway(self, handler):
        configuration = SupabaseServerConfiguration(
            "http://127.0.0.1:54321", "publishable-test", "service-test",
        )
        client = httpx.Client(
            transport=httpx.MockTransport(handler), timeout=configuration.timeout_seconds,
        )
        self.addCleanup(client.close)
        return SupabaseHttpGateway(configuration, client=client)

    @staticmethod
    def close_case(gateway):
        return gateway.confirm_total_loss_case_resolution(CASE_ID, VALUES, "browser-token")

    def test_one_or_two_rolled_back_transients_retry_with_backoff_and_exact_inputs(self):
        for failures in (1, 2):
            with self.subTest(failures=failures):
                requests = []
                event = Event()
                now = [100.0]
                delays = []

                def handler(request):
                    requests.append(request)
                    return transient_response() if len(requests) <= failures else httpx.Response(200, json=RESULT)

                def wait(delay):
                    delays.append(delay)
                    now[0] += delay
                    return False

                gateway = self.gateway(handler)
                with patch("venfour.supabase_gateway.time.monotonic", side_effect=lambda: now[0]), patch.object(event, "wait", side_effect=wait), resolution_request_scope(event):
                    self.assertEqual(self.close_case(gateway), RESULT)

                self.assertEqual(len(requests), failures + 1)
                self.assertEqual(delays, [0.1, 0.2][:failures])
                self.assertEqual({request.content for request in requests}, {requests[0].content})
                self.assertEqual(json.loads(requests[0].content)["requested_client_request_id"], VALUES["clientRequestId"])
                for request in requests:
                    self.assertEqual(request.headers["authorization"], "Bearer browser-token")
                    self.assertEqual(request.url.path, "/rest/v1/rpc/confirm_total_loss_case_resolution")
                    self.assertLessEqual(request.extensions["timeout"]["read"], CASE_RESOLUTION_TIMEOUT_SECONDS)
                self.assertLess(requests[-1].extensions["timeout"]["read"], requests[0].extensions["timeout"]["read"])

    def test_repeated_transient_stops_after_exactly_three_attempts(self):
        requests = []
        event = Event()
        gateway = self.gateway(lambda request: requests.append(request) or transient_response())
        with patch.object(event, "wait", return_value=False) as wait, resolution_request_scope(event):
            with self.assertRaisesRegex(SupabaseUnavailableError, "temporarily unavailable"):
                self.close_case(gateway)
        self.assertEqual(len(requests), 3)
        self.assertEqual(len(requests), CASE_RESOLUTION_MAX_ATTEMPTS)
        self.assertEqual([call.args[0] for call in wait.call_args_list], [0.1, 0.2])

    def test_already_resolved_conflict_is_customer_safe_and_never_retried(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(400, json={
            "code": "55000", "details": "CASE_ALREADY_RESOLVED", "message": "private database detail",
        }))
        with self.assertRaises(SupabaseCaseResolutionConflictError) as raised:
            self.close_case(gateway)
        self.assertIsInstance(raised.exception, SupabaseConflictError)
        self.assertEqual(str(raised.exception), "This case has already been closed with a different outcome.")
        self.assertEqual(len(requests), 1)

    def test_other_domain_conflicts_are_never_retried_or_mislabeled(self):
        for code, status in (("55000", 400), ("42501", 403), ("40001", 500)):
            with self.subTest(code=code):
                requests = []
                gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(status, json={"code": code}))
                with self.assertRaises(SupabaseConflictError) as raised:
                    self.close_case(gateway)
                self.assertNotIsInstance(raised.exception, SupabaseCaseResolutionConflictError)
                self.assertEqual(len(requests), 1)

    def test_ambiguous_transport_failure_is_not_retried(self):
        requests = []

        def handler(request):
            requests.append(request)
            raise httpx.ReadTimeout("response lost", request=request)

        gateway = self.gateway(handler)
        with self.assertRaises(SupabaseUnavailableError):
            self.close_case(gateway)
        self.assertEqual(len(requests), 1)

    def test_unrelated_server_error_is_not_retried(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(503, json={"code": "other"}))
        with self.assertRaises(SupabaseUnavailableError):
            self.close_case(gateway)
        self.assertEqual(len(requests), 1)

    def test_cancel_before_first_attempt_prevents_database_request(self):
        requests = []
        event = Event()
        event.set()
        gateway = self.gateway(lambda request: requests.append(request) or transient_response())
        with resolution_request_scope(event), self.assertRaisesRegex(SupabaseUnavailableError, "canceled"):
            self.close_case(gateway)
        self.assertEqual(requests, [])

    def test_cancel_during_backoff_prevents_next_attempt(self):
        requests = []
        event = Event()
        gateway = self.gateway(lambda request: requests.append(request) or transient_response())
        with patch.object(event, "wait", side_effect=lambda delay: event.set()) as wait, resolution_request_scope(event):
            with self.assertRaisesRegex(SupabaseUnavailableError, "canceled"):
                self.close_case(gateway)
        self.assertEqual(len(requests), 1)
        wait.assert_called_once_with(0.1)

    def test_cancel_during_request_stops_before_backoff(self):
        requests = []
        event = Event()

        def handler(request):
            requests.append(request)
            event.set()
            return transient_response()

        gateway = self.gateway(handler)
        with patch.object(event, "wait") as wait, resolution_request_scope(event), self.assertRaisesRegex(SupabaseUnavailableError, "canceled"):
            self.close_case(gateway)
        self.assertEqual(len(requests), 1)
        wait.assert_not_called()

    def test_expired_deadline_prevents_first_attempt(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or transient_response())
        with patch("venfour.supabase_gateway.time.monotonic", return_value=100.0), resolution_request_scope(Event(), deadline=99.0), self.assertRaisesRegex(SupabaseUnavailableError, "deadline"):
            self.close_case(gateway)
        self.assertEqual(requests, [])

    def test_deadline_during_backoff_limits_wait_and_prevents_next_attempt(self):
        requests = []
        now = [100.0]
        event = Event()

        def wait(delay):
            now[0] += delay
            return False

        gateway = self.gateway(lambda request: requests.append(request) or transient_response())
        with patch("venfour.supabase_gateway.time.monotonic", side_effect=lambda: now[0]), patch.object(event, "wait", side_effect=wait) as waiting, resolution_request_scope(event, deadline=100.05), self.assertRaisesRegex(SupabaseUnavailableError, "deadline"):
            self.close_case(gateway)
        self.assertEqual(len(requests), 1)
        self.assertAlmostEqual(waiting.call_args.args[0], 0.05)
        self.assertAlmostEqual(requests[0].extensions["timeout"]["read"], 0.05)

    def test_deadline_during_request_prevents_backoff(self):
        requests = []
        now = [100.0]
        event = Event()

        def handler(request):
            requests.append(request)
            now[0] = 108.0
            return transient_response()

        gateway = self.gateway(handler)
        with patch("venfour.supabase_gateway.time.monotonic", side_effect=lambda: now[0]), patch.object(event, "wait") as wait, resolution_request_scope(event), self.assertRaisesRegex(SupabaseUnavailableError, "deadline"):
            self.close_case(gateway)
        self.assertEqual(len(requests), 1)
        wait.assert_not_called()

    def test_authentication_consumes_closure_deadline_and_scope_is_reset(self):
        requests = []
        now = [100.0]

        def handler(request):
            requests.append(request)
            if request.method == "GET":
                now[0] += 2.0
                return httpx.Response(200, json={"id": USER_ID})
            return httpx.Response(200, json=RESULT)

        gateway = self.gateway(handler)
        with patch("venfour.supabase_gateway.time.monotonic", side_effect=lambda: now[0]):
            with resolution_request_scope(Event()):
                self.assertEqual(gateway.authenticate("browser-token"), USER_ID)
                self.assertEqual(self.close_case(gateway), RESULT)
            self.assertEqual(gateway.authenticate("browser-token"), USER_ID)
        self.assertEqual(requests[0].extensions["timeout"]["read"], 7.0)
        self.assertEqual(requests[1].extensions["timeout"]["read"], 5.0)
        self.assertEqual(requests[2].extensions["timeout"]["read"], 30.0)

    def test_cancel_prevents_scoped_authentication(self):
        requests = []
        event = Event()
        event.set()
        gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(200, json={"id": USER_ID}))
        with resolution_request_scope(event), self.assertRaisesRegex(SupabaseUnavailableError, "canceled"):
            gateway.authenticate("browser-token")
        self.assertEqual(requests, [])

    def test_authentication_remains_required(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(401))
        with self.assertRaises(SupabaseAuthenticationError):
            self.close_case(gateway)
        self.assertEqual(len(requests), 1)

    def test_other_user_rpc_does_not_use_closure_retry(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or transient_response())
        with self.assertRaises(SupabaseUnavailableError):
            gateway.resolve_total_loss_case_claim(CASE_ID, "browser-token")
        self.assertEqual(len(requests), 1)

    def test_existing_admin_claim_retry_still_stops_after_two_attempts(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(503))
        with self.assertRaises(SupabaseUnavailableError):
            gateway.claim_total_loss_analysis(CASE_ID, USER_ID, VALUES["clientRequestId"])
        self.assertEqual(len(requests), 2)


if __name__ == "__main__":
    unittest.main()
