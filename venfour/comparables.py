"""Deterministic, provider-neutral matching of external market comparables.

Phase 3C ranks canonical :class:`~venfour.market.MarketListing` values by
factual similarity to a loss vehicle. Listing price remains in the canonical
payload, but is deliberately absent from eligibility, scoring, tiering, and
sorting.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from venfour.market import (
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketSearchRequest,
    MarketSearchResult,
    validate_market_search_request,
    validate_market_search_result,
)


COMPARABLE_SCORING_VERSION = "2"

YEAR_MAX_SCORE = 20
TRIM_MAX_SCORE = 20
MILEAGE_MAX_SCORE = 50
DISTANCE_MAX_SCORE = 10

STRONG_SCORE_MINIMUM = Decimal("85")
GOOD_SCORE_MINIMUM = Decimal("70")

REPO_ROOT = Path(__file__).resolve().parents[1]
COMPARABLE_SCHEMA_DIR = REPO_ROOT / "schemas" / "comparables"
TARGET_SCHEMA_PATH = COMPARABLE_SCHEMA_DIR / "target.schema.json"
CANDIDATE_SCHEMA_PATH = COMPARABLE_SCHEMA_DIR / "candidate.schema.json"
RANKING_RESULT_SCHEMA_PATH = COMPARABLE_SCHEMA_DIR / "ranking-result.schema.json"

_SCORE_QUANTUM = Decimal("0.01")
_MISSING_MILEAGE_SCORE = Decimal("15")
_MISSING_DISTANCE_SCORE = Decimal("5")

# Scores between these documented anchors are linearly interpolated. A known
# mileage gap of 50,000 miles or more receives no mileage points.
_MILEAGE_SCORE_ANCHORS = (
    (Decimal("0"), Decimal("50")),
    (Decimal("5000"), Decimal("45")),
    (Decimal("10000"), Decimal("35")),
    (Decimal("25000"), Decimal("15")),
    (Decimal("50000"), Decimal("0")),
)

# Distance has a modest effect. The first ten miles receive full credit, and
# scores then decline to zero at 200 miles.
_DISTANCE_SCORE_ANCHORS = (
    (Decimal("0"), Decimal("10")),
    (Decimal("10"), Decimal("10")),
    (Decimal("25"), Decimal("9")),
    (Decimal("50"), Decimal("7")),
    (Decimal("100"), Decimal("4")),
    (Decimal("200"), Decimal("0")),
)


class ComparableContractError(Exception):
    """A comparable target or ranking value failed contract validation."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


def _trim_required(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


def _trim_optional(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    normalized = value.strip()
    return normalized or None


@dataclass(frozen=True)
class ComparableTarget:
    """Only the loss-vehicle facts needed to assess listing similarity."""

    year: int
    make: str
    model: str
    trim: str | None = None
    mileage: int | None = None
    postal_code: str | None = None
    drivetrain: str | None = None
    drivetrain_recorded: bool = field(default=False, compare=False, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "make", _trim_required(self.make))
        object.__setattr__(self, "model", _trim_required(self.model))
        object.__setattr__(self, "trim", _trim_optional(self.trim))
        object.__setattr__(self, "postal_code", _trim_optional(self.postal_code))

    def to_dict(self) -> dict[str, Any]:
        data = {
            "year": self.year,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "mileage": self.mileage,
            "postalCode": self.postal_code,
        }
        if self.drivetrain_recorded or self.drivetrain is not None:
            data["drivetrain"] = self.drivetrain
        return data


@dataclass(frozen=True)
class YearScoreComponent:
    score: int | float
    difference: int
    max_score: int = YEAR_MAX_SCORE

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "maxScore": self.max_score,
            "difference": self.difference,
        }


@dataclass(frozen=True)
class TrimScoreComponent:
    score: int | float
    match: str
    max_score: int = TRIM_MAX_SCORE

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "maxScore": self.max_score,
            "match": self.match,
        }


@dataclass(frozen=True)
class MileageScoreComponent:
    score: int | float
    difference_miles: int | None
    max_score: int = MILEAGE_MAX_SCORE

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "maxScore": self.max_score,
            "differenceMiles": self.difference_miles,
        }


@dataclass(frozen=True)
class DistanceScoreComponent:
    score: int | float
    distance_miles: int | float | None
    max_score: int = DISTANCE_MAX_SCORE

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "maxScore": self.max_score,
            "distanceMiles": self.distance_miles,
        }


@dataclass(frozen=True)
class ComparableScoreComponents:
    year: YearScoreComponent
    trim: TrimScoreComponent
    mileage: MileageScoreComponent
    distance: DistanceScoreComponent

    def to_dict(self) -> dict[str, Any]:
        return {
            "year": self.year.to_dict(),
            "trim": self.trim.to_dict(),
            "mileage": self.mileage.to_dict(),
            "distance": self.distance.to_dict(),
        }


