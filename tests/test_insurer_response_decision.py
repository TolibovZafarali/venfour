"""Offline transport, projection, and explicit recommendation-backfill coverage."""

from __future__ import annotations

import copy
import json
import os
import unittest
from typing import Any
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from scripts.backfill_insurer_response_recommendation import require_local_configuration
from tests.test_customer_delivery import (
    ACCESS_TOKEN, CASE_ID, CLIENT_REQUEST_ID, COMMUNICATION_ID, NOW, RecordingGateway,
)
from tests.test_insurer_response_processing import (
    CASE_ID as PROCESSING_CASE_ID, _Analyzer, _Database, _processor,
)
from venfour.api import create_app
from venfour.customer_delivery import (
    CustomerDeliveryInputError, CustomerDeliveryService, validate_insurer_response_projection,
)
from venfour.insurer_response_processing import backfill_current_insurer_response_recommendation
from venfour.package_assessment import canonical_package_digest
from venfour.supabase_gateway import (
    SupabaseAuthenticationError, SupabaseConflictError, SupabaseContractError,
    SupabaseHttpGateway, SupabaseServerConfiguration,
)


RECOMMENDATION_ID = "a0000000-0000-4000-8000-000000000001"
RESULT_ID = "a0000000-0000-4000-8000-000000000002"
OFFER_ID = "a0000000-0000-4000-8000-000000000003"
DECISION_ID = "a0000000-0000-4000-8000-000000000004"
OTHER_ID = "a0000000-0000-4000-8000-000000000005"


def completed_response() -> tuple[dict[str, Any], dict[str, Any]]:
    database = _Database()
    execution = _processor(database, _Analyzer()).execute(PROCESSING_CASE_ID)
    assert execution.state == "completed" and database.completed is not None
    completion = database.completed
    recommendation = completion[14]
    response = {
        "responseId": COMMUNICATION_ID,
        "canCorrect": True,
        "negotiationRoundId": "90000000-0000-4000-8000-000000000009",
        "outboundCommunicationId": "82000000-0000-4000-8000-000000000008",
        "clientRequestId": CLIENT_REQUEST_ID,
        "receivedAt": NOW,
        "sourceType": "pasted_message",
        "text": "We revised the offer to $20,100.00.",
        "document": None,
        "revisedOffer": {"amountMinorUnits": 2_010_000, "currency": "USD"},
        "processingState": "completed",
        "failureReason": None,
        "supersedesResponseId": None,
        "analysis": completion[5],
        "analysisEvidence": completion[12],
        "recommendation": {
            **{key: value for key, value in recommendation.items() if key not in {"offer", "policyInput"}},
            "recommendationId": RECOMMENDATION_ID,
            "versionNumber": 1,
            "analysisResultId": RESULT_ID,
        },
        "usableOffer": {"offerId": OFFER_ID, **recommendation["offer"]},
        "decision": None,
    }
    context = {
        "analysis_result_id": RESULT_ID,
        "response_id": COMMUNICATION_ID,
        "analysis_result": completion[5],
        "evidence_index": completion[12],
        "final_assessment": None,
        "assessment_digest": "a" * 64,
        "customer_offer": {"offerId": OFFER_ID, "amountMinorUnits": 2_010_000, "currency": "USD", "sourceCommunicationId": COMMUNICATION_ID},
        "recommendation_id": None,
    }
    return response, context


def decision_request(choice: str = "ACCEPT_OFFER") -> dict[str, Any]:
    return {
        "clientRequestId": CLIENT_REQUEST_ID,
        "recommendationId": RECOMMENDATION_ID,
        "choice": choice,
        "offerId": OFFER_ID if choice == "ACCEPT_OFFER" else None,
        "workflowRevision": 12,
    }


