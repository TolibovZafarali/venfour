"""Private referral HTTP contracts, gateway authorization, and artifact integrity."""

from __future__ import annotations

import hashlib
import os
import unittest
from unittest.mock import Mock, patch

import httpx
from starlette.applications import Starlette
from starlette.testclient import TestClient

from venfour.partner_api import partner_routes, validated_partner_dispatch_secret
from venfour.partner_service import PartnerError, PartnerGateway, PartnerService
from venfour.supabase_gateway import SupabaseHttpGateway, SupabaseServerConfiguration
from venfour.api import create_app


AGREEMENT_ID = "10000000-0000-4000-8000-000000000001"
PARTNER_ID = "20000000-0000-4000-8000-000000000001"
OBJECT = f"partners/{PARTNER_ID}/agreements/{AGREEMENT_ID}/signed.pdf"
PDF = b"%PDF-1.4\nretained agreement\n%%EOF"
DISPATCH_SECRET = "partner-dispatch-unit-test-secret-32-characters"


class PartnerHttpTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock()
        self.gateway.operation.return_value = {"is_partner_manager": True}
        self.service = PartnerService(self.gateway, email_configured=True)
        self.app = Starlette(routes=partner_routes())
        self.app.state.partner_service = self.service
        self.app.state.partner_delivery_service = None
        self.app.state.partner_dispatch_secret = DISPATCH_SECRET
        self.client = TestClient(self.app)
        self.headers = {"Authorization": "Bearer verified-user-token"}

    def tearDown(self):
        self.client.close()

    def post(self, action, payload=None, staff=False):
        root = "/api/v1/staff/referral-partners" if staff else "/api/v1/partners"
        return self.client.post(root + "/operations", headers=self.headers,
                                json={"action": action, "payload": payload or {}})

    def test_authentication_and_private_access(self):
        response = self.client.get("/api/v1/partners/access")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.gateway.operation.assert_not_called()
        response = self.client.get("/api/v1/staff/referral-partners/access", headers=self.headers)
        self.assertEqual(response.json(), {"is_partner_manager": True, "email_configured": True})
        self.gateway.operation.assert_called_once_with("access", {}, "verified-user-token")

    def test_ambiguous_bearer_headers_never_reach_privileged_operations(self):
        for headers in (
            [("Authorization", "Bearer first"), ("Authorization", "Bearer second")],
            {"Authorization": "Bearer "}, {"Authorization": "Basic credentials"},
            {"Authorization": "Bearer first second"},
        ):
            response = self.client.post("/api/v1/staff/referral-partners/operations", headers=headers,
                                        json={"action": "staff_create", "payload": {}})
            self.assertEqual(response.status_code, 401)
        self.gateway.operation.assert_not_called()

    def test_unexpected_failure_never_exposes_identity_or_private_provider_details(self):
        self.gateway.operation.side_effect = RuntimeError("private-token partner@example.test internal storage path")
        response = self.post("staff_list", staff=True)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertNotIn("partner@example.test", response.text)
        self.assertNotIn("private-token", response.text)

    def test_partner_endpoint_cannot_forward_manager_actions(self):
        for action in ("staff_create", "template_publish", "countersign", "lease_email"):
            with self.subTest(action=action):
                self.assertEqual(self.post(action).status_code, 400)
        self.gateway.operation.assert_not_called()

    def test_identity_cannot_be_substituted_in_transport(self):
        self.post("profile_save", {"partner_id": PARTNER_ID, "user_id": "someone-else"})
        self.assertEqual(self.gateway.operation.call_args.args[2], "verified-user-token")

    def test_invalid_and_oversized_bodies_do_not_reach_database(self):
        root = "/api/v1/partners/operations"
        for body in ([], {"action": "sign"}, {"action": "sign", "payload": {}, "extra": True}):
            self.assertEqual(self.client.post(root, headers=self.headers, json=body).status_code, 400)
        self.assertEqual(self.client.post(root, headers=self.headers, json={"text": "x" * 131073}).status_code, 413)
        self.gateway.operation.assert_not_called()

    def test_recheck_database_permission_each_time(self):
        self.gateway.operation.side_effect = [
            {"partners": []}, PartnerError(403, "PARTNER_ACCESS_DENIED", "Access was revoked."),
        ]
        self.assertEqual(self.post("staff_list", staff=True).status_code, 200)
        self.assertEqual(self.post("staff_list", staff=True).status_code, 403)
        self.assertEqual(self.gateway.operation.call_count, 2)

    def test_missing_sender_is_visible_and_prevents_issuing_email(self):
        self.service.email_configured = False
        response = self.post("invite", staff=True)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "PARTNER_EMAIL_UNCONFIGURED")
        self.gateway.operation.assert_called_once_with("access", {}, "verified-user-token")

    def test_both_downloads_use_same_checked_bytes(self):
        self.gateway.operation.return_value = {"object_path": OBJECT, "sha256": hashlib.sha256(PDF).hexdigest()}
        self.gateway.download_partner_document.return_value = PDF
        for root in ("/api/v1/partners", "/api/v1/staff/referral-partners"):
            response = self.client.get(f"{root}/agreements/{AGREEMENT_ID}/document", headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, PDF)
            self.assertEqual(response.headers["cache-control"], "private, no-store")
            self.assertIn("attachment", response.headers["content-disposition"])

    def test_download_never_returns_corrupt_or_unauthorized_bytes(self):
        self.gateway.operation.return_value = {"object_path": OBJECT, "sha256": "0" * 64}
        self.gateway.download_partner_document.return_value = PDF
        path = f"/api/v1/partners/agreements/{AGREEMENT_ID}/document"
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 503)
        self.gateway.download_partner_document.reset_mock()
        self.gateway.operation.side_effect = PartnerError(403, "PARTNER_ACCESS_DENIED", "Access denied.")
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 403)
        self.gateway.download_partner_document.assert_not_called()

    def test_dispatcher_uses_separate_secret_and_empty_bounded_body(self):
        delivery = Mock()
        delivery.dispatch.return_value = {"sent": 1}
        self.app.state.partner_delivery_service = delivery
        path = "/internal/v1/referral-partners/dispatch"
        self.assertEqual(self.client.post(path, headers=self.headers).status_code, 401)
        headers = {"Authorization": f"Bearer {DISPATCH_SECRET}"}
        self.assertEqual(self.client.post(path, headers=headers, json={"limit": 100}).status_code, 400)
        self.assertEqual(self.client.post(path, headers=headers).json(), {"sent": 1})
        delivery.dispatch.assert_called_once_with()

    def test_invalid_dispatch_configuration_never_authorizes_worker(self):
        delivery = Mock()
        self.app.state.partner_delivery_service = delivery
        for secret in (None, "", "x", " " * 32, "x" * 513):
            self.app.state.partner_dispatch_secret = secret
            response = self.client.post("/internal/v1/referral-partners/dispatch",
                                        headers={"Authorization": f"Bearer {secret or 'missing'}"})
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers["cache-control"], "private, no-store")
        delivery.dispatch.assert_not_called()

    def test_dispatch_secret_validation_is_bounded_ascii_and_never_trims(self):
        for value in (None, "", "x" * 31, "x" * 513, "x" * 32 + " ", "x" * 32 + "\n",
                      "x" * 32 + "\x00", "x" * 32 + "\x7f", "x" * 32 + "é"):
            self.assertIsNone(validated_partner_dispatch_secret(value))
        for value in ("x" * 32, "x" * 512, DISPATCH_SECRET):
            self.assertEqual(validated_partner_dispatch_secret(value), value)


