from __future__ import annotations

import copy
import unittest
from tests.test_ccc_evidence import source_fixture
from tests.test_discrepancy import make_listing, make_request, make_target
from venfour.comparables import rank_market_comparables
from venfour.discrepancy import CurrentEvidenceInput, analyze_valuation_discrepancy
from venfour.market import MarketSearchRequest, MarketSearchResult
from venfour.preliminary_qualification import (
    PreliminaryQualificationContractError,
    qualify_preliminary,
    validate_preliminary_qualification,
)
from venfour.report_ingestion import normalize_ccc_report, normalized_report_to_legacy_report, validate_effective_report


def qualification_inputs(*, prices=(1990000, 2000000, 2010000), manual=False):
    target = make_target(drivetrain="FWD")
    market = MarketSearchResult(
        provider="synthetic-current",
        request=MarketSearchRequest(year=target.year, make=target.make, model=target.model,
                                    trim=target.trim, loss_vehicle_mileage=target.mileage,
                                    postal_code=target.postal_code, drivetrain="FWD"),
        listings=tuple(make_listing(index, price, drivetrain="FWD") for index, price in enumerate(prices, 1)),
    )
    ranking = rank_market_comparables(target, market)
    request = make_request(target=target, current=CurrentEvidenceInput(ranking=ranking, observed_date="2026-08-10"))
    result = analyze_valuation_discrepancy(request)
    raw = source_fixture()
    raw["vehicle"].update({key: value for key, value in target.to_dict().items() if key != "postalCode"})
    reference = {"page": 2, "section": "Comparable vehicles", "label": "Comp 1", "text": "Controlled source facts"}
    raw["vehicle"]["drivetrainSource"] = dict(reference, text="FWD")
    raw["valuation"] = {"baseVehicleValue": 20000, "conditionAdjustment": 0, "adjustedVehicleValue": 20000, "total": 20000}
    raw["condition"]["totalAdjustment"] = 0
    raw["condition"]["items"][0]["valueImpact"] = 0
    row = raw["comparables"][0]
    raw["comparables"] = [row]
    row.update({"year": 2024, "make": "Synthetic", "model": "Sedan", "trim": "SEL", "vin": "CONTROLVIN0000001",
                "number": 1, "mileage": 50000, "drivetrain": "FWD", "adjustedValue": 20000,
                "adjustments": {"package": 0, "options": 0, "mileage": 0, "condition": 0},
                "sourcePrice": {"amount": 20000, "type": "ADVERTISED", "label": "List Price"},
                "source": {"type": "DEALER", "label": "Dealer", "stockNumber": "CONTROL-1", "sourceDate": None, "updateDate": "2026-08-01"},
                "sourceReferences": [reference, dict(reference, label="Updated Date", text="08/01/2026")]})
    raw["contributionRows"] = [{"number": 1, "vin": row["vin"], "dealer": row["dealer"], "stockNumber": "CONTROL-1", "sourcePrice": copy.deepcopy(row["sourcePrice"]), "adjustedValue": 20000, "contributionPercent": 100, "sourceReferences": [reference]}]
    report = normalized_report_to_legacy_report(normalize_ccc_report(raw))
    validate_effective_report(report)
    return {
        "source_report": None if manual else report,
        "evidence_context": {"inputMode": "MANUAL" if manual else "REPORT", "reportAvailable": not manual, "partialExtraction": False},
        "discrepancy_request": request.to_dict(), "discrepancy_result": result.to_dict(),
        "current_ranking": ranking.to_dict(), "historical_ranking": None,
    }