@dataclass(frozen=True)
class ComparableCandidate:
    """One listing together with its explainable eligibility and similarity."""

    listing: MarketListing
    eligible: bool
    score: int | float | None
    tier: str
    rank: int | None
    components: ComparableScoreComponents
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "reasons", tuple(self.reasons))

    def to_dict(self) -> dict[str, Any]:
        return {
            "listing": self.listing.to_dict(),
            "eligible": self.eligible,
            "score": self.score,
            "tier": self.tier,
            "rank": self.rank,
            "components": self.components.to_dict(),
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class ComparableRankingResult:
    """All candidates, with eligible candidates ranked before ineligible ones."""

    target: ComparableTarget
    provider: str
    total_listing_count: int
    eligible_count: int
    ineligible_count: int
    tier_counts: Mapping[str, int]
    candidates: tuple[ComparableCandidate, ...]
    scoring_version: str = COMPARABLE_SCORING_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "tier_counts", dict(self.tier_counts))
        object.__setattr__(self, "candidates", tuple(self.candidates))

    def to_dict(self) -> dict[str, Any]:
        return {
            "scoringVersion": self.scoring_version,
            "target": self.target.to_dict(),
            "provider": self.provider,
            "totalListingCount": self.total_listing_count,
            "eligibleCount": self.eligible_count,
            "ineligibleCount": self.ineligible_count,
            "tierCounts": dict(self.tier_counts),
            "candidates": [candidate.to_dict() for candidate in self.candidates],
        }


def comparable_target_from_report(
    report: Mapping[str, Any], *, postal_code: str | None = None
) -> ComparableTarget:
    """Build and validate a target from a canonical report's loss vehicle.

    The canonical report's free-form ``vehicle.location`` is intentionally not
    parsed as a postal code. Callers may supply a separately validated postal
    code; unavailable facts remain unavailable rather than being guessed.
    """

    if not isinstance(report, Mapping):
        raise ComparableContractError(
            "Canonical report must be a JSON object", ("$: expected an object",)
        )
    vehicle = report.get("vehicle")
    if not isinstance(vehicle, Mapping):
        raise ComparableContractError(
            "Canonical report does not contain a loss vehicle",
            ("$.vehicle: expected an object",),
        )
    target = ComparableTarget(
        year=vehicle.get("year"),
        make=vehicle.get("make"),
        model=vehicle.get("model"),
        trim=vehicle.get("trim"),
        drivetrain=vehicle.get("drivetrain"),
        drivetrain_recorded="drivetrain" in vehicle,
        mileage=vehicle.get("mileage"),
        postal_code=postal_code,
    )
    validate_comparable_target(target)
    return target


def comparable_target_from_search_request(
    request: MarketSearchRequest,
) -> ComparableTarget:
    """Build a target from an already-constructed provider-neutral request."""

    if not isinstance(request, MarketSearchRequest):
        raise ComparableContractError(
            "Market search request cannot produce a comparable target",
            (f"$: expected MarketSearchRequest, got {type(request).__name__}",),
        )
    try:
        validate_market_search_request(request)
    except MarketContractError as exc:
        raise ComparableContractError(
            "Market search request cannot produce a comparable target", exc.details
        ) from exc
    target = ComparableTarget(
        year=request.year,
        make=request.make,
        model=request.model,
        trim=request.trim,
        drivetrain=request.drivetrain,
        drivetrain_recorded=request.drivetrain_recorded,
        mileage=request.loss_vehicle_mileage,
        postal_code=request.postal_code,
    )
    validate_comparable_target(target)
    return target


def _normalized_match_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _round_score(value: Decimal) -> Decimal:
    return value.quantize(_SCORE_QUANTUM, rounding=ROUND_HALF_UP)


def _json_score(value: Decimal) -> int | float:
    rounded = _round_score(value)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def _piecewise_score(
    value: int | float, anchors: tuple[tuple[Decimal, Decimal], ...]
) -> Decimal:
    decimal_value = Decimal(str(value))
    if decimal_value <= anchors[0][0]:
        return anchors[0][1]
    for (lower_x, lower_score), (upper_x, upper_score) in zip(
        anchors, anchors[1:]
    ):
        if decimal_value <= upper_x:
            fraction = (decimal_value - lower_x) / (upper_x - lower_x)
            return lower_score + fraction * (upper_score - lower_score)
    return anchors[-1][1]


