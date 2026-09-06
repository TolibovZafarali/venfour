"""Deterministic coverage for provider-neutral adaptive market discovery."""

from __future__ import annotations

import copy
from dataclasses import replace
import unittest
from typing import Callable

from venfour.adaptive_search import (
    CANDIDATE_VERIFICATION_LIMIT_REACHED,
    CURRENT_PROVIDER_PARTIAL_RESULTS,
    CURRENT_SEARCH_CEILING_REACHED,
    DEFAULT_ADAPTIVE_SEARCH_POLICIES,
    DEFAULT_ADAPTIVE_SEARCH_POLICY,
    DEFAULT_HISTORICAL_ADAPTIVE_SEARCH_POLICY,
    HISTORICAL_SEARCH_CEILING_REACHED,
    HISTORICAL_OUT_OF_PROVIDER_RANGE,
    MAX_SCOPE_REACHED,
    MAX_UNIQUE_CANDIDATES,
    SUFFICIENT_STRONG_MATCHES,
    AdaptiveSearchContractError,
    AdaptiveSearchPolicy,
    AdaptiveSearchPolicies,
    SearchStage,
    adaptive_discover_historical_market_evidence,
    adaptive_discover_market_listings,
    adaptive_search_policies_from_dict,
    adaptive_search_policy_from_dict,
    adaptive_search_policy_for_provider,
    replay_current_adaptive_search,
    replay_historical_adaptive_search,
)
from venfour.historical_market import (
    OUT_OF_PROVIDER_RANGE,
    RESOLVED,
    SUPPORTED,
    UNRESOLVED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
)
from venfour.market import (
    DrivetrainDiscovery,
    MarketListing,
    MarketProviderUnavailableError,
    MarketSearchRequest,
    MarketSearchResult,
    VehicleConfigurationIdentity,
)


PROVIDER = "synthetic-market"


def current_request(**changes: object) -> MarketSearchRequest:
    values: dict[str, object] = {
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "trim": "SEL",
        "loss_vehicle_mileage": 46_926,
        "postal_code": "63123",
    }
    values.update(changes)
    return MarketSearchRequest(**values)  # type: ignore[arg-type]


def listing(
    index: int,
    *,
    vin: str | None | object = ...,
    source_listing_id: str | None | object = ...,
    price: int = 20_000,
    distance: int = 10,
    make: str = "Hyundai",
    model: str = "Elantra",
) -> MarketListing:
    actual_vin = f"SYNTHETICVIN{index:05d}" if vin is ... else vin
    actual_id = (
        f"listing-{index:03d}"
        if source_listing_id is ...
        else source_listing_id
    )
    return MarketListing(
        source=PROVIDER,
        source_listing_id=actual_id,  # type: ignore[arg-type]
        year=2024,
        make=make,
        model=model,
        trim="SEL",
        vin=actual_vin,  # type: ignore[arg-type]
        mileage=46_926 + index,
        price=price,
        distance_miles=distance,
    )


class CurrentProvider:
    name = PROVIDER

    def __init__(
        self,
        rows: dict[int, tuple[MarketListing, ...]],
        *,
        fail_at_radius: int | None = None,
    ) -> None:
        self.rows = rows
        self.fail_at_radius = fail_at_radius
        self.requests: list[MarketSearchRequest] = []

    def search(self, request: MarketSearchRequest) -> MarketSearchResult:
        self.requests.append(request)
        if request.radius_miles == self.fail_at_radius:
            raise MarketProviderUnavailableError("synthetic later-stage failure")
        return MarketSearchResult(
            provider=self.name,
            request=request,
            listings=self.rows.get(request.radius_miles, ()),
        )


def historical_request(**changes: object) -> HistoricalMarketSearchRequest:
    values: dict[str, object] = {
        "evidence_date": "2026-08-01",
        "year": 2024,
        "make": "Hyundai",
        "model": "Elantra",
        "postal_code": "63123",
        "trim": "SEL",
        "loss_vehicle_mileage": 46_926,
    }
    values.update(changes)
    return HistoricalMarketSearchRequest(**values)  # type: ignore[arg-type]


def evidence(index: int, **listing_changes: object) -> HistoricalEvidenceItem:
    return HistoricalEvidenceItem(
        listing=listing(index, **listing_changes),
        temporal_evidence=TemporalEvidence(
            status=RESOLVED,
            evidence_date="2026-08-01",
            record_first_seen_at="2026-07-31T00:00:00Z",
            record_last_seen_at="2026-08-02T00:00:00Z",
        ),
    )


