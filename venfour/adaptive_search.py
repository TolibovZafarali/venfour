"""Deterministic, provider-neutral adaptive external-evidence discovery.

The policy in this module broadens search scope only when the cumulative
canonical evidence is not yet sufficient.  It deliberately delegates
eligibility, scoring, and ranking to Phase 3C; listing price is never consulted
by the merge, identity, expansion, or stopping rules here.

Each provider response is retained in the diagnostics stream.  The stream can
therefore be replayed without provider access to prove the cumulative merge,
counts, stop reason, aggregate result, and final Phase 3C ranking.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from venfour.comparables import (
    ComparableRankingResult,
    ComparableTarget,
    comparable_target_from_search_request,
    rank_market_comparables,
    validate_comparable_target,
)
from venfour.historical_market import (
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketProvider,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
    discover_historical_market_evidence,
    historical_evidence_to_market_search_result,
    validate_historical_market_search_result,
)
from venfour.market import (
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketProvider,
    MarketProviderError,
    MarketSearchRequest,
    MarketSearchResult,
    discover_market_listings,
    normalize_market_search_request,
    validate_market_search_request,
    validate_market_search_result,
)


SUFFICIENT_STRONG_MATCHES = "SUFFICIENT_STRONG_MATCHES"
MAX_UNIQUE_CANDIDATES = "MAX_UNIQUE_CANDIDATES"
MAX_SCOPE_REACHED = "MAX_SCOPE_REACHED"
HISTORICAL_OUT_OF_PROVIDER_RANGE = "OUT_OF_PROVIDER_RANGE"
CANDIDATE_VERIFICATION_LIMIT_REACHED = "CANDIDATE_VERIFICATION_LIMIT_REACHED"
HISTORICAL_PROVIDER_INCOMPLETE = "HISTORICAL_PROVIDER_INCOMPLETE"

IDENTITY_STRATEGY = "VIN_THEN_SOURCE_LISTING_ID"
PRICE_INDEPENDENT = True
MAX_SEARCH_STAGES = 4
MAX_RADIUS_MILES = 250
MAX_RESULT_LIMIT = 100
MAX_UNIQUE_CANDIDATE_LIMIT = 100

_CURRENT_STOP_REASONS = {
    SUFFICIENT_STRONG_MATCHES,
    MAX_UNIQUE_CANDIDATES,
    MAX_SCOPE_REACHED,
}
_HISTORICAL_STOP_REASONS = _CURRENT_STOP_REASONS | {
    HISTORICAL_OUT_OF_PROVIDER_RANGE,
    CANDIDATE_VERIFICATION_LIMIT_REACHED,
    HISTORICAL_PROVIDER_INCOMPLETE,
}
_GLOBAL_HISTORICAL_REASONS = {
    "PAGINATION_SAFETY_LIMIT_REACHED",
    "INCOMPLETE_PROVIDER_PAGINATION",
    CANDIDATE_VERIFICATION_LIMIT_REACHED,
}
_INCOMPLETE_HISTORICAL_REASONS = {
    "PAGINATION_SAFETY_LIMIT_REACHED",
    "INCOMPLETE_PROVIDER_PAGINATION",
}


class AdaptiveSearchContractError(ValueError):
    """An adaptive policy or persisted diagnostic stream is inconsistent."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class SearchStage:
    """One bounded radius/depth attempt in an adaptive search policy."""

    radius_miles: int
    result_limit: int

    def __post_init__(self) -> None:
        if (
            isinstance(self.radius_miles, bool)
            or not isinstance(self.radius_miles, int)
            or self.radius_miles < 0
            or self.radius_miles > MAX_RADIUS_MILES
        ):
            raise AdaptiveSearchContractError(
                "Adaptive search stage is invalid",
                (
                    "$.radiusMiles: must be an integer between 0 and "
                    f"{MAX_RADIUS_MILES}",
                ),
            )
        if (
            isinstance(self.result_limit, bool)
            or not isinstance(self.result_limit, int)
            or self.result_limit < 1
            or self.result_limit > MAX_RESULT_LIMIT
        ):
            raise AdaptiveSearchContractError(
                "Adaptive search stage is invalid",
                (
                    "$.resultLimit: must be an integer between 1 and "
                    f"{MAX_RESULT_LIMIT}",
                ),
            )

    def to_dict(self) -> dict[str, int]:
        return {
            "radiusMiles": self.radius_miles,
            "resultLimit": self.result_limit,
        }


DEFAULT_SEARCH_STAGES = (
    SearchStage(50, 25),
    SearchStage(100, 50),
    SearchStage(200, 75),
    SearchStage(250, 100),
)


