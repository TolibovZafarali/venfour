"""Closed aggregate metadata contract; no listing or customer values."""

from __future__ import annotations

import copy
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any


TIERS = ("STRONG", "GOOD", "WEAK", "INELIGIBLE")
REJECTION_CATEGORIES = ("IDENTITY", "CONFIGURATION", "MILEAGE", "DISTANCE", "TEMPORAL", "CONFLICT", "QUALITY", "OTHER")
STOP_REASONS = ("CONTINUE", "EXHAUSTED", "UNPRODUCTIVE", "DUPLICATE_HEAVY", "BUDGET_OR_QUOTA_LIMITED",
    "PROVIDER_FAILURE", "OBSERVATION_LIMIT", "SUFFICIENT_STRONG_EVIDENCE", "GEOGRAPHIC_SCOPE_LIMITED",
    "CUSTOMER_LOCATION_UNAVAILABLE", "HISTORICAL_BASELINE_SUFFICIENT_CURRENT_CONTEXT_ONLY", "INTERRUPTED")
COUNTS = ("returnedRows", "parseableObservations", "recordedObservations", "distinctIdentities", "newIdentities",
    "duplicateObservations", "unidentifiedObservations", "screenedCandidates", "baselineCandidates", "requestAttemptsConsumed")
KEYS = {"version", "kind", "stream", "purpose", "centerId", "pageStart", "requestedRows", *COUNTS,
    "rejectedByCategory", "tierCounts", "historyVerificationNecessary", "scoringCompleted", "stopReason"}


def validate_summary(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != KEYS:
        raise ValueError("Invalid search summary fields")
    if value["version"] != "1" or value["kind"] != "discovery" or value["stream"] not in {"current", "historical"} or value["purpose"] not in {"baseline", "supporting"}:
        raise ValueError("Invalid search summary context")
    center = value["centerId"]
    if center not in {"customer", "alternate"} and not (isinstance(center, str) and re.fullmatch(r"cbsa:[0-9]{5}", center)):
        raise ValueError("Invalid search summary center")
    for key in COUNTS:
        if type(value[key]) is not int or not 0 <= value[key] <= 1000000:
            raise ValueError("Invalid search summary count")
    if type(value["pageStart"]) is not int or not 0 <= value["pageStart"] < 10000 or type(value["requestedRows"]) is not int or not 1 <= value["requestedRows"] <= 50:
        raise ValueError("Invalid search summary page")
    if not (value["recordedObservations"] <= value["parseableObservations"] <= value["returnedRows"] <= value["requestedRows"]):
        raise ValueError("Inconsistent search summary counts")
    if any(value[key] > value["recordedObservations"] for key in ("distinctIdentities", "screenedCandidates", "baselineCandidates")):
        raise ValueError("Inconsistent search summary candidate counts")
    for key, allowed in (("tierCounts", TIERS), ("rejectedByCategory", REJECTION_CATEGORIES)):
        counts = value[key]
        if not isinstance(counts, Mapping) or set(counts) != set(allowed) or any(type(count) is not int or not 0 <= count <= value["recordedObservations"] for count in counts.values()):
            raise ValueError("Invalid search summary categories")
    if sum(value["tierCounts"].values()) != value["recordedObservations"] or value["newIdentities"] + value["duplicateObservations"] + value["unidentifiedObservations"] != value["recordedObservations"]:
        raise ValueError("Inconsistent search summary totals")
    if any(type(value[key]) is not bool for key in ("scoringCompleted", "historyVerificationNecessary")) or value["stopReason"] not in STOP_REASONS:
        raise ValueError("Invalid search summary completion")
    return copy.deepcopy(dict(value))


def _category(reason: str) -> str:
    for category, tokens in (("CONFLICT", ("CONFLICT",)), ("IDENTITY", ("IDENTITY", "SUBJECT_VEHICLE")),
        ("DISTANCE", ("DISTANCE", "LOCATION")), ("MILEAGE", ("MILEAGE",)),
        ("TEMPORAL", ("DATE", "HISTORY", "TEMPORAL")),
        ("CONFIGURATION", ("ENGINE", "BODY", "DRIVE", "TRIM", "MAKE", "MODEL", "YEAR", "FUEL", "TRANSMISSION", "CYLINDER", "DOOR", "CAB", "BED", "EQUIPMENT", "POWERTRAIN")),
        ("QUALITY", ("SCORE", "PRICE", "WEAK", "QUALITY"))):
        if any(token in reason for token in tokens):
            return category
    return "OTHER"


def discovery_summary(operation: Mapping[str, Any], observations: Sequence[Mapping[str, Any]], *, returned_rows: int,
                      parseable_observations: int, request_attempts: int, stop_reason: str = "CONTINUE", scoring_completed: bool = True) -> dict[str, Any]:
    assessments = [row["assessment"] for row in observations]
    rejected = Counter()
    for assessment in assessments:
        if not assessment["verificationEligible"]:
            rejected.update({_category(reason) for reason in assessment["reasonCodes"]})
    tiers = Counter(assessment["tier"] for assessment in assessments)
    center = operation["center"]["id"]
    if center != "customer" and not re.fullmatch(r"cbsa:[0-9]{5}", str(center)):
        center = "alternate"
    unidentified = sum(a["identity"] is None for a in assessments)
    new = sum(row["newIdentity"] and row["assessment"]["identity"] is not None for row in observations)
    screened = sum(assessment["verificationEligible"] for assessment in assessments)
    return validate_summary({"version": "1", "kind": "discovery", "stream": operation["stream"],
        "purpose": operation["purpose"], "centerId": center, "pageStart": operation["start"],
        "requestedRows": operation["rows"], "returnedRows": returned_rows, "parseableObservations": parseable_observations,
        "recordedObservations": len(observations), "distinctIdentities": len({a["identity"] for a in assessments if a["identity"] is not None}),
        "newIdentities": new, "duplicateObservations": len(observations) - new - unidentified, "unidentifiedObservations": unidentified, "screenedCandidates": screened,
        "baselineCandidates": sum(a["baselineEligible"] for a in assessments), "requestAttemptsConsumed": request_attempts,
        "rejectedByCategory": {key: rejected[key] for key in REJECTION_CATEGORIES}, "tierCounts": {key: tiers[key] for key in TIERS},
        "historyVerificationNecessary": operation["stream"] == "historical" and screened > 0,
        "scoringCompleted": scoring_completed, "stopReason": stop_reason})