class HistoricalProvider:
    name = PROVIDER

    def __init__(
        self,
        result_factory: Callable[
            [HistoricalMarketSearchRequest], HistoricalMarketSearchResult
        ],
        *,
        fail_at_radius: int | None = None,
    ) -> None:
        self.result_factory = result_factory
        self.fail_at_radius = fail_at_radius
        self.requests: list[HistoricalMarketSearchRequest] = []

    def search_historical(
        self, request: HistoricalMarketSearchRequest
    ) -> HistoricalMarketSearchResult:
        self.requests.append(request)
        if request.radius_miles == self.fail_at_radius:
            raise MarketProviderUnavailableError("synthetic later-stage failure")
        return self.result_factory(request)


def historical_result(
    request: HistoricalMarketSearchRequest,
    *,
    evidence_rows: tuple[HistoricalEvidenceItem, ...] = (),
    issues: tuple[HistoricalEvidenceIssue, ...] = (),
    coverage: str = SUPPORTED,
) -> HistoricalMarketSearchResult:
    return HistoricalMarketSearchResult(
        provider=PROVIDER,
        evidence_date=request.evidence_date,
        as_of_date=(
            "2026-11-10"
            if coverage == OUT_OF_PROVIDER_RANGE
            else "2026-08-10"
        ),
        coverage=HistoricalCoverage(coverage, 90),
        request=request,
        evidence=evidence_rows,
        issues=issues,
    )


class AdaptivePolicyTests(unittest.TestCase):
    def test_default_policy_has_explicit_server_owned_bounds(self) -> None:
        policy = AdaptiveSearchPolicy()

        self.assertEqual(
            [(stage.radius_miles, stage.result_limit) for stage in policy.stages],
            [(50, 25), (100, 50), (200, 75), (250, 100)],
        )
        self.assertEqual(policy.minimum_strong_matches, 9)
        self.assertEqual(policy.max_unique_candidates, 100)
        self.assertEqual(adaptive_search_policy_from_dict(policy.to_dict()), policy)
        self.assertEqual(
            policy.to_dict()["identityStrategy"], "VIN_THEN_SOURCE_LISTING_ID"
        )
        self.assertIs(policy.to_dict()["priceIndependent"], True)
        self.assertEqual(
            [
                (stage.radius_miles, stage.result_limit)
                for stage in DEFAULT_HISTORICAL_ADAPTIVE_SEARCH_POLICY.stages
            ],
            [(50, 25), (100, 50)],
        )
        self.assertEqual(
            adaptive_search_policies_from_dict(
                DEFAULT_ADAPTIVE_SEARCH_POLICIES.to_dict()
            ),
            AdaptiveSearchPolicies(),
        )

    def test_policy_requires_increasing_radius_and_nondecreasing_depth(self) -> None:
        cases = (
            (SearchStage(50, 25), SearchStage(50, 50)),
            (SearchStage(50, 25), SearchStage(100, 24)),
        )
        for stages in cases:
            with self.subTest(stages=stages), self.assertRaises(
                AdaptiveSearchContractError
            ):
                AdaptiveSearchPolicy(stages=stages)

        with self.assertRaises(AdaptiveSearchContractError):
            AdaptiveSearchPolicy(
                minimum_strong_matches=3,
                max_unique_candidates=2,
            )
        for invalid_stage in (SearchStage(250, 100),):
            with self.subTest(stage=invalid_stage):
                with self.assertRaises(AdaptiveSearchContractError):
                    AdaptiveSearchPolicy(stages=(invalid_stage,) * 5)
        for radius, result_limit in ((251, 100), (250, 101)):
            with self.subTest(radius=radius, result_limit=result_limit):
                with self.assertRaises(AdaptiveSearchContractError):
                    SearchStage(radius, result_limit)