class DecisionGateway(RecordingGateway):
    def __init__(self) -> None:
        super().__init__()
        self.response, _ = completed_response()
        self.error: Exception | None = None

    def record_total_loss_insurer_response_decision(self, case_id, response_id, values, token):
        self.calls.append(("decision", (case_id, response_id, dict(values), token)))
        if self.error is not None:
            raise self.error
        offer = self.response["usableOffer"] if values["choice"] == "ACCEPT_OFFER" else None
        self.response["decision"] = {
            "decisionId": DECISION_ID,
            "clientRequestId": values["clientRequestId"],
            "recommendationId": values["recommendationId"],
            "analysisResultId": RESULT_ID,
            "choice": values["choice"],
            "offerId": offer["offerId"] if offer else None,
            "amountMinorUnits": offer["amountMinorUnits"] if offer else None,
            "currency": offer["currency"] if offer else None,
            "recordedAt": NOW,
        }
        return {"state": "insurer_response_reviewed", "response": copy.deepcopy(self.response), "workflowRevision": 13}


class ResponseDecisionContractTests(unittest.TestCase):
    def test_viewing_recommendation_never_records_a_decision(self):
        response, _ = completed_response()
        before = copy.deepcopy(response)
        for _ in range(2):
            self.assertIsNone(validate_insurer_response_projection(response)["decision"])
        self.assertEqual(response, before)

    def test_accept_binds_exact_stored_offer_and_preserves_recommendation(self):
        gateway = DecisionGateway()
        gateway.response["recommendation"]["state"] = "CONTINUE_CHALLENGING"
        original = copy.deepcopy(gateway.response["recommendation"])
        result = CustomerDeliveryService(gateway).record_response_decision(CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN)
        self.assertEqual(result["state"], "insurer_response_reviewed")
        self.assertEqual(result["response"]["recommendation"], original)
        self.assertEqual(result["response"]["decision"]["offerId"], OFFER_ID)
        self.assertEqual(result["response"]["decision"]["amountMinorUnits"], 2_010_000)
        self.assertEqual(gateway.calls, [("authenticate", ACCESS_TOKEN), ("decision", (CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN))])

    def test_prior_policy_neutral_projection_preserves_recorded_choice_and_offer(self):
        gateway = DecisionGateway()
        response = gateway.record_total_loss_insurer_response_decision(
            CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN,
        )["response"]
        response["recommendation"].update({
            "policyVersion": "1", "state": "NO_CLEAR_RECOMMENDATION",
            "reasonCodes": ["SAVED_RECOMMENDATION_POLICY_SUPERSEDED"],
            "reasons": ["The saved advice predates the corrected assessment policy."],
        })
        before = copy.deepcopy(response)
        actual = validate_insurer_response_projection(response)
        self.assertEqual(actual["recommendation"]["state"], "NO_CLEAR_RECOMMENDATION")
        self.assertEqual(actual["decision"]["choice"], "ACCEPT_OFFER")
        self.assertEqual(actual["usableOffer"]["offerId"], OFFER_ID)
        self.assertEqual(response, before)

    def test_unsupported_strong_advice_fails_closed_at_public_projection(self):
        for version, state in (("1", "ACCEPT_OFFER"), ("1", "CONTINUE_CHALLENGING"), ("2", "ACCEPT_OFFER")):
            with self.subTest(version=version, state=state):
                response, _ = completed_response()
                response["recommendation"].update({"policyVersion": version, "state": state})
                with self.assertRaises(SupabaseContractError):
                    validate_insurer_response_projection(response)

    def test_continue_is_explicit_and_does_not_accept_or_advance(self):
        gateway = DecisionGateway()
        result = CustomerDeliveryService(gateway).record_response_decision(CASE_ID, COMMUNICATION_ID, decision_request("CONTINUE_CHALLENGING"), ACCESS_TOKEN)
        self.assertEqual(result["state"], "insurer_response_reviewed")
        self.assertEqual(result["response"]["decision"]["choice"], "CONTINUE_CHALLENGING")
        for key in ("offerId", "amountMinorUnits", "currency"):
            self.assertIsNone(result["response"]["decision"][key])

    def test_accept_and_continue_retries_forward_identical_request_identity(self):
        for choice in ("ACCEPT_OFFER", "CONTINUE_CHALLENGING"):
            with self.subTest(choice=choice):
                gateway = DecisionGateway()
                service = CustomerDeliveryService(gateway)
                values = decision_request(choice)
                first = service.record_response_decision(CASE_ID, COMMUNICATION_ID, values, ACCESS_TOKEN)
                repeated = service.record_response_decision(CASE_ID, COMMUNICATION_ID, values, ACCESS_TOKEN)
                self.assertEqual(first, repeated)
                self.assertEqual(gateway.calls[1], gateway.calls[3])

    def test_no_offer_still_allows_continue_with_neutral_recommendation(self):
        gateway = DecisionGateway()
        gateway.response["usableOffer"] = None
        result = CustomerDeliveryService(gateway).record_response_decision(CASE_ID, COMMUNICATION_ID, decision_request("CONTINUE_CHALLENGING"), ACCESS_TOKEN)
        self.assertEqual(result["response"]["recommendation"]["state"], "NO_CLEAR_RECOMMENDATION")

    def test_invalid_decision_input_fails_before_auth_or_database(self):
        for changes in (
            {"choice": "CLOSE_CASE"}, {"choice": []}, {"offerId": None},
            {"recommendationId": OTHER_ID.upper()}, {"workflowRevision": True},
            {"workflowRevision": 0}, {"amountMinorUnits": 1},
            {"choice": "CONTINUE_CHALLENGING", "offerId": OFFER_ID},
        ):
            with self.subTest(changes=changes):
                gateway = DecisionGateway()
                with self.assertRaises(CustomerDeliveryInputError):
                    CustomerDeliveryService(gateway).record_response_decision(CASE_ID, COMMUNICATION_ID, {**decision_request(), **changes}, ACCESS_TOKEN)
                self.assertEqual(gateway.calls, [])

    def test_projection_rejects_stale_lineage_or_rebound_offer(self):
        gateway = DecisionGateway()
        result = CustomerDeliveryService(gateway).record_response_decision(CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN)
        for scope, key, value in (
            ("decision", "offerId", OTHER_ID),
            ("decision", "amountMinorUnits", 1),
            ("decision", "analysisResultId", OTHER_ID),
            ("decision", "recommendationId", OTHER_ID),
            ("usableOffer", "amountMinorUnits", 1),
            ("recommendation", "policyInput", {}),
            ("recommendation", "policyVersion", "3"),
            ("recommendation", "responseEvidenceRefs", ["response_" + "f" * 64]),
        ):
            with self.subTest(scope=scope, key=key):
                response = copy.deepcopy(result["response"])
                response[scope][key] = value
                with self.assertRaises(SupabaseContractError):
                    validate_insurer_response_projection(response)

    def test_incomplete_or_unanalyzed_response_cannot_expose_recommendation(self):
        original, _ = completed_response()
        for overrides in (
            {"recommendation": None},
            {"processingState": "pending"},
            {"recommendation": {**original["recommendation"], "state": "ACCEPT_OFFER"}, "usableOffer": None},
        ):
            with self.subTest(overrides=overrides):
                with self.assertRaises(SupabaseContractError):
                    validate_insurer_response_projection({**original, **overrides})

    def test_acknowledgment_must_match_explicit_click(self):
        class WrongAcknowledgment(DecisionGateway):
            def record_total_loss_insurer_response_decision(self, *args):
                result = super().record_total_loss_insurer_response_decision(*args)
                result["response"]["decision"]["clientRequestId"] = OTHER_ID
                return result
        with self.assertRaisesRegex(SupabaseContractError, "acknowledgement"):
            CustomerDeliveryService(WrongAcknowledgment()).record_response_decision(CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN)


