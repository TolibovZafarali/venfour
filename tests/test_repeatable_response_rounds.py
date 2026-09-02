"""Repeatable response projection, immutable history, and worker source isolation."""

from __future__ import annotations

import copy
import unittest

from test_case_claim_access import resume_row
from test_customer_delivery import CASE_ID, NOW, REPORT_ID, valid_report
from test_follow_up_delivery import follow_up_projection
from test_insurer_response_decision import completed_response
from test_insurer_response_processing import (
    CASE_ID as PROCESSING_CASE_ID, _Analyzer, _Database, _analysis_context, _processor,
)
from venfour.case_claim_access import CaseClaimAccessService
from venfour.customer_delivery import validate_negotiation_history
from venfour.supabase_gateway import SupabaseContractError


def identity(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


def sent_message(round_number: int, number: int) -> dict:
    return {
        "messageVersionId": identity(number + 1), "versionNumber": 1,
        "state": "sent", "reportVersionId": REPORT_ID,
        "recipient": "adjuster@example.test", "subject": "Review the valuation",
        "body": f"Please review this saved request {number}.", "createdAt": NOW,
        "customerReportedSentAt": NOW, "communicationId": identity(number),
        "negotiationRoundId": identity(round_number),
    }


class RepeatableResponseRoundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.response_template = completed_response()[0]

    def history(self):
        history = []
        outbound = sent_message(1, 100)
        for number in range(1, 4):
            response = copy.deepcopy(self.response_template)
            response.update({
                "responseId": identity(number * 1000),
                "clientRequestId": identity(number * 1000 + 1),
                "negotiationRoundId": identity(number),
                "outboundCommunicationId": outbound["communicationId"],
                "canCorrect": number == 3,
            })
            response["recommendation"].update({
                "recommendationId": identity(number * 1000 + 2),
                "analysisResultId": identity(number * 1000 + 3),
            })
            response["usableOffer"]["offerId"] = identity(number * 1000 + 4)
            if number < 3:
                response["decision"] = {
                    "decisionId": identity(number * 1000 + 5),
                    "clientRequestId": identity(number * 1000 + 6),
                    "recommendationId": response["recommendation"]["recommendationId"],
                    "analysisResultId": response["recommendation"]["analysisResultId"],
                    "choice": "CONTINUE_CHALLENGING", "offerId": None,
                    "amountMinorUnits": None, "currency": None, "recordedAt": NOW,
                }
            follow_up = sent_message(number, number * 1000 + 100) if number < 3 else None
            history.append({
                "negotiationRoundId": identity(number), "roundNumber": number,
                "outbound": outbound, "responses": [response], "followUp": follow_up,
            })
            outbound = follow_up
        return history

    def resume(self, history):
        return {
            **resume_row("secured"), "workflow_phase": "negotiation",
            "workflow_current_task": "insurer_response_reviewed", "workflow_revision": 31,
            "checkout_available": False, "next_task": "insurer_response_reviewed",
            "customer_journey": {
                "nextState": "insurer_response_reviewed",
                "fulfillmentState": "insurer_response_reviewed", "retryable": False,
            },
            "published_report": valid_report(),
            "insurer_response": history[-1]["responses"][-1],
            "negotiation_history": history, "response_intake": None,
        }

    def test_three_rounds_have_independent_decisions_and_revisitable_history(self):
        history = self.history()
        original = copy.deepcopy(history)
        row = self.resume(history)
        first = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
        for historical_round in first["negotiationHistory"]:
            self.assertEqual(historical_round["responses"][0]["negotiationRoundId"], historical_round["negotiationRoundId"])
        second = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
        self.assertEqual(first, second)
        self.assertEqual(history, original)
        self.assertEqual(second["workflow"]["currentTask"], "insurer_response_reviewed")
        self.assertIsNone(second["insurerResponse"]["decision"])
        self.assertEqual(len({entry["responses"][0]["recommendation"]["analysisResultId"] for entry in history}), 3)
        self.assertEqual(len({entry["responses"][0]["usableOffer"]["offerId"] for entry in history}), 3)

    def test_corrections_retain_their_original_round_and_outbound(self):
        for round_index in (0, 1):
            with self.subTest(round_index=round_index):
                history = self.history()
                response = history[round_index]["responses"][0]
                corrected = copy.deepcopy(response)
                corrected["responseId"] = identity(9000 + round_index)
                corrected["clientRequestId"] = identity(9100 + round_index)
                corrected["supersedesResponseId"] = response["responseId"]
                history[round_index]["responses"].append(corrected)
                validated = validate_negotiation_history(history)
                self.assertEqual(len(validated), 3)
                self.assertEqual(validated[round_index]["responses"][1]["outboundCommunicationId"], response["outboundCommunicationId"])
                corrected["negotiationRoundId"] = history[2]["negotiationRoundId"]
                with self.assertRaises(SupabaseContractError):
                    validate_negotiation_history(history)

    def test_cross_round_sources_and_old_current_response_are_rejected(self):
        for mutation in ("outbound", "response", "decision", "correction"):
            with self.subTest(mutation=mutation):
                history = self.history()
                response = history[2]["responses"][0]
                if mutation == "outbound":
                    history[2]["outbound"] = history[0]["outbound"]
                elif mutation == "response":
                    response["outboundCommunicationId"] = history[0]["outbound"]["communicationId"]
                elif mutation == "decision":
                    response["decision"] = history[0]["responses"][0]["decision"]
                else:
                    response["supersedesResponseId"] = history[0]["responses"][0]["responseId"]
                with self.assertRaises(SupabaseContractError):
                    validate_negotiation_history(history)
        history = self.history()
        row = self.resume(history)
        row["insurer_response"] = history[0]["responses"][0]
        with self.assertRaises(SupabaseContractError):
            CaseClaimAccessService._resume_state(row, CASE_ID)

    def test_intake_cannot_resume_from_a_reviewed_response_or_accept(self):
        history = self.history()
        row = self.resume(history)
        row["response_intake"] = {
            "negotiationRoundId": history[-1]["negotiationRoundId"],
            "outboundCommunicationId": history[-1]["outbound"]["communicationId"],
        }
        with self.assertRaises(SupabaseContractError):
            CaseClaimAccessService._resume_state(row, CASE_ID)
        response = row["insurer_response"]
        response["decision"] = {
            "decisionId": identity(9200), "clientRequestId": identity(9201),
            "recommendationId": response["recommendation"]["recommendationId"],
            "analysisResultId": response["recommendation"]["analysisResultId"],
            "choice": "ACCEPT_OFFER", "recordedAt": NOW,
            **{key: response["usableOffer"][key] for key in ("offerId", "amountMinorUnits", "currency")},
        }
        with self.assertRaises(SupabaseContractError):
            CaseClaimAccessService._resume_state(row, CASE_ID)

    def test_waiting_after_three_responses_identifies_only_the_latest_sent_followup(self):
        history = self.history()
        current_round = history[-1]
        response = current_round["responses"][0]
        response["canCorrect"] = False
        response["decision"] = {
            **copy.deepcopy(history[1]["responses"][0]["decision"]),
            "decisionId": identity(9500), "clientRequestId": identity(9501),
            "recommendationId": response["recommendation"]["recommendationId"],
            "analysisResultId": response["recommendation"]["analysisResultId"],
        }
        current_round["followUp"] = sent_message(3, 9600)
        follow_up = follow_up_projection("sent")
        follow_up.update({
            "responseId": response["responseId"],
            "decisionId": response["decision"]["decisionId"],
            "analysisResultId": response["decision"]["analysisResultId"],
            "sentMessage": current_round["followUp"],
        })
        row = self.resume(history)
        row.update({
            "workflow_current_task": "awaiting_insurer_response",
            "next_task": "awaiting_insurer_response", "follow_up": follow_up,
            "customer_journey": {
                "nextState": "awaiting_insurer_response",
                "fulfillmentState": "awaiting_insurer_response", "retryable": False,
            },
            "response_intake": {
                "negotiationRoundId": current_round["negotiationRoundId"],
                "outboundCommunicationId": current_round["followUp"]["communicationId"],
            },
        })
        resolved = CaseClaimAccessService._resume_state(row, CASE_ID).to_dict()
        self.assertEqual(resolved["responseIntake"], row["response_intake"])
        self.assertEqual(len(resolved["negotiationHistory"]), 3)
        row["response_intake"]["outboundCommunicationId"] = history[0]["outbound"]["communicationId"]
        with self.assertRaisesRegex(SupabaseContractError, "intake lineage"):
            CaseClaimAccessService._resume_state(row, CASE_ID)

    def test_three_analysis_executions_do_not_mix_answered_messages_or_responses(self):
        frozen_evidence = []
        for number in range(1, 4):
            context = _analysis_context(response_text=f"This is insurer reply number {number}.")
            context["journey"]["negotiationRoundNumber"] = number
            context["customerRequest"]["body"] = f"Please review the evidence in request number {number}."
            analyzer = _Analyzer()
            database = _Database(context=context)
            execution = _processor(database, analyzer).execute(PROCESSING_CASE_ID)
            self.assertEqual(execution.state, "completed")
            request = analyzer.requests[0][0].to_dict()
            self.assertEqual(request["customerRequest"]["body"], context["customerRequest"]["body"])
            self.assertEqual(request["responseMaterials"][0]["content"], context["insurerResponse"]["text"])
            frozen_evidence.append(copy.deepcopy(database.completed[12]))
        self.assertEqual(len({entry["responseEvidence"][0]["evidenceRef"] for entry in frozen_evidence}), 3)
        customer_refs = [{item["evidenceRef"] for item in entry["caseEvidence"] if item["evidenceType"] == "CUSTOMER_REQUEST"} for entry in frozen_evidence]
        self.assertTrue(all(left.isdisjoint(right) for index, left in enumerate(customer_refs) for right in customer_refs[index + 1:]))


if __name__ == "__main__":
    unittest.main()
