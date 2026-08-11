"""Offline synthetic coverage for Phase 3D valuation discrepancy analysis.

Every vehicle, identifier, price, and provider in this module is fictional test
data.  The tests exercise normalized domain objects only and perform no live
market, CCC, dealer, or model calls.
"""

from __future__ import annotations

import copy
import json
import socket
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from jsonschema import Draft202012Validator

from venfour.comparables import (
    ComparableRankingResult,
    ComparableTarget,
    rank_market_comparables,
)
from venfour.discrepancy import (
    ABOVE_OBSERVED_RANGE,
    BELOW_OBSERVED_RANGE,
    CONFLICTING_EVIDENCE,
    CURRENT_MARKET,
    DiscrepancyContractError,
    HistoricalEvidenceInput,
    INSUFFICIENT_EVIDENCE,
    LOSS_DATE_HISTORICAL,
    LOW,
    MAX_SAFE_MONEY_CENTS,
    MATERIAL_UNDERVALUE_SIGNAL,
    MODERATE,
    NO_MATERIAL_DISCREPANCY,
    NO_PRIMARY_EVIDENCE,
    POTENTIAL_UNDERVALUE,
    STRONG,
    VALUATION_DISCREPANCY_REQUEST_SCHEMA_PATH,
    VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH,
    CurrentEvidenceInput,
    ValuationDiscrepancyPolicy,
    ValuationDiscrepancyRequest,
    analyze_valuation_discrepancy,
    validate_valuation_discrepancy_policy,
    validate_valuation_discrepancy_request,
    validate_valuation_discrepancy_result,
    valuation_discrepancy_request_from_report,
)
from venfour.historical_market import (
    AMBIGUOUS,
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    UNRESOLVED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
)
from venfour.market import MarketListing, MarketSearchRequest, MarketSearchResult


SYNTHETIC_CURRENT_PROVIDER = "synthetic-current"
SYNTHETIC_HISTORICAL_PROVIDER = "synthetic-historical"
EVIDENCE_DATE = "2026-05-19"
AS_OF_DATE = "2026-08-10"
CURRENT_OBSERVED_DATE = "2026-08-10"
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "discrepancy" / "cases.json"
_DEFAULT = object()


def dollars(cents: int) -> int | float:
    """Return a JSON number whose decimal spelling represents integer cents."""

    return cents // 100 if cents % 100 == 0 else cents / 100


def make_target(**overrides: Any) -> ComparableTarget:
    values: dict[str, Any] = {
        "year": 2024,
        "make": "Synthetic",
        "model": "Sedan",
        "trim": "SEL",
        "mileage": 50_000,
        "postal_code": "63026",
    }
    values.update(overrides)
    return ComparableTarget(**values)


def make_listing(
    index: int,
    price_cents: int,
    *,
    provider: str = SYNTHETIC_CURRENT_PROVIDER,
    source_listing_id: str | None | object = _DEFAULT,
    vin: str | None | object = _DEFAULT,
    mileage: int | None | object = _DEFAULT,
    weak: bool = False,
    **overrides: Any,
) -> MarketListing:
    target = make_target()
    values: dict[str, Any] = {
        "source": provider,
        "source_listing_id": (
            f"synthetic-listing-{index:03d}"
            if source_listing_id is _DEFAULT
            else source_listing_id
        ),
        "listing_url": f"https://synthetic.invalid/listing/{index}",
        "year": target.year,
        "make": target.make,
        "model": target.model,
        "trim": target.trim,
        "vin": f"SYNTHETICVIN{index:05d}" if vin is _DEFAULT else vin,
        "mileage": (
            target.mileage + (index - 1) * 1_000
            if mileage is _DEFAULT and target.mileage is not None
            else mileage
        ),
        "price": dollars(price_cents),
        "dealer": None,
        "distance_miles": 5 + index,
    }
    if weak:
        values.update(
            {
                "year": 2010,
                "trim": "Different",
                "mileage": 150_000,
                "distance_miles": 250,
            }
        )
    values.update(overrides)
    return MarketListing(**values)


def make_ranking(
    price_cents: list[int] | tuple[int, ...],
    *,
    provider: str = SYNTHETIC_CURRENT_PROVIDER,
    target: ComparableTarget | None = None,
    input_order: list[int] | tuple[int, ...] | None = None,
    vins: list[str | None] | tuple[str | None, ...] | None = None,
    listing_ids: list[str | None] | tuple[str | None, ...] | None = None,
    mileages: list[int | None] | tuple[int | None, ...] | None = None,
    weak_indices: set[int] | frozenset[int] = frozenset(),
) -> ComparableRankingResult:
    comparable_target = target if target is not None else make_target()
    listings = [
        make_listing(
            index,
            price,
            provider=provider,
            vin=(vins[index - 1] if vins is not None else _DEFAULT),
            source_listing_id=(
                listing_ids[index - 1] if listing_ids is not None else _DEFAULT
            ),
            mileage=(mileages[index - 1] if mileages is not None else _DEFAULT),
            weak=index in weak_indices,
        )
        for index, price in enumerate(price_cents, start=1)
    ]
    if input_order is not None:
        listings = [listings[index] for index in input_order]
    request = MarketSearchRequest(
        year=comparable_target.year,
        make=comparable_target.make,
        model=comparable_target.model,
        trim=comparable_target.trim,
        loss_vehicle_mileage=comparable_target.mileage,
        postal_code=comparable_target.postal_code,
        radius_miles=50,
        result_limit=max(1, len(listings)),
    )
    market_result = MarketSearchResult(
        provider=provider,
        request=request,
        listings=tuple(listings),
    )
    return rank_market_comparables(comparable_target, market_result)


def make_temporal() -> TemporalEvidence:
    return TemporalEvidence(
        evidence_date=EVIDENCE_DATE,
        record_first_seen_at="2026-05-18T12:00:00Z",
        record_last_seen_at="2026-05-20T12:00:00Z",
        source_first_seen_at="2026-05-01T00:00:00Z",
        source_last_seen_at="2026-05-31T23:59:59Z",
    )


def make_issue(
    index: int,
    *,
    ambiguous: bool = False,
) -> HistoricalEvidenceIssue:
    return HistoricalEvidenceIssue(
        status=AMBIGUOUS if ambiguous else UNRESOLVED,
        reason=(
            "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE"
            if ambiguous
            else "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE"
        ),
        vin=f"SYNTHETIC-ISSUE-VIN-{index:03d}",
    )


