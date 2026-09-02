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

    def test_offer_inside_saved_range_recommends_accept(self):
        result = self._result(self._inputs())
        self.assertEqual(result["state"], ACCEPT_OFFER)
        self.assertEqual(result["reasonCodes"], ["OFFER_WITHIN_SUPPORTED_RANGE"])
        self.assertEqual(result["offer"], {
            "amountMinorUnits": 2_175_000, "currency": "USD", "source": "CUSTOMER_RECORDED",
        })
        self.assertEqual(result["caseEvidenceRefs"], sorted([self.low_ref, self.high_ref]))
        self.assertNotIn("decision", result)

    def test_endpoints_and_above_range_recommend_accept(self):
        for amount in (2_100_000, 2_250_000, 2_500_000):
            with self.subTest(amount=amount):
                self.assertEqual(self._result(self._inputs(amount))["state"], ACCEPT_OFFER)

    def test_materially_below_lower_edge_recommends_continue(self):
        result = self._result(self._inputs(1_900_000))
        self.assertEqual(result["state"], CONTINUE_CHALLENGING)
        self.assertEqual(result["reasonCodes"], ["OFFER_MATERIALLY_BELOW_SUPPORTED_RANGE"])

    def test_five_percent_boundary_uses_exact_integer_arithmetic(self):
        at_boundary = self._result(self._inputs(2_000_000))
        self.assertEqual(at_boundary["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(at_boundary["reasonCodes"], ["INTERMEDIATE_EVIDENCE_GAP"])
        self.assertEqual(self._result(self._inputs(2_000_001))["state"], ACCEPT_OFFER)
        self.assertEqual(self._result(self._inputs(1_999_999))["state"], NO_CLEAR_RECOMMENDATION)

    def test_ten_percent_boundary_uses_exact_integer_arithmetic(self):
        self.assessment["supportedRange"]["lowMinorUnits"] = 2_200_000
        self.assessment["supportedRange"]["medianMinorUnits"] = 2_225_000
        for role in ("preliminary", "final"):
            self.assessment["preliminaryToFinalComparison"][role]["supportedRange"].update({
                "lowMinorUnits": 2_200_000, "medianMinorUnits": 2_225_000,
            })
        self._reseal_assessment()
        self.assertEqual(self._result(self._inputs(2_000_000))["state"], CONTINUE_CHALLENGING)
        self.assertEqual(self._result(self._inputs(2_000_001))["state"], NO_CLEAR_RECOMMENDATION)

    def test_small_remaining_gap_uses_existing_screening_threshold(self):
        result = self._result(self._inputs(2_075_000))
        self.assertEqual(result["state"], ACCEPT_OFFER)
        self.assertEqual(result["reasonCodes"], ["REMAINING_GAP_BELOW_SCREENING_THRESHOLD"])

    def test_low_strength_or_insufficient_classification_is_neutral(self):
        for field, value in (("evidenceStrength", "LOW"), ("finalClassification", "INSUFFICIENT_EVIDENCE")):
            with self.subTest(field=field):
                inputs = self._inputs()
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
            inputs = self._inputs()
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
            self.assertEqual(result["offer"]["source"], "CUSTOMER_RECORDED")

    def test_new_insurer_arguments_withhold_numeric_recommendation(self):
        inputs = self._inputs()
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
        inputs = self._inputs()
        inputs["analysis"]["importantChanges"] = [{
            "description": "The insurer supplied different market comparables.",
            "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
            "caseEvidenceRefs": [self.low_ref],
        }]
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["INSURER_ARGUMENT_REQUIRES_REVIEW"])

    def test_pure_offer_change_does_not_hide_supported_recommendation(self):
        inputs = self._inputs()
        prior_ref = next(
            item["evidenceRef"] for item in inputs["evidence_index"]["caseEvidence"]
            if item["evidenceType"] == "INSURER_VALUATION"
        )
        inputs["analysis"]["importantChanges"] = [{
            "description": "The insurer revised the offer.",
            "responseEvidenceRefs": inputs["analysis"]["analysisSummary"]["responseEvidenceRefs"],
            "caseEvidenceRefs": [prior_ref],
        }]
        self.assertEqual(self._result(inputs)["state"], ACCEPT_OFFER)

    def test_no_revised_offer_does_not_reuse_prior_offer(self):
        result = self._result(self._inputs(None))
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertIsNone(result["offer"])

    def test_exact_text_grounded_offer_can_be_used_without_customer_amount(self):
        result = self._result(self._inputs(customer=False))
        self.assertEqual(result["state"], ACCEPT_OFFER)
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

    def test_real_saved_assessment_and_worker_context_can_recommend_both_directions(self):
        assessment = copy.deepcopy(self.__class__._assessment_template)
        saved_range = assessment["supportedRange"]
        for amount, state in (
            (saved_range["medianMinorUnits"], ACCEPT_OFFER),
            (saved_range["lowMinorUnits"] * 100 // 111, CONTINUE_CHALLENGING),
        ):
            with self.subTest(state=state):
                context = processing_fixture._analysis_context()
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
                self.assertEqual(cited, {saved_range["lowMinorUnits"], saved_range["highMinorUnits"]})

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
        inputs = self._inputs()
        inputs["analysis"]["inputCoverage"]["document"] = "UNREADABLE"
        self.assertEqual(self._result(inputs)["state"], NO_CLEAR_RECOMMENDATION)

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
        self.assertEqual(after["caseEvidenceRefs"], sorted([self.low_ref, self.high_ref]))

    def test_missing_range_evidence_references_withholds_numeric_recommendation(self):
        inputs = self._inputs()
        inputs["evidence_index"]["caseEvidence"] = [
            item for item in inputs["evidence_index"]["caseEvidence"]
            if item["evidenceRef"] != self.low_ref
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
        inputs = self._inputs()
        self.assessment["validationIssues"] = [{
            "code": "EVIDENCE_REVIEW", "description": "A source detail requires review.",
            "evidenceIds": [],
        }]
        self._reseal_assessment()
        result = self._result(inputs)
        self.assertEqual(result["state"], NO_CLEAR_RECOMMENDATION)
        self.assertEqual(result["reasonCodes"], ["SAVED_EVIDENCE_REQUIRES_REVIEW"])


if __name__ == "__main__":
    unittest.main()
