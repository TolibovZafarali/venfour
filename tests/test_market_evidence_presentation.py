"""Fictional supporting examples remain separate through display and PDF output."""

from __future__ import annotations

import copy
import unittest

import pymupdf

from tests.test_comparable_evidence import FACTS, TARGET, observation
from tests import test_valuation_evidence_report as report_fixtures
from tests.test_valuation_evidence_report import (
    FINAL_ASSESSMENT_ID, REPORT_SERIES_ID, REPORT_VERSION_ID,
)
from venfour.comparable_evidence import build_supporting_shortlist
from venfour.market_evidence_presentation import (
    LIMITED_NO_INCREASE_SUMMARY, SUPPORTING_DISCLOSURE, SUPPORTING_TITLE,
    project_market_search_context, project_supporting_evidence,
    validate_market_evidence_display,
)
from venfour.package_assessment import canonical_package_digest
from venfour.customer_delivery import validate_report_projection
from tests.test_customer_delivery import valid_report
from venfour.valuation_evidence_report import (
    ValuationEvidenceReportV1, _project_report_data,
    render_valuation_evidence_report_pdf_v1, validate_valuation_evidence_report_pdf_v1,
)


def fictional_search(*, limited=False):
    items = [observation(index) for index in range(1, 10)]
    for index, price in ((10, 24_000), (11, 23_000)):
        item = observation(index, price=price, purpose="supporting")
        item["materialFacts"]["warranty"] = None
        items.append(item)
    for item in items:
        item["relevantDate"] = "2026-08-20"
    support = build_supporting_shortlist(TARGET, items, subject_material_facts=FACTS)
    support["searchStatus"] = "REUSED_VERIFIED_EVIDENCE"
    return {
        "baselineStatus": "LIMITED" if limited else "SUFFICIENT",
        "stopReasons": {"current": "BUDGET_OR_QUOTA_LIMITED" if limited else "SUFFICIENT_STRONG_EVIDENCE", "historical": "OUT_OF_PROVIDER_RANGE"},
        "supportingEvidence": support,
    }


def fictional_supporting_report():
    fixture = report_fixtures.ValuationEvidenceReportTests(methodName="runTest")
    fixture.setUp()
    try:
        source, assessment, original = fixture._report()
        source_data = source.to_dict()
        source_data["analysis"]["artifact"]["result"]["marketSearch"] = fictional_search()
        projected = _project_report_data(
            source=source_data, assessment=assessment.to_dict(), report_series_id=REPORT_SERIES_ID,
            report_version_id=REPORT_VERSION_ID, final_assessment_id=FINAL_ASSESSMENT_ID,
            version_number=1, generated_at="2026-08-26T20:00:00Z",
        )
        projected["reportDigest"] = canonical_package_digest(projected)
        return original, ValuationEvidenceReportV1.from_dict(projected)
    finally:
        fixture.tearDown()
        fixture.doCleanups()


class MarketEvidenceDisplayTests(unittest.TestCase):
    def test_projection_keeps_matching_facts_prices_dates_and_limits(self):
        search = fictional_search()
        before = copy.deepcopy(search)
        result = project_supporting_evidence(search)
        self.assertEqual(result["title"], SUPPORTING_TITLE)
        self.assertEqual(result["disclosure"], SUPPORTING_DISCLOSURE)
        self.assertFalse(result["affectsBaselineValuation"])
        listing = result["listings"][0]
        self.assertEqual(listing["askingPriceCents"], 2_400_000)
        self.assertEqual(listing["askingPriceDisplay"], "$24,000.00")
        self.assertEqual(listing["temporalBasis"], "Current-market listing")
        self.assertTrue(any("Warranty benefits were not fully verified" in value for value in listing["limitations"]))
        self.assertEqual(before, search)

    def test_price_display_or_valuation_flag_cannot_be_tampered(self):
        display = project_supporting_evidence(fictional_search())
        for change in ("price", "valuation"):
            value = copy.deepcopy(display)
            if change == "price":
                value["listings"][0]["askingPriceDisplay"] = "$50,000.00"
            else:
                value["affectsBaselineValuation"] = True
            with self.subTest(change=change), self.assertRaises(Exception):
                validate_market_evidence_display(value, "higherPricedComparableListings")

    def test_limited_search_does_not_claim_fair_value(self):
        result = project_market_search_context(fictional_search(limited=True))
        self.assertEqual(result["baselineStatus"], "LIMITED")
        self.assertIn("does not establish", result["summary"])
        self.assertTrue(any("request allowance" in value["description"] for value in result["stopReasons"]))
        self.assertIn("search was limited", LIMITED_NO_INCREASE_SUMMARY)

    def test_legacy_absence_stays_absent(self):
        self.assertIsNone(project_supporting_evidence(None))
        self.assertIsNone(project_market_search_context(None))

    def test_customer_report_projection_preserves_separation_and_scope(self):
        value = valid_report()
        before = copy.deepcopy(value["conclusion"])
        search = fictional_search(limited=True)
        value["marketEvidence"]["higherPricedComparableListings"] = project_supporting_evidence(search)
        value["marketEvidence"]["marketSearchContext"] = project_market_search_context(search)
        validated = validate_report_projection(value)
        self.assertEqual(validated["conclusion"], before)
        self.assertEqual(validated["marketEvidence"]["higherPricedComparableListings"]["title"], SUPPORTING_TITLE)

    def test_pdf_preserves_the_baseline_and_separate_supporting_section(self):
        original, report = fictional_supporting_report()
        baseline, updated = original.to_dict(), report.to_dict()
        for key in ("executiveConclusion", "adjustmentsAndCalculations", "evidenceReconciliation"):
            self.assertEqual(baseline[key], updated[key], key)
        for key in ("primary", "secondary", "comparables"):
            self.assertEqual(baseline["independentMarketEvidence"][key], updated["independentMarketEvidence"][key])
        pdf = render_valuation_evidence_report_pdf_v1(report)
        manifest = validate_valuation_evidence_report_pdf_v1(pdf, report)
        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            text = "\n".join(page.get_text() for page in document)
        self.assertIn(SUPPORTING_TITLE, text)
        self.assertIn("$24,000.00", text)
        self.assertIn("not typical market prices", text)
        self.assertEqual(manifest.to_dict()["status"], "PASS")


if __name__ == "__main__":
    unittest.main()
