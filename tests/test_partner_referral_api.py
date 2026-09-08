"""Private referral link and attribution projections at the HTTP boundary."""

from __future__ import annotations

import copy
import json
import unittest
from unittest.mock import Mock

import httpx
from starlette.applications import Starlette
from starlette.testclient import TestClient

from venfour.partner_api import partner_routes
from venfour.partner_service import PartnerError, PartnerGateway, PartnerService
from venfour.supabase_gateway import SupabaseServerConfiguration


PARTNER_ID = "20000000-0000-4000-8000-000000000001"
REQUEST_ID = "30000000-0000-4000-8000-000000000001"
WHEN = "2026-09-08T12:00:00+00:00"
SUMMARY = {
    "link": {
        "id": "40000000-0000-4000-8000-000000000001", "code": "a" * 48,
        "status": "active", "revision": 1, "created_at": WHEN,
    },
    "summary": {"submitted_count": 4, "purchased_count": 3, "refunded_count": 1, "under_review_count": 1},
}
REFERRALS = {
    "items": [
        {"id": f"50000000-0000-4000-8000-{index:012}", "submitted_at": WHEN,
         "purchased_at": None if status == "submitted" else WHEN, "status": status}
        for index, status in enumerate(("submitted", "purchased", "refunded", "under_review"), start=1)
    ],
    "total": 4, "page": 1, "page_size": 50,
}


class ReferralLinkHttpTests(unittest.TestCase):
    def setUp(self):
        self.gateway = Mock()
        self.service = PartnerService(self.gateway, email_configured=False)
        self.app = Starlette(routes=partner_routes())
        self.app.state.partner_service = self.service
        self.app.state.partner_delivery_service = Mock()
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.headers = {"Authorization": "Bearer current-user-token"}

    def post(self, action, payload=None, *, staff=False, headers=None):
        root = "/api/v1/staff/referral-partners" if staff else "/api/v1/partners"
        return self.client.post(root + "/operations", headers=self.headers if headers is None else headers,
                                json={"action": action, "payload": {"partner_id": PARTNER_ID} if payload is None else payload})

    def test_all_referral_responses_use_current_identity_private_headers_and_audience_specific_database_actions(self):
        for staff, action, database_action, body in (
            (False, "referral_summary", "referral_summary", SUMMARY),
            (False, "referral_list", "referral_list", REFERRALS),
            (True, "referral_summary", "staff_referral_summary", SUMMARY),
            (True, "referral_list", "staff_referral_list", REFERRALS),
            (True, "link_state", "link_state", SUMMARY),
        ):
            with self.subTest(staff=staff, action=action):
                self.gateway.reset_mock()
                self.gateway.operation.return_value = copy.deepcopy(body)
                payload = {"partner_id": PARTNER_ID}
                if action == "link_state":
                    payload.update(expected_revision=1, enabled=False, request_id=REQUEST_ID)
                response = self.post(action, payload, staff=staff)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), body)
                self.assertEqual(response.headers["cache-control"], "private, no-store")
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")
                self.gateway.operation.assert_called_once_with(database_action, payload, "current-user-token")
        self.app.state.partner_delivery_service.dispatch.assert_not_called()

    def test_authentication_is_required_even_for_referral_counts(self):
        for staff in (False, True):
            for action in ("referral_summary", "referral_list"):
                with self.subTest(staff=staff, action=action):
                    response = self.post(action, staff=staff, headers={})
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.gateway.operation.assert_not_called()

    def test_internal_manager_aliases_and_link_control_cannot_bypass_the_public_action_allowlists(self):
        for action in ("link_state", "staff_referral_summary", "staff_referral_list", "referral_resolve", "record_conversion"):
            with self.subTest(action=action):
                self.assertEqual(self.post(action).status_code, 400)
        for action in ("staff_referral_summary", "staff_referral_list", "referral_resolve", "record_conversion"):
            self.assertEqual(self.post(action, staff=True).status_code, 400)
        self.gateway.operation.assert_not_called()

    def test_unknown_fields_invalid_identifiers_and_unbounded_pagination_never_reach_database(self):
        invalid = (
            ("referral_summary", {}),
            ("referral_summary", {"partner_id": "not-a-uuid"}),
            ("referral_summary", {"partner_id": PARTNER_ID, "user_id": "other-user"}),
            ("referral_list", {"partner_id": PARTNER_ID, "case_id": "private-case"}),
            ("referral_list", {"partner_id": PARTNER_ID, "page": True}),
            ("referral_list", {"partner_id": PARTNER_ID, "page": 0}),
            ("referral_list", {"partner_id": PARTNER_ID, "page_size": 101}),
            ("referral_list", {"partner_id": PARTNER_ID, "page_size": 0}),
            ("link_state", {"partner_id": PARTNER_ID, "expected_revision": 1, "enabled": True}),
            ("link_state", {"partner_id": PARTNER_ID, "expected_revision": True, "enabled": True, "request_id": REQUEST_ID}),
            ("link_state", {"partner_id": PARTNER_ID, "expected_revision": 1, "enabled": "true", "request_id": REQUEST_ID}),
        )
        for action, payload in invalid:
            with self.subTest(action=action, payload=payload):
                response = self.post(action, payload, staff=True)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "INVALID_PARTNER_REQUEST")
        self.gateway.operation.assert_not_called()

    def test_permission_revocation_is_rechecked_inside_the_same_database_operation_on_every_read_or_replay(self):
        for action, database_action, body in (
            ("referral_summary", "staff_referral_summary", SUMMARY),
            ("referral_list", "staff_referral_list", REFERRALS),
            ("link_state", "link_state", SUMMARY),
        ):
            with self.subTest(action=action):
                self.gateway.reset_mock()
                self.gateway.operation.side_effect = [body, PartnerError(403, "PARTNER_ACCESS_DENIED", "Access was revoked.")]
                payload = {"partner_id": PARTNER_ID}
                if action == "link_state":
                    payload.update(expected_revision=1, enabled=True, request_id=REQUEST_ID)
                self.assertEqual(self.post(action, payload, staff=True).status_code, 200)
                self.assertEqual(self.post(action, payload, staff=True).status_code, 403)
                self.assertEqual([call.args[0] for call in self.gateway.operation.call_args_list], [database_action, database_action])

    def test_owner_routes_do_not_upgrade_a_manager_to_cross_partner_access(self):
        self.gateway.operation.side_effect = PartnerError(403, "PARTNER_ACCESS_DENIED", "This record is unavailable.")
        response = self.post("referral_summary")
        self.assertEqual(response.status_code, 403)
        self.gateway.operation.assert_called_once_with("referral_summary", {"partner_id": PARTNER_ID}, "current-user-token")

    def test_counts_keep_historical_purchases_separate_and_inactive_partners_can_have_no_link(self):
        body = {**SUMMARY, "link": None}
        self.gateway.operation.return_value = body
        response = self.post("referral_summary")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"], {
            "submitted_count": 4, "purchased_count": 3, "refunded_count": 1, "under_review_count": 1,
        })
        self.assertIsNone(response.json()["link"])

    def test_unexpected_identity_case_and_payment_fields_fail_closed_instead_of_leaking_through_projection(self):
        for field in ("customer_name", "customer_email", "case_id", "order_id", "payment_intent_id", "report_url"):
            with self.subTest(field=field):
                body = copy.deepcopy(REFERRALS)
                body["items"][0][field] = "private-person@example.test"
                self.gateway.operation.return_value = body
                response = self.post("referral_list")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["error"]["code"], "PARTNER_UNAVAILABLE")
                self.assertNotIn("private-person", response.text)
                self.assertNotIn(field, response.text)

    def test_malformed_projection_fields_never_look_like_empty_or_successful_referral_data(self):
        malformed = [
            ("referral_summary", {**SUMMARY, "customer_count_by_email": {"private@example.test": 1}}),
            ("referral_summary", {**SUMMARY, "summary": {**SUMMARY["summary"], "purchased_count": -1}}),
            ("referral_summary", {**SUMMARY, "link": {**SUMMARY["link"], "code": "https://external.test"}}),
            ("referral_summary", {**SUMMARY, "link": {**SUMMARY["link"], "revision": True}}),
            ("referral_list", {**REFERRALS, "page_size": 101}),
            ("referral_list", {**REFERRALS, "items": [{**REFERRALS["items"][1], "purchased_at": None}]}),
            ("referral_list", {**REFERRALS, "items": [{**REFERRALS["items"][0], "status": "processing_customer_report"}]}),
        ]
        for action, body in malformed:
            with self.subTest(action=action, body=body):
                self.gateway.operation.return_value = body
                response = self.post(action)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers["cache-control"], "private, no-store")
                self.assertNotIn("private@example.test", response.text)


