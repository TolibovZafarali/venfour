from __future__ import annotations

import copy
import unittest

from tests import test_analysis_runs as runs_fixture
from tests import test_insurer_response_analysis as analysis_fixture
from tests import test_insurer_response_processing as processing_fixture
from tests import test_package_assessment as package_fixture
from venfour.insurer_response_analysis import VISUAL_OFFER_UNCERTAINTY_DESCRIPTION
from venfour.insurer_response_followup import (
    INSURER_RESPONSE_FOLLOWUP_TEMPLATE_VERSION,
    build_insurer_response_followup_v1,
)
from venfour.insurer_response_processing import (
    _allowlisted_context, _analysis_evidence_index, _analysis_input,
)
from venfour.insurer_response_recommendation import build_insurer_response_recommendation_v1
from venfour.package_assessment import (
    build_final_valuation_assessment_v1, canonical_package_digest,
)
from venfour.valuation_evidence_report import build_valuation_evidence_report_v1


def _uuid(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


class InsurerResponseFollowupTests(
    analysis_fixture.InsurerResponseAnalysisFixture,
    runs_fixture.TemporaryRepositoryTestCase,
):
    _assessment_template = None
    _source_template = None

    def setUp(self) -> None:
        analysis_fixture.InsurerResponseAnalysisFixture.setUp(self)
        if self.__class__._assessment_template is None:
            runs_fixture.TemporaryRepositoryTestCase.setUp(self)
            source = package_fixture.PackageAssessmentTests._source(self)[3]
            self.__class__._source_template = source.to_dict()
            self.__class__._assessment_template = build_final_valuation_assessment_v1(source).to_dict()
        self.assessment = copy.deepcopy(self.__class__._assessment_template)

    def _inputs(self, *, amount=None, response_text=None, manual=False):
        assessment = copy.deepcopy(self.assessment)
        if manual:
            assessment["insurerValuationReviewed"]["source"] = "CUSTOMER_SUPPLIED"
            assessment["insurerComparables"]["rows"] = []
            assessment["findings"] = [
                row for row in assessment["findings"] if not row["code"].startswith("CCC_ADJUSTMENTS_")
            ]
            assessment["assessmentDigest"] = canonical_package_digest({
                key: value for key, value in assessment.items() if key != "assessmentDigest"
            })
        if amount is None:
            amount = assessment["insurerValuationReviewed"]["valueMinorUnits"]
        text = response_text or (
            "We are maintaining the comparable selection. "
            f"The vehicle valuation amount is ${amount // 100:,}.{amount % 100:02d}."
        )
        context = processing_fixture._analysis_context()
        context["vehicle"].update({
            "year": assessment["subjectVehicle"]["year"],
            "make": assessment["subjectVehicle"]["make"],
            "model": assessment["subjectVehicle"]["model"],
            "trim": assessment["subjectVehicle"]["trim"],
            "mileageAtLoss": assessment["subjectVehicle"]["mileage"],
        })
        context["insurer"]["originalOffer"] = {
            "amountMinorUnits": assessment["insurerValuationReviewed"]["valueMinorUnits"], "currency": "USD",
        }
        context["venfourAssessment"].update({
            "conclusionCode": assessment["finalClassification"],
            "supportedRange": {key: assessment["supportedRange"][key] for key in (
                "lowMinorUnits", "medianMinorUnits", "highMinorUnits", "currency"
            )},
            "findings": assessment["findings"], "limitations": assessment["limitations"],
            "reasonCodes": assessment["preliminaryToFinalComparison"]["reasonCodes"],
            "insurerComparableReview": assessment["insurerComparables"],
            "independentMarketEvidence": assessment["externalEvidence"],
        })
        context["insurerResponse"].update({
            "text": text,
            "customerRecordedRevisedOffer": {"amountMinorUnits": amount, "currency": "USD"},
        })
        request = _analysis_input(_allowlisted_context(context), None)
        self.worker_context = copy.deepcopy(context)
        analysis = self._valid_payload(request)
        evidence_index = _analysis_evidence_index(request)
        inputs = {
            "source_identity": {
                "caseId": assessment["lineage"]["caseId"],
                **{key: _uuid(index + 100) for index, key in enumerate((
                    "responseId", "analysisResultId", "recommendationId", "decisionId", "reportId",
                    "finalAssessmentId", "initialCommunicationId", "initialPreparedMessageId",
                ))},
                "decision": "CONTINUE_CHALLENGING", "assessmentDigest": assessment["assessmentDigest"],
            },
            "analysis": analysis, "evidence_index": evidence_index, "final_assessment": assessment,
            "initial_request": {
                "recipientEmail": "original@example.com",
                "subject": context["customerRequest"]["subject"], "body": context["customerRequest"]["body"],
            },
            "sending_details": {"claimReference": "CLAIM-782", "adjusterEmail": "adjuster@example.com"},
            "customer_offer": {"amountMinorUnits": amount, "currency": "USD"},
            "report": {"reportId": _uuid(104), "contentDigest": "a" * 64},
        }
        self._recommend(inputs)
        return inputs

    @staticmethod
    def _recommend(inputs):
        inputs["recommendation"] = build_insurer_response_recommendation_v1(
            analysis=inputs["analysis"], evidence_index=inputs["evidence_index"],
            final_assessment=inputs["final_assessment"],
            assessment_digest=inputs["source_identity"]["assessmentDigest"],
            customer_offer=inputs["customer_offer"],
        )

    def test_followup_addresses_exact_response_and_preserves_initial_request(self):
        inputs = self._inputs()
        before = copy.deepcopy(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["templateVersion"], INSURER_RESPONSE_FOLLOWUP_TEMPLATE_VERSION)
        self.assertEqual(result["recipientEmail"], "adjuster@example.com")
        self.assertIn("CLAIM-782", result["subject"])
        self.assertIn("We are maintaining the comparable selection.", result["body"])
        self.assertIn("Please confirm that amount", result["body"])
        self.assertIn("advertised at $21,800.00", result["body"])
        self.assertIn("not verified sale prices or a settlement target", result["body"])
        self.assertNotEqual(result["body"], inputs["initial_request"]["body"])
        self.assertEqual(inputs, before)
        self.assertEqual(result, build_insurer_response_followup_v1(**inputs))

    def test_worker_completion_and_published_report_feed_the_followup_without_reprojection(self):
        inputs = self._inputs()
        identity = inputs["source_identity"]
        inputs["report"] = build_valuation_evidence_report_v1(
            source_snapshot=self.__class__._source_template,
            final_assessment=inputs["final_assessment"],
            report_series_id=_uuid(999), report_version_id=identity["reportId"],
            final_assessment_id=identity["finalAssessmentId"],
            version_number=1, generated_at="2026-09-02T12:00:00Z",
        ).to_dict()

        class WorkerDatabase(processing_fixture._Database):
            def resolve_total_loss_insurer_response_analysis_context(self, *args):
                return {
                    **super().resolve_total_loss_insurer_response_analysis_context(*args),
                    "case_id": identity["caseId"],
                    "final_assessment": inputs["final_assessment"],
                    "assessment_digest": identity["assessmentDigest"],
                    "customer_offer": inputs["customer_offer"],
                }

        database = WorkerDatabase(context=self.worker_context)
        analyzer = processing_fixture._Analyzer()
        execution = processing_fixture._processor(database, analyzer).execute(identity["caseId"])
        self.assertEqual(execution.state, "completed")
        self.assertEqual(len(analyzer.requests), 1)
        completed = database.completed
        self.assertIsNotNone(completed)
        inputs.update({"analysis": completed[5], "evidence_index": completed[12], "recommendation": completed[14]})
        identity.update({
            "analysisResultDigest": completed[6], "evidenceIndexDigest": completed[13],
            "recommendationDigest": completed[15], "reportDigest": inputs["report"]["reportDigest"],
        })
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertIn("I have recorded $20,000.00", result["body"])
        self.assertIn("selected 2024 Synthetic Sedan listing", result["body"])
        self.assertEqual(len(analyzer.requests), 1)

    def test_only_explicit_continue_allows_generation(self):
        for decision in ("ACCEPT_OFFER", "CONTINUE", None):
            with self.subTest(decision=decision):
                inputs = self._inputs()
                inputs["source_identity"]["decision"] = decision
                result = build_insurer_response_followup_v1(**inputs)
                self.assertEqual(result["status"], "BLOCKED")
                self.assertEqual(result["blockedReasonCode"], "CONTINUE_DECISION_REQUIRED")
                self.assertIsNone(result["body"])

    def test_offer_inside_advertised_range_does_not_become_settlement_target(self):
        inputs = self._inputs(amount=2_250_000)
        self.assertEqual(inputs["recommendation"]["state"], "NO_CLEAR_RECOMMENDATION")
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertIn("I have recorded $22,500.00", result["body"])
        self.assertNotIn("too low", result["body"])
        self.assertNotIn("must pay", result["body"])
        self.assertNotIn("supported range", result["body"])

    def test_literal_response_amount_is_attributed_only_when_text_verified(self):
        inputs = self._inputs()
        inputs["customer_offer"] = None
        offer = inputs["analysis"]["revisedOffer"]
        offer["source"] = "INSURER_RESPONSE"
        offer["responseEvidenceRefs"] = [inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"][0]]
        self._recommend(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertIn("amount in your response is $20,000.00", result["body"])

    def test_visual_offer_remains_a_question_even_with_customer_record(self):
        inputs = self._inputs(amount=2_333_300)
        reference = inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"][0]
        for row in inputs["evidence_index"]["responseEvidence"]:
            if row["evidenceRef"] == reference:
                row.update({"sourceType": "DOCUMENT", "content": None})
        inputs["analysis"]["revisedOffer"]["visualSourceInterpretation"] = {
            "derivation": "MODEL_VISUAL_TRANSCRIPTION", "derivedText": "$23,333.00",
            "responseEvidenceRef": reference, "confidence": "HIGH",
            "originalSourceAuthoritative": True, "verificationRequired": True,
        }
        inputs["analysis"]["uncertainties"] = [{
            "description": VISUAL_OFFER_UNCERTAINTY_DESCRIPTION,
            "responseEvidenceRefs": [reference], "caseEvidenceRefs": [],
        }]
        self._recommend(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertIn("confirm the vehicle valuation amount in writing", result["body"])
        self.assertNotIn("23,333", result["body"])
        self.assertNotIn("Your response says", result["body"])

    def test_uncertain_analysis_prose_is_not_transformed_into_facts(self):
        inputs = self._inputs()
        inputs["analysis"]["insurerArguments"][0]["argument"] = "The insurer deducted $7,777.00 for damage."
        inputs["analysis"]["unresolvedIssues"][0]["description"] = "A possible unsupported condition deduction is unclear."
        self._recommend(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertNotIn("7,777", result["body"])
        self.assertNotIn("deducted", result["body"])

    def test_known_adjustment_question_reuses_descriptive_assessment_finding(self):
        inputs = self._inputs(response_text="The condition adjustment reflects wear. The vehicle valuation is $20,000.00.")
        point = inputs["analysis"]["responsePoints"][0]
        point["topic"] = "Condition adjustments"
        point["whatInsurerSaid"] = "The condition adjustment reflects wear."
        inputs["analysis"]["insurerArguments"] = []
        inputs["analysis"]["unresolvedIssues"] = []
        self._recommend(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertIn("The condition adjustment reflects wear.", result["body"])
        self.assertIn("does not establish that an adjustment is incorrect", result["body"])
        finding = next(row for row in inputs["final_assessment"]["findings"] if row["code"] == "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES")
        self.assertTrue(set(finding["evidenceIds"]) <= set(result["grounding"]["assessmentEvidenceIds"]))

    def test_manual_case_uses_saved_market_evidence_without_inventing_insurer_rows(self):
        inputs = self._inputs(manual=True)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertIn("selected 2024 Synthetic Sedan listing", result["body"])
        self.assertNotIn("paired insurer comparables", result["body"])

    def test_no_support_or_no_selected_evidence_is_recoverably_blocked(self):
        for no_support in (True, False):
            inputs = self._inputs()
            assessment = inputs["final_assessment"]
            if no_support:
                assessment["continuationStatus"] = "DOES_NOT_SUPPORT_CONTINUATION"
                assessment["finalClassification"] = "NO_MATERIAL_DISCREPANCY"
            else:
                assessment["externalEvidence"]["selectedComparables"]["primary"] = []
            assessment["assessmentDigest"] = canonical_package_digest({
                key: value for key, value in assessment.items() if key != "assessmentDigest"
            })
            inputs["source_identity"]["assessmentDigest"] = assessment["assessmentDigest"]
            self._recommend(inputs)
            result = build_insurer_response_followup_v1(**inputs)
            self.assertEqual(result["status"], "BLOCKED")
            self.assertEqual(result["blockedReasonCode"], "NO_SUPPORTED_FOLLOWUP")
            self.assertIsNone(result["body"])

    def test_unknown_evidence_and_stale_policy_are_recoverable(self):
        for unknown in (True, False):
            inputs = self._inputs()
            if unknown:
                inputs["analysis"]["analysisSummary"]["caseEvidenceRefs"] = ["case_" + "f" * 64]
            else:
                inputs["recommendation"]["policyVersion"] = "1"
            result = build_insurer_response_followup_v1(**inputs)
            self.assertEqual(result["status"], "BLOCKED")
            self.assertEqual(result["blockedReasonCode"], (
                "SOURCE_EVIDENCE_UNAVAILABLE" if unknown else "RECOMMENDATION_REQUIRES_REFRESH"
            ))

    def test_unclear_response_without_remaining_issue_does_not_make_a_message(self):
        inputs = self._inputs()
        inputs["analysis"].update({"responsePoints": [], "insurerArguments": [], "unresolvedIssues": []})
        inputs["analysis"]["insurerPosition"]["category"] = "UNCLEAR"
        self._recommend(inputs)
        self.assertEqual(build_insurer_response_followup_v1(**inputs)["blockedReasonCode"], "RESPONSE_REQUIRES_CLARIFICATION")

    def test_fully_accepted_request_with_explanatory_arguments_is_blocked(self):
        inputs = self._inputs()
        inputs["analysis"]["requestDisposition"]["category"] = "ACCEPTED"
        inputs["analysis"]["responsePoints"][0]["disposition"] = "ACCEPTED"
        inputs["analysis"]["unresolvedIssues"] = []
        self._recommend(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["blockedReasonCode"], "NO_SUPPORTED_FOLLOWUP")

    def test_recipient_falls_back_to_original_or_blocks_when_unavailable(self):
        inputs = self._inputs()
        inputs["sending_details"]["adjusterEmail"] = "invalid-address"
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["recipientEmail"], "original@example.com")
        inputs["initial_request"]["recipientEmail"] = None
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["blockedReasonCode"], "SOURCE_INFORMATION_UNAVAILABLE")

    def test_unknown_listing_currency_does_not_borrow_insurer_currency(self):
        inputs = self._inputs()
        assessment = inputs["final_assessment"]
        assessment["externalEvidence"]["selectedComparables"]["primary"][0]["facts"]["advertisedPrice"]["display"] = "21,800.00"
        assessment["assessmentDigest"] = canonical_package_digest({
            key: value for key, value in assessment.items() if key != "assessmentDigest"
        })
        inputs["source_identity"]["assessmentDigest"] = assessment["assessmentDigest"]
        self._recommend(inputs)
        result = build_insurer_response_followup_v1(**inputs)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["blockedReasonCode"], "NO_SUPPORTED_FOLLOWUP")

    def test_changed_source_identity_or_content_changes_generation_digest(self):
        inputs = self._inputs()
        initial = build_insurer_response_followup_v1(**inputs)["generationDigest"]
        for key in ("responseId", "analysisResultId", "recommendationId", "decisionId", "reportId", "finalAssessmentId", "initialCommunicationId", "initialPreparedMessageId"):
            modified = copy.deepcopy(inputs)
            modified["source_identity"][key] = _uuid(999)
            self.assertNotEqual(build_insurer_response_followup_v1(**modified)["generationDigest"], initial)
        modified = copy.deepcopy(inputs)
        modified["initial_request"]["body"] += " The original sent message changed."
        changed = build_insurer_response_followup_v1(**modified)
        self.assertNotEqual(changed["generationDigest"], initial)
        self.assertEqual(changed["status"], "BLOCKED")
        modified = copy.deepcopy(inputs)
        modified["report"]["contentDigest"] = "b" * 64
        self.assertNotEqual(build_insurer_response_followup_v1(**modified)["generationDigest"], initial)

    def test_grounding_references_are_subsets_of_saved_case_sources(self):
        inputs = self._inputs()
        result = build_insurer_response_followup_v1(**inputs)
        for result_key, source_key in (("responseEvidenceRefs", "responseEvidence"), ("caseEvidenceRefs", "caseEvidence")):
            allowed = {row["evidenceRef"] for row in inputs["evidence_index"][source_key]}
            self.assertTrue(set(result["grounding"][result_key]) <= allowed)
        assessment = inputs["final_assessment"]
        allowed = set(assessment["subjectVehicle"]["evidenceIds"])
        for row in (*assessment["findings"], *assessment["externalEvidence"]["selectedComparables"]["primary"]):
            allowed.update(row["evidenceIds"])
        self.assertTrue(set(result["grounding"]["assessmentEvidenceIds"]) <= allowed)


if __name__ == "__main__":
    unittest.main()
