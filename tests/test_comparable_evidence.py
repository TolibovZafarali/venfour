"""Offline fictional evidence tests; no provider requests or real vehicle facts."""

from __future__ import annotations

import copy
import unittest
from dataclasses import replace

from venfour.comparable_evidence import (
    SupportingShortlistPolicy, assess_observation, build_supporting_shortlist,
    listing_from_observation,
)
from venfour.comparables import ComparableTarget, rank_market_comparables
from venfour.discrepancy import (
    CurrentEvidenceInput, ValuationDiscrepancyRequest, analyze_valuation_discrepancy,
)
from venfour.market import MarketSearchRequest, MarketSearchResult


TARGET = ComparableTarget(
    year=2022, make="Synthetic", model="Sedan", trim="Touring", drivetrain="FWD",
    mileage=50_000, postal_code="63123",
)
FACTS = {
    "bodyType": "Sedan", "engine": "2.0L I4", "fuelType": "Gasoline",
    "transmission": "Automatic", "equipment": ["Standard seats"],
    "certified": False, "warranty": False,
}


def observation(index=1, *, price=20_000, purpose="baseline", **listing_overrides):
    listing = {
        "source": "synthetic-provider", "sourceListingId": f"fictional-{index}",
        "vin": f"SYNTHETICVIN{index:05d}", "listingUrl": f"https://synthetic.invalid/{index}",
        "year": TARGET.year, "make": TARGET.make, "model": TARGET.model, "trim": TARGET.trim,
        "drivetrain": TARGET.drivetrain, "mileage": TARGET.mileage, "price": price,
        "distanceMiles": 10, "dealer": None,
    }
    listing.update(listing_overrides)
    return {
        "listing": listing, "materialFacts": copy.deepcopy(FACTS),
        "location": {"verified": True, "latitude": 38.5, "longitude": -90.3, "postalCode": "63123"},
        "sourceEndpoint": "active", "stream": "current", "relevantDate": "2026-09-09",
        "dateVerified": True, "priceVerified": True, "purpose": purpose,
    }


def assess(item, **kwargs):
    return assess_observation(TARGET, item, subject_material_facts=FACTS, **kwargs)


def shortlist(items, **kwargs):
    return build_supporting_shortlist(TARGET, items, subject_material_facts=FACTS, **kwargs)


