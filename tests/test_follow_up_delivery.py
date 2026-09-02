"""Owner-scoped follow-up delivery contracts and exact-version HTTP requests."""

from __future__ import annotations

import copy
import json
import os
import unittest
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.case_claim_access import CaseClaimAccessService
from venfour.customer_delivery import (
    CustomerDeliveryInputError,
    CustomerDeliveryConflictError,
    CustomerDeliveryService,
    validate_follow_up_projection,
    validate_message_draft,
)
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseConflictError,
    SupabaseContractError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
)
from venfour.package_assessment import canonical_package_digest
from test_case_claim_access import resume_row
from test_customer_delivery import (
    ACCESS_TOKEN, CASE_ID, CLIENT_REQUEST_ID, COMMUNICATION_ID, DRAFT_ID,
    MESSAGE_VERSION_ID, NOW, REPORT_ID, ROUND_ID, SENT_VERSION_ID, USER_ID,
    RecordingGateway, draft_projection, valid_report,
)
from test_insurer_response_decision import (
    DECISION_ID, RESULT_ID, DecisionGateway, decision_request,
)


def follow_up_projection(state="draft"):
    draft = {**draft_projection(), "purpose": "follow_up_reconsideration", "body": "Thank you for your response. Please explain the mileage adjustment."}
    return {
        "state": state, "decisionId": DECISION_ID, "responseId": COMMUNICATION_ID,
        "analysisResultId": RESULT_ID, "reportVersionId": REPORT_ID,
        "draft": draft if state in {"draft", "sent"} else None,
        "preparedMessage": None, "sentMessage": None,
        "reasonCode": "NO_SUPPORTED_FOLLOW_UP" if state == "unavailable" else None,
    }


def prepared_version(draft):
    return {
        "messageVersionId": MESSAGE_VERSION_ID, "versionNumber": 1,
        "state": "prepared", "reportVersionId": REPORT_ID,
        **{key: draft[key] for key in ("recipient", "subject", "body")},
        "createdAt": NOW,
    }


class FollowUpGateway(RecordingGateway):
    def __init__(self):
        super().__init__()
        self.followup = follow_up_projection()

    def get_total_loss_customer_follow_up(self, case_id, token):
        self.calls.append(("follow_up", (case_id, token)))
        return copy.deepcopy(self.followup)

    def resolve_total_loss_follow_up_generation_context(self, case_id, user_id, decision_id):
        return {"current": True}

    def patch_total_loss_customer_follow_up_draft(self, case_id, values, token):
        self.calls.append(("edit_follow_up", (case_id, values, token)))
        self.followup["draft"] = {
            **self.followup["draft"],
            **{key: values[key] for key in ("recipient", "subject", "body")},
            "revision": values["expectedRevision"] + 1,
        }
        return copy.deepcopy(self.followup["draft"])

    def prepare_total_loss_customer_follow_up(self, case_id, values, token):
        self.calls.append(("prepare_follow_up", (case_id, values, token)))
        return {
            "draft": copy.deepcopy(self.followup["draft"]),
            "messageVersion": prepared_version(self.followup["draft"]),
            "workflowRevision": 13,
        }

    def confirm_total_loss_customer_follow_up_sent(self, case_id, values, token):
        self.calls.append(("sent_follow_up", (case_id, values, token)))
        return {
            "state": "awaiting_insurer_response", "messageVersionId": SENT_VERSION_ID,
            "communicationId": COMMUNICATION_ID, "negotiationRoundId": ROUND_ID,
            "customerReportedSentAt": NOW, "workflowRevision": 14,
        }


class FollowUpDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.gateway = FollowUpGateway()
        self.service = CustomerDeliveryService(self.gateway)

    def test_read_does_not_create_and_cannot_replace_initial_request(self):
        result = self.service.follow_up(CASE_ID, ACCESS_TOKEN)
        self.assertEqual(result, self.gateway.followup)
        self.assertEqual(self.gateway.calls, [("authenticate", ACCESS_TOKEN), ("follow_up", (CASE_ID, ACCESS_TOKEN))])
        self.assertEqual(self.service.draft(CASE_ID, ACCESS_TOKEN), draft_projection())
        with self.assertRaises(SupabaseContractError):
            validate_message_draft(result["draft"])

    def test_generation_resumes_customer_edits_without_rebuilding(self):
        self.gateway.followup["draft"]["body"] = "Customer's saved edits"
        with patch("venfour.insurer_response_followup.build_insurer_response_followup_v1") as builder, patch.object(self.gateway, "resolve_total_loss_follow_up_generation_context", return_value={"current": True}, create=True):
            for _ in range(2):
                result = self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)
                self.assertEqual(result["draft"]["body"], "Customer's saved edits")
        builder.assert_not_called()

    def test_accept_or_changed_decision_cannot_generate(self):
        for projection in (None, {**follow_up_projection("available"), "decisionId": DRAFT_ID}):
            self.gateway.followup = projection
            with self.assertRaises(CustomerDeliveryConflictError):
                self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)

    def test_generation_binds_verified_server_context_and_atomic_store(self):
        self.gateway.followup = follow_up_projection("available")
        context = {
            "sourceIdentity": {"caseId": CASE_ID, "decisionId": DECISION_ID, "decision": "CONTINUE_CHALLENGING", "responseId": COMMUNICATION_ID, "analysisResultId": RESULT_ID, "reportId": REPORT_ID},
            "analysis": {}, "evidenceIndex": {}, "recommendation": {},
            "finalAssessment": {}, "report": {}, "initialRequest": {},
            "sendingDetails": {}, "customerOffer": None,
        }
        context["contextDigest"] = canonical_package_digest(context)
        generated = {"status": "READY", "body": "Grounded output"}
        with patch.object(self.gateway, "resolve_total_loss_follow_up_generation_context", return_value=context, create=True) as read, patch.object(self.gateway, "store_total_loss_follow_up_draft", return_value=follow_up_projection(), create=True) as store, patch("venfour.insurer_response_followup.build_insurer_response_followup_v1", return_value=generated) as builder:
            result = self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)
            read.assert_called_once_with(CASE_ID, USER_ID, DECISION_ID)
            self.assertEqual(builder.call_args.kwargs["source_identity"], context["sourceIdentity"])
            store.assert_called_once_with(CASE_ID, USER_ID, DECISION_ID, context["contextDigest"], generated)
            self.assertEqual(result["state"], "draft")
        altered = {**context, "analysis": {"changed": True}}
        with patch.object(self.gateway, "resolve_total_loss_follow_up_generation_context", return_value=altered, create=True), self.assertRaises(SupabaseContractError):
            self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)

    def test_missing_sources_conflict_and_auth_failure_never_reads_sources(self):
        self.gateway.followup = follow_up_projection("available")
        with patch.object(self.gateway, "resolve_total_loss_follow_up_generation_context", return_value=None, create=True):
            with self.assertRaises(CustomerDeliveryConflictError):
                self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)
        with patch.object(self.gateway, "authenticate", side_effect=SupabaseAuthenticationError("expired")), patch.object(self.gateway, "get_total_loss_customer_follow_up") as read, self.assertRaises(SupabaseAuthenticationError):
            self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)
        read.assert_not_called()

    def test_closed_case_rejects_generation_even_when_a_draft_or_sent_message_exists(self):
        for state in ("draft", "sent"):
            self.gateway.followup = follow_up_projection(state)
            if state == "sent":
                self.gateway.followup["sentMessage"] = {
                    **prepared_version(self.gateway.followup["draft"]), "state": "sent",
                    "customerReportedSentAt": NOW, "communicationId": COMMUNICATION_ID,
                    "negotiationRoundId": ROUND_ID,
                }
            with self.subTest(state=state), patch.object(self.gateway, "resolve_total_loss_follow_up_generation_context", return_value=None, create=True):
                with self.assertRaises(CustomerDeliveryConflictError):
                    self.service.generate_follow_up(CASE_ID, {"decisionId": DECISION_ID}, ACCESS_TOKEN)

    def test_edit_and_prepare_preserve_exact_customer_content_and_revision(self):
        values = {"draftId": DRAFT_ID, "recipient": "other@example.test", "subject": "My follow-up", "body": "My exact text\nThank you.", "expectedRevision": 1}
        saved = self.service.edit_draft(CASE_ID, values, ACCESS_TOKEN, follow_up=True)
        self.assertEqual(saved["body"], values["body"])
        prepared = self.service.prepare_follow_up(CASE_ID, {
            "draftId": DRAFT_ID, "clientRequestId": CLIENT_REQUEST_ID,
            "expectedDraftRevision": 2, "expectedWorkflowRevision": 12,
        }, ACCESS_TOKEN)
        self.assertEqual(prepared["messageVersion"]["body"], values["body"])
        self.assertEqual(self.gateway.calls[-1][1][1]["expectedDraftRevision"], 2)
        self.assertEqual(self.service.follow_up(CASE_ID, ACCESS_TOKEN)["draft"], saved)

    def test_prepare_requires_explicit_identity_and_both_revisions(self):
        valid = {"draftId": DRAFT_ID, "clientRequestId": CLIENT_REQUEST_ID, "expectedDraftRevision": 1, "expectedWorkflowRevision": 12}
        for key in valid:
            values = {k: v for k, v in valid.items() if k != key}
            with self.subTest(key=key), self.assertRaises(CustomerDeliveryInputError):
                self.service.prepare_follow_up(CASE_ID, values, ACCESS_TOKEN)
        self.assertEqual(self.gateway.calls, [])

    def test_read_and_sent_projection_reject_cross_report_and_state_mismatch(self):
        for change in (
            {"reportVersionId": DRAFT_ID}, {"state": "sent"},
            {"reasonCode": "INVENTED_REASON"}, {"storagePath": "private"},
        ):
            with self.subTest(change=change), self.assertRaises(SupabaseContractError):
                validate_follow_up_projection({**follow_up_projection(), **change})
        self.assertEqual(validate_follow_up_projection(follow_up_projection("unavailable"))["state"], "unavailable")

    def test_sent_confirmation_uses_distinct_boundary_with_attachment_attestation(self):
        values = {"messageVersionId": MESSAGE_VERSION_ID, "clientRequestId": CLIENT_REQUEST_ID, "expectedWorkflowRevision": 13, "confirmedReportAttached": True}
        result = self.service.sent(CASE_ID, values, ACCESS_TOKEN, follow_up=True)
        self.assertEqual(result["state"], "awaiting_insurer_response")
        self.assertEqual(self.gateway.calls[-1][0], "sent_follow_up")
        with self.assertRaises(CustomerDeliveryInputError):
            self.service.sent(CASE_ID, {**values, "confirmedReportAttached": False}, ACCESS_TOKEN, follow_up=True)

    def test_resume_preserves_decision_analysis_and_original_draft_before_and_after_send(self):
        decision_gateway = DecisionGateway()
        response = decision_gateway.record_total_loss_insurer_response_decision(CASE_ID, COMMUNICATION_ID, decision_request("CONTINUE_CHALLENGING"), ACCESS_TOKEN)["response"]
        initial = draft_projection()
        for task in ("follow_up_preparation", "awaiting_insurer_response"):
            followup = follow_up_projection()
            if task == "awaiting_insurer_response":
                followup["state"] = "sent"
                followup["sentMessage"] = {
                    **prepared_version(followup["draft"]), "state": "sent",
                    "customerReportedSentAt": NOW, "communicationId": COMMUNICATION_ID,
                    "negotiationRoundId": ROUND_ID,
                }
            row = {
                **resume_row("secured"), "workflow_phase": "negotiation",
                "workflow_current_task": task, "workflow_revision": 14,
                "checkout_available": False, "next_task": task,
                "customer_journey": {"nextState": task, "fulfillmentState": task, "retryable": False},
                "published_report": valid_report(), "message_draft": initial,
                "insurer_response": response, "follow_up": followup,
            }
            result = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
            self.assertEqual(result["messageDraft"], initial)
            self.assertEqual(result["insurerResponse"], response)
            self.assertEqual(result["followUp"], followup)
            with self.assertRaises(SupabaseContractError):
                CaseClaimAccessService._resume_state({**row, "follow_up": {**followup, "decisionId": DRAFT_ID}}, CASE_ID)