def make_historical_input(
    price_cents: list[int] | tuple[int, ...],
    *,
    target: ComparableTarget | None = None,
    unresolved_count: int = 0,
    ambiguous_count: int = 0,
    mileages: list[int | None] | tuple[int | None, ...] | None = None,
    weak_indices: set[int] | frozenset[int] = frozenset(),
    evidence_order: list[int] | tuple[int, ...] | None = None,
) -> HistoricalEvidenceInput:
    comparable_target = target if target is not None else make_target()
    ranking = make_ranking(
        price_cents,
        provider=SYNTHETIC_HISTORICAL_PROVIDER,
        target=comparable_target,
        mileages=mileages,
        weak_indices=weak_indices,
    )
    ranked_listings = [candidate.listing for candidate in ranking.candidates]
    if evidence_order is not None:
        ranked_listings = [ranked_listings[index] for index in evidence_order]
    historical_request = HistoricalMarketSearchRequest(
        evidence_date=EVIDENCE_DATE,
        year=comparable_target.year,
        make=comparable_target.make,
        model=comparable_target.model,
        trim=comparable_target.trim,
        loss_vehicle_mileage=comparable_target.mileage,
        postal_code=comparable_target.postal_code or "63026",
        radius_miles=50,
        result_limit=max(1, len(ranked_listings)),
    )
    issues = tuple(
        [make_issue(index + 1) for index in range(unresolved_count)]
        + [
            make_issue(unresolved_count + index + 1, ambiguous=True)
            for index in range(ambiguous_count)
        ]
    )
    result = HistoricalMarketSearchResult(
        provider=SYNTHETIC_HISTORICAL_PROVIDER,
        evidence_date=EVIDENCE_DATE,
        as_of_date=AS_OF_DATE,
        coverage=HistoricalCoverage(SUPPORTED, 90),
        request=historical_request,
        evidence=tuple(
            HistoricalEvidenceItem(listing=listing, temporal_evidence=make_temporal())
            for listing in ranked_listings
        ),
        issues=issues,
    )
    return HistoricalEvidenceInput(result=result, ranking=ranking)


def make_out_of_range_historical_input(
    *, target: ComparableTarget | None = None
) -> HistoricalEvidenceInput:
    comparable_target = target if target is not None else make_target()
    evidence_date = "2026-05-11"
    result = HistoricalMarketSearchResult(
        provider=SYNTHETIC_HISTORICAL_PROVIDER,
        evidence_date=evidence_date,
        as_of_date=AS_OF_DATE,
        coverage=HistoricalCoverage(OUT_OF_PROVIDER_RANGE, 90),
        request=HistoricalMarketSearchRequest(
            evidence_date=evidence_date,
            year=comparable_target.year,
            make=comparable_target.make,
            model=comparable_target.model,
            trim=comparable_target.trim,
            loss_vehicle_mileage=comparable_target.mileage,
            postal_code=comparable_target.postal_code or "63026",
        ),
        evidence=(),
        issues=(),
    )
    return HistoricalEvidenceInput(result=result, ranking=None)


def make_current_input(
    price_cents: list[int] | tuple[int, ...],
    *,
    target: ComparableTarget | None = None,
    **ranking_options: Any,
) -> CurrentEvidenceInput:
    return CurrentEvidenceInput(
        ranking=make_ranking(price_cents, target=target, **ranking_options),
        observed_date=CURRENT_OBSERVED_DATE,
    )


def make_ccc_comparable(
    number: int,
    *,
    list_price_cents: int | None = 2_000_000,
    adjusted_value_cents: int | None = 1_900_000,
    adjustments_cents: dict[str, int | None] | None = None,
    mileage: int | None = 50_000,
) -> dict[str, Any]:
    components = (
        adjustments_cents
        if adjustments_cents is not None
        else {"package": 0, "options": 0, "mileage": -50_000, "condition": -50_000}
    )
    return {
        "number": number,
        "year": 2024,
        "make": "Synthetic",
        "model": "Sedan",
        "trim": "SEL",
        "vin": f"SYNTHETIC-CCC-VIN-{number:03d}",
        "dealer": f"Synthetic Dealer {number}",
        "location": "Synthetic City, MO",
        "distanceMiles": 10 + number,
        "mileage": mileage,
        "listPrice": (
            dollars(list_price_cents) if list_price_cents is not None else None
        ),
        "adjustments": {
            name: dollars(value) if value is not None else None
            for name, value in components.items()
        },
        "adjustedValue": (
            dollars(adjusted_value_cents)
            if adjusted_value_cents is not None
            else None
        ),
        "contributionPercent": None,
    }


def make_request(
    *,
    ccc_vehicle_valuation_cents: int | None = 2_000_000,
    ccc_vehicle_valuation: int | float | None | object = _DEFAULT,
    ccc_comparables: tuple[dict[str, Any], ...] = (),
    historical: HistoricalEvidenceInput | None = None,
    current: CurrentEvidenceInput | None = None,
    target: ComparableTarget | None = None,
    policy: ValuationDiscrepancyPolicy | None = None,
    loss_date: str | None | object = _DEFAULT,
) -> ValuationDiscrepancyRequest:
    comparable_target = target if target is not None else make_target()
    if ccc_vehicle_valuation is _DEFAULT:
        ccc_value = (
            dollars(ccc_vehicle_valuation_cents)
            if ccc_vehicle_valuation_cents is not None
            else None
        )
    else:
        ccc_value = ccc_vehicle_valuation
    if loss_date is _DEFAULT:
        normalized_loss_date = (
            historical.result.evidence_date if historical is not None else EVIDENCE_DATE
        )
    else:
        normalized_loss_date = loss_date
    return ValuationDiscrepancyRequest(
        loss_vehicle=comparable_target,
        loss_date=normalized_loss_date,
        ccc_vehicle_valuation=ccc_value,
        ccc_comparables=ccc_comparables,
        historical_evidence=historical,
        current_evidence=current,
        policy=policy if policy is not None else ValuationDiscrepancyPolicy(),
    )


def analyze_prices(
    prices: list[int] | tuple[int, ...],
    *,
    ccc_vehicle_valuation_cents: int | None = 2_000_000,
    policy: ValuationDiscrepancyPolicy | None = None,
    weak_indices: set[int] | frozenset[int] = frozenset(),
) -> Any:
    historical = make_historical_input(prices, weak_indices=weak_indices)
    return analyze_valuation_discrepancy(
        make_request(
            ccc_vehicle_valuation_cents=ccc_vehicle_valuation_cents,
            historical=historical,
            policy=policy,
        )
    )


def message_codes(messages: Any) -> set[str]:
    return {message.code for message in messages}