def _year_component(
    target: ComparableTarget, listing: MarketListing, reasons: list[str]
) -> YearScoreComponent:
    difference = abs(listing.year - target.year)
    if difference == 0:
        score = 20
        reasons.append("EXACT_YEAR")
    elif difference == 1:
        score = 12
        reasons.append("YEAR_DIFFERENCE_ONE")
    else:
        score = 4 if difference == 2 else 0
        reasons.append("YEAR_DIFFERENCE_MULTIPLE")
    return YearScoreComponent(score=score, difference=difference)


def _trim_component(
    target: ComparableTarget, listing: MarketListing, reasons: list[str]
) -> TrimScoreComponent:
    if target.trim is None and listing.trim is None:
        reasons.append("TRIM_UNAVAILABLE")
        return TrimScoreComponent(score=10, match="UNAVAILABLE")
    if target.trim is None:
        reasons.append("TARGET_TRIM_UNAVAILABLE")
        return TrimScoreComponent(score=10, match="TARGET_UNAVAILABLE")
    if listing.trim is None:
        reasons.append("LISTING_TRIM_UNAVAILABLE")
        return TrimScoreComponent(score=10, match="LISTING_UNAVAILABLE")
    if _normalized_match_text(target.trim) == _normalized_match_text(listing.trim):
        reasons.append("EXACT_TRIM")
        return TrimScoreComponent(score=20, match="EXACT")
    reasons.append("DIFFERENT_TRIM")
    return TrimScoreComponent(score=0, match="DIFFERENT")


def _mileage_component(
    target: ComparableTarget, listing: MarketListing, reasons: list[str]
) -> MileageScoreComponent:
    if target.mileage is None and listing.mileage is None:
        reasons.append("MILEAGE_UNAVAILABLE")
        return MileageScoreComponent(
            score=_json_score(_MISSING_MILEAGE_SCORE), difference_miles=None
        )
    if target.mileage is None:
        reasons.append("TARGET_MILEAGE_UNAVAILABLE")
        return MileageScoreComponent(
            score=_json_score(_MISSING_MILEAGE_SCORE), difference_miles=None
        )
    if listing.mileage is None:
        reasons.append("LISTING_MILEAGE_UNAVAILABLE")
        return MileageScoreComponent(
            score=_json_score(_MISSING_MILEAGE_SCORE), difference_miles=None
        )

    difference = abs(listing.mileage - target.mileage)
    score = _piecewise_score(difference, _MILEAGE_SCORE_ANCHORS)
    if difference == 0:
        reasons.append("MILEAGE_EXACT")
    elif difference <= 5000:
        reasons.append("MILEAGE_VERY_CLOSE")
    elif difference <= 10000:
        reasons.append("MILEAGE_CLOSE")
    elif difference <= 25000:
        reasons.append("MILEAGE_MODERATE")
    else:
        reasons.append("MILEAGE_FAR")
    return MileageScoreComponent(
        score=_json_score(score), difference_miles=difference
    )


def _distance_component(
    target: ComparableTarget, listing: MarketListing, reasons: list[str]
) -> DistanceScoreComponent:
    if listing.distance_miles is None:
        reasons.append("DISTANCE_UNAVAILABLE")
        return DistanceScoreComponent(
            score=_json_score(_MISSING_DISTANCE_SCORE), distance_miles=None
        )
    if target.postal_code is None:
        reasons.append("DISTANCE_ORIGIN_UNAVAILABLE")
        return DistanceScoreComponent(
            score=_json_score(_MISSING_DISTANCE_SCORE), distance_miles=None
        )

    score = _piecewise_score(listing.distance_miles, _DISTANCE_SCORE_ANCHORS)
    if listing.distance_miles <= 25:
        reasons.append("DISTANCE_CLOSE")
    elif listing.distance_miles <= 50:
        reasons.append("DISTANCE_MODERATE")
    else:
        reasons.append("DISTANCE_FAR")
    return DistanceScoreComponent(
        score=_json_score(score), distance_miles=listing.distance_miles
    )


def _tier_for_score(score: int | float) -> str:
    decimal_score = Decimal(str(score))
    if decimal_score >= STRONG_SCORE_MINIMUM:
        return "STRONG"
    if decimal_score >= GOOD_SCORE_MINIMUM:
        return "GOOD"
    return "WEAK"


