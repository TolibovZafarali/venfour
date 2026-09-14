"""Fictional offline free-result cases; no provider calls or customer records."""

import copy
import unittest
from dataclasses import replace
from unittest.mock import patch

from tests.test_comparable_evidence import FACTS, TARGET, observation as fixture_observation
from venfour.comparable_evidence import assess_observation, listing_from_observation, observation_identity
from venfour.comparables import rank_market_comparables
from venfour.discrepancy import CurrentEvidenceInput, ValuationDiscrepancyRequest, analyze_valuation_discrepancy
from venfour.market import MarketSearchRequest, MarketSearchResult
from venfour.preliminary_result import build_preliminary_result, validate_preliminary_result


def observation(index=1, **kwargs):
    row = fixture_observation(index, **kwargs)
    if "vin" not in kwargs:
        row["listing"]["vin"] = f"1HGCM82633A{index:06d}"
    return row


def prepare(rows, *, target=TARGET, facts=FACTS, offer=20000):
    rows = copy.deepcopy(rows)
    for row in rows:
        row["location"]["distanceOrigin"] = "CUSTOMER_POSTAL_AREA"
        row["assessment"] = assess_observation(target, row, subject_material_facts=facts,
                                              free_estimate=True, evidence_date="2026-08-11")
    request = MarketSearchRequest(year=target.year, make=target.make, model=target.model, trim=target.trim,
                                  drivetrain=target.drivetrain, drivetrain_recorded=True,
                                  loss_vehicle_mileage=target.mileage, postal_code=target.postal_code,
                                  radius_miles=250, result_limit=100)
    unique = {}
    for row in rows:
        if row["stream"] == "current" and row["assessment"]["baselineEligible"]:
            unique.setdefault(observation_identity(row), listing_from_observation(row))
    market = MarketSearchResult(provider="synthetic-provider", request=request, listings=tuple(unique.values()))
    discrepancy_request = ValuationDiscrepancyRequest(
        loss_vehicle=target, ccc_vehicle_valuation=offer, ccc_comparables=(), loss_date="2026-08-11",
        current_evidence=CurrentEvidenceInput(rank_market_comparables(target, market), "2026-09-09"),
    )
    result = analyze_valuation_discrepancy(discrepancy_request).to_dict()
    search = {"input": {"subjectFacts": facts, "observedDate": "2026-09-09"}, "observations": rows}
    return search, result, discrepancy_request.to_dict()


def project(rows, **kwargs):
    search, strict, request = prepare(rows, **kwargs)
    return build_preliminary_result(market_search=search, discrepancy_result=strict, discrepancy_request=request)


