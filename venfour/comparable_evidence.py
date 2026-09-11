"""Strict evidence qualification alongside the immutable comparable scorer.

The market baseline never reads price upside when assessing similarity. The
separate supporting shortlist can prefer asking prices only among observations
with identical, documented quality keys. Neither function accepts an offer.
"""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from statistics import median
from typing import Any

from venfour.comparables import ComparableContractError, ComparableTarget, rank_market_comparables
from venfour.market import MarketContractError, MarketDealer, MarketListing, MarketSearchRequest, MarketSearchResult


EVIDENCE_QUALIFICATION_VERSION = "1"
SUPPORTING_EVIDENCE_VERSION = "1"
_BODY_FIELDS = ("bodySubtype", "cabType", "bedLength", "doors")
_POWERTRAIN_FIELDS = ("engine", "fuelType", "transmission", "cylinders")
_PREMIUM_FIELDS = ("certified", "warranty")
_SIZE_CATEGORIES = {"subcompact", "compact", "midsize", "mid-size", "mid size", "full-size", "full size", "large", "small"}
_TRUCK_BODY_TYPES = {"truck", "pickup", "pickup truck"}
_REDUNDANT_DOOR_COUNTS = {"sedan": "4", "coupe": "2", "convertible": "2"}
_SUPPORTING_MAXIMUM_MILEAGE_GAP = 5_000
_SUPPORTING_MAXIMUM_MILEAGE_FRACTION = 0.10


def _text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return " ".join(value.split()).casefold()


