"""Deterministic tests for provider-neutral comparable matching and scoring.

Every vehicle, dealer, identifier, URL, VIN, and price in this module is
synthetic test data.  The Elantra- and Camry-shaped cases preserve only the
similarity patterns described in the Phase 3C brief; they are not live listings
and their prices are intentionally invented and non-authoritative.
"""

from __future__ import annotations

import copy
import dataclasses
import json
import math
import unittest
from decimal import Decimal
from typing import Any
from unittest.mock import patch

from jsonschema import Draft202012Validator

from venfour.comparables import (
    CANDIDATE_SCHEMA_PATH,
    DISTANCE_MAX_SCORE,
    MILEAGE_MAX_SCORE,
    RANKING_RESULT_SCHEMA_PATH,
    TARGET_SCHEMA_PATH,
    TRIM_MAX_SCORE,
    YEAR_MAX_SCORE,
    ComparableContractError,
    ComparableTarget,
    comparable_target_from_report,
    comparable_target_from_search_request,
    rank_market_comparables,
    validate_comparable_candidate,
    validate_comparable_ranking_result,
    validate_comparable_target,
)
from venfour.market import (
    LISTING_SCHEMA_PATH,
    MarketDealer,
    MarketListing,
    MarketSearchRequest,
    MarketSearchResult,
)


SYNTHETIC_PROVIDER = "synthetic-provider"


def make_target(**overrides: Any) -> ComparableTarget:
    """Return an explicitly synthetic loss-vehicle target."""

    values: dict[str, Any] = {
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "mileage": 46_926,
        "postal_code": "63123",
    }
    values.update(overrides)
    return ComparableTarget(**values)


def make_request(**overrides: Any) -> MarketSearchRequest:
    """Return the provider-neutral request corresponding to ``make_target``."""

    values: dict[str, Any] = {
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "loss_vehicle_mileage": 46_926,
        "postal_code": "63123",
        "radius_miles": 50,
        "result_limit": 25,
    }
    values.update(overrides)
    return MarketSearchRequest(**values)


def make_listing(**overrides: Any) -> MarketListing:
    """Return one explicitly synthetic canonical market listing."""

    values: dict[str, Any] = {
        "source": SYNTHETIC_PROVIDER,
        "source_listing_id": None,
        "listing_url": "https://synthetic.invalid/listing",
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "vin": "SYNTHETICVIN00001",
        "mileage": 46_926,
        "price": 25_000,
        "dealer": MarketDealer(
            name="Synthetic Motors",
            city="Test City",
            state="MO",
            postal_code="63123",
        ),
        "distance_miles": 10,
    }
    values.update(overrides)
    return MarketListing(**values)


def make_result(
    *listings: MarketListing,
    request: MarketSearchRequest | None = None,
    provider: str = SYNTHETIC_PROVIDER,
) -> MarketSearchResult:
    """Wrap synthetic listings in the existing canonical result contract."""

    return MarketSearchResult(
        provider=provider,
        request=request if request is not None else make_request(),
        listings=listings,
    )


def rank_one(
    *,
    target: ComparableTarget | None = None,
    listing: MarketListing | None = None,
):
    """Rank and return one synthetic candidate."""

    ranked = rank_market_comparables(
        target if target is not None else make_target(),
        make_result(listing if listing is not None else make_listing()),
    )
    return ranked.candidates[0]


def candidate_id(candidate: Any) -> str | None:
    return candidate.listing.source_listing_id


class ComparableTargetContractTests(unittest.TestCase):
    def test_target_serializes_only_provider_neutral_matching_fields(self) -> None:
        target = make_target()

        self.assertEqual(
            target.to_dict(),
            {
                "year": 2024,
                "make": "Hyundai",
                "model": "Elantra",
                "trim": "SEL",
                "mileage": 46_926,
                "postalCode": "63123",
            },
        )
        validate_comparable_target(target)

    def test_target_normalizes_outer_whitespace_and_blank_optionals(self) -> None:
        target = ComparableTarget(
            year=2024,
            make="  Hyundai  ",
            model="  Elantra  ",
            trim="   ",
            mileage=None,
            postal_code="   ",
        )

        self.assertEqual(target.make, "Hyundai")
        self.assertEqual(target.model, "Elantra")
        self.assertIsNone(target.trim)
        self.assertIsNone(target.postal_code)
        validate_comparable_target(target)

    def test_report_factory_uses_only_loss_vehicle_facts(self) -> None:
        report = {
            "vehicle": {
                "year": 2025,
                "make": "Toyota",
                "model": "Camry",
                "trim": "SE",
                "mileage": 7_192,
                "location": "Synthetic City, MO 99999",
                "bodyStyle": "Sedan",
            },
            "claim": {"unrelated": "ignored"},
        }

        target = comparable_target_from_report(report, postal_code="63123")

        self.assertEqual(
            target,
            ComparableTarget(
                year=2025,
                make="Toyota",
                model="Camry",
                trim="SE",
                mileage=7_192,
                postal_code="63123",
            ),
        )

    def test_report_factory_does_not_guess_postal_code_from_location(self) -> None:
        report = {
            "vehicle": {
                "year": 2024,
                "make": "Hyundai",
                "model": "Elantra",
                "trim": "SEL",
                "mileage": 46_926,
                "location": "Synthetic City, MO 99999",
            }
        }

        target = comparable_target_from_report(report)

        self.assertIsNone(target.postal_code)

    def test_report_factory_allows_genuinely_missing_optional_facts(self) -> None:
        target = comparable_target_from_report(
            {
                "vehicle": {
                    "year": 2024,
                    "make": "Hyundai",
                    "model": "Elantra",
                }
            }
        )

        self.assertIsNone(target.trim)
        self.assertIsNone(target.mileage)
        self.assertIsNone(target.postal_code)
        validate_comparable_target(target)

    def test_report_factory_rejects_non_object_or_missing_vehicle(self) -> None:
        for report in ([], {}, {"vehicle": []}):
            with self.subTest(report=report), self.assertRaises(
                ComparableContractError
            ):
                comparable_target_from_report(report)  # type: ignore[arg-type]

    def test_report_factory_rejects_missing_required_vehicle_fact(self) -> None:
        report = {"vehicle": {"year": 2024, "make": "Hyundai"}}

        with self.assertRaises(ComparableContractError) as raised:
            comparable_target_from_report(report)

        self.assertTrue(any("model" in detail for detail in raised.exception.details))

    def test_search_request_factory_maps_canonical_fields(self) -> None:
        request = make_request(
            year=2025,
            make=" Toyota ",
            model=" Camry ",
            trim=" SE ",
            loss_vehicle_mileage=7_192,
        )

        target = comparable_target_from_search_request(request)

        self.assertEqual(
            target,
            ComparableTarget(
                year=2025,
                make="Toyota",
                model="Camry",
                trim="SE",
                mileage=7_192,
                postal_code="63123",
            ),
        )

    def test_search_request_factory_validates_entire_request(self) -> None:
        invalid_request = make_request(radius_miles=-1)

        with self.assertRaises(ComparableContractError) as raised:
            comparable_target_from_search_request(invalid_request)

        self.assertTrue(
            any("radiusMiles" in detail for detail in raised.exception.details)
        )

    def test_target_contract_rejects_invalid_required_values(self) -> None:
        invalid_targets = (
            ComparableTarget(year=-1, make="Hyundai", model="Elantra"),
            ComparableTarget(year=2024, make="   ", model="Elantra"),
            ComparableTarget(year=2024, make="Hyundai", model="   "),
            ComparableTarget(
                year=2024, make="Hyundai", model="Elantra", mileage=-1
            ),
        )

        for target in invalid_targets:
            with self.subTest(target=target), self.assertRaises(
                ComparableContractError
            ):
                validate_comparable_target(target)

    def test_target_contract_rejects_unknown_fields(self) -> None:
        target = make_target().to_dict()
        target["providerQuery"] = "provider-specific"

        with self.assertRaises(ComparableContractError):
            validate_comparable_target(target)