class PreliminaryResultTests(unittest.TestCase):
    def setUp(self):
        self.network = patch("socket.create_connection", side_effect=AssertionError("Offline test network prohibited"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_strong_and_good_existing_evidence_can_support_range_without_offer(self):
        for mileage, distance in ((50000, 10), (57000, 180)):
            rows = [observation(index, price=20000 + index * 200, mileage=mileage, distanceMiles=distance)
                    for index in range(3)]
            result = project(rows, offer=None)
            self.assertEqual(result["outcome"], "ESTIMATE")
            self.assertEqual(result["estimatedRange"], {"lowCents": 2000000, "highCents": 2040000})
            self.assertIsNone(result["insurerComparison"])
            if mileage == 57000:
                self.assertTrue(all(row["assessment"]["tier"] == "GOOD" for row in prepare(rows)[0]["observations"]))

    def test_one_and_two_listings_are_context_not_subject_value(self):
        for count in (1, 2):
            result = project([observation(i, price=20000 + 1000 * i) for i in range(count)])
            self.assertEqual(result["outcome"], "LISTING_CONTEXT")
            self.assertEqual(result["sampleSize"], count)
            self.assertIsNone(result["estimatedRange"])
            self.assertIsNone(result["insurerComparison"])

    def test_zero_or_only_unusable_records_is_insufficient(self):
        for rows in ([], [observation(trim="Different")], [observation(mileage=80000)],
                     [observation(distanceMiles=251)]):
            result = project(rows)
            self.assertEqual(result["outcome"], "INSUFFICIENT")
            self.assertEqual(result["sampleSize"], 0)

    def test_certification_unknown_or_mismatch_remains_context_only(self):
        for certification in (None, False):
            rows = [observation(i) for i in range(3)]
            for row in rows:
                row["materialFacts"]["certified"] = True
            result = project(rows, facts={**FACTS, "certified": certification})
            self.assertEqual(result["outcome"], "LISTING_CONTEXT")
            self.assertTrue(all(row["certified"] for row in result["listings"]))
            self.assertTrue(any("certified" in text for text in result["limitations"]))
            self.assertIsNone(result["estimatedRange"])

    def test_significant_mileage_difference_does_not_become_adjusted_value(self):
        rows = [observation(i, mileage=TARGET.mileage + 15000) for i in range(3)]
        result = project(rows)
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")
        self.assertTrue(any("mileage" in text for text in result["limitations"]))
        self.assertTrue(all(row["askingPriceCents"] == 2000000 for row in result["listings"]))

    def test_partial_facts_are_not_conflicts_or_customer_homework(self):
        rows = [observation(i) for i in range(3)]
        partial = {"bodyType": "Sedan", "certified": False}
        result = project(rows, facts=partial)
        self.assertEqual(result["outcome"], "ESTIMATE")
        self.assertTrue(any("unverified" in text for text in result["limitations"]))
        strict = assess_observation(TARGET, rows[0], subject_material_facts=partial)
        self.assertFalse(strict["baselineEligible"])
        self.assertNotIn("correctionStep", result)

    def test_known_configuration_conflicts_remain_disqualifying(self):
        for field, value in (("bodyType", "SUV"), ("engine", "3.0L V6"), ("fuelType", "Diesel"),
                             ("transmission", "Manual")):
            row = observation()
            row["materialFacts"][field] = value
            self.assertEqual(project([row])["outcome"], "INSUFFICIENT", field)
        self.assertEqual(project([observation(drivetrain="AWD")])["outcome"], "INSUFFICIENT")

    def test_unknown_subject_variant_does_not_allow_heterogeneous_estimate(self):
        rows = [observation(i) for i in range(4)]
        for row in rows[2:]:
            row["materialFacts"]["bodyType"] = "SUV"
        result = project(rows, facts={})
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")
        self.assertEqual(result["sampleSize"], 4)

    def test_unknown_variant_outside_selected_sample_cannot_be_hidden_by_rank(self):
        rows = [observation(i) for i in range(11)]
        for row in rows[9:]:
            row["materialFacts"]["bodyType"] = "SUV"
            row["listing"]["distanceMiles"] = 200
        result = project(rows, facts={})
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")

    def test_insurer_offer_does_not_select_evidence_or_move_price_span(self):
        rows = [observation(i, price=20000 + i * 100) for i in range(4)]
        self.assertEqual(project(rows, offer=10000), project(rows, offer=50000))
        sparse = rows[:2]
        self.assertEqual(project(sparse, offer=None), project(sparse, offer=99999))

    def test_equally_relevant_lower_prices_and_supporting_isolation(self):
        rows = [observation(i, price=19000 + i * 1000) for i in range(3)]
        baseline = project(rows)
        self.assertEqual(baseline["estimatedRange"]["lowCents"], 1900000)
        self.assertEqual(project(rows + [observation(50, price=50000, purpose="supporting")]), baseline)

    def test_duplicate_vins_do_not_inflate_sample_across_streams(self):
        current = observation()
        history = copy.deepcopy(current)
        history.update(stream="historical", sourceEndpoint="history", relevantDate="2026-08-11")
        result = project([current, copy.deepcopy(current), history])
        self.assertEqual(result["sampleSize"], 1)
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")
        self.assertEqual(result["evidenceBasis"], "CURRENT_MARKET")

    def test_unproven_vehicle_identities_cannot_support_an_estimate(self):
        for missing in (True, False):
            rows = [observation(i, vin=None if missing else f"unverified-vin-{i}") for i in range(3)]
            search, strict, request = prepare(rows)
            self.assertEqual(strict["currentExternalSummary"]["selectedCount"], 3)
            self.assertTrue(all(row["assessment"]["baselineEligible"] for row in search["observations"]))
            result = build_preliminary_result(market_search=search, discrepancy_result=strict, discrepancy_request=request)
            self.assertEqual(result["outcome"], "LISTING_CONTEXT")
            self.assertEqual(result["sampleSize"], 3)
            self.assertIsNone(result["estimatedRange"])
            self.assertTrue(any("independent vehicle count" in text for text in result["limitations"]))
            self.assertTrue(all(any("valid VIN" in text for text in row["limitations"]) for row in result["listings"]))

    def test_unverified_history_never_enters_any_span(self):
        row = observation(price=90000)
        row.update(stream="historical", sourceEndpoint="recents", relevantDate="2026-08-11",
                   dateVerified=False, priceVerified=False)
        result = project([row, observation(2, price=22000)])
        self.assertEqual(result["listingPriceSpan"], {"lowCents": 2200000, "highCents": 2200000})
        self.assertEqual(project([row])["outcome"], "INSUFFICIENT")

    def test_verified_historical_context_is_explicit_and_never_blended(self):
        history = observation(price=22000)
        history.update(stream="historical", sourceEndpoint="history", relevantDate="2026-08-11")
        result = project([history])
        self.assertEqual(result["evidenceBasis"], "LOSS_DATE_HISTORICAL")
        self.assertEqual(result["evidenceDate"], "2026-08-11")
        self.assertIsNone(result["insurerComparison"])
        self.assertEqual(project([history, observation(2, price=25000)])["listingPriceSpan"],
                         {"lowCents": 2500000, "highCents": 2500000})

    def test_high_dispersion_does_not_become_low_confidence_valuation(self):
        result = project([observation(i, price=price) for i, price in enumerate((10000, 20000, 30000))])
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")

    def test_robust_median_does_not_hide_an_extreme_range_endpoint(self):
        rows = [observation(i, price=20000 if i < 8 else 100000) for i in range(9)]
        search, strict, request = prepare(rows)
        self.assertEqual(strict["currentExternalSummary"]["prices"]["dispersionBasisPoints"], 0)
        result = build_preliminary_result(market_search=search, discrepancy_result=strict, discrepancy_request=request)
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")
        self.assertIsNone(result["estimatedRange"])
        self.assertEqual(result["listingPriceSpan"], {"lowCents": 2000000, "highCents": 10000000})

    def test_interruption_is_not_an_evidence_outcome(self):
        for reason in ("PROVIDER_FAILURE", "BUDGET_OR_QUOTA_LIMITED", "OBSERVATION_LIMIT"):
            search, strict, request = prepare([])
            search["stopReasons"] = {"current": reason}
            self.assertIsNone(build_preliminary_result(market_search=search, discrepancy_result=strict,
                                                      discrepancy_request=request))

    def test_fictional_sparse_regression_preserves_strict_tiers_and_prices(self):
        target = replace(TARGET, mileage=2908)
        subject = {"bodyType": "SUV", "doors": "5", "engine": "2.0L (family: fictional family)",
                   "cylinders": "4", "fuelType": "Unleaded", "transmission": "Automatic", "certified": None}
        rows = [observation(1, mileage=14725, distanceMiles=103.21, price=23077),
                observation(2, mileage=18812, distanceMiles=183.53, price=25333)]
        for index, row in enumerate(rows):
            row["materialFacts"] = {**subject, "engine": "2.0L I4", "transmission": "CVT", "certified": True if index == 0 else None}
        search, strict, request = prepare(rows, target=target, facts=subject, offer=25704)
        before = copy.deepcopy((search, strict, request))
        result = build_preliminary_result(market_search=search, discrepancy_result=strict, discrepancy_request=request)
        self.assertEqual(result["outcome"], "LISTING_CONTEXT")
        self.assertEqual(result["listingPriceSpan"], {"lowCents": 2307700, "highCents": 2533300})
        self.assertEqual([row["assessment"]["score"] for row in search["observations"]], [76.45, 67.79])
        self.assertTrue(all(row["assessment"]["tier"] == "INELIGIBLE" for row in search["observations"]))
        self.assertEqual(strict["classification"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual((search, strict, request), before)

    def test_contract_rejects_fake_range_or_context_offer_comparison(self):
        result = project([observation()])
        for change in ({"outcome": "ESTIMATE"}, {"sampleSize": 2},
                       {"estimatedRange": result["listingPriceSpan"]},
                       {"insurerComparison": {"insurerValueCents": 1000000, "position": "BELOW_RANGE"}}):
            with self.assertRaises(ValueError):
                validate_preliminary_result({**result, **change})
        estimate = project([observation(i) for i in range(3)])
        estimate["listings"][0]["identity"] = "listing:synthetic-provider:unproven"
        with self.assertRaises(ValueError):
            validate_preliminary_result(estimate)


if __name__ == "__main__":
    unittest.main()