class ResponseDecisionHttpTests(unittest.TestCase):
    def setUp(self):
        self.gateway = DecisionGateway()
        with patch.dict(os.environ, {}, clear=True):
            self.client = TestClient(create_app(customer_delivery_service=CustomerDeliveryService(self.gateway), enable_legacy_api=False))
        self.path = f"/api/v1/appraisal-cases/{CASE_ID}/claim/insurer-responses/{COMMUNICATION_ID}/decision"
        self.headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}

    def tearDown(self):
        self.client.close()

    def test_authenticated_post_records_choice_without_processing_or_closure(self):
        response = self.client.post(self.path, json=decision_request(), headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "insurer_response_reviewed")
        self.assertIn("no-store", response.headers["cache-control"])

    def test_missing_auth_and_get_never_write(self):
        self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 405)
        self.assertEqual(self.client.post(self.path, json=decision_request()).status_code, 401)
        self.assertEqual(self.gateway.calls, [])

    def test_untrusted_amount_extra_keys_and_bad_identity_are_rejected(self):
        for payload in ({**decision_request(), "amountMinorUnits": 123}, {**decision_request(), "offerId": None}):
            response = self.client.post(self.path, json=payload, headers=self.headers)
            self.assertEqual(response.status_code, 400)
            self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(self.client.post(self.path.replace(COMMUNICATION_ID, "invalid"), json=decision_request(), headers=self.headers).status_code, 400)
        self.assertEqual(self.gateway.calls, [])

    def test_ownership_entitlement_and_stale_source_fail_closed(self):
        for error, status in ((SupabaseAuthenticationError("unavailable"), 401), (SupabaseConflictError("unavailable"), 409)):
            with self.subTest(status=status):
                self.gateway.error = error
                response = self.client.post(self.path, json=decision_request(), headers=self.headers)
                self.assertEqual(response.status_code, status)
                self.assertIn("no-store", response.headers["cache-control"])


