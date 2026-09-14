"""Frozen free-result policy; contextual listings never enter strict valuation.

This module consumes completed, normalized evidence only. It has no transport,
lookup, search, payment, or persistence authority.
"""

from __future__ import annotations

import copy
import json
import math
import re
from collections.abc import Mapping
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from venfour.comparable_evidence import observation_identity
from venfour.discrepancy import _exact_price_dispersion


PRELIMINARY_RESULT_VERSION = "1"
# Reuse the scorer's existing CLOSE / MODERATE mileage categories, not a price
# adjustment. The strict scorer and supporting-only mileage limits are intact.
ESTIMATE_MAX_MILEAGE_DIFFERENCE = 10_000
CONTEXT_MAX_MILEAGE_DIFFERENCE = 25_000
_SCHEMA = Path(__file__).parents[1] / "schemas/analysis/preliminary-result.schema.json"


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _valid_vin(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", value.strip().upper()) is not None


def _date(value: Any) -> bool:
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _cents(value: int | float) -> int:
    return int((Decimal(str(value)) * 100).to_integral_value(rounding=ROUND_HALF_UP))


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(_SCHEMA.read_text()), format_checker=FormatChecker())


def validate_preliminary_result(data: Mapping[str, Any]) -> dict[str, Any]:
    errors = sorted(_validator().iter_errors(data), key=lambda error: str(list(error.path)))
    if errors:
        raise ValueError("; ".join(error.message for error in errors))
    outcome = data["outcome"]
    rows = data["listings"]
    if data["sampleSize"] != len(rows) or len({row["identity"] for row in rows}) != len(rows):
        raise ValueError("preliminary sample must contain distinct vehicle identities")
    if outcome == "INSUFFICIENT":
        if rows or data["evidenceBasis"] != "NONE" or data["evidenceDate"] is not None:
            raise ValueError("insufficient evidence cannot claim a priced sample")
    elif not rows or data["evidenceBasis"] == "NONE" or not _date(data["evidenceDate"]):
        raise ValueError("priced evidence requires a sample and an explicit date basis")
    expected_span = ({"lowCents": min(row["askingPriceCents"] for row in rows),
                      "highCents": max(row["askingPriceCents"] for row in rows)} if rows else None)
    for key, expected_outcome in (("estimatedRange", "ESTIMATE"), ("listingPriceSpan", "LISTING_CONTEXT")):
        if data[key] != (expected_span if outcome == expected_outcome else None):
            raise ValueError("preliminary range must equal its selected evidence span and outcome")
    if outcome == "ESTIMATE" and len(rows) < 3:
        raise ValueError("a preliminary estimate requires at least three independent vehicles")
    if outcome == "ESTIMATE" and any(not row["identity"].startswith("vin:")
                                     or not _valid_vin(row["identity"][4:]) for row in rows):
        raise ValueError("a preliminary estimate requires distinct structurally valid VINs")
    comparison = data["insurerComparison"]
    if comparison is not None:
        if outcome != "ESTIMATE" or data["evidenceBasis"] != "LOSS_DATE_HISTORICAL":
            raise ValueError("insurer comparison requires a supported loss-date estimate")
        value = comparison["insurerValueCents"]
        position = ("BELOW_RANGE" if value < expected_span["lowCents"] else
                    "ABOVE_RANGE" if value > expected_span["highCents"] else "WITHIN_RANGE")
        if comparison["position"] != position:
            raise ValueError("insurer position must match the supported range")
    return copy.deepcopy(dict(data))


