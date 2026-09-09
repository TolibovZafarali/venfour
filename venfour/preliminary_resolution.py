"""Bounded, replayable resolution of supported preliminary evidence gaps."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from venfour.comparables import ComparableRankingResult, rank_market_comparables
from venfour.discrepancy import (
    CurrentEvidenceInput, HistoricalEvidenceInput, ValuationDiscrepancyAnalyzer,
    ValuationDiscrepancyRequest, ValuationDiscrepancyResult,
    validate_valuation_discrepancy_request, validate_valuation_discrepancy_result,
)
from venfour.historical_market import HistoricalMarketSearchResult, historical_evidence_to_market_search_result
from venfour.market import MarketSearchResult
from venfour.marketcheck import drivetrain_lookup_failure, validate_drivetrain_lookup_result
from venfour.preliminary_qualification import qualify_preliminary, validate_preliminary_qualification


PRELIMINARY_RESOLUTION_VERSION = "1"
MAX_DISTINCT_PROVIDER_VINS = 9
_DRIVETRAINS = frozenset({"FWD", "RWD", "AWD", "4WD"})
_SCHEMA_PATH = Path(__file__).parents[1] / "schemas/analysis/preliminary-evidence-resolution.schema.json"
Lookup = Callable[..., Mapping[str, Any]]


class PreliminaryResolutionContractError(ValueError):
    """Resolution evidence is inconsistent with its immutable transcript."""


def _validated_lookup(data: Mapping[str, Any]) -> dict[str, Any]:
    try:
        return validate_drivetrain_lookup_result(data)
    except (TypeError, ValueError) as exc:
        raise PreliminaryResolutionContractError("resolution contains invalid provider evidence") from exc


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _text(value: Any) -> str:
    return " ".join(value.split()).casefold() if isinstance(value, str) else ""


def _vin(value: Any) -> str | None:
    normalized = value.strip().upper() if isinstance(value, str) else ""
    return normalized if re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", normalized) else None


def _vehicle(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in ("year", "make", "model")}


def _same_vehicle(row: Mapping[str, Any], identity: Mapping[str, Any]) -> bool:
    return (row.get("year") == identity["year"] and _text(row.get("make")) == _text(identity["make"])
            and _text(row.get("model")) == _text(identity["model"]))


def _resolution_action(check: Mapping[str, Any]) -> str:
    if check["checkCode"] == "SELECTED_MARKET_CONFIGURATION" and check["reasonCode"] == "SELECTED_COMPARABLE_DRIVETRAIN_UNVERIFIED":
        return "BOUNDED_EXISTING_PROVIDER_ENRICHMENT"
    return {
        "CUSTOMER_RESOLVABLE": "EXISTING_CUSTOMER_CONFIRMATION",
        "DOCUMENT_SOURCE_RESOLVABLE": "EXISTING_SOURCE_RECOVERY",
        "PROVIDER_MARKET_DATA": "NO_SUPPORTED_AUTOMATIC_RESOLVER",
        "NOT_CURRENTLY_RESOLVABLE": "NO_SUPPORTED_AUTOMATIC_RESOLVER",
    }[check["resolution"]]


def _check_identity(check: Mapping[str, Any]) -> str:
    return _digest({"checkCode": check["checkCode"], "reasonCode": check["reasonCode"],
                    "resolution": check["resolution"],
                    "sourcePaths": [item["path"] for item in check["sourceEvidence"]]})


def _check_vins(check: Mapping[str, Any]) -> set[str]:
    vins: set[str] = set()

    def visit(value):
        if isinstance(value, Mapping):
            if (vin := _vin(value.get("vin"))) is not None:
                vins.add(vin)
            for child in value.values():
                visit(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                visit(child)

    visit(check["sourceEvidence"])
    return vins


@dataclass(frozen=True)
class PreliminaryResolutionResult:
    current_result: MarketSearchResult | None
    historical_result: HistoricalMarketSearchResult | None
    current_ranking: ComparableRankingResult | None
    historical_ranking: ComparableRankingResult | None
    discrepancy_request: ValuationDiscrepancyRequest
    discrepancy_result: ValuationDiscrepancyResult
    preliminary_qualification: Mapping[str, Any]
    resolution: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "effectiveCurrentMarketResult": self.current_result.to_dict() if self.current_result else None,
            "effectiveHistoricalMarketResult": self.historical_result.to_dict() if self.historical_result else None,
            "currentRanking": self.current_ranking.to_dict() if self.current_ranking else None,
            "historicalRanking": self.historical_ranking.to_dict() if self.historical_ranking else None,
            "discrepancyRequest": self.discrepancy_request.to_dict(),
            "discrepancyResult": self.discrepancy_result.to_dict(),
            "preliminaryQualification": copy.deepcopy(dict(self.preliminary_qualification)),
            "preliminaryResolution": copy.deepcopy(dict(self.resolution)),
        }


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(_SCHEMA_PATH.read_text(encoding="utf-8")))


def validate_preliminary_resolution(data: Mapping[str, Any]) -> dict[str, Any]:
    errors = sorted(_validator().iter_errors(data), key=lambda error: str(list(error.path)))
    if errors:
        raise PreliminaryResolutionContractError("; ".join(error.message for error in errors))
    attempts = {item["attemptId"]: item for item in data["attempts"]}
    if len(attempts) != len(data["attempts"]):
        raise PreliminaryResolutionContractError("resolution attempt identities must be unique")
    lookups = [item for item in data["attempts"] if item["sourceKind"] == "EXISTING_PROVIDER"]
    vins = [item["identity"]["vin"] for item in lookups]
    if len(vins) != len(set(vins)) or len(vins) > MAX_DISTINCT_PROVIDER_VINS:
        raise PreliminaryResolutionContractError("resolution exceeds the distinct VIN lookup budget")
    requests = 0
    for item in lookups:
        result = _validated_lookup(item["lookupResult"])
        if result["vin"] != item["identity"]["vin"] or not _same_vehicle(result["vehicle"], item["identity"]):
            raise PreliminaryResolutionContractError("lookup evidence identity does not match the attempted vehicle")
        if result["status"] != item["status"] or result["reasonCode"] != item["reasonCode"]:
            raise PreliminaryResolutionContractError("lookup outcome does not match its attempt")
        requests += result["providerRequestCount"]
    if data["budget"]["providerVinsAttempted"] != len(vins) or data["budget"]["providerRequestCount"] != requests:
        raise PreliminaryResolutionContractError("resolution budget does not match recorded attempts")
    for check in data["checks"]:
        if any(identity not in attempts for identity in check["attemptIds"]):
            raise PreliminaryResolutionContractError("resolution check references an unknown attempt")
        if check["resolution"] == "PROVIDER_MARKET_DATA" and check["action"] == "EXISTING_CUSTOMER_CONFIRMATION":
            raise PreliminaryResolutionContractError("provider evidence cannot become customer homework")
    for update in data["evidenceUpdates"]:
        attempt = attempts.get(update["sourceAttemptId"])
        if attempt is None or attempt["status"] != "RESOLVED" or attempt["drivetrain"] != update["drivetrain"]:
            raise PreliminaryResolutionContractError("evidence update requires a matching resolved attempt")
        if attempt["identity"] != update["identity"] or update["evidenceIdentity"] != attempt["evidenceIdentity"]:
            raise PreliminaryResolutionContractError("evidence update is not bound to its source identity")
    return copy.deepcopy(dict(data))


def _saved_facts(
    identity: Mapping[str, Any], current: MarketSearchResult | None,
    historical: HistoricalMarketSearchResult | None, source: Mapping[str, Any] | None,
    supplied: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    facts: list[dict[str, Any]] = []
    conflict = False

    def inspect(row: Mapping[str, Any], kind: str, path: str) -> None:
        nonlocal conflict
        if _vin(row.get("vin")) != identity["vin"] or row.get("drivetrain") not in _DRIVETRAINS:
            return
        if not _same_vehicle(row, identity):
            conflict = True
            return
        facts.append({"sourceKind": kind, "sourcePath": path, "vin": identity["vin"],
                      **_vehicle(row), "drivetrain": row["drivetrain"]})

    if current:
        for index, listing in enumerate(current.listings):
            inspect(listing.to_dict(), "CURRENT_MARKET_EVIDENCE", f"$.currentMarketResult.listings[{index}].drivetrain")
    if historical:
        for index, item in enumerate(historical.evidence):
            inspect(item.listing.to_dict(), "HISTORICAL_MARKET_EVIDENCE", f"$.historicalMarketResult.evidence[{index}].listing.drivetrain")
    if source and source.get("schemaVersion") == "2":
        source_vehicle = source.get("vehicle") or {}
        if any((source_vehicle.get("drivetrainSource") or {}).values()):
            inspect(source_vehicle, "SOURCE_REPORT", "$.sourceReport.vehicle.drivetrain")
        for index, row in enumerate(source.get("comparables") or []):
            if row.get("sourceReferences"):
                inspect(row, "SOURCE_REPORT", f"$.sourceReport.comparables[{index}].drivetrain")
    for index, row in enumerate(supplied):
        inspect({"vin": row["vin"], **row["vehicle"], "drivetrain": row["drivetrain"]},
                "SAVED_EXPLICIT_EVIDENCE", f"$.savedEvidence[{index}].drivetrain")
    return facts, conflict or len({item["drivetrain"] for item in facts}) > 1


def _apply_drivetrain(
    current: MarketSearchResult | None, historical: HistoricalMarketSearchResult | None,
    identity: Mapping[str, Any], drivetrain: str,
) -> tuple[MarketSearchResult | None, HistoricalMarketSearchResult | None, list[str]]:
    paths: list[str] = []

    def project(listing, path):
        if (_vin(listing.vin) == identity["vin"] and listing.drivetrain is None
                and _same_vehicle(listing.to_dict(), identity)):
            paths.append(path)
            return replace(listing, drivetrain=drivetrain, drivetrain_recorded=True)
        return listing

    if current:
        current = replace(current, listings=tuple(project(listing, f"$.currentMarketResult.listings[{index}].drivetrain")
                                                  for index, listing in enumerate(current.listings)))
    if historical:
        historical = replace(historical, evidence=tuple(replace(item, listing=project(item.listing, f"$.historicalMarketResult.evidence[{index}].listing.drivetrain"))
                                                       for index, item in enumerate(historical.evidence)))
    return current, historical, paths


def resolve_preliminary_evidence(
    *, base_request: ValuationDiscrepancyRequest,
    current_result: MarketSearchResult | None,
    historical_result: HistoricalMarketSearchResult | None,
    current_observed_date: str | None,
    source_report: Mapping[str, Any] | None,
    evidence_context: Mapping[str, Any],
    lookup: Lookup | None = None,
    saved_evidence: Sequence[Mapping[str, Any]] = (),
    analyzer: ValuationDiscrepancyAnalyzer | None = None,
    market_search_status: str | None = None,
) -> PreliminaryResolutionResult:
    """Resolve supported missing facts with fixed identity and request budgets.

    No lookup receives an insurer amount, price target, URL, or inferred trim.
    Printed source facts and customer facts remain immutable throughout the run.
    """
    saved = copy.deepcopy(list(saved_evidence))
    for item in saved:
        _validated_lookup(item)
        if item["status"] != "RESOLVED":
            raise PreliminaryResolutionContractError("supplied saved evidence requires an explicit resolved provider observation")
    inputs = {"resolutionVersion": PRELIMINARY_RESOLUTION_VERSION, "baseDiscrepancyRequest": base_request.to_dict(),
              "currentMarketResult": current_result.to_dict() if current_result else None,
              "historicalMarketResult": historical_result.to_dict() if historical_result else None,
              "currentObservedDate": current_observed_date, "sourceReport": source_report,
              "evidenceContext": evidence_context, "savedEvidence": saved}
    if market_search_status is not None:
        inputs["marketSearchStatus"] = market_search_status
    original_current, original_historical = current_result, historical_result
    attempts: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    checks: dict[str, dict[str, Any]] = {}
    visited: set[str] = set()
    provider_vins: set[str] = set()
    engine = analyzer if analyzer is not None else ValuationDiscrepancyAnalyzer()

    def evaluate():
        current_ranking = rank_market_comparables(base_request.loss_vehicle, current_result, scoring_version="2") if current_result else None
        historical_ranking = (rank_market_comparables(base_request.loss_vehicle, historical_evidence_to_market_search_result(historical_result), scoring_version="2")
                              if historical_result and historical_result.coverage.status == "SUPPORTED" and historical_result.listing_count else None)
        request = replace(base_request,
                          current_evidence=CurrentEvidenceInput(current_ranking, current_observed_date) if current_ranking else None,
                          historical_evidence=HistoricalEvidenceInput(historical_result, historical_ranking) if historical_result else None)
        validate_valuation_discrepancy_request(request)
        result = engine.analyze(request)
        if not isinstance(result, ValuationDiscrepancyResult):
            raise PreliminaryResolutionContractError("discrepancy analyzer returned an invalid result type")
        validate_valuation_discrepancy_result(result)
        qualification = qualify_preliminary(source_report=source_report, evidence_context=evidence_context,
                                            discrepancy_request=request.to_dict(), discrepancy_result=result.to_dict(),
                                            current_ranking=current_ranking.to_dict() if current_ranking else None,
                                            historical_ranking=historical_ranking.to_dict() if historical_ranking else None,
                                            market_search_status=market_search_status)
        return current_ranking, historical_ranking, request, result, qualification

    state = evaluate()
    initial_qualification_digest = state[4]["inputDigest"]

    def remember_checks(qualification: Mapping[str, Any]) -> None:
        validate_preliminary_qualification(qualification)
        for check in qualification["unresolvedMaterialChecks"]:
            check_id = _check_identity(check)
            if check_id in checks:
                checks[check_id].update(copy.deepcopy(check))
                checks[check_id]["qualificationInputDigest"] = qualification["inputDigest"]
                continue
            prior_attempts = [item["attemptId"] for item in attempts
                              if _resolution_action(check) == "BOUNDED_EXISTING_PROVIDER_ENRICHMENT"
                              and item["identity"]["vin"] in _check_vins(check)]
            checks[check_id] = {"checkId": check_id, **copy.deepcopy(check), "action": _resolution_action(check),
                                "qualificationInputDigest": qualification["inputDigest"],
                                "status": "UNRESOLVED", "attemptIds": prior_attempts, "reasonCodes": []}

    def record(identity, source_kind, status, reason, *, facts=(), lookup_result=None, drivetrain=None):
        attempt_id = _digest({"capability": "COMPARABLE_DRIVETRAIN", "identity": identity, "sourceKind": source_kind})
        evidence_identity = _digest({"identity": identity, "drivetrain": drivetrain, "facts": list(facts),
                                     "providerEvidenceDigest": lookup_result["evidenceDigest"] if lookup_result else None}) if status == "RESOLVED" else None
        attempt = {"attemptId": attempt_id, "capability": "COMPARABLE_DRIVETRAIN", "identity": dict(identity),
                   "sourceKind": source_kind, "status": status, "reasonCode": reason, "drivetrain": drivetrain,
                   "savedFacts": list(facts), "lookupResult": copy.deepcopy(lookup_result), "evidenceIdentity": evidence_identity}
        attempts.append(attempt)
        for check in checks.values():
            if (check["action"] == "BOUNDED_EXISTING_PROVIDER_ENRICHMENT" and check["status"] == "UNRESOLVED"
                    and identity["vin"] in _check_vins(check)):
                check["attemptIds"].append(attempt_id)
        return attempt

    while True:
        remember_checks(state[4])
        result = state[3].to_dict()
        summary = result.get("historicalExternalSummary") if result["evidenceBasis"] == "LOSS_DATE_HISTORICAL" else result.get("currentExternalSummary")
        selected = (summary or {}).get("selectedEvidence") or []
        targets = []
        if base_request.loss_vehicle.drivetrain is not None:
            for row in selected:
                vin = _vin(row.get("vin"))
                if row.get("drivetrain") is None and vin and vin not in visited:
                    targets.append({"vin": vin, **_vehicle(row)})
        if not targets:
            break
        changed = False
        for identity in targets:
            vin = identity["vin"]
            if vin in visited:
                continue
            visited.add(vin)
            facts, conflict = _saved_facts(identity, original_current, original_historical, source_report, saved)
            values = {fact["drivetrain"] for fact in facts}
            saved_status = "CONFLICT" if conflict else "RESOLVED" if values else "UNAVAILABLE"
            saved_reason = "SAVED_EXPLICIT_DRIVETRAIN_CONFLICT" if conflict else "SAVED_EXPLICIT_DRIVETRAIN_FOUND" if values else "NO_SAVED_EXPLICIT_DRIVETRAIN"
            attempt = record(identity, "SAVED_EVIDENCE", saved_status, saved_reason, facts=facts,
                             drivetrain=next(iter(values)) if saved_status == "RESOLVED" else None)
            if saved_status == "UNAVAILABLE" and lookup is not None and len(provider_vins) < MAX_DISTINCT_PROVIDER_VINS:
                provider_vins.add(vin)
                try:
                    raw_result = lookup(vin, year=identity["year"], make=identity["make"], model=identity["model"])
                    lookup_result = _validated_lookup(raw_result)
                    if lookup_result["vin"] != vin or not _same_vehicle(lookup_result["vehicle"], identity):
                        raise PreliminaryResolutionContractError("provider returned an unrelated vehicle")
                except Exception as exc:
                    reason = "PROVIDER_LOOKUP_TIMEOUT" if isinstance(exc, TimeoutError) else "PROVIDER_LOOKUP_FAILED"
                    lookup_result = drivetrain_lookup_failure(vin, year=identity["year"], make=identity["make"], model=identity["model"], reason_code=reason)
                attempt = record(identity, "EXISTING_PROVIDER", lookup_result["status"], lookup_result["reasonCode"],
                                 lookup_result=lookup_result, drivetrain=lookup_result["drivetrain"])
            elif saved_status == "UNAVAILABLE":
                attempt = record(identity, "RESOLUTION_POLICY", "UNAVAILABLE",
                                 "PROVIDER_VIN_BUDGET_EXHAUSTED" if lookup is not None else "EXISTING_PROVIDER_RESOLVER_UNAVAILABLE")
            if attempt["status"] == "RESOLVED":
                current_result, historical_result, paths = _apply_drivetrain(current_result, historical_result, identity, attempt["drivetrain"])
                if paths:
                    updates.append({"identity": identity, "field": "drivetrain", "drivetrain": attempt["drivetrain"],
                                    "sourceAttemptId": attempt["attemptId"], "evidenceIdentity": attempt["evidenceIdentity"], "targetPaths": paths})
                    changed = True
        if not changed:
            break
        state = evaluate()
    remember_checks(state[4])
    remaining = {_check_identity(check) for check in state[4]["unresolvedMaterialChecks"]}
    for check_id, check in checks.items():
        check["status"] = "UNRESOLVED" if check_id in remaining else "RESOLVED"
        check["attemptIds"] = list(dict.fromkeys(check["attemptIds"]))
        check["reasonCodes"] = (["MATERIAL_GAP_REMAINS_AFTER_BOUNDED_RESOLUTION"] if check_id in remaining
                                else ["MATERIAL_GAP_REMOVED_BY_RECOMPUTED_EVIDENCE"])
        if not check["attemptIds"]:
            check["reasonCodes"].append("EXISTING_SOURCE_OR_CUSTOMER_ROUTE_RETAINED" if check["resolution"] in {"CUSTOMER_RESOLVABLE", "DOCUMENT_SOURCE_RESOLVABLE"}
                                      else "NO_SUPPORTED_AUTOMATIC_RESOLVER_FOR_CHECK")
    resolution = validate_preliminary_resolution({
        **({"marketSearchStatus": market_search_status} if market_search_status is not None else {}),
        "resolutionVersion": PRELIMINARY_RESOLUTION_VERSION, "inputDigest": _digest(inputs),
        "initialQualificationDigest": initial_qualification_digest, "finalQualificationDigest": state[4]["inputDigest"],
        "budget": {"maxDistinctProviderVins": MAX_DISTINCT_PROVIDER_VINS, "providerVinsAttempted": len(provider_vins),
                   "providerRequestCount": sum(attempt["lookupResult"]["providerRequestCount"] for attempt in attempts if attempt["lookupResult"])},
        "checks": list(checks.values()), "attempts": attempts, "evidenceUpdates": updates, "savedEvidence": saved,
    })
    return PreliminaryResolutionResult(current_result, historical_result, *state[:4], state[4], resolution)


def replay_preliminary_resolution(
    *, resolution: Mapping[str, Any], base_request: ValuationDiscrepancyRequest,
    current_result: MarketSearchResult | None, historical_result: HistoricalMarketSearchResult | None,
    current_observed_date: str | None, source_report: Mapping[str, Any] | None,
    evidence_context: Mapping[str, Any],
) -> PreliminaryResolutionResult:
    """Replay only recorded lookup results, without access to a provider."""
    ledger = validate_preliminary_resolution(resolution)
    expected = [item for item in ledger["attempts"] if item["sourceKind"] == "EXISTING_PROVIDER"]
    consumed = 0

    def lookup(vin, *, year, make, model):
        nonlocal consumed
        identity = {"vin": vin, "year": year, "make": make, "model": model}
        if consumed >= len(expected) or expected[consumed]["identity"] != identity:
            raise PreliminaryResolutionContractError("resolution replay requested an unrecorded lookup")
        result = expected[consumed]["lookupResult"]
        consumed += 1
        return result

    resolver_available = any(item["sourceKind"] == "EXISTING_PROVIDER" or item["reasonCode"] == "PROVIDER_VIN_BUDGET_EXHAUSTED" for item in ledger["attempts"])
    replay = resolve_preliminary_evidence(base_request=base_request, current_result=current_result,
                                         historical_result=historical_result, current_observed_date=current_observed_date,
                                         source_report=source_report, evidence_context=evidence_context,
                                         lookup=lookup if resolver_available else None, saved_evidence=ledger["savedEvidence"],
                                         market_search_status=ledger.get("marketSearchStatus"))
    if consumed != len(expected) or replay.resolution != ledger:
        raise PreliminaryResolutionContractError("resolution transcript does not match deterministic replay")
    return replay