class ComparableEligibilityTests(unittest.TestCase):
    def test_exact_make_and_model_are_eligible(self) -> None:
        candidate = rank_one()

        self.assertTrue(candidate.eligible)
        self.assertIn("EXACT_MAKE", candidate.reasons)
        self.assertIn("EXACT_MODEL", candidate.reasons)

    def test_different_make_is_ineligible_with_explicit_reason(self) -> None:
        candidate = rank_one(listing=make_listing(make="Toyota"))

        self.assertFalse(candidate.eligible)
        self.assertIsNone(candidate.score)
        self.assertEqual(candidate.tier, "INELIGIBLE")
        self.assertIsNone(candidate.rank)
        self.assertIn("MAKE_MISMATCH", candidate.reasons)
        self.assertIn("EXACT_MODEL", candidate.reasons)

    def test_different_model_is_ineligible_with_explicit_reason(self) -> None:
        candidate = rank_one(listing=make_listing(model="Sonata"))

        self.assertFalse(candidate.eligible)
        self.assertIn("MODEL_MISMATCH", candidate.reasons)
        self.assertIn("EXACT_MAKE", candidate.reasons)

    def test_make_model_matching_is_case_and_whitespace_insensitive(self) -> None:
        target = make_target(
            make="  HYUNDAI  ",
            model="  Elantra   N  ",
            trim=" SEL   Convenience ",
        )
        listing = make_listing(
            make=" hyundai ",
            model=" elantra n ",
            trim="sel convenience",
        )

        candidate = rank_one(target=target, listing=listing)

        self.assertTrue(candidate.eligible)
        self.assertEqual(candidate.components.trim.match, "EXACT")
        self.assertEqual(candidate.score, 100)

    def test_all_listings_are_retained_and_ineligible_order_is_stable(self) -> None:
        listings = (
            make_listing(
                source_listing_id="wrong-make",
                make="Toyota",
                mileage=46_926,
            ),
            make_listing(
                source_listing_id="eligible",
                mileage=47_926,
            ),
            make_listing(
                source_listing_id="wrong-model",
                model="Sonata",
                mileage=46_926,
            ),
        )

        ranked = rank_market_comparables(make_target(), make_result(*listings))

        self.assertEqual(ranked.total_listing_count, 3)
        self.assertEqual(ranked.eligible_count, 1)
        self.assertEqual(ranked.ineligible_count, 2)
        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["eligible", "wrong-make", "wrong-model"],
        )
        self.assertEqual(
            [candidate.tier for candidate in ranked.candidates],
            ["STRONG", "INELIGIBLE", "INELIGIBLE"],
        )