class AdaptiveCurrentSearchTests(unittest.TestCase):
    def test_local_strong_evidence_stops_after_first_attempt(self) -> None:
        provider = CurrentProvider({50: tuple(listing(i) for i in range(9))})

        adaptive = adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(adaptive.diagnostics.stop_reason, SUFFICIENT_STRONG_MATCHES)
        self.assertEqual(adaptive.result.listing_count, 9)
        self.assertEqual(adaptive.ranking.tier_counts["STRONG"], 9)
        self.assertEqual(adaptive.diagnostics.attempts[0].strong_match_count, 9)
        self.assertEqual(adaptive.result.request.radius_miles, 50)
        self.assertEqual(adaptive.result.request.result_limit, 25)

    def test_sparse_evidence_expands_across_multiple_stages(self) -> None:
        provider = CurrentProvider(
            {
                50: tuple(listing(i) for i in range(2)),
                100: tuple(listing(i) for i in range(2, 4)),
                200: tuple(listing(i) for i in range(4, 9)),
            }
        )

        adaptive = adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual([r.radius_miles for r in provider.requests], [50, 100, 200])
        self.assertEqual(
            [a.cumulative_unique_count for a in adaptive.diagnostics.attempts],
            [2, 4, 9],
        )
        self.assertEqual(adaptive.diagnostics.stop_reason, SUFFICIENT_STRONG_MATCHES)
        self.assertEqual(adaptive.result.request.radius_miles, 200)
        self.assertEqual(adaptive.result.request.result_limit, 75)

    def test_dedup_uses_any_vin_or_source_listing_alias_and_keeps_first(self) -> None:
        first = listing(1, vin="SharedVin", source_listing_id="first-id", price=11_111)
        duplicate_vin = listing(
            2, vin=" sharedvin ", source_listing_id="new-alias", price=99_999
        )
        transitive_alias = listing(
            3, vin="OTHER-VIN", source_listing_id="new-alias", price=88_888
        )
        duplicate_id = listing(
            4, vin="FOURTH-VIN", source_listing_id="first-id", price=77_777
        )
        unique = listing(5)
        policy = AdaptiveSearchPolicy(
            stages=(
                SearchStage(50, 5),
                SearchStage(100, 10),
                SearchStage(200, 10),
            ),
            minimum_strong_matches=9,
            max_unique_candidates=10,
        )
        provider = CurrentProvider(
            {
                50: (first,),
                100: (duplicate_vin, unique),
                200: (transitive_alias, duplicate_id),
            }
        )

        adaptive = adaptive_discover_market_listings(
            current_request(), provider, policy
        )

        self.assertEqual(adaptive.result.listings, (first, unique))
        self.assertEqual(
            [attempt.duplicate_count for attempt in adaptive.diagnostics.attempts],
            [0, 1, 2],
        )
        self.assertEqual(
            [attempt.new_unique_count for attempt in adaptive.diagnostics.attempts],
            [1, 1, 0],
        )
        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_SCOPE_REACHED)

    def test_candidate_cap_stops_and_records_excluded_unique_candidates(self) -> None:
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 5), SearchStage(100, 10)),
            minimum_strong_matches=2,
            max_unique_candidates=2,
        )
        provider = CurrentProvider(
            {50: tuple(listing(i, make="Other") for i in range(5))}
        )

        adaptive = adaptive_discover_market_listings(
            current_request(), provider, policy
        )

        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_UNIQUE_CANDIDATES)
        self.assertEqual(adaptive.result.listing_count, 2)
        self.assertEqual(adaptive.result.request.result_limit, 2)
        self.assertEqual(
            adaptive.diagnostics.attempts[0].candidate_limit_excluded_count, 3
        )
        self.assertEqual(len(provider.requests), 1)

    def test_identity_less_rows_do_not_exhaust_the_unique_candidate_cap(self) -> None:
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 2), SearchStage(100, 2)),
            minimum_strong_matches=2,
            max_unique_candidates=2,
        )
        provider = CurrentProvider(
            {
                50: (
                    listing(1, vin=None, source_listing_id=None),
                    listing(2, vin=None, source_listing_id=None),
                ),
                100: (
                    listing(3, vin=None, source_listing_id=None),
                    listing(4, vin=None, source_listing_id=None),
                ),
            }
        )

        adaptive = adaptive_discover_market_listings(
            current_request(), provider, policy
        )

        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_SCOPE_REACHED)
        self.assertEqual(
            [attempt.cumulative_unique_count for attempt in adaptive.diagnostics.attempts],
            [0, 0],
        )
        self.assertEqual(adaptive.result.listing_count, 4)

    def test_empty_results_reach_the_hard_maximum_scope(self) -> None:
        provider = CurrentProvider({})

        adaptive = adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual(
            [(r.radius_miles, r.result_limit) for r in provider.requests],
            [(50, 25), (100, 50), (200, 75), (250, 100)],
        )
        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_SCOPE_REACHED)
        self.assertEqual(adaptive.result.request.radius_miles, 250)
        self.assertEqual(adaptive.result.request.result_limit, 100)

    def test_provider_ceiling_retains_sparse_current_evidence_at_100(self) -> None:
        provider = CurrentProvider(
            {
                50: (listing(1), listing(2)),
                100: (listing(3), listing(4)),
            }
        )
        provider.maximum_search_radius_miles = 100

        adaptive = adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in provider.requests
            ],
            [(50, 25), (100, 50)],
        )
        self.assertEqual(
            adaptive.diagnostics.stop_reason,
            CURRENT_SEARCH_CEILING_REACHED,
        )
        self.assertEqual(
            adaptive.result.listings,
            (listing(1), listing(2), listing(3), listing(4)),
        )
        self.assertEqual(adaptive.ranking.eligible_count, 4)
        effective_policy = adaptive_search_policy_for_provider(
            DEFAULT_ADAPTIVE_SEARCH_POLICY, provider
        )
        replayed = replay_current_adaptive_search(
            current_request(),
            adaptive.diagnostics,
            policy=effective_policy,
            ceiling_stop_reason=CURRENT_SEARCH_CEILING_REACHED,
        )
        self.assertEqual(replayed.result, adaptive.result)
        self.assertEqual(replayed.ranking, adaptive.ranking)

    def test_configured_100_mile_policy_is_not_a_provider_ceiling(self) -> None:
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 25), SearchStage(100, 50))
        )
        provider = CurrentProvider({})
        provider.maximum_search_radius_miles = 100

        adaptive = adaptive_discover_market_listings(
            current_request(), provider, policy
        )

        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_SCOPE_REACHED)

    def test_larger_declared_capability_keeps_200_and_250_scopes(self) -> None:
        provider = CurrentProvider({})
        provider.maximum_search_radius_miles = 250

        adaptive = adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in provider.requests
            ],
            [(50, 25), (100, 50), (200, 75), (250, 100)],
        )
        self.assertEqual(adaptive.diagnostics.stop_reason, MAX_SCOPE_REACHED)

    def test_price_metamorphism_cannot_change_expansion_or_stopping(self) -> None:
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 2), SearchStage(100, 4)),
            minimum_strong_matches=3,
            max_unique_candidates=10,
        )
        low = CurrentProvider(
            {
                50: (listing(1, price=1),),
                100: (listing(2, price=2), listing(3, price=3)),
            }
        )
        high = CurrentProvider(
            {
                50: (listing(1, price=1_000_001),),
                100: (
                    listing(2, price=2_000_002),
                    listing(3, price=3_000_003),
                ),
            }
        )

        first = adaptive_discover_market_listings(current_request(), low, policy)
        second = adaptive_discover_market_listings(current_request(), high, policy)

        self.assertEqual(
            [request.radius_miles for request in low.requests],
            [request.radius_miles for request in high.requests],
        )
        self.assertEqual(first.diagnostics.stop_reason, second.diagnostics.stop_reason)
        self.assertEqual(
            [
                (a.cumulative_unique_count, a.eligible_count, a.strong_match_count)
                for a in first.diagnostics.attempts
            ],
            [
                (a.cumulative_unique_count, a.eligible_count, a.strong_match_count)
                for a in second.diagnostics.attempts
            ],
        )

    def test_later_provider_failure_preserves_usable_partial_results(self) -> None:
        provider = CurrentProvider(
            {50: (listing(1),)}, fail_at_radius=100
        )

        result = adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual([r.radius_miles for r in provider.requests], [50, 100])
        self.assertEqual(
            result.diagnostics.stop_reason, CURRENT_PROVIDER_PARTIAL_RESULTS
        )
        self.assertEqual(result.result.listing_count, 1)
        self.assertIsInstance(
            result.provider_failure, MarketProviderUnavailableError
        )
        replayed = replay_current_adaptive_search(
            current_request(), result.diagnostics
        )
        self.assertEqual(replayed.result, result.result)
        self.assertEqual(replayed.ranking, result.ranking)

    def test_full_attempt_stream_replays_and_detects_count_tampering(self) -> None:
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 2), SearchStage(100, 4)),
            minimum_strong_matches=2,
            max_unique_candidates=10,
        )
        provider = CurrentProvider({50: (listing(1),), 100: (listing(2),)})
        adaptive = adaptive_discover_market_listings(
            current_request(), provider, policy
        )

        replayed = replay_current_adaptive_search(
            current_request(), adaptive.diagnostics.to_dict(), policy=policy
        )
        self.assertEqual(replayed.result, adaptive.result)
        self.assertEqual(replayed.ranking, adaptive.ranking)
        tampered = copy.deepcopy(adaptive.diagnostics.to_dict())
        tampered["attempts"][0]["eligibleCount"] += 1
        with self.assertRaises(AdaptiveSearchContractError):
            replay_current_adaptive_search(
                current_request(), tampered, policy=policy
            )