def _score_listing(
    target: ComparableTarget, listing: MarketListing,
    scoring_version: str = COMPARABLE_SCORING_VERSION,
) -> ComparableCandidate:
    reasons: list[str] = []
    eligible = True

    if _normalized_match_text(target.make) == _normalized_match_text(listing.make):
        reasons.append("EXACT_MAKE")
    else:
        reasons.append("MAKE_MISMATCH")
        eligible = False

    if _normalized_match_text(target.model) == _normalized_match_text(listing.model):
        reasons.append("EXACT_MODEL")
    else:
        reasons.append("MODEL_MISMATCH")
        eligible = False

    year = _year_component(target, listing, reasons)
    trim = _trim_component(target, listing, reasons)
    mileage = _mileage_component(target, listing, reasons)
    distance = _distance_component(target, listing, reasons)
    if listing.vin is None:
        reasons.append("VIN_UNAVAILABLE")
    drivetrain_unresolved = False
    if scoring_version == "2" and target.drivetrain is not None:
        if listing.drivetrain is None:
            reasons.append("LISTING_DRIVETRAIN_UNAVAILABLE")
            drivetrain_unresolved = True
        elif listing.drivetrain != target.drivetrain:
            reasons.append("DRIVETRAIN_MISMATCH")
            eligible = False
        else:
            reasons.append("EXACT_DRIVETRAIN")

    components = ComparableScoreComponents(
        year=year,
        trim=trim,
        mileage=mileage,
        distance=distance,
    )
    if not eligible:
        return ComparableCandidate(
            listing=listing,
            eligible=False,
            score=None,
            tier="INELIGIBLE",
            rank=None,
            components=components,
            reasons=tuple(reasons),
        )

    component_score = sum(
        (
            Decimal(str(year.score)),
            Decimal(str(trim.score)),
            Decimal(str(mileage.score)),
            Decimal(str(distance.score)),
        ),
        Decimal("0"),
    )
    score = _json_score(component_score)
    tier = _tier_for_score(score)
    if drivetrain_unresolved and tier == "STRONG":
        tier = "GOOD"
    return ComparableCandidate(
        listing=listing,
        eligible=True,
        score=score,
        tier=tier,
        rank=None,
        components=components,
        reasons=tuple(reasons),
    )


def _candidate_sort_key(
    indexed_candidate: tuple[int, ComparableCandidate],
) -> tuple[Any, ...]:
    original_index, candidate = indexed_candidate
    if candidate.score is None:
        raise AssertionError("ineligible candidate cannot be ranked")
    mileage_difference = candidate.components.mileage.difference_miles
    distance = candidate.components.distance.distance_miles
    return (
        -Decimal(str(candidate.score)),
        mileage_difference is None,
        mileage_difference if mileage_difference is not None else 0,
        distance is None,
        Decimal(str(distance)) if distance is not None else Decimal("0"),
        original_index,
    )


def rank_market_comparables(
    target: ComparableTarget, market_result: MarketSearchResult, *,
    scoring_version: str = COMPARABLE_SCORING_VERSION,
) -> ComparableRankingResult:
    """Score and deterministically rank an already-discovered market result.

    Exact normalized make/model matches are required. Version 2 also excludes
    known drivetrain conflicts and caps unverified drivetrain matches at GOOD.
    Eligible listings sort by score, mileage difference, distance, and original
    provider order. Price is not read by the scoring or sorting rules.
    """

    if scoring_version not in {"1", "2"}:
        raise ComparableContractError("Unsupported comparable scoring version")
    if not isinstance(target, ComparableTarget):
        raise ComparableContractError(
            "Comparable target failed contract validation",
            (f"$: expected ComparableTarget, got {type(target).__name__}",),
        )
    if not isinstance(market_result, MarketSearchResult):
        raise ComparableContractError(
            "Market result failed comparable input validation",
            (f"$: expected MarketSearchResult, got {type(market_result).__name__}",),
        )
    validate_comparable_target(target)
    try:
        validate_market_search_result(market_result)
    except MarketContractError as exc:
        raise ComparableContractError(
            "Market result failed comparable input validation", exc.details
        ) from exc
    target_origin = (
        _normalized_match_text(target.postal_code)
        if target.postal_code is not None
        else None
    )
    request_origin = (
        _normalized_match_text(market_result.request.postal_code)
        if market_result.request.postal_code is not None
        else None
    )
    if target_origin != request_origin:
        raise ComparableContractError(
            "Market result uses a different distance origin than the target",
            (
                "$.request.postalCode: must match $.target.postalCode, including "
                "whether the origin is unavailable, so listing distances cannot "
                "be compared",
            ),
        )

    indexed = [
        (index, _score_listing(target, listing, scoring_version))
        for index, listing in enumerate(market_result.listings)
    ]
    eligible = sorted(
        (item for item in indexed if item[1].eligible), key=_candidate_sort_key
    )
    ranked_eligible = [
        replace(candidate, rank=rank)
        for rank, (_, candidate) in enumerate(eligible, start=1)
    ]
    ineligible = [candidate for _, candidate in indexed if not candidate.eligible]
    candidates = tuple(ranked_eligible + ineligible)

    tier_counts = {
        "STRONG": sum(candidate.tier == "STRONG" for candidate in candidates),
        "GOOD": sum(candidate.tier == "GOOD" for candidate in candidates),
        "WEAK": sum(candidate.tier == "WEAK" for candidate in candidates),
        "INELIGIBLE": len(ineligible),
    }
    result = ComparableRankingResult(
        target=target,
        provider=market_result.provider,
        total_listing_count=market_result.listing_count,
        eligible_count=len(ranked_eligible),
        ineligible_count=len(ineligible),
        tier_counts=tier_counts,
        candidates=candidates,
        scoring_version=scoring_version,
    )
    validate_comparable_ranking_result(result)
    return result