class ComparableComponentScoringTests(unittest.TestCase):
    def test_component_maximums_document_the_100_point_weighting(self) -> None:
        self.assertEqual(
            (
                YEAR_MAX_SCORE,
                TRIM_MAX_SCORE,
                MILEAGE_MAX_SCORE,
                DISTANCE_MAX_SCORE,
            ),
            (20, 20, 50, 10),
        )
        self.assertEqual(
            YEAR_MAX_SCORE
            + TRIM_MAX_SCORE
            + MILEAGE_MAX_SCORE
            + DISTANCE_MAX_SCORE,
            100,
        )

    def test_year_scores_are_exact_and_symmetric(self) -> None:
        for year, expected_difference, expected_score, expected_reason in (
            (2024, 0, 20, "EXACT_YEAR"),
            (2023, 1, 12, "YEAR_DIFFERENCE_ONE"),
            (2025, 1, 12, "YEAR_DIFFERENCE_ONE"),
            (2022, 2, 4, "YEAR_DIFFERENCE_MULTIPLE"),
            (2026, 2, 4, "YEAR_DIFFERENCE_MULTIPLE"),
            (2021, 3, 0, "YEAR_DIFFERENCE_MULTIPLE"),
            (2027, 3, 0, "YEAR_DIFFERENCE_MULTIPLE"),
        ):
            with self.subTest(year=year):
                candidate = rank_one(listing=make_listing(year=year))
                self.assertEqual(
                    candidate.components.year.difference, expected_difference
                )
                self.assertEqual(candidate.components.year.score, expected_score)
                self.assertIn(expected_reason, candidate.reasons)

    def test_trim_scoring_distinguishes_exact_different_and_missing(self) -> None:
        cases = (
            (make_target(), "SEL", 20, "EXACT", "EXACT_TRIM"),
            (make_target(), "Limited", 0, "DIFFERENT", "DIFFERENT_TRIM"),
            (
                make_target(),
                None,
                10,
                "LISTING_UNAVAILABLE",
                "LISTING_TRIM_UNAVAILABLE",
            ),
            (
                make_target(trim=None),
                "SEL",
                10,
                "TARGET_UNAVAILABLE",
                "TARGET_TRIM_UNAVAILABLE",
            ),
            (
                make_target(trim=None),
                None,
                10,
                "UNAVAILABLE",
                "TRIM_UNAVAILABLE",
            ),
        )

        for target, listing_trim, expected_score, match, reason in cases:
            with self.subTest(match=match):
                candidate = rank_one(
                    target=target, listing=make_listing(trim=listing_trim)
                )
                self.assertEqual(candidate.components.trim.score, expected_score)
                self.assertEqual(candidate.components.trim.match, match)
                self.assertIn(reason, candidate.reasons)

    def test_trim_exact_match_uses_case_and_collapsed_whitespace(self) -> None:
        candidate = rank_one(
            target=make_target(trim="SEL   Convenience"),
            listing=make_listing(trim="  sel convenience  "),
        )

        self.assertEqual(candidate.components.trim.score, 20)
        self.assertEqual(candidate.components.trim.match, "EXACT")

    def test_mileage_anchor_and_interpolated_scores_are_transparent(self) -> None:
        target = make_target(mileage=50_000)
        for difference, expected_score, expected_reason in (
            (0, 50, "MILEAGE_EXACT"),
            (2_500, 47.5, "MILEAGE_VERY_CLOSE"),
            (4_000, 46, "MILEAGE_VERY_CLOSE"),
            (5_000, 45, "MILEAGE_VERY_CLOSE"),
            (5_001, 45, "MILEAGE_CLOSE"),
            (10_000, 35, "MILEAGE_CLOSE"),
            (10_001, 35, "MILEAGE_MODERATE"),
            (25_000, 15, "MILEAGE_MODERATE"),
            (25_001, 15, "MILEAGE_FAR"),
            (30_000, 12, "MILEAGE_FAR"),
            (50_000, 0, "MILEAGE_FAR"),
            (50_001, 0, "MILEAGE_FAR"),
            (60_000, 0, "MILEAGE_FAR"),
        ):
            with self.subTest(difference=difference):
                candidate = rank_one(
                    target=target,
                    listing=make_listing(mileage=target.mileage + difference),
                )
                self.assertEqual(
                    candidate.components.mileage.difference_miles, difference
                )
                self.assertEqual(candidate.components.mileage.score, expected_score)
                self.assertIn(expected_reason, candidate.reasons)

    def test_mileage_scoring_is_symmetric_for_plus_and_minus_difference(self) -> None:
        target = make_target(mileage=50_000)
        lower = rank_one(target=target, listing=make_listing(mileage=46_000))
        higher = rank_one(target=target, listing=make_listing(mileage=54_000))

        self.assertEqual(lower.components.mileage.difference_miles, 4_000)
        self.assertEqual(
            lower.components.mileage.to_dict(), higher.components.mileage.to_dict()
        )
        self.assertEqual(lower.score, higher.score)

    def test_missing_listing_mileage_gets_reduced_score_and_reason(self) -> None:
        candidate = rank_one(listing=make_listing(mileage=None))

        self.assertEqual(candidate.components.mileage.score, 15)
        self.assertIsNone(candidate.components.mileage.difference_miles)
        self.assertIn("LISTING_MILEAGE_UNAVAILABLE", candidate.reasons)

    def test_missing_target_mileage_gets_reduced_score_and_reason(self) -> None:
        candidate = rank_one(
            target=make_target(mileage=None), listing=make_listing(mileage=46_926)
        )

        self.assertEqual(candidate.components.mileage.score, 15)
        self.assertIsNone(candidate.components.mileage.difference_miles)
        self.assertIn("TARGET_MILEAGE_UNAVAILABLE", candidate.reasons)

    def test_both_missing_mileages_remain_explicitly_unavailable(self) -> None:
        candidate = rank_one(
            target=make_target(mileage=None), listing=make_listing(mileage=None)
        )

        self.assertEqual(candidate.components.mileage.score, 15)
        self.assertIsNone(candidate.components.mileage.difference_miles)
        self.assertIn("MILEAGE_UNAVAILABLE", candidate.reasons)

    def test_null_mileage_is_not_treated_as_zero(self) -> None:
        target = make_target(mileage=10_000)
        missing = rank_one(target=target, listing=make_listing(mileage=None))
        actual_zero = rank_one(target=target, listing=make_listing(mileage=0))

        self.assertIsNone(missing.components.mileage.difference_miles)
        self.assertEqual(missing.components.mileage.score, 15)
        self.assertEqual(actual_zero.components.mileage.difference_miles, 10_000)
        self.assertEqual(actual_zero.components.mileage.score, 35)

    def test_known_zero_mileage_is_scored_as_known_data(self) -> None:
        candidate = rank_one(
            target=make_target(mileage=0), listing=make_listing(mileage=0)
        )

        self.assertEqual(candidate.components.mileage.difference_miles, 0)
        self.assertEqual(candidate.components.mileage.score, 50)
        self.assertIn("MILEAGE_EXACT", candidate.reasons)

    def test_distance_anchor_and_interpolated_scores_are_transparent(self) -> None:
        for distance, expected_score, expected_reason in (
            (0, 10, "DISTANCE_CLOSE"),
            (2, 10, "DISTANCE_CLOSE"),
            (10, 10, "DISTANCE_CLOSE"),
            (15, 9.67, "DISTANCE_CLOSE"),
            (25, 9, "DISTANCE_CLOSE"),
            (26, 8.92, "DISTANCE_MODERATE"),
            (50, 7, "DISTANCE_MODERATE"),
            (51, 6.94, "DISTANCE_FAR"),
            (100, 4, "DISTANCE_FAR"),
            (200, 0, "DISTANCE_FAR"),
            (201, 0, "DISTANCE_FAR"),
            (250, 0, "DISTANCE_FAR"),
        ):
            with self.subTest(distance=distance):
                candidate = rank_one(listing=make_listing(distance_miles=distance))
                self.assertEqual(candidate.components.distance.score, expected_score)
                self.assertEqual(
                    candidate.components.distance.distance_miles, distance
                )
                self.assertIn(expected_reason, candidate.reasons)

    def test_missing_distance_gets_reduced_score_without_invention(self) -> None:
        candidate = rank_one(listing=make_listing(distance_miles=None))

        self.assertEqual(candidate.components.distance.score, 5)
        self.assertIsNone(candidate.components.distance.distance_miles)
        self.assertIn("DISTANCE_UNAVAILABLE", candidate.reasons)

    def test_distance_is_only_a_modest_improvement(self) -> None:
        two_miles = rank_one(listing=make_listing(distance_miles=2))
        fifteen_miles = rank_one(listing=make_listing(distance_miles=15))

        self.assertGreater(two_miles.score, fifteen_miles.score)
        self.assertLess(float(two_miles.score) - float(fifteen_miles.score), 1)

    def test_target_postal_code_does_not_invent_missing_listing_distance(self) -> None:
        candidate = rank_one(
            target=make_target(postal_code="63123"),
            listing=make_listing(distance_miles=None),
        )

        self.assertIsNone(candidate.components.distance.distance_miles)
        self.assertIn("DISTANCE_UNAVAILABLE", candidate.reasons)

    def test_missing_vin_is_disclosed_but_does_not_reduce_score(self) -> None:
        with_vin = rank_one(listing=make_listing(vin="SYNTHETICVIN00001"))
        without_vin = rank_one(listing=make_listing(vin=None))

        self.assertEqual(with_vin.score, without_vin.score)
        self.assertNotIn("VIN_UNAVAILABLE", with_vin.reasons)
        self.assertIn("VIN_UNAVAILABLE", without_vin.reasons)

    def test_component_scores_sum_to_total_score(self) -> None:
        candidate = rank_one(
            listing=make_listing(
                year=2023,
                trim=None,
                mileage=54_321,
                distance_miles=37.5,
            )
        )
        component_sum = sum(
            (
                Decimal(str(component.score))
                for component in (
                    candidate.components.year,
                    candidate.components.trim,
                    candidate.components.mileage,
                    candidate.components.distance,
                )
            ),
            Decimal("0"),
        )

        self.assertEqual(Decimal(str(candidate.score)), component_sum)

    def test_eligible_scores_stay_within_zero_and_one_hundred(self) -> None:
        listings = (
            make_listing(
                source_listing_id="maximum",
                mileage=46_926,
                distance_miles=0,
            ),
            make_listing(
                source_listing_id="minimum",
                year=2010,
                trim="Different",
                mileage=200_000,
                distance_miles=500,
            ),
            make_listing(
                source_listing_id="missing",
                trim=None,
                mileage=None,
                distance_miles=None,
            ),
        )

        ranked = rank_market_comparables(make_target(), make_result(*listings))

        for candidate in ranked.candidates:
            with self.subTest(candidate=candidate_id(candidate)):
                self.assertIsNotNone(candidate.score)
                self.assertGreaterEqual(candidate.score, 0)
                self.assertLessEqual(candidate.score, 100)
        self.assertEqual(
            {
                candidate_id(candidate): candidate.score
                for candidate in ranked.candidates
            },
            {"maximum": 100, "missing": 50, "minimum": 0},
        )

    def test_tier_thresholds_are_deterministic(self) -> None:
        cases = (
            (10_000, "SEL", 85, "STRONG"),
            (10_005, "SEL", 84.99, "GOOD"),
            (7_500, "Limited", 70, "GOOD"),
            (7_505, "Limited", 69.99, "WEAK"),
        )

        for mileage_difference, trim, expected_score, expected_tier in cases:
            with self.subTest(score=expected_score):
                candidate = rank_one(
                    listing=make_listing(
                        mileage=46_926 + mileage_difference,
                        trim=trim,
                        distance_miles=10,
                    )
                )
                self.assertEqual(candidate.score, expected_score)
                self.assertEqual(candidate.tier, expected_tier)


