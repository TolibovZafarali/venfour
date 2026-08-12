"""Conservative, deterministic comparison of CCC and independent market evidence.

Phase 3D consumes already-normalized CCC facts and already-ranked external
listings.  It deliberately performs no retrieval, PDF parsing, provider calls,
or proprietary vehicle-price adjustments.  Prices are selected solely through
the existing Phase 3C rank before this module reads or summarizes them.
"""

from __future__ import annotations

import copy
import json
import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from venfour.comparables import (
    GOOD_SCORE_MINIMUM,
    STRONG_SCORE_MINIMUM,
    ComparableContractError,
    ComparableRankingResult,
    ComparableTarget,
    comparable_target_from_report,
    validate_comparable_ranking_result,
    validate_comparable_target,
)
from venfour.historical_market import (
    LISTING_RECORD_ACTIVE_ON_DATE,
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    HistoricalMarketSearchResult,
    validate_historical_market_search_result,
)
from venfour.market import MarketContractError


VALUATION_DISCREPANCY_ANALYSIS_VERSION = "1"

INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
NO_MATERIAL_DISCREPANCY = "NO_MATERIAL_DISCREPANCY"
POTENTIAL_UNDERVALUE = "POTENTIAL_UNDERVALUE"
MATERIAL_UNDERVALUE_SIGNAL = "MATERIAL_UNDERVALUE_SIGNAL"
CONFLICTING_EVIDENCE = "CONFLICTING_EVIDENCE"

LOW = "LOW"
MODERATE = "MODERATE"
STRONG = "STRONG"

NO_PRIMARY_EVIDENCE = "NONE"
LOSS_DATE_HISTORICAL = "LOSS_DATE_HISTORICAL"
CURRENT_MARKET = "CURRENT_MARKET"

BELOW_OBSERVED_RANGE = "BELOW_OBSERVED_RANGE"
WITHIN_OBSERVED_RANGE = "WITHIN_OBSERVED_RANGE"
ABOVE_OBSERVED_RANGE = "ABOVE_OBSERVED_RANGE"

MISSING_CCC_VEHICLE_VALUATION = "MISSING_CCC_VEHICLE_VALUATION"
NONPOSITIVE_CCC_VEHICLE_VALUATION = "NONPOSITIVE_CCC_VEHICLE_VALUATION"
INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE = (
    "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE"
)
EXTERNAL_MEDIAN_ZERO = "EXTERNAL_MEDIAN_ZERO"
EXTERNAL_MEDIAN_ABOVE_CCC = "EXTERNAL_MEDIAN_ABOVE_CCC"
EXTERNAL_MEDIAN_BELOW_CCC = "EXTERNAL_MEDIAN_BELOW_CCC"
EXTERNAL_MEDIAN_EQUALS_CCC = "EXTERNAL_MEDIAN_EQUALS_CCC"
CCC_BELOW_EXTERNAL_RANGE = "CCC_BELOW_EXTERNAL_RANGE"
CCC_WITHIN_EXTERNAL_RANGE = "CCC_WITHIN_EXTERNAL_RANGE"
CCC_ABOVE_EXTERNAL_RANGE = "CCC_ABOVE_EXTERNAL_RANGE"
EXTERNAL_MARKET_HIGH_DISPERSION = "EXTERNAL_MARKET_HIGH_DISPERSION"
CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT = "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT"
HISTORICAL_PRIMARY_EVIDENCE = "HISTORICAL_PRIMARY_EVIDENCE"
CURRENT_PRIMARY_EVIDENCE = "CURRENT_PRIMARY_EVIDENCE"
CURRENT_MARKET_ONLY = "CURRENT_MARKET_ONLY"
CURRENT_EVIDENCE_SECONDARY = "CURRENT_EVIDENCE_SECONDARY"
HISTORICAL_CURRENT_SIGNALS_CONFLICT = "HISTORICAL_CURRENT_SIGNALS_CONFLICT"
HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE = (
    "HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE"
)
AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED = (
    "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED"
)
UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED = (
    "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED"
)
IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED = (
    "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED"
)
DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED = (
    "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED"
)
EXTERNAL_COMPARISON_SET_BOUNDED = "EXTERNAL_COMPARISON_SET_BOUNDED"
CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES = (
    "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES"
)
CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES = (
    "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES"
)
CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE = "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE"
POTENTIAL_GAP_THRESHOLD_MET = "POTENTIAL_GAP_THRESHOLD_MET"
MATERIAL_GAP_THRESHOLD_MET = "MATERIAL_GAP_THRESHOLD_MET"

ADVERTISED_PRICES_NOT_TRANSACTIONS = "ADVERTISED_PRICES_NOT_TRANSACTIONS"
NO_INDEPENDENT_MILEAGE_ADJUSTMENT = "NO_INDEPENDENT_MILEAGE_ADJUSTMENT"
NO_INDEPENDENT_CONDITION_ADJUSTMENT = "NO_INDEPENDENT_CONDITION_ADJUSTMENT"
NO_INDEPENDENT_OPTIONS_ADJUSTMENT = "NO_INDEPENDENT_OPTIONS_ADJUSTMENT"
PROVIDER_COVERAGE_LIMITED = "PROVIDER_COVERAGE_LIMITED"
CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE = (
    "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE"
)
HISTORICAL_DATE_LEVEL_ONLY = "HISTORICAL_DATE_LEVEL_ONLY"
HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET = (
    "HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET"
)
AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED = (
    "AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED"
)
UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED = (
    "UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED"
)
BOUNDED_EXTERNAL_COMPARISON_SET = "BOUNDED_EXTERNAL_COMPARISON_SET"
NOT_AN_INDEPENDENT_APPRAISAL = "NOT_AN_INDEPENDENT_APPRAISAL"
DOES_NOT_CALCULATE_LEGAL_SETTLEMENT = "DOES_NOT_CALCULATE_LEGAL_SETTLEMENT"
POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS = "POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS"
NEGOTIATION_OUTPUT_NOT_INCLUDED = "NEGOTIATION_OUTPUT_NOT_INCLUDED"

ADJUSTMENT_FIELDS = ("package", "options", "mileage", "condition")

# Every emitted monetary integer remains exactly representable by common JSON
# consumers.  Incoming dollar values are rounded once at this cents boundary.
MAX_SAFE_MONEY_CENTS = 9_007_199_254_740_991
MINIMUM_INDEPENDENT_EVIDENCE_COUNT = 3
_ONE_CENT = Decimal("1")

REPO_ROOT = Path(__file__).resolve().parents[1]
VALUATION_DISCREPANCY_REQUEST_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "analysis" / "valuation-discrepancy-request.schema.json"
)
VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "analysis" / "valuation-discrepancy-result.schema.json"
)


