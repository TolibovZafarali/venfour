"""Customer-confirmed closure transport, provenance, and historical resume coverage."""

from __future__ import annotations

import copy
import json
import os
import unittest
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from tests import test_case_claim_access as claim_fixture
from tests import test_repeatable_response_rounds as rounds_fixture
from tests.test_customer_delivery import (
    ACCESS_TOKEN, CASE_ID, CLIENT_REQUEST_ID, COMMUNICATION_ID, NOW, REPORT_ID,
    RecordingGateway,
)
from tests.test_insurer_response_decision import (
    DECISION_ID, OFFER_ID, OTHER_ID, RECOMMENDATION_ID, DecisionGateway,
    decision_request,
)
from venfour.api import create_app
from venfour.case_claim_access import CaseClaimAccessService
from venfour.customer_delivery import (
    CustomerDeliveryInputError, CustomerDeliveryService, validate_case_resolution,
)
from venfour.supabase_gateway import (
    SupabaseAuthenticationError, SupabaseConflictError, SupabaseContractError,
    SupabaseHttpGateway, SupabaseServerConfiguration,
)


def resolution_request(code="ACCEPTED_VERIFIED_OFFER", amount=None):
    return {
        "clientRequestId": CLIENT_REQUEST_ID,
        "workflowRevision": 13,
        "resolutionCode": code,
        "decisionId": DECISION_ID if code == "ACCEPTED_VERIFIED_OFFER" else None,
        "offerId": OFFER_ID if code == "ACCEPTED_VERIFIED_OFFER" else None,
        "amountMinorUnits": amount,
        "currency": "USD" if amount is not None else None,
    }


def resolution_projection(
    code="ACCEPTED_VERIFIED_OFFER", amount=None, offer_source="CUSTOMER_RECORDED"
):
    accepted = code == "ACCEPTED_VERIFIED_OFFER"
    amount = 2_010_000 if accepted else amount
    return {
        "code": code, "resolvedAt": NOW,
        "customerConfirmed": code != "NO_DISPUTE_SUPPORTED",
        "clientRequestId": None if code == "NO_DISPUTE_SUPPORTED" else CLIENT_REQUEST_ID,
        "offerId": OFFER_ID if accepted else None,
        "amountMinorUnits": amount,
        "currency": "USD" if amount is not None else None,
        "amountSource": offer_source if accepted else "CUSTOMER_REPORTED" if amount is not None else None,
        "recommendationId": RECOMMENDATION_ID if accepted else None,
        "decisionId": DECISION_ID if accepted else None,
        "responseId": COMMUNICATION_ID if accepted else None,
    }


class ResolutionGateway(RecordingGateway):
    def __init__(self):
        super().__init__()
        self.error = None
        self.offer_source = "CUSTOMER_RECORDED"

    def confirm_total_loss_case_resolution(self, case_id, values, token):
        self.calls.append(("resolution", (case_id, dict(values), token)))
        if self.error:
            raise self.error
        return {
            "state": "resolved",
            "resolution": resolution_projection(
                values["resolutionCode"], values["amountMinorUnits"], self.offer_source
            ),
            "workflowRevision": 14,
        }


