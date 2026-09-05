from __future__ import annotations

import copy
import json
import unittest
from dataclasses import replace
from pathlib import Path

from jsonschema import Draft202012Validator

from tests.test_discrepancy import make_ccc_comparable, make_current_input, make_request
from venfour.analysis import analyze_report
from venfour.discrepancy import DiscrepancyContractError, analyze_valuation_discrepancy, validate_valuation_discrepancy_result
from venfour.presentation import _ccc_row
from venfour.valuation_evidence_report import _insurer_comparables


def source_row(price_type: str = "TAKE") -> dict:
    row = make_ccc_comparable(1, list_price_cents=2_554_100, adjusted_value_cents=2_586_700)
    row.update({
        "listPrice": 25541 if price_type == "ADVERTISED" else None,
        "drivetrain": "FWD",
        "sourcePrice": {"amount": 25541, "type": price_type, "label": "Take Price" if price_type == "TAKE" else "List Price"},
        "source": {"type": "INSPECTED", "label": "Inspected comparable", "stockNumber": "REF-1", "sourceDate": "2026-08-01", "updateDate": "2026-08-02"},
        "sourceReferences": [{"page": 7, "section": "Comparable", "label": "Comp 1", "text": None}],
        "contributionBinding": {"status": "BOUND", "rowIndexes": [0], "reasonCodes": ["EXACT_IDENTITY"]},
        "contributionPercent": 100,
    })
    return row


class SourcePriceProjectionTests(unittest.TestCase):
    def result(self, row: dict):
        request = replace(make_request(current=make_current_input([1990000, 2000000, 2010000]), ccc_comparables=(row,)), report_evidence_version="2")
        return analyze_valuation_discrepancy(request)

    def test_take_price_retains_amount_and_net_without_advertised_alias(self):
        result = self.result(source_row())
        row = result.ccc_comparable_summary.comparables[0].to_dict()
        self.assertEqual(result.analysis_version, "2")
        self.assertIsNone(row["listPriceCents"])
        self.assertEqual(row["sourcePrice"]["amountCents"], 2554100)
        self.assertEqual(row["netAdjustmentCents"], 32600)
        self.assertEqual(result.ccc_comparable_summary.advertised_prices.count, 0)
        projected = _ccc_row(row)
        self.assertIsNone(projected["advertisedPrice"]["cents"])
        self.assertEqual(projected["sourcePrice"]["typeLabel"], "Take Price")
        report_row = _insurer_comparables({"insurerComparables": {"rows": [{"facts": projected, "evidenceIds": []}]}})[0]
        self.assertIsNone(report_row["advertisedPrice"])
        self.assertEqual(report_row["sourcePrice"]["amount"], "$25,541.00")
        self.assertEqual(row["source"]["stockNumber"], "REF-1")
        self.assertEqual(row["sourceReferences"][0]["page"], 7)

    def test_advertised_price_retains_its_actual_type(self):
        result = self.result(source_row("ADVERTISED"))
        row = result.ccc_comparable_summary.comparables[0].to_dict()
        self.assertEqual(row["listPriceCents"], 2554100)
        self.assertEqual(result.ccc_comparable_summary.advertised_prices.count, 1)
        self.assertEqual(_ccc_row(row)["sourcePrice"]["typeLabel"], "Advertised price")

    def test_take_price_cannot_be_relabelled_advertised_in_a_result(self):
        result = self.result(source_row()).to_dict()
        result["cccComparableSummary"]["comparables"][0]["listPriceCents"] = 2554100
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_result(result)

    def test_legacy_result_omits_unrecorded_source_facts(self):
        result = analyze_valuation_discrepancy(make_request(ccc_comparables=(make_ccc_comparable(1),)))
        self.assertEqual(result.analysis_version, "1")
        self.assertNotIn("sourcePrice", result.ccc_comparable_summary.comparables[0].to_dict())

    def test_price_type_does_not_change_independent_market_decision(self):
        take = self.result(source_row()).to_dict()
        advertised = self.result(source_row("ADVERTISED")).to_dict()
        for field in ("classification", "evidenceStrength", "primaryComparison", "currentExternalSummary"):
            self.assertEqual(take[field], advertised[field])

    def test_source_arithmetic_and_contribution_binding_are_separate_checks(self):
        row = source_row()
        row["adjustments"] = {"package": 0, "options": 0, "mileage": 326, "condition": 0}
        report = {"schemaVersion": "2", "vehicle": {"mileage": row["mileage"]}, "comparables": [row], "evidence": {"contributionRows": [{"contributionPercent": 100}], "contributionBindings": [{"rowIndex": 0, "status": "BOUND", "comparableIndex": 0}]}}
        result = analyze_report(report)
        self.assertEqual(result["metrics"]["comparableAdjustments"]["entries"][0]["netAdjustment"], 326)
        self.assertTrue(result["metrics"]["comparableAdjustments"]["entries"][0]["reconciled"])
        self.assertEqual(result["metrics"]["contributionPercentages"]["bindingStatus"], "BOUND")
        altered = copy.deepcopy(report)
        altered["evidence"]["contributionBindings"][0]["status"] = "AMBIGUOUS"
        ambiguous = analyze_report(altered)
        self.assertEqual(ambiguous["metrics"]["contributionPercentages"]["displayedSum"], 100)
        finding = next(x for x in ambiguous["findings"] if x["code"] == "CONTRIBUTION_PERCENTAGES")
        self.assertEqual(finding["status"], "REVIEW")
        self.assertIn("Venfour's representation", finding["description"])
        schema = json.loads((Path(__file__).parents[1] / "schemas/analysis/report-analysis.schema.json").read_text())
        Draft202012Validator(schema).validate(result)
        Draft202012Validator(schema).validate(ambiguous)

    def test_bound_hundred_percent_does_not_hide_missing_comparable_contribution(self):
        bound = source_row()
        missing = source_row("ADVERTISED")
        missing.update({
            "number": 2,
            "contributionPercent": None,
            "contributionBinding": {
                "status": "UNBOUND", "rowIndexes": [],
                "reasonCodes": ["SOURCE_FACT_UNAVAILABLE"],
            },
        })
        report = {
            "schemaVersion": "2", "comparables": [bound, missing],
            "evidence": {
                "contributionRows": [{"contributionPercent": 100}],
                "contributionBindings": [{
                    "rowIndex": 0, "status": "BOUND", "comparableIndex": 0,
                }],
            },
        }
        result = analyze_report(report)
        metric = result["metrics"]["contributionPercentages"]
        self.assertEqual(metric["displayedSum"], 100)
        self.assertEqual(metric["availability"], "partial")
        self.assertEqual(metric["bindingStatus"], "UNRESOLVED")
        self.assertEqual(metric["availableCount"], 1)
        self.assertEqual(metric["missingCount"], 1)
        self.assertEqual(metric["boundSourceRowCount"], 1)
        self.assertEqual(metric["unresolvedSourceRowCount"], 0)
        finding = next(x for x in result["findings"] if x["code"] == "CONTRIBUTION_PERCENTAGES")
        self.assertEqual(finding["status"], "REVIEW")