class EvidenceQualificationTests(unittest.TestCase):
    def test_estimate_unknowns_never_become_strict_supporting_evidence(self):
        result = assess_observation(replace(TARGET, drivetrain=None), observation(), free_estimate=True)
        self.assertTrue(result["baselineEligible"])
        self.assertTrue(result["estimateStrong"])
        self.assertFalse(result["strong"])
        self.assertFalse(result["supportingEligible"])
        self.assertIn("bodyType", result["unresolvedEstimateFacts"])
        self.assertFalse(assess_observation(TARGET, observation(), subject_material_facts={"bodyType": "SUV"}, free_estimate=True)["baselineEligible"])
        for changed in ({"dateVerified": False}, {"priceVerified": False}, {"purpose": "supporting"}, {"conflicted": True}, {"location": {}}):
            self.assertFalse(assess_observation(TARGET, {**observation(), **changed}, free_estimate=True)["baselineEligible"])

    def test_complete_facts_qualify_without_changing_legacy_score(self):
        result = assess(observation())
        self.assertTrue(result["baselineEligible"])
        self.assertTrue(result["strong"])
        self.assertEqual(result["score"], 100)

    def test_unknown_trim_cannot_become_false_strong(self):
        result = assess(observation(trim=None))
        self.assertEqual(result["score"], 90)
        self.assertFalse(result["baselineEligible"])
        self.assertFalse(result["strong"])
        self.assertIn("TRIM_UNKNOWN", result["reasonCodes"])

    def test_unknown_and_mismatch_have_distinct_reasons(self):
        unknown, mismatch = observation(), observation()
        unknown["materialFacts"].pop("engine")
        mismatch["materialFacts"]["engine"] = "3.0L V6"
        self.assertIn("ENGINE_UNKNOWN", assess(unknown)["reasonCodes"])
        self.assertIn("ENGINE_MISMATCH", assess(mismatch)["reasonCodes"])
        self.assertFalse(assess(unknown)["baselineEligible"])
        self.assertFalse(assess(mismatch)["baselineEligible"])

    def test_body_and_subject_material_unknown_remain_limited(self):
        item = observation()
        item["materialFacts"].pop("bodyType")
        self.assertFalse(assess(item)["baselineEligible"])
        self.assertFalse(assess_observation(TARGET, observation())["baselineEligible"])

    def test_known_body_configuration_conflict_is_not_masked_by_matching_trim(self):
        item = observation()
        subject = {**FACTS, "cabType": "Crew Cab"}
        item["materialFacts"]["cabType"] = "Regular Cab"
        result = assess_observation(TARGET, item, subject_material_facts=subject)
        self.assertFalse(result["baselineEligible"])
        self.assertIn("CABTYPE_MISMATCH", result["reasonCodes"])

    def test_redundant_provider_metadata_does_not_invalidate_verified_core_configuration(self):
        item = observation()
        item["materialFacts"].update(bodySubtype="Compact", doors=4, cylinders=4)
        result = assess(item)
        self.assertTrue(result["baselineEligible"])
        self.assertTrue(result["strong"])
        self.assertTrue(any("not independently corroborated" in text for text in result["optionalBenefitLimitations"]))
        rows = [observation(index) for index in range(2, 11)]
        item["listing"]["price"] = 24_000
        selected = shortlist(rows + [item])["listings"][0]
        self.assertNotIn("doors", selected["matchingFacts"])
        self.assertNotIn("cylinders", selected["matchingFacts"])
        self.assertEqual(selected["matchingFacts"]["engine"], "2.0L I4")

    def test_unknown_material_door_variant_is_not_covered_by_generic_body(self):
        for doors in (2, 3):
            item = observation()
            item["materialFacts"]["doors"] = doors
            result = assess(item)
            self.assertFalse(result["baselineEligible"])
            self.assertIn("DOORS_UNKNOWN", result["reasonCodes"])

    def test_known_redundant_metadata_conflicts_still_reject(self):
        for field, candidate, subject in (("doors", 4, 2), ("bodySubtype", "Compact", "Full-size"), ("cylinders", 4, 6)):
            item = observation()
            item["materialFacts"][field] = candidate
            result = assess_observation(TARGET, item, subject_material_facts={**FACTS, field: subject})
            self.assertFalse(result["baselineEligible"])
            self.assertIn(f"{field.upper()}_MISMATCH", result["reasonCodes"])

    def test_cylinder_metadata_must_agree_with_verified_engine(self):
        item = observation()
        item["materialFacts"]["cylinders"] = 6
        result = assess(item)
        self.assertFalse(result["baselineEligible"])
        self.assertIn("CYLINDERS_ENGINE_CONFLICT", result["reasonCodes"])

    def test_truck_cab_and_bed_configuration_cannot_remain_unknown(self):
        item = observation()
        item["materialFacts"]["bodyType"] = "Pickup"
        subject = {**FACTS, "bodyType": "Pickup"}
        result = assess_observation(TARGET, item, subject_material_facts=subject)
        self.assertFalse(result["baselineEligible"])
        self.assertIn("CABTYPE_UNKNOWN", result["reasonCodes"])
        self.assertIn("BEDLENGTH_UNKNOWN", result["reasonCodes"])
        item["materialFacts"].update(cabType="Crew Cab", bedLength="5.5 ft")
        self.assertTrue(assess_observation(TARGET, item, subject_material_facts={**subject, "cabType": "Crew Cab", "bedLength": "5.5 ft"})["baselineEligible"])

    def test_generic_trim_fingerprint_cannot_certify_body_and_powertrain(self):
        item = observation()
        fingerprint = {"configurationFingerprint": "Touring", "configurationVerified": True}
        item["materialFacts"] = copy.deepcopy(fingerprint)
        result = assess_observation(TARGET, item, subject_material_facts=fingerprint)
        self.assertFalse(result["baselineEligible"])
        detailed = {**fingerprint, "configurationFields": ["bodyType", "powertrain"]}
        item["materialFacts"] = copy.deepcopy(detailed)
        self.assertTrue(assess_observation(TARGET, item, subject_material_facts=detailed)["baselineEligible"])

    def test_price_changes_do_not_affect_quality_or_verification_order(self):
        low, high = observation(price=10_000), observation(price=100_000)
        first, second = assess(low), assess(high)
        for key in ("score", "tier", "qualityKey", "verificationEligible", "baselineEligible", "strong"):
            self.assertEqual(first[key], second[key], key)

    def test_historical_discovery_can_be_screened_but_not_priced_as_verified(self):
        item = observation()
        item.update(sourceEndpoint="recents", stream="historical", dateVerified=False, priceVerified=False, relevantDate="2026-08-01")
        result = assess(item, evidence_date="2026-08-01")
        self.assertTrue(result["verificationEligible"])
        self.assertFalse(result["baselineEligible"])
        item.update(sourceEndpoint="history", dateVerified=True, priceVerified=True)
        self.assertTrue(assess(item, evidence_date="2026-08-01")["baselineEligible"])
        self.assertFalse(assess(item, evidence_date="2026-07-01")["baselineEligible"])

    def test_supporting_mileage_gate_does_not_change_strong_baseline_eligibility(self):
        for mileage in (40_000, 60_000):
            item = observation(mileage=mileage, price=24_000)
            result = assess(item)
            self.assertTrue(result["baselineEligible"])
            self.assertTrue(result["strong"])
            self.assertEqual(result["score"], 85)
            self.assertTrue(result["verificationEligible"])
            self.assertFalse(result["supportingVerificationEligible"])
            self.assertFalse(result["supportingEligible"])
            self.assertIn("SUPPORTING_MILEAGE_WINDOW_EXCEEDED", result["reasonCodes"])
            self.assertIn({"field": "mileage", "subject": 50_000, "listing": mileage, "reason": "MILEAGE_DIFFERENCE"}, result["differences"])

    def test_supporting_mileage_window_requires_both_absolute_and_relative_bounds(self):
        for mileage in (45_000, 55_000):
            self.assertTrue(assess(observation(mileage=mileage))["supportingEligible"])
        for mileage in (44_999, 55_001):
            self.assertFalse(assess(observation(mileage=mileage))["supportingEligible"])
        low_mileage_target = replace(TARGET, mileage=10_000)
        for mileage, eligible in ((9_000, True), (11_000, True), (8_999, False), (11_001, False)):
            result = assess_observation(low_mileage_target, observation(mileage=mileage), subject_material_facts=FACTS)
            self.assertEqual(result["supportingEligible"], eligible)

    def test_supporting_history_screen_checks_mileage_before_date_and_price_lookup(self):
        for mileage, eligible in ((40_000, False), (49_000, True)):
            item = observation(mileage=mileage)
            item.update(sourceEndpoint="recents", stream="historical", dateVerified=False, priceVerified=False)
            result = assess(item)
            self.assertTrue(result["verificationEligible"])
            self.assertEqual(result["supportingVerificationEligible"], eligible)
            self.assertFalse(result["supportingEligible"])

    def test_location_mileage_and_date_are_required(self):
        no_location, wrong_date = observation(), observation()
        no_location["location"]["verified"] = False
        wrong_date["relevantDate"] = "not-a-date"
        for item in (no_location, wrong_date, observation(mileage=None), observation(distanceMiles=251)):
            with self.subTest(item=item):
                self.assertFalse(assess(item)["baselineEligible"])

    def test_supporting_discovery_cannot_enter_baseline(self):
        result = assess(observation(purpose="supporting"))
        self.assertTrue(result["supportingEligible"])
        self.assertFalse(result["baselineEligible"])
        self.assertFalse(result["strong"])

    def test_subject_vehicle_cannot_count_as_independent_evidence(self):
        item = observation()
        result = assess_observation(TARGET, item, subject_material_facts={**FACTS, "vin": item["listing"]["vin"]})
        self.assertFalse(result["baselineEligible"])
        self.assertIn("SUBJECT_VEHICLE_EXCLUDED", result["reasonCodes"])

    def test_invalid_price_and_malformed_listing_do_not_qualify(self):
        for item in (observation(price=0), observation(price=float("nan")), observation(year="invalid")):
            with self.subTest(item=item):
                self.assertFalse(assess(item)["baselineEligible"])