class BackfillDatabase:
    def __init__(self):
        _, self.context = completed_response()
        self.calls: list[Any] = []
        self.outcome = "published"

    def resolve_current_total_loss_insurer_response_recommendation_context(self, case_id):
        self.calls.append(("context", case_id))
        return copy.deepcopy(self.context)

    def publish_total_loss_insurer_response_recommendation(self, result_id, recommendation, digest):
        self.calls.append(("publish", result_id, copy.deepcopy(recommendation), digest))
        if self.outcome == "published":
            self.context["recommendation_id"] = RECOMMENDATION_ID
        return {"outcome": self.outcome, "recommendationId": RECOMMENDATION_ID if self.outcome != "superseded" else None, "workflowRevision": 13}


class ResponseRecommendationBackfillTests(unittest.TestCase):
    def test_preview_reads_frozen_sources_and_never_writes(self):
        database = BackfillDatabase()
        result = backfill_current_insurer_response_recommendation(database, CASE_ID)
        self.assertEqual(result["outcome"], "ready")
        self.assertEqual(result["recommendation"]["state"], "NO_CLEAR_RECOMMENDATION")
        self.assertEqual(database.calls, [("context", CASE_ID)])

    def test_explicit_publish_and_repeat_do_not_rerun_response_analysis(self):
        database = BackfillDatabase()
        result = backfill_current_insurer_response_recommendation(database, CASE_ID, apply=True)
        self.assertEqual(result["outcome"], "published")
        call = database.calls[1]
        self.assertEqual(call[1], RESULT_ID)
        self.assertEqual(call[3], canonical_package_digest(call[2]))
        repeat = backfill_current_insurer_response_recommendation(database, CASE_ID, apply=True)
        self.assertEqual(repeat["outcome"], "already_published")
        self.assertEqual(len([call for call in database.calls if call[0] == "publish"]), 1)

    def test_correction_race_is_reported_without_a_customer_choice(self):
        database = BackfillDatabase()
        database.outcome = "superseded"
        result = backfill_current_insurer_response_recommendation(database, CASE_ID, apply=True)
        self.assertEqual(result["outcome"], "superseded")
        self.assertIsNone(result["recommendationId"])
        self.assertNotIn("decision", database.calls[1][2])

    def test_missing_current_completed_result_is_read_only(self):
        database = BackfillDatabase()
        database.context = None
        self.assertEqual(backfill_current_insurer_response_recommendation(database, CASE_ID, apply=True), {"outcome": "not_found"})
        self.assertEqual(database.calls, [("context", CASE_ID)])

    def test_backfill_cli_forbids_remote_or_deployed_configuration(self):
        for environment in (
            {"SUPABASE_URL": "https://example.supabase.co"},
            {"SUPABASE_URL": "http://127.0.0.1:54321", "K_SERVICE": "service"},
            {"SUPABASE_URL": "http://127.0.0.1:54321?remote=true"},
            {"SUPABASE_URL": "http://localhost:54322"},
        ):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True), self.assertRaises(ValueError):
                require_local_configuration()


