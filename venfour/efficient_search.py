"""Bounded comparable discovery, verification, and separate supporting evidence.

The decision loop consumes only canonical observations. Baseline decisions do
not receive the insurer's offer and never sort by price. A persisted event
transcript allows the same loop to replay without access to a provider.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from types import SimpleNamespace
from typing import Any

from venfour.comparable_evidence import (
    SupportingShortlistPolicy, assess_observation, build_supporting_shortlist,
    listing_from_observation, observation_identity, immutable_material_conflicts,
)
from venfour.comparables import ComparableTarget
from venfour.historical_market import (
    HistoricalCoverage, HistoricalEvidenceIssue, HistoricalEvidenceItem,
    HistoricalMarketSearchRequest, HistoricalMarketSearchResult, TemporalEvidence,
    validate_historical_market_search_result,
)
from venfour.market import MarketContractError, MarketProviderError, MarketSearchRequest, MarketSearchResult, validate_market_search_result
from venfour.search_geography import SearchGeography, coordinates, distance_miles
from venfour.search_progress import MarketSearchInterrupted
from venfour.analysis_diagnostics import execution, phase, progress, step
from venfour.search_summary import discovery_summary, validate_summary


SEARCH_STRATEGY_VERSION = "3"
CHECKPOINT_FORMAT_VERSION = "1"


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class EfficientSearchPolicy:
    local_radius_miles: int = 100
    outer_boundary_miles: int = 250
    case_maximum_distance_miles: int | None = None
    additional_centers: int = 4
    page_size: int = 50
    pages_per_center: int = 2
    verification_batch_size: int = 3
    history_pages_per_vin: int = 3
    minimum_strong_matches: int = 9
    max_observations: int = 500
    duplicate_branch_fraction: float = 0.8
    supporting_maximum_listings: int = 3
    supporting_attempts: int = 5
    supporting_discovery_requests: int = 2
    current_context_pages_after_historical: int = 1

    def __post_init__(self) -> None:
        limits = {"local_radius_miles": (1, 100), "outer_boundary_miles": (1, 250),
                  "additional_centers": (0, 4), "page_size": (1, 50), "pages_per_center": (1, 10),
                  "verification_batch_size": (1, 9), "history_pages_per_vin": (1, 10),
                  "minimum_strong_matches": (9, 9), "max_observations": (9, 1000),
                  "supporting_maximum_listings": (1, 9), "supporting_attempts": (0, 5),
                  "supporting_discovery_requests": (0, 2), "current_context_pages_after_historical": (0, 1)}
        for key, (low, high) in limits.items():
            value = getattr(self, key)
            if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                raise ValueError(f"Invalid search setting: {key}")
        if self.case_maximum_distance_miles is not None and (
            isinstance(self.case_maximum_distance_miles, bool)
            or not isinstance(self.case_maximum_distance_miles, int) or self.case_maximum_distance_miles < 1
        ):
            raise ValueError("Case geographic requirement must be a positive distance")
        if not isinstance(self.duplicate_branch_fraction, (float, int)) or not 0.5 <= self.duplicate_branch_fraction <= 1:
            raise ValueError("Invalid duplicate branch threshold")

    @property
    def boundary(self) -> int:
        return min(self.outer_boundary_miles, self.case_maximum_distance_miles or self.outer_boundary_miles)


@dataclass(frozen=True)
class EfficientSearchResult:
    current: MarketSearchResult | None
    historical: HistoricalMarketSearchResult | None
    transcript: Mapping[str, Any]
    supporting: Mapping[str, Any]


def _historical_item(data: Mapping[str, Any]) -> HistoricalEvidenceItem:
    temporal = data["temporalEvidence"]
    return HistoricalEvidenceItem(
        listing=listing_from_observation(data),
        temporal_evidence=TemporalEvidence(
            evidence_date=temporal["evidenceDate"], record_first_seen_at=temporal["recordFirstSeenAt"],
            record_last_seen_at=temporal["recordLastSeenAt"], source_first_seen_at=temporal["sourceFirstSeenAt"],
            source_last_seen_at=temporal["sourceLastSeenAt"],
        ),
    )


def _historical_result(data: Mapping[str, Any]) -> HistoricalMarketSearchResult:
    # Keep the canonical reconstruction in the existing audit boundary.
    from venfour.analysis_runs import _historical_result_from_data
    try:
        validate_historical_market_search_result(data)
    except MarketContractError as exc:
        raise ValueError("Historical search response lacks valid canonical temporal evidence") from exc
    return _historical_result_from_data(data)


def subject_material_facts(report: Mapping[str, Any]) -> dict[str, Any]:
    vehicle = report.get("vehicle") or {}
    facts = {key: vehicle.get(source) for key, source in (
        ("bodyType", "bodyStyle"), ("engine", "engine"), ("fuelType", "fuelType"),
        ("transmission", "transmission"), ("equipment", "equipment"),
        ("certified", "certified"), ("warranty", "warranty"),
        ("vin", "vin"), ("powertrain", "powertrain"), ("cylinders", "cylinders"),
        ("bodySubtype", "bodySubtype"), ("cabType", "cabType"),
        ("bedLength", "bedLength"), ("doors", "doors"),
    )}
    # Drive type already belongs to the canonical target and query filters.
    # Keep the supplemental facts inside the existing audit contract.
    confirmed = report.get("confirmedVehicleFacts") or {}
    facts.update({key: value for key, value in confirmed.items() if key in facts})
    # An absent certification, warranty, or equipment disclosure is unknown.
    return facts


class EfficientMarketSearch:
    def __init__(self, *, current_provider: Any, historical_provider: Any,
                 budget: Any, policy: EfficientSearchPolicy | None = None,
                 geography: SearchGeography | None = None,
                 checkpoint: Callable[[Mapping[str, Any]], None] | None = None,
                 resumed_events: Sequence[Mapping[str, Any]] = (),
                 resumed_transcript: Mapping[str, Any] | None = None,
                 resume_loader: Callable[[str], Mapping[str, Any] | None] | None = None,
                 operation_begin: Callable[[int, Mapping[str, Any]], None] | None = None,
                 summary_callback: Callable[[int, Mapping[str, Any], Mapping[str, Any]], None] | None = None,
                 resumable_evidence: bool = True,
                 readiness_stage: str = "full_review",
                 _replay_only: bool = False,
                 _strategy_version: str = SEARCH_STRATEGY_VERSION) -> None:
        if readiness_stage not in {"free_estimate", "full_review"}:
            raise ValueError("Unsupported readiness stage")
        self.strategy_version = _strategy_version
        self.normalization_version = "1" if _strategy_version == "1" else "2"
        self.readiness_stage = readiness_stage
        self.providers = {"current": current_provider, "historical": historical_provider}
        self.budget = budget
        self.policy = policy or EfficientSearchPolicy()
        self.geography = geography or SearchGeography()
        self.checkpoint = checkpoint
        self.resume_loader = resume_loader
        self.operation_begin = operation_begin
        self.summary_callback = summary_callback
        self.batch_summaries: dict[int, dict[str, Any]] = {}
        self.last_discovery: dict[str, int] = {}
        self.resumable_evidence = resumable_evidence
        self.resumed_transcript = copy.deepcopy(resumed_transcript)
        self.replay_only = _replay_only
        self.recorded_usage: dict[str, Any] | None = None
        self.resumed_events = list(copy.deepcopy(resumed_events))
        self.events: list[dict[str, Any]] = []
        self.observations: list[dict[str, Any]] = []
        self.verified: dict[str, dict[str, dict[str, Any]]] = {"current": {}, "historical": {}}
        self.attempted_vins: set[str] = set()
        self.centers: list[dict[str, Any]] = []
        self.branch_state: dict[str, list[dict[str, Any]]] = {"current": [], "historical": []}
        self.stops: dict[str, str] = {}
        self.issues: list[HistoricalEvidenceIssue] = []
        self.supporting_issues: list[HistoricalEvidenceIssue] = []
        self.historical_template: HistoricalMarketSearchResult | None = None
        self.baseline_frozen = False
        self.reassessment: set[str] = set()
        self.stream_centers_used: dict[str, set[str]] = {"current": set(), "historical": set()}

    def _usage(self) -> dict[str, Any]:
        if self.recorded_usage is not None and (self.replay_only or len(self.events) < len(self.resumed_events)):
            return copy.deepcopy(self.recorded_usage)
        return self.budget.snapshot()

    @step("search", "checkpoint_save")
    def _save(self) -> None:
        if self.checkpoint is not None:
            self.checkpoint({"version": CHECKPOINT_FORMAT_VERSION, "inputDigest": self.input_digest,
                             "input": copy.deepcopy(self.inputs), "events": copy.deepcopy(self.events),
                             "geography": copy.deepcopy(self.geographic_snapshot), "origin": copy.deepcopy(self.origin),
                             "providers": copy.deepcopy(self.provider_capabilities),
                             "usageBefore": copy.deepcopy(self.initial_usage),
                             "historicalTemplate": self.historical_template.to_dict() if self.historical_template else None})

    def _event(self, operation: dict[str, Any], invoke: Callable[[Mapping[str, Any] | None], dict[str, Any]]) -> dict[str, Any]:
        index = len(self.events)
        progress(eventIndex=index, stream=operation["stream"], centerId=operation.get("center", {}).get("id"),
                 pageStart=operation.get("start"))
        prior = None
        if index < len(self.resumed_events):
            event = copy.deepcopy(self.resumed_events[index])
            if event["operation"] != operation:
                raise ValueError("Saved search work does not match its deterministic request")
            if self.replay_only or not event["payload"].get("failure") or event["payload"].get("failure") in {
                "MARKET_CASE_BUDGET_EXHAUSTED", "MARKET_ENDPOINT_BUDGET_EXHAUSTED",
                "MARKET_VIN_HISTORY_BUDGET_EXHAUSTED", "MARKET_SUPPORTING_BUDGET_EXHAUSTED",
                "MARKET_SUPPORTING_DISCOVERY_BUDGET_EXHAUSTED",
            }:
                self.events.append(event)
                self.recorded_usage = copy.deepcopy(event["usageAfter"])
                return event
            prior = event
        elif self.replay_only:
            raise ValueError("Search replay requires an unrecorded provider operation")
        before = self.budget.snapshot()
        if self.operation_begin is not None:
            with phase("search", "journal_begin"):
                self.operation_begin(index, operation)
        interruption = None
        try:
            payload = invoke(prior["payload"] if prior else None)
        except MarketProviderError as exc:
            payload = copy.deepcopy(prior["payload"]) if prior else {}
            payload["failure"] = getattr(exc, "reason_code", type(exc).__name__)
            if "ACCOUNTING" in payload["failure"] or payload["failure"] == "MARKET_ATTEMPT_ALREADY_RESERVED":
                interruption = exc
        try:
            after = self.budget.snapshot()
        except MarketProviderError as exc:
            # Preserve the returned batch before propagating a later accounting
            # outage. This lower-bound usage never authorizes another request.
            after = copy.deepcopy(getattr(self.budget, "last_confirmed_usage", None) or before)
            interruption = exc
        event = {"operation": copy.deepcopy(operation), "payload": payload,
                 "usageBefore": prior["usageBefore"] if prior else before, "usageAfter": after}
        if getattr(self.budget, "pending_interruption", None) is not None:
            event["accountStateUncertain"] = True
        if prior is not None:
            event["priorAttempts"] = [*prior.get("priorAttempts", []),
                                       {key: value for key, value in prior.items() if key != "priorAttempts"}]
        self.recorded_usage = copy.deepcopy(after)
        self.events.append(event)
        self._save()
        if interruption is not None or getattr(self.budget, "pending_interruption", None) is not None:
            raise MarketSearchInterrupted(recovery_required=(
                getattr(self.budget, "pending_interruption", None) is not None
                or (not self.resumable_evidence and after["totalAttempts"] > 0)
            )) from interruption
        return event

    @step("search", "candidate_scoring")
    def _assessment(self, observation: Mapping[str, Any]) -> dict[str, Any]:
        return assess_observation(self.target, observation, subject_material_facts=self.subject_facts,
                                  evidence_date=self.evidence_date, max_distance_miles=self.policy.boundary,
                                  free_estimate=self.readiness_stage == "free_estimate", normalization_version=self.normalization_version)

    @step("search", "customer_distance")
    def _locate(self, observation: Mapping[str, Any], provenance: Mapping[str, Any]) -> dict[str, Any]:
        item = copy.deepcopy(dict(observation))
        if "resolvedLocation" not in item:
            raise ValueError("Search observation lacks its recorded geographic resolution")
        point = item["resolvedLocation"]
        if point is not None and coordinates(point) is None:
            raise ValueError("Search observation geographic resolution is invalid")
        distance = distance_miles(self.origin, point) if self.origin is not None and point is not None else None
        item["listing"]["distanceMiles"] = distance
        item["location"] = {**item.get("location", {}), **(point or {}), "verified": distance is not None,
                            "distanceOrigin": "CUSTOMER_POSTAL_AREA", "geographyVersion": "1"}
        if item.get("historicalEvidence") is not None:
            item["historicalEvidence"]["listing"] = copy.deepcopy(item["listing"])
        item["provenance"] = copy.deepcopy(dict(provenance))
        return item

    def _observation_conflicts(self, left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
        if left.get("stream") != right.get("stream") or left.get("relevantDate") != right.get("relevantDate"):
            return False
        # Discovery prices/mileage are not competing historical observations.
        if left.get("dateVerified") != right.get("dateVerified"):
            return False
        fields = ("year", "make", "model", "trim", "drivetrain")
        if left.get("stream") != "historical" or left.get("dateVerified") is True:
            fields += ("mileage", "price")
        from venfour.vehicle_specs import comparison
        if any((comparison(key, left["listing"].get(key), right["listing"].get(key))["status"] == "CONFLICT"
                if self.normalization_version == "2" and key in {"year", "make", "model", "trim", "drivetrain"}
                else left["listing"].get(key) != right["listing"].get(key)) for key in fields):
            return True
        if self.normalization_version == "2":
            from venfour.vehicle_specs import material_conflicts
            return material_conflicts([left, right]) or left.get("location") != right.get("location")
        return any(left.get(key) != right.get(key) for key in ("materialFacts", "location"))

    @step("search", "identity_merge")
    def _record(self, observation: dict[str, Any]) -> bool:
        if len(self.observations) >= self.policy.max_observations:
            return False
        identity = observation_identity(observation)
        same_vehicle = [row for row in self.observations if identity is not None and observation_identity(row) == identity]
        same = [row for row in same_vehicle
                if row.get("stream") == observation.get("stream") and row.get("relevantDate") == observation.get("relevantDate")]
        from venfour.vehicle_specs import material_conflicts
        conflict_check = material_conflicts if self.normalization_version == "2" else immutable_material_conflicts
        material_conflict = conflict_check([*same_vehicle, observation])
        conflicts = [row for row in same if self._observation_conflicts(row, observation)]
        if material_conflict:
            conflicts = same_vehicle
        if conflicts:
            observation["conflicted"] = True
            if self.baseline_frozen and identity is not None:
                self.reassessment.add(identity)
            if not self.baseline_frozen:
                for prior in conflicts:
                    prior["conflicted"] = True
                for stream in self.verified if material_conflict else (observation["stream"],):
                    self.verified[stream].pop(identity, None)
        self.observations.append(observation)
        assessment = self._assessment(observation)
        observation["assessment"] = assessment
        if assessment["baselineEligible"] and not self.baseline_frozen:
            self.verified[observation["stream"]].setdefault(identity, observation)
        return not same

    @step("search", "sufficiency")
    def _strong(self, stream: str) -> int:
        key = "estimateStrong" if self.readiness_stage == "free_estimate" else "strong"
        return sum(self._assessment(row).get(key, False) for row in self.verified[stream].values())

    @step("search", "strict_sufficiency")
    def _strict_strong(self, stream: str) -> int:
        return sum(self._assessment(row)["strong"] for row in self.verified[stream].values())

    def _failure_stop(self, reason: str) -> str:
        if reason == "OBSERVATION_LIMIT":
            return reason
        if "ACCOUNTING" in reason:
            raise MarketSearchInterrupted()
        if any(word in reason for word in ("BUDGET", "LIMIT", "RESERVE", "QUOTA", "CONFIGURATION", "THROTTL")):
            return "BUDGET_OR_QUOTA_LIMITED"
        return "PROVIDER_FAILURE"

    @step("search", "discovery")
    def _discover(self, stream: str, center: dict[str, Any], start: int, *, supporting: bool = False) -> tuple[list[dict[str, Any]], bool, str | None]:
        remaining = self.policy.max_observations - len(self.observations)
        rows_allowed = min(self.policy.page_size, remaining // 2 if stream == "historical" else remaining)
        if rows_allowed < 1:
            return [], False, "OBSERVATION_LIMIT"
        request = replace(self.requests[stream], radius_miles=center["radiusMiles"], result_limit=rows_allowed)
        operation = {"kind": "discovery", "stream": stream, "purpose": "supporting" if supporting else "baseline",
                     "center": center, "start": start, "rows": rows_allowed,
                     "sort": "PRICE_DESC" if supporting else "DISTANCE_ASC"}
        def invoke(prior=None):
            page = self.providers[stream].discover_page(request, start=start, rows=rows_allowed,
                                                        supporting=supporting, center=center if self.origin else None)
            observations = copy.deepcopy(list(page.observations))
            if len(observations) > rows_allowed:
                raise ValueError("Provider discovery exceeded its requested page size")
            for row in observations:
                row["resolvedLocation"] = self.geography.locate(row.get("location"))
            return {"observations": observations, "hasMore": page.has_more,
                    "numFound": page.num_found}
        event = self._event(operation, invoke)
        payload = event["payload"]
        rows = []
        if not isinstance(payload.get("observations", []), list) or len(payload.get("observations", [])) > rows_allowed:
            raise ValueError("Discovery response exceeds its bounded observation count")
        index = len(self.events) - 1
        # Keep batch counts even if later distance, merge, or scoring fails.
        self.batch_summaries[index] = discovery_summary(operation, [],
            returned_rows=len(payload.get("observations", [])), parseable_observations=len(payload.get("observations", [])),
            request_attempts=event["usageAfter"]["totalAttempts"], scoring_completed=False)
        self.last_discovery[stream] = index
        self._publish_summary(index)
        for raw in payload.get("observations", []):
            if raw.get("stream") != stream or raw.get("sourceEndpoint") != ("active" if stream == "current" else "recents"):
                raise ValueError("Discovery observation has an inconsistent evidence stream")
            row = self._locate(raw, {**operation, "eventIndex": len(self.events) - 1})
            row["purpose"] = operation["purpose"]
            if stream == "current":
                row["relevantDate"] = self.observed_date
            row["newIdentity"] = self._record(row)
            rows.append(row)
        progress(evidenceNormalized=True)
        index = len(self.events) - 1
        with phase("search", "summary_construction"):
            self.batch_summaries[index] = discovery_summary(operation, rows,
                returned_rows=len(payload.get("observations", [])), parseable_observations=len(payload.get("observations", [])),
                request_attempts=event["usageAfter"]["totalAttempts"])
        self.last_discovery[stream] = index
        self._publish_summary(index)
        if self.readiness_stage == "free_estimate" and not supporting:
            from venfour.subject_readiness import SubjectReadinessError, free_estimate_ambiguity
            issues = free_estimate_ambiguity(self.subject_facts, [
                row for row in self.observations if row.get("purpose") == "baseline"
                and self._assessment(row)["verificationEligible"]
            ])
            if issues:
                raise SubjectReadinessError(issues)
        return rows, payload.get("hasMore", False), payload.get("failure")

    @step("search", "summary_persistence")
    def _publish_summary(self, index: int, stop_reason: str | None = None) -> None:
        summary = self.batch_summaries[index]
        if stop_reason is not None:
            summary["stopReason"] = stop_reason
        if self.summary_callback is not None and not self.replay_only and not (
            index < len(self.resumed_events) and not self.resumed_events[index]["payload"].get("failure")
        ):
            self.summary_callback(index, self.events[index]["operation"], validate_summary(summary))

    def _stop(self, stream: str, reason: str) -> None:
        self.stops[stream] = reason
        if stream in self.last_discovery:
            self._publish_summary(self.last_discovery[stream], reason)

    @step("search", "history_verification")
    def _verify(self, candidates: Sequence[dict[str, Any]], *, supporting: bool = False) -> str | None:
        if not candidates:
            return None
        candidates = candidates[:self.policy.max_observations - len(self.observations)]
        if not candidates:
            return "OBSERVATION_LIMIT"
        progress(historyVerificationBegun=True)
        identities = [observation_identity(row) for row in candidates]
        self.attempted_vins.update(identities)
        operation = {"kind": "verification", "stream": "historical", "purpose": "supporting" if supporting else "baseline",
                     "identities": identities, "historyPagesPerVin": self.policy.history_pages_per_vin}
        def invoke(prior=None):
            prior_observations = copy.deepcopy(prior.get("observations", [])) if prior else []
            completed = {observation_identity(row) for row in prior_observations}
            if prior and prior.get("result"):
                completed.update(
                    f"vin:{issue['vin'].strip().casefold()}" for issue in prior["result"].get("issues", [])
                    if isinstance(issue.get("vin"), str) and issue["vin"].strip()
                )
            remaining_candidates = [row for row in candidates if observation_identity(row) not in completed]
            batch = self.providers["historical"].verify_historical_candidates(
                self.requests["historical"], [listing_from_observation(row) for row in remaining_candidates],
                observations=remaining_candidates, max_history_pages=self.policy.history_pages_per_vin, supporting=supporting)
            observations = copy.deepcopy(list(batch.observations))
            for row in observations:
                row["resolvedLocation"] = self.geography.locate(row.get("location"))
            result = batch.result
            if prior and prior.get("result"):
                old = _historical_result(prior["result"])
                result = replace(result, evidence=old.evidence + result.evidence, issues=old.issues + result.issues)
            return {"observations": prior_observations + observations, "result": result.to_dict(),
                    "failure": getattr(batch.failure, "reason_code", type(batch.failure).__name__) if batch.failure else None}
        event = self._event(operation, invoke)
        payload = event["payload"]
        if payload.get("result"):
            result = _historical_result(payload["result"])
            if result.request != self.requests["historical"]:
                raise ValueError("Historical verification result has different search inputs")
            returned = {observation_identity({"listing": item.listing.to_dict()}): item.to_dict() for item in result.evidence}
            observed = {observation_identity(row): row.get("historicalEvidence") for row in payload.get("observations", [])}
            if (len(observed) != len(payload.get("observations", [])) or returned != observed
                    or set(observed) - set(identities)):
                raise ValueError("Historical observations do not match their verified evidence")
            (self.supporting_issues if supporting else self.issues).extend(result.issues)
        for raw in payload.get("observations", []):
            if (raw.get("stream") != "historical" or raw.get("sourceEndpoint") != "history"
                    or raw.get("relevantDate") != self.evidence_date):
                raise ValueError("Verified observation has inconsistent loss-date context")
            candidate = next((row for row in candidates if observation_identity(row) == observation_identity(raw)), None)
            provenance = {**(candidate or {}).get("provenance", {}), "verificationEventIndex": len(self.events) - 1,
                          "purpose": operation["purpose"]}
            row = self._locate(raw, provenance)
            row["purpose"] = operation["purpose"]
            self._record(row)
        return payload.get("failure")

    def _next_center(self, stream: str) -> dict[str, Any] | None:
        if self.origin is None:
            return None
        radius = min(self.policy.local_radius_miles, self.providers[stream].maximum_search_radius_miles)
        existing_centers = self.centers[1:]
        if self.strategy_version == "3":
            other = "current" if stream == "historical" else "historical"
            # A productive market in the other date stream is worth probing,
            # but its evidence and identity counts stay in their own stream.
            totals: dict[str, list[int]] = {}
            for branch in self.branch_state[other]:
                aggregate = totals.setdefault(branch["centerId"], [0, 0])
                aggregate[0] += branch.get("newEligibleCandidates", 0)
                aggregate[1] += branch.get("physicalAttempts", 0)
            yields = {identity: eligible / max(1, attempts)
                      for identity, (eligible, attempts) in totals.items()}
            existing_centers = sorted(existing_centers,
                key=lambda row: (-yields.get(row["id"], 0), self.centers.index(row)))
        for existing in existing_centers:
            if existing["id"] not in self.stream_centers_used[stream]:
                return {**existing, "radiusMiles": min(existing["radiusMiles"], radius)}
        if len(self.centers) - 1 >= self.policy.additional_centers:
            return None
        chosen = self.market_geography.next_center(self.origin, self.centers, endpoint_radius_miles=radius,
                                            outer_boundary_miles=self.policy.boundary,
                                            selector_version="coverage-v2" if self.strategy_version == "3" else "legacy-v1")
        if chosen is not None:
            self.centers.append(chosen)
        return chosen

    def _discovery_available(self, stream: str) -> bool:
        """Plan inside the immutable, atomically enforced endpoint ceilings.

        The deployed 20-attempt policy caps each discovery endpoint at six,
        leaving eight attempts that discovery cannot spend. The normal policy
        retains eight per endpoint and sixty total. This additional planning
        fraction can only stop earlier; it never raises a reservation limit.
        """
        usage = self._usage()
        policy = usage["policy"]
        operations = usage["operationAttempts"]
        endpoint = "historical_discovery" if stream == "historical" else "active_discovery"
        limits = policy["operationLimits"]
        discovery_used = operations["historical_discovery"] + operations["active_discovery"]
        ceiling = min(limits["historical_discovery"] + limits["active_discovery"],
                      max(1, policy["totalAttempts"] * 3 // 5))
        return (usage["remainingAttempts"] > 0 and discovery_used < ceiling
                and operations[endpoint] < limits[endpoint])

    def _adaptive_stream(self, stream: str):
        """Yield after discovery and bounded history batches, never by price."""
        provider = self.providers[stream]
        if provider is None or self.requests[stream] is None:
            self.stops[stream] = "NOT_CONFIGURED"
            return
        if stream == "historical" and self.historical_template.coverage.status != "SUPPORTED":
            self.stops[stream] = "OUT_OF_PROVIDER_RANGE"
            return
        radius = min(self.policy.local_radius_miles, provider.maximum_search_radius_miles, self.policy.boundary)
        center = {**self.centers[0], "radiusMiles": radius}
        while center is not None:
            from venfour.search_geography import coverage_metrics
            searched = [row for row in self.centers if row["id"] in self.stream_centers_used[stream]]
            novelty = (coverage_metrics(self.origin, center, searched, endpoint_radius_miles=radius)
                       if self.origin else None)
            self.stream_centers_used[stream].add(center["id"])
            progress(stageIndex=len(self.stream_centers_used[stream]) - 1, stream=stream, centerId=center["id"])
            for page_index in range(self.policy.pages_per_center):
                if len(self.observations) >= self.policy.max_observations:
                    self._stop(stream, "OBSERVATION_LIMIT")
                    return
                if not self._discovery_available(stream):
                    self._stop(stream, "BUDGET_OR_QUOTA_LIMITED")
                    return
                event_count = len(self.events)
                rows, more, failure = self._discover(stream, center, page_index * self.policy.page_size)
                if len(self.events) == event_count:
                    self._stop(stream, self._failure_stop(failure))
                    return
                event = self.events[-1]
                attempts = event["usageAfter"]["totalAttempts"] - event["usageBefore"]["totalAttempts"]
                identified = {observation_identity(row): row for row in rows
                              if row["newIdentity"] and observation_identity(row) is not None}
                eligible = [row for row in identified.values() if self._assessment(row)["verificationEligible"]]
                promising = sorted((row for row in eligible if stream == "current"
                                    or observation_identity(row) not in self.attempted_vins),
                                   key=lambda row: self._assessment(row)["qualityKey"])
                duplicates = sum(not row["newIdentity"] and observation_identity(row) is not None for row in rows)
                duplicate_fraction = duplicates / len(rows) if rows else 0
                productive_page = bool(more and eligible and duplicate_fraction < self.policy.duplicate_branch_fraction
                                       and (len(eligible) >= self.policy.verification_batch_size
                                            or len(eligible) / max(1, len(rows)) >= .1))
                branch = {"centerId": center["id"], "page": page_index, "returned": len(rows),
                          "newIdentities": len(identified), "promising": len(promising), "hasMore": more,
                          "newEligibleCandidates": len(eligible), "duplicateObservations": duplicates,
                          "identityOverlapFraction": round(duplicate_fraction, 6),
                          "geographicNovelty": novelty if page_index == 0 else None,
                          "physicalAttempts": attempts,
                          "usefulCandidatesPerAttempt": round(len(eligible) / max(1, attempts), 6),
                          "nextDiscoveryAction": "PAGE" if productive_page else "CENTER"}
                self.branch_state[stream].append(branch)
                if stream == "historical":
                    for offset in range(0, len(promising), self.policy.verification_batch_size):
                        batch = promising[offset:offset + self.policy.verification_batch_size]
                        failure = self._verify(batch) or failure
                        if failure or self._strong(stream) >= self.policy.minimum_strong_matches:
                            break
                        pending = offset + len(batch) < len(promising)
                        # Let the cheap local current probe run before a second
                        # history batch. The next batch retains priority later.
                        yield {"pendingHistory": pending, "productivePage": productive_page,
                               "yield": branch["usefulCandidatesPerAttempt"]}
                if failure:
                    self._stop(stream, self._failure_stop(failure))
                    return
                if self._strong(stream) >= self.policy.minimum_strong_matches:
                    self._stop(stream, "SUFFICIENT_STRONG_EVIDENCE")
                    return
                if len(self.observations) >= self.policy.max_observations:
                    self._stop(stream, "OBSERVATION_LIMIT")
                    return
                if not productive_page:
                    branch["stopReason"] = ("DUPLICATE_HEAVY" if duplicate_fraction >= self.policy.duplicate_branch_fraction
                                            else "UNPRODUCTIVE" if not eligible else "EXHAUSTED")
                    self._publish_summary(self.last_discovery[stream], branch["stopReason"])
                yield {"pendingHistory": False, "productivePage": productive_page,
                       "yield": branch["usefulCandidatesPerAttempt"]}
                if not productive_page:
                    break
            center = self._next_center(stream)
        self._stop(stream, "GEOGRAPHIC_SCOPE_LIMITED" if self.origin else "CUSTOMER_LOCATION_UNAVAILABLE")

    def _search_adaptively(self) -> None:
        iterators = {stream: self._adaptive_stream(stream) for stream in ("historical", "current")}
        hints: dict[str, dict[str, Any]] = {}

        def advance(stream: str) -> None:
            try:
                hints[stream] = next(iterators[stream])
            except StopIteration:
                iterators.pop(stream, None)
                hints.pop(stream, None)

        advance("historical")
        if self._strong("historical") >= self.policy.minimum_strong_matches:
            if self.policy.current_context_pages_after_historical:
                self._search_stream("current", context_only=True)
            else:
                self.stops["current"] = "HISTORICAL_BASELINE_SUFFICIENT"
            return
        advance("current")
        while iterators:
            historical_sufficient = self._strong("historical") >= self.policy.minimum_strong_matches
            current_sufficient = self._strong("current") >= self.policy.minimum_strong_matches
            pending_history = hints.get("historical", {}).get("pendingHistory", False)
            if historical_sufficient or (current_sufficient and not pending_history):
                for stream in iterators:
                    if self._strong(stream) >= self.policy.minimum_strong_matches:
                        self._stop(stream, "SUFFICIENT_STRONG_EVIDENCE")
                    else:
                        # Preserve the last batch's actual outcome; sufficiency
                        # belongs to the other date stream, not this batch.
                        self.stops[stream] = "OTHER_STREAM_SUFFICIENT"
                return
            # Productive history is already paid-for discovery; productive pages
            # come next. Lower spent streams break ties so sparse local probes
            # expand together instead of draining one endpoint first.
            counts = self._usage()["operationAttempts"]
            stream = max(iterators, key=lambda item: (
                hints.get(item, {}).get("pendingHistory", False),
                hints.get(item, {}).get("productivePage", False),
                hints.get(item, {}).get("yield", 0),
                -counts["historical_discovery" if item == "historical" else "active_discovery"],
                item == "historical"))
            advance(stream)

    @step("search", "adaptive_stage")
    def _search_stream(self, stream: str, *, context_only: bool = False) -> None:
        provider = self.providers[stream]
        if provider is None or self.requests[stream] is None:
            self.stops[stream] = "NOT_CONFIGURED"
            return
        if stream == "historical" and self.historical_template.coverage.status != "SUPPORTED":
            self.stops[stream] = "OUT_OF_PROVIDER_RANGE"
            return
        radius = min(self.policy.local_radius_miles, provider.maximum_search_radius_miles, self.policy.boundary)
        center = {**self.centers[0], "radiusMiles": radius}
        while center is not None:
            self.stream_centers_used[stream].add(center["id"])
            progress(stageIndex=len(self.stream_centers_used[stream]) - 1, stream=stream, centerId=center["id"])
            for page_index in range(self.policy.pages_per_center):
                rows, more, failure = self._discover(stream, center, page_index * self.policy.page_size)
                fresh = [row for row in rows if row["newIdentity"]]
                progress(phase="search", operation="history_selection", stream=stream)
                promising = sorted((row for row in fresh if self._assessment(row)["verificationEligible"]
                                    and (stream == "current" or observation_identity(row) not in self.attempted_vins)),
                                   key=lambda row: self._assessment(row)["qualityKey"])
                branch = {"centerId": center["id"], "page": page_index, "returned": len(rows),
                          "newIdentities": len(fresh), "promising": len(promising), "hasMore": more}
                self.branch_state[stream].append(branch)
                if stream == "historical":
                    for offset in range(0, len(promising), self.policy.verification_batch_size):
                        batch = promising[offset:offset + self.policy.verification_batch_size]
                        failure = self._verify(batch) or failure
                        if failure or self._strong(stream) >= self.policy.minimum_strong_matches:
                            break
                if failure:
                    self._stop(stream, self._failure_stop(failure))
                    return
                if self._strong(stream) >= self.policy.minimum_strong_matches:
                    self._stop(stream, "SUFFICIENT_STRONG_EVIDENCE")
                    return
                if context_only:
                    self._stop(stream, "HISTORICAL_BASELINE_SUFFICIENT_CURRENT_CONTEXT_ONLY")
                    return
                if len(self.observations) >= self.policy.max_observations:
                    self._stop(stream, "OBSERVATION_LIMIT")
                    return
                duplicate_heavy = bool(rows) and 1 - len(fresh) / len(rows) >= self.policy.duplicate_branch_fraction
                if not more or not promising or duplicate_heavy:
                    branch["stopReason"] = "DUPLICATE_HEAVY" if duplicate_heavy else "UNPRODUCTIVE" if not promising else "EXHAUSTED"
                    self._publish_summary(self.last_discovery[stream], branch["stopReason"])
                    break
            center = self._next_center(stream)
        self._stop(stream, "GEOGRAPHIC_SCOPE_LIMITED" if self.origin else "CUSTOMER_LOCATION_UNAVAILABLE")

    @step("search", "supporting_selection")
    def _supporting(self) -> dict[str, Any]:
        self.baseline_frozen = True
        baseline = [copy.deepcopy(row) for stream in self.verified.values() for row in stream.values()]
        def shortlist():
            extras = [row for row in self.observations if row.get("purpose") == "supporting" and row.get("dateVerified")]
            return build_supporting_shortlist(self.target, baseline + extras, normalization_version=self.normalization_version, subject_material_facts=self.subject_facts,
                evidence_date=self.evidence_date, max_distance_miles=self.policy.boundary,
                policy=SupportingShortlistPolicy(maximum_listings=self.policy.supporting_maximum_listings))
        result = shortlist()
        sufficient = [stream for stream in ("historical", "current") if self._strict_strong(stream) >= self.policy.minimum_strong_matches]
        if not sufficient:
            result["listings"] = []
            result["searchStatus"] = "SKIPPED_INSUFFICIENT_BASELINE"
            return result
        stream = sufficient[0]
        # Premium context is necessary before buying price-directed discovery.
        if not any(self._assessment(row)["supportingEligible"] for row in baseline if row["stream"] == stream):
            result["searchStatus"] = "SKIPPED_MATERIAL_PREMIUM_CONTEXT_UNKNOWN"
            return result
        start_usage = self._usage()
        allowed = min(self.policy.supporting_attempts, start_usage["remainingAttempts"])
        if allowed < 1:
            result["searchStatus"] = "SKIPPED_BUDGET_CONSTRAINED"
            return result
        def spent() -> int:
            return self._usage()["totalAttempts"] - start_usage["totalAttempts"]
        failure = None
        if stream == "historical":
            pending = [row for row in self.observations if row["stream"] == stream and row.get("sourceEndpoint") == "recents"
                       and observation_identity(row) not in self.attempted_vins and self._assessment(row)["supportingVerificationEligible"]]
            pending.sort(key=lambda row: (*self._assessment(row)["qualityKey"][:-1], -row["listing"]["price"], observation_identity(row)))
            for row in pending:
                if spent() >= allowed:
                    break
                failure = self._verify([row], supporting=True)
                if failure:
                    break
        result = shortlist()
        discoveries = 0
        # Continue only branches with demonstrable inventory opportunity.
        branches = [branch for branch in self.branch_state[stream] if branch["hasMore"] and branch["promising"] > 0]
        while not failure and discoveries < self.policy.supporting_discovery_requests and spent() < allowed and branches:
            branch = branches.pop(0)
            center = next(row for row in self.centers if row["id"] == branch["centerId"])
            center = {**center, "radiusMiles": min(center.get("radiusMiles", self.policy.local_radius_miles), self.providers[stream].maximum_search_radius_miles)}
            rows, more, failure = self._discover(stream, center, 0, supporting=True)
            discoveries += 1
            promising = sorted((row for row in rows if self._assessment(row)["supportingVerificationEligible"]
                                and (stream == "current" or observation_identity(row) not in self.attempted_vins)),
                               key=lambda row: (*self._assessment(row)["qualityKey"][:-1], -row["listing"]["price"], observation_identity(row)))
            if stream == "historical":
                for row in promising:
                    if spent() >= allowed:
                        break
                    failure = self._verify([row], supporting=True)
                    if failure:
                        break
            # Never repeat a center's identical price-directed first page.
            branches = [row for row in branches if row["centerId"] != center["id"]]
            if len(shortlist()["listings"]) >= self.policy.supporting_maximum_listings:
                break
        result = shortlist()
        result["baselineReassessmentIdentities"] = sorted(self.reassessment)
        result["searchStatus"] = self._failure_stop(failure) if failure else "COMPLETE_BOUNDED_PASS"
        return result

    @execution
    @step("search", "initialize")
    def run(self, *, target: ComparableTarget, current_request: MarketSearchRequest | None,
            historical_request: HistoricalMarketSearchRequest | None, observed_date: str,
            subject_facts: Mapping[str, Any], subject_vin: str | None = None) -> EfficientSearchResult:
        if not self.replay_only:
            from venfour.subject_readiness import SubjectReadinessError, subject_readiness, free_estimate_readiness
            check = free_estimate_readiness if self.readiness_stage == "free_estimate" else subject_readiness
            issues = check(
                target, subject_facts,
                loss_date=historical_request.evidence_date if historical_request else observed_date,
                location_resolved=self.geography.origin(target.postal_code) is not None,
            )
            if issues:
                raise SubjectReadinessError(issues)
        self.target, self.subject_facts, self.observed_date = target, copy.deepcopy(dict(subject_facts)), observed_date
        if subject_vin is not None:
            self.subject_facts["vin"] = subject_vin
        self.evidence_date = historical_request.evidence_date if historical_request is not None else None
        self.requests = {"current": current_request, "historical": historical_request}
        inputs = {"target": target.to_dict(), "subjectFacts": self.subject_facts, "subjectVin": subject_vin,
                  "currentRequest": current_request.to_dict() if current_request else None,
                  "historicalRequest": historical_request.to_dict() if historical_request else None,
                  "observedDate": observed_date, "policy": asdict(self.policy)}
        if self.normalization_version == "2":
            inputs["normalizationVersion"] = "2"
        if self.strategy_version == "3":
            inputs["discoveryStrategyVersion"] = "3"
        if self.readiness_stage == "free_estimate":
            inputs["readinessStage"] = self.readiness_stage
        self.input_digest = _digest(inputs)
        self.inputs = inputs
        saved = self.resumed_transcript
        if saved is None and self.resume_loader is not None:
            saved = self.resume_loader(self.input_digest)
        if saved is not None:
            # Storage envelope v1 is unchanged. The bound input identifies
            # the comparison strategy independently of its storage format.
            saved_strategy = saved.get("input", {}).get("discoveryStrategyVersion", saved.get("input", {}).get("normalizationVersion", "1"))
            if (saved.get("version") not in {CHECKPOINT_FORMAT_VERSION, self.strategy_version}
                    or saved_strategy != self.strategy_version or saved.get("inputDigest") != self.input_digest):
                raise ValueError("Saved search work has different valuation inputs")
            self.resumed_events = copy.deepcopy(list(saved["events"]))
        self.provider_capabilities = {
            stream: {"name": provider.name, "maximumRadiusMiles": provider.maximum_search_radius_miles}
            if provider is not None else None for stream, provider in self.providers.items()
        }
        if saved is not None and saved.get("providers") != self.provider_capabilities:
            raise ValueError("Saved search work has different provider capabilities")
        self.origin = copy.deepcopy(saved["origin"]) if saved is not None else self.geography.origin(target.postal_code)
        self.geographic_snapshot = (copy.deepcopy(saved["geography"]) if saved is not None else
                                   self.geography.snapshot(self.origin, outer_boundary_miles=self.policy.boundary))
        if self.geographic_snapshot.get("origin") != self.origin:
            raise ValueError("Saved geographic origin is inconsistent")
        self.market_geography = SearchGeography(market_centers=self.geographic_snapshot["marketCenters"])
        self.centers = [{**(self.origin or {"id": "customer", "label": "Customer postal area", "postalCode": target.postal_code}),
                         "radiusMiles": min(self.policy.local_radius_miles, self.policy.boundary)}]
        if self.resumed_events:
            self.recorded_usage = copy.deepcopy(self.resumed_events[0]["usageBefore"])
        self.initial_usage = copy.deepcopy(saved["usageBefore"]) if saved is not None else self._usage()
        if saved is not None and saved.get("historicalTemplate") is not None:
            self.historical_template = _historical_result(saved["historicalTemplate"])
        elif historical_request is not None and self.providers["historical"] is not None:
            self.historical_template = self.providers["historical"].verify_historical_candidates(historical_request, []).result
        if self.strategy_version == "3":
            self._search_adaptively()
        else:
            self._search_stream("historical")
            historical_sufficient = self._strong("historical") >= self.policy.minimum_strong_matches
            if historical_sufficient and self.policy.current_context_pages_after_historical == 0:
                self.stops["current"] = "HISTORICAL_BASELINE_SUFFICIENT"
            else:
                self._search_stream("current", context_only=historical_sufficient)
        for stream, candidates in self.verified.items():
            progress(phase="search", operation="baseline_ranking", stream=stream)
            ranked = sorted(candidates.values(), key=lambda row: self._assessment(row)["qualityKey"])
            for index, row in enumerate(ranked):
                row["baselineSelection"] = "SELECTED" if index < 100 else "BASELINE_CANDIDATE_LIMIT"
            self.verified[stream] = {observation_identity(row): row for row in ranked[:100]}
        supporting = self._supporting()
        current = None
        progress(phase="search", operation="current_result", stream="current")
        if current_request is not None and self.providers["current"] is not None:
            current = MarketSearchResult(provider=self.providers["current"].name,
                                         request=replace(current_request, radius_miles=self.policy.boundary, result_limit=100),
                                         listings=tuple(listing_from_observation(row) for row in self.verified["current"].values()))
            validate_market_search_result(current)
        historical = None
        progress(phase="search", operation="historical_result", stream="historical")
        if self.historical_template is not None:
            historical = replace(self.historical_template,
                                request=replace(historical_request, radius_miles=self.policy.boundary, result_limit=100),
                                evidence=tuple(_historical_item(row["historicalEvidence"])
                                for row in self.verified["historical"].values()), issues=tuple(self.issues))
            validate_historical_market_search_result(historical)
        for row in self.observations:
            row["assessment"] = self._assessment(row)
        progress(phase="search", operation="transcript_construction", stream=None, centerId=None, pageStart=None)
        transcript = {"version": self.strategy_version, "input": inputs, "inputDigest": self.input_digest,
                      "origin": self.origin, "centers": self.centers, "events": self.events,
                      "geography": self.geographic_snapshot, "providers": self.provider_capabilities,
                      "observations": self.observations, "stopReasons": self.stops,
                      "branches": self.branch_state, "usageBefore": self.initial_usage, "usageAfter": self.budget.snapshot(),
                      "supportingIssues": [issue.to_dict() for issue in self.supporting_issues],
                      "historicalTemplate": self.historical_template.to_dict() if self.historical_template else None,
                      "baselineIdentities": {stream: list(rows) for stream, rows in self.verified.items()},
                      "baselineStatus": "SUFFICIENT" if self._strict_strong("historical") >= 9 or self._strict_strong("current") >= 9 else "LIMITED",
                      "supportingEvidence": supporting}
        transcript["digest"] = _digest(transcript)
        if self.replay_only and len(self.events) != len(self.resumed_events):
            raise ValueError("Search transcript contains operations after a deterministic stop")
        return EfficientSearchResult(current, historical, transcript, supporting)


def replay_efficient_search(transcript: Mapping[str, Any]) -> EfficientSearchResult:
    """Re-run recorded decisions and evidence projection without provider access."""

    from venfour.analysis_runs import _historical_request_from_data, _market_request_from_data, _target_from_data

    if not isinstance(transcript, Mapping) or transcript.get("version") not in {"1", "2", "3"}:
        raise ValueError("Unsupported efficient-search transcript")
    supplied = copy.deepcopy(dict(transcript))
    digest = supplied.pop("digest", None)
    if not isinstance(digest, str) or _digest(supplied) != digest:
        raise ValueError("Efficient-search transcript digest does not match its contents")
    inputs = supplied["input"]
    if _digest(inputs) != supplied["inputDigest"]:
        raise ValueError("Efficient-search input digest is invalid")
    events = supplied["events"]
    if not isinstance(events, list) or len(events) > 2048:
        raise ValueError("Efficient-search transcript event count is invalid")
    prior_total = supplied["usageBefore"]["totalAttempts"]
    for event in events:
        for field in ("usageBefore", "usageAfter"):
            value = event[field].get("totalAttempts")
            if isinstance(value, bool) or not isinstance(value, int) or value < prior_total:
                raise ValueError("Efficient-search usage is not cumulative")
            prior_total = value
    if supplied["usageAfter"]["totalAttempts"] < prior_total:
        raise ValueError("Efficient-search final usage predates its operations")

    class ReplayBudget:
        def snapshot(self):
            return copy.deepcopy(supplied["usageAfter"])

    providers = {
        stream: SimpleNamespace(name=data["name"], maximum_search_radius_miles=data["maximumRadiusMiles"])
        if data is not None else None for stream, data in supplied["providers"].items()
    }
    result = EfficientMarketSearch(
        current_provider=providers["current"], historical_provider=providers["historical"],
        budget=ReplayBudget(), policy=EfficientSearchPolicy(**inputs["policy"]),
        geography=SearchGeography(postal_centroids={}, market_centers=[]),
        readiness_stage=inputs.get("readinessStage", "full_review"),
        resumed_transcript=transcript, _replay_only=True, _strategy_version=transcript["version"],
    ).run(
        target=_target_from_data(inputs["target"]),
        current_request=_market_request_from_data(inputs["currentRequest"]) if inputs["currentRequest"] else None,
        historical_request=_historical_request_from_data(inputs["historicalRequest"]) if inputs["historicalRequest"] else None,
        observed_date=inputs["observedDate"], subject_facts=inputs["subjectFacts"], subject_vin=inputs["subjectVin"],
    )
    if result.transcript != transcript:
        raise ValueError("Efficient-search transcript does not match deterministic replay")
    return result
