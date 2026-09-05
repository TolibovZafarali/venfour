"""Preview delivery, public recovery, and private dispatch boundary tests."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import Mock, patch

import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.case_analyses import CaseAnalysisService, CaseAnalysisStatus
from venfour.case_claim_access import (
    CaseClaimAccessInputError,
    CaseClaimRecoveryConfiguration,
    TurnstileRejectedError,
)
from venfour.preview_access import PreviewAccessGateway, PreviewAccessService
from venfour.supabase_gateway import (
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
    SupabaseUnavailableError,
)

CASE_ID = "20000000-0000-4000-8000-000000000002"
CLAIM_ID = "30000000-0000-4000-8000-000000000003"
EMAIL_ID = "40000000-0000-4000-8000-000000000004"
LEASE_ID = "50000000-0000-4000-8000-000000000005"
EMAIL = "preview@example.test"
ORIGIN = "https://app.venfour.example"
DISPATCH_SECRET = "preview-dispatch-unit-test-value-1234567890"


def reservation(**overrides):
    return {"email_id": EMAIL_ID, "case_id": CASE_ID, "claim_id": CLAIM_ID,
            "recipient_email": EMAIL, "kind": "ready", **overrides}


def service_fixture():
    gateway = Mock(spec=PreviewAccessGateway)
    gateway.reserve_total_loss_preview_email.return_value = None
    gateway.finish_total_loss_preview_email.return_value = True
    verifier = Mock()
    verifier.verify.return_value = True
    service = PreviewAccessService(gateway, configuration=CaseClaimRecoveryConfiguration(
        public_app_origin=ORIGIN, rate_limit_secret="preview-rate-unit-test-secret",
        turnstile_secret="preview-turnstile-unit-test-secret",
    ), turnstile_verifier=verifier)
    return service, gateway, verifier


class PreviewAccessServiceTests(unittest.TestCase):
    def test_recovery_normalizes_email_and_uses_private_domain_separated_fingerprints(self):
        service, gateway, verifier = service_fixture()
        service.recover(None, " Preview@Example.Test ", "challenge", "203.0.113.1")
        first = gateway.request_total_loss_preview_recovery.call_args.args
        service.recover(CASE_ID, EMAIL, "fresh-challenge", "203.0.113.1")
        second = gateway.request_total_loss_preview_recovery.call_args.args
        self.assertEqual(first[:2], (None, EMAIL))
        self.assertEqual(second[:2], (CASE_ID, EMAIL))
        self.assertEqual(first[2:], second[2:])
        self.assertNotEqual(first[2], first[3])
        for value in first[2:]:
            self.assertRegex(value, r"^[0-9a-f]{64}$")
            self.assertNotIn(EMAIL, value)
            self.assertNotIn("203.0.113.1", value)
        self.assertEqual(verifier.verify.call_count, 2)

    def test_security_failure_and_malformed_input_never_enqueue(self):
        service, gateway, verifier = service_fixture()
        verifier.verify.return_value = False
        with self.assertRaises(TurnstileRejectedError):
            service.recover(None, EMAIL, "challenge", "requester")
        with self.assertRaises(CaseClaimAccessInputError):
            service.recover(None, "not-an-email", "challenge", "requester")
        gateway.request_total_loss_preview_recovery.assert_not_called()

    def test_enqueue_failure_is_neutral_and_does_not_log_contact_details(self):
        service, gateway, _ = service_fixture()
        gateway.request_total_loss_preview_recovery.side_effect = RuntimeError(EMAIL)
        with self.assertLogs("venfour.preview_access", level="WARNING") as log:
            self.assertIsNone(service.recover(None, EMAIL, "challenge", "requester"))
        self.assertNotIn(EMAIL, " ".join(log.output))

    def test_delivery_reserves_and_acknowledges_the_exact_lease(self):
        service, gateway, _ = service_fixture()
        gateway.reserve_total_loss_preview_email.side_effect = [reservation(), None]
        self.assertEqual(service.dispatch(CASE_ID), {"sent": 1, "deferred": 0})
        lease = gateway.reserve_total_loss_preview_email.call_args_list[0].args[0]
        gateway.send_total_loss_preview_magic_link.assert_called_once_with(
            EMAIL, CASE_ID, CLAIM_ID, ORIGIN, "ready")
        gateway.finish_total_loss_preview_email.assert_called_once_with(EMAIL_ID, lease, True)

    def test_provider_failure_is_retryable_and_never_logs_the_provider_response(self):
        service, gateway, _ = service_fixture()
        gateway.reserve_total_loss_preview_email.side_effect = [reservation(), None]
        gateway.send_total_loss_preview_magic_link.side_effect = RuntimeError(f"private {EMAIL}")
        with self.assertLogs("venfour.preview_access", level="WARNING") as log:
            self.assertEqual(service.dispatch(), {"sent": 0, "deferred": 1})
        self.assertFalse(gateway.finish_total_loss_preview_email.call_args.args[2])
        self.assertNotIn(EMAIL, " ".join(log.output))

    def test_unacknowledged_send_remains_deferred(self):
        service, gateway, _ = service_fixture()
        gateway.reserve_total_loss_preview_email.side_effect = [reservation(), None]
        gateway.finish_total_loss_preview_email.return_value = False
        self.assertEqual(service.dispatch(), {"sent": 0, "deferred": 1})

    def test_invalid_or_cross_case_reservations_never_send(self):
        for row in (reservation(kind="unexpected"), reservation(claim_id="bad"),
                    reservation(case_id=CLAIM_ID), reservation(recipient_email="invalid")):
            with self.subTest(row=row):
                service, gateway, _ = service_fixture()
                gateway.reserve_total_loss_preview_email.return_value = row
                with self.assertLogs("venfour.preview_access", level="WARNING"):
                    self.assertEqual(service.dispatch(CASE_ID), {"sent": 0, "deferred": 1})
                gateway.send_total_loss_preview_magic_link.assert_not_called()
                gateway.finish_total_loss_preview_email.assert_not_called()

    def test_delivery_batch_is_bounded(self):
        service, gateway, _ = service_fixture()
        gateway.reserve_total_loss_preview_email.return_value = reservation()
        self.assertEqual(service.dispatch(), {"sent": 3, "deferred": 0})
        for limit in (0, 4, True, "3"):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                service.dispatch(limit=limit)


class PreviewAccessApiTests(unittest.TestCase):
    def test_invalid_dispatch_configuration_fails_closed_with_the_correct_setting(self):
        with patch.dict(os.environ, {"VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET": "too-short"}, clear=True):
            with self.assertRaisesRegex(ValueError, "preview email dispatch secret configuration"):
                create_app(enable_legacy_api=False)

    def client(self, *, configured=True):
        service, gateway, verifier = service_fixture()
        with patch.dict(os.environ, {"VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET": DISPATCH_SECRET}, clear=True):
            app = create_app(preview_access_service=service if configured else None, enable_legacy_api=False)
        client = TestClient(app)
        self.addCleanup(client.close)
        return client, gateway, verifier

    def test_public_recovery_does_not_require_a_session_and_returns_no_case_details(self):
        client, gateway, _ = self.client()
        for path, expected_case in (("/api/v1/preview-access/recovery", None),
                (f"/api/v1/appraisal-cases/{CASE_ID}/preview-access/recovery", CASE_ID)):
            response = client.post(path, json={"email": EMAIL, "turnstileToken": "challenge"})
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json(), {"status": "accepted"})
            self.assertEqual(response.headers["cache-control"], "private, no-store")
            self.assertEqual(gateway.request_total_loss_preview_recovery.call_args.args[0], expected_case)

    def test_no_match_and_enqueue_failure_have_the_same_public_response(self):
        client, gateway, _ = self.client()
        first = client.post("/api/v1/preview-access/recovery", json={"email": EMAIL, "turnstileToken": "challenge"})
        gateway.request_total_loss_preview_recovery.side_effect = RuntimeError(EMAIL)
        with self.assertLogs("venfour.preview_access", level="WARNING"):
            second = client.post("/api/v1/preview-access/recovery", json={"email": EMAIL, "turnstileToken": "challenge"})
        self.assertEqual((first.status_code, first.json()), (second.status_code, second.json()))

    def test_public_recovery_rejects_invalid_bodies_security_checks_and_case_ids(self):
        client, gateway, verifier = self.client()
        for body in ({"email": EMAIL}, {"email": EMAIL, "turnstileToken": "challenge", "redirectTo": "https://other.example"},
                     {"email": "invalid", "turnstileToken": "challenge"}, {"email": EMAIL, "turnstileToken": "x" * 10000}):
            response = client.post("/api/v1/preview-access/recovery", json=body)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(client.post("/api/v1/appraisal-cases/bad/preview-access/recovery",
            json={"email": EMAIL, "turnstileToken": "challenge"}).status_code, 400)
        verifier.verify.return_value = False
        response = client.post("/api/v1/preview-access/recovery", json={"email": EMAIL, "turnstileToken": "challenge"})
        self.assertEqual(response.json()["error"]["code"], "SECURITY_CHECK_FAILED")
        gateway.request_total_loss_preview_recovery.assert_not_called()

    def test_private_dispatch_requires_one_exact_secret_and_a_bounded_empty_body(self):
        client, gateway, _ = self.client()
        path = "/internal/v1/preview-emails/dispatch"
        for headers in ({}, {"X-Venfour-Preview-Dispatch": "wrong"},
                        [("X-Venfour-Preview-Dispatch", DISPATCH_SECRET)] * 2):
            self.assertEqual(client.post(path, headers=headers, json={}).status_code, 401)
        header = {"X-Venfour-Preview-Dispatch": DISPATCH_SECRET}
        self.assertEqual(client.post(path, headers=header, json={"caseId": CASE_ID}).status_code, 400)
        gateway.reserve_total_loss_preview_email.assert_not_called()
        response = client.post(path, headers=header, json={})
        self.assertEqual(response.json(), {"sent": 0, "deferred": 0})
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    def test_unconfigured_recovery_fails_closed(self):
        client, _, _ = self.client(configured=False)
        response = client.post("/api/v1/preview-access/recovery", json={"email": EMAIL, "turnstileToken": "challenge"})
        self.assertEqual(response.status_code, 503)

    def test_delivery_failure_does_not_change_a_completed_analysis_response(self):
        analysis = Mock(spec=CaseAnalysisService)
        analysis.authenticate.return_value = "10000000-0000-4000-8000-000000000001"
        analysis.submit.return_value = CaseAnalysisStatus("completed", attempt_count=1, run_id=LEASE_ID)
        preview = Mock(spec=PreviewAccessService)
        preview.dispatch.side_effect = RuntimeError("Delivery temporarily unavailable")
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(case_analysis_service=analysis, preview_access_service=preview, enable_legacy_api=False)
        with TestClient(app) as client:
            response = client.post(f"/api/v1/appraisal-cases/{CASE_ID}/analysis",
                headers={"Authorization": "Bearer valid-session"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "status": "completed",
            "attemptCount": 1,
            "runId": LEASE_ID,
            "intakeCorrectionAllowed": False,
        })
        self.assertEqual(response.headers["location"], f"/api/v1/analyses/{LEASE_ID}")
        preview.dispatch.assert_called_once_with(CASE_ID)


class PreviewAccessGatewayTests(unittest.TestCase):
    def gateway(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return SupabaseHttpGateway(SupabaseServerConfiguration(
            url="https://project.supabase.co", publishable_key="publishable-test-key",
            service_role_key="service-role-test-key"), client=client)

    def test_ready_and_recovery_links_bind_both_case_and_claim_in_the_trusted_callback(self):
        requests = []
        gateway = self.gateway(lambda request: requests.append(request) or httpx.Response(200, json={}))
        for kind, route in (("ready", "preview-ready"), ("recovery", "preview")):
            gateway.send_total_loss_preview_magic_link(EMAIL, CASE_ID, CLAIM_ID, ORIGIN, kind)
            request = requests[-1]
            self.assertEqual(str(request.url.copy_with(query=None)), "https://project.supabase.co/auth/v1/otp")
            self.assertEqual(request.url.params["redirect_to"], f"{ORIGIN}/auth/callback/{route}/{CASE_ID}/{CLAIM_ID}")
            self.assertEqual(json.loads(request.content), {"email": EMAIL, "create_user": True})
            self.assertEqual(request.headers["authorization"], "Bearer service-role-test-key")

    def test_rpc_delivery_contracts_use_service_auth_and_lease_fencing(self):
        requests = []
        def handler(request):
            requests.append(request)
            name = request.url.path.rsplit("/", 1)[-1]
            if name == "request_total_loss_preview_recovery":
                return httpx.Response(204)
            return httpx.Response(200, json={"reserve_total_loss_preview_email": [reservation()],
                "finish_total_loss_preview_email": True}[name])
        gateway = self.gateway(handler)
        gateway.request_total_loss_preview_recovery(None, EMAIL, "a" * 64, "b" * 64)
        self.assertEqual(gateway.reserve_total_loss_preview_email(LEASE_ID, CASE_ID), reservation())
        self.assertTrue(gateway.finish_total_loss_preview_email(EMAIL_ID, LEASE_ID, True))
        self.assertEqual(json.loads(requests[0].content)["requested_case_id"], None)
        self.assertEqual(json.loads(requests[1].content), {"requested_lease_token": LEASE_ID, "requested_case_id": CASE_ID})
        self.assertEqual(json.loads(requests[2].content), {"requested_email_id": EMAIL_ID, "requested_lease_token": LEASE_ID, "delivered": True})
        for request in requests:
            self.assertEqual(request.headers["authorization"], "Bearer service-role-test-key")

    def test_mail_provider_failure_does_not_expose_response_details(self):
        gateway = self.gateway(lambda _: httpx.Response(429, json={"message": EMAIL}))
        with self.assertRaises(SupabaseUnavailableError) as raised:
            gateway.send_total_loss_preview_magic_link(EMAIL, CASE_ID, CLAIM_ID, ORIGIN, "ready")
        self.assertNotIn(EMAIL, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
