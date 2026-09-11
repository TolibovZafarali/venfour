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


SEARCH_STRATEGY_VERSION = "1"


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
    facts.update(report.get("confirmedVehicleFacts") or {})
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
                 _replay_only: bool = False) -> None:
        self.providers = {"current": current_provider, "historical": historical_provider}
        self.budget = budget
        self.policy = policy or EfficientSearchPolicy()
        self.geography = geography or SearchGeography()
        self.checkpoint = checkpoint
        self.resume_loader = resume_loader
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

    def _save(self) -> None:
        if self.checkpoint is not None:
            self.checkpoint({"version": SEARCH_STRATEGY_VERSION, "inputDigest": self.input_digest,
                             "input": copy.deepcopy(self.inputs), "events": copy.deepcopy(self.events),
                             "geography": copy.deepcopy(self.geographic_snapshot), "origin": copy.deepcopy(self.origin),
                             "providers": copy.deepcopy(self.provider_capabilities),
                             "usageBefore": copy.deepcopy(self.initial_usage),
                             "historicalTemplate": self.historical_template.to_dict() if self.historical_template else None})

    def _event(self, operation: dict[str, Any], invoke: Callable[[Mapping[str, Any] | None], dict[str, Any]]) -> dict[str, Any]:
        index = len(self.events)
        prior = None
        if index < len(self.resumed_events):
            event = copy.deepcopy(self.resumed_events[index])
            if event["operation"] != operation:
                raise ValueError("Saved search work does not match its deterministic request")
            if self.replay_only or not event["payload"].get("failure"):
                self.events.append(event)
                self.recorded_usage = copy.deepcopy(event["usageAfter"])
                return event
            prior = event
        elif self.replay_only:
            raise ValueError("Search replay requires an unrecorded provider operation")
        before = self.budget.snapshot()
        try:
            payload = invoke(prior["payload"] if prior else None)
        except MarketProviderError as exc:
            payload = copy.deepcopy(prior["payload"]) if prior else {}
            payload["failure"] = getattr(exc, "reason_code", type(exc).__name__)
        after = self.budget.snapshot()
        event = {"operation": copy.deepcopy(operation), "payload": payload,
                 "usageBefore": prior["usageBefore"] if prior else before, "usageAfter": after}
        if prior is not None:
            event["priorAttempts"] = [*prior.get("priorAttempts", []),
                                       {key: value for key, value in prior.items() if key != "priorAttempts"}]
        self.recorded_usage = copy.deepcopy(after)
        self.events.append(event)
        self._save()
        return event

    def _assessment(self, observation: Mapping[str, Any]) -> dict[str, Any]:
        return assess_observation(self.target, observation, subject_material_facts=self.subject_facts,
                                  evidence_date=self.evidence_date, max_distance_miles=self.policy.boundary)

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

    @staticmethod
    def _observation_conflicts(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
        if left.get("stream") != right.get("stream") or left.get("relevantDate") != right.get("relevantDate"):
            return False
        # Discovery prices/mileage are not competing historical observations.
        if left.get("dateVerified") != right.get("dateVerified"):
            return False
        fields = ("year", "make", "model", "trim", "drivetrain")
        if left.get("stream") != "historical" or left.get("dateVerified") is True:
            fields += ("mileage", "price")
        if any(left["listing"].get(key) != right["listing"].get(key) for key in fields):
            return True
        return any(left.get(key) != right.get(key) for key in ("materialFacts", "location"))

    def _record(self, observation: dict[str, Any]) -> bool:
        if len(self.observations) >= self.policy.max_observations:
            return False
        identity = observation_identity(observation)
        same_vehicle = [row for row in self.observations if identity is not None and observation_identity(row) == identity]
        same = [row for row in same_vehicle
                if row.get("stream") == observation.get("stream") and row.get("relevantDate") == observation.get("relevantDate")]
        material_conflict = immutable_material_conflicts([*same_vehicle, observation])
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

    def _strong(self, stream: str) -> int:
        return sum(self._assessment(row)["strong"] for row in self.verified[stream].values())

    def _failure_stop(self, reason: str) -> str:
        if reason == "OBSERVATION_LIMIT":
            return reason
        if any(word in reason for word in ("BUDGET", "LIMIT", "RESERVE", "QUOTA", "ACCOUNTING", "CONFIGURATION", "THROTTL")):
            return "BUDGET_OR_QUOTA_LIMITED"
        return "PROVIDER_FAILURE"

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
        for raw in payload.get("observations", []):
            if raw.get("stream") != stream or raw.get("sourceEndpoint") != ("active" if stream == "current" else "recents"):
                raise ValueError("Discovery observation has an inconsistent evidence stream")
            row = self._locate(raw, {**operation, "eventIndex": len(self.events) - 1})
            row["purpose"] = operation["purpose"]
            if stream == "current":
                row["relevantDate"] = self.observed_date
            row["newIdentity"] = self._record(row)
            rows.append(row)
        return rows, payload.get("hasMore", False), payload.get("failure")

    def _verify(self, candidates: Sequence[dict[str, Any]], *, supporting: bool = False) -> str | None:
        if not candidates:
            return None
        candidates = candidates[:self.policy.max_observations - len(self.observations)]
        if not candidates:
            return "OBSERVATION_LIMIT"
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
        for existing in self.centers[1:]:
            if existing["id"] not in self.stream_centers_used[stream]:
                return {**existing, "radiusMiles": min(existing["radiusMiles"], radius)}
        if len(self.centers) - 1 >= self.policy.additional_centers:
            return None
        chosen = self.market_geography.next_center(self.origin, self.centers, endpoint_radius_miles=radius,
                                            outer_boundary_miles=self.policy.boundary)
        if chosen is not None:
            self.centers.append(chosen)
        return chosen

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
            for page_index in range(self.policy.pages_per_center):
                rows, more, failure = self._discover(stream, center, page_index * self.policy.page_size)
                fresh = [row for row in rows if row["newIdentity"]]
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
                    self.stops[stream] = self._failure_stop(failure)
                    return
                if self._strong(stream) >= self.policy.minimum_strong_matches:
                    self.stops[stream] = "SUFFICIENT_STRONG_EVIDENCE"
                    return
                if context_only:
                    self.stops[stream] = "HISTORICAL_BASELINE_SUFFICIENT_CURRENT_CONTEXT_ONLY"
                    return
                if len(self.observations) >= self.policy.max_observations:
                    self.stops[stream] = "OBSERVATION_LIMIT"
                    return
                duplicate_heavy = bool(rows) and 1 - len(fresh) / len(rows) >= self.policy.duplicate_branch_fraction
                if not more or not promising or duplicate_heavy:
                    branch["stopReason"] = "DUPLICATE_HEAVY" if duplicate_heavy else "UNPRODUCTIVE" if not promising else "EXHAUSTED"
                    break
            center = self._next_center(stream)
        self.stops[stream] = "GEOGRAPHIC_SCOPE_LIMITED" if self.origin else "CUSTOMER_LOCATION_UNAVAILABLE"

    def _supporting(self) -> dict[str, Any]:
        self.baseline_frozen = True
        baseline = [copy.deepcopy(row) for stream in self.verified.values() for row in stream.values()]
        def shortlist():
            extras = [row for row in self.observations if row.get("purpose") == "supporting" and row.get("dateVerified")]
            return build_supporting_shortlist(self.target, baseline + extras, subject_material_facts=self.subject_facts,
                evidence_date=self.evidence_date, max_distance_miles=self.policy.boundary,
                policy=SupportingShortlistPolicy(maximum_listings=self.policy.supporting_maximum_listings))
        result = shortlist()
        sufficient = [stream for stream in ("historical", "current") if self._strong(stream) >= self.policy.minimum_strong_matches]
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

    def run(self, *, target: ComparableTarget, current_request: MarketSearchRequest | None,
            historical_request: HistoricalMarketSearchRequest | None, observed_date: str,
            subject_facts: Mapping[str, Any], subject_vin: str | None = None) -> EfficientSearchResult:
        if not self.replay_only:
            from venfour.subject_readiness import SubjectReadinessError, subject_readiness
            issues = subject_readiness(
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
        self.input_digest = _digest(inputs)
        self.inputs = inputs
        saved = self.resumed_transcript
        if saved is None and self.resume_loader is not None:
            saved = self.resume_loader(self.input_digest)
        if saved is not None:
            if saved.get("version") != SEARCH_STRATEGY_VERSION or saved.get("inputDigest") != self.input_digest:
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
        self._search_stream("historical")
        historical_sufficient = self._strong("historical") >= self.policy.minimum_strong_matches
        if historical_sufficient and self.policy.current_context_pages_after_historical == 0:
            self.stops["current"] = "HISTORICAL_BASELINE_SUFFICIENT"
        else:
            self._search_stream("current", context_only=historical_sufficient)
        for stream, candidates in self.verified.items():
            ranked = sorted(candidates.values(), key=lambda row: self._assessment(row)["qualityKey"])
            for index, row in enumerate(ranked):
                row["baselineSelection"] = "SELECTED" if index < 100 else "BASELINE_CANDIDATE_LIMIT"
            self.verified[stream] = {observation_identity(row): row for row in ranked[:100]}
        supporting = self._supporting()
        current = None
        if current_request is not None and self.providers["current"] is not None:
            current = MarketSearchResult(provider=self.providers["current"].name,
                                         request=replace(current_request, radius_miles=self.policy.boundary, result_limit=100),
                                         listings=tuple(listing_from_observation(row) for row in self.verified["current"].values()))
            validate_market_search_result(current)
        historical = None
        if self.historical_template is not None:
            historical = replace(self.historical_template,
                                request=replace(historical_request, radius_miles=self.policy.boundary, result_limit=100),
                                evidence=tuple(_historical_item(row["historicalEvidence"])
                                for row in self.verified["historical"].values()), issues=tuple(self.issues))
            validate_historical_market_search_result(historical)
        for row in self.observations:
            row["assessment"] = self._assessment(row)
        transcript = {"version": SEARCH_STRATEGY_VERSION, "input": inputs, "inputDigest": self.input_digest,
                      "origin": self.origin, "centers": self.centers, "events": self.events,
                      "geography": self.geographic_snapshot, "providers": self.provider_capabilities,
                      "observations": self.observations, "stopReasons": self.stops,
                      "branches": self.branch_state, "usageBefore": self.initial_usage, "usageAfter": self.budget.snapshot(),
                      "supportingIssues": [issue.to_dict() for issue in self.supporting_issues],
                      "historicalTemplate": self.historical_template.to_dict() if self.historical_template else None,
                      "baselineIdentities": {stream: list(rows) for stream, rows in self.verified.items()},
                      "baselineStatus": "SUFFICIENT" if self._strong("historical") >= 9 or self._strong("current") >= 9 else "LIMITED",
                      "supportingEvidence": supporting}
        transcript["digest"] = _digest(transcript)
        if self.replay_only and len(self.events) != len(self.resumed_events):
            raise ValueError("Search transcript contains operations after a deterministic stop")
        return EfficientSearchResult(current, historical, transcript, supporting)


def replay_efficient_search(transcript: Mapping[str, Any]) -> EfficientSearchResult:
    """Re-run recorded decisions and evidence projection without provider access."""

    from venfour.analysis_runs import _historical_request_from_data, _market_request_from_data, _target_from_data

    if not isinstance(transcript, Mapping) or transcript.get("version") != SEARCH_STRATEGY_VERSION:
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
        resumed_transcript=transcript, _replay_only=True,
    ).run(
        target=_target_from_data(inputs["target"]),
        current_request=_market_request_from_data(inputs["currentRequest"]) if inputs["currentRequest"] else None,
        historical_request=_historical_request_from_data(inputs["historicalRequest"]) if inputs["historicalRequest"] else None,
        observed_date=inputs["observedDate"], subject_facts=inputs["subjectFacts"], subject_vin=inputs["subjectVin"],
    )
    if result.transcript != transcript:
        raise ValueError("Efficient-search transcript does not match deterministic replay")
    return result