@lru_cache(maxsize=None)
def _read_schema(path: Path) -> dict[str, Any]:
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ComparableContractError(
            f"Comparable schema could not be read: {path}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise ComparableContractError(
            f"Comparable schema is not valid JSON: {path}"
        ) from exc
    if not isinstance(schema, dict):
        raise ComparableContractError(
            f"Comparable schema root must be an object: {path}"
        )
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise ComparableContractError(
            f"Comparable schema is invalid: {path}", (exc.message,)
        ) from exc
    return schema


def _json_path(parts: Sequence[Any]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part, ensure_ascii=False)}]"
    return path


def _json_compatibility_errors(data: Any) -> list[str]:
    errors: list[str] = []
    stack: list[tuple[str, Any]] = [("$", data)]
    while stack:
        path, value = stack.pop()
        if value is None or isinstance(value, (str, bool, int)):
            continue
        if isinstance(value, float):
            if not math.isfinite(value):
                errors.append(f"{path}: non-finite numbers are not valid JSON")
            continue
        if isinstance(value, Mapping):
            for key, child in value.items():
                if not isinstance(key, str):
                    errors.append(f"{path}: object keys must be strings")
                    continue
                stack.append((f"{path}.{key}", child))
            continue
        if isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )
            continue
        errors.append(
            f"{path}: {type(value).__name__} is not a JSON-compatible value"
        )
    return sorted(errors)


def _validate_contract(data: Any, schema_path: Path, label: str) -> None:
    compatibility_errors = _json_compatibility_errors(data)
    if compatibility_errors:
        raise ComparableContractError(
            f"{label} failed contract validation", tuple(compatibility_errors)
        )
    validation_errors = sorted(
        Draft202012Validator(_read_schema(schema_path)).iter_errors(data),
        key=lambda error: (_json_path(list(error.absolute_path)), error.message),
    )
    if validation_errors:
        raise ComparableContractError(
            f"{label} failed contract validation",
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in validation_errors
            ),
        )


def _serialized_contract(value: Any, expected_type: type[Any], label: str) -> Any:
    if not isinstance(value, expected_type):
        raise ComparableContractError(
            f"{label} failed contract validation",
            (f"$: expected {expected_type.__name__}",),
        )
    try:
        return value.to_dict()
    except (AttributeError, TypeError, ValueError) as exc:
        raise ComparableContractError(
            f"{label} failed contract validation",
            (f"$: could not serialize canonical value ({exc})",),
        ) from exc


def validate_comparable_target(
    target: ComparableTarget | Mapping[str, Any],
) -> None:
    data = (
        _serialized_contract(target, ComparableTarget, "Comparable target")
        if isinstance(target, ComparableTarget)
        else target
    )
    _validate_contract(data, TARGET_SCHEMA_PATH, "Comparable target")