class AdaptiveHistoricalSearchTests(unittest.TestCase):
    def test_historical_evidence_expands_deduplicates_and_replays(self) -> None:
        rows = {
            50: (evidence(1),),
            100: (
                evidence(
                    2,
                    vin="syntheticvin00001",
                    source_listing_id="second-alias",
                    price=99_999,
                ),
                evidence(3),
            ),
        }
        provider = HistoricalProvider(
            lambda request: historical_result(
                request, evidence_rows=rows.get(request.radius_miles, ())
            )
        )
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 2), SearchStage(100, 4)),
            minimum_strong_matches=2,
            max_unique_candidates=10,
        )

        adaptive = adaptive_discover_historical_market_evidence(
            historical_request(), provider, policy
        )

        self.assertEqual([r.radius_miles for r in provider.requests], [50, 100])
        self.assertEqual(adaptive.diagnostics.stop_reason, SUFFICIENT_STRONG_MATCHES)
        self.assertEqual(adaptive.result.evidence, (rows[50][0], rows[100][1]))
        self.assertEqual(adaptive.diagnostics.attempts[1].duplicate_count, 1)
        self.assertEqual(adaptive.ranking.eligible_count, 2)  # type: ignore[union-attr]
        replayed = replay_historical_adaptive_search(
            historical_request(), adaptive.diagnostics.to_dict(), policy=policy
        )
        self.assertEqual(replayed.result, adaptive.result)
        self.assertEqual(replayed.ranking, adaptive.ranking)

    def test_out_of_provider_range_stops_without_expansion(self) -> None:
        provider = HistoricalProvider(
            lambda request: historical_result(
                request, coverage=OUT_OF_PROVIDER_RANGE
            )
        )

        adaptive = adaptive_discover_historical_market_evidence(
            historical_request(), provider
        )

        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(
            adaptive.diagnostics.stop_reason, HISTORICAL_OUT_OF_PROVIDER_RANGE
        )
        self.assertIsNone(adaptive.ranking)
        self.assertEqual(adaptive.result.evidence, ())

    def test_global_candidate_verification_limit_is_a_terminal_issue(self) -> None:
        issue = HistoricalEvidenceIssue(
            status=UNRESOLVED,
            reason=CANDIDATE_VERIFICATION_LIMIT_REACHED,
        )
        provider = HistoricalProvider(
            lambda request: historical_result(request, issues=(issue,))
        )

        adaptive = adaptive_discover_historical_market_evidence(
            historical_request(), provider
        )

        self.assertEqual(len(provider.requests), 1)
        self.assertEqual(
            adaptive.diagnostics.stop_reason,
            CANDIDATE_VERIFICATION_LIMIT_REACHED,
        )
        self.assertEqual(adaptive.result.issues, (issue,))
        self.assertEqual(adaptive.diagnostics.attempts[0].unresolved_count, 1)

    def test_identity_less_issues_do_not_exhaust_historical_unique_cap(self) -> None:
        issue = HistoricalEvidenceIssue(
            status=UNRESOLVED,
            reason="MISSING_LISTING_IDENTITY",
        )
        provider = HistoricalProvider(
            lambda request: historical_result(request, issues=(issue, issue))
        )
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 2), SearchStage(100, 2)),
            minimum_strong_matches=2,
            max_unique_candidates=2,
        )

        adaptive = adaptive_discover_historical_market_evidence(
            historical_request(), provider, policy
        )

        self.assertEqual(
            adaptive.diagnostics.stop_reason,
            HISTORICAL_SEARCH_CEILING_REACHED,
        )
        self.assertEqual(
            [
                attempt.cumulative_unique_count
                for attempt in adaptive.diagnostics.attempts
            ],
            [0, 0],
        )
        self.assertEqual(len(adaptive.result.issues), 4)

    def test_historical_price_metamorphism_does_not_change_search(self) -> None:
        policy = AdaptiveSearchPolicy(
            stages=(SearchStage(50, 2), SearchStage(100, 4)),
            minimum_strong_matches=2,
            max_unique_candidates=10,
        )

        def run(multiplier: int):
            provider = HistoricalProvider(
                lambda request: historical_result(
                    request,
                    evidence_rows=(
                        evidence(
                            1 if request.radius_miles == 50 else 2,
                            price=multiplier * request.radius_miles,
                        ),
                    ),
                )
            )
            result = adaptive_discover_historical_market_evidence(
                historical_request(), provider, policy
            )
            return provider, result

        low_provider, low = run(1)
        high_provider, high = run(10_000)

        self.assertEqual(
            [r.radius_miles for r in low_provider.requests],
            [r.radius_miles for r in high_provider.requests],
        )
        self.assertEqual(low.diagnostics.stop_reason, high.diagnostics.stop_reason)
        self.assertEqual(
            [a.strong_match_count for a in low.diagnostics.attempts],
            [a.strong_match_count for a in high.diagnostics.attempts],
        )

    def test_sparse_evidence_stops_successfully_at_historical_ceiling(self) -> None:
        rows = {
            50: tuple(evidence(index) for index in range(1, 6)),
            100: tuple(evidence(index) for index in range(6, 8)),
        }
        provider = HistoricalProvider(
            lambda request: historical_result(
                request, evidence_rows=rows.get(request.radius_miles, ())
            )
        )

        adaptive = adaptive_discover_historical_market_evidence(
            historical_request(), provider
        )

        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in provider.requests
            ],
            [(50, 25), (100, 50)],
        )
        self.assertEqual(
            adaptive.diagnostics.stop_reason,
            HISTORICAL_SEARCH_CEILING_REACHED,
        )
        self.assertEqual(adaptive.result.evidence, rows[50] + rows[100])
        self.assertEqual(adaptive.result.listing_count, 7)
        self.assertEqual(
            adaptive.ranking.eligible_count, 7  # type: ignore[union-attr]
        )
        replayed = replay_historical_adaptive_search(
            historical_request(), adaptive.diagnostics.to_dict()
        )
        self.assertEqual(replayed.result, adaptive.result)
        self.assertEqual(replayed.ranking, adaptive.ranking)

    def test_provider_capability_blocks_wider_explicit_historical_policy(self) -> None:
        provider = HistoricalProvider(lambda request: historical_result(request))
        provider.maximum_search_radius_miles = 100

        adaptive = adaptive_discover_historical_market_evidence(
            historical_request(),
            provider,
            DEFAULT_ADAPTIVE_SEARCH_POLICY,
        )

        self.assertEqual(
            [
                (request.radius_miles, request.result_limit)
                for request in provider.requests
            ],
            [(50, 25), (100, 50)],
        )
        self.assertEqual(
            adaptive.diagnostics.stop_reason,
            HISTORICAL_SEARCH_CEILING_REACHED,
        )

    def test_historical_later_stage_provider_failure_propagates(self) -> None:
        provider = HistoricalProvider(
            lambda request: historical_result(
                request, evidence_rows=(evidence(1),)
            ),
            fail_at_radius=100,
        )

        with self.assertRaises(MarketProviderUnavailableError):
            adaptive_discover_historical_market_evidence(
                historical_request(), provider
            )

        self.assertEqual(
            [request.radius_miles for request in provider.requests], [50, 100]
        )