@dataclass(frozen=True)
class AdaptiveSearchPolicy:
    """Server-owned limits and evidence sufficiency for adaptive discovery."""

    stages: tuple[SearchStage, ...] = DEFAULT_SEARCH_STAGES
    minimum_strong_matches: int = 9
    max_unique_candidates: int = 100

    def __post_init__(self) -> None:
        object.__setattr__(self, "stages", tuple(self.stages))
        details: list[str] = []
        if not self.stages:
            details.append("$.stages: must contain at least one stage")
        elif len(self.stages) > MAX_SEARCH_STAGES:
            details.append(
                f"$.stages: must contain no more than {MAX_SEARCH_STAGES} stages"
            )
        if any(not isinstance(stage, SearchStage) for stage in self.stages):
            details.append("$.stages: every item must be SearchStage")
        else:
            for index, (previous, current) in enumerate(
                zip(self.stages, self.stages[1:]), start=1
            ):
                if current.radius_miles <= previous.radius_miles:
                    details.append(
                        f"$.stages[{index}].radiusMiles: must strictly increase"
                    )
                if current.result_limit < previous.result_limit:
                    details.append(
                        f"$.stages[{index}].resultLimit: must not decrease"
                    )
        if (
            isinstance(self.minimum_strong_matches, bool)
            or not isinstance(self.minimum_strong_matches, int)
            or self.minimum_strong_matches < 1
        ):
            details.append("$.minimumStrongMatches: must be a positive integer")
        if (
            isinstance(self.max_unique_candidates, bool)
            or not isinstance(self.max_unique_candidates, int)
            or self.max_unique_candidates < 1
            or self.max_unique_candidates > MAX_UNIQUE_CANDIDATE_LIMIT
        ):
            details.append(
                "$.maxUniqueCandidates: must be an integer between 1 and "
                f"{MAX_UNIQUE_CANDIDATE_LIMIT}"
            )
        elif (
            isinstance(self.minimum_strong_matches, int)
            and not isinstance(self.minimum_strong_matches, bool)
            and self.minimum_strong_matches > self.max_unique_candidates
        ):
            details.append(
                "$.minimumStrongMatches: must not exceed maxUniqueCandidates"
            )
        if details:
            raise AdaptiveSearchContractError(
                "Adaptive search policy is invalid", tuple(details)
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "stages": [stage.to_dict() for stage in self.stages],
            "minimumStrongMatches": self.minimum_strong_matches,
            "maxUniqueCandidates": self.max_unique_candidates,
            "identityStrategy": IDENTITY_STRATEGY,
            "priceIndependent": PRICE_INDEPENDENT,
        }


DEFAULT_ADAPTIVE_SEARCH_POLICY = AdaptiveSearchPolicy()


@dataclass(frozen=True)
class AdaptiveSearchAttempt:
    """One canonical provider response plus replayable cumulative counts."""

    result: MarketSearchResult | HistoricalMarketSearchResult
    returned_count: int
    resolved_count: int
    unresolved_count: int
    ambiguous_count: int
    new_unique_count: int
    duplicate_count: int
    candidate_limit_excluded_count: int
    cumulative_unique_count: int
    eligible_count: int
    strong_match_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "result": self.result.to_dict(),
            "returnedCount": self.returned_count,
            "resolvedCount": self.resolved_count,
            "unresolvedCount": self.unresolved_count,
            "ambiguousCount": self.ambiguous_count,
            "newUniqueCount": self.new_unique_count,
            "duplicateCount": self.duplicate_count,
            "candidateLimitExcludedCount": self.candidate_limit_excluded_count,
            "cumulativeUniqueCount": self.cumulative_unique_count,
            "eligibleCount": self.eligible_count,
            "strongMatchCount": self.strong_match_count,
        }


@dataclass(frozen=True)
class AdaptiveSearchDiagnostics:
    """Policy-independent attempt stream stored with an analysis run."""

    attempts: tuple[AdaptiveSearchAttempt, ...]
    stop_reason: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "attempts", tuple(self.attempts))

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempts": [attempt.to_dict() for attempt in self.attempts],
            "stopReason": self.stop_reason,
        }


@dataclass(frozen=True)
class AdaptiveCurrentSearchResult:
    """Aggregate current-market evidence, final ranking, and diagnostics."""

    result: MarketSearchResult
    ranking: ComparableRankingResult
    diagnostics: AdaptiveSearchDiagnostics

    @property
    def market_result(self) -> MarketSearchResult:
        return self.result

    @property
    def search_diagnostics(self) -> AdaptiveSearchDiagnostics:
        return self.diagnostics


@dataclass(frozen=True)
class AdaptiveHistoricalSearchResult:
    """Aggregate loss-date evidence, optional ranking, and diagnostics."""

    result: HistoricalMarketSearchResult
    ranking: ComparableRankingResult | None
    diagnostics: AdaptiveSearchDiagnostics

    @property
    def historical_result(self) -> HistoricalMarketSearchResult:
        return self.result

    @property
    def search_diagnostics(self) -> AdaptiveSearchDiagnostics:
        return self.diagnostics