class ComparableRankingTests(unittest.TestCase):
    def test_candidates_rank_by_score_descending(self) -> None:
        listings = (
            make_listing(source_listing_id="far", mileage=76_926),
            make_listing(source_listing_id="exact", mileage=46_926),
            make_listing(source_listing_id="moderate", mileage=56_926),
        )

        ranked = rank_market_comparables(make_target(), make_result(*listings))

        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["exact", "moderate", "far"],
        )
        self.assertEqual([candidate.rank for candidate in ranked.candidates], [1, 2, 3])
        self.assertGreater(
            ranked.candidates[0].score,
            ranked.candidates[1].score,
        )
        self.assertGreater(
            ranked.candidates[1].score,
            ranked.candidates[2].score,
        )

    def test_exact_match_outranks_weaker_match(self) -> None:
        weaker = make_listing(
            source_listing_id="weaker",
            year=2023,
            trim="Limited",
            mileage=66_926,
            distance_miles=100,
        )
        exact = make_listing(source_listing_id="exact")

        ranked = rank_market_comparables(make_target(), make_result(weaker, exact))

        self.assertEqual(candidate_id(ranked.candidates[0]), "exact")
        self.assertEqual(ranked.candidates[0].score, 100)

    def test_closer_mileage_outranks_farther_when_other_fields_match(self) -> None:
        ranked = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source_listing_id="farther", mileage=56_926),
                make_listing(source_listing_id="closer", mileage=49_426),
            ),
        )

        self.assertEqual(candidate_id(ranked.candidates[0]), "closer")

    def test_exact_trim_outranks_different_trim_when_other_fields_match(self) -> None:
        ranked = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source_listing_id="different", trim="Limited"),
                make_listing(source_listing_id="exact", trim="SEL"),
            ),
        )

        self.assertEqual(candidate_id(ranked.candidates[0]), "exact")

    def test_rounded_score_tie_breaks_by_exact_mileage_difference(self) -> None:
        target = make_target(mileage=50_000)
        farther = make_listing(
            source_listing_id="farther", mileage=51_004, distance_miles=10
        )
        closer = make_listing(
            source_listing_id="closer", mileage=49_000, distance_miles=10
        )

        ranked = rank_market_comparables(target, make_result(farther, closer))

        self.assertEqual(ranked.candidates[0].score, ranked.candidates[1].score)
        self.assertEqual(
            ranked.candidates[0].components.mileage.score,
            ranked.candidates[1].components.mileage.score,
        )
        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["closer", "farther"],
        )

    def test_rounded_score_tie_breaks_by_exact_distance(self) -> None:
        farther = make_listing(
            source_listing_id="farther", distance_miles=11.04
        )
        closer = make_listing(source_listing_id="closer", distance_miles=11)

        ranked = rank_market_comparables(make_target(), make_result(farther, closer))

        self.assertEqual(ranked.candidates[0].score, ranked.candidates[1].score)
        self.assertEqual(
            ranked.candidates[0].components.distance.score,
            ranked.candidates[1].components.distance.score,
        )
        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["closer", "farther"],
        )

    def test_provider_order_is_final_tie_break(self) -> None:
        first = make_listing(source_listing_id="provider-first", price=99_000)
        second = make_listing(source_listing_id="provider-second", price=1_000)

        ranked = rank_market_comparables(make_target(), make_result(first, second))

        self.assertEqual(ranked.candidates[0].score, ranked.candidates[1].score)
        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["provider-first", "provider-second"],
        )

    def test_provider_identity_does_not_affect_similarity_score(self) -> None:
        first = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source="provider-a"),
                provider="provider-a",
            ),
        ).candidates[0]
        second = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source="provider-b"),
                provider="provider-b",
            ),
        ).candidates[0]

        self.assertEqual(first.score, second.score)
        self.assertEqual(first.tier, second.tier)
        self.assertEqual(first.components.to_dict(), second.components.to_dict())
        self.assertEqual(first.reasons, second.reasons)

    def test_known_mileage_wins_same_score_tie_over_missing_mileage(self) -> None:
        missing = make_listing(source_listing_id="missing", mileage=None)
        known = make_listing(source_listing_id="known", mileage=71_926)

        ranked = rank_market_comparables(make_target(), make_result(missing, known))

        self.assertEqual(
            ranked.candidates[0].components.mileage.score,
            ranked.candidates[1].components.mileage.score,
        )
        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["known", "missing"],
        )

    def test_ineligible_candidate_never_displaces_eligible_candidate(self) -> None:
        ineligible_exact = make_listing(
            source_listing_id="wrong-model", model="Sonata"
        )
        eligible_weak = make_listing(
            source_listing_id="weak",
            year=2010,
            trim="Different",
            mileage=200_000,
            distance_miles=500,
        )

        ranked = rank_market_comparables(
            make_target(), make_result(ineligible_exact, eligible_weak)
        )

        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["weak", "wrong-model"],
        )
        self.assertEqual(ranked.candidates[0].score, 0)
        self.assertIsNone(ranked.candidates[1].score)

    def test_empty_result_has_coherent_counts(self) -> None:
        ranked = rank_market_comparables(make_target(), make_result())

        self.assertEqual(ranked.total_listing_count, 0)
        self.assertEqual(ranked.eligible_count, 0)
        self.assertEqual(ranked.ineligible_count, 0)
        self.assertEqual(
            ranked.tier_counts,
            {"STRONG": 0, "GOOD": 0, "WEAK": 0, "INELIGIBLE": 0},
        )
        self.assertEqual(ranked.candidates, ())
        validate_comparable_ranking_result(ranked)

    def test_repeated_ranking_is_byte_for_byte_deterministic(self) -> None:
        target = make_target()
        result = make_result(
            make_listing(
                source_listing_id="one", mileage=49_381, price=12_345
            ),
            make_listing(
                source_listing_id="two", mileage=42_882, price=98_765
            ),
            make_listing(
                source_listing_id="three", model="Sonata", price=1
            ),
        )

        first = rank_market_comparables(target, result).to_dict()
        second = rank_market_comparables(target, result).to_dict()

        self.assertEqual(first, second)
        self.assertEqual(
            json.dumps(first, sort_keys=True, separators=(",", ":")),
            json.dumps(second, sort_keys=True, separators=(",", ":")),
        )

    def test_changing_only_prices_does_not_change_scores_or_ranks(self) -> None:
        base = make_result(
            make_listing(source_listing_id="near", mileage=49_381, price=5_000),
            make_listing(source_listing_id="far", mileage=76_852, price=90_000),
        )
        changed = make_result(
            make_listing(source_listing_id="near", mileage=49_381, price=900_000),
            make_listing(source_listing_id="far", mileage=76_852, price=500),
        )

        base_ranked = rank_market_comparables(make_target(), base)
        changed_ranked = rank_market_comparables(make_target(), changed)
        base_similarity = {
            candidate_id(candidate): (
                candidate.rank,
                candidate.score,
                candidate.tier,
                candidate.components.to_dict(),
                candidate.reasons,
            )
            for candidate in base_ranked.candidates
        }
        changed_similarity = {
            candidate_id(candidate): (
                candidate.rank,
                candidate.score,
                candidate.tier,
                candidate.components.to_dict(),
                candidate.reasons,
            )
            for candidate in changed_ranked.candidates
        }

        self.assertEqual(base_similarity, changed_similarity)
        self.assertEqual(
            [candidate_id(candidate) for candidate in base_ranked.candidates],
            [candidate_id(candidate) for candidate in changed_ranked.candidates],
        )

    def test_price_remains_information_in_candidate_output(self) -> None:
        candidate = rank_one(listing=make_listing(price=12_345.67))

        self.assertEqual(candidate.listing.price, 12_345.67)
        self.assertEqual(candidate.to_dict()["listing"]["price"], 12_345.67)

    def test_highest_price_does_not_automatically_rank_first(self) -> None:
        ranked = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(
                    source_listing_id="highest-price",
                    mileage=96_926,
                    price=999_999,
                ),
                make_listing(
                    source_listing_id="lower-price",
                    mileage=46_926,
                    price=100,
                ),
            ),
        )

        self.assertEqual(candidate_id(ranked.candidates[0]), "lower-price")

    def test_lowest_price_does_not_automatically_rank_last(self) -> None:
        ranked = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(
                    source_listing_id="weak-middle-price",
                    mileage=96_926,
                    price=50_000,
                ),
                make_listing(
                    source_listing_id="lowest-price",
                    mileage=49_426,
                    price=1,
                ),
                make_listing(
                    source_listing_id="strong-high-price",
                    mileage=46_926,
                    price=999_999,
                ),
            ),
        )

        self.assertEqual(
            [candidate_id(candidate) for candidate in ranked.candidates],
            ["strong-high-price", "lowest-price", "weak-middle-price"],
        )