class AdaptiveDrivetrainDiscoveryTests(unittest.TestCase):
    def test_current_stages_and_replay_preserve_filter_without_filling_missing_facts(self) -> None:
        marker = DrivetrainDiscovery("EXACT_FILTER", "FWD")
        request = current_request(drivetrain="FWD", drivetrain_discovery=marker)
        provider = CurrentProvider({50: (replace(listing(1), drivetrain="4WD"), listing(2)),
                                    100: (replace(listing(3), drivetrain="FWD"),)})
        policy = AdaptiveSearchPolicy(stages=(SearchStage(50, 25), SearchStage(100, 50)))
        result = adaptive_discover_market_listings(request, provider, policy)
        self.assertEqual([row.radius_miles for row in provider.requests], [50, 100])
        self.assertTrue(all(row.drivetrain_discovery == marker for row in provider.requests))
        self.assertEqual(result.result.request.drivetrain_discovery, marker)
        candidates = {row.listing.source_listing_id: row for row in result.ranking.candidates}
        self.assertFalse(candidates["listing-001"].eligible)
        self.assertEqual(candidates["listing-002"].tier, "GOOD")
        self.assertIsNone(candidates["listing-002"].listing.drivetrain)
        replay = replay_current_adaptive_search(request, result.diagnostics.to_dict(), policy=policy)
        self.assertEqual(replay.result.to_dict(), result.result.to_dict())
        self.assertEqual(replay.ranking, result.ranking)

    def test_historical_stages_and_replay_preserve_filter(self) -> None:
        marker = DrivetrainDiscovery("EXACT_FILTER", "4WD")
        request = historical_request(drivetrain="4WD", drivetrain_discovery=marker)
        provider = HistoricalProvider(lambda requested: historical_result(requested, evidence_rows=(
            replace(evidence(requested.radius_miles), listing=replace(listing(requested.radius_miles), drivetrain="4WD")),
        )))
        result = adaptive_discover_historical_market_evidence(request, provider)
        self.assertEqual([row.radius_miles for row in provider.requests], [50, 100])
        self.assertTrue(all(row.drivetrain_discovery == marker for row in provider.requests))
        replay = replay_historical_adaptive_search(request, result.diagnostics.to_dict())
        self.assertEqual(replay.result.to_dict(), result.result.to_dict())
        self.assertEqual(replay.ranking, result.ranking)

    def test_filtered_attempts_cannot_replay_as_legacy_unfiltered(self) -> None:
        marker = DrivetrainDiscovery("EXACT_FILTER", "FWD")
        request = current_request(drivetrain="FWD", drivetrain_discovery=marker)
        result = adaptive_discover_market_listings(request, CurrentProvider({}))
        with self.assertRaises(AdaptiveSearchContractError):
            replay_current_adaptive_search(replace(request, drivetrain_discovery=None), result.diagnostics.to_dict())
        tampered = result.diagnostics.to_dict()
        tampered["attempts"][0]["result"]["request"]["drivetrainDiscovery"]["filterValue"] = "4WD"
        with self.assertRaises(AdaptiveSearchContractError):
            replay_current_adaptive_search(request, tampered)