def adaptive_search_policy_from_dict(data: Mapping[str, Any]) -> AdaptiveSearchPolicy:
    """Parse the exact persisted policy representation."""

    expected = {
        "stages",
        "minimumStrongMatches",
        "maxUniqueCandidates",
        "identityStrategy",
        "priceIndependent",
    }
    if not isinstance(data, Mapping) or set(data) != expected:
        raise AdaptiveSearchContractError(
            "Adaptive search policy is invalid",
            ("$: must contain exactly the canonical policy fields",),
        )
    if data["identityStrategy"] != IDENTITY_STRATEGY:
        raise AdaptiveSearchContractError(
            "Adaptive search policy is invalid",
            (f"$.identityStrategy: expected {IDENTITY_STRATEGY!r}",),
        )
    if data["priceIndependent"] is not True:
        raise AdaptiveSearchContractError(
            "Adaptive search policy is invalid",
            ("$.priceIndependent: must be true",),
        )
    stage_rows = data["stages"]
    if not _is_sequence(stage_rows):
        raise AdaptiveSearchContractError(
            "Adaptive search policy is invalid", ("$.stages: expected an array",)
        )
    stages: list[SearchStage] = []
    for index, row in enumerate(stage_rows):
        if not isinstance(row, Mapping) or set(row) != {
            "radiusMiles",
            "resultLimit",
        }:
            raise AdaptiveSearchContractError(
                "Adaptive search policy is invalid",
                (f"$.stages[{index}]: expected radiusMiles and resultLimit",),
            )
        stages.append(SearchStage(row["radiusMiles"], row["resultLimit"]))
    policy = AdaptiveSearchPolicy(
        stages=tuple(stages),
        minimum_strong_matches=data["minimumStrongMatches"],
        max_unique_candidates=data["maxUniqueCandidates"],
    )
    if policy.to_dict() != dict(data):
        raise AdaptiveSearchContractError(
            "Adaptive search policy is invalid", ("$: is not canonical",)
        )
    return policy


def validate_adaptive_search_policy(
    policy: AdaptiveSearchPolicy | Mapping[str, Any],
) -> None:
    if isinstance(policy, AdaptiveSearchPolicy):
        adaptive_search_policy_from_dict(policy.to_dict())
    else:
        adaptive_search_policy_from_dict(policy)


def _is_sequence(value: Any) -> bool:
    return isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    )


def _listing_aliases(
    listing: MarketListing,
) -> tuple[tuple[str, ...], ...]:
    aliases: list[tuple[str, ...]] = []
    if listing.vin is not None:
        aliases.append(("vin", listing.vin.strip().casefold()))
    if listing.source_listing_id is not None:
        aliases.append(
            ("sourceListingId", listing.source.casefold(), listing.source_listing_id)
        )
    return tuple(aliases)


def _issue_aliases(
    issue: HistoricalEvidenceIssue, provider: str
) -> tuple[tuple[str, ...], ...]:
    aliases: list[tuple[str, ...]] = []
    if issue.vin is not None:
        aliases.append(("vin", issue.vin.strip().casefold()))
    if issue.source_listing_id is not None:
        aliases.append(
            ("sourceListingId", provider.casefold(), issue.source_listing_id)
        )
    return tuple(aliases)


def _stable_strong_count(ranking: ComparableRankingResult) -> int:
    return sum(
        candidate.tier == "STRONG"
        and bool(_listing_aliases(candidate.listing))
        for candidate in ranking.candidates
    )


def _request_for_stage(
    request: MarketSearchRequest, stage: SearchStage
) -> MarketSearchRequest:
    staged = replace(
        request,
        radius_miles=stage.radius_miles,
        result_limit=stage.result_limit,
    )
    return normalize_market_search_request(staged)


def _historical_request_for_stage(
    request: HistoricalMarketSearchRequest, stage: SearchStage
) -> HistoricalMarketSearchRequest:
    staged = replace(
        request,
        radius_miles=stage.radius_miles,
        result_limit=stage.result_limit,
    )
    # The existing discovery boundary performs the canonical validation.  This
    # explicit projection validates replay inputs before any result is consumed.
    staged.to_market_search_request()
    return staged


def _target_for_request(
    request: MarketSearchRequest, target: ComparableTarget | None
) -> ComparableTarget:
    expected = comparable_target_from_search_request(request)
    if target is None:
        return expected
    validate_comparable_target(target)
    if target != expected:
        raise AdaptiveSearchContractError(
            "Adaptive search target is inconsistent with its request",
            ("$.target: must match the request vehicle and postal origin",),
        )
    return target


def _regular_stop_reason(
    policy: AdaptiveSearchPolicy,
    stage_index: int,
    cumulative_unique_count: int,
    strong_match_count: int,
) -> str | None:
    if strong_match_count >= policy.minimum_strong_matches:
        return SUFFICIENT_STRONG_MATCHES
    if cumulative_unique_count >= policy.max_unique_candidates:
        return MAX_UNIQUE_CANDIDATES
    if stage_index == len(policy.stages) - 1:
        return MAX_SCOPE_REACHED
    return None


def _begin_historical_provider_session(provider: HistoricalMarketProvider) -> None:
    """Reset optional provider-local state once, before the first policy stage."""

    try:
        begin = getattr(provider, "begin_historical_search_session", None)
    except Exception as exc:
        raise MarketProviderError(
            "Historical provider search session could not be initialized"
        ) from exc
    if begin is None:
        return
    if not callable(begin):
        raise MarketProviderError(
            "Historical provider search session hook is invalid"
        )
    try:
        begin()
    except MarketProviderError:
        raise
    except Exception as exc:
        raise MarketProviderError(
            "Historical provider search session could not be initialized"
        ) from exc