def _candidate_semantic_errors(data: Mapping[str, Any], path: str = "$") -> list[str]:
    errors: list[str] = []
    eligible = data["eligible"]
    score = data["score"]
    tier = data["tier"]
    rank = data["rank"]
    reasons = data["reasons"]
    make_reason_count = sum(
        reason in {"EXACT_MAKE", "MAKE_MISMATCH"} for reason in reasons
    )
    model_reason_count = sum(
        reason in {"EXACT_MODEL", "MODEL_MISMATCH"} for reason in reasons
    )
    if make_reason_count != 1:
        errors.append(
            f"{path}.reasons: expected exactly one make eligibility reason"
        )
    if model_reason_count != 1:
        errors.append(
            f"{path}.reasons: expected exactly one model eligibility reason"
        )
    expected_eligibility = (
        "MAKE_MISMATCH" not in reasons and "MODEL_MISMATCH" not in reasons
        and "DRIVETRAIN_MISMATCH" not in reasons
    )
    if eligible != expected_eligibility:
        errors.append(
            f"{path}.eligible: does not match the configuration eligibility reasons"
        )
    if eligible:
        component_sum = sum(
            (
                Decimal(str(component["score"]))
                for component in data["components"].values()
            ),
            Decimal("0"),
        )
        if Decimal(str(score)) != component_sum:
            errors.append(f"{path}.score: does not equal the component score sum")
        expected_tier = _tier_for_score(score)
        if "LISTING_DRIVETRAIN_UNAVAILABLE" in reasons and expected_tier == "STRONG":
            expected_tier = "GOOD"
        if tier != expected_tier:
            errors.append(
                f"{path}.tier: expected {expected_tier!r} for score {score!r}"
            )
        if rank is None:
            errors.append(f"{path}.rank: eligible candidate must have a rank")
    elif score is not None or tier != "INELIGIBLE" or rank is not None:
        errors.append(
            f"{path}: ineligible candidate must have null score/rank and "
            "INELIGIBLE tier"
        )

    components = data["components"]
    year = components["year"]
    year_difference = year["difference"]
    expected_year_score = (
        20
        if year_difference == 0
        else 12
        if year_difference == 1
        else 4
        if year_difference == 2
        else 0
    )
    expected_year_reason = (
        "EXACT_YEAR"
        if year_difference == 0
        else "YEAR_DIFFERENCE_ONE"
        if year_difference == 1
        else "YEAR_DIFFERENCE_MULTIPLE"
    )
    if year["score"] != expected_year_score:
        errors.append(f"{path}.components.year.score: inconsistent with difference")
    year_reasons = {
        "EXACT_YEAR",
        "YEAR_DIFFERENCE_ONE",
        "YEAR_DIFFERENCE_MULTIPLE",
    }
    if {reason for reason in reasons if reason in year_reasons} != {
        expected_year_reason
    }:
        errors.append(f"{path}.reasons: inconsistent with year difference")

    trim = components["trim"]
    expected_trim_scores = {
        "EXACT": 20,
        "DIFFERENT": 0,
        "LISTING_UNAVAILABLE": 10,
        "TARGET_UNAVAILABLE": 10,
        "UNAVAILABLE": 10,
    }
    expected_trim_reasons = {
        "EXACT": "EXACT_TRIM",
        "DIFFERENT": "DIFFERENT_TRIM",
        "LISTING_UNAVAILABLE": "LISTING_TRIM_UNAVAILABLE",
        "TARGET_UNAVAILABLE": "TARGET_TRIM_UNAVAILABLE",
        "UNAVAILABLE": "TRIM_UNAVAILABLE",
    }
    trim_match = trim["match"]
    if trim["score"] != expected_trim_scores[trim_match]:
        errors.append(f"{path}.components.trim.score: inconsistent with match")
    trim_reasons = set(expected_trim_reasons.values())
    if {reason for reason in reasons if reason in trim_reasons} != {
        expected_trim_reasons[trim_match]
    }:
        errors.append(f"{path}.reasons: inconsistent with trim match")
    listing_trim_missing = data["listing"].get("trim") is None
    if listing_trim_missing != (
        trim_match in {"LISTING_UNAVAILABLE", "UNAVAILABLE"}
    ):
        errors.append(
            f"{path}.components.trim.match: inconsistent with listing trim availability"
        )

    mileage = components["mileage"]
    mileage_difference = mileage["differenceMiles"]
    if mileage_difference is None:
        expected_mileage_score = _json_score(_MISSING_MILEAGE_SCORE)
        listing_mileage_missing = data["listing"].get("mileage") is None
        allowed_mileage_reasons = (
            {"LISTING_MILEAGE_UNAVAILABLE", "MILEAGE_UNAVAILABLE"}
            if listing_mileage_missing
            else {"TARGET_MILEAGE_UNAVAILABLE"}
        )
    else:
        expected_mileage_score = _json_score(
            _piecewise_score(mileage_difference, _MILEAGE_SCORE_ANCHORS)
        )
        if mileage_difference == 0:
            allowed_mileage_reasons = {"MILEAGE_EXACT"}
        elif mileage_difference <= 5000:
            allowed_mileage_reasons = {"MILEAGE_VERY_CLOSE"}
        elif mileage_difference <= 10000:
            allowed_mileage_reasons = {"MILEAGE_CLOSE"}
        elif mileage_difference <= 25000:
            allowed_mileage_reasons = {"MILEAGE_MODERATE"}
        else:
            allowed_mileage_reasons = {"MILEAGE_FAR"}
        if data["listing"].get("mileage") is None:
            errors.append(
                f"{path}.components.mileage.differenceMiles: listing mileage is "
                "unavailable"
            )
    if mileage["score"] != expected_mileage_score:
        errors.append(
            f"{path}.components.mileage.score: inconsistent with difference"
        )
    mileage_reasons = {
        "MILEAGE_EXACT",
        "MILEAGE_VERY_CLOSE",
        "MILEAGE_CLOSE",
        "MILEAGE_MODERATE",
        "MILEAGE_FAR",
        "LISTING_MILEAGE_UNAVAILABLE",
        "TARGET_MILEAGE_UNAVAILABLE",
        "MILEAGE_UNAVAILABLE",
    }
    actual_mileage_reasons = {
        reason for reason in reasons if reason in mileage_reasons
    }
    if len(actual_mileage_reasons) != 1 or not (
        actual_mileage_reasons <= allowed_mileage_reasons
    ):
        errors.append(f"{path}.reasons: inconsistent with mileage difference")

    distance = components["distance"]
    component_distance = distance["distanceMiles"]
    listing_distance = data["listing"].get("distanceMiles")
    if component_distance is None:
        expected_distance_score = _json_score(_MISSING_DISTANCE_SCORE)
        expected_distance_reason = (
            "DISTANCE_UNAVAILABLE"
            if listing_distance is None
            else "DISTANCE_ORIGIN_UNAVAILABLE"
        )
    else:
        expected_distance_score = _json_score(
            _piecewise_score(component_distance, _DISTANCE_SCORE_ANCHORS)
        )
        expected_distance_reason = (
            "DISTANCE_CLOSE"
            if component_distance <= 25
            else "DISTANCE_MODERATE"
            if component_distance <= 50
            else "DISTANCE_FAR"
        )
        if component_distance != listing_distance:
            errors.append(
                f"{path}.components.distance.distanceMiles: does not match listing"
            )
    if distance["score"] != expected_distance_score:
        errors.append(
            f"{path}.components.distance.score: inconsistent with distance"
        )
    distance_reasons = {
        "DISTANCE_CLOSE",
        "DISTANCE_MODERATE",
        "DISTANCE_FAR",
        "DISTANCE_UNAVAILABLE",
        "DISTANCE_ORIGIN_UNAVAILABLE",
    }
    if {reason for reason in reasons if reason in distance_reasons} != {
        expected_distance_reason
    }:
        errors.append(f"{path}.reasons: inconsistent with distance")

    vin_missing = data["listing"].get("vin") is None
    if ("VIN_UNAVAILABLE" in reasons) != vin_missing:
        errors.append(f"{path}.reasons: inconsistent with VIN availability")
    return errors