class SparseMarketGeographicExpansionTests(unittest.TestCase):
    @staticmethod
    def request() -> MarketSearchRequest:
        return current_request(
            drivetrain="FWD",
            drivetrain_discovery=DrivetrainDiscovery("EXACT_FILTER", "FWD"),
            configuration=VehicleConfigurationIdentity(
                source=PROVIDER, field="version", values=("SEL FWD",),
            ),
        )

    @staticmethod
    def exact_listing(index: int, radius: int) -> MarketListing:
        return replace(listing(index, distance=radius - 1), drivetrain="FWD")

    def assert_filters_retained(self, requests: list[MarketSearchRequest]) -> None:
        expected = self.request().to_dict()
        for key in ("radiusMiles", "resultLimit"):
            del expected[key]
        for request in requests:
            fields = request.to_dict()
            for key in ("radiusMiles", "resultLimit"):
                del fields[key]
            self.assertEqual(fields, expected)

    def test_stops_at_first_sufficient_exact_configuration_tier(self) -> None:
        stages = ((50, 25), (100, 50), (200, 75), (250, 100))
        for stop_index in range(len(stages)):
            with self.subTest(sufficient_radius=stages[stop_index][0]):
                rows = {}
                next_index = 0
                for index, (radius, _) in enumerate(stages[:stop_index + 1]):
                    count = 9 - stop_index if index == stop_index else 1
                    rows[radius] = tuple(self.exact_listing(number, radius)
                                         for number in range(next_index, next_index + count))
                    next_index += count
                provider = CurrentProvider(rows)
                provider.maximum_search_radius_miles = 250
                result = adaptive_discover_market_listings(self.request(), provider)
                self.assertEqual([(row.radius_miles, row.result_limit) for row in provider.requests],
                                 list(stages[:stop_index + 1]))
                self.assertEqual(result.diagnostics.stop_reason, SUFFICIENT_STRONG_MATCHES)
                self.assertEqual(result.diagnostics.attempts[-1].strong_match_count, 9)
                self.assert_filters_retained(provider.requests)
                replay = replay_current_adaptive_search(self.request(), result.diagnostics.to_dict())
                self.assertEqual(replay.result.to_dict(), result.result.to_dict())
                self.assertEqual(replay.ranking.to_dict(), result.ranking.to_dict())

    def test_250_exhaustion_does_not_relax_configuration_or_unknown_facts(self) -> None:
        provider = CurrentProvider({
            50: (),
            100: (),
            200: tuple(self.exact_listing(index, 200) for index in range(8)),
            250: (replace(self.exact_listing(8, 250), drivetrain="4WD"),
                  replace(self.exact_listing(9, 250), drivetrain=None)),
        })
        provider.maximum_search_radius_miles = 250
        result = adaptive_discover_market_listings(self.request(), provider)
        self.assertEqual([row.radius_miles for row in provider.requests], [50, 100, 200, 250])
        self.assertEqual(result.diagnostics.stop_reason, MAX_SCOPE_REACHED)
        self.assertEqual(result.diagnostics.attempts[-1].strong_match_count, 8)
        self.assertEqual(result.ranking.eligible_count, 9)
        candidates = {row.listing.source_listing_id: row for row in result.ranking.candidates}
        self.assertFalse(candidates["listing-008"].eligible)
        self.assertEqual(candidates["listing-009"].tier, "GOOD")
        self.assertIsNone(candidates["listing-009"].listing.drivetrain)
        self.assert_filters_retained(provider.requests)

    def test_intermediate_account_cap_never_rounds_up_to_unsupported_radius(self) -> None:
        for maximum, radii in ((50, [50]), (100, [50, 100]), (199, [50, 100]),
                               (200, [50, 100, 200]), (249, [50, 100, 200])):
            with self.subTest(maximum=maximum):
                provider = CurrentProvider({})
                provider.maximum_search_radius_miles = maximum
                result = adaptive_discover_market_listings(self.request(), provider)
                self.assertEqual([row.radius_miles for row in provider.requests], radii)
                self.assertEqual(result.diagnostics.stop_reason, CURRENT_SEARCH_CEILING_REACHED)
                self.assert_filters_retained(provider.requests)
                replay = replay_current_adaptive_search(
                    self.request(), result.diagnostics.to_dict(),
                    policy=adaptive_search_policy_for_provider(DEFAULT_ADAPTIVE_SEARCH_POLICY, provider),
                    ceiling_stop_reason=CURRENT_SEARCH_CEILING_REACHED,
                )
                self.assertEqual(replay.result.to_dict(), result.result.to_dict())

    def test_product_cap_remains_250_when_account_supports_more(self) -> None:
        provider = CurrentProvider({})
        provider.maximum_search_radius_miles = 500
        result = adaptive_discover_market_listings(self.request(), provider)
        self.assertEqual([row.radius_miles for row in provider.requests], [50, 100, 200, 250])
        self.assertEqual(result.diagnostics.stop_reason, MAX_SCOPE_REACHED)
        self.assertEqual(result.result.request.result_limit, 100)
        self.assertEqual(len(set(provider.requests)), 4)
        self.assert_filters_retained(provider.requests)

    def test_existing_100_candidate_cap_stops_expansion_before_250(self) -> None:
        def mismatches(start: int, count: int, radius: int) -> tuple[MarketListing, ...]:
            return tuple(replace(self.exact_listing(index, radius), drivetrain="4WD")
                         for index in range(start, start + count))

        provider = CurrentProvider({50: mismatches(0, 25, 50),
                                    100: mismatches(25, 50, 100),
                                    200: mismatches(75, 75, 200)})
        provider.maximum_search_radius_miles = 250
        result = adaptive_discover_market_listings(self.request(), provider)
        self.assertEqual([row.radius_miles for row in provider.requests], [50, 100, 200])
        self.assertEqual(result.diagnostics.stop_reason, MAX_UNIQUE_CANDIDATES)
        self.assertEqual([row.cumulative_unique_count for row in result.diagnostics.attempts], [25, 75, 100])
        self.assertEqual(result.diagnostics.attempts[-1].candidate_limit_excluded_count, 50)
        self.assertEqual(result.result.listing_count, 100)
        self.assertEqual(result.ranking.eligible_count, 0)

    def test_historical_search_keeps_100_limit_with_broader_active_capability(self) -> None:
        for maximum, radii in ((50, [50]), (100, [50, 100]), (250, [50, 100])):
            with self.subTest(maximum=maximum):
                provider = HistoricalProvider(lambda request: historical_result(request))
                provider.maximum_search_radius_miles = maximum
                request = historical_request(drivetrain="FWD", drivetrain_discovery=DrivetrainDiscovery("EXACT_FILTER", "FWD"))
                result = adaptive_discover_historical_market_evidence(request, provider)
                self.assertEqual([row.radius_miles for row in provider.requests], radii)
                self.assertTrue(all(row.drivetrain_discovery == request.drivetrain_discovery for row in provider.requests))
                self.assertEqual(result.diagnostics.stop_reason, HISTORICAL_SEARCH_CEILING_REACHED)
                self.assertEqual(result.result.evidence, ())


if __name__ == "__main__":
    unittest.main()