@dataclass
class _CurrentState:
    request: MarketSearchRequest
    target: ComparableTarget
    policy: AdaptiveSearchPolicy
    listings: list[MarketListing] = field(default_factory=list)
    aliases: set[tuple[str, ...]] = field(default_factory=set)
    attempts: list[AdaptiveSearchAttempt] = field(default_factory=list)
    identified_count: int = 0
    provider: str | None = None
    ranking: ComparableRankingResult | None = None
    last_stage: SearchStage | None = None

    def consume(
        self, result: MarketSearchResult, stage: SearchStage
    ) -> AdaptiveSearchAttempt:
        validate_market_search_result(result)
        expected_request = _request_for_stage(self.request, stage)
        if result.request != expected_request:
            raise AdaptiveSearchContractError(
                "Current adaptive attempt is inconsistent",
                ("$.result.request: does not match the policy stage",),
            )
        if self.provider is None:
            self.provider = result.provider
        elif result.provider != self.provider:
            raise AdaptiveSearchContractError(
                "Current adaptive attempt is inconsistent",
                ("$.result.provider: changed between attempts",),
            )

        added = duplicates = excluded = 0
        for listing in result.listings:
            aliases = _listing_aliases(listing)
            if not aliases:
                self.listings.append(listing)
                continue
            duplicate = any(alias in self.aliases for alias in aliases)
            self.aliases.update(aliases)
            if duplicate:
                duplicates += 1
                continue
            if self.identified_count >= self.policy.max_unique_candidates:
                excluded += 1
                continue
            self.listings.append(listing)
            self.identified_count += 1
            added += 1

        aggregate = MarketSearchResult(
            provider=result.provider,
            request=expected_request,
            listings=tuple(self.listings),
        )
        self.ranking = rank_market_comparables(self.target, aggregate)
        strong = _stable_strong_count(self.ranking)
        attempt = AdaptiveSearchAttempt(
            result=result,
            returned_count=result.listing_count,
            resolved_count=result.listing_count,
            unresolved_count=0,
            ambiguous_count=0,
            new_unique_count=added,
            duplicate_count=duplicates,
            candidate_limit_excluded_count=excluded,
            cumulative_unique_count=self.identified_count,
            eligible_count=self.ranking.eligible_count,
            strong_match_count=strong,
        )
        self.attempts.append(attempt)
        self.last_stage = stage
        return attempt

    def finish(self, stop_reason: str) -> AdaptiveCurrentSearchResult:
        if self.provider is None or self.ranking is None or self.last_stage is None:
            raise AssertionError("a current adaptive search must contain an attempt")
        aggregate_limit = max(
            len(self.listings),
            min(self.policy.max_unique_candidates, self.last_stage.result_limit),
        )
        aggregate_request = replace(
            self.request,
            radius_miles=self.last_stage.radius_miles,
            result_limit=aggregate_limit,
        )
        aggregate = MarketSearchResult(
            provider=self.provider,
            request=aggregate_request,
            listings=tuple(self.listings),
        )
        validate_market_search_result(aggregate)
        ranking = rank_market_comparables(self.target, aggregate)
        return AdaptiveCurrentSearchResult(
            result=aggregate,
            ranking=ranking,
            diagnostics=AdaptiveSearchDiagnostics(tuple(self.attempts), stop_reason),
        )


def adaptive_discover_market_listings(
    request: MarketSearchRequest,
    provider: MarketProvider,
    policy: AdaptiveSearchPolicy = DEFAULT_ADAPTIVE_SEARCH_POLICY,
    *,
    target: ComparableTarget | None = None,
) -> AdaptiveCurrentSearchResult:
    """Search current inventory stage-by-stage until evidence is sufficient."""

    validate_adaptive_search_policy(policy)
    base_request = normalize_market_search_request(request)
    validate_market_search_request(base_request)
    comparable_target = _target_for_request(base_request, target)
    state = _CurrentState(base_request, comparable_target, policy)
    for index, stage in enumerate(policy.stages):
        result = discover_market_listings(
            _request_for_stage(base_request, stage), provider
        )
        attempt = state.consume(result, stage)
        stop_reason = _regular_stop_reason(
            policy,
            index,
            attempt.cumulative_unique_count,
            attempt.strong_match_count,
        )
        if stop_reason is not None:
            return state.finish(stop_reason)
    raise AssertionError("the final policy stage must produce a stop reason")


# More explicit alias for orchestration call sites.
adaptive_discover_current_market = adaptive_discover_market_listings