class ResponseDecisionGatewayTests(unittest.TestCase):
    def test_completion_sends_analysis_and_recommendation_atomically(self):
        database = _Database()
        self.assertEqual(_processor(database, _Analyzer()).execute(PROCESSING_CASE_ID).state, "completed")
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json=[{"outcome": "completed", "status": "completed", "workflow_revision": 13}])
        client = httpx.Client(transport=httpx.MockTransport(handler))
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration("http://127.0.0.1:54321", "publishable-test", "service-test"), client=client)
        try:
            result = gateway.complete_total_loss_insurer_response_analysis(*database.completed)
        finally:
            gateway.close()
            client.close()
        self.assertEqual(result["outcome"], "completed")
        self.assertEqual(len(requests), 1)
        self.assertTrue(requests[0].url.path.endswith("complete_total_loss_response_analysis_with_recommendation"))
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["requested_recommendation"], database.completed[14])
        self.assertEqual(payload["requested_recommendation_digest"], canonical_package_digest(payload["requested_recommendation"]))
        self.assertEqual(payload["requested_result_digest"], canonical_package_digest(payload["requested_result"]))
        self.assertEqual(requests[0].headers["authorization"], "Bearer service-test")

    def test_owner_write_and_service_publication_use_separate_authority(self):
        requests = []
        def handler(request):
            requests.append(request)
            if request.url.path.endswith("resolve_current_total_loss_response_recommendation_context"):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json={"outcome": "test"})
        client = httpx.Client(transport=httpx.MockTransport(handler))
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration("http://127.0.0.1:54321", "publishable-test", "service-test"), client=client)
        try:
            gateway.record_total_loss_insurer_response_decision(CASE_ID, COMMUNICATION_ID, decision_request(), ACCESS_TOKEN)
            self.assertIsNone(gateway.resolve_current_total_loss_insurer_response_recommendation_context(CASE_ID))
            gateway.publish_total_loss_insurer_response_recommendation(RESULT_ID, {"example": True}, "a" * 64)
        finally:
            gateway.close()
            client.close()
        self.assertEqual(json.loads(requests[0].content), {
            "requested_case_id": CASE_ID, "requested_response_id": COMMUNICATION_ID,
            "requested_client_request_id": CLIENT_REQUEST_ID, "requested_recommendation_id": RECOMMENDATION_ID,
            "requested_choice": "ACCEPT_OFFER", "requested_offer_id": OFFER_ID, "expected_workflow_revision": 12,
        })
        self.assertEqual(requests[0].headers["authorization"], f"Bearer {ACCESS_TOKEN}")
        for request in requests[1:]:
            self.assertEqual(request.headers["authorization"], "Bearer service-test")


if __name__ == "__main__":
    unittest.main()