class SupportingEvidenceTests(unittest.TestCase):
    def test_cheaper_close_mileage_example_survives_unexplained_lower_mileage_premium(self):
        baseline = [observation(index) for index in range(1, 10)]
        expensive_far = observation(10, price=24_000, mileage=40_000)
        cheaper_close = observation(11, price=22_000, mileage=49_000)
        cheap_baseline = observation(12, price=18_000)
        rows = baseline + [expensive_far, cheaper_close, cheap_baseline]
        before = copy.deepcopy(rows)
        result = shortlist(rows)
        self.assertEqual([item["verifiedAskingPrice"] for item in result["listings"]], [22_000])
        self.assertEqual(len([item for item in rows if assess(item)["baselineEligible"]]), 12)
        self.assertEqual(rows, before)
        selected = result["listings"][0]
        self.assertIn({"field": "mileage", "subject": 50_000, "listing": 49_000, "reason": "MILEAGE_DIFFERENCE"}, selected["materialDifferences"])
        self.assertTrue(any("1,000 miles lower" in value for value in selected["limitations"]))
        self.assertTrue(any("SUPPORTING_MILEAGE_WINDOW_EXCEEDED" in item["reasonCodes"] for item in result["exclusions"]))

    def test_equivalent_quality_prefers_price_but_preserves_all_baseline_observations(self):
        baseline = [observation(index, price=20_000) for index in range(1, 10)]
        expensive = [observation(10, price=24_000, purpose="supporting"), observation(11, price=23_000, purpose="supporting")]
        items = baseline + expensive
        before = copy.deepcopy(items)
        result = shortlist(items, policy=SupportingShortlistPolicy(maximum_listings=2))
        self.assertEqual([item["verifiedAskingPrice"] for item in result["listings"]], [24_000, 23_000])
        self.assertEqual(items, before)
        self.assertEqual(sum(assess(item)["baselineEligible"] for item in items), 9)
        self.assertFalse(result["affectsBaselineValuation"])

    def test_better_mileage_outranks_price_even_when_both_remain_strong(self):
        items = [observation(index) for index in range(1, 10)]
        items.extend([
            observation(10, price=24_000, purpose="supporting", mileage=51_000),
            observation(11, price=23_000, purpose="supporting", mileage=50_000),
        ])
        result = shortlist(items)
        self.assertEqual([item["verifiedAskingPrice"] for item in result["listings"]], [23_000, 24_000])

    def test_premium_equipment_certification_warranty_or_unknown_context_excludes_shortlist(self):
        baseline = [observation(index) for index in range(1, 10)]
        for change in ({"certified": True}, {"warranty": True}, {"equipment": ["Superior seats"]}, {"equipment": None}):
            item = observation(10, price=24_000, purpose="supporting")
            item["materialFacts"].update(change)
            with self.subTest(change=change):
                self.assertEqual(shortlist(baseline + [item])["listings"], [])

    def test_unknown_optional_warranty_is_disclosed_without_inventing_absence(self):
        baseline = [observation(index) for index in range(1, 10)]
        item = observation(10, price=24_000, purpose="supporting")
        item["materialFacts"]["warranty"] = None
        item["materialFacts"]["certified"] = None
        result = shortlist(baseline + [item])
        self.assertEqual(len(result["listings"]), 1)
        selected = result["listings"][0]
        self.assertNotIn("warranty", selected["matchingFacts"])
        self.assertTrue(any("Warranty benefits were not fully verified" in text for text in selected["limitations"]))

    def test_empty_report_accessories_and_unreported_listing_accessories_remain_unknown(self):
        item = observation()
        item["materialFacts"]["equipment"] = None
        result = assess_observation(TARGET, item, subject_material_facts={**FACTS, "equipment": []})
        self.assertTrue(result["baselineEligible"])
        self.assertTrue(result["supportingEligible"])
        self.assertTrue(any("Optional accessories were not fully verified" in text for text in result["optionalBenefitLimitations"]))

    def test_price_preference_changes_only_within_exact_quality_equivalence(self):
        items = [observation(index) for index in range(1, 10)] + [observation(10, price=24_000, purpose="supporting"), observation(11, price=23_000, purpose="supporting")]
        first = shortlist(items)["listings"]
        items[-1]["listing"]["price"] = 24_500
        second = shortlist(items)["listings"]
        self.assertNotEqual(first[0]["identity"], second[0]["identity"])

    def test_conflicting_duplicate_prices_never_resolve_upward(self):
        baseline = [observation(index) for index in range(1, 10)]
        high, low = observation(10, price=24_000), observation(10, price=22_000)
        result = shortlist(baseline + [high, low])
        self.assertEqual(result["listings"], [])
        self.assertEqual(result["reassessmentRequired"][0]["reason"], "CONFLICTING_OBSERVATIONS")

    def test_same_vin_at_different_dates_does_not_create_a_price_conflict(self):
        current = [observation(index) for index in range(1, 10)]
        current.append(observation(10, price=24_000, purpose="supporting"))
        historical = copy.deepcopy(current)
        for item in historical:
            item.update(stream="historical", sourceEndpoint="history", relevantDate="2026-08-01")
            item["listing"]["mileage"] = 49_900
            item["listing"]["price"] -= 500
        result = shortlist(current + historical, evidence_date="2026-08-01")
        self.assertEqual(result["reassessmentRequired"], [])
        self.assertEqual(len(result["listings"]), 1)

    def test_cross_date_material_identity_conflict_requires_reassessment(self):
        items = [observation(index) for index in range(1, 10)]
        current = observation(10, price=24_000, purpose="supporting")
        historical = copy.deepcopy(current)
        historical.update(stream="historical", sourceEndpoint="history", relevantDate="2026-08-01")
        historical["materialFacts"]["engine"] = "3.0L V6"
        result = shortlist(items + [current, historical], evidence_date="2026-08-01")
        self.assertEqual(result["listings"], [])
        self.assertEqual(result["reassessmentRequired"][0]["reason"], "CONFLICTING_OBSERVATIONS")

    def test_malformed_prices_cannot_crash_shortlist_construction(self):
        result = shortlist([observation(price=float("nan"))])
        self.assertEqual(result["listings"], [])

    def test_outlier_check_is_symmetric_and_does_not_modify_baseline(self):
        baseline = [observation(index) for index in range(1, 10)]
        items = baseline + [observation(10, price=40_000), observation(11, price=1_000)]
        result = shortlist(items)
        outliers = [item for item in result["exclusions"] if item["reasonCodes"] == ["SYMMETRIC_PRICE_OUTLIER"]]
        self.assertEqual(len(outliers), 2)
        self.assertEqual(sum(assess(item)["baselineEligible"] for item in items), 11)

    def test_expensive_examples_preserve_a_broader_finding_supporting_the_offer(self):
        baseline = [observation(index) for index in range(1, 10)]
        expensive = [observation(10, price=24_000, purpose="supporting"), observation(11, price=23_000, purpose="supporting")]
        items = baseline + expensive

        def discrepancy(offer):
            listings = tuple(listing_from_observation(item) for item in items if assess(item)["baselineEligible"])
            request = MarketSearchRequest(
                year=TARGET.year, make=TARGET.make, model=TARGET.model, trim=TARGET.trim,
                drivetrain=TARGET.drivetrain, loss_vehicle_mileage=TARGET.mileage,
                postal_code=TARGET.postal_code, radius_miles=100, result_limit=9,
            )
            ranking = rank_market_comparables(TARGET, MarketSearchResult(provider="synthetic-provider", request=request, listings=listings))
            return analyze_valuation_discrepancy(ValuationDiscrepancyRequest(
                loss_vehicle=TARGET, ccc_vehicle_valuation=offer / 100,
                loss_date="2026-08-01", ccc_comparables=(),
                current_evidence=CurrentEvidenceInput(ranking=ranking, observed_date="2026-09-09"),
            ))

        before = discrepancy(2_000_000)
        support = shortlist(items)
        after = discrepancy(2_000_000)
        self.assertEqual(before.to_dict(), after.to_dict())
        self.assertEqual(after.classification, "NO_MATERIAL_DISCREPANCY")
        self.assertEqual(len(support["listings"]), 2)
        different_offer = discrepancy(1_500_000)
        self.assertEqual(after.current_external_summary.prices, different_offer.current_external_summary.prices)


if __name__ == "__main__":
    unittest.main()
