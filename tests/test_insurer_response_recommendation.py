from __future__ import annotations

import copy
import unittest

from tests.test_analysis_runs import TemporaryRepositoryTestCase
from tests.test_insurer_response_analysis import InsurerResponseAnalysisFixture
from tests import test_package_assessment as package_fixture
from tests import test_insurer_response_processing as processing_fixture
from venfour.insurer_response_analysis import (
    CaseEvidenceContext,
    VISUAL_OFFER_UNCERTAINTY_DESCRIPTION,
    make_case_evidence_reference,
)
from venfour.insurer_response_processing import (
    _allowlisted_context,
    _analysis_evidence_index,
    _analysis_input,
)
from venfour.insurer_response_recommendation import (
    ACCEPT_OFFER,
    CONTINUE_CHALLENGING,
    NO_CLEAR_RECOMMENDATION,
    InsurerResponseRecommendationError,
    build_insurer_response_recommendation_v1,
    validate_insurer_response_recommendation_v1,
)
from venfour.package_assessment import (
    build_final_valuation_assessment_v1,
    canonical_package_digest,
)


class InsurerResponseRecommendationTests(
    InsurerResponseAnalysisFixture, TemporaryRepositoryTestCase
):
    _assessment_template = None

    def setUp(self) -> None:
        InsurerResponseAnalysisFixture.setUp(self)
        if self.__class__._assessment_template is None:
            TemporaryRepositoryTestCase.setUp(self)
            source = package_fixture.PackageAssessmentTests._source(self)[3]
            self.__class__._assessment_template = (
                build_final_valuation_assessment_v1(source).to_dict()
            )
        self.assessment = copy.deepcopy(self.__class__._assessment_template)
        self.assessment["supportedRange"].update({
            "lowMinorUnits": 2_100_000,
            "medianMinorUnits": 2_175_000,
            "highMinorUnits": 2_250_000,
        })
        for role in ("preliminary", "final"):
            self.assessment["preliminaryToFinalComparison"][role]["supportedRange"].update({
                "lowMinorUnits": 2_100_000,
                "medianMinorUnits": 2_175_000,
                "highMinorUnits": 2_250_000,
            })
        self._reseal_assessment()
        self.low_ref = make_case_evidence_reference("recommendation-range", "low")
        self.high_ref = make_case_evidence_reference("recommendation-range", "high")

    def _reseal_assessment(self) -> None:
        self.assessment["assessmentDigest"] = canonical_package_digest({
            key: value for key, value in self.assessment.items()
            if key != "assessmentDigest"
        })

    def _inputs(self, amount=2_175_000, *, customer=True):
        text = (
            "We are still reviewing the valuation."
            if amount is None else
            f"The revised vehicle valuation offer is ${amount // 100:,}.{amount % 100:02d}."
        )
        request = self._request(
            response_text=text,
            original_offer_minor_units=self.assessment["insurerValuationReviewed"]["valueMinorUnits"],
            revised_offer_minor_units=amount if customer else None,
            revised_offer_currency="USD" if customer and amount is not None else None,
            case_evidence=(
                CaseEvidenceContext(
                    self.low_ref, "VENFOUR_FINDING", "Saved advertised-price range lower bound.",
                    self.assessment["supportedRange"]["lowMinorUnits"], "USD",
                ),
                CaseEvidenceContext(
                    self.high_ref, "VENFOUR_FINDING", "Saved advertised-price range upper bound.",
                    self.assessment["supportedRange"]["highMinorUnits"], "USD",
                ),
            ),
        )
        analysis = self._valid_payload(request)
        analysis.update({
            "insurerArguments": [], "responsePoints": [], "unresolvedIssues": [],
            "importantChanges": [],
        })
        if amount is not None and not customer:
            analysis["revisedOffer"].update({
                "status": "PRESENT", "amountMinorUnits": amount, "currency": "USD",
                "source": "INSURER_RESPONSE",
            })
            analysis["insurerPosition"]["category"] = "REVISED_OFFER"
            analysis["recommendedNextStep"]["category"] = "REVIEW_REVISED_OFFER"
        return {
            "analysis": analysis,
            "evidence_index": _analysis_evidence_index(request),
            "final_assessment": self.assessment,
            "assessment_digest": self.assessment["assessmentDigest"],
            "customer_offer": (
                {"amountMinorUnits": amount, "currency": "USD"}
                if customer and amount is not None else None
            ),
        }

    def _result(self, inputs):
        inputs["assessment_digest"] = (
            inputs["final_assessment"]["assessmentDigest"]
            if inputs["final_assessment"] else inputs["assessment_digest"]
        )
        return build_insurer_response_recommendation_v1(**inputs)

    def test_offer_inside_advertised_range_does_not_establish_acceptance(self):
        result = self._result(self._inputs())
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["OFFER_NOT_ASSESSED"])
        self.assertEqual(result["policyVersion"], "2")
        self.assertEqual(result["offer"], {
            "amountMinorUnits": 2_175_000, "currency": "USD", "source": "CUSTOMER_RECORDED",
        })
        self.assertTrue({self.low_ref, self.high_ref} <= set(result["caseEvidenceRefs"]))
        self.assertNotIn("decision", result)

    def test_endpoints_and_above_range_do_not_establish_acceptance(self):
        for amount in (2_100_000, 2_250_000, 2_500_000):
            with self.subTest(amount=amount):
                self.assertEqual(self._result(self._inputs(amount))["state"], NO_CLEAR_RECOMMENDATION)

    def test_large_unassessed_gap_does_not_invent_continuation(self):
        result = self._result(self._inputs(1_900_000))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["OFFER_NOT_ASSESSED"])

    def test_exact_assessed_offer_reuses_saved_continuation(self):
        amount = self.assessment["insurerValuationReviewed"]["valueMinorUnits"]
        result = self._result(self._inputs(amount))
        self.assertEqual(result["state"], CONTINUE_CHALLENGING)
        self.assertEqual(result["reasonCodes"], ["SAVED_ASSESSMENT_SUPPORTS_CONTINUATION"])
        self.assertEqual(result["policyInput"]["insurerValuationReviewed"], self.assessment["insurerValuationReviewed"])
        self.assertEqual(result["policyInput"]["limitations"], self.assessment["limitations"])
        for changed in (amount - 1, amount + 1):
            with self.subTest(amount=changed):
                self.assertEqual(self._result(self._inputs(changed))["state"], NO_CLEAR_RECOMMENDATION)

    def test_range_overlap_cannot_override_saved_continuation(self):
        self.assessment["supportedRange"]["lowMinorUnits"] = 1_900_000
        for role in ("preliminary", "final"):
            self.assessment["preliminaryToFinalComparison"][role]["supportedRange"]["lowMinorUnits"] = 1_900_000
        self._reseal_assessment()
        self.assertEqual(self._result(self._inputs(2_000_000))["state"], CONTINUE_CHALLENGING)

    def test_former_five_and_ten_percent_boundaries_do_not_set_direction(self):
        for amount in (1_909_090, 1_909_091, 1_999_999, 2_000_001, 2_075_000):
            with self.subTest(amount=amount):
                result = self._result(self._inputs(amount))
                self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
                self.assertEqual(result["reasonCodes"], ["OFFER_NOT_ASSESSED"])

    def test_no_discrepancy_is_not_an_acceptance_signal(self):
        self.assessment.update({
            "finalClassification": "NO_MATERIAL_DISCREPANCY",
            "continuationStatus": "DOES_NOT_SUPPORT_CONTINUATION",
        })
        for role in ("preliminary", "final"):
            self.assessment["preliminaryToFinalComparison"][role]["classification"] = "NO_MATERIAL_DISCREPANCY"
        self._reseal_assessment()
        result = self._result(self._inputs(2_000_000))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["SAVED_ASSESSMENT_DOES_NOT_ESTABLISH_ACCEPTANCE"])

    def test_low_strength_or_insufficient_classification_is_neutral(self):
        for field, value in (("evidenceStrength", "LOW"), ("finalClassification", "INSUFFICIENT_EVIDENCE")):
            with self.subTest(field=field):
                inputs = self._inputs(2_000_000)
                inputs["final_assessment"] = copy.deepcopy(self.assessment)
                inputs["final_assessment"][field] = value
                inputs["final_assessment"]["assessmentDigest"] = canonical_package_digest({
                    key: item for key, item in inputs["final_assessment"].items()
                    if key != "assessmentDigest"
                })
                result = self._result(inputs)
                self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
                self.assertIsNotNone(result["offer"])

    def test_missing_full_assessment_is_neutral_and_keeps_usable_offer(self):
        for missing in (None, {}):
            inputs = self._inputs()
            inputs["final_assessment"] = missing
            result = self._result(inputs)
            self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
            self.assertIsNotNone(result["offer"])
            self.assertIsNone(result["policyInput"]["supportedRange"])

    def test_forged_partial_qualification_is_neutral(self):
        inputs = self._inputs()
        inputs["final_assessment"] = {
            key: self.assessment[key] for key in (
                "assessmentDigest", "finalClassification", "evidenceStrength", "evidenceBasis",
                "continuationStatus", "supportedRange", "validationIssues", "preliminaryToFinalComparison",
            )
        }
        self.assertEqual(self._result(inputs)["state"], NO_CLEAR_RECOMMENDATION)

    def test_uncertainty_and_low_confidence_keep_separate_customer_choice(self):
        for uncertainty in (False, True):
            inputs = self._inputs(2_000_000)
            if uncertainty:
                inputs["analysis"]["uncertainties"] = [{
                    "description": "An attachment detail remains uncertain.",
                    "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
                    "caseEvidenceRefs": [],
                }]
            else:
                inputs["analysis"]["confidence"] = "LOW"
            result = self._result(inputs)
            self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
            self.assertEqual(result["reasonCodes"], ["RESPONSE_UNCERTAINTY_UNRESOLVED"])
            self.assertEqual(result["offer"]["source"], "CUSTOMER_RECORDED")

    def test_new_insurer_arguments_withhold_numeric_recommendation(self):
        inputs = self._inputs(2_000_000)
        inputs["analysis"]["insurerArguments"] = [{
            "argument": "New comparable evidence was supplied.",
            "whatItReliesOn": "The insurer's new comparable selection.",
            "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
            "caseEvidenceRefs": [self.low_ref],
        }]
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["INSURER_ARGUMENT_REQUIRES_REVIEW"])

    def test_nonoffer_evidence_change_withholds_numeric_recommendation(self):
        inputs = self._inputs(2_000_000)
        inputs["analysis"]["importantChanges"] = [{
            "description": "The insurer supplied different market comparables.",
            "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
            "caseEvidenceRefs": [self.low_ref],
        }]
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["INSURER_ARGUMENT_REQUIRES_REVIEW"])

    def test_pure_offer_change_does_not_hide_supported_recommendation(self):
        inputs = self._inputs(2_000_000)
        prior_ref = next(
            item["evidenceRef"] for item in inputs["evidence_index"]["caseEvidence"]
            if item["evidenceType"] == "INSURER_VALUATION"
        )
        inputs["analysis"]["importantChanges"] = [{
            "description": "The insurer revised the offer.",
            "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
            "caseEvidenceRefs": [prior_ref],
        }]
        self.assertEqual(self._result(inputs)["state"], CONTINUE_CHALLENGING)

    def test_no_revised_offer_does_not_reuse_prior_offer(self):
        result = self._result(self._inputs(None))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertIsNone(result["offer"])

    def test_exact_text_grounded_offer_can_be_used_without_customer_amount(self):
        result = self._result(self._inputs(customer=False))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["offer"]["source"], "RESPONSE_TEXT")

    def test_text_offer_does_not_invent_currency_from_amount_only(self):
        for currency in ("EUR", "CAD"):
            for literal in ("$21,750.00", "USD 21,750.00"):
                with self.subTest(currency=currency, literal=literal):
                    inputs = self._inputs(customer=False)
                    inputs["analysis"]["revisedOffer"]["currency"] = currency
                    for material in inputs["evidence_index"]["responseEvidence"]:
                        material["content"] = f"The revised vehicle valuation offer is {literal}."
                    result = self._result(inputs)
                    self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
                    self.assertIsNone(result["offer"])

    def test_nonascii_money_token_does_not_fail_later_database_materialization(self):
        inputs = self._inputs(customer=False)
        for material in inputs["evidence_index"]["responseEvidence"]:
            material["content"] = "The revised offer is USD ٢١٧٥٠.٠٠."
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertIsNone(result["offer"])

    def test_real_saved_assessment_and_worker_context_preserve_only_assessed_direction(self):
        assessment = copy.deepcopy(self.__class__._assessment_template)
        saved_range = assessment["supportedRange"]
        for amount, state in (
            (saved_range["medianMinorUnits"], NO_CLEAR_RECOMMENDATION),
            (saved_range["lowMinorUnits"] * 100 // 111, NO_CLEAR_RECOMMENDATION),
            (assessment["insurerValuationReviewed"]["valueMinorUnits"], CONTINUE_CHALLENGING),
        ):
            with self.subTest(state=state):
                context = processing_fixture._analysis_context()
                context["insurer"]["originalOffer"] = {
                    "amountMinorUnits": assessment["insurerValuationReviewed"]["valueMinorUnits"],
                    "currency": "USD",
                }
                context["venfourAssessment"].update({
                    "conclusionCode": assessment["finalClassification"],
                    "supportedRange": {key: saved_range[key] for key in (
                        "lowMinorUnits", "medianMinorUnits", "highMinorUnits", "currency"
                    )},
                    "findings": assessment["findings"],
                    "limitations": assessment["limitations"],
                    "reasonCodes": assessment["preliminaryToFinalComparison"]["reasonCodes"],
                    "insurerComparableReview": assessment["insurerComparables"],
                    "independentMarketEvidence": assessment["externalEvidence"],
                })
                context["insurerResponse"].update({
                    "text": f"The revised valuation offer is ${amount // 100:,}.{amount % 100:02d}.",
                    "customerRecordedRevisedOffer": {"amountMinorUnits": amount, "currency": "USD"},
                })
                request = _analysis_input(_allowlisted_context(context), None)
                analysis = self._valid_payload(request)
                analysis.update({
                    "insurerArguments": [], "responsePoints": [], "importantChanges": [],
                    "unresolvedIssues": [],
                })
                index = _analysis_evidence_index(request)
                result = build_insurer_response_recommendation_v1(
                    analysis=analysis, evidence_index=index,
                    final_assessment=assessment, assessment_digest=assessment["assessmentDigest"],
                    customer_offer={"amountMinorUnits": amount, "currency": "USD"},
                )
                self.assertEqual(result["state"], state)
                self.assertEqual(result["policyInput"]["supportedRange"], saved_range)
                self.assertEqual(result["policyInput"]["assessmentDigest"], assessment["assessmentDigest"])
                cited = {
                    item["amountMinorUnits"] for item in index["caseEvidence"]
                    if item["evidenceRef"] in result["caseEvidenceRefs"]
                }
                if state == CONTINUE_CHALLENGING:
                    self.assertEqual(cited, {assessment["insurerValuationReviewed"]["valueMinorUnits"], None})
                else:
                    self.assertTrue({saved_range["lowMinorUnits"], saved_range["highMinorUnits"]} <= cited)

    def test_uncited_text_cannot_establish_offer(self):
        inputs = self._inputs(customer=False)
        for material in inputs["evidence_index"]["responseEvidence"]:
            material["content"] = "The insurer is still reviewing the valuation."
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertIsNone(result["offer"])

    def test_different_customer_and_analyzed_amounts_fail_closed(self):
        inputs = self._inputs(customer=False)
        inputs["customer_offer"] = {"amountMinorUnits": 2_200_000, "currency": "USD"}
        result = self._result(inputs)
        self.assertIsNone(result["offer"])
        self.assertEqual(result["reasonCodes"], ["OFFER_SOURCES_CONFLICT"])

    def test_exact_customer_record_is_authoritative_even_when_result_cites_text(self):
        inputs = self._inputs(customer=False)
        inputs["customer_offer"] = {
            "offerId": "00000000-0000-4000-8000-000000000111",
            "sourceCommunicationId": "00000000-0000-4000-8000-000000000112",
            "amountMinorUnits": 2_175_000, "currency": "USD",
        }
        self.assertEqual(self._result(inputs)["offer"]["source"], "CUSTOMER_RECORDED")

    def test_unclear_amount_cannot_enable_accept(self):
        inputs = self._inputs(None)
        inputs["analysis"]["revisedOffer"]["status"] = "UNCLEAR"
        inputs["customer_offer"] = {"amountMinorUnits": 2_175_000, "currency": "USD"}
        result = self._result(inputs)
        self.assertIsNone(result["offer"])
        self.assertEqual(result["reasonCodes"], ["REVISED_OFFER_UNCERTAIN"])

    def _visual_inputs(self, *, customer):
        inputs = self._inputs(customer=customer)
        analysis = inputs["analysis"]
        reference = analysis["analysisSummary"]["responseEvidenceRefs"][0]
        for item in inputs["evidence_index"]["responseEvidence"]:
            if item["evidenceRef"] == reference:
                item.update({"sourceType": "DOCUMENT", "content": None})
        analysis["revisedOffer"]["visualSourceInterpretation"] = {
            "derivation": "MODEL_VISUAL_TRANSCRIPTION", "derivedText": "$21,750.00",
            "responseEvidenceRef": reference, "confidence": "HIGH",
            "originalSourceAuthoritative": True, "verificationRequired": True,
        }
        analysis["uncertainties"] = [{
            "description": VISUAL_OFFER_UNCERTAINTY_DESCRIPTION,
            "responseEvidenceRefs": [reference], "caseEvidenceRefs": [],
        }]
        return inputs

    def test_visual_only_offer_is_not_usable_even_with_high_confidence(self):
        result = self._result(self._visual_inputs(customer=False))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertIsNone(result["offer"])
        self.assertEqual(result["reasonCodes"], ["VISUAL_OFFER_REQUIRES_VERIFICATION"])

    def test_visual_uncertainty_does_not_erase_exact_customer_record(self):
        result = self._result(self._visual_inputs(customer=True))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["offer"]["source"], "CUSTOMER_RECORDED")

    def test_incomplete_response_coverage_is_neutral(self):
        inputs = self._inputs(2_000_000)
        inputs["analysis"]["inputCoverage"]["document"] = "UNREADABLE"
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["RESPONSE_UNCERTAINTY_UNRESOLVED"])

    def test_assessment_source_digest_change_is_rejected(self):
        inputs = self._inputs()
        inputs["assessment_digest"] = "b" * 64
        with self.assertRaises(InsurerResponseRecommendationError):
            build_insurer_response_recommendation_v1(**inputs)

    def test_uncited_range_is_still_cited_and_explanatory_next_step_is_ignored(self):
        inputs = self._inputs()
        before = self._result(inputs)
        inputs["analysis"]["recommendedNextStep"].update({
            "category": "FOLLOW_UP_APPEARS_WARRANTED",
            "explanation": "Review the available evidence.",
            "caseEvidenceRefs": [self.low_ref],
        })
        after = self._result(inputs)
        self.assertEqual(before, after)
        self.assertTrue({self.low_ref, self.high_ref} <= set(after["caseEvidenceRefs"]))

    def test_missing_reviewed_value_reference_withholds_continuation(self):
        inputs = self._inputs(2_000_000)
        inputs["evidence_index"]["caseEvidence"] = [
            item for item in inputs["evidence_index"]["caseEvidence"]
            if item["evidenceType"] != "INSURER_VALUATION"
        ]
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["SAVED_EVIDENCE_INSUFFICIENT"])

    def test_output_and_inputs_are_stable_and_independent(self):
        inputs = self._inputs()
        before = copy.deepcopy(inputs)
        first = self._result(inputs)
        self.assertEqual(inputs, before)
        self.assertEqual(first, self._result(inputs))
        first["policyInput"]["supportedRange"]["lowMinorUnits"] = 1
        self.assertEqual(inputs, before)

    def test_unknown_evidence_and_tampered_states_are_rejected(self):
        inputs = self._inputs()
        inputs["analysis"]["analysisSummary"]["caseEvidenceRefs"] = ["case_" + "f" * 64]
        with self.assertRaises(InsurerResponseRecommendationError):
            self._result(inputs)
        result = self._result(self._inputs())
        result["state"] = CONTINUE_CHALLENGING
        with self.assertRaises(InsurerResponseRecommendationError):
            validate_insurer_response_recommendation_v1(result)

    def test_source_validation_problem_prevents_binary_recommendation(self):
        inputs = self._inputs(2_000_000)
        self.assessment["validationIssues"] = [{
            "code": "EVIDENCE_REVIEW", "description": "A source detail requires review.",
            "evidenceIds": [],
        }]
        self._reseal_assessment()
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["SAVED_EVIDENCE_REQUIRES_REVIEW"])

    def test_saved_assumptions_and_additional_limitations_withhold_continuation(self):
        original = copy.deepcopy(self.assessment)
        for field, caveat in (
            ("assumptions", {"code": "UNVERIFIED_CONDITION", "description": "Condition still needs verification.", "evidenceIds": []}),
            ("limitations", {"code": "UNVERIFIED_CONDITION", "label": "Unverified condition", "description": "Condition still needs verification.", "evidenceIds": original["limitations"][0]["evidenceIds"]}),
        ):
            with self.subTest(field=field):
                self.assessment = copy.deepcopy(original)
                self.assessment[field].append(caveat)
                self._reseal_assessment()
                result = self._result(self._inputs(2_000_000))
                self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
                self.assertEqual(result["reasonCodes"], ["SAVED_EVIDENCE_REQUIRES_REVIEW"])

    def test_unresolved_response_issue_withholds_saved_continuation(self):
        inputs = self._inputs(2_000_000)
        issue_ref = make_case_evidence_reference("condition", "unresolved-condition")
        inputs["evidence_index"]["caseEvidence"].append({
            "evidenceRef": issue_ref, "evidenceType": "INSURER_VALUATION",
            "summary": "The insurer's condition deduction.",
            "amountMinorUnits": None, "currency": None,
        })
        inputs["analysis"]["unresolvedIssues"] = [{
            "description": "The condition deduction has not been explained.",
            "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
            "caseEvidenceRefs": [issue_ref],
        }]
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["RESPONSE_UNCERTAINTY_UNRESOLVED"])
        self.assertIn(issue_ref, result["caseEvidenceRefs"])

    def test_potential_conclusion_with_moderate_evidence_retains_saved_continuation(self):
        self.assessment.update({
            "finalClassification": "POTENTIAL_UNDERVALUE", "evidenceStrength": "MODERATE",
        })
        for role in ("preliminary", "final"):
            self.assessment["preliminaryToFinalComparison"][role]["classification"] = "POTENTIAL_UNDERVALUE"
        self._reseal_assessment()
        result = self._result(self._inputs(2_000_000))
        self.assertEqual(result["state"], CONTINUE_CHALLENGING)

    def test_altered_canonical_limitation_requires_review(self):
        self.assessment["limitations"][0]["description"] = "Vehicle identity requires verification."
        self._reseal_assessment()
        result = self._result(self._inputs(2_000_000))
        self.assertEqual(result["reasonCodes"], ["SAVED_EVIDENCE_REQUIRES_REVIEW"])

    def test_even_no_discrepancy_cannot_validate_an_acceptance_reason(self):
        result = self._result(self._inputs())
        result.update({"state": ACCEPT_OFFER, "reasonCodes": ["OFFER_WITHIN_SUPPORTED_RANGE"]})
        with self.assertRaises(InsurerResponseRecommendationError):
            validate_insurer_response_recommendation_v1(result)


if __name__ == "__main__":
    unittest.main()