@dataclass
class _HistoricalState:
    request: HistoricalMarketSearchRequest
    target: ComparableTarget
    policy: AdaptiveSearchPolicy
    evidence: list[HistoricalEvidenceItem] = field(default_factory=list)
    issues: list[HistoricalEvidenceIssue] = field(default_factory=list)
    aliases: set[tuple[str, ...]] = field(default_factory=set)
    global_issue_keys: set[tuple[str, str]] = field(default_factory=set)
    attempts: list[AdaptiveSearchAttempt] = field(default_factory=list)
    identified_count: int = 0
    provider: str | None = None
    evidence_date: str | None = None
    as_of_date: str | None = None
    coverage: HistoricalCoverage | None = None
    ranking: ComparableRankingResult | None = None
    last_stage: SearchStage | None = None

    @property
    def cumulative_unique_count(self) -> int:
        return self.identified_count

    @staticmethod
    def _is_global(issue: HistoricalEvidenceIssue) -> bool:
        return (
            issue.vin is None
            and issue.source_listing_id is None
            and issue.reason in _GLOBAL_HISTORICAL_REASONS
        )

    def _retain_candidate(
        self,
        aliases: tuple[tuple[str, ...], ...],
        value: HistoricalEvidenceItem | HistoricalEvidenceIssue,
    ) -> str:
        if not aliases:
            if isinstance(value, HistoricalEvidenceItem):
                self.evidence.append(value)
            else:
                self.issues.append(value)
            return "unidentified"
        duplicate = any(alias in self.aliases for alias in aliases)
        self.aliases.update(aliases)
        if duplicate:
            return "duplicate"
        if self.cumulative_unique_count >= self.policy.max_unique_candidates:
            return "excluded"
        if isinstance(value, HistoricalEvidenceItem):
            self.evidence.append(value)
        else:
            self.issues.append(value)
        self.identified_count += 1
        return "added"

    def consume(
        self, result: HistoricalMarketSearchResult, stage: SearchStage
    ) -> tuple[AdaptiveSearchAttempt, str | None]:
        validate_historical_market_search_result(result)
        expected_request = _historical_request_for_stage(self.request, stage)
        if result.request != expected_request:
            raise AdaptiveSearchContractError(
                "Historical adaptive attempt is inconsistent",
                ("$.result.request: does not match the policy stage",),
            )
        if self.provider is None:
            self.provider = result.provider
            self.evidence_date = result.evidence_date
            self.as_of_date = result.as_of_date
            self.coverage = result.coverage
        else:
            details: list[str] = []
            if result.provider != self.provider:
                details.append("$.result.provider: changed between attempts")
            if result.evidence_date != self.evidence_date:
                details.append("$.result.evidenceDate: changed between attempts")
            if result.as_of_date != self.as_of_date:
                details.append("$.result.asOfDate: changed between attempts")
            if result.coverage != self.coverage:
                details.append("$.result.coverage: changed between attempts")
            if details:
                raise AdaptiveSearchContractError(
                    "Historical adaptive attempt is inconsistent", tuple(details)
                )

        added = duplicates = excluded = 0
        if result.coverage.status == SUPPORTED:
            for item in result.evidence:
                outcome = self._retain_candidate(_listing_aliases(item.listing), item)
                added += outcome == "added"
                duplicates += outcome == "duplicate"
                excluded += outcome == "excluded"
            for issue in result.issues:
                if self._is_global(issue):
                    key = (issue.status, issue.reason)
                    if key in self.global_issue_keys:
                        duplicates += 1
                    else:
                        self.global_issue_keys.add(key)
                        self.issues.append(issue)
                    continue
                outcome = self._retain_candidate(
                    _issue_aliases(issue, result.provider), issue
                )
                added += outcome == "added"
                duplicates += outcome == "duplicate"
                excluded += outcome == "excluded"

        self.ranking = self._rank_cumulative(stage)
        strong = _stable_strong_count(self.ranking) if self.ranking else 0
        attempt = AdaptiveSearchAttempt(
            result=result,
            returned_count=result.listing_count + len(result.issues),
            resolved_count=result.listing_count,
            unresolved_count=result.unresolved_count,
            ambiguous_count=result.ambiguous_count,
            new_unique_count=added,
            duplicate_count=duplicates,
            candidate_limit_excluded_count=excluded,
            cumulative_unique_count=self.cumulative_unique_count,
            eligible_count=self.ranking.eligible_count if self.ranking else 0,
            strong_match_count=strong,
        )
        self.attempts.append(attempt)
        self.last_stage = stage

        special_stop: str | None = None
        if result.coverage.status == OUT_OF_PROVIDER_RANGE:
            special_stop = HISTORICAL_OUT_OF_PROVIDER_RANGE
        elif any(
            issue.reason == CANDIDATE_VERIFICATION_LIMIT_REACHED
            and issue.vin is None
            and issue.source_listing_id is None
            for issue in result.issues
        ):
            special_stop = CANDIDATE_VERIFICATION_LIMIT_REACHED
        elif any(
            issue.reason in _INCOMPLETE_HISTORICAL_REASONS
            and issue.vin is None
            and issue.source_listing_id is None
            for issue in result.issues
        ):
            special_stop = HISTORICAL_PROVIDER_INCOMPLETE
        return attempt, special_stop

    def _rank_cumulative(
        self, stage: SearchStage
    ) -> ComparableRankingResult | None:
        if (
            self.coverage is None
            or self.coverage.status != SUPPORTED
            or not self.evidence
        ):
            return None
        assert self.provider is not None
        projected = MarketSearchResult(
            provider=self.provider,
            request=_historical_request_for_stage(
                self.request, stage
            ).to_market_search_request(),
            listings=tuple(item.listing for item in self.evidence),
        )
        return rank_market_comparables(self.target, projected)

    def finish(self, stop_reason: str) -> AdaptiveHistoricalSearchResult:
        if (
            self.provider is None
            or self.evidence_date is None
            or self.as_of_date is None
            or self.coverage is None
            or self.last_stage is None
        ):
            raise AssertionError("a historical adaptive search must contain an attempt")
        aggregate_limit = max(
            len(self.evidence),
            min(self.policy.max_unique_candidates, self.last_stage.result_limit),
        )
        aggregate_request = replace(
            self.request,
            radius_miles=self.last_stage.radius_miles,
            result_limit=aggregate_limit,
        )
        evidence = tuple(self.evidence)
        issues = tuple(self.issues)
        coverage = self.coverage
        ranking = self.ranking
        if stop_reason == HISTORICAL_OUT_OF_PROVIDER_RANGE:
            evidence = ()
            issues = ()
            ranking = None
        elif stop_reason == HISTORICAL_PROVIDER_INCOMPLETE:
            # Existing historical contracts intentionally prevent incomplete
            # global pagination from being projected alongside resolved values.
            evidence = ()
            ranking = None
        aggregate = HistoricalMarketSearchResult(
            provider=self.provider,
            evidence_date=self.evidence_date,
            as_of_date=self.as_of_date,
            coverage=coverage,
            request=aggregate_request,
            evidence=evidence,
            issues=issues,
        )
        validate_historical_market_search_result(aggregate)
        if ranking is not None:
            ranking = rank_market_comparables(
                self.target, historical_evidence_to_market_search_result(aggregate)
            )
        return AdaptiveHistoricalSearchResult(
            result=aggregate,
            ranking=ranking,
            diagnostics=AdaptiveSearchDiagnostics(tuple(self.attempts), stop_reason),
        )