def _context_candidate(observation: Mapping[str, Any], *, target: Mapping[str, Any],
                       subject: Mapping[str, Any], expected_date: str | None,
                       stream: str) -> dict[str, Any] | None:
    row = _mapping(observation.get("listing"))
    assessment = _mapping(observation.get("assessment"))
    location = _mapping(observation.get("location"))
    facts = _mapping(observation.get("materialFacts"))
    identity = observation_identity(observation)
    if (observation.get("purpose") != "baseline" or identity is None
            or observation.get("conflicted") is True or observation.get("conflicts")
            or observation.get("dateVerified") is not True
            or not _date(expected_date) or observation.get("relevantDate") != expected_date
            or observation.get("priceVerified") is not True
            or not _finite(row.get("price")) or row["price"] <= 0
            or not _finite(row.get("mileage")) or row["mileage"] < 0
            or not _finite(target.get("mileage"))
            or location.get("verified") is not True
            or location.get("distanceOrigin") != "CUSTOMER_POSTAL_AREA"
            or not _finite(row.get("distanceMiles")) or not 0 <= row["distanceMiles"] <= 250
            or observation.get("sourceEndpoint") != ("active" if stream == "current" else "history")):
        return None
    if subject.get("vin") and str(subject["vin"]).casefold() == str(row.get("vin", "")).casefold():
        return None
    comparisons = assessment.get("configurationComparisons") or []
    by_field = {item["field"]: item for item in comparisons}
    # No score threshold is used for context. A confirmed material conflict
    # remains disqualifying; absent facts remain uncertainty, never match credit.
    if any(item.get("status") == "CONFLICT" for item in comparisons):
        return None
    if any(by_field.get(field, {}).get("status") != "MATCH" for field in ("year", "make", "model", "trim")):
        return None
    if "CYLINDERS_ENGINE_CONFLICT" in assessment.get("reasonCodes", []):
        return None
    gap = abs(row["mileage"] - target["mileage"])
    if gap > CONTEXT_MAX_MILEAGE_DIFFERENCE:
        return None
    limitations: list[str] = []
    vehicle_identity_verified = _valid_vin(row.get("vin"))
    if not vehicle_identity_verified:
        limitations.append("A valid VIN was unavailable, so this listing may repeat another vehicle.")
    if gap:
        direction = "higher" if row["mileage"] > target["mileage"] else "lower"
        limitations.append(f"Mileage is {gap:,.0f} miles {direction} than your vehicle; no mileage adjustment was applied.")
    premium_unresolved = any((facts.get(field) is True or subject.get(field) is True)
                             and facts.get(field) != subject.get(field)
                             for field in ("certified", "warranty"))
    if facts.get("certified") is True and subject.get("certified") is not True:
        limitations.append("This listing is certified; its certification benefits and price effect are not matched to your vehicle.")
    elif subject.get("certified") is True and facts.get("certified") is not True:
        limitations.append("This listing does not establish matching certification benefits.")
    if premium_unresolved and not any("certif" in item for item in limitations):
        limitations.append("Warranty benefits may differ; no price adjustment was assumed.")
    unknowns = {item.get("field") for item in comparisons if item.get("status") == "UNRESOLVED"
                and (item.get("subject") is not None or item.get("listing") is not None)}
    if unknowns or assessment.get("unresolvedEstimateFacts"):
        limitations.append("Some equipment or powertrain details could not be fully matched.")
    if "MATERIAL_EQUIPMENT_UNKNOWN" in assessment.get("reasonCodes", []):
        limitations.append("Optional equipment may differ; no equipment adjustment was assumed.")
    display = {
        "identity": identity, "year": row["year"], "make": row["make"], "model": row["model"],
        "trim": row.get("trim"), "askingPriceCents": _cents(row["price"]), "mileage": row["mileage"],
        "distanceMiles": row["distanceMiles"], "certified": facts.get("certified"),
        "source": row["source"], "listingUrl": row.get("listingUrl"), "limitations": limitations,
    }
    return {"display": display, "observation": observation, "gap": gap,
            "estimateSuitable": (assessment.get("baselineEligible") is True
                                  and assessment.get("tier") in {"STRONG", "GOOD"}
                                  and vehicle_identity_verified and not premium_unresolved
                                  and gap <= ESTIMATE_MAX_MILEAGE_DIFFERENCE),
            "order": (len(unknowns), gap, row["distanceMiles"], identity)}