class DiscrepancyContractError(Exception):
    """A Phase 3D request, result, or policy failed contract validation."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class ValuationDiscrepancyPolicy:
    """Named Venfour policy thresholds, not legal or industry standards."""

    max_comparison_set: int = 9
    minimum_independent_count: int = 3
    strong_historical_minimum: int = 5
    potential_gap_basis_points: int = 500
    material_gap_basis_points: int = 1000
    high_dispersion_basis_points: int = 2000

    def to_dict(self) -> dict[str, int]:
        return {
            "maxComparisonSet": self.max_comparison_set,
            "minimumIndependentCount": self.minimum_independent_count,
            "strongHistoricalMinimum": self.strong_historical_minimum,
            "potentialGapBasisPoints": self.potential_gap_basis_points,
            "materialGapBasisPoints": self.material_gap_basis_points,
            "highDispersionBasisPoints": self.high_dispersion_basis_points,
        }


@dataclass(frozen=True)
class HistoricalEvidenceInput:
    """Date-specific provider result and its optional Phase 3C projection."""

    result: HistoricalMarketSearchResult
    ranking: ComparableRankingResult | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "result": self.result.to_dict(),
            "ranking": self.ranking.to_dict() if self.ranking is not None else None,
        }


@dataclass(frozen=True)
class CurrentEvidenceInput:
    """Current-market Phase 3C ranking with optional observation date."""

    ranking: ComparableRankingResult
    observed_date: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ranking": self.ranking.to_dict(),
            "observedDate": self.observed_date,
        }


@dataclass(frozen=True)
class ValuationDiscrepancyRequest:
    """Strict projection of normalized inputs needed for Phase 3D only."""

    loss_vehicle: ComparableTarget
    ccc_vehicle_valuation: int | float | None
    ccc_comparables: tuple[Mapping[str, Any], ...]
    loss_date: str | None = None
    historical_evidence: HistoricalEvidenceInput | None = None
    current_evidence: CurrentEvidenceInput | None = None
    policy: ValuationDiscrepancyPolicy = field(
        default_factory=ValuationDiscrepancyPolicy
    )

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "ccc_comparables",
            tuple(copy.deepcopy(dict(item)) for item in self.ccc_comparables),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "lossVehicle": self.loss_vehicle.to_dict(),
            "lossDate": self.loss_date,
            "cccVehicleValuation": self.ccc_vehicle_valuation,
            "cccComparables": [copy.deepcopy(dict(item)) for item in self.ccc_comparables],
            "historicalEvidence": (
                self.historical_evidence.to_dict()
                if self.historical_evidence is not None
                else None
            ),
            "currentEvidence": (
                self.current_evidence.to_dict()
                if self.current_evidence is not None
                else None
            ),
            "policy": self.policy.to_dict(),
        }


@dataclass(frozen=True)
class MoneySummary:
    """Exact descriptive statistics for integer-cent observations."""

    count: int
    minimum_cents: int | None
    maximum_cents: int | None
    median_cents: int | None
    range_cents: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "minimumCents": self.minimum_cents,
            "maximumCents": self.maximum_cents,
            "medianCents": self.median_cents,
            "rangeCents": self.range_cents,
        }


@dataclass(frozen=True)
class PriceSummary:
    """Market-price statistics with a transparent robust dispersion measure."""

    count: int
    minimum_price_cents: int | None
    maximum_price_cents: int | None
    median_price_cents: int | None
    range_cents: int | None
    median_absolute_deviation_cents: int | None
    central_half_range_cents: int | None
    dispersion_basis_points: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "minimumPriceCents": self.minimum_price_cents,
            "maximumPriceCents": self.maximum_price_cents,
            "medianPriceCents": self.median_price_cents,
            "rangeCents": self.range_cents,
            "medianAbsoluteDeviationCents": self.median_absolute_deviation_cents,
            "centralHalfRangeCents": self.central_half_range_cents,
            "dispersionBasisPoints": self.dispersion_basis_points,
        }


@dataclass(frozen=True)
class CccAdjustmentAmounts:
    package_cents: int | None
    options_cents: int | None
    mileage_cents: int | None
    condition_cents: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "packageCents": self.package_cents,
            "optionsCents": self.options_cents,
            "mileageCents": self.mileage_cents,
            "conditionCents": self.condition_cents,
        }


@dataclass(frozen=True)
class CccComparableEvidence:
    index: int
    comparable_number: int | None
    year: int | None
    make: str | None
    model: str | None
    trim: str | None
    vin: str | None
    dealer: str | None
    location: str | None
    distance_miles: int | float | None
    mileage: int | None
    list_price_cents: int | None
    adjusted_value_cents: int | None
    net_adjustment_cents: int | None
    adjustments: CccAdjustmentAmounts
    adjustment_disclosure: str
    contribution_percent: int | float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "comparableNumber": self.comparable_number,
            "year": self.year,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "vin": self.vin,
            "dealer": self.dealer,
            "location": self.location,
            "distanceMiles": self.distance_miles,
            "mileage": self.mileage,
            "listPriceCents": self.list_price_cents,
            "adjustedValueCents": self.adjusted_value_cents,
            "netAdjustmentCents": self.net_adjustment_cents,
            "adjustments": self.adjustments.to_dict(),
            "adjustmentDisclosure": self.adjustment_disclosure,
            "contributionPercent": self.contribution_percent,
        }


@dataclass(frozen=True)
class CccComparableSummary:
    total_count: int
    advertised_price_missing_count: int
    adjusted_value_missing_count: int
    paired_value_count: int
    paired_value_missing_count: int
    fully_disclosed_adjustment_count: int
    partially_disclosed_adjustment_count: int
    undisclosed_adjustment_count: int
    unavailable_adjustment_count: int
    advertised_prices: PriceSummary
    adjusted_values: PriceSummary
    net_adjustments: MoneySummary
    comparables: tuple[CccComparableEvidence, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "totalCount": self.total_count,
            "advertisedPriceMissingCount": self.advertised_price_missing_count,
            "adjustedValueMissingCount": self.adjusted_value_missing_count,
            "pairedValueCount": self.paired_value_count,
            "pairedValueMissingCount": self.paired_value_missing_count,
            "fullyDisclosedAdjustmentCount": self.fully_disclosed_adjustment_count,
            "partiallyDisclosedAdjustmentCount": self.partially_disclosed_adjustment_count,
            "undisclosedAdjustmentCount": self.undisclosed_adjustment_count,
            "unavailableAdjustmentCount": self.unavailable_adjustment_count,
            "advertisedPrices": self.advertised_prices.to_dict(),
            "adjustedValues": self.adjusted_values.to_dict(),
            "netAdjustments": self.net_adjustments.to_dict(),
            "comparables": [item.to_dict() for item in self.comparables],
        }


@dataclass(frozen=True)
class SelectedExternalEvidence:
    source: str
    source_listing_id: str | None
    vin: str | None
    year: int
    make: str
    model: str
    trim: str | None
    price_cents: int
    mileage: int | None
    loss_vehicle_mileage: int | None
    mileage_difference_from_loss_vehicle: int | None
    distance_miles: int | float | None
    rank: int
    score: int | float
    tier: str
    temporal_basis: str
    evidence_date: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "sourceListingId": self.source_listing_id,
            "vin": self.vin,
            "year": self.year,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "priceCents": self.price_cents,
            "mileage": self.mileage,
            "lossVehicleMileage": self.loss_vehicle_mileage,
            "mileageDifferenceFromLossVehicle": (
                self.mileage_difference_from_loss_vehicle
            ),
            "distanceMiles": self.distance_miles,
            "rank": self.rank,
            "score": self.score,
            "tier": self.tier,
            "temporalBasis": self.temporal_basis,
            "evidenceDate": self.evidence_date,
        }


@dataclass(frozen=True)
class ExternalEvidenceSummary:
    evidence_basis: str
    evidence_date: str | None
    coverage_status: str | None
    resolved_count: int
    unresolved_count: int
    ambiguous_count: int
    ranked_candidate_count: int
    eligible_candidate_count: int
    ineligible_count: int
    identity_missing_excluded_count: int
    duplicate_identity_excluded_count: int
    comparison_set_limit_excluded_count: int
    selected_count: int
    selected_weak_count: int
    prices: PriceSummary
    selected_evidence: tuple[SelectedExternalEvidence, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidenceBasis": self.evidence_basis,
            "evidenceDate": self.evidence_date,
            "coverageStatus": self.coverage_status,
            "resolvedCount": self.resolved_count,
            "unresolvedCount": self.unresolved_count,
            "ambiguousCount": self.ambiguous_count,
            "rankedCandidateCount": self.ranked_candidate_count,
            "eligibleCandidateCount": self.eligible_candidate_count,
            "ineligibleCount": self.ineligible_count,
            "identityMissingExcludedCount": self.identity_missing_excluded_count,
            "duplicateIdentityExcludedCount": self.duplicate_identity_excluded_count,
            "comparisonSetLimitExcludedCount": (
                self.comparison_set_limit_excluded_count
            ),
            "selectedCount": self.selected_count,
            "selectedWeakCount": self.selected_weak_count,
            "prices": self.prices.to_dict(),
            "selectedEvidence": [item.to_dict() for item in self.selected_evidence],
        }


@dataclass(frozen=True)
class ValueComparison:
    first_value_cents: int
    second_value_cents: int
    difference_cents: int
    difference_basis_points: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "firstValueCents": self.first_value_cents,
            "secondValueCents": self.second_value_cents,
            "differenceCents": self.difference_cents,
            "differenceBasisPoints": self.difference_basis_points,
        }


@dataclass(frozen=True)
class PrimaryComparison:
    evidence_basis: str
    external_median_price_cents: int
    ccc_vehicle_valuation_cents: int
    difference_cents: int
    difference_basis_points: int | None
    ccc_position_in_external_range: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidenceBasis": self.evidence_basis,
            "externalMedianPriceCents": self.external_median_price_cents,
            "cccVehicleValuationCents": self.ccc_vehicle_valuation_cents,
            "differenceCents": self.difference_cents,
            "differenceBasisPoints": self.difference_basis_points,
            "cccPositionInExternalRange": self.ccc_position_in_external_range,
        }


@dataclass(frozen=True)
class SecondaryComparisons:
    ccc_adjusted_median_vs_vehicle_valuation: ValueComparison | None
    ccc_advertised_median_vs_adjusted_median: ValueComparison | None
    external_median_vs_ccc_adjusted_median: ValueComparison | None

    def to_dict(self) -> dict[str, Any]:
        def serialized(value: ValueComparison | None) -> dict[str, Any] | None:
            return value.to_dict() if value is not None else None

        return {
            "cccAdjustedMedianVsVehicleValuation": serialized(
                self.ccc_adjusted_median_vs_vehicle_valuation
            ),
            "cccAdvertisedMedianVsAdjustedMedian": serialized(
                self.ccc_advertised_median_vs_adjusted_median
            ),
            "externalMedianVsCccAdjustedMedian": serialized(
                self.external_median_vs_ccc_adjusted_median
            ),
        }


@dataclass(frozen=True)
class DiscrepancyMessage:
    code: str
    description: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "description": self.description}


@dataclass(frozen=True)
class ValuationDiscrepancyResult:
    analysis_version: str
    classification: str
    evidence_strength: str
    evidence_basis: str
    policy: ValuationDiscrepancyPolicy
    ccc_vehicle_valuation_cents: int | None
    ccc_comparable_summary: CccComparableSummary
    historical_external_summary: ExternalEvidenceSummary | None
    current_external_summary: ExternalEvidenceSummary | None
    primary_comparison: PrimaryComparison | None
    secondary_comparisons: SecondaryComparisons
    findings: tuple[DiscrepancyMessage, ...]
    limitations: tuple[DiscrepancyMessage, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "analysisVersion": self.analysis_version,
            "classification": self.classification,
            "evidenceStrength": self.evidence_strength,
            "evidenceBasis": self.evidence_basis,
            "policy": self.policy.to_dict(),
            "cccVehicleValuationCents": self.ccc_vehicle_valuation_cents,
            "cccComparableSummary": self.ccc_comparable_summary.to_dict(),
            "historicalExternalSummary": (
                self.historical_external_summary.to_dict()
                if self.historical_external_summary is not None
                else None
            ),
            "currentExternalSummary": (
                self.current_external_summary.to_dict()
                if self.current_external_summary is not None
                else None
            ),
            "primaryComparison": (
                self.primary_comparison.to_dict()
                if self.primary_comparison is not None
                else None
            ),
            "secondaryComparisons": self.secondary_comparisons.to_dict(),
            "findings": [item.to_dict() for item in self.findings],
            "limitations": [item.to_dict() for item in self.limitations],
        }


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


@lru_cache(maxsize=None)
def _read_schema(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise DiscrepancyContractError(
            f"Discrepancy schema could not be read: {path}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise DiscrepancyContractError(
            f"Discrepancy schema is not valid JSON: {path}"
        ) from exc
    if not isinstance(data, dict):
        raise DiscrepancyContractError(
            f"Discrepancy schema root must be an object: {path}"
        )
    try:
        Draft202012Validator.check_schema(data)
    except SchemaError as exc:
        raise DiscrepancyContractError(
            f"Discrepancy schema is invalid: {path}", (exc.message,)
        ) from exc
    return data


def _validate_schema(data: Any, path: Path, label: str) -> None:
    compatibility_errors = _json_compatibility_errors(data)
    if compatibility_errors:
        raise DiscrepancyContractError(
            f"{label} failed contract validation", tuple(compatibility_errors)
        )
    errors = sorted(
        Draft202012Validator(
            _read_schema(path), format_checker=FormatChecker()
        ).iter_errors(data),
        key=lambda error: (_json_path(list(error.absolute_path)), error.message),
    )
    if errors:
        raise DiscrepancyContractError(
            f"{label} failed contract validation",
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in errors
            ),
        )


def _decimal_json_number(value: Any, path: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: expected a JSON number",),
        )
    if isinstance(value, float) and not math.isfinite(value):
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: expected a finite JSON number",),
        )
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: expected a finite JSON number",),
        ) from exc
    if not parsed.is_finite():
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: expected a finite JSON number",),
        )
    return parsed


def _money_to_cents(
    value: Any,
    path: str,
    *,
    nullable: bool = True,
    allow_negative: bool = False,
) -> int | None:
    if value is None and nullable:
        return None
    parsed = _decimal_json_number(value, path)
    if not allow_negative and parsed < 0:
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: must not be negative",),
        )
    try:
        cents_decimal = (parsed * Decimal(100)).quantize(
            _ONE_CENT, rounding=ROUND_HALF_UP
        )
    except (InvalidOperation, OverflowError) as exc:
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: exceeds the supported integer-cent range",),
        ) from exc
    cents = int(cents_decimal)
    if abs(cents) > MAX_SAFE_MONEY_CENTS:
        raise DiscrepancyContractError(
            "Discrepancy money failed contract validation",
            (f"{path}: exceeds the safe integer-cent limit",),
        )
    return cents


def _rounded_integer_ratio(numerator: int, denominator: int) -> int | None:
    if denominator == 0:
        return None
    value = (Decimal(numerator) / Decimal(denominator)).quantize(
        _ONE_CENT, rounding=ROUND_HALF_UP
    )
    return int(value)


def _difference_basis_points(difference_cents: int, baseline_cents: int) -> int | None:
    result = _rounded_integer_ratio(difference_cents * 10_000, baseline_cents)
    if result is None:
        return None
    return max(-10_000, result)


def _median_cents(values: Sequence[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return int(
        (
            (Decimal(ordered[midpoint - 1]) + Decimal(ordered[midpoint]))
            / Decimal(2)
        ).quantize(_ONE_CENT, rounding=ROUND_HALF_UP)
    )


def _median_fraction(values: Sequence[int | Fraction]) -> Fraction:
    if not values:
        raise ValueError("median requires at least one observation")
    ordered = sorted(Fraction(value) for value in values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def _round_fraction_half_up(value: Fraction) -> int:
    sign = -1 if value < 0 else 1
    numerator = abs(value.numerator)
    quotient, remainder = divmod(numerator, value.denominator)
    if remainder * 2 >= value.denominator:
        quotient += 1
    return sign * quotient


def _exact_price_dispersion(values: Sequence[int]) -> tuple[Fraction, Fraction, Fraction]:
    ordered = sorted(values)
    median = _median_fraction(ordered)
    mad = _median_fraction([abs(Fraction(value) - median) for value in ordered])
    central_half_range = (
        Fraction(ordered[-2] - ordered[1], 2) if len(ordered) >= 3 else Fraction(0)
    )
    return median, mad, central_half_range


def _money_summary(values: Sequence[int]) -> MoneySummary:
    if not values:
        return MoneySummary(0, None, None, None, None)
    minimum = min(values)
    maximum = max(values)
    return MoneySummary(
        count=len(values),
        minimum_cents=minimum,
        maximum_cents=maximum,
        median_cents=_median_cents(values),
        range_cents=maximum - minimum,
    )


def _price_summary(values: Sequence[int]) -> PriceSummary:
    if not values:
        return PriceSummary(0, None, None, None, None, None, None, None)
    if any(value < 0 for value in values):
        raise DiscrepancyContractError(
            "Price summary failed contract validation",
            ("$: price observations must not be negative",),
        )
    minimum = min(values)
    maximum = max(values)
    exact_median, exact_mad, central_half_range = _exact_price_dispersion(values)
    median = _round_fraction_half_up(exact_median)
    mad = _round_fraction_half_up(exact_mad)
    central_half_range_cents = _round_fraction_half_up(central_half_range)
    robust_dispersion = max(exact_mad, central_half_range)
    dispersion = (
        min(
            10_000,
            _round_fraction_half_up(robust_dispersion * 10_000 / exact_median),
        )
        if exact_median != 0
        else None
    )
    return PriceSummary(
        count=len(values),
        minimum_price_cents=minimum,
        maximum_price_cents=maximum,
        median_price_cents=median,
        range_cents=maximum - minimum,
        median_absolute_deviation_cents=mad,
        central_half_range_cents=central_half_range_cents,
        dispersion_basis_points=dispersion,
    )


def _policy_semantic_errors(data: Mapping[str, Any], path: str = "$.policy") -> list[str]:
    errors: list[str] = []
    maximum = data["maxComparisonSet"]
    minimum = data["minimumIndependentCount"]
    strong = data["strongHistoricalMinimum"]
    potential = data["potentialGapBasisPoints"]
    material = data["materialGapBasisPoints"]
    dispersion = data["highDispersionBasisPoints"]
    for name, value in (
        ("maxComparisonSet", maximum),
        ("minimumIndependentCount", minimum),
        ("strongHistoricalMinimum", strong),
    ):
        if value < MINIMUM_INDEPENDENT_EVIDENCE_COUNT:
            errors.append(
                f"{path}.{name}: must be at least "
                f"{MINIMUM_INDEPENDENT_EVIDENCE_COUNT}"
            )
    if not (minimum <= strong <= maximum):
        errors.append(
            f"{path}: expected minimumIndependentCount <= "
            "strongHistoricalMinimum <= maxComparisonSet"
        )
    if potential >= material:
        errors.append(
            f"{path}: potentialGapBasisPoints must be less than "
            "materialGapBasisPoints"
        )
    for name, value in (
        ("potentialGapBasisPoints", potential),
        ("materialGapBasisPoints", material),
        ("highDispersionBasisPoints", dispersion),
    ):
        if not 0 <= value <= 10_000:
            errors.append(f"{path}.{name}: must be between 0 and 10000")
    return errors


def validate_valuation_discrepancy_policy(
    policy: ValuationDiscrepancyPolicy | Mapping[str, Any],
) -> None:
    data = policy.to_dict() if isinstance(policy, ValuationDiscrepancyPolicy) else policy
    if not isinstance(data, Mapping):
        raise DiscrepancyContractError(
            "Valuation discrepancy policy failed contract validation",
            ("$: expected an object",),
        )
    expected = {
        "maxComparisonSet",
        "minimumIndependentCount",
        "strongHistoricalMinimum",
        "potentialGapBasisPoints",
        "materialGapBasisPoints",
        "highDispersionBasisPoints",
    }
    details: list[str] = []
    if set(data) != expected:
        missing = sorted(expected - set(data))
        extra = sorted(set(data) - expected)
        if missing:
            details.append(f"$: missing policy fields {missing}")
        if extra:
            details.append(f"$: unknown policy fields {extra}")
    for key in expected & set(data):
        value = data[key]
        if not isinstance(value, int) or isinstance(value, bool):
            details.append(f"$.{key}: expected an integer")
        elif key in {
            "maxComparisonSet",
            "minimumIndependentCount",
            "strongHistoricalMinimum",
        } and value < MINIMUM_INDEPENDENT_EVIDENCE_COUNT:
            details.append(
                f"$.{key}: must be at least "
                f"{MINIMUM_INDEPENDENT_EVIDENCE_COUNT}"
            )
    if not details:
        details.extend(_policy_semantic_errors(data, "$"))
    if details:
        raise DiscrepancyContractError(
            "Valuation discrepancy policy failed contract validation", tuple(details)
        )


def _parse_iso_date(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DiscrepancyContractError(
            "Valuation discrepancy date failed contract validation",
            (f"{path}: expected an ISO YYYY-MM-DD date",),
        )
    normalized = value.strip()
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise DiscrepancyContractError(
            "Valuation discrepancy date failed contract validation",
            (f"{path}: expected an ISO YYYY-MM-DD date",),
        ) from exc
    if parsed.isoformat() != normalized:
        raise DiscrepancyContractError(
            "Valuation discrepancy date failed contract validation",
            (f"{path}: expected an ISO YYYY-MM-DD date",),
        )
    return normalized


def _normalize_report_loss_date(value: Any, path: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise DiscrepancyContractError(
            "CCC loss date failed contract validation",
            (f"{path}: expected YYYY-MM-DD or MM/DD/YYYY",),
        )
    normalized = value.strip()
    try:
        return date.fromisoformat(normalized).isoformat()
    except ValueError:
        pass
    try:
        return datetime.strptime(normalized, "%m/%d/%Y").date().isoformat()
    except ValueError as exc:
        raise DiscrepancyContractError(
            "CCC loss date failed contract validation",
            (f"{path}: expected YYYY-MM-DD or MM/DD/YYYY",),
        ) from exc


def _listing_fingerprint(listing: Mapping[str, Any]) -> str:
    return json.dumps(
        listing,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _validate_ranking_pairing(
    ranking: Mapping[str, Any],
    target: Mapping[str, Any],
    *,
    path: str,
) -> list[str]:
    errors: list[str] = []
    if ranking["target"] != target:
        errors.append(f"{path}.target: must match $.lossVehicle")
    return errors


def _external_ranking_money_errors(
    ranking: Mapping[str, Any], path: str
) -> list[str]:
    errors: list[str] = []
    for index, candidate in enumerate(ranking["candidates"]):
        try:
            _money_to_cents(
                candidate["listing"]["price"],
                f"{path}.candidates[{index}].listing.price",
                nullable=False,
                allow_negative=False,
            )
        except DiscrepancyContractError as exc:
            errors.extend(exc.details)
    return errors


def _request_semantic_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    policy = data["policy"]
    errors.extend(_policy_semantic_errors(policy))

    try:
        validate_comparable_target(data["lossVehicle"])
    except ComparableContractError as exc:
        errors.extend(f"$.lossVehicle{detail[1:]}" for detail in exc.details)

    loss_date = data["lossDate"]
    if loss_date is not None:
        try:
            _parse_iso_date(loss_date, "$.lossDate")
        except DiscrepancyContractError as exc:
            errors.extend(exc.details)

    try:
        _money_to_cents(
            data["cccVehicleValuation"],
            "$.cccVehicleValuation",
            nullable=True,
            allow_negative=False,
        )
    except DiscrepancyContractError as exc:
        errors.extend(exc.details)

    for index, comparable in enumerate(data["cccComparables"]):
        for field_name in ("listPrice", "adjustedValue"):
            try:
                _money_to_cents(
                    comparable.get(field_name),
                    f"$.cccComparables[{index}].{field_name}",
                    nullable=True,
                    allow_negative=False,
                )
            except DiscrepancyContractError as exc:
                errors.extend(exc.details)
        adjustments = comparable.get("adjustments")
        if not isinstance(adjustments, Mapping):
            errors.append(
                f"$.cccComparables[{index}].adjustments: expected an object"
            )
            continue
        for field_name in ADJUSTMENT_FIELDS:
            try:
                _money_to_cents(
                    adjustments.get(field_name),
                    f"$.cccComparables[{index}].adjustments.{field_name}",
                    nullable=True,
                    allow_negative=True,
                )
            except DiscrepancyContractError as exc:
                errors.extend(exc.details)

    paired_net_adjustments: list[int] = []
    for index, comparable in enumerate(data["cccComparables"]):
        try:
            list_price = _money_to_cents(
                comparable.get("listPrice"),
                f"$.cccComparables[{index}].listPrice",
                nullable=True,
            )
            adjusted_value = _money_to_cents(
                comparable.get("adjustedValue"),
                f"$.cccComparables[{index}].adjustedValue",
                nullable=True,
            )
        except DiscrepancyContractError:
            continue
        if list_price is not None and adjusted_value is not None:
            paired_net_adjustments.append(adjusted_value - list_price)
    if (
        paired_net_adjustments
        and max(paired_net_adjustments) - min(paired_net_adjustments)
        > MAX_SAFE_MONEY_CENTS
    ):
        errors.append(
            "$.cccComparables: paired net-adjustment range exceeds the safe "
            "integer-cent output limit"
        )

    target = data["lossVehicle"]
    historical = data["historicalEvidence"]
    if historical is not None:
        result = historical["result"]
        ranking = historical["ranking"]
        try:
            validate_historical_market_search_result(result)
        except MarketContractError as exc:
            errors.extend(
                f"$.historicalEvidence.result{detail[1:]}" for detail in exc.details
            )
        resolved_vins = {
            item["listing"]["vin"].casefold()
            for item in result["evidence"]
            if item["listing"].get("vin") is not None
        }
        resolved_listing_ids = {
            item["listing"]["sourceListingId"]
            for item in result["evidence"]
            if item["listing"].get("sourceListingId") is not None
        }
        for index, issue in enumerate(result["issues"]):
            issue_vin = issue.get("vin")
            issue_listing_id = issue.get("sourceListingId")
            if (
                issue_vin is not None
                and issue_vin.casefold() in resolved_vins
                or issue_listing_id is not None
                and issue_listing_id in resolved_listing_ids
            ):
                errors.append(
                    f"$.historicalEvidence.result.issues[{index}]: an ambiguous or "
                    "unresolved identity cannot also contribute resolved price evidence"
                )
        historical_request = result["request"]
        historical_target = {
            "year": historical_request["year"],
            "make": historical_request["make"],
            "model": historical_request["model"],
            "trim": historical_request.get("trim"),
            "mileage": historical_request.get("lossVehicleMileage"),
            "postalCode": historical_request["postalCode"],
        }
        if historical_target != target:
            errors.append(
                "$.historicalEvidence.result.request: vehicle and distance-origin "
                "fields must match $.lossVehicle"
            )
        coverage = result["coverage"]["status"]
        if loss_date is None:
            errors.append(
                "$.lossDate: is required when historical evidence is supplied"
            )
        elif result["evidenceDate"] != loss_date:
            errors.append(
                "$.historicalEvidence.result.evidenceDate: must match $.lossDate"
            )
        if coverage == OUT_OF_PROVIDER_RANGE:
            if ranking is not None:
                errors.append(
                    "$.historicalEvidence.ranking: must be null when coverage is "
                    "OUT_OF_PROVIDER_RANGE"
                )
        elif coverage == SUPPORTED:
            if result["evidence"] and ranking is None:
                errors.append(
                    "$.historicalEvidence.ranking: resolved historical evidence "
                    "requires a Phase 3C ranking"
                )
            if ranking is not None:
                try:
                    validate_comparable_ranking_result(ranking)
                except ComparableContractError as exc:
                    errors.extend(
                        f"$.historicalEvidence.ranking{detail[1:]}"
                        for detail in exc.details
                    )
                errors.extend(
                    _validate_ranking_pairing(
                        ranking,
                        target,
                        path="$.historicalEvidence.ranking",
                    )
                )
                errors.extend(
                    _external_ranking_money_errors(
                        ranking, "$.historicalEvidence.ranking"
                    )
                )
                if ranking["provider"] != result["provider"]:
                    errors.append(
                        "$.historicalEvidence.ranking.provider: must match the "
                        "historical result provider"
                    )
                if ranking["totalListingCount"] != result["listingCount"]:
                    errors.append(
                        "$.historicalEvidence.ranking.totalListingCount: must match "
                        "resolved historical listingCount"
                    )
                ranked_listings = Counter(
                    _listing_fingerprint(item["listing"])
                    for item in ranking["candidates"]
                )
                evidence_listings = Counter(
                    _listing_fingerprint(item["listing"])
                    for item in result["evidence"]
                )
                if ranked_listings != evidence_listings:
                    errors.append(
                        "$.historicalEvidence.ranking.candidates: listings must "
                        "exactly match resolved historical evidence, including price"
                    )
                else:
                    evidence_positions = {
                        _listing_fingerprint(item["listing"]): index
                        for index, item in enumerate(result["evidence"])
                    }

                    def historical_rank_key(
                        candidate: Mapping[str, Any],
                    ) -> tuple[Any, ...]:
                        provider_index = evidence_positions[
                            _listing_fingerprint(candidate["listing"])
                        ]
                        if not candidate["eligible"]:
                            return (1, provider_index)
                        mileage_difference = candidate["components"]["mileage"][
                            "differenceMiles"
                        ]
                        distance = candidate["components"]["distance"][
                            "distanceMiles"
                        ]
                        return (
                            0,
                            -Decimal(str(candidate["score"])),
                            mileage_difference is None,
                            mileage_difference if mileage_difference is not None else 0,
                            distance is None,
                            Decimal(str(distance)) if distance is not None else Decimal(0),
                            provider_index,
                        )

                    expected_order = sorted(
                        ranking["candidates"], key=historical_rank_key
                    )
                    if ranking["candidates"] != expected_order:
                        errors.append(
                            "$.historicalEvidence.ranking.candidates: must preserve "
                            "the resolved provider order for final Phase 3C ties"
                        )

    current = data["currentEvidence"]
    if current is not None:
        ranking = current["ranking"]
        try:
            validate_comparable_ranking_result(ranking)
        except ComparableContractError as exc:
            errors.extend(
                f"$.currentEvidence.ranking{detail[1:]}" for detail in exc.details
            )
        errors.extend(
            _validate_ranking_pairing(
                ranking, target, path="$.currentEvidence.ranking"
            )
        )
        errors.extend(
            _external_ranking_money_errors(ranking, "$.currentEvidence.ranking")
        )
        if current["observedDate"] is not None:
            try:
                _parse_iso_date(
                    current["observedDate"], "$.currentEvidence.observedDate"
                )
            except DiscrepancyContractError as exc:
                errors.extend(exc.details)
    return errors


def validate_valuation_discrepancy_request(
    request: ValuationDiscrepancyRequest | Mapping[str, Any],
) -> None:
    if isinstance(request, ValuationDiscrepancyRequest):
        try:
            data = request.to_dict()
        except (AttributeError, TypeError, ValueError) as exc:
            raise DiscrepancyContractError(
                "Valuation discrepancy request failed contract validation",
                (f"$: could not serialize request ({exc})",),
            ) from exc
    else:
        data = request
    _validate_schema(
        data,
        VALUATION_DISCREPANCY_REQUEST_SCHEMA_PATH,
        "Valuation discrepancy request",
    )
    semantic_errors = _request_semantic_errors(data)
    if semantic_errors:
        raise DiscrepancyContractError(
            "Valuation discrepancy request failed semantic validation",
            tuple(semantic_errors),
        )


def valuation_discrepancy_request_from_report(
    report: Mapping[str, Any],
    *,
    postal_code: str | None = None,
    loss_date_override: str | None = None,
    historical_evidence: HistoricalEvidenceInput | None = None,
    current_evidence: CurrentEvidenceInput | None = None,
    policy: ValuationDiscrepancyPolicy | None = None,
) -> ValuationDiscrepancyRequest:
    """Project exact existing CCC fields into a validated Phase 3D request.

    ``valuation.adjustedVehicleValue`` is the sole authoritative CCC vehicle
    amount.  This factory never substitutes ``baseVehicleValue`` or ``total``.
    """

    if not isinstance(report, Mapping):
        raise DiscrepancyContractError(
            "Canonical CCC report failed discrepancy projection",
            ("$: expected an object",),
        )
    try:
        target = comparable_target_from_report(report, postal_code=postal_code)
    except ComparableContractError as exc:
        raise DiscrepancyContractError(
            "Canonical CCC report failed discrepancy projection", exc.details
        ) from exc

    valuation = report.get("valuation")
    if valuation is not None and not isinstance(valuation, Mapping):
        raise DiscrepancyContractError(
            "Canonical CCC report failed discrepancy projection",
            ("$.valuation: expected an object",),
        )
    ccc_vehicle_valuation = (
        valuation.get("adjustedVehicleValue")
        if isinstance(valuation, Mapping)
        else None
    )

    raw_comparables = report.get("comparables")
    if raw_comparables is None:
        raw_comparables = []
    if not isinstance(raw_comparables, list) or any(
        not isinstance(item, Mapping) for item in raw_comparables
    ):
        raise DiscrepancyContractError(
            "Canonical CCC report failed discrepancy projection",
            ("$.comparables: expected an array of objects",),
        )

    if loss_date_override is not None:
        loss_date = _normalize_report_loss_date(
            loss_date_override, "$.lossDateOverride"
        )
    else:
        report_metadata = report.get("report")
        if report_metadata is not None and not isinstance(report_metadata, Mapping):
            raise DiscrepancyContractError(
                "Canonical CCC report failed discrepancy projection",
                ("$.report: expected an object",),
            )
        loss_date = _normalize_report_loss_date(
            report_metadata.get("lossDate")
            if isinstance(report_metadata, Mapping)
            else None,
            "$.report.lossDate",
        )

    projected_comparables: list[dict[str, Any]] = []
    for index, comparable in enumerate(raw_comparables):
        raw_adjustments = comparable.get("adjustments")
        if raw_adjustments is None:
            raw_adjustments = {}
        if not isinstance(raw_adjustments, Mapping):
            raise DiscrepancyContractError(
                "Canonical CCC report failed discrepancy projection",
                (f"$.comparables[{index}].adjustments: expected an object",),
            )
        projected_comparables.append(
            {
                "number": comparable.get("number"),
                "year": comparable.get("year"),
                "make": comparable.get("make"),
                "model": comparable.get("model"),
                "trim": comparable.get("trim"),
                "vin": comparable.get("vin"),
                "dealer": comparable.get("dealer"),
                "location": comparable.get("location"),
                "distanceMiles": comparable.get("distanceMiles"),
                "mileage": comparable.get("mileage"),
                "listPrice": comparable.get("listPrice"),
                "adjustments": {
                    name: raw_adjustments.get(name) for name in ADJUSTMENT_FIELDS
                },
                "adjustedValue": comparable.get("adjustedValue"),
                "contributionPercent": comparable.get("contributionPercent"),
            }
        )

    request = ValuationDiscrepancyRequest(
        loss_vehicle=target,
        loss_date=loss_date,
        ccc_vehicle_valuation=ccc_vehicle_valuation,
        ccc_comparables=tuple(projected_comparables),
        historical_evidence=historical_evidence,
        current_evidence=current_evidence,
        policy=policy if policy is not None else ValuationDiscrepancyPolicy(),
    )
    validate_valuation_discrepancy_request(request)
    return request


def _ccc_comparable_summary(
    comparables: Sequence[Mapping[str, Any]],
) -> CccComparableSummary:
    rows: list[CccComparableEvidence] = []
    list_prices: list[int] = []
    adjusted_values: list[int] = []
    net_adjustments: list[int] = []
    disclosure_counts = Counter()

    for index, comparable in enumerate(comparables):
        list_price = _money_to_cents(
            comparable.get("listPrice"),
            f"$.cccComparables[{index}].listPrice",
            nullable=True,
        )
        adjusted_value = _money_to_cents(
            comparable.get("adjustedValue"),
            f"$.cccComparables[{index}].adjustedValue",
            nullable=True,
        )
        if list_price is not None:
            list_prices.append(list_price)
        if adjusted_value is not None:
            adjusted_values.append(adjusted_value)
        net_adjustment = (
            adjusted_value - list_price
            if adjusted_value is not None and list_price is not None
            else None
        )
        if net_adjustment is not None:
            net_adjustments.append(net_adjustment)

        raw_adjustments = comparable.get("adjustments")
        if not isinstance(raw_adjustments, Mapping):
            raise DiscrepancyContractError(
                "CCC comparable failed discrepancy analysis",
                (f"$.cccComparables[{index}].adjustments: expected an object",),
            )
        component_values = {
            name: _money_to_cents(
                raw_adjustments.get(name),
                f"$.cccComparables[{index}].adjustments.{name}",
                nullable=True,
                allow_negative=True,
            )
            for name in ADJUSTMENT_FIELDS
        }
        disclosed_count = sum(value is not None for value in component_values.values())
        if list_price is None or adjusted_value is None:
            disclosure = "unavailable"
        elif disclosed_count == len(ADJUSTMENT_FIELDS):
            disclosure = "full"
        elif disclosed_count == 0:
            disclosure = "none"
        else:
            disclosure = "partial"
        disclosure_counts[disclosure] += 1

        number = comparable.get("number")
        comparable_number = (
            number
            if isinstance(number, int) and not isinstance(number, bool)
            else None
        )
        rows.append(
            CccComparableEvidence(
                index=index,
                comparable_number=comparable_number,
                year=comparable.get("year"),
                make=comparable.get("make"),
                model=comparable.get("model"),
                trim=comparable.get("trim"),
                vin=comparable.get("vin"),
                dealer=comparable.get("dealer"),
                location=comparable.get("location"),
                distance_miles=comparable.get("distanceMiles"),
                mileage=comparable.get("mileage"),
                list_price_cents=list_price,
                adjusted_value_cents=adjusted_value,
                net_adjustment_cents=net_adjustment,
                adjustments=CccAdjustmentAmounts(
                    package_cents=component_values["package"],
                    options_cents=component_values["options"],
                    mileage_cents=component_values["mileage"],
                    condition_cents=component_values["condition"],
                ),
                adjustment_disclosure=disclosure,
                contribution_percent=comparable.get("contributionPercent"),
            )
        )

    total = len(rows)
    return CccComparableSummary(
        total_count=total,
        advertised_price_missing_count=total - len(list_prices),
        adjusted_value_missing_count=total - len(adjusted_values),
        paired_value_count=len(net_adjustments),
        paired_value_missing_count=total - len(net_adjustments),
        fully_disclosed_adjustment_count=disclosure_counts["full"],
        partially_disclosed_adjustment_count=disclosure_counts["partial"],
        undisclosed_adjustment_count=disclosure_counts["none"],
        unavailable_adjustment_count=disclosure_counts["unavailable"],
        advertised_prices=_price_summary(list_prices),
        adjusted_values=_price_summary(adjusted_values),
        net_adjustments=_money_summary(net_adjustments),
        comparables=tuple(rows),
    )


def _candidate_identity(candidate: Mapping[str, Any]) -> tuple[str, ...] | None:
    listing = candidate["listing"]
    vin = listing.get("vin")
    if isinstance(vin, str) and vin.strip():
        return ("VIN", vin.strip().casefold())
    source = listing.get("source")
    listing_id = listing.get("sourceListingId")
    if (
        isinstance(source, str)
        and source
        and isinstance(listing_id, str)
        and listing_id
    ):
        return ("SOURCE_LISTING_ID", source, listing_id)
    return None


@dataclass(frozen=True)
class _Selection:
    selected: tuple[Mapping[str, Any], ...]
    identity_missing_count: int
    duplicate_identity_count: int
    limit_count: int


def _select_ranked_candidates(
    ranking: Mapping[str, Any], policy: Mapping[str, Any]
) -> _Selection:
    """Select by existing Phase 3C rank without reading listing prices."""

    eligible = sorted(
        (item for item in ranking["candidates"] if item["eligible"]),
        key=lambda item: item["rank"],
    )
    unique: list[Mapping[str, Any]] = []
    seen: set[tuple[str, ...]] = set()
    identity_missing_count = 0
    duplicate_identity_count = 0
    for candidate in eligible:
        identity = _candidate_identity(candidate)
        if identity is None:
            identity_missing_count += 1
            continue
        if identity in seen:
            duplicate_identity_count += 1
            continue
        seen.add(identity)
        unique.append(candidate)

    maximum = policy["maxComparisonSet"]
    selected = tuple(unique[:maximum])
    return _Selection(
        selected=selected,
        identity_missing_count=identity_missing_count,
        duplicate_identity_count=duplicate_identity_count,
        limit_count=max(0, len(unique) - len(selected)),
    )


def _selected_external_evidence(
    selection: _Selection,
    target: Mapping[str, Any],
    *,
    temporal_basis: str,
    evidence_date: str | None,
) -> tuple[SelectedExternalEvidence, ...]:
    results: list[SelectedExternalEvidence] = []
    loss_mileage = target["mileage"]
    for candidate in selection.selected:
        listing = candidate["listing"]
        # Selection is already final.  Price is first read here.
        price_cents = _money_to_cents(
            listing["price"], "$.externalCandidate.listing.price", nullable=False
        )
        if price_cents is None:
            raise AssertionError("non-null listing price converted to null")
        mileage = listing.get("mileage")
        mileage_difference = (
            mileage - loss_mileage
            if mileage is not None and loss_mileage is not None
            else None
        )
        results.append(
            SelectedExternalEvidence(
                source=listing["source"],
                source_listing_id=listing.get("sourceListingId"),
                vin=listing.get("vin"),
                year=listing["year"],
                make=listing["make"],
                model=listing["model"],
                trim=listing.get("trim"),
                price_cents=price_cents,
                mileage=mileage,
                loss_vehicle_mileage=loss_mileage,
                mileage_difference_from_loss_vehicle=mileage_difference,
                distance_miles=listing.get("distanceMiles"),
                rank=candidate["rank"],
                score=candidate["score"],
                tier=candidate["tier"],
                temporal_basis=temporal_basis,
                evidence_date=evidence_date,
            )
        )
    return tuple(results)


def _external_summary(
    ranking: Mapping[str, Any] | None,
    target: Mapping[str, Any],
    policy: Mapping[str, Any],
    *,
    evidence_basis: str,
    evidence_date: str | None,
    coverage_status: str | None,
    resolved_count: int,
    unresolved_count: int,
    ambiguous_count: int,
) -> ExternalEvidenceSummary:
    if ranking is None:
        return ExternalEvidenceSummary(
            evidence_basis=evidence_basis,
            evidence_date=evidence_date,
            coverage_status=coverage_status,
            resolved_count=resolved_count,
            unresolved_count=unresolved_count,
            ambiguous_count=ambiguous_count,
            ranked_candidate_count=0,
            eligible_candidate_count=0,
            ineligible_count=0,
            identity_missing_excluded_count=0,
            duplicate_identity_excluded_count=0,
            comparison_set_limit_excluded_count=0,
            selected_count=0,
            selected_weak_count=0,
            prices=_price_summary([]),
            selected_evidence=(),
        )

    selection = _select_ranked_candidates(ranking, policy)
    selected = _selected_external_evidence(
        selection,
        target,
        temporal_basis=(
            LISTING_RECORD_ACTIVE_ON_DATE
            if evidence_basis == LOSS_DATE_HISTORICAL
            else CURRENT_MARKET
        ),
        evidence_date=evidence_date,
    )
    prices = _price_summary([item.price_cents for item in selected])
    return ExternalEvidenceSummary(
        evidence_basis=evidence_basis,
        evidence_date=evidence_date,
        coverage_status=coverage_status,
        resolved_count=resolved_count,
        unresolved_count=unresolved_count,
        ambiguous_count=ambiguous_count,
        ranked_candidate_count=ranking["totalListingCount"],
        eligible_candidate_count=ranking["eligibleCount"],
        ineligible_count=ranking["ineligibleCount"],
        identity_missing_excluded_count=selection.identity_missing_count,
        duplicate_identity_excluded_count=selection.duplicate_identity_count,
        comparison_set_limit_excluded_count=selection.limit_count,
        selected_count=len(selected),
        selected_weak_count=sum(item.tier == "WEAK" for item in selected),
        prices=prices,
        selected_evidence=selected,
    )


def _value_comparison(first: int | None, second: int | None) -> ValueComparison | None:
    if first is None or second is None:
        return None
    difference = first - second
    return ValueComparison(
        first_value_cents=first,
        second_value_cents=second,
        difference_cents=difference,
        difference_basis_points=_difference_basis_points(difference, second),
    )


def _primary_comparison(
    summary: ExternalEvidenceSummary | None,
    ccc_vehicle_valuation_cents: int | None,
) -> PrimaryComparison | None:
    if (
        summary is None
        or ccc_vehicle_valuation_cents is None
        or summary.prices.median_price_cents is None
        or summary.prices.minimum_price_cents is None
        or summary.prices.maximum_price_cents is None
    ):
        return None
    external_median = summary.prices.median_price_cents
    difference = external_median - ccc_vehicle_valuation_cents
    if ccc_vehicle_valuation_cents < summary.prices.minimum_price_cents:
        position = BELOW_OBSERVED_RANGE
    elif ccc_vehicle_valuation_cents > summary.prices.maximum_price_cents:
        position = ABOVE_OBSERVED_RANGE
    else:
        position = WITHIN_OBSERVED_RANGE
    return PrimaryComparison(
        evidence_basis=summary.evidence_basis,
        external_median_price_cents=external_median,
        ccc_vehicle_valuation_cents=ccc_vehicle_valuation_cents,
        difference_cents=difference,
        difference_basis_points=_difference_basis_points(
            difference, ccc_vehicle_valuation_cents
        ),
        ccc_position_in_external_range=position,
    )


def _dispersion_at_or_above_threshold(
    summary: ExternalEvidenceSummary, threshold_basis_points: int
) -> bool:
    values = [item.price_cents for item in summary.selected_evidence]
    if not values:
        return False
    median, mad, central_half_range = _exact_price_dispersion(values)
    return (
        median > 0
        and max(mad, central_half_range) * 10_000
        >= threshold_basis_points * median
    )


def _gap_at_or_above_threshold(
    difference_cents: int, baseline_cents: int, threshold_basis_points: int
) -> bool:
    return (
        baseline_cents > 0
        and difference_cents > 0
        and difference_cents * 10_000 >= threshold_basis_points * baseline_cents
    )


def _range_strictly_spans_value(
    minimum_cents: int | None,
    maximum_cents: int | None,
    value_cents: int,
) -> bool:
    return (
        minimum_cents is not None
        and maximum_cents is not None
        and minimum_cents < value_cents < maximum_cents
    )


def _choose_primary_summary(
    historical: ExternalEvidenceSummary | None,
    current: ExternalEvidenceSummary | None,
    policy: ValuationDiscrepancyPolicy,
) -> ExternalEvidenceSummary | None:
    minimum = policy.minimum_independent_count
    if (
        historical is not None
        and historical.selected_count >= minimum
        and historical.prices.median_price_cents not in {None, 0}
    ):
        return historical
    if (
        current is not None
        and current.selected_count >= minimum
        and current.prices.median_price_cents not in {None, 0}
    ):
        return current
    if historical is not None and historical.selected_count > 0:
        return historical
    if current is not None and current.selected_count > 0:
        return current
    return None


def _evidence_strength(
    summary: ExternalEvidenceSummary | None,
    policy: ValuationDiscrepancyPolicy,
) -> str:
    if summary is None or summary.selected_count < policy.minimum_independent_count:
        return LOW
    prices = summary.prices
    if prices.median_price_cents in {None, 0} or _dispersion_at_or_above_threshold(
        summary, policy.high_dispersion_basis_points
    ):
        return LOW
    if (
        summary.evidence_basis == LOSS_DATE_HISTORICAL
        and summary.selected_count >= policy.strong_historical_minimum
        and summary.selected_weak_count == 0
    ):
        return STRONG
    return MODERATE


def _classification(
    primary_summary: ExternalEvidenceSummary | None,
    ccc_vehicle_valuation_cents: int | None,
    evidence_strength: str,
    policy: ValuationDiscrepancyPolicy,
) -> str:
    if (
        ccc_vehicle_valuation_cents is None
        or ccc_vehicle_valuation_cents <= 0
        or primary_summary is None
        or primary_summary.selected_count < policy.minimum_independent_count
        or primary_summary.prices.median_price_cents in {None, 0}
    ):
        return INSUFFICIENT_EVIDENCE
    external_median = primary_summary.prices.median_price_cents
    if external_median is None:
        raise AssertionError("classification requires a median")
    difference = external_median - ccc_vehicle_valuation_cents
    if _dispersion_at_or_above_threshold(
        primary_summary, policy.high_dispersion_basis_points
    ):
        prices = primary_summary.prices
        if _range_strictly_spans_value(
            prices.minimum_price_cents,
            prices.maximum_price_cents,
            ccc_vehicle_valuation_cents,
        ):
            return CONFLICTING_EVIDENCE
        if (
            prices.minimum_price_cents is not None
            and ccc_vehicle_valuation_cents < prices.minimum_price_cents
            and _gap_at_or_above_threshold(
                difference,
                ccc_vehicle_valuation_cents,
                policy.potential_gap_basis_points,
            )
        ):
            return POTENTIAL_UNDERVALUE
        return NO_MATERIAL_DISCREPANCY

    if (
        evidence_strength == STRONG
        and _gap_at_or_above_threshold(
            difference,
            ccc_vehicle_valuation_cents,
            policy.material_gap_basis_points,
        )
    ):
        return MATERIAL_UNDERVALUE_SIGNAL
    if _gap_at_or_above_threshold(
        difference,
        ccc_vehicle_valuation_cents,
        policy.potential_gap_basis_points,
    ):
        return POTENTIAL_UNDERVALUE
    return NO_MATERIAL_DISCREPANCY


def _message(code: str, description: str) -> DiscrepancyMessage:
    return DiscrepancyMessage(code=code, description=description)


def _build_findings(
    *,
    classification: str,
    primary_summary: ExternalEvidenceSummary | None,
    primary_comparison: PrimaryComparison | None,
    historical_summary: ExternalEvidenceSummary | None,
    current_summary: ExternalEvidenceSummary | None,
    ccc_vehicle_valuation_cents: int | None,
    ccc_summary: CccComparableSummary,
    policy: ValuationDiscrepancyPolicy,
) -> tuple[DiscrepancyMessage, ...]:
    findings: list[DiscrepancyMessage] = []

    if ccc_vehicle_valuation_cents is None:
        findings.append(
            _message(
                MISSING_CCC_VEHICLE_VALUATION,
                "CCC adjustedVehicleValue is unavailable, so a market discrepancy "
                "cannot be calculated.",
            )
        )
    elif ccc_vehicle_valuation_cents <= 0:
        findings.append(
            _message(
                NONPOSITIVE_CCC_VEHICLE_VALUATION,
                "CCC adjustedVehicleValue is zero, so percentage discrepancy "
                "classification is unavailable.",
            )
        )

    if primary_summary is None or (
        primary_summary.selected_count < policy.minimum_independent_count
    ):
        actual = primary_summary.selected_count if primary_summary is not None else 0
        findings.append(
            _message(
                INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE,
                f"The primary evidence set contains {actual} independent selected "
                f"comparables; policy requires {policy.minimum_independent_count}.",
            )
        )
    elif primary_summary.prices.median_price_cents == 0:
        findings.append(
            _message(
                EXTERNAL_MEDIAN_ZERO,
                "The selected external median is zero, so it is not a usable market "
                "center for discrepancy classification.",
            )
        )

    if primary_summary is not None:
        if primary_summary.evidence_basis == LOSS_DATE_HISTORICAL:
            findings.append(
                _message(
                    HISTORICAL_PRIMARY_EVIDENCE,
                    "Resolved listings active on the loss date provide the primary "
                    "external comparison.",
                )
            )
            if current_summary is not None and current_summary.selected_count > 0:
                findings.append(
                    _message(
                        CURRENT_EVIDENCE_SECONDARY,
                        "Current inventory is preserved as secondary context and is not "
                        "combined with the loss-date historical price set.",
                    )
                )
                historical_median = primary_summary.prices.median_price_cents
                current_median = current_summary.prices.median_price_cents
                if (
                    ccc_vehicle_valuation_cents is not None
                    and ccc_vehicle_valuation_cents > 0
                    and primary_summary.selected_count
                    >= policy.minimum_independent_count
                    and current_summary.selected_count
                    >= policy.minimum_independent_count
                    and historical_median is not None
                    and historical_median > 0
                    and current_median is not None
                    and current_median > 0
                    and (historical_median - ccc_vehicle_valuation_cents)
                    * (current_median - ccc_vehicle_valuation_cents)
                    < 0
                ):
                    findings.append(
                        _message(
                            HISTORICAL_CURRENT_SIGNALS_CONFLICT,
                            "Sufficient historical and current price medians fall on "
                            "opposite sides of CCC adjustedVehicleValue; historical "
                            "evidence remains primary.",
                        )
                    )
        elif primary_summary.evidence_basis == CURRENT_MARKET:
            findings.append(
                _message(
                    CURRENT_PRIMARY_EVIDENCE,
                    "Current inventory provides the primary comparison because "
                    "sufficient loss-date historical evidence is unavailable.",
                )
            )

    if current_summary is not None and current_summary.selected_count > 0 and (
        historical_summary is None or historical_summary.selected_count == 0
    ):
        findings.append(
            _message(
                CURRENT_MARKET_ONLY,
                "Only current-market prices contribute a usable external comparison; "
                "they are not represented as loss-date observations.",
            )
        )

    if historical_summary is not None:
        if historical_summary.coverage_status == OUT_OF_PROVIDER_RANGE:
            findings.append(
                _message(
                    HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE,
                    "The requested loss date is outside the provider's historical "
                    "coverage window; this does not mean no historical market existed.",
                )
            )
        if historical_summary.ambiguous_count:
            findings.append(
                _message(
                    AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED,
                    f"{historical_summary.ambiguous_count} ambiguous historical "
                    "record(s) were excluded from every price statistic.",
                )
            )
        if historical_summary.unresolved_count:
            findings.append(
                _message(
                    UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED,
                    f"{historical_summary.unresolved_count} unresolved historical "
                    "record(s) were excluded from every price statistic.",
                )
            )

    summaries = tuple(
        summary
        for summary in (historical_summary, current_summary)
        if summary is not None
    )
    identity_missing_count = sum(
        summary.identity_missing_excluded_count for summary in summaries
    )
    if identity_missing_count:
        findings.append(
            _message(
                IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED,
                f"{identity_missing_count} eligible external record(s) lacked a "
                "stable VIN or provider listing identity and were excluded.",
            )
        )
    duplicate_identity_count = sum(
        summary.duplicate_identity_excluded_count for summary in summaries
    )
    if duplicate_identity_count:
        findings.append(
            _message(
                DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED,
                f"{duplicate_identity_count} lower-ranked duplicate external "
                "identity record(s) were excluded.",
            )
        )
    comparison_set_limit_count = sum(
        summary.comparison_set_limit_excluded_count for summary in summaries
    )
    if comparison_set_limit_count:
        findings.append(
            _message(
                EXTERNAL_COMPARISON_SET_BOUNDED,
                f"{comparison_set_limit_count} lower-ranked eligible external "
                "record(s) fell outside the policy comparison-set limit.",
            )
        )

    if primary_comparison is not None:
        if primary_comparison.difference_cents > 0:
            findings.append(
                _message(
                    EXTERNAL_MEDIAN_ABOVE_CCC,
                    "The selected external advertised-price median is above CCC "
                    "adjustedVehicleValue.",
                )
            )
        elif primary_comparison.difference_cents < 0:
            findings.append(
                _message(
                    EXTERNAL_MEDIAN_BELOW_CCC,
                    "The selected external advertised-price median is below CCC "
                    "adjustedVehicleValue.",
                )
            )
        else:
            findings.append(
                _message(
                    EXTERNAL_MEDIAN_EQUALS_CCC,
                    "The selected external advertised-price median exactly equals CCC "
                    "adjustedVehicleValue.",
                )
            )

        position_codes = {
            BELOW_OBSERVED_RANGE: (
                CCC_BELOW_EXTERNAL_RANGE,
                "CCC adjustedVehicleValue is below the selected external advertised-"
                "price range.",
            ),
            WITHIN_OBSERVED_RANGE: (
                CCC_WITHIN_EXTERNAL_RANGE,
                "CCC adjustedVehicleValue is within the selected external advertised-"
                "price range.",
            ),
            ABOVE_OBSERVED_RANGE: (
                CCC_ABOVE_EXTERNAL_RANGE,
                "CCC adjustedVehicleValue is above the selected external advertised-"
                "price range.",
            ),
        }
        code, description = position_codes[
            primary_comparison.ccc_position_in_external_range
        ]
        findings.append(_message(code, description))

    if primary_summary is not None and _dispersion_at_or_above_threshold(
        primary_summary, policy.high_dispersion_basis_points
    ):
        findings.append(
            _message(
                EXTERNAL_MARKET_HIGH_DISPERSION,
                "The selected external robust dispersion measure (exact MAD or "
                "one-outlier-resistant central half-range) meets or exceeds the "
                "policy threshold.",
            )
        )

    paired_rows = tuple(
        row
        for row in ccc_summary.comparables
        if row.list_price_cents is not None and row.adjusted_value_cents is not None
    )
    paired_advertised_median = _median_cents(
        [row.list_price_cents for row in paired_rows if row.list_price_cents is not None]
    )
    paired_adjusted_median = _median_cents(
        [
            row.adjusted_value_cents
            for row in paired_rows
            if row.adjusted_value_cents is not None
        ]
    )
    if paired_advertised_median is not None and paired_adjusted_median is not None:
        if paired_adjusted_median < paired_advertised_median:
            findings.append(
                _message(
                    CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES,
                    "Within paired CCC rows, the median adjusted comparable value is "
                    "below the median advertised price; this reports direction only.",
                )
            )
        elif paired_adjusted_median > paired_advertised_median:
            findings.append(
                _message(
                    CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES,
                    "Within paired CCC rows, the median adjusted comparable value is "
                    "above the median advertised price; this reports direction only.",
                )
            )
        else:
            findings.append(
                _message(
                    CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE,
                    "Within paired CCC rows, the advertised and adjusted medians are "
                    "equal; individual row adjustments may still differ.",
                )
            )

    if classification == MATERIAL_UNDERVALUE_SIGNAL:
        findings.append(
            _message(
                MATERIAL_GAP_THRESHOLD_MET,
                "The primary median gap meets the material policy threshold with "
                "STRONG loss-date historical evidence.",
            )
        )
    elif classification == POTENTIAL_UNDERVALUE:
        findings.append(
            _message(
                POTENTIAL_GAP_THRESHOLD_MET,
                "The primary median gap meets the potential policy threshold but does "
                "not support the stronger material classification.",
            )
        )
    elif (
        classification == NO_MATERIAL_DISCREPANCY
        and primary_comparison is not None
        and ccc_vehicle_valuation_cents is not None
        and ccc_vehicle_valuation_cents > 0
        and (
            primary_comparison.difference_cents == 0
            or abs(primary_comparison.difference_cents) * 10_000
            < policy.potential_gap_basis_points * ccc_vehicle_valuation_cents
        )
    ):
        findings.append(
            _message(
                CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT,
                "The primary median gap is below the policy's potential discrepancy "
                "threshold.",
            )
        )
    return tuple(findings)


def _build_limitations(
    *,
    historical_summary: ExternalEvidenceSummary | None,
    current_summary: ExternalEvidenceSummary | None,
) -> tuple[DiscrepancyMessage, ...]:
    limitations = [
        _message(
            NOT_AN_INDEPENDENT_APPRAISAL,
            "This evidence comparison is not an independent vehicle appraisal.",
        ),
        _message(
            DOES_NOT_CALCULATE_LEGAL_SETTLEMENT,
            "This analysis does not calculate a legally owed settlement amount.",
        ),
        _message(
            POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS,
            "Classification thresholds are Venfour analysis-policy thresholds, not "
            "legal or industry standards.",
        ),
        _message(
            NEGOTIATION_OUTPUT_NOT_INCLUDED,
            "Phase 3D produces structured evidence findings only; negotiation or demand "
            "output is not included.",
        ),
        _message(
            ADVERTISED_PRICES_NOT_TRANSACTIONS,
            "External and CCC listing prices are advertised prices, not verified "
            "completed-sale prices.",
        ),
        _message(
            NO_INDEPENDENT_MILEAGE_ADJUSTMENT,
            "Venfour reports mileage differences but applies no independent dollar-"
            "per-mile adjustment.",
        ),
        _message(
            NO_INDEPENDENT_CONDITION_ADJUSTMENT,
            "Venfour applies no independently invented vehicle-condition adjustment.",
        ),
        _message(
            NO_INDEPENDENT_OPTIONS_ADJUSTMENT,
            "Venfour applies no independently invented option, package, or equipment "
            "adjustment.",
        ),
        _message(
            PROVIDER_COVERAGE_LIMITED,
            "Provider evidence may not capture every vehicle that was available in "
            "the relevant market.",
        ),
    ]
    if current_summary is not None:
        limitations.append(
            _message(
                CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE,
                "Current inventory is preserved as current-market context and is not "
                "represented as proof of loss-date conditions.",
            )
        )
    if historical_summary is not None:
        if historical_summary.coverage_status == OUT_OF_PROVIDER_RANGE:
            limitations.append(
                _message(
                    HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET,
                    "OUT_OF_PROVIDER_RANGE describes provider coverage, not the absence "
                    "of historical comparable vehicles.",
                )
            )
        else:
            limitations.append(
                _message(
                    HISTORICAL_DATE_LEVEL_ONLY,
                    "Historical activity is established at calendar-date level; the "
                    "exact loss time within that day is unavailable.",
                )
            )
        if historical_summary.ambiguous_count:
            limitations.append(
                _message(
                    AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED,
                    "No price from an ambiguous historical lifecycle record contributes "
                    "to a market statistic.",
                )
            )
        if historical_summary.unresolved_count:
            limitations.append(
                _message(
                    UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED,
                    "No price from an unresolved historical VIN contributes to a market "
                    "statistic.",
                )
            )
    if historical_summary is not None or current_summary is not None:
        limitations.append(
            _message(
                BOUNDED_EXTERNAL_COMPARISON_SET,
                "External statistics use the bounded best-ranked eligible set, selected "
                "without reference to price.",
            )
        )
    return tuple(limitations)


def analyze_valuation_discrepancy(
    request: ValuationDiscrepancyRequest,
) -> ValuationDiscrepancyResult:
    """Return a reproducible discrepancy assessment without network access."""

    if not isinstance(request, ValuationDiscrepancyRequest):
        raise TypeError("request must be ValuationDiscrepancyRequest")
    validate_valuation_discrepancy_request(request)
    data = request.to_dict()
    policy_data = data["policy"]
    target_data = data["lossVehicle"]

    ccc_vehicle_valuation_cents = _money_to_cents(
        data["cccVehicleValuation"],
        "$.cccVehicleValuation",
        nullable=True,
    )
    ccc_summary = _ccc_comparable_summary(data["cccComparables"])

    historical_summary: ExternalEvidenceSummary | None = None
    historical = data["historicalEvidence"]
    if historical is not None:
        historical_result = historical["result"]
        historical_summary = _external_summary(
            historical["ranking"],
            target_data,
            policy_data,
            evidence_basis=LOSS_DATE_HISTORICAL,
            evidence_date=historical_result["evidenceDate"],
            coverage_status=historical_result["coverage"]["status"],
            resolved_count=historical_result["listingCount"],
            unresolved_count=historical_result["unresolvedCount"],
            ambiguous_count=historical_result["ambiguousCount"],
        )

    current_summary: ExternalEvidenceSummary | None = None
    current = data["currentEvidence"]
    if current is not None:
        current_ranking = current["ranking"]
        current_summary = _external_summary(
            current_ranking,
            target_data,
            policy_data,
            evidence_basis=CURRENT_MARKET,
            evidence_date=current["observedDate"],
            coverage_status=None,
            resolved_count=current_ranking["totalListingCount"],
            unresolved_count=0,
            ambiguous_count=0,
        )

    primary_summary = _choose_primary_summary(
        historical_summary, current_summary, request.policy
    )
    strength = _evidence_strength(primary_summary, request.policy)
    classification = _classification(
        primary_summary,
        ccc_vehicle_valuation_cents,
        strength,
        request.policy,
    )
    primary_comparison = _primary_comparison(
        primary_summary, ccc_vehicle_valuation_cents
    )

    adjusted_median = ccc_summary.adjusted_values.median_price_cents
    paired_ccc_rows = tuple(
        row
        for row in ccc_summary.comparables
        if row.list_price_cents is not None and row.adjusted_value_cents is not None
    )
    paired_advertised_median = _median_cents(
        [
            row.list_price_cents
            for row in paired_ccc_rows
            if row.list_price_cents is not None
        ]
    )
    paired_adjusted_median = _median_cents(
        [
            row.adjusted_value_cents
            for row in paired_ccc_rows
            if row.adjusted_value_cents is not None
        ]
    )
    external_median = (
        primary_summary.prices.median_price_cents
        if primary_summary is not None
        else None
    )
    secondary_comparisons = SecondaryComparisons(
        ccc_adjusted_median_vs_vehicle_valuation=_value_comparison(
            adjusted_median, ccc_vehicle_valuation_cents
        ),
        ccc_advertised_median_vs_adjusted_median=_value_comparison(
            paired_advertised_median, paired_adjusted_median
        ),
        external_median_vs_ccc_adjusted_median=_value_comparison(
            external_median, adjusted_median
        ),
    )

    evidence_basis = (
        primary_summary.evidence_basis
        if primary_summary is not None
        else NO_PRIMARY_EVIDENCE
    )
    findings = _build_findings(
        classification=classification,
        primary_summary=primary_summary,
        primary_comparison=primary_comparison,
        historical_summary=historical_summary,
        current_summary=current_summary,
        ccc_vehicle_valuation_cents=ccc_vehicle_valuation_cents,
        ccc_summary=ccc_summary,
        policy=request.policy,
    )
    limitations = _build_limitations(
        historical_summary=historical_summary,
        current_summary=current_summary,
    )
    result = ValuationDiscrepancyResult(
        analysis_version=VALUATION_DISCREPANCY_ANALYSIS_VERSION,
        classification=classification,
        evidence_strength=strength,
        evidence_basis=evidence_basis,
        policy=request.policy,
        ccc_vehicle_valuation_cents=ccc_vehicle_valuation_cents,
        ccc_comparable_summary=ccc_summary,
        historical_external_summary=historical_summary,
        current_external_summary=current_summary,
        primary_comparison=primary_comparison,
        secondary_comparisons=secondary_comparisons,
        findings=findings,
        limitations=limitations,
    )
    validate_valuation_discrepancy_result(result)
    return result


class ValuationDiscrepancyAnalyzer:
    """Stateless object boundary for callers that prefer an analyzer service."""

    def analyze(
        self, request: ValuationDiscrepancyRequest
    ) -> ValuationDiscrepancyResult:
        return analyze_valuation_discrepancy(request)


def _summary_value_errors(
    actual: Mapping[str, Any], expected: Mapping[str, Any], path: str
) -> list[str]:
    return [
        f"{path}.{key}: does not match the underlying cent observations"
        for key, expected_value in expected.items()
        if actual.get(key) != expected_value
    ]


def _ccc_result_semantic_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    rows = data["comparables"]
    total = len(rows)
    if data["totalCount"] != total:
        errors.append("$.cccComparableSummary.totalCount: must match comparables")

    list_prices: list[int] = []
    adjusted_values: list[int] = []
    nets: list[int] = []
    disclosures = Counter()
    for index, row in enumerate(rows):
        if row["index"] != index:
            errors.append(
                f"$.cccComparableSummary.comparables[{index}].index: must equal "
                "its array position"
            )
        list_price = row["listPriceCents"]
        adjusted = row["adjustedValueCents"]
        if list_price is not None:
            list_prices.append(list_price)
        if adjusted is not None:
            adjusted_values.append(adjusted)
        expected_net = (
            adjusted - list_price
            if adjusted is not None and list_price is not None
            else None
        )
        if row["netAdjustmentCents"] != expected_net:
            errors.append(
                f"$.cccComparableSummary.comparables[{index}].netAdjustmentCents: "
                "must equal adjustedValueCents - listPriceCents"
            )
        if expected_net is not None:
            nets.append(expected_net)

        component_values = list(row["adjustments"].values())
        disclosed_count = sum(value is not None for value in component_values)
        if list_price is None or adjusted is None:
            expected_disclosure = "unavailable"
        elif disclosed_count == len(ADJUSTMENT_FIELDS):
            expected_disclosure = "full"
        elif disclosed_count == 0:
            expected_disclosure = "none"
        else:
            expected_disclosure = "partial"
        if row["adjustmentDisclosure"] != expected_disclosure:
            errors.append(
                f"$.cccComparableSummary.comparables[{index}].adjustmentDisclosure: "
                "does not match price/component availability"
            )
        disclosures[expected_disclosure] += 1

    expected_counts = {
        "advertisedPriceMissingCount": total - len(list_prices),
        "adjustedValueMissingCount": total - len(adjusted_values),
        "pairedValueCount": len(nets),
        "pairedValueMissingCount": total - len(nets),
        "fullyDisclosedAdjustmentCount": disclosures["full"],
        "partiallyDisclosedAdjustmentCount": disclosures["partial"],
        "undisclosedAdjustmentCount": disclosures["none"],
        "unavailableAdjustmentCount": disclosures["unavailable"],
    }
    for key, expected in expected_counts.items():
        if data[key] != expected:
            errors.append(
                f"$.cccComparableSummary.{key}: does not match comparable rows"
            )
    errors.extend(
        _summary_value_errors(
            data["advertisedPrices"],
            _price_summary(list_prices).to_dict(),
            "$.cccComparableSummary.advertisedPrices",
        )
    )
    errors.extend(
        _summary_value_errors(
            data["adjustedValues"],
            _price_summary(adjusted_values).to_dict(),
            "$.cccComparableSummary.adjustedValues",
        )
    )
    errors.extend(
        _summary_value_errors(
            data["netAdjustments"],
            _money_summary(nets).to_dict(),
            "$.cccComparableSummary.netAdjustments",
        )
    )
    return errors


def _result_identity(item: Mapping[str, Any]) -> tuple[str, ...] | None:
    vin = item["vin"]
    if vin is not None:
        return ("VIN", vin.strip().casefold())
    listing_id = item["sourceListingId"]
    if listing_id is not None:
        return ("SOURCE_LISTING_ID", item["source"], listing_id)
    return None


def _external_result_semantic_errors(
    data: Mapping[str, Any], path: str, policy: Mapping[str, Any]
) -> list[str]:
    errors: list[str] = []
    selected = data["selectedEvidence"]
    if data["selectedCount"] != len(selected):
        errors.append(f"{path}.selectedCount: must match selectedEvidence")
    if data["selectedCount"] > policy["maxComparisonSet"]:
        errors.append(f"{path}.selectedCount: exceeds policy maxComparisonSet")
    if data["eligibleCandidateCount"] + data["ineligibleCount"] != data[
        "rankedCandidateCount"
    ]:
        errors.append(
            f"{path}: eligibleCandidateCount + ineligibleCount must equal "
            "rankedCandidateCount"
        )
    accounted_eligible = (
        data["selectedCount"]
        + data["identityMissingExcludedCount"]
        + data["duplicateIdentityExcludedCount"]
        + data["comparisonSetLimitExcludedCount"]
    )
    if data["eligibleCandidateCount"] != accounted_eligible:
        errors.append(
            f"{path}.eligibleCandidateCount: does not match selected and exclusion "
            "counts"
        )
    unique_identified_count = (
        data["eligibleCandidateCount"]
        - data["identityMissingExcludedCount"]
        - data["duplicateIdentityExcludedCount"]
    )
    expected_selected_count = min(
        unique_identified_count, policy["maxComparisonSet"]
    )
    expected_limit_count = max(
        0, unique_identified_count - policy["maxComparisonSet"]
    )
    if data["selectedCount"] != expected_selected_count:
        errors.append(
            f"{path}.selectedCount: does not match identified evidence and the "
            "policy comparison-set limit"
        )
    if data["comparisonSetLimitExcludedCount"] != expected_limit_count:
        errors.append(
            f"{path}.comparisonSetLimitExcludedCount: does not match identified "
            "evidence beyond the policy limit"
        )
    expected_weak = sum(item["tier"] == "WEAK" for item in selected)
    if data["selectedWeakCount"] != expected_weak:
        errors.append(f"{path}.selectedWeakCount: does not match selected tiers")

    ranks = [item["rank"] for item in selected]
    if ranks != sorted(ranks) or len(ranks) != len(set(ranks)):
        errors.append(f"{path}.selectedEvidence: ranks must be unique and ordered")
    identities = [_result_identity(item) for item in selected]
    if any(identity is None for identity in identities):
        errors.append(f"{path}.selectedEvidence: every item needs a stable identity")
    elif len(identities) != len(set(identities)):
        errors.append(f"{path}.selectedEvidence: identities must be unique")

    expected_temporal_basis = (
        LISTING_RECORD_ACTIVE_ON_DATE
        if data["evidenceBasis"] == LOSS_DATE_HISTORICAL
        else CURRENT_MARKET
    )
    for index, item in enumerate(selected):
        if not 1 <= item["rank"] <= data["eligibleCandidateCount"]:
            errors.append(
                f"{path}.selectedEvidence[{index}].rank: must be within the "
                "eligible Phase 3C rank set"
            )
        score = Decimal(str(item["score"]))
        expected_tier = (
            STRONG
            if score >= STRONG_SCORE_MINIMUM
            else "GOOD"
            if score >= GOOD_SCORE_MINIMUM
            else "WEAK"
        )
        if item["tier"] != expected_tier:
            errors.append(
                f"{path}.selectedEvidence[{index}].tier: does not match its "
                "Phase 3C score"
            )
        if item["temporalBasis"] != expected_temporal_basis:
            errors.append(
                f"{path}.selectedEvidence[{index}].temporalBasis: inconsistent with "
                "summary evidenceBasis"
            )
        if item["evidenceDate"] != data["evidenceDate"]:
            errors.append(
                f"{path}.selectedEvidence[{index}].evidenceDate: must match summary"
            )
        expected_difference = (
            item["mileage"] - item["lossVehicleMileage"]
            if item["mileage"] is not None
            and item["lossVehicleMileage"] is not None
            else None
        )
        if item["mileageDifferenceFromLossVehicle"] != expected_difference:
            errors.append(
                f"{path}.selectedEvidence[{index}].mileageDifferenceFromLossVehicle: "
                "must equal mileage - lossVehicleMileage"
            )

    scores = [Decimal(str(item["score"])) for item in selected]
    if scores != sorted(scores, reverse=True):
        errors.append(
            f"{path}.selectedEvidence: scores must be non-increasing in Phase 3C "
            "rank order"
        )

    errors.extend(
        _summary_value_errors(
            data["prices"],
            _price_summary([item["priceCents"] for item in selected]).to_dict(),
            f"{path}.prices",
        )
    )
    if data["evidenceBasis"] == CURRENT_MARKET:
        if data["coverageStatus"] is not None:
            errors.append(f"{path}.coverageStatus: current evidence must use null")
        if data["unresolvedCount"] or data["ambiguousCount"]:
            errors.append(
                f"{path}: current evidence cannot report historical issue counts"
            )
        if data["resolvedCount"] != data["rankedCandidateCount"]:
            errors.append(
                f"{path}.resolvedCount: must match current rankedCandidateCount"
            )
    elif data["coverageStatus"] == OUT_OF_PROVIDER_RANGE:
        if any(
            data[field]
            for field in (
                "resolvedCount",
                "rankedCandidateCount",
                "eligibleCandidateCount",
                "ineligibleCount",
                "selectedCount",
            )
        ):
            errors.append(f"{path}: out-of-range evidence cannot contain listings")
    elif data["coverageStatus"] == SUPPORTED:
        if data["resolvedCount"] != data["rankedCandidateCount"]:
            errors.append(
                f"{path}.resolvedCount: must match historical rankedCandidateCount"
            )
    return errors


def _choose_primary_result_data(
    historical: Mapping[str, Any] | None,
    current: Mapping[str, Any] | None,
    policy: Mapping[str, Any],
) -> Mapping[str, Any] | None:
    minimum = policy["minimumIndependentCount"]
    if (
        historical is not None
        and historical["selectedCount"] >= minimum
        and historical["prices"]["medianPriceCents"] not in {None, 0}
    ):
        return historical
    if (
        current is not None
        and current["selectedCount"] >= minimum
        and current["prices"]["medianPriceCents"] not in {None, 0}
    ):
        return current
    if historical is not None and historical["selectedCount"] > 0:
        return historical
    if current is not None and current["selectedCount"] > 0:
        return current
    return None


def _result_dispersion_high(
    summary: Mapping[str, Any], policy: Mapping[str, Any]
) -> bool:
    values = [item["priceCents"] for item in summary["selectedEvidence"]]
    if not values:
        return False
    median, mad, central_half_range = _exact_price_dispersion(values)
    return (
        median > 0
        and max(mad, central_half_range) * 10_000
        >= policy["highDispersionBasisPoints"] * median
    )


def _expected_result_strength(
    summary: Mapping[str, Any] | None, policy: Mapping[str, Any]
) -> str:
    if summary is None or summary["selectedCount"] < policy[
        "minimumIndependentCount"
    ]:
        return LOW
    if summary["prices"]["medianPriceCents"] in {None, 0} or _result_dispersion_high(
        summary, policy
    ):
        return LOW
    if (
        summary["evidenceBasis"] == LOSS_DATE_HISTORICAL
        and summary["selectedCount"] >= policy["strongHistoricalMinimum"]
        and summary["selectedWeakCount"] == 0
    ):
        return STRONG
    return MODERATE


def _expected_result_classification(
    summary: Mapping[str, Any] | None,
    valuation: int | None,
    strength: str,
    policy: Mapping[str, Any],
) -> str:
    if (
        valuation is None
        or valuation <= 0
        or summary is None
        or summary["selectedCount"] < policy["minimumIndependentCount"]
        or summary["prices"]["medianPriceCents"] in {None, 0}
    ):
        return INSUFFICIENT_EVIDENCE
    median = summary["prices"]["medianPriceCents"]
    if median is None:
        raise AssertionError("classification requires external median")
    difference = median - valuation
    if _result_dispersion_high(summary, policy):
        prices = summary["prices"]
        if _range_strictly_spans_value(
            prices["minimumPriceCents"],
            prices["maximumPriceCents"],
            valuation,
        ):
            return CONFLICTING_EVIDENCE
        if (
            prices["minimumPriceCents"] is not None
            and valuation < prices["minimumPriceCents"]
            and difference > 0
            and difference * 10_000
            >= policy["potentialGapBasisPoints"] * valuation
        ):
            return POTENTIAL_UNDERVALUE
        return NO_MATERIAL_DISCREPANCY

    if (
        strength == STRONG
        and difference > 0
        and difference * 10_000
        >= policy["materialGapBasisPoints"] * valuation
    ):
        return MATERIAL_UNDERVALUE_SIGNAL
    if (
        difference > 0
        and difference * 10_000
        >= policy["potentialGapBasisPoints"] * valuation
    ):
        return POTENTIAL_UNDERVALUE
    return NO_MATERIAL_DISCREPANCY


def _expected_value_comparison(
    first: int | None, second: int | None
) -> dict[str, Any] | None:
    result = _value_comparison(first, second)
    return result.to_dict() if result is not None else None


def _expected_result_finding_codes(
    data: Mapping[str, Any],
    primary: Mapping[str, Any] | None,
    expected_classification: str,
) -> tuple[str, ...]:
    policy = data["policy"]
    valuation = data["cccVehicleValuationCents"]
    historical = data["historicalExternalSummary"]
    current = data["currentExternalSummary"]
    ccc = data["cccComparableSummary"]
    codes: list[str] = []

    if valuation is None:
        codes.append(MISSING_CCC_VEHICLE_VALUATION)
    elif valuation <= 0:
        codes.append(NONPOSITIVE_CCC_VEHICLE_VALUATION)

    if primary is None or primary["selectedCount"] < policy[
        "minimumIndependentCount"
    ]:
        codes.append(INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE)
    elif primary["prices"]["medianPriceCents"] == 0:
        codes.append(EXTERNAL_MEDIAN_ZERO)

    if primary is not None:
        if primary["evidenceBasis"] == LOSS_DATE_HISTORICAL:
            codes.append(HISTORICAL_PRIMARY_EVIDENCE)
            if current is not None and current["selectedCount"] > 0:
                codes.append(CURRENT_EVIDENCE_SECONDARY)
                historical_median = primary["prices"]["medianPriceCents"]
                current_median = current["prices"]["medianPriceCents"]
                if (
                    valuation is not None
                    and valuation > 0
                    and primary["selectedCount"]
                    >= policy["minimumIndependentCount"]
                    and current["selectedCount"]
                    >= policy["minimumIndependentCount"]
                    and historical_median is not None
                    and historical_median > 0
                    and current_median is not None
                    and current_median > 0
                    and (historical_median - valuation)
                    * (current_median - valuation)
                    < 0
                ):
                    codes.append(HISTORICAL_CURRENT_SIGNALS_CONFLICT)
        elif primary["evidenceBasis"] == CURRENT_MARKET:
            codes.append(CURRENT_PRIMARY_EVIDENCE)

    if current is not None and current["selectedCount"] > 0 and (
        historical is None or historical["selectedCount"] == 0
    ):
        codes.append(CURRENT_MARKET_ONLY)

    if historical is not None:
        if historical["coverageStatus"] == OUT_OF_PROVIDER_RANGE:
            codes.append(HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE)
        if historical["ambiguousCount"]:
            codes.append(AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED)
        if historical["unresolvedCount"]:
            codes.append(UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED)

    summaries = tuple(
        summary for summary in (historical, current) if summary is not None
    )
    if any(summary["identityMissingExcludedCount"] for summary in summaries):
        codes.append(IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED)
    if any(summary["duplicateIdentityExcludedCount"] for summary in summaries):
        codes.append(DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED)
    if any(summary["comparisonSetLimitExcludedCount"] for summary in summaries):
        codes.append(EXTERNAL_COMPARISON_SET_BOUNDED)

    if primary is not None and valuation is not None:
        prices = primary["prices"]
        median = prices["medianPriceCents"]
        minimum = prices["minimumPriceCents"]
        maximum = prices["maximumPriceCents"]
        if median is not None and minimum is not None and maximum is not None:
            difference = median - valuation
            codes.append(
                EXTERNAL_MEDIAN_ABOVE_CCC
                if difference > 0
                else EXTERNAL_MEDIAN_BELOW_CCC
                if difference < 0
                else EXTERNAL_MEDIAN_EQUALS_CCC
            )
            codes.append(
                CCC_BELOW_EXTERNAL_RANGE
                if valuation < minimum
                else CCC_ABOVE_EXTERNAL_RANGE
                if valuation > maximum
                else CCC_WITHIN_EXTERNAL_RANGE
            )

    if primary is not None and _result_dispersion_high(primary, policy):
        codes.append(EXTERNAL_MARKET_HIGH_DISPERSION)

    paired_rows = tuple(
        row
        for row in ccc["comparables"]
        if row["listPriceCents"] is not None and row["adjustedValueCents"] is not None
    )
    paired_advertised_median = _median_cents(
        [row["listPriceCents"] for row in paired_rows]
    )
    paired_adjusted_median = _median_cents(
        [row["adjustedValueCents"] for row in paired_rows]
    )
    if paired_advertised_median is not None and paired_adjusted_median is not None:
        codes.append(
            CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES
            if paired_adjusted_median < paired_advertised_median
            else CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES
            if paired_adjusted_median > paired_advertised_median
            else CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE
        )

    if expected_classification == MATERIAL_UNDERVALUE_SIGNAL:
        codes.append(MATERIAL_GAP_THRESHOLD_MET)
    elif expected_classification == POTENTIAL_UNDERVALUE:
        codes.append(POTENTIAL_GAP_THRESHOLD_MET)
    elif (
        expected_classification == NO_MATERIAL_DISCREPANCY
        and primary is not None
        and valuation is not None
        and valuation > 0
        and primary["prices"]["medianPriceCents"] is not None
        and (
            primary["prices"]["medianPriceCents"] == valuation
            or abs(primary["prices"]["medianPriceCents"] - valuation) * 10_000
            < policy["potentialGapBasisPoints"] * valuation
        )
    ):
        codes.append(CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT)
    return tuple(codes)


def _expected_result_limitation_codes(data: Mapping[str, Any]) -> tuple[str, ...]:
    historical = data["historicalExternalSummary"]
    current = data["currentExternalSummary"]
    codes = [
        NOT_AN_INDEPENDENT_APPRAISAL,
        DOES_NOT_CALCULATE_LEGAL_SETTLEMENT,
        POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS,
        NEGOTIATION_OUTPUT_NOT_INCLUDED,
        ADVERTISED_PRICES_NOT_TRANSACTIONS,
        NO_INDEPENDENT_MILEAGE_ADJUSTMENT,
        NO_INDEPENDENT_CONDITION_ADJUSTMENT,
        NO_INDEPENDENT_OPTIONS_ADJUSTMENT,
        PROVIDER_COVERAGE_LIMITED,
    ]
    if current is not None:
        codes.append(CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE)
    if historical is not None:
        codes.append(
            HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET
            if historical["coverageStatus"] == OUT_OF_PROVIDER_RANGE
            else HISTORICAL_DATE_LEVEL_ONLY
        )
        if historical["ambiguousCount"]:
            codes.append(AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED)
        if historical["unresolvedCount"]:
            codes.append(UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED)
    if historical is not None or current is not None:
        codes.append(BOUNDED_EXTERNAL_COMPARISON_SET)
    return tuple(codes)


def _result_semantic_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    policy = data["policy"]
    errors.extend(_policy_semantic_errors(policy))
    valuation = data["cccVehicleValuationCents"]
    if valuation is not None and valuation > MAX_SAFE_MONEY_CENTS:
        errors.append(
            "$.cccVehicleValuationCents: exceeds the safe integer-cent limit"
        )

    ccc = data["cccComparableSummary"]
    errors.extend(_ccc_result_semantic_errors(ccc))
    historical = data["historicalExternalSummary"]
    current = data["currentExternalSummary"]
    if historical is not None:
        errors.extend(
            _external_result_semantic_errors(
                historical, "$.historicalExternalSummary", policy
            )
        )
        if historical["evidenceBasis"] != LOSS_DATE_HISTORICAL:
            errors.append(
                "$.historicalExternalSummary.evidenceBasis: expected "
                "LOSS_DATE_HISTORICAL"
            )
    if current is not None:
        errors.extend(
            _external_result_semantic_errors(
                current, "$.currentExternalSummary", policy
            )
        )
        if current["evidenceBasis"] != CURRENT_MARKET:
            errors.append(
                "$.currentExternalSummary.evidenceBasis: expected CURRENT_MARKET"
            )

    primary = _choose_primary_result_data(historical, current, policy)
    expected_basis = primary["evidenceBasis"] if primary is not None else NO_PRIMARY_EVIDENCE
    if data["evidenceBasis"] != expected_basis:
        errors.append("$.evidenceBasis: does not match primary evidence precedence")
    expected_strength = _expected_result_strength(primary, policy)
    if data["evidenceStrength"] != expected_strength:
        errors.append("$.evidenceStrength: does not match evidence facts and policy")
    expected_classification = _expected_result_classification(
        primary, valuation, expected_strength, policy
    )
    if data["classification"] != expected_classification:
        errors.append("$.classification: does not match evidence facts and policy")

    expected_primary: dict[str, Any] | None = None
    if primary is not None and valuation is not None:
        prices = primary["prices"]
        median = prices["medianPriceCents"]
        minimum = prices["minimumPriceCents"]
        maximum = prices["maximumPriceCents"]
        if median is not None and minimum is not None and maximum is not None:
            difference = median - valuation
            position = (
                BELOW_OBSERVED_RANGE
                if valuation < minimum
                else ABOVE_OBSERVED_RANGE
                if valuation > maximum
                else WITHIN_OBSERVED_RANGE
            )
            expected_primary = {
                "evidenceBasis": primary["evidenceBasis"],
                "externalMedianPriceCents": median,
                "cccVehicleValuationCents": valuation,
                "differenceCents": difference,
                "differenceBasisPoints": _difference_basis_points(
                    difference, valuation
                ),
                "cccPositionInExternalRange": position,
            }
    if data["primaryComparison"] != expected_primary:
        errors.append("$.primaryComparison: does not match primary summary and CCC value")

    adjusted_median = ccc["adjustedValues"]["medianPriceCents"]
    paired_rows = tuple(
        row
        for row in ccc["comparables"]
        if row["listPriceCents"] is not None and row["adjustedValueCents"] is not None
    )
    paired_advertised_median = _median_cents(
        [row["listPriceCents"] for row in paired_rows]
    )
    paired_adjusted_median = _median_cents(
        [row["adjustedValueCents"] for row in paired_rows]
    )
    external_median = (
        primary["prices"]["medianPriceCents"] if primary is not None else None
    )
    expected_secondary = {
        "cccAdjustedMedianVsVehicleValuation": _expected_value_comparison(
            adjusted_median, valuation
        ),
        "cccAdvertisedMedianVsAdjustedMedian": _expected_value_comparison(
            paired_advertised_median, paired_adjusted_median
        ),
        "externalMedianVsCccAdjustedMedian": _expected_value_comparison(
            external_median, adjusted_median
        ),
    }
    if data["secondaryComparisons"] != expected_secondary:
        errors.append(
            "$.secondaryComparisons: do not match the named median comparisons"
        )

    finding_codes = [item["code"] for item in data["findings"]]
    if len(finding_codes) != len(set(finding_codes)):
        errors.append("$.findings: finding codes must be unique")
    expected_finding_codes = _expected_result_finding_codes(
        data, primary, expected_classification
    )
    if tuple(finding_codes) != expected_finding_codes:
        errors.append(
            "$.findings: codes do not match the objectively computed result facts"
        )

    limitation_codes = [item["code"] for item in data["limitations"]]
    if len(limitation_codes) != len(set(limitation_codes)):
        errors.append("$.limitations: limitation codes must be unique")
    if tuple(limitation_codes) != _expected_result_limitation_codes(data):
        errors.append(
            "$.limitations: codes do not match the evidence-specific limitations"
        )
    return errors


def validate_valuation_discrepancy_result(
    result: ValuationDiscrepancyResult | Mapping[str, Any],
) -> None:
    if isinstance(result, ValuationDiscrepancyResult):
        try:
            data = result.to_dict()
        except (AttributeError, TypeError, ValueError) as exc:
            raise DiscrepancyContractError(
                "Valuation discrepancy result failed contract validation",
                (f"$: could not serialize result ({exc})",),
            ) from exc
    else:
        data = result
    _validate_schema(
        data,
        VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH,
        "Valuation discrepancy result",
    )
    semantic_errors = _result_semantic_errors(data)
    if semantic_errors:
        raise DiscrepancyContractError(
            "Valuation discrepancy result failed semantic validation",
            tuple(semantic_errors),
        )


__all__ = [
    "ABOVE_OBSERVED_RANGE",
    "ADVERTISED_PRICES_NOT_TRANSACTIONS",
    "AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED",
    "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED",
    "BELOW_OBSERVED_RANGE",
    "BOUNDED_EXTERNAL_COMPARISON_SET",
    "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES",
    "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE",
    "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES",
    "CCC_ABOVE_EXTERNAL_RANGE",
    "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT",
    "CCC_BELOW_EXTERNAL_RANGE",
    "CCC_WITHIN_EXTERNAL_RANGE",
    "CONFLICTING_EVIDENCE",
    "CURRENT_EVIDENCE_SECONDARY",
    "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE",
    "CURRENT_MARKET",
    "CURRENT_MARKET_ONLY",
    "CURRENT_PRIMARY_EVIDENCE",
    "CccAdjustmentAmounts",
    "CccComparableEvidence",
    "CccComparableSummary",
    "CurrentEvidenceInput",
    "DOES_NOT_CALCULATE_LEGAL_SETTLEMENT",
    "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED",
    "DiscrepancyContractError",
    "DiscrepancyMessage",
    "EXTERNAL_COMPARISON_SET_BOUNDED",
    "EXTERNAL_MARKET_HIGH_DISPERSION",
    "EXTERNAL_MEDIAN_ABOVE_CCC",
    "EXTERNAL_MEDIAN_BELOW_CCC",
    "EXTERNAL_MEDIAN_EQUALS_CCC",
    "EXTERNAL_MEDIAN_ZERO",
    "ExternalEvidenceSummary",
    "HISTORICAL_CURRENT_SIGNALS_CONFLICT",
    "HISTORICAL_DATE_LEVEL_ONLY",
    "HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE",
    "HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET",
    "HISTORICAL_PRIMARY_EVIDENCE",
    "HistoricalEvidenceInput",
    "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED",
    "INSUFFICIENT_EVIDENCE",
    "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE",
    "LOSS_DATE_HISTORICAL",
    "LOW",
    "MATERIAL_GAP_THRESHOLD_MET",
    "MATERIAL_UNDERVALUE_SIGNAL",
    "MAX_SAFE_MONEY_CENTS",
    "MINIMUM_INDEPENDENT_EVIDENCE_COUNT",
    "MISSING_CCC_VEHICLE_VALUATION",
    "MODERATE",
    "MoneySummary",
    "NEGOTIATION_OUTPUT_NOT_INCLUDED",
    "NO_INDEPENDENT_CONDITION_ADJUSTMENT",
    "NO_INDEPENDENT_MILEAGE_ADJUSTMENT",
    "NO_INDEPENDENT_OPTIONS_ADJUSTMENT",
    "NO_MATERIAL_DISCREPANCY",
    "NO_PRIMARY_EVIDENCE",
    "NONPOSITIVE_CCC_VEHICLE_VALUATION",
    "NOT_AN_INDEPENDENT_APPRAISAL",
    "POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS",
    "POTENTIAL_GAP_THRESHOLD_MET",
    "POTENTIAL_UNDERVALUE",
    "PROVIDER_COVERAGE_LIMITED",
    "PriceSummary",
    "PrimaryComparison",
    "STRONG",
    "SecondaryComparisons",
    "SelectedExternalEvidence",
    "UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED",
    "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED",
    "VALUATION_DISCREPANCY_ANALYSIS_VERSION",
    "VALUATION_DISCREPANCY_REQUEST_SCHEMA_PATH",
    "VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH",
    "ValuationDiscrepancyAnalyzer",
    "ValuationDiscrepancyPolicy",
    "ValuationDiscrepancyRequest",
    "ValuationDiscrepancyResult",
    "ValueComparison",
    "WITHIN_OBSERVED_RANGE",
    "analyze_valuation_discrepancy",
    "validate_valuation_discrepancy_policy",
    "validate_valuation_discrepancy_request",
    "validate_valuation_discrepancy_result",
    "valuation_discrepancy_request_from_report",
]