class DiscrepancyScenarioTests(unittest.TestCase):
    def test_clearly_consistent_historical_valuation(self) -> None:
        result = analyze_prices([1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000])

        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)
        self.assertEqual(result.evidence_strength, STRONG)
        self.assertEqual(result.evidence_basis, LOSS_DATE_HISTORICAL)
        self.assertEqual(result.primary_comparison.difference_cents, 0)
        self.assertEqual(
            result.primary_comparison.ccc_position_in_external_range,
            "WITHIN_OBSERVED_RANGE",
        )
        self.assertIn("CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT", message_codes(result.findings))

    def test_potential_undervalue(self) -> None:
        result = analyze_prices([2_080_000, 2_100_000, 2_120_000, 2_130_000, 2_140_000])

        self.assertEqual(result.classification, POTENTIAL_UNDERVALUE)
        self.assertEqual(result.primary_comparison.difference_cents, 120_000)
        self.assertEqual(result.primary_comparison.difference_basis_points, 600)
        self.assertEqual(
            result.primary_comparison.ccc_position_in_external_range,
            BELOW_OBSERVED_RANGE,
        )

    def test_material_undervalue_requires_strong_historical_evidence(self) -> None:
        result = analyze_prices([2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000])

        self.assertEqual(result.classification, MATERIAL_UNDERVALUE_SIGNAL)
        self.assertEqual(result.evidence_strength, STRONG)
        self.assertEqual(result.primary_comparison.difference_cents, 220_000)
        self.assertEqual(result.primary_comparison.difference_basis_points, 1_100)

    def test_one_high_outlier_does_not_manufacture_discrepancy(self) -> None:
        result = analyze_prices([1_950_000, 1_990_000, 2_000_000, 2_020_000, 9_990_000])

        summary = result.historical_external_summary.prices
        self.assertEqual(summary.median_price_cents, 2_000_000)
        self.assertEqual(summary.maximum_price_cents, 9_990_000)
        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)

    def test_one_low_outlier_does_not_erase_coherent_higher_signal(self) -> None:
        result = analyze_prices([100_000, 2_180_000, 2_220_000, 2_240_000, 2_260_000])

        self.assertEqual(
            result.historical_external_summary.prices.median_price_cents, 2_220_000
        )
        self.assertEqual(result.classification, MATERIAL_UNDERVALUE_SIGNAL)

    def test_high_dispersion_is_conflicting_and_low_strength(self) -> None:
        result = analyze_prices([1_200_000, 1_600_000, 2_000_000, 2_400_000, 2_800_000])

        prices = result.historical_external_summary.prices
        self.assertEqual(prices.median_absolute_deviation_cents, 400_000)
        self.assertEqual(prices.dispersion_basis_points, 2_000)
        self.assertEqual(result.classification, CONFLICTING_EVIDENCE)
        self.assertEqual(result.evidence_strength, LOW)
        self.assertIn("EXTERNAL_MARKET_HIGH_DISPERSION", message_codes(result.findings))

    def test_bimodal_central_spread_is_conflicting_even_when_mad_is_zero(self) -> None:
        result = analyze_prices(
            [1_000_000, 1_000_000, 10_000_000, 10_000_000, 10_000_000],
            ccc_vehicle_valuation_cents=5_000_000,
        )

        prices = result.historical_external_summary.prices
        self.assertEqual(prices.median_absolute_deviation_cents, 0)
        self.assertEqual(prices.central_half_range_cents, 4_500_000)
        self.assertEqual(prices.dispersion_basis_points, 4_500)
        self.assertEqual(result.classification, CONFLICTING_EVIDENCE)
        self.assertEqual(result.evidence_strength, LOW)

    def test_large_negative_gap_is_not_labeled_consistent(self) -> None:
        result = analyze_prices([1_000_000] * 5)

        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)
        self.assertIn("EXTERNAL_MEDIAN_BELOW_CCC", message_codes(result.findings))
        self.assertNotIn(
            "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT", message_codes(result.findings)
        )

    def test_one_and_two_observations_are_insufficient(self) -> None:
        for prices in ([2_300_000], [2_200_000, 2_300_000]):
            with self.subTest(count=len(prices)):
                result = analyze_prices(prices)
                self.assertEqual(result.classification, INSUFFICIENT_EVIDENCE)
                self.assertEqual(result.evidence_strength, LOW)

    def test_ambiguous_and_unresolved_issues_are_diagnostics_not_prices(self) -> None:
        historical = make_historical_input(
            [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000],
            unresolved_count=2,
            ambiguous_count=2,
        )
        result = analyze_valuation_discrepancy(make_request(historical=historical))

        summary = result.historical_external_summary
        self.assertEqual(summary.resolved_count, 5)
        self.assertEqual(summary.unresolved_count, 2)
        self.assertEqual(summary.ambiguous_count, 2)
        self.assertEqual(summary.prices.count, 5)
        self.assertNotIn(0, [item.price_cents for item in summary.selected_evidence])
        self.assertIn(
            "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED", message_codes(result.findings)
        )
        self.assertIn(
            "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED", message_codes(result.findings)
        )

    def test_out_of_range_is_not_an_empty_historical_market(self) -> None:
        historical = make_out_of_range_historical_input()
        result = analyze_valuation_discrepancy(make_request(historical=historical))

        self.assertEqual(result.classification, INSUFFICIENT_EVIDENCE)
        self.assertEqual(result.evidence_basis, NO_PRIMARY_EVIDENCE)
        self.assertEqual(result.historical_external_summary.coverage_status, OUT_OF_PROVIDER_RANGE)
        self.assertEqual(result.historical_external_summary.selected_count, 0)
        self.assertIn(
            "HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE", message_codes(result.findings)
        )

    def test_current_only_evidence_preserves_temporal_limitation(self) -> None:
        current = make_current_input(
            [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000]
        )
        result = analyze_valuation_discrepancy(make_request(current=current))

        self.assertEqual(result.evidence_basis, CURRENT_MARKET)
        self.assertEqual(result.evidence_strength, MODERATE)
        self.assertEqual(result.classification, POTENTIAL_UNDERVALUE)
        self.assertIsNone(result.historical_external_summary)
        self.assertIn("CURRENT_MARKET_ONLY", message_codes(result.findings))
        self.assertIn(
            "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE",
            message_codes(result.limitations),
        )

    def test_identity_less_current_rows_do_not_create_current_market_signal(self) -> None:
        current = make_current_input(
            [2_100_000, 2_200_000, 2_300_000],
            vins=[None, None, None],
            listing_ids=[None, None, None],
        )
        result = analyze_valuation_discrepancy(make_request(current=current))

        self.assertEqual(result.evidence_basis, NO_PRIMARY_EVIDENCE)
        self.assertEqual(result.classification, INSUFFICIENT_EVIDENCE)
        self.assertEqual(result.current_external_summary.selected_count, 0)
        self.assertNotIn("CURRENT_MARKET_ONLY", message_codes(result.findings))
        self.assertNotIn("CURRENT_PRIMARY_EVIDENCE", message_codes(result.findings))

    def test_sufficient_historical_evidence_precedes_contradictory_current(self) -> None:
        historical = make_historical_input(
            [1_960_000, 1_980_000, 2_000_000, 2_020_000, 2_040_000]
        )
        current = make_current_input(
            [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000]
        )
        result = analyze_valuation_discrepancy(
            make_request(historical=historical, current=current)
        )

        self.assertEqual(result.evidence_basis, LOSS_DATE_HISTORICAL)
        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)
        self.assertEqual(
            result.primary_comparison.external_median_price_cents, 2_000_000
        )
        self.assertEqual(
            result.current_external_summary.prices.median_price_cents, 2_220_000
        )
        self.assertIn("HISTORICAL_PRIMARY_EVIDENCE", message_codes(result.findings))
        self.assertIn("CURRENT_EVIDENCE_SECONDARY", message_codes(result.findings))

    def test_zero_median_historical_set_does_not_displace_usable_current_set(self) -> None:
        result = analyze_valuation_discrepancy(
            make_request(
                historical=make_historical_input([0, 0, 0, 0, 0]),
                current=make_current_input(
                    [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000]
                ),
            )
        )

        self.assertEqual(result.evidence_basis, CURRENT_MARKET)
        self.assertEqual(result.evidence_strength, MODERATE)
        self.assertEqual(result.classification, POTENTIAL_UNDERVALUE)
        self.assertEqual(
            result.historical_external_summary.prices.median_price_cents, 0
        )
        self.assertNotIn(
            "HISTORICAL_CURRENT_SIGNALS_CONFLICT", message_codes(result.findings)
        )

    def test_unusable_dual_sources_do_not_emit_cross_temporal_conflict(self) -> None:
        result = analyze_valuation_discrepancy(
            make_request(
                historical=make_historical_input([1_000_000]),
                current=make_current_input([0, 0, 0]),
            )
        )

        self.assertEqual(result.classification, INSUFFICIENT_EVIDENCE)
        self.assertNotIn(
            "HISTORICAL_CURRENT_SIGNALS_CONFLICT", message_codes(result.findings)
        )

    def test_shared_exclusion_reason_is_aggregated_across_temporal_streams(self) -> None:
        prices = [2_000_000 + index for index in range(6)]
        result = analyze_valuation_discrepancy(
            make_request(
                historical=make_historical_input(prices),
                current=make_current_input(prices),
            )
        )

        codes = [finding.code for finding in result.findings]
        self.assertEqual(codes.count("EXTERNAL_COMPARISON_SET_BOUNDED"), 1)

    def test_weak_tier_downgrades_strength_and_material_gap(self) -> None:
        result = analyze_prices(
            [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000],
            weak_indices={5},
        )

        self.assertEqual(result.historical_external_summary.selected_weak_count, 1)
        self.assertEqual(result.evidence_strength, MODERATE)
        self.assertEqual(result.classification, POTENTIAL_UNDERVALUE)
        self.assertIn(
            "POTENTIAL_GAP_THRESHOLD_MET", message_codes(result.findings)
        )