def _target_from_data(data: Mapping[str, Any]) -> ComparableTarget:
    return ComparableTarget(
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data["trim"],
        drivetrain=data.get("drivetrain"),
        drivetrain_recorded="drivetrain" in data,
        mileage=data["mileage"],
        postal_code=data["postalCode"],
    )


def _listing_from_data(data: Mapping[str, Any]) -> MarketListing:
    dealer_data = data.get("dealer")
    dealer = (
        MarketDealer(
            name=dealer_data.get("name"),
            city=dealer_data.get("city"),
            state=dealer_data.get("state"),
            postal_code=dealer_data.get("postalCode"),
        )
        if isinstance(dealer_data, Mapping)
        else None
    )
    return MarketListing(
        source=data["source"],
        source_listing_id=data.get("sourceListingId"),
        listing_url=data.get("listingUrl"),
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data.get("trim"),
        drivetrain=data.get("drivetrain"),
        drivetrain_recorded="drivetrain" in data,
        vin=data.get("vin"),
        mileage=data.get("mileage"),
        price=data["price"],
        dealer=dealer,
        distance_miles=data.get("distanceMiles"),
    )


def _candidate_scoring_errors(
    target: ComparableTarget,
    data: Mapping[str, Any],
    path: str,
    scoring_version: str,
) -> list[str]:
    expected = _score_listing(
        target, _listing_from_data(data["listing"]), scoring_version
    ).to_dict()
    errors: list[str] = []
    for field in ("eligible", "score", "tier", "components", "reasons"):
        if data[field] != expected[field]:
            errors.append(
                f"{path}.{field}: does not match scoring version "
                f"{scoring_version}"
            )
    return errors


def validate_comparable_candidate(
    candidate: ComparableCandidate | Mapping[str, Any],
) -> None:
    data = (
        _serialized_contract(candidate, ComparableCandidate, "Comparable candidate")
        if isinstance(candidate, ComparableCandidate)
        else candidate
    )
    _validate_contract(data, CANDIDATE_SCHEMA_PATH, "Comparable candidate")
    semantic_errors = _candidate_semantic_errors(data)
    if semantic_errors:
        raise ComparableContractError(
            "Comparable candidate failed contract validation",
            tuple(semantic_errors),
        )