class FollowUpApiTests(unittest.TestCase):
    def setUp(self):
        self.gateway = FollowUpGateway()
        with patch.dict(os.environ, {}, clear=True):
            self.client = TestClient(create_app(customer_delivery_service=CustomerDeliveryService(self.gateway), enable_legacy_api=False))
        self.path = f"/api/v1/appraisal-cases/{CASE_ID}/follow-up"
        self.headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}

    def tearDown(self):
        self.client.close()

    def test_read_requires_auth_and_is_private(self):
        self.assertEqual(self.client.get(self.path).status_code, 401)
        result = self.client.get(self.path, headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertIn("no-store", result.headers["cache-control"])
        self.assertEqual(result.json(), self.gateway.followup)

    def test_edit_and_prepare_forward_exact_revision_and_report_conflicts(self):
        saved = self.client.patch(self.path + "/draft", headers=self.headers, json={"draftId": DRAFT_ID, "recipient": "adjuster@example.test", "subject": "Follow-up", "body": "Edited text", "expectedRevision": 1})
        self.assertEqual(saved.status_code, 200)
        values = {"draftId": DRAFT_ID, "clientRequestId": CLIENT_REQUEST_ID, "expectedDraftRevision": 2, "expectedWorkflowRevision": 12}
        self.assertEqual(self.client.post(self.path + "/prepare", headers=self.headers, json=values).status_code, 200)
        with patch.object(self.gateway, "prepare_total_loss_customer_follow_up", side_effect=SupabaseConflictError("Stale draft")):
            result = self.client.post(self.path + "/prepare", headers=self.headers, json=values)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json()["error"]["code"], "CUSTOMER_DELIVERY_CONFLICT")

    def test_generation_rejects_client_supplied_evidence(self):
        result = self.client.post(self.path, headers=self.headers, json={"decisionId": DECISION_ID, "body": "Invented"})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.gateway.calls, [])

    def test_generation_requires_continue_and_resumes_existing_draft(self):
        self.assertEqual(self.client.post(self.path, json={"decisionId": DECISION_ID}).status_code, 401)
        result = self.client.post(self.path, headers=self.headers, json={"decisionId": DECISION_ID})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), self.gateway.followup)
        self.gateway.followup = None
        self.assertEqual(self.client.post(self.path, headers=self.headers, json={"decisionId": DECISION_ID}).status_code, 409)