class PartnerGatewayTests(unittest.TestCase):
    def gateway(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return PartnerGateway(SupabaseServerConfiguration(
            url="http://127.0.0.1:54321", publishable_key="public-key", service_role_key="private-key",
        ), client=client)

    def test_user_operations_never_use_service_authorization(self):
        def handler(request):
            self.assertEqual(request.headers["authorization"], "Bearer user-token")
            self.assertEqual(request.headers["apikey"], "public-key")
            return httpx.Response(200, json={"is_partner_manager": False})
        self.assertFalse(self.gateway(handler).operation("access", {}, "user-token")["is_partner_manager"])

    def test_maps_denied_stale_and_invalid_database_operations(self):
        for code, status in (("42501", 403), ("40001", 409), ("22023", 400), ("P0002", 404)):
            with self.subTest(code=code):
                gateway = self.gateway(lambda request: httpx.Response(400, json={"code": code, "message": "sensitive internal detail"}))
                with self.assertRaises(PartnerError) as caught:
                    gateway.operation("sign", {}, "user-token")
                self.assertEqual(caught.exception.status, status)
                self.assertNotIn("sensitive", caught.exception.message)

    def test_storage_rejects_arbitrary_paths_before_request(self):
        request = Mock(return_value=httpx.Response(200, content=PDF))
        gateway = self.gateway(request)
        for path in ("../case-files/secret.pdf", "/signed.pdf", OBJECT + "?x=y"):
            with self.assertRaises(PartnerError):
                gateway.download_partner_document(path)
        request.assert_not_called()

    def test_create_only_storage_recovers_only_exact_existing_bytes(self):
        def handler(request):
            if request.method == "POST":
                self.assertEqual(request.headers["x-upsert"], "false")
                return httpx.Response(409, json={})
            return httpx.Response(200, content=PDF)
        gateway = self.gateway(handler)
        gateway.store_partner_document(OBJECT, PDF)
        with self.assertRaises(PartnerError):
            gateway.store_partner_document(OBJECT, PDF + b"different")


class PartnerCompositionTests(unittest.TestCase):
    def application(self, secret):
        environment = {
            "VENFOUR_PARTNER_EMAIL_PROVIDER": "mailpit",
            "VENFOUR_PUBLIC_APP_ORIGIN": "http://127.0.0.1:5173",
            "VENFOUR_PARTNER_MAILPIT_ORIGIN": "http://127.0.0.1:54324",
            "VENFOUR_PARTNER_EMAIL_FROM": "Venfour <partners@example.test>",
            "VENFOUR_PARTNER_EMAIL_REPLY_TO": "support@example.test",
        }
        if secret is not None:
            environment["VENFOUR_PARTNER_EMAIL_DISPATCH_SECRET"] = secret
        client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})))
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration(
            url="http://127.0.0.1:54321", publishable_key="public-key", service_role_key="private-key",
        ), client=client)
        self.addCleanup(gateway.close)
        with patch.dict(os.environ, environment, clear=True):
            app = create_app(supabase_gateway=gateway, enable_legacy_api=False)
        self.addCleanup(app.state.partner_service.gateway.close)
        self.addCleanup(app.state.partner_delivery_service.close)
        return app

    def test_complete_sender_without_valid_dispatch_secret_disables_sending_but_retains_document_worker(self):
        for secret in (None, "short", "x" * 32 + "\n"):
            with self.subTest(secret=secret):
                app = self.application(secret)
                self.assertFalse(app.state.partner_service.email_configured)
                self.assertIsNone(app.state.partner_dispatch_secret)
                self.assertIsNotNone(app.state.case_analysis_service)
                with patch.object(app.state.partner_service.gateway, "worker", return_value=None) as worker:
                    self.assertEqual(app.state.partner_delivery_service.dispatch()["disabled"], 1)
                    self.assertEqual([call.args[0] for call in worker.call_args_list], ["lease_document"])

    def test_complete_sender_and_valid_dispatch_secret_enable_partner_delivery(self):
        app = self.application(DISPATCH_SECRET)
        self.assertTrue(app.state.partner_service.email_configured)
        self.assertEqual(app.state.partner_dispatch_secret, DISPATCH_SECRET)
        with patch.object(app.state.partner_service.gateway, "worker", return_value=None) as worker:
            self.assertEqual(app.state.partner_delivery_service.dispatch()["disabled"], 0)
            self.assertEqual([call.args[0] for call in worker.call_args_list], ["lease_document", "lease_email"])


if __name__ == "__main__":
    unittest.main()