def adaptive_discover_historical_market_evidence(
    request: HistoricalMarketSearchRequest,
    provider: HistoricalMarketProvider,
    policy: AdaptiveSearchPolicy = DEFAULT_ADAPTIVE_SEARCH_POLICY,
    *,
    target: ComparableTarget | None = None,
) -> AdaptiveHistoricalSearchResult:
    """Search and temporally verify loss-date evidence across policy stages."""

    validate_adaptive_search_policy(policy)
    if not isinstance(request, HistoricalMarketSearchRequest):
        raise MarketContractError(
            "Historical market search request must be HistoricalMarketSearchRequest"
        )
    request.to_market_search_request()
    comparable_target = _target_for_request(request.to_market_search_request(), target)
    state = _HistoricalState(request, comparable_target, policy)
    _begin_historical_provider_session(provider)
    for index, stage in enumerate(policy.stages):
        staged_request = _historical_request_for_stage(request, stage)
        result = discover_historical_market_evidence(staged_request, provider)
        attempt, special_stop = state.consume(result, stage)
        stop_reason = special_stop or _regular_stop_reason(
            policy,
            index,
            attempt.cumulative_unique_count,
            attempt.strong_match_count,
        )
        if stop_reason is not None:
            return state.finish(stop_reason)
    raise AssertionError("the final policy stage must produce a stop reason")


adaptive_discover_historical_market = adaptive_discover_historical_market_evidence


_ATTEMPT_FIELDS = {
    "result",
    "returnedCount",
    "resolvedCount",
    "unresolvedCount",
    "ambiguousCount",
    "newUniqueCount",
    "duplicateCount",
    "candidateLimitExcludedCount",
    "cumulativeUniqueCount",
    "eligibleCount",
    "strongMatchCount",
}


def _diagnostic_rows(
    diagnostics: AdaptiveSearchDiagnostics | Mapping[str, Any],
    allowed_stop_reasons: set[str],
) -> tuple[list[Mapping[str, Any]], str]:
    data = (
        diagnostics.to_dict()
        if isinstance(diagnostics, AdaptiveSearchDiagnostics)
        else diagnostics
    )
    if not isinstance(data, Mapping) or set(data) != {"attempts", "stopReason"}:
        raise AdaptiveSearchContractError(
            "Adaptive search diagnostics are invalid",
            ("$: expected attempts and stopReason",),
        )
    rows = data["attempts"]
    if not _is_sequence(rows) or not rows:
        raise AdaptiveSearchContractError(
            "Adaptive search diagnostics are invalid",
            ("$.attempts: must be a non-empty array",),
        )
    stop_reason = data["stopReason"]
    if stop_reason not in allowed_stop_reasons:
        raise AdaptiveSearchContractError(
            "Adaptive search diagnostics are invalid",
            ("$.stopReason: is not allowed for this evidence stream",),
        )
    normalized_rows: list[Mapping[str, Any]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, Mapping) or set(row) != _ATTEMPT_FIELDS:
            raise AdaptiveSearchContractError(
                "Adaptive search diagnostics are invalid",
                (f"$.attempts[{index}]: does not have canonical fields",),
            )
        for name in _ATTEMPT_FIELDS - {"result"}:
            value = row[name]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise AdaptiveSearchContractError(
                    "Adaptive search diagnostics are invalid",
                    (f"$.attempts[{index}].{name}: must be a non-negative integer",),
                )
        normalized_rows.append(row)
    return normalized_rows, stop_reason


def _dealer_from_data(data: Mapping[str, Any] | None) -> MarketDealer | None:
    if data is None:
        return None
    return MarketDealer(
        name=data.get("name"),
        city=data.get("city"),
        state=data.get("state"),
        postal_code=data.get("postalCode"),
    )


def _listing_from_data(data: Mapping[str, Any]) -> MarketListing:
    return MarketListing(
        source=data["source"],
        source_listing_id=data.get("sourceListingId"),
        listing_url=data.get("listingUrl"),
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data.get("trim"),
        vin=data.get("vin"),
        mileage=data.get("mileage"),
        price=data["price"],
        dealer=_dealer_from_data(data.get("dealer")),
        distance_miles=data.get("distanceMiles"),
    )


def _market_request_from_data(data: Mapping[str, Any]) -> MarketSearchRequest:
    return MarketSearchRequest(
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data.get("trim"),
        loss_vehicle_mileage=data.get("lossVehicleMileage"),
        postal_code=data.get("postalCode"),
        radius_miles=data.get("radiusMiles", 50),
        result_limit=data.get("resultLimit", 25),
    )