class FollowUpGatewayTests(unittest.TestCase):
    def test_generation_service_rpc_is_bound_to_authenticated_user_and_context_digest(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"test": True})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            gateway = SupabaseHttpGateway(SupabaseServerConfiguration("http://127.0.0.1:54321", "publishable-test", "service-test"), client=client)
            gateway.resolve_total_loss_follow_up_generation_context(CASE_ID, USER_ID, DECISION_ID)
            gateway.store_total_loss_follow_up_draft(CASE_ID, USER_ID, DECISION_ID, "a" * 64, {"status": "READY"})
        self.assertEqual(json.loads(requests[0].content), {"requested_case_id": CASE_ID, "requested_user_id": USER_ID, "requested_decision_id": DECISION_ID})
        self.assertEqual(json.loads(requests[1].content)["expected_context_digest"], "a" * 64)
        for request in requests:
            self.assertEqual(request.headers["authorization"], "Bearer service-test")

    def test_user_mutations_forward_fences_under_owner_authority(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"test": True})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            gateway = SupabaseHttpGateway(SupabaseServerConfiguration("http://127.0.0.1:54321", "publishable-test", "service-test"), client=client)
            gateway.patch_total_loss_customer_follow_up_draft(CASE_ID, {"draftId": DRAFT_ID, "recipient": "adjuster@example.test", "subject": "Follow-up", "body": "Exact", "expectedRevision": 7}, ACCESS_TOKEN)
            gateway.prepare_total_loss_customer_follow_up(CASE_ID, {"draftId": DRAFT_ID, "clientRequestId": CLIENT_REQUEST_ID, "expectedDraftRevision": 8, "expectedWorkflowRevision": 12}, ACCESS_TOKEN)
        self.assertEqual(json.loads(requests[0].content)["requested_draft_id"], DRAFT_ID)
        self.assertEqual(json.loads(requests[1].content)["expected_revision"], 8)
        self.assertEqual(json.loads(requests[1].content)["expected_workflow_revision"], 12)
        for request in requests:
            self.assertEqual(request.headers["authorization"], f"Bearer {ACCESS_TOKEN}")


if __name__ == "__main__":
    unittest.main()