class CaseResolutionContractTests(unittest.TestCase):
    def test_accept_remains_open_until_separate_customer_confirmation(self):
        decision_gateway = DecisionGateway()
        decision = CustomerDeliveryService(decision_gateway).record_response_decision(
            CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN,
        )
        self.assertEqual(decision["state"], "insurer_response_reviewed")
        self.assertNotIn("resolution", decision)
        gateway = ResolutionGateway()
        result = CustomerDeliveryService(gateway).confirm_resolution(CASE_ID, resolution_request(), ACCESS_TOKEN)
        self.assertEqual(result["state"], "resolved")
        resolution = result["resolution"]
        for key in ("offerId", "amountMinorUnits", "currency", "decisionId", "recommendationId"):
            self.assertEqual(resolution[key], decision["response"]["decision"][key])
        self.assertTrue(resolution["customerConfirmed"])
        self.assertEqual(resolution["amountSource"], "CUSTOMER_RECORDED")
        self.assertEqual(gateway.calls, [("authenticate", ACCESS_TOKEN), ("resolution", (CASE_ID, resolution_request(), ACCESS_TOKEN))])

    def test_manual_resolution_amount_is_optional_and_customer_reported(self):
        for amount in (None, 2_040_000):
            with self.subTest(amount=amount):
                result = CustomerDeliveryService(ResolutionGateway()).confirm_resolution(
                    CASE_ID, resolution_request("RESOLVED_WITH_INSURER", amount), ACCESS_TOKEN,
                )["resolution"]
                self.assertEqual(result["amountMinorUnits"], amount)
                self.assertEqual(result["amountSource"], "CUSTOMER_REPORTED" if amount else None)
                for key in ("offerId", "decisionId", "recommendationId", "responseId"):
                    self.assertIsNone(result[key])

    def test_response_text_offer_retains_its_saved_source(self):
        gateway = ResolutionGateway()
        gateway.offer_source = "RESPONSE_TEXT"
        resolution = CustomerDeliveryService(gateway).confirm_resolution(
            CASE_ID, resolution_request(), ACCESS_TOKEN,
        )["resolution"]
        self.assertEqual(resolution["amountSource"], "RESPONSE_TEXT")
        self.assertEqual(resolution["offerId"], OFFER_ID)
        self.assertEqual(resolution["decisionId"], DECISION_ID)

    def test_stopping_requires_neither_decision_nor_offer_and_preserves_outcome(self):
        result = CustomerDeliveryService(ResolutionGateway()).confirm_resolution(
            CASE_ID, resolution_request("CUSTOMER_STOPPED_PURSUING"), ACCESS_TOKEN,
        )["resolution"]
        self.assertEqual(result["code"], "CUSTOMER_STOPPED_PURSUING")
        self.assertIsNone(result["amountMinorUnits"])
        self.assertIsNone(result["offerId"])

    def test_duplicate_confirmation_forwards_identical_request_identity(self):
        gateway = ResolutionGateway()
        service = CustomerDeliveryService(gateway)
        first = service.confirm_resolution(CASE_ID, resolution_request(), ACCESS_TOKEN)
        self.assertEqual(first, service.confirm_resolution(CASE_ID, resolution_request(), ACCESS_TOKEN))
        self.assertEqual(gateway.calls[1], gateway.calls[3])

    def test_malformed_or_evidence_inventing_input_is_rejected_before_auth(self):
        invalid = [
            {**resolution_request(), "resolutionCode": "NO_DISPUTE_SUPPORTED"},
            {**resolution_request(), "resolutionCode": []},
            {**resolution_request(), "decisionId": None},
            {**resolution_request(), "offerId": None},
            {**resolution_request(), "workflowRevision": True},
            {**resolution_request(), "workflowRevision": 0},
            {**resolution_request(), "amountMinorUnits": 2_010_000, "currency": "USD"},
            {**resolution_request(), "amountSource": "VERIFIED_INSURER_OFFER"},
            {**resolution_request("RESOLVED_WITH_INSURER"), "decisionId": DECISION_ID},
            resolution_request("CUSTOMER_STOPPED_PURSUING", 1),
        ]
        for amount in (True, 0, -1, 1.5, 9_007_199_254_740_992):
            invalid.append(resolution_request("RESOLVED_WITH_INSURER", amount))
        for fields in ({"currency": "usd"}, {"currency": None}, {"amountMinorUnits": None}):
            invalid.append({**resolution_request("RESOLVED_WITH_INSURER", 1), **fields})
        for values in invalid:
            with self.subTest(values=values):
                gateway = ResolutionGateway()
                with self.assertRaises(CustomerDeliveryInputError):
                    CustomerDeliveryService(gateway).confirm_resolution(CASE_ID, values, ACCESS_TOKEN)
                self.assertEqual(gateway.calls, [])

    def test_server_acknowledgment_cannot_change_customer_identity_or_amount(self):
        for fields in (
            {"clientRequestId": OTHER_ID}, {"offerId": OTHER_ID}, {"decisionId": OTHER_ID},
        ):
            gateway = ResolutionGateway()
            response = gateway.confirm_total_loss_case_resolution(CASE_ID, resolution_request(), ACCESS_TOKEN)
            response["resolution"].update(fields)
            with self.subTest(fields=fields), patch.object(gateway, "confirm_total_loss_case_resolution", return_value=response):
                with self.assertRaises(SupabaseContractError):
                    CustomerDeliveryService(gateway).confirm_resolution(CASE_ID, resolution_request(), ACCESS_TOKEN)
        gateway = ResolutionGateway()
        request = resolution_request("RESOLVED_WITH_INSURER", 1)
        response = gateway.confirm_total_loss_case_resolution(CASE_ID, request, ACCESS_TOKEN)
        response["resolution"]["amountMinorUnits"] = 2
        with patch.object(gateway, "confirm_total_loss_case_resolution", return_value=response):
            with self.assertRaises(SupabaseContractError):
                CustomerDeliveryService(gateway).confirm_resolution(CASE_ID, request, ACCESS_TOKEN)

    def test_resolution_projection_preserves_provenance_and_no_dispute(self):
        original = resolution_projection("NO_DISPUTE_SUPPORTED")
        self.assertEqual(validate_case_resolution(original), original)
        for code, fields in (
            ("ACCEPTED_VERIFIED_OFFER", {"amountSource": "CUSTOMER_REPORTED"}),
            ("ACCEPTED_VERIFIED_OFFER", {"amountSource": "VERIFIED_INSURER_OFFER"}),
            ("ACCEPTED_VERIFIED_OFFER", {"customerConfirmed": False}),
            ("ACCEPTED_VERIFIED_OFFER", {"offerId": None}),
            ("ACCEPTED_VERIFIED_OFFER", {"resolvedAt": "yesterday"}),
            ("ACCEPTED_VERIFIED_OFFER", {"unknown": True}),
            ("RESOLVED_WITH_INSURER", {"amountMinorUnits": 1, "currency": "USD", "amountSource": "CUSTOMER_RECORDED"}),
            ("CUSTOMER_STOPPED_PURSUING", {"offerId": OFFER_ID}),
            ("NO_DISPUTE_SUPPORTED", {"customerConfirmed": True}),
        ):
            with self.subTest(code=code, fields=fields), self.assertRaises(SupabaseContractError):
                validate_case_resolution({**resolution_projection(code), **fields})


class CaseResolutionResumeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rounds_fixture.RepeatableResponseRoundTests.setUpClass()

    def closed_row(self, code="ACCEPTED_VERIFIED_OFFER"):
        fixture = rounds_fixture.RepeatableResponseRoundTests()
        history = fixture.history()
        for item in history:
            for response in item["responses"]:
                response["canCorrect"] = False
        response = history[-1]["responses"][-1]
        resolution = resolution_projection(code)
        if code == "ACCEPTED_VERIFIED_OFFER":
            response["decision"] = {
                **DecisionGateway().record_total_loss_insurer_response_decision(CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN)["response"]["decision"],
                "recommendationId": response["recommendation"]["recommendationId"],
                "analysisResultId": response["recommendation"]["analysisResultId"],
                "offerId": response["usableOffer"]["offerId"],
            }
            resolution.update({
                "responseId": response["responseId"],
                "recommendationId": response["decision"]["recommendationId"],
                "offerId": response["usableOffer"]["offerId"],
            })
        return {
            **fixture.resume(history), "workflow_phase": "resolution",
            "workflow_current_task": "resolved", "workflow_revision": 32,
            "next_task": "resolved", "entitlement_status": "active",
            "customer_journey": {"nextState": "resolved", "fulfillmentState": "resolved", "retryable": False},
            "case_resolution": resolution,
        }

    def test_closed_workspace_keeps_all_rounds_report_and_entitlement(self):
        for code in ("ACCEPTED_VERIFIED_OFFER", "RESOLVED_WITH_INSURER", "CUSTOMER_STOPPED_PURSUING"):
            with self.subTest(code=code):
                row = self.closed_row(code)
                original = copy.deepcopy(row)
                result = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
                self.assertEqual(result["workflow"]["currentTask"], "resolved")
                self.assertEqual(result["resolution"], row["case_resolution"])
                self.assertEqual(result["report"], row["published_report"])
                self.assertEqual(result["commerce"]["entitlementStatus"], "active")
                self.assertEqual(result["negotiationHistory"], row["negotiation_history"])
                self.assertEqual(len(result["negotiationHistory"]), 3)
                self.assertEqual(row, original)

    def test_stale_accept_offer_and_inconsistent_terminal_projection_fail_closed(self):
        for key, value in (("offerId", OTHER_ID), ("decisionId", OTHER_ID), ("responseId", OTHER_ID), ("recommendationId", OTHER_ID), ("amountMinorUnits", 1), ("currency", "CAD")):
            row = self.closed_row()
            row["case_resolution"][key] = value
            with self.subTest(key=key), self.assertRaises(SupabaseContractError):
                CaseClaimAccessService._resume_state(row, CASE_ID)
        for fields in (
            {"case_resolution": None}, {"workflow_phase": "negotiation"},
            {"checkout_available": True},
            {"customer_journey": {"nextState": "insurer_response_reviewed", "fulfillmentState": "insurer_response_reviewed", "retryable": False}},
        ):
            with self.subTest(fields=fields), self.assertRaises(SupabaseContractError):
                CaseClaimAccessService._resume_state({**self.closed_row(), **fields}, CASE_ID)
        row = self.closed_row()
        row["negotiation_history"][0]["responses"][0]["canCorrect"] = True
        with self.assertRaises(SupabaseContractError):
            CaseClaimAccessService._resume_state(row, CASE_ID)

        row = self.closed_row()
        row["case_resolution"]["amountSource"] = "RESPONSE_TEXT"
        with self.assertRaises(SupabaseContractError):
            CaseClaimAccessService._resume_state(row, CASE_ID)

    def test_manual_closure_before_any_response_retains_the_original_request(self):
        row = self.closed_row("CUSTOMER_STOPPED_PURSUING")
        first_round = row["negotiation_history"][0]
        first_round.update({"responses": [], "followUp": None})
        row.update({"negotiation_history": [first_round], "insurer_response": None})
        result = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
        self.assertEqual(result["resolution"]["code"], "CUSTOMER_STOPPED_PURSUING")
        self.assertIsNone(result["insurerResponse"])
        self.assertEqual(result["negotiationHistory"][0]["outbound"], first_round["outbound"])

    def test_no_dispute_keeps_existing_journey(self):
        row = {
            **claim_fixture.resume_row("secured"), "workflow_phase": "resolution",
            "workflow_current_task": "no_dispute", "checkout_available": False,
            "next_task": "no_dispute", "case_resolution": resolution_projection("NO_DISPUTE_SUPPORTED"),
            "customer_journey": {"nextState": "no_dispute", "fulfillmentState": "no_dispute", "retryable": False},
        }
        result = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
        self.assertEqual(result["journey"]["nextState"], "no_dispute")
        self.assertFalse(result["resolution"]["customerConfirmed"])

    def test_separately_revoked_access_withholds_paid_history_without_losing_terminal_state(self):
        row = self.closed_row()
        row.update({
            "entitlement_status": "revoked", "next_task": "purchase_unavailable",
            "customer_journey": {"nextState": "needs_attention", "fulfillmentState": "needs_attention", "retryable": False},
            "case_resolution": None, "published_report": None,
            "negotiation_history": [], "insurer_response": None,
        })
        result = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
        self.assertEqual(result["workflow"]["currentTask"], "resolved")
        self.assertEqual(result["journey"]["nextState"], "needs_attention")
        self.assertIsNone(result["resolution"])
        self.assertIsNone(result["report"])
        self.assertEqual(result["negotiationHistory"], [])

    def test_claim_http_opens_historical_workspace(self):
        gateway = claim_fixture.RecordingGateway()
        gateway.resolve_result = self.closed_row()
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(case_claim_access_service=CaseClaimAccessService(gateway), enable_legacy_api=False)
        with TestClient(app) as client:
            response = client.get(f"/api/v1/appraisal-cases/{CASE_ID}/claim", headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["journey"]["nextState"], "resolved")
        self.assertEqual(len(response.json()["negotiationHistory"]), 3)