def validate_comparable_ranking_result(
    result: ComparableRankingResult | Mapping[str, Any],
) -> None:
    data = (
        _serialized_contract(
            result, ComparableRankingResult, "Comparable ranking result"
        )
        if isinstance(result, ComparableRankingResult)
        else result
    )
    _validate_contract(data, RANKING_RESULT_SCHEMA_PATH, "Comparable ranking result")

    candidates = data["candidates"]
    target = _target_from_data(data["target"])
    semantic_errors: list[str] = []
    semantic_errors.extend(
        error
        for index, candidate in enumerate(candidates)
        for error in _candidate_semantic_errors(candidate, f"$.candidates[{index}]")
    )
    semantic_errors.extend(
        error
        for index, candidate in enumerate(candidates)
        for error in _candidate_scoring_errors(
            target, candidate, f"$.candidates[{index}]", data["scoringVersion"]
        )
    )
    eligible_candidates = [
        candidate for candidate in candidates if candidate["eligible"]
    ]
    ineligible_candidates = [
        candidate for candidate in candidates if not candidate["eligible"]
    ]
    if data["totalListingCount"] != len(candidates):
        semantic_errors.append(
            "$.totalListingCount: does not match the number of candidates"
        )
    if data["eligibleCount"] != len(eligible_candidates):
        semantic_errors.append("$.eligibleCount: does not match eligible candidates")
    if data["ineligibleCount"] != len(ineligible_candidates):
        semantic_errors.append(
            "$.ineligibleCount: does not match ineligible candidates"
        )
    if any(
        not candidate["eligible"]
        for candidate in candidates[: len(eligible_candidates)]
    ):
        semantic_errors.append(
            "$.candidates: eligible candidates must precede ineligible candidates"
        )
    ranks = [candidate["rank"] for candidate in eligible_candidates]
    if ranks != list(range(1, len(eligible_candidates) + 1)):
        semantic_errors.append(
            "$.candidates: eligible candidate ranks must be contiguous and ordered"
        )
    eligible_sort_keys = [
        (
            -Decimal(str(candidate["score"])),
            candidate["components"]["mileage"]["differenceMiles"] is None,
            candidate["components"]["mileage"]["differenceMiles"] or 0,
            candidate["components"]["distance"]["distanceMiles"] is None,
            Decimal(
                str(candidate["components"]["distance"]["distanceMiles"] or 0)
            ),
        )
        for candidate in eligible_candidates
    ]
    if eligible_sort_keys != sorted(eligible_sort_keys):
        semantic_errors.append(
            "$.candidates: eligible candidates do not follow ranking tie-breaks"
        )
    expected_tier_counts = {
        "STRONG": sum(candidate["tier"] == "STRONG" for candidate in candidates),
        "GOOD": sum(candidate["tier"] == "GOOD" for candidate in candidates),
        "WEAK": sum(candidate["tier"] == "WEAK" for candidate in candidates),
        "INELIGIBLE": len(ineligible_candidates),
    }
    if data["tierCounts"] != expected_tier_counts:
        semantic_errors.append("$.tierCounts: does not match candidate tiers")
    seen_listing_ids: set[str] = set()
    for index, candidate in enumerate(candidates):
        if candidate["listing"]["source"] != data["provider"]:
            semantic_errors.append(
                f"$.candidates[{index}].listing.source: expected "
                f"{data['provider']!r}"
            )
        listing_id = candidate["listing"].get("sourceListingId")
        if listing_id is not None:
            if listing_id in seen_listing_ids:
                semantic_errors.append(
                    f"$.candidates[{index}].listing.sourceListingId: duplicate "
                    f"same-provider ID {listing_id!r}"
                )
            seen_listing_ids.add(listing_id)
    if semantic_errors:
        raise ComparableContractError(
            "Comparable ranking result failed contract validation",
            tuple(semantic_errors),
        )


__all__ = [
    "CANDIDATE_SCHEMA_PATH",
    "COMPARABLE_SCHEMA_DIR",
    "COMPARABLE_SCORING_VERSION",
    "DISTANCE_MAX_SCORE",
    "GOOD_SCORE_MINIMUM",
    "MILEAGE_MAX_SCORE",
    "RANKING_RESULT_SCHEMA_PATH",
    "STRONG_SCORE_MINIMUM",
    "TARGET_SCHEMA_PATH",
    "TRIM_MAX_SCORE",
    "YEAR_MAX_SCORE",
    "ComparableCandidate",
    "ComparableContractError",
    "ComparableRankingResult",
    "ComparableScoreComponents",
    "ComparableTarget",
    "DistanceScoreComponent",
    "MileageScoreComponent",
    "TrimScoreComponent",
    "YearScoreComponent",
    "comparable_target_from_report",
    "comparable_target_from_search_request",
    "rank_market_comparables",
    "validate_comparable_candidate",
    "validate_comparable_ranking_result",
    "validate_comparable_target",
]