class CccComparableAndFactTests(unittest.TestCase):
    def test_ccc_advertised_adjusted_net_and_categories_are_preserved(self) -> None:
        comparables = (
            make_ccc_comparable(
                1,
                list_price_cents=2_000_000,
                adjusted_value_cents=1_800_000,
                adjustments_cents={
                    "package": 0,
                    "options": 0,
                    "mileage": -50_000,
                    "condition": -150_000,
                },
            ),
            make_ccc_comparable(
                2,
                list_price_cents=2_100_000,
                adjusted_value_cents=1_900_000,
                adjustments_cents={
                    "package": 50_000,
                    "options": 0,
                    "mileage": -100_000,
                    "condition": -150_000,
                },
            ),
            make_ccc_comparable(
                3,
                list_price_cents=2_200_000,
                adjusted_value_cents=2_000_000,
                adjustments_cents={
                    "package": None,
                    "options": None,
                    "mileage": None,
                    "condition": None,
                },
            ),
        )
        comparables[0]["contributionPercent"] = 37.5
        result = analyze_valuation_discrepancy(
            make_request(
                ccc_comparables=comparables,
                historical=make_historical_input(
                    [1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000]
                ),
            )
        )

        summary = result.ccc_comparable_summary
        self.assertEqual(summary.advertised_prices.median_price_cents, 2_100_000)
        self.assertEqual(summary.adjusted_values.median_price_cents, 1_900_000)
        self.assertEqual(summary.net_adjustments.median_cents, -200_000)
        self.assertEqual(summary.fully_disclosed_adjustment_count, 2)
        self.assertEqual(summary.undisclosed_adjustment_count, 1)
        first = summary.comparables[0]
        self.assertEqual(first.list_price_cents, 2_000_000)
        self.assertEqual(first.adjusted_value_cents, 1_800_000)
        self.assertEqual(first.net_adjustment_cents, -200_000)
        self.assertEqual(first.adjustments.mileage_cents, -50_000)
        self.assertEqual(first.adjustments.condition_cents, -150_000)
        self.assertEqual(first.contribution_percent, 37.5)
        self.assertIn(
            "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES", message_codes(result.findings)
        )

    def test_unpaired_ccc_samples_do_not_claim_an_adjustment_direction(self) -> None:
        result = analyze_valuation_discrepancy(
            make_request(
                ccc_comparables=(
                    make_ccc_comparable(
                        1,
                        list_price_cents=1_000_000,
                        adjusted_value_cents=None,
                    ),
                    make_ccc_comparable(
                        2,
                        list_price_cents=None,
                        adjusted_value_cents=2_000_000,
                    ),
                )
            )
        )

        summary = result.ccc_comparable_summary
        self.assertEqual(summary.advertised_prices.median_price_cents, 1_000_000)
        self.assertEqual(summary.adjusted_values.median_price_cents, 2_000_000)
        self.assertEqual(summary.paired_value_count, 0)
        self.assertIsNone(
            result.secondary_comparisons.ccc_advertised_median_vs_adjusted_median
        )
        self.assertTrue(
            message_codes(result.findings).isdisjoint(
                {
                    "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES",
                    "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES",
                    "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE",
                }
            )
        )

    def test_duplicate_legacy_ccc_numbers_remain_auditable_rows(self) -> None:
        result = analyze_valuation_discrepancy(
            make_request(
                ccc_comparables=(
                    make_ccc_comparable(1),
                    make_ccc_comparable(1),
                )
            )
        )

        self.assertEqual(result.ccc_comparable_summary.total_count, 2)
        self.assertEqual(
            [row.comparable_number for row in result.ccc_comparable_summary.comparables],
            [1, 1],
        )
        self.assertEqual(
            [row.index for row in result.ccc_comparable_summary.comparables],
            [0, 1],
        )

    def test_mileage_differences_are_signed_facts_without_dollar_formula(self) -> None:
        historical = make_historical_input(
            [2_200_000, 2_210_000, 2_220_000],
            mileages=[45_000, 50_000, 65_000],
        )
        result = analyze_valuation_discrepancy(make_request(historical=historical))

        evidence = result.historical_external_summary.selected_evidence
        differences = {
            item.source_listing_id: item.mileage_difference_from_loss_vehicle
            for item in evidence
        }
        self.assertEqual(
            set(differences.values()),
            {-5_000, 0, 15_000},
        )
        for item in evidence:
            serialized = item.to_dict()
            self.assertNotIn("mileageAdjustmentCents", serialized)
            self.assertNotIn("adjustedPriceCents", serialized)
        self.assertIn(
            "NO_INDEPENDENT_MILEAGE_ADJUSTMENT",
            message_codes(result.limitations),
        )

    def test_factory_uses_adjusted_vehicle_value_not_base_or_total(self) -> None:
        report = {
            "report": {"lossDate": "05/19/2026"},
            "vehicle": {
                "year": 2024,
                "make": "Synthetic",
                "model": "Sedan",
                "trim": "SEL",
                "mileage": 50_000,
            },
            "valuation": {
                "baseVehicleValue": 99_999,
                "adjustedVehicleValue": 20_000.55,
                "total": 1,
            },
            "comparables": [],
        }

        request = valuation_discrepancy_request_from_report(
            report, postal_code="63026"
        )

        self.assertEqual(request.ccc_vehicle_valuation, 20_000.55)
        self.assertEqual(request.loss_date, EVIDENCE_DATE)
        self.assertEqual(request.loss_vehicle, make_target())

    def test_factory_loss_date_override_accepts_both_supported_forms(self) -> None:
        report = {
            "vehicle": {
                "year": 2024,
                "make": "Synthetic",
                "model": "Sedan",
                "trim": "SEL",
                "mileage": 50_000,
            },
            "valuation": {"adjustedVehicleValue": 20_000},
            "comparables": [],
        }
        for supplied in ("2026-05-19", "05/19/2026"):
            with self.subTest(supplied=supplied):
                request = valuation_discrepancy_request_from_report(
                    report,
                    postal_code="63026",
                    loss_date_override=supplied,
                )
                self.assertEqual(request.loss_date, EVIDENCE_DATE)

    def test_factory_projects_permissive_legacy_ccc_rows_to_strict_shape(self) -> None:
        report = json.loads(
            (Path(__file__).parent / "benchmarks" / "elantra.json").read_text(
                encoding="utf-8"
            )
        )
        report["comparables"][0]["legacyExtension"] = "ignored by Phase 3D"

        request = valuation_discrepancy_request_from_report(report)
        first = request.to_dict()["cccComparables"][0]

        self.assertEqual(len(request.ccc_comparables), 12)
        self.assertEqual(first["number"], 1)
        self.assertIsNone(first["year"])
        self.assertIsNone(first["contributionPercent"])
        self.assertNotIn("legacyExtension", first)
        validate_valuation_discrepancy_request(request)