class CaseResolutionHttpTests(unittest.TestCase):
    def setUp(self):
        self.gateway = ResolutionGateway()
        with patch.dict(os.environ, {}, clear=True):
            self.client = TestClient(create_app(customer_delivery_service=CustomerDeliveryService(self.gateway), enable_legacy_api=False))
        self.path = f"/api/v1/appraisal-cases/{CASE_ID}/claim/resolution"
        self.headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}

    def tearDown(self):
        self.client.close()

    def test_explicit_post_closes_and_duplicate_confirmation_is_safe(self):
        first = self.client.post(self.path, json=resolution_request(), headers=self.headers)
        repeat = self.client.post(self.path, json=resolution_request(), headers=self.headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), repeat.json())
        self.assertEqual(first.json()["state"], "resolved")
        self.assertIn("no-store", first.headers["cache-control"])

    def test_visit_or_missing_auth_cannot_close(self):
        self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 405)
        self.assertEqual(self.client.post(self.path, json=resolution_request()).status_code, 401)
        self.assertEqual(self.gateway.calls, [])

    def test_bad_input_stale_revision_owner_and_entitlement_errors_are_private(self):
        for values in ({**resolution_request(), "customerConfirmed": True}, {**resolution_request(), "offerId": None}):
            self.assertEqual(self.client.post(self.path, json=values, headers=self.headers).status_code, 400)
        self.assertEqual(self.gateway.calls, [])
        for error, status in ((SupabaseAuthenticationError("denied"), 401), (SupabaseConflictError("stale or closed"), 409)):
            self.gateway.error = error
            response = self.client.post(self.path, json=resolution_request(), headers=self.headers)
            self.assertEqual(response.status_code, status)
            self.assertIn("no-store", response.headers["cache-control"])

    def test_closure_keeps_authorized_report_and_original_download_routes(self):
        self.assertEqual(self.client.post(self.path, json=resolution_request(), headers=self.headers).status_code, 200)
        report = self.client.get(f"/api/v1/appraisal-cases/{CASE_ID}/reports/{REPORT_ID}/download", headers=self.headers)
        original = self.client.post(f"/api/v1/appraisal-cases/{CASE_ID}/claim/insurer-responses/{COMMUNICATION_ID}/original/download", headers=self.headers)
        self.assertEqual(report.status_code, 200)
        self.assertEqual(original.status_code, 200)
        for response in (report, original):
            self.assertIn("downloadUrl", response.json())
            self.assertIn("no-store", response.headers["cache-control"])

    def test_gateway_uses_owner_authority_and_exact_revision_source_fields(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"state": "resolved"})
        client = httpx.Client(transport=httpx.MockTransport(handler))
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration("http://127.0.0.1:54321", "publishable-test", "service-test"), client=client)
        try:
            gateway.confirm_total_loss_case_resolution(CASE_ID, resolution_request(), ACCESS_TOKEN)
        finally:
            gateway.close()
            client.close()
        self.assertEqual(requests[0].url.path, "/rest/v1/rpc/confirm_total_loss_case_resolution")
        self.assertEqual(requests[0].headers["authorization"], f"Bearer {ACCESS_TOKEN}")
        self.assertEqual(json.loads(requests[0].content), {
            "requested_case_id": CASE_ID, "requested_client_request_id": CLIENT_REQUEST_ID,
            "requested_resolution_code": "ACCEPTED_VERIFIED_OFFER", "expected_workflow_revision": 13,
            "requested_decision_id": DECISION_ID, "requested_offer_id": OFFER_ID,
            "requested_amount_minor_units": None, "requested_currency": None,
        })


if __name__ == "__main__":
    unittest.main()