def _market_result_from_data(data: Mapping[str, Any]) -> MarketSearchResult:
    try:
        result = MarketSearchResult(
            provider=data["provider"],
            request=_market_request_from_data(data["request"]),
            listings=tuple(_listing_from_data(row) for row in data["listings"]),
        )
        validate_market_search_result(result)
    except (
        KeyError,
        TypeError,
        ValueError,
        AttributeError,
        MarketContractError,
    ) as exc:
        raise AdaptiveSearchContractError(
            "Current adaptive attempt result is invalid", ("$.result: invalid",)
        ) from exc
    if result.to_dict() != dict(data):
        raise AdaptiveSearchContractError(
            "Current adaptive attempt result is invalid",
            ("$.result: is not exact canonical market data",),
        )
    return result


def _historical_request_from_data(
    data: Mapping[str, Any],
) -> HistoricalMarketSearchRequest:
    return HistoricalMarketSearchRequest(
        evidence_date=data["evidenceDate"],
        year=data["year"],
        make=data["make"],
        model=data["model"],
        postal_code=data["postalCode"],
        trim=data.get("trim"),
        loss_vehicle_mileage=data.get("lossVehicleMileage"),
        radius_miles=data.get("radiusMiles", 50),
        result_limit=data.get("resultLimit", 25),
    )


def _historical_result_from_data(
    data: Mapping[str, Any],
) -> HistoricalMarketSearchResult:
    try:
        evidence = tuple(
            HistoricalEvidenceItem(
                listing=_listing_from_data(row["listing"]),
                temporal_evidence=TemporalEvidence(
                    status=row["temporalEvidence"]["status"],
                    basis=row["temporalEvidence"]["basis"],
                    evidence_date=row["temporalEvidence"]["evidenceDate"],
                    record_first_seen_at=row["temporalEvidence"]["recordFirstSeenAt"],
                    record_last_seen_at=row["temporalEvidence"]["recordLastSeenAt"],
                    source_first_seen_at=row["temporalEvidence"]["sourceFirstSeenAt"],
                    source_last_seen_at=row["temporalEvidence"]["sourceLastSeenAt"],
                ),
            )
            for row in data["evidence"]
        )
        issues = tuple(
            HistoricalEvidenceIssue(
                status=row["status"],
                reason=row["reason"],
                vin=row["vin"],
                source_listing_id=row["sourceListingId"],
            )
            for row in data["issues"]
        )
        coverage_data = data["coverage"]
        result = HistoricalMarketSearchResult(
            provider=data["provider"],
            evidence_date=data["evidenceDate"],
            as_of_date=data["asOfDate"],
            coverage=HistoricalCoverage(
                status=coverage_data["status"],
                history_window_days=coverage_data["historyWindowDays"],
            ),
            request=_historical_request_from_data(data["request"]),
            evidence=evidence,
            issues=issues,
        )
        validate_historical_market_search_result(result)
    except (
        KeyError,
        TypeError,
        ValueError,
        AttributeError,
        MarketContractError,
    ) as exc:
        raise AdaptiveSearchContractError(
            "Historical adaptive attempt result is invalid", ("$.result: invalid",)
        ) from exc
    if result.to_dict() != dict(data):
        raise AdaptiveSearchContractError(
            "Historical adaptive attempt result is invalid",
            ("$.result: is not exact canonical historical data",),
        )
    return result


def replay_current_adaptive_search(
    request: MarketSearchRequest,
    diagnostics: AdaptiveSearchDiagnostics | Mapping[str, Any],
    *,
    policy: AdaptiveSearchPolicy = DEFAULT_ADAPTIVE_SEARCH_POLICY,
    target: ComparableTarget | None = None,
) -> AdaptiveCurrentSearchResult:
    """Replay current diagnostics and return the proven aggregate result."""

    validate_adaptive_search_policy(policy)
    base_request = normalize_market_search_request(request)
    validate_market_search_request(base_request)
    comparable_target = _target_for_request(base_request, target)
    rows, stored_stop = _diagnostic_rows(diagnostics, _CURRENT_STOP_REASONS)
    if len(rows) > len(policy.stages):
        raise AdaptiveSearchContractError(
            "Adaptive search diagnostics are invalid",
            ("$.attempts: contains more attempts than policy stages",),
        )
    state = _CurrentState(base_request, comparable_target, policy)
    actual_stop: str | None = None
    for index, row in enumerate(rows):
        result_data = row["result"]
        if not isinstance(result_data, Mapping):
            raise AdaptiveSearchContractError(
                "Current adaptive attempt result is invalid"
            )
        attempt = state.consume(
            _market_result_from_data(result_data), policy.stages[index]
        )
        if attempt.to_dict() != dict(row):
            raise AdaptiveSearchContractError(
                "Adaptive current search diagnostics do not replay",
                (f"$.attempts[{index}]: counts do not match canonical replay",),
            )
        actual_stop = _regular_stop_reason(
            policy,
            index,
            attempt.cumulative_unique_count,
            attempt.strong_match_count,
        )
        if actual_stop is not None and index != len(rows) - 1:
            raise AdaptiveSearchContractError(
                "Adaptive current search diagnostics do not replay",
                (f"$.attempts[{index + 1}]: search continued after a stop",),
            )
    if actual_stop is None or actual_stop != stored_stop:
        raise AdaptiveSearchContractError(
            "Adaptive current search diagnostics do not replay",
            ("$.stopReason: does not match deterministic replay",),
        )
    return state.finish(actual_stop)


