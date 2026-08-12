"""Deterministic coverage for provider-neutral adaptive market discovery."""

from __future__ import annotations

import copy
import unittest
from typing import Callable

from venfour.adaptive_search import (
    CANDIDATE_VERIFICATION_LIMIT_REACHED,
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
    MarketListing,
    MarketProviderUnavailableError,
    MarketSearchRequest,
    MarketSearchResult,
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

    def test_later_provider_failure_propagates(self) -> None:
        provider = CurrentProvider(
            {50: (listing(1),)}, fail_at_radius=100
        )

        with self.assertRaises(MarketProviderUnavailableError):
            adaptive_discover_market_listings(current_request(), provider)

        self.assertEqual([r.radius_miles for r in provider.requests], [50, 100])

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


if __name__ == "__main__":
    unittest.main()