class SyntheticObservedShapeTests(unittest.TestCase):
    """Offline scenarios shaped like observations, with wholly synthetic prices."""

    def test_elantra_shaped_mileages_rank_by_absolute_closeness(self) -> None:
        # These mileages mirror the factual patterns named in the brief.  IDs,
        # URLs, dealer data, VINs, distances, and prices remain synthetic.
        mileages = (49_381, 42_882, 52_396, 54_522, 67_006, 76_852)
        invented_prices = (11_111, 99_999, 22_222, 88_888, 33_333, 77_777)
        listings = tuple(
            make_listing(
                source_listing_id=f"synthetic-elantra-{mileage}",
                mileage=mileage,
                price=price,
            )
            for mileage, price in zip(mileages, invented_prices)
        )

        ranked = rank_market_comparables(make_target(), make_result(*listings))

        expected_mileages = sorted(mileages, key=lambda value: abs(value - 46_926))
        self.assertEqual(
            [candidate.listing.mileage for candidate in ranked.candidates],
            expected_mileages,
        )
        differences = [
            candidate.components.mileage.difference_miles
            for candidate in ranked.candidates
        ]
        self.assertEqual(differences, sorted(differences))
        self.assertEqual(ranked.candidates[0].listing.mileage, 49_381)
        self.assertEqual(ranked.candidates[-1].listing.mileage, 76_852)
        self.assertEqual(
            [candidate.score for candidate in ranked.candidates],
            [97.55, 95.96, 94.06, 89.81, 71.56, 62.04],
        )
        self.assertEqual(
            [candidate.tier for candidate in ranked.candidates],
            ["STRONG", "STRONG", "STRONG", "STRONG", "GOOD", "WEAK"],
        )

    def test_camry_configuration_does_not_outweigh_large_mileage_gap(self) -> None:
        target = ComparableTarget(
            year=2025,
            make="Toyota",
            model="Camry",
            trim="SE",
            mileage=7_192,
            postal_code="63123",
        )
        exact_configuration_large_gap = make_listing(
            source_listing_id="exact-config-large-gap",
            year=2025,
            make="Toyota",
            model="Camry",
            trim="SE",
            mileage=57_192,
            price=999_999,
        )
        one_year_off_exact_mileage = make_listing(
            source_listing_id="one-year-off-exact-mileage",
            year=2024,
            make="Toyota",
            model="Camry",
            trim="SE",
            mileage=7_192,
            price=1,
        )
        different_trim_exact_mileage = make_listing(
            source_listing_id="different-trim-exact-mileage",
            year=2025,
            make="Toyota",
            model="Camry",
            trim="XLE",
            mileage=7_192,
            price=2,
        )

        ranked = rank_market_comparables(
            target,
            make_result(
                exact_configuration_large_gap,
                one_year_off_exact_mileage,
                different_trim_exact_mileage,
                request=make_request(
                    year=2025,
                    make="Toyota",
                    model="Camry",
                    trim="SE",
                    loss_vehicle_mileage=7_192,
                ),
            ),
        )

        scores = {
            candidate_id(candidate): candidate.score for candidate in ranked.candidates
        }
        self.assertGreater(
            scores["one-year-off-exact-mileage"],
            scores["exact-config-large-gap"],
        )
        self.assertGreater(
            scores["different-trim-exact-mileage"],
            scores["exact-config-large-gap"],
        )
        self.assertEqual(scores["exact-config-large-gap"], 50)

    def test_camry_shaped_exact_year_trim_listings_still_rank_by_mileage(self) -> None:
        target = ComparableTarget(
            year=2025,
            make="Toyota",
            model="Camry",
            trim="SE",
            mileage=7_192,
            postal_code="63123",
        )
        mileages = (67_192, 37_192, 17_192, 7_192)
        listings = tuple(
            make_listing(
                source_listing_id=f"synthetic-camry-{mileage}",
                year=2025,
                make="Toyota",
                model="Camry",
                trim="SE",
                mileage=mileage,
                price=100_000 - mileage,
            )
            for mileage in mileages
        )

        ranked = rank_market_comparables(target, make_result(*listings))

        self.assertEqual(
            [candidate.listing.mileage for candidate in ranked.candidates],
            sorted(mileages, key=lambda value: abs(value - 7_192)),
        )
        self.assertEqual(
            [candidate.score for candidate in ranked.candidates],
            [100, 85, 62, 50],
        )