def validate_current_adaptive_search_diagnostics(
    request: MarketSearchRequest,
    diagnostics: AdaptiveSearchDiagnostics | Mapping[str, Any],
    *,
    policy: AdaptiveSearchPolicy = DEFAULT_ADAPTIVE_SEARCH_POLICY,
    target: ComparableTarget | None = None,
) -> None:
    replay_current_adaptive_search(
        request, diagnostics, policy=policy, target=target
    )


def replay_historical_adaptive_search(
    request: HistoricalMarketSearchRequest,
    diagnostics: AdaptiveSearchDiagnostics | Mapping[str, Any],
    *,
    policy: AdaptiveSearchPolicy = DEFAULT_ADAPTIVE_SEARCH_POLICY,
    target: ComparableTarget | None = None,
) -> AdaptiveHistoricalSearchResult:
    """Replay historical diagnostics and return the proven aggregate result."""

    validate_adaptive_search_policy(policy)
    request.to_market_search_request()
    comparable_target = _target_for_request(request.to_market_search_request(), target)
    rows, stored_stop = _diagnostic_rows(diagnostics, _HISTORICAL_STOP_REASONS)
    if len(rows) > len(policy.stages):
        raise AdaptiveSearchContractError(
            "Adaptive search diagnostics are invalid",
            ("$.attempts: contains more attempts than policy stages",),
        )
    state = _HistoricalState(request, comparable_target, policy)
    actual_stop: str | None = None
    for index, row in enumerate(rows):
        result_data = row["result"]
        if not isinstance(result_data, Mapping):
            raise AdaptiveSearchContractError(
                "Historical adaptive attempt result is invalid"
            )
        attempt, special_stop = state.consume(
            _historical_result_from_data(result_data), policy.stages[index]
        )
        if attempt.to_dict() != dict(row):
            raise AdaptiveSearchContractError(
                "Adaptive historical search diagnostics do not replay",
                (f"$.attempts[{index}]: counts do not match canonical replay",),
            )
        actual_stop = special_stop or _regular_stop_reason(
            policy,
            index,
            attempt.cumulative_unique_count,
            attempt.strong_match_count,
        )
        if actual_stop is not None and index != len(rows) - 1:
            raise AdaptiveSearchContractError(
                "Adaptive historical search diagnostics do not replay",
                (f"$.attempts[{index + 1}]: search continued after a stop",),
            )
    if actual_stop is None or actual_stop != stored_stop:
        raise AdaptiveSearchContractError(
            "Adaptive historical search diagnostics do not replay",
            ("$.stopReason: does not match deterministic replay",),
        )
    return state.finish(actual_stop)


def validate_historical_adaptive_search_diagnostics(
    request: HistoricalMarketSearchRequest,
    diagnostics: AdaptiveSearchDiagnostics | Mapping[str, Any],
    *,
    policy: AdaptiveSearchPolicy = DEFAULT_ADAPTIVE_SEARCH_POLICY,
    target: ComparableTarget | None = None,
) -> None:
    replay_historical_adaptive_search(
        request, diagnostics, policy=policy, target=target
    )


# Alternate verb ordering kept as discover/replay terminology is used both ways
# in existing Phase 3 modules.
replay_adaptive_current_search = replay_current_adaptive_search
replay_adaptive_historical_search = replay_historical_adaptive_search


__all__ = [
    "AdaptiveCurrentSearchResult",
    "AdaptiveHistoricalSearchResult",
    "AdaptiveSearchAttempt",
    "AdaptiveSearchContractError",
    "AdaptiveSearchDiagnostics",
    "AdaptiveSearchPolicy",
    "CANDIDATE_VERIFICATION_LIMIT_REACHED",
    "DEFAULT_ADAPTIVE_SEARCH_POLICY",
    "DEFAULT_SEARCH_STAGES",
    "HISTORICAL_OUT_OF_PROVIDER_RANGE",
    "HISTORICAL_PROVIDER_INCOMPLETE",
    "IDENTITY_STRATEGY",
    "MAX_SCOPE_REACHED",
    "MAX_RADIUS_MILES",
    "MAX_RESULT_LIMIT",
    "MAX_SEARCH_STAGES",
    "MAX_UNIQUE_CANDIDATES",
    "MAX_UNIQUE_CANDIDATE_LIMIT",
    "PRICE_INDEPENDENT",
    "SUFFICIENT_STRONG_MATCHES",
    "SearchStage",
    "adaptive_discover_current_market",
    "adaptive_discover_historical_market",
    "adaptive_discover_historical_market_evidence",
    "adaptive_discover_market_listings",
    "adaptive_search_policy_from_dict",
    "replay_adaptive_current_search",
    "replay_adaptive_historical_search",
    "replay_current_adaptive_search",
    "replay_historical_adaptive_search",
    "validate_adaptive_search_policy",
    "validate_current_adaptive_search_diagnostics",
    "validate_historical_adaptive_search_diagnostics",
]