class SelectionAndDeterminismTests(unittest.TestCase):
    def test_reordering_non_tied_current_input_keeps_result_deterministic(self) -> None:
        prices = [2_000_000, 2_010_000, 2_020_000, 2_030_000, 2_040_000]
        first = make_current_input(prices, input_order=[0, 1, 2, 3, 4])
        reordered = make_current_input(prices, input_order=[4, 1, 3, 0, 2])

        first_result = analyze_valuation_discrepancy(make_request(current=first))
        reordered_result = analyze_valuation_discrepancy(
            make_request(current=reordered)
        )

        self.assertEqual(first_result.to_dict(), reordered_result.to_dict())

    def test_changing_only_prices_does_not_change_selected_identities(self) -> None:
        baseline = make_current_input(
            [2_000_000, 2_010_000, 2_020_000, 2_030_000, 2_040_000, 9_990_000]
        )
        changed = make_current_input(
            [9_990_000, 100_000, 8_000_000, 200_000, 7_000_000, 300_000]
        )

        baseline_result = analyze_valuation_discrepancy(
            make_request(current=baseline)
        )
        changed_result = analyze_valuation_discrepancy(make_request(current=changed))
        baseline_ids = [
            item.source_listing_id
            for item in baseline_result.current_external_summary.selected_evidence
        ]
        changed_ids = [
            item.source_listing_id
            for item in changed_result.current_external_summary.selected_evidence
        ]

        self.assertEqual(baseline_ids, changed_ids)
        self.assertEqual(baseline_ids, [f"synthetic-listing-{i:03d}" for i in range(1, 6)])

    def test_duplicate_vin_and_missing_identity_are_excluded_by_rank_not_price(self) -> None:
        current = make_current_input(
            [9_000_000, 100_000, 2_000_000, 2_010_000, 2_020_000, 2_030_000],
            vins=[
                "SYNTHETIC-DUPLICATE-VIN",
                "synthetic-duplicate-vin",
                None,
                "SYNTHETIC-UNIQUE-004",
                "SYNTHETIC-UNIQUE-005",
                "SYNTHETIC-UNIQUE-006",
            ],
            listing_ids=[
                "synthetic-listing-001",
                "synthetic-listing-002",
                None,
                "synthetic-listing-004",
                "synthetic-listing-005",
                "synthetic-listing-006",
            ],
        )
        result = analyze_valuation_discrepancy(make_request(current=current))

        summary = result.current_external_summary
        self.assertEqual(summary.duplicate_identity_excluded_count, 1)
        self.assertEqual(summary.identity_missing_excluded_count, 1)
        selected_ids = [item.source_listing_id for item in summary.selected_evidence]
        self.assertIn("synthetic-listing-001", selected_ids)
        self.assertNotIn("synthetic-listing-002", selected_ids)
        self.assertEqual(summary.selected_count, 4)
        self.assertIn(
            "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED", message_codes(result.findings)
        )
        self.assertIn(
            "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED", message_codes(result.findings)
        )

    def test_analysis_is_repeatable_and_does_not_mutate_inputs(self) -> None:
        comparable = make_ccc_comparable(1)
        historical = make_historical_input(
            [1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000]
        )
        request = make_request(
            ccc_comparables=(comparable,), historical=historical
        )
        before = copy.deepcopy(request.to_dict())

        first = analyze_valuation_discrepancy(request).to_dict()
        second = analyze_valuation_discrepancy(request).to_dict()

        self.assertEqual(first, second)
        self.assertEqual(request.to_dict(), before)

    def test_analysis_attempts_no_network_access(self) -> None:
        request = make_request(
            historical=make_historical_input(
                [1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000]
            )
        )
        with patch.object(
            socket,
            "create_connection",
            side_effect=AssertionError("network access attempted"),
        ):
            result = analyze_valuation_discrepancy(request)

        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)


class PolicyBoundaryTests(unittest.TestCase):
    def test_default_policy_values_and_semantics(self) -> None:
        policy = ValuationDiscrepancyPolicy()

        self.assertEqual(
            policy.to_dict(),
            {
                "maxComparisonSet": 5,
                "minimumIndependentCount": 3,
                "strongHistoricalMinimum": 5,
                "potentialGapBasisPoints": 500,
                "materialGapBasisPoints": 1000,
                "highDispersionBasisPoints": 2000,
            },
        )
        validate_valuation_discrepancy_policy(policy)

    def test_minimum_count_below_exact_and_above(self) -> None:
        expected = {
            2: INSUFFICIENT_EVIDENCE,
            3: POTENTIAL_UNDERVALUE,
            4: POTENTIAL_UNDERVALUE,
        }
        for count, classification in expected.items():
            with self.subTest(count=count):
                result = analyze_prices([2_120_000] * count)
                self.assertEqual(result.classification, classification)
                self.assertEqual(
                    result.historical_external_summary.selected_count, count
                )

    def test_strong_historical_count_below_exact_and_above(self) -> None:
        policy = ValuationDiscrepancyPolicy(max_comparison_set=6)
        for count, expected_strength in ((4, MODERATE), (5, STRONG), (6, STRONG)):
            with self.subTest(count=count):
                result = analyze_prices([2_220_000] * count, policy=policy)
                self.assertEqual(result.evidence_strength, expected_strength)
                self.assertEqual(
                    result.historical_external_summary.selected_count,
                    count,
                )

    def test_potential_gap_below_exact_and_above(self) -> None:
        cases = (
            (2_099_999, NO_MATERIAL_DISCREPANCY),
            (2_100_000, POTENTIAL_UNDERVALUE),
            (2_100_001, POTENTIAL_UNDERVALUE),
        )
        for median, expected in cases:
            with self.subTest(median=median):
                result = analyze_prices([median] * 5)
                self.assertEqual(result.classification, expected)

    def test_zero_potential_threshold_never_labels_exact_equality_undervalue(self) -> None:
        policy = ValuationDiscrepancyPolicy(
            potential_gap_basis_points=0,
            material_gap_basis_points=1,
        )
        result = analyze_prices([2_000_000] * 5, policy=policy)

        self.assertEqual(result.classification, NO_MATERIAL_DISCREPANCY)
        self.assertIn("EXTERNAL_MEDIAN_EQUALS_CCC", message_codes(result.findings))
        self.assertNotIn("POTENTIAL_GAP_THRESHOLD_MET", message_codes(result.findings))

    def test_material_gap_below_exact_and_above(self) -> None:
        cases = (
            (2_199_999, POTENTIAL_UNDERVALUE),
            (2_200_000, MATERIAL_UNDERVALUE_SIGNAL),
            (2_200_001, MATERIAL_UNDERVALUE_SIGNAL),
        )
        for median, expected in cases:
            with self.subTest(median=median):
                result = analyze_prices([median] * 5)
                self.assertEqual(result.classification, expected)

    def test_dispersion_below_exact_and_above(self) -> None:
        cases = (
            ([1_200_001, 1_600_001, 2_000_000, 2_399_999, 2_799_999], False),
            ([1_200_000, 1_600_000, 2_000_000, 2_400_000, 2_800_000], True),
            ([1_199_999, 1_599_999, 2_000_000, 2_400_001, 2_800_001], True),
        )
        for prices, conflicting in cases:
            with self.subTest(prices=prices):
                result = analyze_prices(prices)
                self.assertEqual(
                    result.classification == CONFLICTING_EVIDENCE,
                    conflicting,
                )

    def test_comparison_set_limit_below_exact_and_above(self) -> None:
        for count in (4, 5, 6):
            with self.subTest(count=count):
                result = analyze_prices([2_000_000 + index for index in range(count)])
                summary = result.historical_external_summary
                self.assertEqual(summary.selected_count, min(5, count))
                self.assertEqual(
                    summary.comparison_set_limit_excluded_count, max(0, count - 5)
                )

    def test_invalid_policy_relationships_and_unknown_fields_are_rejected(self) -> None:
        invalid = (
            ValuationDiscrepancyPolicy(
                minimum_independent_count=4, strong_historical_minimum=3
            ),
            ValuationDiscrepancyPolicy(
                strong_historical_minimum=6, max_comparison_set=5
            ),
            ValuationDiscrepancyPolicy(
                potential_gap_basis_points=1000, material_gap_basis_points=1000
            ),
        )
        for policy in invalid:
            with self.subTest(policy=policy), self.assertRaises(
                DiscrepancyContractError
            ):
                validate_valuation_discrepancy_policy(policy)

        mapping = ValuationDiscrepancyPolicy().to_dict()
        mapping["undocumentedThreshold"] = 1
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_policy(mapping)

    def test_policy_cannot_reduce_independent_evidence_floor_below_three(self) -> None:
        validate_valuation_discrepancy_policy(
            ValuationDiscrepancyPolicy(
                max_comparison_set=3,
                minimum_independent_count=3,
                strong_historical_minimum=3,
            )
        )
        for count in (1, 2):
            with self.subTest(count=count):
                policy = ValuationDiscrepancyPolicy(
                    max_comparison_set=count,
                    minimum_independent_count=count,
                    strong_historical_minimum=count,
                )
                with self.assertRaises(DiscrepancyContractError):
                    validate_valuation_discrepancy_policy(policy)
                with self.assertRaises(DiscrepancyContractError):
                    validate_valuation_discrepancy_request(
                        make_request(policy=policy)
                    )