class ReferralLinkGatewayTests(unittest.TestCase):
    def gateway(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return PartnerGateway(SupabaseServerConfiguration(
            url="http://127.0.0.1:54321", publishable_key="public-key", service_role_key="private-key",
        ), client=client)

    def test_new_reads_and_controls_reach_only_the_validated_user_rpc(self):
        seen = []

        def handler(request):
            self.assertEqual(str(request.url), "http://127.0.0.1:54321/rest/v1/rpc/referral_partner_operation")
            self.assertEqual(request.headers["authorization"], "Bearer verified-user-token")
            self.assertEqual(request.headers["apikey"], "public-key")
            body = json.loads(request.content)
            seen.append(body)
            return httpx.Response(200, json=REFERRALS if body["p_action"].endswith("referral_list") else SUMMARY)

        service = PartnerService(self.gateway(handler))
        for staff in (False, True):
            for action in ("referral_summary", "referral_list"):
                service.operation(action, {"partner_id": PARTNER_ID}, "verified-user-token", staff=staff)
        service.operation("link_state", {"partner_id": PARTNER_ID, "expected_revision": 1, "enabled": False, "request_id": REQUEST_ID}, "verified-user-token", staff=True)
        self.assertEqual([item["p_action"] for item in seen], [
            "referral_summary", "referral_list", "staff_referral_summary", "staff_referral_list", "link_state",
        ])

    def test_database_denial_conflict_and_validation_errors_remain_distinct_without_private_details(self):
        for code, expected_status in (("28000", 401), ("42501", 403), ("40001", 409), ("55000", 409),
                                      ("22023", 400), ("22P02", 400), ("P0002", 404)):
            with self.subTest(code=code):
                gateway = self.gateway(lambda request: httpx.Response(400, json={"code": code, "message": "private customer payment detail"}))
                service = PartnerService(gateway)
                with self.assertRaises(PartnerError) as caught:
                    service.operation("referral_summary", {"partner_id": PARTNER_ID}, "verified-user-token", staff=True)
                self.assertEqual(caught.exception.status, expected_status)
                self.assertNotIn("private customer", caught.exception.message)


if __name__ == "__main__":
    unittest.main()