def build_preliminary_result(*, market_search: Mapping[str, Any],
                             discrepancy_result: Mapping[str, Any],
                             discrepancy_request: Mapping[str, Any]) -> dict[str, Any] | None:
    """Project one completed free search without changing its strict outputs.

    The insurer value is read only after evidence selection and range formation.
    Selected prices are unchanged asking prices, not mileage-adjusted estimates.
    """
    if set(market_search.get("stopReasons", {}).values()) & {
        "PROVIDER_FAILURE", "BUDGET_OR_QUOTA_LIMITED", "OBSERVATION_LIMIT",
    }:
        return None
    inputs = market_search["input"]
    target = discrepancy_request["lossVehicle"]
    subject = inputs["subjectFacts"]
    policy = discrepancy_result["policy"]
    streams: dict[str, list[dict[str, Any]]] = {}
    for stream in ("historical", "current"):
        expected_date = discrepancy_request["lossDate"] if stream == "historical" else inputs["observedDate"]
        candidates = [_context_candidate(observation, target=target, subject=subject,
                                        expected_date=expected_date, stream=stream)
                      for observation in market_search["observations"] if observation.get("stream") == stream]
        unique: dict[str, dict[str, Any]] = {}
        conflicting: set[str] = set()
        for item in sorted((item for item in candidates if item), key=lambda item: item["order"]):
            identity = item["display"]["identity"]
            previous = unique.get(identity)
            if previous and previous["display"]["askingPriceCents"] != item["display"]["askingPriceCents"]:
                conflicting.add(identity)
            unique.setdefault(identity, item)
        streams[stream] = [item for identity, item in unique.items() if identity not in conflicting]

    outcome = "INSUFFICIENT"
    basis = "NONE"
    selected: list[dict[str, Any]] = []
    reasons: list[str] = []
    # Reuse the existing rank-selected, bounded, independent baseline sample.
    # Never select a new favorable subset by looking at prices or the offer.
    for stream in ("historical", "current"):
        from venfour.subject_readiness import free_estimate_ambiguity
        if free_estimate_ambiguity(subject, [item["observation"] for item in streams[stream]]):
            continue
        summary = _mapping(discrepancy_result.get(f"{stream}ExternalSummary"))
        strict = summary.get("selectedEvidence") or []
        lookup = {item["display"]["identity"]: item for item in streams[stream]}
        selected_items = [lookup.get(observation_identity({"listing": row})) for row in strict]
        if not max(3, policy["minimumIndependentCount"]) <= len(strict) <= 9:
            continue
        if not all(item is not None and item["estimateSuitable"] for item in selected_items):
            continue
        # A missing subject specification cannot justify combining known
        # incompatible listing variants into one value estimate.
        from venfour.vehicle_specs import comparison
        material_conflict = False
        for index, left in enumerate(selected_items):
            for right in selected_items[index + 1:]:
                left_facts = _mapping(left["observation"].get("materialFacts"))
                right_facts = _mapping(right["observation"].get("materialFacts"))
                for field in ("bodyType", "bodySubtype", "cabType", "bedLength", "doors",
                              "engine", "fuelType", "transmission", "cylinders", "powertrain"):
                    if comparison(field, left_facts.get(field), right_facts.get(field),
                                  subject=left_facts, candidate=right_facts)["status"] == "CONFLICT":
                        material_conflict = True
                if comparison("drivetrain", left["observation"]["listing"].get("drivetrain"),
                              right["observation"]["listing"].get("drivetrain"))["status"] == "CONFLICT":
                    material_conflict = True
        if material_conflict:
            continue
        if any(item["display"]["askingPriceCents"] != row["priceCents"] for item, row in zip(selected_items, strict)):
            continue
        prices = [item["display"]["askingPriceCents"] for item in selected_items]
        median, mad, central_half = _exact_price_dispersion(prices)
        # A robust median can tolerate one extreme price; a displayed min/max
        # range cannot hide that endpoint. Wide spans remain listing context.
        full_span = max(prices) - min(prices)
        if median <= 0 or max(mad, central_half, full_span) * 10_000 >= policy["highDispersionBasisPoints"] * median:
            continue
        selected = selected_items
        outcome = "ESTIMATE"
        basis = "LOSS_DATE_HISTORICAL" if stream == "historical" else "CURRENT_MARKET"
        reasons = ["EXISTING_QUALIFIED_SAMPLE_WITH_SIMILAR_MILEAGE_AND_BOUNDED_DISPERSION"]
        break
    if not selected:
        # Current and loss-date prices never share a sample or price span.
        for stream in ("current", "historical"):
            if streams[stream]:
                selected = streams[stream][:min(9, policy["maxComparisonSet"])]
                outcome = "LISTING_CONTEXT"
                basis = "CURRENT_MARKET" if stream == "current" else "LOSS_DATE_HISTORICAL"
                reasons = ["RELEVANT_LISTINGS_DO_NOT_SUPPORT_SUBJECT_VALUE_ESTIMATE"]
                break
    rows = [item["display"] for item in selected]
    limitations = ["Asking prices are not completed sale prices or a guaranteed settlement."] if rows else [
        "The completed search did not produce usable market evidence for this vehicle."]
    if basis == "CURRENT_MARKET":
        limitations.append("These listings reflect current inventory, not verified prices on the date of loss.")
    if outcome == "LISTING_CONTEXT":
        limitations.append("The number of listings or their differences do not support a value estimate for your vehicle.")
    if any(not _valid_vin(item["observation"]["listing"].get("vin")) for item in selected):
        limitations.append("Some listings lack a valid VIN, so they cannot establish an independent vehicle count.")
    if any(item["gap"] > ESTIMATE_MAX_MILEAGE_DIFFERENCE for item in selected):
        limitations.append("The available vehicles have substantially different mileage; no mileage adjustment was applied.")
    if any(item["display"]["certified"] is True and subject.get("certified") is not True for item in selected):
        limitations.append("A certified listing may include different benefits; no certification adjustment was assumed.")
    if any(any("fully matched" in limitation for limitation in row["limitations"]) for row in rows):
        limitations.append("Some equipment or powertrain details remain unverified.")
    span = ({"lowCents": min(row["askingPriceCents"] for row in rows),
             "highCents": max(row["askingPriceCents"] for row in rows)} if rows else None)
    comparison = None
    offer = discrepancy_request.get("cccVehicleValuation")
    if outcome == "ESTIMATE" and basis == "LOSS_DATE_HISTORICAL" and _finite(offer) and offer > 0:
        value = _cents(offer)
        comparison = {"insurerValueCents": value,
                      "position": "BELOW_RANGE" if value < span["lowCents"] else
                                  "ABOVE_RANGE" if value > span["highCents"] else "WITHIN_RANGE"}
    return validate_preliminary_result({
        "version": PRELIMINARY_RESULT_VERSION, "outcome": outcome, "evidenceBasis": basis,
        "evidenceDate": (discrepancy_request["lossDate"] if basis == "LOSS_DATE_HISTORICAL" else
                         inputs["observedDate"] if basis == "CURRENT_MARKET" else None),
        "sampleSize": len(rows), "estimatedRange": span if outcome == "ESTIMATE" else None,
        "listingPriceSpan": span if outcome == "LISTING_CONTEXT" else None,
        "listings": rows, "limitations": limitations, "reasonCodes": reasons or ["NO_USABLE_PRICED_EVIDENCE"],
        "insurerComparison": comparison,
    })