def renormalize_source(inputs):
    report = inputs["source_report"]
    rows = report["comparables"]
    row_keys = source_fixture()["comparables"][0].keys()
    raw = {key: copy.deepcopy(report[key]) for key in ("schemaVersion", "report", "vehicle", "valuation", "condition", "valuationNotes", "supplementalInformation")}
    raw["comparables"] = [{key: copy.deepcopy(row[key]) for key in row_keys} for row in rows]
    raw["contributionRows"] = copy.deepcopy(report["evidence"]["contributionRows"])
    for binding in report["evidence"]["contributionBindings"]:
        if binding["comparableIndex"] is not None:
            row = rows[binding["comparableIndex"]]
            contribution = raw["contributionRows"][binding["rowIndex"]]
            for key in ("sourcePrice", "adjustedValue"):
                contribution[key] = copy.deepcopy(row[key])
    inputs["source_report"] = normalized_report_to_legacy_report(normalize_ccc_report(raw))
    validate_effective_report(inputs["source_report"])


class PreliminaryQualificationTests(unittest.TestCase):
    def test_clear_market_gap_reuses_actual_market_policy(self):
        inputs = qualification_inputs(prices=(2200000, 2300000, 2400000))
        result = qualify_preliminary(**inputs)
        self.assertEqual(inputs["discrepancy_result"]["classification"], "POTENTIAL_UNDERVALUE")
        self.assertEqual(result["outcome"], "CLEAR_MARKET_VALUE_GAP")

    def test_source_linked_adverse_valuation_equation_qualifies_without_market_gap(self):
        inputs = qualification_inputs()
        inputs["source_report"]["valuation"]["adjustedVehicleValue"] = 18000
        validate_effective_report(inputs["source_report"])
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["marketClassification"], "NO_MATERIAL_DISCREPANCY")
        self.assertEqual(result["outcome"], "MATERIAL_INSURER_REPORT_ISSUE")
        finding = result["qualifyingReportFindings"][0]
        self.assertEqual(finding["findingCode"], "VALUATION_ARITHMETIC")
        self.assertEqual(finding["financialImpact"], {"amountCents": 200000, "scope": "VALUATION_ARITHMETIC", "roundingAllowanceCents": 150})
        self.assertIn({"path": "$.sourceReport.valuation.adjustedVehicleValue", "value": 18000}, finding["sourceEvidence"])
        self.assertIn("NOT_SETTLEMENT", finding["materialityBasis"])

    def test_material_source_unavailable_requires_information(self):
        inputs = qualification_inputs()
        inputs["source_report"]["vehicle"]["drivetrain"] = None
        inputs["source_report"]["vehicle"]["drivetrainSource"] = dict.fromkeys(("page", "section", "label", "text"))
        renormalize_source(inputs)
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertFalse(result["applicableMaterialReviewComplete"])

    def test_complete_source_and_market_review_can_support_negative_outcome(self):
        result = qualify_preliminary(**qualification_inputs())
        self.assertEqual(result["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        self.assertTrue(result["applicableMaterialReviewComplete"])
        self.assertEqual(result["unresolvedMaterialChecks"], [])

    def test_optional_insurer_missing_and_global_partial_do_not_block(self):
        inputs = qualification_inputs()
        inputs["evidence_context"]["partialExtraction"] = True
        inputs["source_report"]["report"]["insurer"] = None
        inputs["source_report"]["evidence"]["fieldChecks"].append({"path": "report.insurer", "status": "UNAVAILABLE", "materiality": "OPTIONAL", "reasonCodes": [], "sourceReferences": []})
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")

    def test_take_price_and_undisclosed_components_are_not_issues(self):
        inputs = qualification_inputs()
        row = inputs["source_report"]["comparables"][0]
        row["sourcePrice"].update(type="TAKE", label="Take Price")
        row["listPrice"] = None
        row["adjustedValue"] = 20326
        row["adjustments"] = dict.fromkeys(row["adjustments"])
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        self.assertEqual(result["qualifyingReportFindings"], [])
        self.assertEqual(next(item for item in result["checkCoverage"] if item["checkCode"] == "COMPARABLE_ADJUSTMENT_RECONCILIATION")["status"], "NOT_ASSESSED")

    def test_unusual_weights_and_rounded_sum_do_not_prove_issue(self):
        inputs = qualification_inputs()
        source = inputs["source_report"]
        source["comparables"][0]["contributionPercent"] = 61
        source["evidence"]["contributionRows"][0]["contributionPercent"] = 61
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")

    def test_display_rounding_does_not_create_material_valuation_issue(self):
        inputs = qualification_inputs()
        inputs["source_report"]["valuation"]["adjustedVehicleValue"] = 19999
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        self.assertEqual(result["qualifyingReportFindings"], [])

    def test_decimal_precision_controls_rounding_bound(self):
        inputs = qualification_inputs()
        inputs["source_report"]["valuation"].update(baseVehicleValue=20000.11, conditionAdjustment=0.12, adjustedVehicleValue=19999.23)
        inputs["source_report"]["condition"] = {"totalAdjustment": .12, "items": [{"valueImpact": .12}]}
        result = qualify_preliminary(**inputs)
        finding = next(item for item in result["qualifyingReportFindings"] if item["findingCode"] == "VALUATION_ARITHMETIC")
        self.assertEqual(finding["financialImpact"]["amountCents"], 100)
        self.assertEqual(finding["financialImpact"]["roundingAllowanceCents"], 2)

    def test_beneficial_arithmetic_difference_does_not_qualify(self):
        inputs = qualification_inputs()
        inputs["source_report"]["valuation"]["adjustedVehicleValue"] = 22000
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")

    def test_condition_items_must_show_adverse_value_effect(self):
        inputs = qualification_inputs()
        inputs["source_report"]["condition"]["totalAdjustment"] = 500
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["qualifyingReportFindings"], [])
        inputs["source_report"]["condition"]["items"][0]["valueImpact"] = 500
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "MATERIAL_INSURER_REPORT_ISSUE")
        self.assertEqual(result["qualifyingReportFindings"][0]["financialImpact"]["scope"], "CONDITION_ARITHMETIC")

    def test_conflicting_condition_subtotal_does_not_become_adequate_review(self):
        inputs = qualification_inputs()
        inputs["source_report"]["condition"]["totalAdjustment"] = -300
        validate_effective_report(inputs["source_report"])
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertIn("CONFLICTING_SOURCE_CONDITION_TOTALS", result["reasonCodes"])
        self.assertEqual(result["qualifyingReportFindings"], [])

    def test_missing_ordinary_source_comparable_facts_are_not_hidden_by_field_checks(self):
        for field in ("year", "make", "model", "trim", "mileage", "drivetrain", "adjustedValue"):
            with self.subTest(field=field):
                inputs = qualification_inputs()
                inputs["source_report"]["comparables"][0][field] = None
                renormalize_source(inputs)
                result = qualify_preliminary(**inputs)
                self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
                self.assertEqual(result["qualifyingReportFindings"], [])

    def test_nonzero_mileage_adjustment_without_source_mileage_is_unresolved(self):
        inputs = qualification_inputs()
        row = inputs["source_report"]["comparables"][0]
        row["mileage"] = None
        row["adjustments"]["mileage"] = -100
        row["adjustedValue"] = 19900
        renormalize_source(inputs)
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_zero_contribution_exemption_requires_source_binding(self):
        inputs = qualification_inputs()
        row = inputs["source_report"]["comparables"][0]
        row.update(mileage=None, contributionPercent=0)
        row["contributionBinding"]["status"] = "UNBOUND"
        result = qualify_preliminary(**inputs)
        self.assertIn("CONTRIBUTING_COMPARABLE_FACT_UNAVAILABLE", result["reasonCodes"])

    def test_known_comparable_configuration_difference_alone_is_not_an_error(self):
        inputs = qualification_inputs()
        inputs["source_report"]["comparables"][0].update(year=2023, make="Other", model="Different", trim="Different", drivetrain="AWD")
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")
        self.assertEqual(next(item for item in result["checkCoverage"] if item["checkCode"] == "INSURER_COMPARABLE_CONFIGURATION_VALIDITY")["status"], "NOT_ASSESSED")

    def test_comp_arithmetic_requires_bound_positive_contribution(self):
        inputs = qualification_inputs()
        source = inputs["source_report"]
        source["comparables"][0]["adjustedValue"] = 18000
        source["evidence"]["contributionRows"][0]["adjustedValue"] = 18000
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "MATERIAL_INSURER_REPORT_ISSUE")
        finding = result["qualifyingReportFindings"][0]
        self.assertEqual(finding["financialImpact"]["scope"], "COMPARABLE_ARITHMETIC")
        self.assertEqual(finding["sourceReferences"][0]["page"], 2)
        source["comparables"][0]["contributionBinding"]["status"] = "UNBOUND"
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_zero_contribution_comparable_error_does_not_qualify(self):
        inputs = qualification_inputs()
        source = inputs["source_report"]
        source["comparables"][0].update(adjustedValue=18000, contributionPercent=0)
        source["evidence"]["contributionRows"][0]["contributionPercent"] = 0
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["qualifyingReportFindings"], [])
        self.assertEqual(result["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")

    def test_missing_nonzero_condition_effect_needs_source(self):
        inputs = qualification_inputs()
        inputs["source_report"]["condition"]["items"][0]["valueImpact"] = None
        inputs["source_report"]["condition"]["totalAdjustment"] = -500
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "IMPORTANT_INFORMATION_NEEDED")

    def test_duplicate_vin_is_unresolved_not_automatic_material_issue(self):
        inputs = qualification_inputs()
        duplicate = copy.deepcopy(inputs["source_report"]["comparables"][0])
        duplicate["number"] = 2
        inputs["source_report"]["comparables"].append(duplicate)
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertEqual(result["qualifyingReportFindings"], [])

    def test_mileage_direction_screen_needs_interpretation(self):
        inputs = qualification_inputs()
        row = inputs["source_report"]["comparables"][0]
        row["mileage"] = 60000
        row["adjustments"]["mileage"] = -1000
        row["adjustedValue"] = 19000
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertEqual(result["qualifyingReportFindings"], [])

    def test_source_customer_conflict_is_not_proof_customer_is_correct(self):
        inputs = qualification_inputs()
        inputs["discrepancy_request"]["lossVehicle"]["mileage"] += 10000
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertEqual(result["qualifyingReportFindings"], [])

    def test_manual_has_no_report_checks_and_supports_three_outcomes(self):
        for prices, expected in [((1990000, 2000000, 2010000), "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW"), ((2200000, 2300000, 2400000), "CLEAR_MARKET_VALUE_GAP"), ((2000000,), "IMPORTANT_INFORMATION_NEEDED")]:
            with self.subTest(expected=expected):
                result = qualify_preliminary(**qualification_inputs(prices=prices, manual=True))
                self.assertEqual(result["outcome"], expected)
                self.assertFalse(result["reportReviewApplicable"])
                self.assertIsNone(result["reportAnalysisVersion"])
                self.assertEqual(result["qualifyingReportFindings"], [])
                self.assertEqual(next(item for item in result["checkCoverage"] if item["scope"] == "REPORT")["status"], "NOT_APPLICABLE")

    def test_selected_unknown_drive_blocks_negative_but_not_existing_positive(self):
        for prices, expected in [((1990000, 2000000, 2010000), "IMPORTANT_INFORMATION_NEEDED"), ((2200000, 2300000, 2400000), "CLEAR_MARKET_VALUE_GAP")]:
            inputs = qualification_inputs(prices=prices)
            inputs["discrepancy_result"]["currentExternalSummary"]["selectedEvidence"][0]["drivetrain"] = None
            result = qualify_preliminary(**inputs)
            self.assertEqual(result["outcome"], expected)
            self.assertFalse(result["applicableMaterialReviewComplete"])
            self.assertIn("PROVIDER_MARKET_DATA", [item["resolution"] for item in result["unresolvedMaterialChecks"]])

    def test_missing_primary_selected_trim_mileage_or_distance_needs_provider_data(self):
        for field in ("trim", "mileage", "distanceMiles"):
            with self.subTest(field=field):
                inputs = qualification_inputs()
                inputs["discrepancy_result"]["currentExternalSummary"]["selectedEvidence"][0][field] = None
                result = qualify_preliminary(**inputs)
                self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
                self.assertIn("SELECTED_COMPARABLE_MATERIAL_FACT_UNAVAILABLE", result["reasonCodes"])

    def test_absent_selected_vin_can_use_stable_provider_identity(self):
        inputs = qualification_inputs()
        inputs["discrepancy_result"]["currentExternalSummary"]["selectedEvidence"][0]["vin"] = None
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")

    def test_material_field_evidence_points_to_exact_source_array_item(self):
        inputs = qualification_inputs()
        inputs["source_report"]["vehicle"]["drivetrain"] = None
        inputs["source_report"]["vehicle"]["drivetrainSource"] = dict.fromkeys(("page", "section", "label", "text"))
        renormalize_source(inputs)
        checks = inputs["source_report"]["evidence"]["fieldChecks"]
        index = next(index for index, item in enumerate(checks) if item["path"] == "vehicle.drivetrain")
        result = qualify_preliminary(**inputs)
        item = next(item for item in result["unresolvedMaterialChecks"] if item["checkCode"] == "REPORT_MATERIAL_SOURCE_FACT")
        self.assertEqual(item["sourceEvidence"], [{"path": f"$.sourceReport.evidence.fieldChecks[{index}]", "value": checks[index]}])
        self.assertEqual(item["sourceReferences"], checks[index]["sourceReferences"])

    def test_unselected_and_secondary_unknown_drive_do_not_block_primary(self):
        inputs = qualification_inputs()
        inputs["current_ranking"]["candidates"].append({"listing": {"drivetrain": None}, "eligible": False})
        inputs["discrepancy_result"]["historicalExternalSummary"] = {"selectedEvidence": [{"drivetrain": None}]}
        self.assertEqual(qualify_preliminary(**inputs)["outcome"], "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW")

    def test_legacy_source_is_not_reinterpreted_as_proven_complete(self):
        inputs = qualification_inputs()
        inputs["source_report"].pop("schemaVersion")
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        self.assertEqual(result["reportAnalysisVersion"], "1")

    def test_same_inputs_are_deterministic_immutable_and_digest_bound(self):
        inputs = qualification_inputs()
        before = copy.deepcopy(inputs)
        first = qualify_preliminary(**inputs)
        self.assertEqual(first, qualify_preliminary(**inputs))
        self.assertEqual(inputs, before)
        reordered = {key: value for key, value in reversed(list(inputs.items()))}
        self.assertEqual(first, qualify_preliminary(**reordered))
        inputs["evidence_context"]["partialExtraction"] = True
        changed = qualify_preliminary(**inputs)
        self.assertNotEqual(changed["inputDigest"], first["inputDigest"])
        self.assertEqual(changed["outcome"], first["outcome"])

    def test_source_arithmetic_does_not_follow_effective_offer(self):
        inputs = qualification_inputs()
        before = copy.deepcopy(inputs["discrepancy_result"]["currentExternalSummary"])
        inputs["discrepancy_request"]["cccVehicleValuation"] = 18000
        result = qualify_preliminary(**inputs)
        self.assertEqual(result["qualifyingReportFindings"], [])
        self.assertEqual(inputs["discrepancy_result"]["currentExternalSummary"], before)

    def test_validator_rejects_reassuring_outcome_with_unresolved_evidence(self):
        inputs = qualification_inputs(manual=True)
        inputs["discrepancy_request"]["lossVehicle"]["drivetrain"] = None
        result = qualify_preliminary(**inputs)
        result["outcome"] = "NO_SUPPORTED_ISSUE_AFTER_ADEQUATE_REVIEW"
        with self.assertRaises(PreliminaryQualificationContractError):
            validate_preliminary_qualification(result)


if __name__ == "__main__":
    unittest.main()