class CurrencyBoundaryTests(unittest.TestCase):
    def test_half_up_money_inputs_1004_1005_1006(self) -> None:
        current = make_current_input([100, 100, 100])
        listing_values = [1.004, 1.005, 1.006]
        changed_listings = tuple(
            MarketListing(
                **{
                    **candidate.listing.__dict__,
                    "price": value,
                }
            )
            for candidate, value in zip(current.ranking.candidates, listing_values)
        )
        market_result = MarketSearchResult(
            provider=SYNTHETIC_CURRENT_PROVIDER,
            request=MarketSearchRequest(
                year=2024,
                make="Synthetic",
                model="Sedan",
                trim="SEL",
                loss_vehicle_mileage=50_000,
                postal_code="63026",
                result_limit=3,
            ),
            listings=changed_listings,
        )
        ranking = rank_market_comparables(make_target(), market_result)
        result = analyze_valuation_discrepancy(
            make_request(current=CurrentEvidenceInput(ranking, CURRENT_OBSERVED_DATE))
        )

        self.assertEqual(
            [item.price_cents for item in result.current_external_summary.selected_evidence],
            [100, 101, 101],
        )

    def test_even_median_uses_half_up_integer_cent_rounding(self) -> None:
        cases = (([100, 101], 101), ([101, 102], 102))
        policy = ValuationDiscrepancyPolicy(
            max_comparison_set=3,
            minimum_independent_count=3,
            strong_historical_minimum=3,
        )
        for values, expected in cases:
            with self.subTest(values=values):
                result = analyze_prices(values, policy=policy)
                self.assertEqual(
                    result.historical_external_summary.prices.median_price_cents,
                    expected,
                )

    def test_even_median_stays_exact_through_mad_and_dispersion(self) -> None:
        result = analyze_prices(
            [4, 5, 6, 8],
            ccc_vehicle_valuation_cents=6,
        )

        prices = result.historical_external_summary.prices
        self.assertEqual(prices.median_price_cents, 6)
        self.assertEqual(prices.median_absolute_deviation_cents, 1)
        self.assertEqual(prices.central_half_range_cents, 1)
        self.assertEqual(prices.dispersion_basis_points, 1_818)
        self.assertNotEqual(result.classification, CONFLICTING_EVIDENCE)

    def test_zero_valuation_is_insufficient_and_percentage_is_undefined(self) -> None:
        result = analyze_prices(
            [100, 100, 100, 100, 100], ccc_vehicle_valuation_cents=0
        )

        self.assertEqual(result.ccc_vehicle_valuation_cents, 0)
        self.assertEqual(result.classification, INSUFFICIENT_EVIDENCE)
        self.assertIsNone(result.primary_comparison.difference_basis_points)
        self.assertIn(
            "NONPOSITIVE_CCC_VEHICLE_VALUATION", message_codes(result.findings)
        )

    def test_large_safe_money_value_remains_exact_integer_cents(self) -> None:
        large_dollars = 90_000_000_000_000
        target_cents = large_dollars * 100
        result = analyze_valuation_discrepancy(
            make_request(
                ccc_vehicle_valuation=large_dollars,
                historical=make_historical_input([target_cents] * 5),
            )
        )

        self.assertEqual(result.ccc_vehicle_valuation_cents, target_cents)
        self.assertEqual(
            result.historical_external_summary.prices.median_price_cents,
            target_cents,
        )
        self.assertEqual(result.primary_comparison.difference_cents, 0)

    def test_money_beyond_safe_integer_cent_range_is_rejected(self) -> None:
        too_large_dollars = MAX_SAFE_MONEY_CENTS // 100 + 1

        ccc_request = make_request().to_dict()
        ccc_request["cccVehicleValuation"] = too_large_dollars
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_request(ccc_request)

        external_request = make_request(
            current=make_current_input([2_000_000, 2_010_000, 2_020_000])
        ).to_dict()
        external_request["currentEvidence"]["ranking"]["candidates"][0]["listing"][
            "price"
        ] = too_large_dollars
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_request(external_request)

    def test_derived_net_adjustment_range_must_remain_safe_integer_cents(self) -> None:
        large_cents = 9_000_000_000_000_000
        request = make_request(
            ccc_comparables=(
                make_ccc_comparable(
                    1,
                    list_price_cents=large_cents,
                    adjusted_value_cents=0,
                ),
                make_ccc_comparable(
                    2,
                    list_price_cents=0,
                    adjusted_value_cents=large_cents,
                ),
            )
        )

        with self.assertRaises(DiscrepancyContractError) as raised:
            validate_valuation_discrepancy_request(request)

        self.assertTrue(
            any("net-adjustment range" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_equality_negative_and_positive_differences(self) -> None:
        cases = (
            (2_000_000, 0, 0, "WITHIN_OBSERVED_RANGE"),
            (1_900_000, -100_000, -500, ABOVE_OBSERVED_RANGE),
            (2_100_000, 100_000, 500, BELOW_OBSERVED_RANGE),
        )
        for external, difference, basis_points, position in cases:
            with self.subTest(external=external):
                result = analyze_prices([external] * 5)
                comparison = result.primary_comparison
                self.assertEqual(comparison.difference_cents, difference)
                self.assertEqual(comparison.difference_basis_points, basis_points)
                self.assertEqual(comparison.ccc_position_in_external_range, position)

    def test_percentage_basis_points_round_half_up_without_float_artifacts(self) -> None:
        cases = (
            (3, 4, 3_333),
            (6, 7, 1_667),
        )
        for valuation_cents, external_cents, expected_basis_points in cases:
            with self.subTest(
                valuation_cents=valuation_cents,
                external_cents=external_cents,
            ):
                result = analyze_prices(
                    [external_cents] * 5,
                    ccc_vehicle_valuation_cents=valuation_cents,
                )
                self.assertEqual(
                    result.primary_comparison.difference_basis_points,
                    expected_basis_points,
                )


class ContractAndSchemaTests(unittest.TestCase):
    def test_synthetic_fixture_manifest_covers_required_scenarios(self) -> None:
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.assertIs(fixture["syntheticData"], True)
        self.assertIn("Fictional", fixture["notice"])
        case_names = {case["name"] for case in fixture["cases"]}
        self.assertTrue(
            {
                "clearly-consistent",
                "potential-undervalue",
                "material-undervalue-signal",
                "one-high-outlier",
                "one-low-outlier",
                "high-dispersion",
                "insufficient-count",
                "ambiguous-records",
                "unresolved-records",
                "historical-out-of-provider-range",
                "current-only",
                "historical-and-current",
                "ccc-adjustments",
                "mileage-differences",
                "price-order-independence",
                "price-selection-independence",
                "threshold-boundaries",
                "currency-boundaries",
            }.issubset(case_names)
        )

    def test_request_and_result_schemas_meta_validate(self) -> None:
        for path in (
            VALUATION_DISCREPANCY_REQUEST_SCHEMA_PATH,
            VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH,
        ):
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(
                    schema["$schema"],
                    "https://json-schema.org/draft/2020-12/schema",
                )
                Draft202012Validator.check_schema(schema)

    def test_generated_request_and_result_validate_as_objects_and_mappings(self) -> None:
        request = make_request(
            historical=make_historical_input(
                [1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000]
            )
        )
        result = analyze_valuation_discrepancy(request)

        validate_valuation_discrepancy_request(request)
        validate_valuation_discrepancy_request(request.to_dict())
        validate_valuation_discrepancy_result(result)
        validate_valuation_discrepancy_result(result.to_dict())

    def test_unknown_properties_are_rejected_at_request_and_result_roots(self) -> None:
        request = make_request().to_dict()
        request["futureRequestField"] = True
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_request(request)

        valid_result = analyze_prices(
            [1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000]
        ).to_dict()
        valid_result["futureResultField"] = True
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_result(valid_result)

    def test_unknown_properties_are_rejected_in_nested_public_structures(self) -> None:
        request = make_request(
            ccc_comparables=(make_ccc_comparable(1),),
            historical=make_historical_input([2_000_000, 2_010_000, 2_020_000]),
        ).to_dict()
        request["cccComparables"][0]["undocumentedAdjustment"] = 1
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_request(request)

        result = analyze_prices(
            [1_950_000, 1_990_000, 2_000_000, 2_010_000, 2_050_000]
        ).to_dict()
        result["historicalExternalSummary"]["prices"]["futureStatistic"] = 0
        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_result(result)

    def test_negative_ccc_distance_and_mileage_are_rejected_at_request_boundary(self) -> None:
        for field in ("distanceMiles", "mileage"):
            with self.subTest(field=field):
                request = make_request(
                    ccc_comparables=(make_ccc_comparable(1),)
                ).to_dict()
                request["cccComparables"][0][field] = -1
                with self.assertRaises(DiscrepancyContractError):
                    validate_valuation_discrepancy_request(request)

    def test_result_semantic_tampering_is_rejected(self) -> None:
        original = analyze_valuation_discrepancy(
            make_request(
                ccc_comparables=(make_ccc_comparable(1),),
                historical=make_historical_input(
                    [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000]
                ),
            )
        ).to_dict()
        mutations = {
            "classification": lambda value: value.__setitem__(
                "classification", NO_MATERIAL_DISCREPANCY
            ),
            "summary median": lambda value: value["historicalExternalSummary"][
                "prices"
            ].__setitem__("medianPriceCents", 1),
            "selected count": lambda value: value["historicalExternalSummary"].__setitem__(
                "selectedCount", 4
            ),
            "evidence basis": lambda value: value.__setitem__(
                "evidenceBasis", CURRENT_MARKET
            ),
            "primary formula": lambda value: value["primaryComparison"].__setitem__(
                "differenceCents", 1
            ),
            "CCC row index": lambda value: value["cccComparableSummary"][
                "comparables"
            ][0].__setitem__("index", 99),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                result = copy.deepcopy(original)
                mutate(result)
                with self.assertRaises(DiscrepancyContractError):
                    validate_valuation_discrepancy_result(result)

    def test_result_recomputes_counts_ranks_findings_and_relevant_limitations(self) -> None:
        original = analyze_valuation_discrepancy(
            make_request(
                current=make_current_input([1_990_000, 2_000_000, 2_010_000])
            )
        ).to_dict()

        def move_ranks_outside_candidate_set(value: dict[str, Any]) -> None:
            for index, item in enumerate(
                value["currentExternalSummary"]["selectedEvidence"], start=1
            ):
                item["rank"] = 900 + index

        def move_ranks_into_ineligible_tail(value: dict[str, Any]) -> None:
            summary = value["currentExternalSummary"]
            summary["rankedCandidateCount"] = 10
            summary["ineligibleCount"] = 7
            summary["resolvedCount"] = 10
            for index, item in enumerate(summary["selectedEvidence"], start=8):
                item["rank"] = index

        def disguise_under_selection_as_policy_cap(value: dict[str, Any]) -> None:
            summary = value["currentExternalSummary"]
            summary["rankedCandidateCount"] = 5
            summary["eligibleCandidateCount"] = 5
            summary["resolvedCount"] = 5
            summary["comparisonSetLimitExcludedCount"] = 2
            value["findings"].append(
                {
                    "code": "EXTERNAL_COMPARISON_SET_BOUNDED",
                    "description": "Synthetic tampering stimulus.",
                }
            )

        mutations = {
            "resolved count": lambda value: value["currentExternalSummary"].__setitem__(
                "resolvedCount", 999
            ),
            "selected rank bounds": move_ranks_outside_candidate_set,
            "selected rank in ineligible tail": move_ranks_into_ineligible_tail,
            "under-selection disguised as cap": disguise_under_selection_as_policy_cap,
            "missing findings": lambda value: value.__setitem__("findings", []),
            "false material finding": lambda value: value["findings"].append(
                {
                    "code": "MATERIAL_GAP_THRESHOLD_MET",
                    "description": "Synthetic tampering stimulus.",
                }
            ),
            "missing current limitation": lambda value: value.__setitem__(
                "limitations",
                [
                    item
                    for item in value["limitations"]
                    if item["code"] != "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE"
                ],
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                result = copy.deepcopy(original)
                mutate(result)
                with self.assertRaises(DiscrepancyContractError):
                    validate_valuation_discrepancy_result(result)

    def test_result_requires_issue_specific_findings_and_limitations(self) -> None:
        original = analyze_valuation_discrepancy(
            make_request(
                historical=make_historical_input(
                    [1_990_000, 2_000_000, 2_010_000],
                    ambiguous_count=1,
                    unresolved_count=1,
                )
            )
        ).to_dict()
        conditional_codes = (
            "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED",
            "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED",
            "AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED",
            "UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED",
        )
        for code in conditional_codes:
            with self.subTest(code=code):
                result = copy.deepcopy(original)
                collection = (
                    "findings" if any(item["code"] == code for item in result["findings"])
                    else "limitations"
                )
                result[collection] = [
                    item for item in result[collection] if item["code"] != code
                ]
                with self.assertRaises(DiscrepancyContractError):
                    validate_valuation_discrepancy_result(result)

    def test_result_cannot_forge_phase_3c_tier_to_escalate_strength(self) -> None:
        result = analyze_prices(
            [2_180_000, 2_200_000, 2_220_000, 2_240_000, 2_260_000],
            weak_indices={5},
        ).to_dict()
        summary = result["historicalExternalSummary"]
        weak_row = next(item for item in summary["selectedEvidence"] if item["tier"] == "WEAK")
        weak_row["tier"] = "GOOD"
        summary["selectedWeakCount"] = 0
        result["evidenceStrength"] = STRONG
        result["classification"] = MATERIAL_UNDERVALUE_SIGNAL
        for finding in result["findings"]:
            if finding["code"] == "POTENTIAL_GAP_THRESHOLD_MET":
                finding["code"] = "MATERIAL_GAP_THRESHOLD_MET"

        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_result(result)

    def test_result_selected_scores_must_follow_phase_3c_rank_order(self) -> None:
        result = analyze_prices(
            [1_980_000, 1_990_000, 2_000_000, 2_010_000, 2_020_000]
        ).to_dict()
        selected = result["historicalExternalSummary"]["selectedEvidence"]
        selected[0]["score"] = 85
        selected[0]["tier"] = "STRONG"
        selected[1]["score"] = 100
        selected[1]["tier"] = "STRONG"

        with self.assertRaises(DiscrepancyContractError):
            validate_valuation_discrepancy_result(result)

    def test_historical_ranking_must_exactly_match_result_including_price(self) -> None:
        historical = make_historical_input(
            [2_000_000, 2_010_000, 2_020_000]
        )
        mismatched_ranking = make_ranking(
            [9_000_000, 2_010_000, 2_020_000],
            provider=SYNTHETIC_HISTORICAL_PROVIDER,
        )
        request = make_request(
            historical=HistoricalEvidenceInput(
                result=historical.result,
                ranking=mismatched_ranking,
            )
        )

        with self.assertRaises(DiscrepancyContractError) as raised:
            validate_valuation_discrepancy_request(request)

        self.assertTrue(
            any("including price" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_historical_phase_3c_final_tie_preserves_resolved_provider_order(self) -> None:
        target = make_target()
        listings = tuple(
            MarketListing(
                **{
                    **make_listing(
                        index,
                        price,
                        provider=SYNTHETIC_HISTORICAL_PROVIDER,
                        mileage=target.mileage,
                    ).__dict__,
                    "distance_miles": 10,
                }
            )
            for index, price in enumerate(
                (1_900_000, 2_000_000, 2_100_000), start=1
            )
        )
        market_request = MarketSearchRequest(
            year=target.year,
            make=target.make,
            model=target.model,
            trim=target.trim,
            loss_vehicle_mileage=target.mileage,
            postal_code=target.postal_code,
            result_limit=3,
        )
        ranking = rank_market_comparables(
            target,
            MarketSearchResult(
                provider=SYNTHETIC_HISTORICAL_PROVIDER,
                request=market_request,
                listings=listings,
            ),
        )
        historical_result = HistoricalMarketSearchResult(
            provider=SYNTHETIC_HISTORICAL_PROVIDER,
            evidence_date=EVIDENCE_DATE,
            as_of_date=AS_OF_DATE,
            coverage=HistoricalCoverage(SUPPORTED, 90),
            request=HistoricalMarketSearchRequest(
                evidence_date=EVIDENCE_DATE,
                year=target.year,
                make=target.make,
                model=target.model,
                trim=target.trim,
                loss_vehicle_mileage=target.mileage,
                postal_code=target.postal_code or "63026",
                result_limit=3,
            ),
            evidence=tuple(
                HistoricalEvidenceItem(
                    listing=listing,
                    temporal_evidence=make_temporal(),
                )
                for listing in listings
            ),
        )
        request = make_request(
            historical=HistoricalEvidenceInput(historical_result, ranking)
        ).to_dict()
        candidates = request["historicalEvidence"]["ranking"]["candidates"]
        candidates[0], candidates[1] = candidates[1], candidates[0]
        candidates[0]["rank"] = 1
        candidates[1]["rank"] = 2

        with self.assertRaises(DiscrepancyContractError) as raised:
            validate_valuation_discrepancy_request(request)

        self.assertTrue(
            any("final Phase 3C ties" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_historical_issue_identity_cannot_also_contribute_a_price(self) -> None:
        historical = make_historical_input([1_990_000, 2_000_000, 2_010_000])
        overlapping_vin = historical.result.evidence[0].listing.vin
        overlapping_result = HistoricalMarketSearchResult(
            provider=historical.result.provider,
            evidence_date=historical.result.evidence_date,
            as_of_date=historical.result.as_of_date,
            coverage=historical.result.coverage,
            request=historical.result.request,
            evidence=historical.result.evidence,
            issues=(
                HistoricalEvidenceIssue(
                    status=AMBIGUOUS,
                    reason="MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE",
                    vin=overlapping_vin,
                ),
            ),
        )
        request = make_request(
            historical=HistoricalEvidenceInput(
                result=overlapping_result,
                ranking=historical.ranking,
            )
        )

        with self.assertRaises(DiscrepancyContractError) as raised:
            validate_valuation_discrepancy_request(request)

        self.assertTrue(
            any("cannot also contribute" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_historical_request_vehicle_and_origin_must_match_loss_target(self) -> None:
        request = make_request(
            historical=make_historical_input([2_000_000, 2_010_000, 2_020_000])
        ).to_dict()
        request["historicalEvidence"]["result"]["request"]["postalCode"] = "99999"

        with self.assertRaises(DiscrepancyContractError) as raised:
            validate_valuation_discrepancy_request(request)

        self.assertTrue(
            any("distance-origin" in detail for detail in raised.exception.details),
            raised.exception.details,
        )

    def test_request_snapshots_ccc_comparable_mappings(self) -> None:
        comparable = make_ccc_comparable(1)
        request = make_request(ccc_comparables=(comparable,))
        comparable["listPrice"] = 1
        comparable["adjustments"]["condition"] = 999

        serialized = request.to_dict()["cccComparables"][0]
        self.assertEqual(serialized["listPrice"], 20_000)
        self.assertEqual(serialized["adjustments"]["condition"], -500)


if __name__ == "__main__":
    unittest.main()