def _fact(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return str(value)
    return _text(value)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _equipment(value: Any) -> tuple[str, ...] | None:
    if not isinstance(value, (tuple, list)):
        return None
    normalized = tuple(_text(item) for item in value)
    if any(item is None for item in normalized):
        return None
    return tuple(sorted(set(normalized)))


def observation_identity(observation: Mapping[str, Any]) -> str | None:
    listing = _mapping(observation.get("listing"))
    vin = _text(listing.get("vin"))
    if vin is not None:
        return f"vin:{vin}"
    source, listing_id = _text(listing.get("source")), _text(listing.get("sourceListingId"))
    return f"listing:{source}:{listing_id}" if source and listing_id else None


def listing_from_observation(observation: Mapping[str, Any]) -> MarketListing:
    """Project a sidecar to the existing unmodified canonical listing contract."""

    listing = _mapping(observation.get("listing"))
    dealer_data = listing.get("dealer")
    dealer = None
    if isinstance(dealer_data, Mapping):
        dealer = MarketDealer(
            name=dealer_data.get("name"), city=dealer_data.get("city"),
            state=dealer_data.get("state"), postal_code=dealer_data.get("postalCode"),
        )
    return MarketListing(
        source=listing["source"], year=listing["year"], make=listing["make"],
        model=listing["model"], price=listing["price"],
        source_listing_id=listing.get("sourceListingId"), listing_url=listing.get("listingUrl"),
        trim=listing.get("trim"), vin=listing.get("vin"), mileage=listing.get("mileage"),
        dealer=dealer, distance_miles=listing.get("distanceMiles"),
        drivetrain=listing.get("drivetrain"), drivetrain_recorded="drivetrain" in listing,
    )


def _configuration_covers(
    subject: Mapping[str, Any], candidate: Mapping[str, Any], field: str,
) -> bool:
    """A generic trim label alone cannot certify material configuration."""

    fingerprint = _text(subject.get("configurationFingerprint"))
    return bool(
        fingerprint
        and fingerprint == _text(candidate.get("configurationFingerprint"))
        and subject.get("configurationVerified") is True
        and candidate.get("configurationVerified") is True
        and isinstance(subject.get("configurationFields"), (list, tuple))
        and isinstance(candidate.get("configurationFields"), (list, tuple))
        and field in subject["configurationFields"]
        and field in candidate["configurationFields"]
    )


def _valid_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def assess_observation(
    target: ComparableTarget,
    observation: Mapping[str, Any],
    *,
    subject_material_facts: Mapping[str, Any] | None = None,
    evidence_date: str | None = None,
    max_distance_miles: int | float = 250,
    free_estimate: bool = False,
) -> dict[str, Any]:
    """Assess similarity independently of price, offer, and discovery purpose.

    ``verificationEligible`` applies inexpensive vehicle/location checks before
    historical lookup. ``baselineEligible`` additionally requires verified date
    and price provenance and excludes price-directed discoveries. All failures
    remain visible as unknown facts, known mismatches, or other explicit reasons.
    """

    subject = _mapping(subject_material_facts)
    facts = _mapping(observation.get("materialFacts"))
    raw = _mapping(observation.get("listing"))
    reasons: list[str] = []
    differences: list[dict[str, Any]] = []
    material_ok = True
    uncorroborated_metadata: list[str] = []
    estimate_unknowns: list[str] = []
    identity = observation_identity(observation)

    def reject(code: str, field: str | None = None, left: Any = None, right: Any = None) -> None:
        nonlocal material_ok
        material_ok = False
        reasons.append(code)
        if field is not None:
            differences.append({"field": field, "subject": copy.deepcopy(left), "listing": copy.deepcopy(right), "reason": code})

    def compare(field: str, *, required: bool = False, covered: bool = False) -> bool:
        left, right = _fact(subject.get(field)), _fact(facts.get(field))
        if left is not None and right is not None:
            if left != right:
                reject(f"{field.upper()}_MISMATCH", field, subject.get(field), facts.get(field))
                return False
            return True
        if covered:
            return True
        if free_estimate and left is None:
            estimate_unknowns.append(field)
            reasons.append(f"{field.upper()}_ESTIMATE_UNRESOLVED")
            return False
        if required or left is not None or right is not None:
            reject(f"{field.upper()}_UNKNOWN", field, subject.get(field), facts.get(field))
        return False

    try:
        listing = listing_from_observation(observation)
        request = MarketSearchRequest(
            year=target.year, make=target.make, model=target.model, trim=target.trim,
            drivetrain=target.drivetrain, drivetrain_recorded=target.drivetrain_recorded,
            loss_vehicle_mileage=target.mileage, postal_code=target.postal_code,
            radius_miles=max(0, min(250, math.ceil(max_distance_miles))), result_limit=1,
        )
        ranked = rank_market_comparables(target, MarketSearchResult(
            provider=listing.source, request=request, listings=(listing,),
        )).candidates[0]
        score = ranked.score if ranked.score is not None else 0
        legacy_tier = ranked.tier
    except (KeyError, TypeError, ValueError, ArithmeticError, ComparableContractError, MarketContractError):
        # Canonical contract failures are expected malformed-input outcomes.
        return {
            "version": EVIDENCE_QUALIFICATION_VERSION, "identity": identity,
            "eligible": False, "verificationEligible": False, "supportingVerificationEligible": False, "baselineEligible": False,
            "supportingEligible": False, "strong": False, "score": 0, "tier": "INELIGIBLE",
            "qualityKey": [1, 0, 0, 0, identity or ""], "reasonCodes": ["INVALID_CANONICAL_LISTING"],
            "differences": [], "priceValid": False,
        }

    if identity is None:
        reject("IDENTITY_UNKNOWN")
    if _text(subject.get("vin")) is not None and _text(subject.get("vin")) == _text(listing.vin):
        reject("SUBJECT_VEHICLE_EXCLUDED")
    for field, left, right in (
        ("year", target.year, listing.year), ("make", target.make, listing.make),
        ("model", target.model, listing.model), ("trim", target.trim, listing.trim),
        ("drivetrain", target.drivetrain, listing.drivetrain),
    ):
        if free_estimate and field == "drivetrain" and _fact(left) is None:
            estimate_unknowns.append(field)
            reasons.append("DRIVETRAIN_ESTIMATE_UNRESOLVED")
        elif _fact(left) is None or _fact(right) is None:
            reject(f"{field.upper()}_UNKNOWN", field, left, right)
        elif _fact(left) != _fact(right):
            reject(f"{field.upper()}_MISMATCH", field, left, right)

    body_covered = _configuration_covers(subject, facts, "bodyType")
    powertrain_covered = _configuration_covers(subject, facts, "powertrain")
    body_matched = compare("bodyType", required=True, covered=body_covered)
    truck_configuration = bool({_fact(subject.get("bodyType")), _fact(facts.get("bodyType"))} & _TRUCK_BODY_TYPES)
    for field in ("cabType", "bedLength"):
        compare(field, required=truck_configuration, covered=_configuration_covers(subject, facts, field))
    for field, label in (("bodySubtype", "body-size category"), ("doors", "door count")):
        values = {_fact(subject.get(field)), _fact(facts.get(field))} - {None}
        expected_doors = _REDUNDANT_DOOR_COUNTS.get(_fact(subject.get("bodyType")))
        redundant = body_matched and (
            values <= _SIZE_CATEGORIES if field == "bodySubtype"
            else bool(expected_doors and values <= {expected_doors})
        )
        if redundant and len(values) == 1 and (_fact(subject.get(field)) is None or _fact(facts.get(field)) is None):
            uncorroborated_metadata.append(label)
        compare(field, covered=redundant or _configuration_covers(subject, facts, field))
    explicit_powertrain = _fact(subject.get("powertrain")) is not None and _fact(facts.get("powertrain")) is not None
    if explicit_powertrain:
        compare("powertrain", required=True)
    elif not powertrain_covered:
        # Engine, fuel, and transmission together provide a reproducible match;
        # fuel alone or the drive axle alone is insufficient.
        for field in ("engine", "fuelType", "transmission"):
            compare(field, required=True)
    engine_matched = all(_fact(subject.get(field)) is not None and _fact(subject.get(field)) == _fact(facts.get(field)) for field in ("engine", "fuelType", "transmission"))
    engine_cylinders = re.search(r"\b(?:[ivhlw][ -]?(\d{1,2})|(\d{1,2})[ -]?(?:cylinders?|cyl))\b", _fact(subject.get("engine")) or "")
    encoded_cylinders = next((value for value in engine_cylinders.groups() if value), None) if engine_cylinders else None
    for field in _POWERTRAIN_FIELDS:
        if field in {"engine", "fuelType", "transmission"} and not explicit_powertrain and not powertrain_covered:
            continue
        cylinder_values = {_fact(subject.get("cylinders")), _fact(facts.get("cylinders"))} - {None}
        if field == "cylinders" and engine_matched and encoded_cylinders and cylinder_values - {encoded_cylinders}:
            reject("CYLINDERS_ENGINE_CONFLICT", field, subject.get(field), facts.get(field))
        redundant = field == "cylinders" and engine_matched and bool(encoded_cylinders) and cylinder_values <= {encoded_cylinders}
        if redundant and (_fact(subject.get(field)) is None) != (_fact(facts.get(field)) is None):
            uncorroborated_metadata.append("cylinder count")
        compare(field, covered=powertrain_covered or redundant)

    equipment_subject, equipment_listing = _equipment(subject.get("equipment")), _equipment(facts.get("equipment"))
    if subject.get("materialEquipmentUnresolved") is True or facts.get("materialEquipmentUnresolved") is True:
        reject("MATERIAL_EQUIPMENT_UNKNOWN")
    # Empty arrays in report contracts can mean no packages were recorded.
    # They are not proof that the vehicle has no optional equipment.
    if equipment_subject or equipment_listing:
        if free_estimate and not equipment_subject:
            estimate_unknowns.append("equipment")
            reasons.append("EQUIPMENT_ESTIMATE_UNRESOLVED")
        elif equipment_subject is None or equipment_listing is None:
            reject("MATERIAL_EQUIPMENT_UNKNOWN", "equipment", subject.get("equipment"), facts.get("equipment"))
        elif equipment_subject != equipment_listing:
            reject("MATERIAL_EQUIPMENT_MISMATCH", "equipment", subject.get("equipment"), facts.get("equipment"))
    for field in _PREMIUM_FIELDS:
        left, right = subject.get(field), facts.get(field)
        if left is True or right is True:
            if not isinstance(left, bool) or not isinstance(right, bool):
                reject(f"{field.upper()}_PREMIUM_UNKNOWN", field, left, right)
            elif left != right:
                reject(f"{field.upper()}_MISMATCH", field, left, right)

    mileage_difference = abs(listing.mileage - target.mileage) if listing.mileage is not None and target.mileage is not None else None
    supporting_limitations: list[str] = []
    if mileage_difference is None:
        reject("MILEAGE_UNKNOWN")
    elif mileage_difference:
        differences.append({"field": "mileage", "subject": target.mileage, "listing": listing.mileage, "reason": "MILEAGE_DIFFERENCE"})
        direction = "lower" if listing.mileage < target.mileage else "higher"
        supporting_limitations.append(
            f"Listing mileage is {mileage_difference:,} miles {direction} than the subject vehicle. "
            "No independent mileage adjustment was calculated."
        )
    # These supporting-only bounds prevent other score components from
    # compensating for materially different mileage. Baseline rules are intact.
    supporting_mileage_ok = bool(
        mileage_difference is not None
        and mileage_difference <= _SUPPORTING_MAXIMUM_MILEAGE_GAP
        and Decimal(mileage_difference) <= Decimal(target.mileage) * Decimal(str(_SUPPORTING_MAXIMUM_MILEAGE_FRACTION))
    )
    if mileage_difference is not None and not supporting_mileage_ok:
        reasons.append("SUPPORTING_MILEAGE_WINDOW_EXCEEDED")
    if legacy_tier in {"WEAK", "INELIGIBLE"}:
        reject("INSUFFICIENT_MATCH_QUALITY")
    location = _mapping(observation.get("location"))
    distance = listing.distance_miles
    if (
        location.get("verified") is not True or target.postal_code is None
        or isinstance(distance, bool) or not isinstance(distance, (int, float))
        or not math.isfinite(distance)
    ):
        reject("CUSTOMER_RELATIVE_LOCATION_UNKNOWN")
    elif distance < 0 or distance > max_distance_miles:
        reject("OUTSIDE_GEOGRAPHIC_BOUNDARY")
    if observation.get("conflicted") is True or observation.get("conflicts"):
        reject("CONFLICTING_OBSERVATIONS")

    verification_eligible = material_ok
    supporting_verification_eligible = verification_eligible and legacy_tier == "STRONG" and supporting_mileage_ok
    stream = observation.get("stream")
    if stream is None:
        stream = "historical" if observation.get("sourceEndpoint") in {"recents", "history"} else "current"
    relevant_date = observation.get("relevantDate")
    temporal_ok = observation.get("dateVerified") is True and _valid_date(relevant_date)
    if stream == "historical":
        temporal_ok = temporal_ok and observation.get("sourceEndpoint") == "history"
        if evidence_date is not None:
            temporal_ok = temporal_ok and relevant_date == evidence_date
    elif stream != "current" or observation.get("sourceEndpoint") != "active":
        temporal_ok = False
    if not temporal_ok:
        reasons.append("DATE_CONTEXT_UNVERIFIED")
    price = raw.get("price")
    price_valid = isinstance(price, (int, float)) and not isinstance(price, bool) and math.isfinite(price) and price > 0
    price_valid = price_valid and observation.get("priceVerified") is True
    if not price_valid:
        reasons.append("ASKING_PRICE_UNVERIFIED")
    matched = verification_eligible and temporal_ok and price_valid
    purpose = observation.get("purpose", _mapping(observation.get("provenance")).get("purpose", "baseline"))
    baseline_eligible = matched and purpose == "baseline"
    if purpose != "baseline":
        reasons.append("PRICE_DIRECTED_BASELINE_EXCLUSION")
    optional_benefit_limitations = []
    for field, label in (("certified", "Certification"), ("warranty", "Warranty")):
        if not isinstance(subject.get(field), bool) or not isinstance(facts.get(field), bool):
            optional_benefit_limitations.append(f"{label} benefits were not fully verified and are not used to justify this listing's premium.")
    if not equipment_subject or not equipment_listing:
        optional_benefit_limitations.append("Optional accessories were not fully verified and are not used to justify this listing's premium.")
    if uncorroborated_metadata:
        optional_benefit_limitations.append(
            "Additional listing metadata was not independently corroborated: " + ", ".join(uncorroborated_metadata)
            + ". Core body and powertrain matching uses verified report facts."
        )
    if optional_benefit_limitations:
        reasons.append("OPTIONAL_BENEFITS_UNVERIFIED")

    # This key is exact, not a price-dependent band: same score, same absolute
    # mileage gap, same customer distance. Identity is only the final stable tie.
    quality_key = [
        0 if verification_eligible else 1, -float(score),
        mileage_difference if mileage_difference is not None else 10**12,
        float(distance) if isinstance(distance, (int, float)) and math.isfinite(distance) else 10**12,
        identity or "",
    ]
    if not reasons:
        reasons.append("VERIFIED_COMPARABLE_MATCH")
    result = {
        "version": EVIDENCE_QUALIFICATION_VERSION, "identity": identity,
        "eligible": matched, "verificationEligible": verification_eligible,
        "supportingVerificationEligible": supporting_verification_eligible,
        "baselineEligible": baseline_eligible,
        "supportingEligible": supporting_verification_eligible and temporal_ok and price_valid,
        "strong": baseline_eligible and legacy_tier == "STRONG",
        "score": score, "tier": legacy_tier if matched else "INELIGIBLE",
        "qualityKey": quality_key, "reasonCodes": list(dict.fromkeys(reasons)),
        "differences": differences, "priceValid": bool(price_valid),
        "optionalBenefitLimitations": optional_benefit_limitations,
        "supportingLimitations": supporting_limitations,
    }
    if free_estimate:
        strict = assess_observation(target, observation, subject_material_facts=subject_material_facts,
                                    evidence_date=evidence_date, max_distance_miles=max_distance_miles)
        result.update({
            "readinessStage": "free_estimate", "unresolvedEstimateFacts": sorted(set(estimate_unknowns)),
            "estimateStrong": baseline_eligible and legacy_tier == "STRONG",
            "strong": strict["strong"],
            "supportingEligible": strict["supportingEligible"],
            "supportingVerificationEligible": strict["supportingVerificationEligible"],
        })
    return result


@dataclass(frozen=True)
class SupportingShortlistPolicy:
    maximum_listings: int = 3
    minimum_reference_count: int = 5
    outlier_median_fraction: float = 0.25
    outlier_mad_multiplier: float = 6.0

    def __post_init__(self) -> None:
        if isinstance(self.maximum_listings, bool) or not isinstance(self.maximum_listings, int) or not 1 <= self.maximum_listings <= 9:
            raise ValueError("Supporting maximum must be between one and nine")
        if isinstance(self.minimum_reference_count, bool) or not isinstance(self.minimum_reference_count, int) or self.minimum_reference_count < 3:
            raise ValueError("Supporting reference requires at least three vehicles")
        for value in (self.outlier_median_fraction, self.outlier_mad_multiplier):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError("Supporting outlier parameters must be positive finite numbers")


def _observation_signature(observation: Mapping[str, Any]) -> tuple[Any, ...]:
    """Conflicting prices, mileage, dates, or material/location facts are retained."""

    import json

    return tuple(json.dumps(observation.get(field), sort_keys=True, separators=(",", ":"), default=str) for field in (
        "listing", "materialFacts", "location", "stream", "relevantDate", "dateVerified", "priceVerified",
    ))


def immutable_material_conflicts(observations: Sequence[Mapping[str, Any]]) -> bool:
    """Different asking dates can change price/location but not vehicle identity."""

    fields = (
        ("listing", ("year", "make", "model", "trim", "drivetrain")),
        ("materialFacts", ("bodyType", *_BODY_FIELDS, "powertrain", *_POWERTRAIN_FIELDS)),
    )
    return any(
        len({_fact(_mapping(observation.get(container)).get(field)) for observation in observations}
            - {None}) > 1
        for container, names in fields for field in names
    )


def build_supporting_shortlist(
    target: ComparableTarget,
    observations: Sequence[Mapping[str, Any]],
    *,
    subject_material_facts: Mapping[str, Any] | None = None,
    evidence_date: str | None = None,
    max_distance_miles: int | float = 250,
    policy: SupportingShortlistPolicy | None = None,
) -> dict[str, Any]:
    """Produce explicitly nonrepresentative examples without changing valuation.

    Reference medians and symmetric outlier fences use only strict baseline
    observations from the same stream/date. Expensive discoveries cannot shift
    their own reference distribution. Outlier flags are advisory reassessment
    reasons, never silent edits to baseline prices or selection.
    """

    policy = policy or SupportingShortlistPolicy()
    assessments = [assess_observation(
        target, observation, subject_material_facts=subject_material_facts,
        evidence_date=evidence_date, max_distance_miles=max_distance_miles,
    ) for observation in observations]
    def context(observation: Mapping[str, Any]) -> tuple[str, Any]:
        stream = observation.get("stream") or ("historical" if observation.get("sourceEndpoint") in {"history", "recents"} else "current")
        return stream, observation.get("relevantDate")

    grouped: dict[tuple[str, tuple[str, Any]], list[int]] = {}
    vehicle_indexes: dict[str, list[int]] = {}
    for index, assessment in enumerate(assessments):
        if assessment["identity"] is not None:
            grouped.setdefault((assessment["identity"], context(observations[index])), []).append(index)
            vehicle_indexes.setdefault(assessment["identity"], []).append(index)
    material_conflict_ids = {
        identity for identity, indexes in vehicle_indexes.items()
        if immutable_material_conflicts([observations[index] for index in indexes])
    }
    conflict_contexts = {
        key for key, indexes in grouped.items()
        if len({_observation_signature(observations[index]) for index in indexes}) > 1
    }
    unique_indexes = [
        indexes[0] for key, indexes in grouped.items()
        if key not in conflict_contexts and key[0] not in material_conflict_ids
    ]

    reference: dict[tuple[str, Any], list[float]] = {}
    for index in unique_indexes:
        if assessments[index]["baselineEligible"]:
            reference.setdefault(context(observations[index]), []).append(float(observations[index]["listing"]["price"]))
    reference_stats: dict[tuple[str, Any], tuple[float, float]] = {}
    for key, prices in reference.items():
        if len(prices) >= policy.minimum_reference_count:
            center = median(prices)
            mad = median([abs(value - center) for value in prices])
            half_width = max(center * policy.outlier_median_fraction, mad * policy.outlier_mad_multiplier)
            reference_stats[key] = (center, half_width)

    exclusions: list[dict[str, Any]] = []
    candidates: list[int] = []
    reassessment: list[dict[str, Any]] = []
    retained = set(unique_indexes)
    for index, (observation, assessment) in enumerate(zip(observations, assessments)):
        identity = assessment["identity"]
        if identity in material_conflict_ids or (identity, context(observation)) in conflict_contexts:
            reasons = ["CONFLICTING_OBSERVATIONS"]
            if not any(item["identity"] == identity for item in reassessment):
                reassessment.append({"identity": identity, "reason": "CONFLICTING_OBSERVATIONS", "action": "PRICE_INDEPENDENT_REASSESSMENT_REQUIRED"})
        elif index not in retained:
            reasons = ["DUPLICATE_OBSERVATION"] if identity else ["IDENTITY_UNKNOWN"]
        elif not assessment["supportingEligible"]:
            reasons = assessment["reasonCodes"]
        elif context(observation) not in reference_stats:
            reasons = ["INSUFFICIENT_BASELINE_PRICE_REFERENCE"]
        else:
            center, half_width = reference_stats[context(observation)]
            price = float(observation["listing"]["price"])
            if abs(price - center) > half_width:
                reasons = ["SYMMETRIC_PRICE_OUTLIER"]
                reassessment.append({"identity": identity, "reason": "SYMMETRIC_PRICE_OUTLIER", "action": "PRICE_INDEPENDENT_REASSESSMENT_REQUIRED"})
            elif price <= center:
                reasons = ["NOT_HIGHER_THAN_BASELINE_MEDIAN"]
            else:
                candidates.append(index)
                continue
        exclusions.append({"identity": identity, "reasonCodes": reasons})

    candidates.sort(key=lambda index: (
        *assessments[index]["qualityKey"][:-1],
        0 if context(observations[index])[0] == "historical" else 1,
        -Decimal(str(observations[index]["listing"]["price"])),
        assessments[index]["identity"],
    ))
    unique_candidates: list[int] = []
    selected_identities: set[str] = set()
    for index in candidates:
        identity = assessments[index]["identity"]
        if identity in selected_identities:
            exclusions.append({"identity": identity, "reasonCodes": ["VEHICLE_ALREADY_REPRESENTED_IN_SHORTLIST"]})
        else:
            unique_candidates.append(index)
            selected_identities.add(identity)
    candidates = unique_candidates
    selected = candidates[:policy.maximum_listings]
    exclusions.extend({"identity": assessments[index]["identity"], "reasonCodes": ["SHORTLIST_LIMIT_AFTER_QUALITY_AND_PRICE"]} for index in candidates[policy.maximum_listings:])
    listings = []
    for index in selected:
        observation, assessment = observations[index], assessments[index]
        listings.append({
            "identity": assessment["identity"], "listing": copy.deepcopy(observation["listing"]),
            "matchingFacts": {
                field: copy.deepcopy(value) for field, value in _mapping(observation.get("materialFacts")).items()
                if value is not None and not (field == "equipment" and not _equipment(value)) and (
                    value == _mapping(subject_material_facts).get(field)
                    or (_fact(value) is not None and _fact(value) == _fact(_mapping(subject_material_facts).get(field)))
                    or (field == "equipment" and _equipment(value) is not None and _equipment(value) == _equipment(_mapping(subject_material_facts).get(field)))
                )
            },
            "verifiedAskingPrice": observation["listing"]["price"],
            "priceSource": observation.get("sourceEndpoint"),
            "stream": context(observation)[0], "relevantDate": observation.get("relevantDate"),
            "distanceMiles": observation["listing"].get("distanceMiles"),
            "materialDifferences": assessment["differences"],
            "qualityKey": assessment["qualityKey"],
            "reasonCodes": ["STRICT_VERIFIED_MATCH", "ABOVE_INDEPENDENT_BASELINE_MEDIAN", "QUALITY_BEFORE_ASKING_PRICE"],
            "limitations": ["ADVERTISED_PRICE_NOT_COMPLETED_SALE", "NOT_A_TYPICAL_MARKET_PRICE", "NO_GUARANTEED_RECOVERY", "NO_INDEPENDENT_DOLLAR_ADJUSTMENTS", *assessment.get("optionalBenefitLimitations", []), *assessment.get("supportingLimitations", [])],
            "provenance": copy.deepcopy(observation.get("provenance", {})),
        })
    return {
        "version": SUPPORTING_EVIDENCE_VERSION,
        "title": "Higher-priced comparable listings", "purpose": "CUSTOMER_SUPPORTING_EXAMPLES",
        "affectsBaselineValuation": False, "listings": listings, "exclusions": exclusions,
        "reassessmentRequired": reassessment,
        "policy": {
            "maximumListings": policy.maximum_listings,
            "minimumReferenceCount": policy.minimum_reference_count,
            "pricePreference": "ONLY_AFTER_IDENTICAL_SCORE_MILEAGE_GAP_AND_CUSTOMER_DISTANCE",
            "maximumAbsoluteMileageDifference": _SUPPORTING_MAXIMUM_MILEAGE_GAP,
            "maximumRelativeMileageDifference": _SUPPORTING_MAXIMUM_MILEAGE_FRACTION,
            "outlierRule": "ABSOLUTE_DISTANCE_FROM_BASELINE_MEDIAN_EXCEEDS_MAX_MEDIAN_FRACTION_OR_MAD_MULTIPLE",
            "outlierMedianFraction": policy.outlier_median_fraction,
            "outlierMadMultiplier": policy.outlier_mad_multiplier,
        },
    }