class ComparableSchemaContractTests(unittest.TestCase):
    def valid_ranking_dict(self) -> dict[str, Any]:
        return rank_market_comparables(
            make_target(), make_result(make_listing())
        ).to_dict()

    def mixed_ranking_dict(self) -> dict[str, Any]:
        return rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source_listing_id="eligible"),
                make_listing(source_listing_id="ineligible", model="Sonata"),
            ),
        ).to_dict()

    def test_all_comparable_schemas_are_valid_draft_2020_12(self) -> None:
        for path in (
            TARGET_SCHEMA_PATH,
            CANDIDATE_SCHEMA_PATH,
            RANKING_RESULT_SCHEMA_PATH,
        ):
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                Draft202012Validator.check_schema(schema)

    def test_embedded_target_and_candidate_match_standalone_contracts(self) -> None:
        ranking_schema = json.loads(
            RANKING_RESULT_SCHEMA_PATH.read_text(encoding="utf-8")
        )

        for name, path in (
            ("target", TARGET_SCHEMA_PATH),
            ("candidate", CANDIDATE_SCHEMA_PATH),
        ):
            with self.subTest(contract=name):
                standalone = json.loads(path.read_text(encoding="utf-8"))
                standalone.pop("$schema")
                standalone.pop("title")
                self.assertEqual(ranking_schema["$defs"][name], standalone)

    def test_embedded_listing_matches_existing_canonical_market_contract(self) -> None:
        candidate_schema = json.loads(
            CANDIDATE_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        listing_schema = json.loads(LISTING_SCHEMA_PATH.read_text(encoding="utf-8"))
        listing_schema.pop("$schema")
        listing_schema.pop("title")

        self.assertEqual(candidate_schema["$defs"]["listing"], listing_schema)

    def test_ranking_root_listing_matches_canonical_market_contract(self) -> None:
        ranking_schema = json.loads(
            RANKING_RESULT_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        listing_schema = json.loads(LISTING_SCHEMA_PATH.read_text(encoding="utf-8"))
        listing_schema.pop("$schema")
        listing_schema.pop("title")

        self.assertEqual(ranking_schema["$defs"]["listing"], listing_schema)

    def test_generated_target_candidate_and_ranking_are_valid(self) -> None:
        ranking = rank_market_comparables(
            make_target(), make_result(make_listing())
        )

        validate_comparable_target(ranking.target)
        validate_comparable_candidate(ranking.candidates[0])
        validate_comparable_ranking_result(ranking)
        validate_comparable_ranking_result(ranking.to_dict())

    def test_unknown_fields_are_rejected_at_every_result_level(self) -> None:
        mutations = (
            ("ranking", lambda value: value.update({"futureField": True})),
            (
                "candidate",
                lambda value: value["candidates"][0].update(
                    {"providerPayload": {"private": True}}
                ),
            ),
            (
                "component",
                lambda value: value["candidates"][0]["components"]["year"].update(
                    {"undocumented": 1}
                ),
            ),
            (
                "listing",
                lambda value: value["candidates"][0]["listing"].update(
                    {"rawProviderData": {}}
                ),
            ),
            (
                "target",
                lambda value: value["target"].update({"bodyStyle": "Sedan"}),
            ),
        )

        for label, mutate in mutations:
            with self.subTest(level=label):
                value = self.valid_ranking_dict()
                mutate(value)
                with self.assertRaises(ComparableContractError):
                    validate_comparable_ranking_result(value)

    def test_overall_score_outside_zero_to_one_hundred_is_rejected(self) -> None:
        for invalid_score in (-0.01, 100.01):
            with self.subTest(score=invalid_score):
                candidate = self.valid_ranking_dict()["candidates"][0]
                candidate["score"] = invalid_score
                with self.assertRaises(ComparableContractError):
                    validate_comparable_candidate(candidate)

    def test_malformed_component_scores_and_maximums_are_rejected(self) -> None:
        mutations = (
            lambda candidate: candidate["components"]["year"].update(
                {"score": 20.01}
            ),
            lambda candidate: candidate["components"]["trim"].update({"score": -1}),
            lambda candidate: candidate["components"]["mileage"].update(
                {"score": "50"}
            ),
            lambda candidate: candidate["components"]["distance"].update(
                {"maxScore": 11}
            ),
        )

        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                candidate = self.valid_ranking_dict()["candidates"][0]
                mutate(candidate)
                with self.assertRaises(ComparableContractError):
                    validate_comparable_candidate(candidate)

    def test_standalone_candidate_rejects_in_range_component_math_and_reasons(
        self,
    ) -> None:
        def change_year(candidate: dict[str, Any]) -> None:
            candidate["components"]["year"]["difference"] = 1

        def change_trim(candidate: dict[str, Any]) -> None:
            candidate["components"]["trim"]["match"] = "DIFFERENT"

        def change_mileage(candidate: dict[str, Any]) -> None:
            candidate["components"]["mileage"]["differenceMiles"] = 5_000

        def change_distance(candidate: dict[str, Any]) -> None:
            candidate["listing"]["distanceMiles"] = 100
            candidate["components"]["distance"]["distanceMiles"] = 100

        for label, mutate in (
            ("year", change_year),
            ("trim", change_trim),
            ("mileage", change_mileage),
            ("distance", change_distance),
        ):
            with self.subTest(component=label):
                candidate = self.valid_ranking_dict()["candidates"][0]
                mutate(candidate)

                with self.assertRaises(ComparableContractError) as raised:
                    validate_comparable_candidate(candidate)

                self.assertTrue(
                    any(
                        "inconsistent" in detail
                        for detail in raised.exception.details
                    )
                )

    def test_trim_unavailable_match_rejects_present_listing_trim(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["components"]["trim"].update(
            {"score": 10, "match": "LISTING_UNAVAILABLE"}
        )
        candidate["score"] = 90
        candidate["reasons"].remove("EXACT_TRIM")
        candidate["reasons"].append("LISTING_TRIM_UNAVAILABLE")

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_candidate(candidate)

        self.assertTrue(
            any(
                "listing trim availability" in detail
                for detail in raised.exception.details
            )
        )

    def test_exact_trim_match_rejects_unavailable_listing_trim(self) -> None:
        candidate = rank_market_comparables(
            make_target(), make_result(make_listing(trim=None))
        ).to_dict()["candidates"][0]
        candidate["components"]["trim"].update(
            {"score": 20, "match": "EXACT"}
        )
        candidate["score"] = 100
        candidate["reasons"].remove("LISTING_TRIM_UNAVAILABLE")
        candidate["reasons"].append("EXACT_TRIM")

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_candidate(candidate)

        self.assertTrue(
            any(
                "listing trim availability" in detail
                for detail in raised.exception.details
            )
        )

    def test_negative_differences_are_rejected(self) -> None:
        for component, field in (
            ("year", "difference"),
            ("mileage", "differenceMiles"),
            ("distance", "distanceMiles"),
        ):
            with self.subTest(component=component):
                candidate = self.valid_ranking_dict()["candidates"][0]
                candidate["components"][component][field] = -1
                with self.assertRaises(ComparableContractError):
                    validate_comparable_candidate(candidate)

    def test_invalid_tier_name_is_rejected(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["tier"] = "EXCELLENT"

        with self.assertRaises(ComparableContractError):
            validate_comparable_candidate(candidate)

    def test_score_must_equal_component_sum(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["score"] = 99

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_candidate(candidate)

        self.assertTrue(
            any("component score sum" in d for d in raised.exception.details)
        )

    def test_tier_must_match_score_threshold(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["tier"] = "GOOD"

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_candidate(candidate)

        self.assertTrue(any("expected 'STRONG'" in d for d in raised.exception.details))

    def test_ineligible_candidate_requires_null_score_rank_and_tier(self) -> None:
        candidate = rank_market_comparables(
            make_target(), make_result(make_listing(model="Sonata"))
        ).to_dict()["candidates"][0]
        candidate["score"] = 0

        with self.assertRaises(ComparableContractError):
            validate_comparable_candidate(candidate)

    def test_result_count_semantics_are_enforced(self) -> None:
        for field, value in (
            ("totalListingCount", 99),
            ("eligibleCount", 0),
            ("ineligibleCount", 99),
        ):
            with self.subTest(field=field):
                ranking = self.mixed_ranking_dict()
                ranking[field] = value
                with self.assertRaises(ComparableContractError):
                    validate_comparable_ranking_result(ranking)

    def test_tier_count_semantics_are_enforced(self) -> None:
        ranking = self.mixed_ranking_dict()
        ranking["tierCounts"]["STRONG"] = 0

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_ranking_result(ranking)

        self.assertTrue(any("tierCounts" in d for d in raised.exception.details))

    def test_candidate_rank_sequence_semantics_are_enforced(self) -> None:
        ranking = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source_listing_id="one"),
                make_listing(source_listing_id="two", mileage=47_926),
            ),
        ).to_dict()
        ranking["candidates"][1]["rank"] = 3

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_ranking_result(ranking)

        self.assertTrue(any("contiguous" in d for d in raised.exception.details))

    def test_eligible_candidates_must_precede_ineligible_candidates(self) -> None:
        ranking = self.mixed_ranking_dict()
        ranking["candidates"].reverse()

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_ranking_result(ranking)

        self.assertTrue(any("must precede" in d for d in raised.exception.details))

    def test_lower_scored_eligible_candidate_cannot_precede_higher_score(self) -> None:
        ranking = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source_listing_id="high", mileage=46_926),
                make_listing(source_listing_id="low", mileage=76_926),
            ),
        ).to_dict()
        ranking["candidates"].reverse()
        ranking["candidates"][0]["rank"] = 1
        ranking["candidates"][1]["rank"] = 2

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_ranking_result(ranking)

        self.assertTrue(
            any("ranking tie-breaks" in d for d in raised.exception.details)
        )

    def test_stale_scoring_is_rejected_after_listing_fact_tampering(self) -> None:
        mutations = (
            ("model", lambda listing: listing.update({"model": "Sonata"})),
            ("year", lambda listing: listing.update({"year": 2023})),
            ("trim", lambda listing: listing.update({"trim": "Limited"})),
            ("mileage", lambda listing: listing.update({"mileage": 56_926})),
            (
                "distance",
                lambda listing: listing.update({"distanceMiles": 100}),
            ),
        )

        for label, mutate in mutations:
            with self.subTest(fact=label):
                ranking = self.valid_ranking_dict()
                mutate(ranking["candidates"][0]["listing"])
                with self.assertRaises(ComparableContractError) as raised:
                    validate_comparable_ranking_result(ranking)
                self.assertTrue(
                    any(
                        "does not match scoring version" in detail
                        for detail in raised.exception.details
                    )
                )

    def test_candidate_listing_source_must_match_result_provider(self) -> None:
        ranking = self.valid_ranking_dict()
        ranking["candidates"][0]["listing"]["source"] = "other-provider"

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_ranking_result(ranking)

        self.assertTrue(any("expected" in d for d in raised.exception.details))

    def test_serialized_ranking_rejects_duplicate_source_listing_ids(self) -> None:
        ranking = rank_market_comparables(
            make_target(),
            make_result(
                make_listing(source_listing_id="synthetic-one"),
                make_listing(
                    source_listing_id="synthetic-two",
                    mileage=47_926,
                ),
            ),
        ).to_dict()
        ranking["candidates"][1]["listing"]["sourceListingId"] = "synthetic-one"

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_ranking_result(ranking)

        self.assertTrue(any("duplicate" in d for d in raised.exception.details))

    def test_unrecognized_reason_code_is_rejected(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["reasons"].append("PRICE_SUPPORTS_OUTCOME")

        with self.assertRaises(ComparableContractError):
            validate_comparable_candidate(candidate)

    def test_empty_eligibility_reasons_are_rejected_semantically(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["reasons"] = []

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_candidate(candidate)

        self.assertTrue(
            any("reasons" in detail for detail in raised.exception.details)
        )

    def test_ambiguous_eligibility_reasons_are_rejected_semantically(self) -> None:
        candidate = self.valid_ranking_dict()["candidates"][0]
        candidate["reasons"].extend(["MAKE_MISMATCH", "MODEL_MISMATCH"])

        with self.assertRaises(ComparableContractError) as raised:
            validate_comparable_candidate(candidate)

        self.assertTrue(
            any("eligibility reason" in detail for detail in raised.exception.details)
        )


class ComparableRobustnessTests(unittest.TestCase):
    def test_ranking_result_supports_standard_dataclass_copying(self) -> None:
        ranked = rank_market_comparables(
            make_target(), make_result(make_listing())
        )

        self.assertEqual(copy.deepcopy(ranked), ranked)
        self.assertEqual(
            dataclasses.asdict(ranked)["tier_counts"],
            {"STRONG": 1, "GOOD": 0, "WEAK": 0, "INELIGIBLE": 0},
        )

    def test_unavailable_distance_origin_neutralizes_raw_listing_distance(self) -> None:
        ranked = rank_market_comparables(
            make_target(postal_code=None),
            make_result(
                make_listing(distance_miles=15),
                request=make_request(postal_code=None),
            ),
        )
        candidate = ranked.candidates[0]

        self.assertEqual(candidate.listing.distance_miles, 15)
        self.assertEqual(candidate.components.distance.score, 5)
        self.assertIsNone(candidate.components.distance.distance_miles)
        self.assertIn("DISTANCE_ORIGIN_UNAVAILABLE", candidate.reasons)

    def test_one_sided_distance_origin_availability_is_rejected(self) -> None:
        for target_postal_code, request_postal_code in (
            (None, "63123"),
            ("63123", None),
        ):
            with self.subTest(
                target=target_postal_code,
                request=request_postal_code,
            ):
                target = make_target(postal_code=target_postal_code)
                result = make_result(
                    make_listing(distance_miles=15),
                    request=make_request(postal_code=request_postal_code),
                )

                with self.assertRaises(ComparableContractError) as raised:
                    rank_market_comparables(target, result)

                self.assertTrue(
                    any(
                        "whether the origin is unavailable" in detail
                        for detail in raised.exception.details
                    )
                )

    def test_mismatched_non_null_distance_origins_are_rejected(self) -> None:
        target = make_target(postal_code="63123")
        result = make_result(
            make_listing(distance_miles=10),
            request=make_request(postal_code="90210"),
        )

        with self.assertRaises(ComparableContractError) as raised:
            rank_market_comparables(target, result)

        self.assertTrue(
            any("postalCode" in detail for detail in raised.exception.details)
        )
        self.assertTrue(
            any("distances cannot be compared" in d for d in raised.exception.details)
        )

    def test_matching_distance_origins_allow_distance_scoring(self) -> None:
        ranked = rank_market_comparables(
            make_target(postal_code="63123"),
            make_result(
                make_listing(distance_miles=15),
                request=make_request(postal_code=" 63123 "),
            ),
        )

        self.assertEqual(ranked.candidates[0].components.distance.score, 9.67)
        self.assertEqual(
            ranked.candidates[0].components.distance.distance_miles, 15
        )

    def test_rank_rejects_wrong_top_level_input_types(self) -> None:
        with self.assertRaises(ComparableContractError):
            rank_market_comparables(  # type: ignore[arg-type]
                make_target().to_dict(), make_result(make_listing())
            )
        with self.assertRaises(ComparableContractError):
            rank_market_comparables(  # type: ignore[arg-type]
                make_target(), make_result(make_listing()).to_dict()
            )

    def test_rank_rejects_invalid_target(self) -> None:
        with self.assertRaises(ComparableContractError):
            rank_market_comparables(
                make_target(mileage=-1), make_result(make_listing())
            )

    def test_rank_wraps_invalid_listing_contract(self) -> None:
        result = make_result(make_listing(distance_miles=-1))

        with self.assertRaises(ComparableContractError) as raised:
            rank_market_comparables(make_target(), result)

        self.assertTrue(any("distanceMiles" in d for d in raised.exception.details))

    def test_rank_rejects_non_finite_listing_numbers(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value), self.assertRaises(
                ComparableContractError
            ):
                rank_market_comparables(
                    make_target(), make_result(make_listing(price=value))
                )

    def test_rank_rejects_duplicate_same_provider_listing_ids(self) -> None:
        result = make_result(
            make_listing(source_listing_id="duplicate"),
            make_listing(source_listing_id="duplicate", mileage=47_926),
        )

        with self.assertRaises(ComparableContractError) as raised:
            rank_market_comparables(make_target(), result)

        self.assertTrue(any("duplicate" in d for d in raised.exception.details))

    def test_rank_rejects_listing_source_different_from_provider(self) -> None:
        result = make_result(make_listing(source="other-provider"))

        with self.assertRaises(ComparableContractError) as raised:
            rank_market_comparables(make_target(), result)

        self.assertTrue(any("expected" in d for d in raised.exception.details))

    def test_ranking_makes_no_network_call(self) -> None:
        with patch("socket.socket", side_effect=AssertionError("network attempted")):
            ranked = rank_market_comparables(
                make_target(), make_result(make_listing())
            )

        self.assertEqual(ranked.eligible_count, 1)

    def test_ranking_does_not_mutate_target_or_market_result(self) -> None:
        target = make_target()
        market_result = make_result(
            make_listing(
                source_listing_id="first", mileage=76_852, price=99_999
            ),
            make_listing(
                source_listing_id="second", mileage=49_381, price=1
            ),
        )
        target_before = copy.deepcopy(target)
        target_data_before = copy.deepcopy(target.to_dict())
        result_before = copy.deepcopy(market_result)
        result_data_before = copy.deepcopy(market_result.to_dict())

        rank_market_comparables(target, market_result)

        self.assertEqual(target, target_before)
        self.assertEqual(target.to_dict(), target_data_before)
        self.assertEqual(market_result, result_before)
        self.assertEqual(market_result.to_dict(), result_data_before)
        self.assertEqual(
            [listing.source_listing_id for listing in market_result.listings],
            ["first", "second"],
        )

    def test_report_factory_does_not_mutate_input_mapping(self) -> None:
        report = {
            "vehicle": {
                "year": 2024,
                "make": "  Hyundai  ",
                "model": " Elantra ",
                "trim": " SEL ",
                "mileage": 46_926,
            }
        }
        before = copy.deepcopy(report)

        comparable_target_from_report(report, postal_code="63123")

        self.assertEqual(report, before)


if __name__ == "__main__":
    unittest.main()
