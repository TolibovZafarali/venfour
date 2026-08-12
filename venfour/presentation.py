"""Deterministic presentation projection for validated analysis-run artifacts.

Phase 3E formats and organizes facts already stored by Phase 3D.2.  It does
not retrieve evidence, rank comparables, calculate market statistics, apply
thresholds, or classify a result.  The application service intentionally
loads through ``AnalysisRunRepository.get`` so repository replay and integrity
validation complete before this module sees an artifact.
"""

from __future__ import annotations

import copy
import json
import math
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any
from urllib.parse import quote, quote_plus, unquote

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from venfour.analysis_runs import AnalysisRunArtifact, AnalysisRunRepository
from venfour.discrepancy import (
    CURRENT_MARKET,
    LOSS_DATE_HISTORICAL,
    MAX_SAFE_MONEY_CENTS,
    NO_PRIMARY_EVIDENCE,
)


ANALYSIS_PRESENTATION_VERSION = "1"

REPO_ROOT = Path(__file__).resolve().parents[1]
ANALYSIS_PRESENTATION_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "analysis" / "analysis-presentation.schema.json"
)

CLASSIFICATION_LABELS = MappingProxyType(
    {
        "INSUFFICIENT_EVIDENCE": "Insufficient evidence",
        "NO_MATERIAL_DISCREPANCY": "No material discrepancy detected",
        "POTENTIAL_UNDERVALUE": "Potential undervaluation signal",
        "MATERIAL_UNDERVALUE_SIGNAL": "Material undervaluation signal",
        "CONFLICTING_EVIDENCE": "Conflicting market evidence",
    }
)

CLASSIFICATION_SUMMARIES = MappingProxyType(
    {
        "INSUFFICIENT_EVIDENCE": (
            "The available independent evidence was insufficient to support a "
            "reliable discrepancy conclusion."
        ),
        "NO_MATERIAL_DISCREPANCY": (
            "The strongest available external evidence did not produce a material "
            "discrepancy signal relative to the CCC adjusted vehicle value."
        ),
        "POTENTIAL_UNDERVALUE": (
            "The strongest available external evidence produced a potential "
            "undervaluation signal relative to the CCC adjusted vehicle value."
        ),
        "MATERIAL_UNDERVALUE_SIGNAL": (
            "The strongest available external evidence produced a material "
            "undervaluation signal relative to the CCC adjusted vehicle value."
        ),
        "CONFLICTING_EVIDENCE": (
            "The strongest available external evidence produced conflicting market "
            "signals relative to the CCC adjusted vehicle value."
        ),
    }
)

EVIDENCE_STRENGTH_LABELS = MappingProxyType(
    {"LOW": "Low", "MODERATE": "Moderate", "STRONG": "Strong"}
)

EVIDENCE_BASIS_LABELS = MappingProxyType(
    {
        NO_PRIMARY_EVIDENCE: "No primary external evidence",
        LOSS_DATE_HISTORICAL: "Historical market evidence from the loss date",
        CURRENT_MARKET: "Current market evidence",
    }
)

FINDING_LABELS = MappingProxyType(
    {
        "MISSING_CCC_VEHICLE_VALUATION": "CCC vehicle valuation unavailable",
        "NONPOSITIVE_CCC_VEHICLE_VALUATION": "CCC vehicle valuation is not positive",
        "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE": (
            "Insufficient resolved external evidence"
        ),
        "EXTERNAL_MEDIAN_ZERO": "External median is zero",
        "EXTERNAL_MEDIAN_ABOVE_CCC": "External median is above CCC",
        "EXTERNAL_MEDIAN_BELOW_CCC": "External median is below CCC",
        "EXTERNAL_MEDIAN_EQUALS_CCC": "External median equals CCC",
        "CCC_BELOW_EXTERNAL_RANGE": "CCC value is below the external range",
        "CCC_WITHIN_EXTERNAL_RANGE": "CCC value is within the external range",
        "CCC_ABOVE_EXTERNAL_RANGE": "CCC value is above the external range",
        "EXTERNAL_MARKET_HIGH_DISPERSION": "External prices have high dispersion",
        "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT": (
            "CCC and external evidence are consistent"
        ),
        "HISTORICAL_PRIMARY_EVIDENCE": "Historical evidence is primary",
        "CURRENT_PRIMARY_EVIDENCE": "Current evidence is primary",
        "CURRENT_MARKET_ONLY": "Current market evidence only",
        "CURRENT_EVIDENCE_SECONDARY": "Current evidence is secondary",
        "HISTORICAL_CURRENT_SIGNALS_CONFLICT": (
            "Historical and current signals conflict"
        ),
        "HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE": (
            "Loss date is outside historical provider coverage"
        ),
        "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED": (
            "Ambiguous historical records were excluded"
        ),
        "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED": (
            "Unresolved historical records were excluded"
        ),
        "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED": (
            "External records without stable identities were excluded"
        ),
        "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED": (
            "Duplicate external identities were excluded"
        ),
        "EXTERNAL_COMPARISON_SET_BOUNDED": (
            "External comparison set was bounded"
        ),
        "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES": (
            "CCC adjustments reduce the paired median"
        ),
        "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES": (
            "CCC adjustments increase the paired median"
        ),
        "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE": (
            "CCC adjustments do not change the paired median"
        ),
        "POTENTIAL_GAP_THRESHOLD_MET": "Potential gap threshold was met",
        "MATERIAL_GAP_THRESHOLD_MET": "Material gap threshold was met",
    }
)

FINDING_DESCRIPTIONS = MappingProxyType(
    {
        "MISSING_CCC_VEHICLE_VALUATION": (
            "The CCC adjusted vehicle value is unavailable, so no external-market "
            "discrepancy comparison was calculated."
        ),
        "NONPOSITIVE_CCC_VEHICLE_VALUATION": (
            "The CCC adjusted vehicle value is zero, so a percentage discrepancy "
            "classification is unavailable."
        ),
        "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE": (
            "The primary evidence set does not contain enough independent selected "
            "comparables for a reliable discrepancy conclusion."
        ),
        "EXTERNAL_MEDIAN_ZERO": (
            "The selected external median is zero and is not a usable market center "
            "for discrepancy classification."
        ),
        "EXTERNAL_MEDIAN_ABOVE_CCC": (
            "The selected external advertised-price median is above the CCC adjusted "
            "vehicle value."
        ),
        "EXTERNAL_MEDIAN_BELOW_CCC": (
            "The selected external advertised-price median is below the CCC adjusted "
            "vehicle value."
        ),
        "EXTERNAL_MEDIAN_EQUALS_CCC": (
            "The selected external advertised-price median equals the CCC adjusted "
            "vehicle value."
        ),
        "CCC_BELOW_EXTERNAL_RANGE": (
            "The CCC adjusted vehicle value is below the selected external "
            "advertised-price range."
        ),
        "CCC_WITHIN_EXTERNAL_RANGE": (
            "The CCC adjusted vehicle value is within the selected external "
            "advertised-price range."
        ),
        "CCC_ABOVE_EXTERNAL_RANGE": (
            "The CCC adjusted vehicle value is above the selected external "
            "advertised-price range."
        ),
        "EXTERNAL_MARKET_HIGH_DISPERSION": (
            "The stored robust dispersion measure meets or exceeds the Phase 3D "
            "screening-policy threshold."
        ),
        "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT": (
            "The stored primary median gap is below the screening policy's potential "
            "discrepancy threshold."
        ),
        "HISTORICAL_PRIMARY_EVIDENCE": (
            "Resolved listings active on the loss date provide the primary external "
            "comparison."
        ),
        "CURRENT_PRIMARY_EVIDENCE": (
            "Current inventory provides the primary comparison because sufficient "
            "loss-date historical evidence is unavailable."
        ),
        "CURRENT_MARKET_ONLY": (
            "Only current-market prices provide a usable external comparison; they "
            "are not represented as loss-date observations."
        ),
        "CURRENT_EVIDENCE_SECONDARY": (
            "Current inventory is secondary context and is not combined with the "
            "loss-date historical price set."
        ),
        "HISTORICAL_CURRENT_SIGNALS_CONFLICT": (
            "Historical and current price medians fall on opposite sides of the CCC "
            "adjusted vehicle value; historical evidence remains primary."
        ),
        "HISTORICAL_EVIDENCE_OUT_OF_PROVIDER_RANGE": (
            "The requested loss date is outside the provider's historical coverage "
            "window; this does not mean no historical market existed."
        ),
        "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED": (
            "Ambiguous historical records were excluded from every price statistic."
        ),
        "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED": (
            "Unresolved historical records were excluded from every price statistic."
        ),
        "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED": (
            "Eligible external records without a stable VIN or provider listing "
            "identity were excluded."
        ),
        "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED": (
            "Lower-ranked duplicate external identity records were excluded."
        ),
        "EXTERNAL_COMPARISON_SET_BOUNDED": (
            "Lower-ranked eligible external records outside the policy comparison-set "
            "limit were excluded."
        ),
        "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES": (
            "For paired CCC rows, the adjusted-value median is below the advertised-"
            "price median; this describes direction only."
        ),
        "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES": (
            "For paired CCC rows, the adjusted-value median is above the advertised-"
            "price median; this describes direction only."
        ),
        "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE": (
            "For paired CCC rows, the advertised-price and adjusted-value medians are "
            "equal; individual row adjustments may still differ."
        ),
        "POTENTIAL_GAP_THRESHOLD_MET": (
            "The stored primary median gap meets the potential screening threshold "
            "but not the stronger material classification."
        ),
        "MATERIAL_GAP_THRESHOLD_MET": (
            "The stored primary median gap meets the material screening threshold "
            "with strong loss-date historical evidence."
        ),
    }
)

LIMITATION_LABELS = MappingProxyType(
    {
        "NOT_AN_INDEPENDENT_APPRAISAL": "Not an independent appraisal",
        "DOES_NOT_CALCULATE_LEGAL_SETTLEMENT": (
            "Does not calculate a legal settlement"
        ),
        "POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS": (
            "Policy thresholds are not legal standards"
        ),
        "NEGOTIATION_OUTPUT_NOT_INCLUDED": "Negotiation output is not included",
        "ADVERTISED_PRICES_NOT_TRANSACTIONS": (
            "Advertised prices are not completed transactions"
        ),
        "NO_INDEPENDENT_MILEAGE_ADJUSTMENT": (
            "No independent mileage adjustment"
        ),
        "NO_INDEPENDENT_CONDITION_ADJUSTMENT": (
            "No independent condition adjustment"
        ),
        "NO_INDEPENDENT_OPTIONS_ADJUSTMENT": (
            "No independent options adjustment"
        ),
        "PROVIDER_COVERAGE_LIMITED": "Provider coverage is limited",
        "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE": (
            "Current listings are not loss-date evidence"
        ),
        "HISTORICAL_DATE_LEVEL_ONLY": "Historical evidence is date-level only",
        "HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET": (
            "Out-of-range coverage does not mean no market existed"
        ),
        "AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED": (
            "Ambiguous historical evidence was not priced"
        ),
        "UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED": (
            "Unresolved historical evidence was not priced"
        ),
        "BOUNDED_EXTERNAL_COMPARISON_SET": (
            "External comparison set is bounded"
        ),
    }
)

LIMITATION_DESCRIPTIONS = MappingProxyType(
    {
        "NOT_AN_INDEPENDENT_APPRAISAL": (
            "This evidence comparison is not an independent vehicle appraisal."
        ),
        "DOES_NOT_CALCULATE_LEGAL_SETTLEMENT": (
            "This analysis does not calculate a legally owed settlement amount."
        ),
        "POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS": (
            "Classification thresholds are screening-policy thresholds, not legal or "
            "industry standards."
        ),
        "NEGOTIATION_OUTPUT_NOT_INCLUDED": (
            "Negotiation, demand, and action guidance are not included."
        ),
        "ADVERTISED_PRICES_NOT_TRANSACTIONS": (
            "External and CCC listing prices are advertised prices, not verified "
            "completed-sale prices."
        ),
        "NO_INDEPENDENT_MILEAGE_ADJUSTMENT": (
            "Mileage differences are reported without an independent dollar-per-mile "
            "adjustment."
        ),
        "NO_INDEPENDENT_CONDITION_ADJUSTMENT": (
            "No independently invented vehicle-condition adjustment is applied."
        ),
        "NO_INDEPENDENT_OPTIONS_ADJUSTMENT": (
            "No independently invented option, package, or equipment adjustment is "
            "applied."
        ),
        "PROVIDER_COVERAGE_LIMITED": (
            "Provider evidence may not capture every vehicle available in the relevant "
            "market."
        ),
        "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE": (
            "Current inventory is current-market context and is not proof of loss-date "
            "conditions."
        ),
        "HISTORICAL_DATE_LEVEL_ONLY": (
            "Historical activity is established at calendar-date level; the exact "
            "loss time within that day is unavailable."
        ),
        "HISTORICAL_OUT_OF_RANGE_NOT_NO_MARKET": (
            "Out-of-provider-range coverage does not establish that no historical "
            "comparable vehicles existed."
        ),
        "AMBIGUOUS_HISTORICAL_EVIDENCE_NOT_PRICED": (
            "No price from an ambiguous historical lifecycle record contributes to a "
            "market statistic."
        ),
        "UNRESOLVED_HISTORICAL_EVIDENCE_NOT_PRICED": (
            "No price from an unresolved historical record contributes to a market "
            "statistic."
        ),
        "BOUNDED_EXTERNAL_COMPARISON_SET": (
            "External statistics use the bounded best-ranked eligible set selected "
            "without reference to price."
        ),
    }
)

HISTORICAL_ISSUE_STATUS_LABELS = MappingProxyType(
    {"UNRESOLVED": "Unresolved", "AMBIGUOUS": "Ambiguous"}
)

HISTORICAL_ISSUE_REASON_COPY = MappingProxyType(
    {
        "RECORD_INTERVAL_BEFORE_EVIDENCE_DATE": (
            "Record interval before evidence date",
            "The stored record interval ended before the evidence date.",
        ),
        "RECORD_INTERVAL_AFTER_EVIDENCE_DATE": (
            "Record interval after evidence date",
            "The stored record interval began after the evidence date.",
        ),
        "MISSING_RECORD_TIMESTAMPS": (
            "Record timestamps missing",
            "The record did not contain the timestamps needed for date verification.",
        ),
        "MALFORMED_RECORD_TIMESTAMPS": (
            "Record timestamps malformed",
            "The record timestamps could not be interpreted reliably.",
        ),
        "INCONSISTENT_RECORD_TIMESTAMPS": (
            "Record timestamps inconsistent",
            "The record timestamps were internally inconsistent.",
        ),
        "INVALID_RECORD_INTERVAL": (
            "Record interval invalid",
            "The record lifecycle interval was invalid.",
        ),
        "MALFORMED_SOURCE_TIMESTAMPS": (
            "Source timestamps malformed",
            "The source timestamps could not be interpreted reliably.",
        ),
        "INCONSISTENT_SOURCE_TIMESTAMPS": (
            "Source timestamps inconsistent",
            "The source timestamps were internally inconsistent.",
        ),
        "INVALID_SOURCE_INTERVAL": (
            "Source interval invalid",
            "The source lifecycle interval was invalid.",
        ),
        "RECORD_OUTSIDE_SOURCE_INTERVAL": (
            "Record outside source interval",
            "The record interval fell outside its stored source interval.",
        ),
        "NO_RECORD_ACTIVE_ON_EVIDENCE_DATE": (
            "No record active on evidence date",
            "No stored listing record was active on the evidence date.",
        ),
        "MISSING_LISTING_IDENTITY": (
            "Listing identity missing",
            "The record lacked a stable VIN or provider listing identity.",
        ),
        "UNVERIFIABLE_RECORD_CONTEXT": (
            "Record context unverifiable",
            "The stored context was insufficient to verify a dated listing record.",
        ),
        "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE": (
            "Multiple records active on evidence date",
            "Multiple source records prevented an unambiguous dated selection.",
        ),
        "PAGINATION_SAFETY_LIMIT_REACHED": (
            "Pagination safety limit reached",
            "Historical verification stopped at the configured pagination safety limit.",
        ),
        "INCOMPLETE_PROVIDER_PAGINATION": (
            "Provider pagination incomplete",
            "The provider response did not establish complete pagination coverage.",
        ),
        "CANDIDATE_VERIFICATION_LIMIT_REACHED": (
            "Historical verification limit reached",
            "Historical verification reached the bounded candidate limit for this analysis.",
        ),
    }
)

CCC_ADJUSTMENT_DIRECTION_LABELS = MappingProxyType(
    {
        code: FINDING_LABELS[code]
        for code in (
            "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES",
            "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES",
            "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE",
        )
    }
)

CCC_DISCLOSURE_LABELS = MappingProxyType(
    {
        "full": "Fully disclosed",
        "partial": "Partially disclosed",
        "none": "Not disclosed",
        "unavailable": "Unavailable",
    }
)

CCC_POSITION_LABELS = MappingProxyType(
    {
        "BELOW_OBSERVED_RANGE": "Below the observed external range",
        "WITHIN_OBSERVED_RANGE": "Within the observed external range",
        "ABOVE_OBSERVED_RANGE": "Above the observed external range",
    }
)

COMPARABLE_TIER_LABELS = MappingProxyType(
    {"STRONG": "Strong match", "GOOD": "Good match", "WEAK": "Weak match"}
)

TEMPORAL_BASIS_LABELS = MappingProxyType(
    {
        "LISTING_RECORD_ACTIVE_ON_DATE": (
            "Verified active on the evidence date from stored lifecycle records"
        ),
        CURRENT_MARKET: "Current market listing",
    }
)

HISTORICAL_COVERAGE_COPY = MappingProxyType(
    {
        "SUPPORTED": (
            "Loss date within provider coverage",
            "The provider reported coverage for the requested historical evidence date.",
        ),
        "OUT_OF_PROVIDER_RANGE": (
            "Loss date outside provider coverage",
            "The requested date falls outside this provider's historical coverage; "
            "this does not mean no market existed.",
        ),
    }
)

EXCLUSION_COPY = MappingProxyType(
    {
        "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED": (
            "Unresolved historical records",
            "These records were excluded from every price statistic.",
        ),
        "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED": (
            "Ambiguous historical records",
            "These records were excluded from every price statistic.",
        ),
        "INELIGIBLE_EXTERNAL_RECORDS_EXCLUDED": (
            "Ineligible external records",
            "These records did not satisfy the stored Phase 3C eligibility rules.",
        ),
        "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED": (
            "External records without stable identities",
            "These eligible records lacked the stored identity required for selection.",
        ),
        "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED": (
            "Duplicate external identities",
            "These lower-ranked duplicate identities were excluded.",
        ),
        "EXTERNAL_COMPARISON_SET_BOUNDED": (
            "Records outside the bounded comparison set",
            "These lower-ranked eligible records were outside the stored comparison set.",
        ),
    }
)

SUPPORTING_COMPARISON_COPY = MappingProxyType(
    {
        "cccAdjustedMedianVsVehicleValuation": (
            "CCC adjusted comparable median versus CCC vehicle valuation",
            "CCC adjusted comparable median",
            "CCC adjusted vehicle value",
        ),
        "cccAdvertisedMedianVsAdjustedMedian": (
            "CCC advertised median versus CCC adjusted comparable median",
            "CCC advertised-price median for paired rows",
            "CCC adjusted-value median for paired rows",
        ),
        "externalMedianVsCccAdjustedMedian": (
            "Primary external median versus CCC adjusted comparable median",
            "Primary external advertised-price median",
            "CCC adjusted comparable median",
        ),
    }
)

_EVIDENCE_SECTION_DESCRIPTIONS = MappingProxyType(
    {
        ("PRIMARY", LOSS_DATE_HISTORICAL): (
            "Resolved listings active on the loss date form the primary external "
            "evidence set selected by Phase 3D."
        ),
        ("PRIMARY", CURRENT_MARKET): (
            "Current listings form the primary external evidence set selected by "
            "Phase 3D; they are not labeled as loss-date observations."
        ),
        ("SECONDARY", LOSS_DATE_HISTORICAL): (
            "Historical evidence is retained as secondary context and is not combined "
            "with the primary current-market price set."
        ),
        ("SECONDARY", CURRENT_MARKET): (
            "Current evidence is retained as secondary context and is not combined "
            "with the primary loss-date historical price set."
        ),
    }
)

_EVIDENCE_SECTION_LABELS = MappingProxyType(
    {
        ("PRIMARY", LOSS_DATE_HISTORICAL): "Primary loss-date historical evidence",
        ("PRIMARY", CURRENT_MARKET): "Primary current market evidence",
        ("SECONDARY", CURRENT_MARKET): "Secondary current market evidence",
    }
)

_CCC_VALUE_LABEL = "CCC adjusted vehicle value"
_CCC_VALUE_EXPLANATION = (
    "This is the CCC vehicle-market value used by Phase 3D when available; "
    "settlement totals are not substituted."
)
_PRIMARY_COMPARISON_COPY = (
    "Primary external median versus CCC adjusted vehicle value",
    "Primary external advertised-price median",
    _CCC_VALUE_LABEL,
)
_REQUEST_DIGEST_LABEL = "Phase 3D request integrity digest"
_REQUEST_DIGEST_DESCRIPTION = (
    "SHA-256 integrity check for the canonical Phase 3D request; this value is "
    "not a digital signature."
)

_SENSITIVE_FIELD_NAMES = frozenset(
    {
        "accesstoken",
        "apikey",
        "authorization",
        "authorizationheader",
        "clientsecret",
        "credential",
        "headers",
        "marketcheckapikey",
        "openaiapikey",
        "password",
        "secret",
        "token",
    }
)
_SECRET_ENVIRONMENT_NAMES = ("MARKETCHECK_API_KEY", "OPENAI_API_KEY")


class AnalysisPresentationContractError(Exception):
    """A Phase 3E presentation failed strict contract validation."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


def format_money_cents(value: int | None) -> str | None:
    """Format an already-stored integer-cent value without floating point."""

    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise AnalysisPresentationContractError(
            "Money display formatting failed",
            ("$: expected integer cents or null",),
        )
    if abs(value) > MAX_SAFE_MONEY_CENTS:
        raise AnalysisPresentationContractError(
            "Money display formatting failed",
            ("$: exceeds the safe integer-cent limit",),
        )
    dollars, cents = divmod(abs(value), 100)
    sign = "-" if value < 0 else ""
    return f"{sign}${dollars:,}.{cents:02d}"


def format_basis_points(value: int | None) -> str | None:
    """Format an authoritative stored basis-point value as a percentage."""

    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise AnalysisPresentationContractError(
            "Percentage display formatting failed",
            ("$: expected integer basis points or null",),
        )
    whole, fractional = divmod(abs(value), 100)
    sign = "-" if value < 0 else ""
    return f"{sign}{whole}.{fractional:02d}%"


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {key: _freeze_json(child) for key, child in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(child) for child in value)
    return copy.deepcopy(value)


def _thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw_json(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_thaw_json(child) for child in value]
    return copy.deepcopy(value)


@dataclass(frozen=True)
class AnalysisPresentation:
    """Immutable structured content for future renderers."""

    run_id: str
    analysis_created_at: str
    assessment: Mapping[str, Any]
    vehicle: Mapping[str, Any]
    ccc_valuation: Mapping[str, Any]
    ccc_comparables: Mapping[str, Any]
    primary_external_evidence: Mapping[str, Any] | None
    secondary_external_evidence: Mapping[str, Any] | None
    comparables_used: Mapping[str, Any]
    evidence_diagnostics: Mapping[str, Any]
    findings: tuple[Mapping[str, Any], ...]
    limitations: tuple[Mapping[str, Any], ...]
    provenance: Mapping[str, Any]
    presentation_version: str = ANALYSIS_PRESENTATION_VERSION

    def __post_init__(self) -> None:
        for field_name in (
            "assessment",
            "vehicle",
            "ccc_valuation",
            "ccc_comparables",
            "comparables_used",
            "evidence_diagnostics",
            "provenance",
        ):
            object.__setattr__(self, field_name, _freeze_json(getattr(self, field_name)))
        for field_name in ("primary_external_evidence", "secondary_external_evidence"):
            value = getattr(self, field_name)
            object.__setattr__(
                self, field_name, _freeze_json(value) if value is not None else None
            )
        object.__setattr__(self, "findings", tuple(_freeze_json(x) for x in self.findings))
        object.__setattr__(
            self, "limitations", tuple(_freeze_json(x) for x in self.limitations)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "presentationVersion": self.presentation_version,
            "runId": self.run_id,
            "analysisCreatedAt": self.analysis_created_at,
            "assessment": _thaw_json(self.assessment),
            "vehicle": _thaw_json(self.vehicle),
            "cccValuation": _thaw_json(self.ccc_valuation),
            "cccComparables": _thaw_json(self.ccc_comparables),
            "primaryExternalEvidence": _thaw_json(self.primary_external_evidence),
            "secondaryExternalEvidence": _thaw_json(self.secondary_external_evidence),
            "comparablesUsed": _thaw_json(self.comparables_used),
            "evidenceDiagnostics": _thaw_json(self.evidence_diagnostics),
            "findings": _thaw_json(self.findings),
            "limitations": _thaw_json(self.limitations),
            "provenance": _thaw_json(self.provenance),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> AnalysisPresentation:
        validate_analysis_presentation(data)
        return cls(
            run_id=data["runId"],
            analysis_created_at=data["analysisCreatedAt"],
            assessment=data["assessment"],
            vehicle=data["vehicle"],
            ccc_valuation=data["cccValuation"],
            ccc_comparables=data["cccComparables"],
            primary_external_evidence=data["primaryExternalEvidence"],
            secondary_external_evidence=data["secondaryExternalEvidence"],
            comparables_used=data["comparablesUsed"],
            evidence_diagnostics=data["evidenceDiagnostics"],
            findings=tuple(data["findings"]),
            limitations=tuple(data["limitations"]),
            provenance=data["provenance"],
            presentation_version=data["presentationVersion"],
        )


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
def _read_presentation_schema() -> dict[str, Any]:
    try:
        data = json.loads(
            ANALYSIS_PRESENTATION_SCHEMA_PATH.read_text(encoding="utf-8")
        )
    except OSError as exc:
        raise AnalysisPresentationContractError(
            f"Presentation schema could not be read: {ANALYSIS_PRESENTATION_SCHEMA_PATH}"
        ) from exc
    except (RecursionError, UnicodeError, ValueError) as exc:
        raise AnalysisPresentationContractError(
            f"Presentation schema is not valid JSON: {ANALYSIS_PRESENTATION_SCHEMA_PATH}"
        ) from exc
    if not isinstance(data, dict):
        raise AnalysisPresentationContractError(
            "Presentation schema root must be an object"
        )
    try:
        Draft202012Validator.check_schema(data)
    except SchemaError as exc:
        raise AnalysisPresentationContractError(
            "Presentation schema is invalid", (exc.message,)
        ) from exc
    return data


def _normalized_sensitive_name(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def _date_time_value(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _secret_variants(values: Sequence[str]) -> tuple[str, ...]:
    variants: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value:
            continue
        variants.update(
            {
                value,
                json.dumps(value, ensure_ascii=False)[1:-1],
                quote(value, safe=""),
                quote_plus(value),
            }
        )
    return tuple(sorted((value for value in variants if value), key=len, reverse=True))


def _presentation_security_errors(
    data: Any,
    forbidden_secret_values: Sequence[str],
    *,
    include_environment_secrets: bool,
) -> list[str]:
    environment_values = (
        tuple(
            value
            for name in _SECRET_ENVIRONMENT_NAMES
            if (value := os.environ.get(name))
        )
        if include_environment_secrets
        else ()
    )
    secret_variants = _secret_variants(
        tuple(forbidden_secret_values) + environment_values
    )
    errors: list[str] = []
    stack: list[tuple[str, Any]] = [("$", data)]
    while stack:
        path, value = stack.pop()
        if isinstance(value, Mapping):
            for key, child in value.items():
                if not isinstance(key, str):
                    continue
                if _normalized_sensitive_name(key) in _SENSITIVE_FIELD_NAMES:
                    errors.append(f"{path}.[REDACTED]: secret-bearing fields are forbidden")
                stack.append((f"{path}.{key}", child))
            continue
        if isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )
            continue
        if not isinstance(value, str) or not secret_variants:
            continue
        decoded = value
        for _ in range(3):
            if any(secret in decoded for secret in secret_variants):
                errors.append(f"{path}: contains a configured secret value")
                break
            decoded = unquote(decoded)
    return sorted(set(errors))


def _semantic_presentation_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    assessment = data["assessment"]
    provenance = data["provenance"]
    classification = assessment["classification"]
    strength = assessment["evidenceStrength"]
    basis = assessment["evidenceBasis"]
    if assessment["classificationLabel"] != CLASSIFICATION_LABELS[classification]:
        errors.append("$.assessment.classificationLabel: does not match classification")
    if assessment["summary"] != CLASSIFICATION_SUMMARIES[classification]:
        errors.append("$.assessment.summary: does not match classification template")
    if assessment["evidenceStrengthLabel"] != EVIDENCE_STRENGTH_LABELS[strength]:
        errors.append("$.assessment.evidenceStrengthLabel: does not match evidence strength")
    if assessment["evidenceBasisLabel"] != EVIDENCE_BASIS_LABELS[basis]:
        errors.append("$.assessment.evidenceBasisLabel: does not match evidence basis")

    stack: list[tuple[str, Any]] = [("$", data)]
    while stack:
        path, value = stack.pop()
        if isinstance(value, Mapping):
            if set(value) == {"cents", "display"}:
                try:
                    expected_display = format_money_cents(value["cents"])
                except AnalysisPresentationContractError:
                    expected_display = None
                if value["display"] != expected_display:
                    errors.append(f"{path}.display: does not match integer cents")
            elif set(value) == {"basisPoints", "display"}:
                try:
                    expected_display = format_basis_points(value["basisPoints"])
                except AnalysisPresentationContractError:
                    expected_display = None
                if value["display"] != expected_display:
                    errors.append(f"{path}.display: does not match stored basis points")
            stack.extend((f"{path}.{key}", child) for key, child in value.items())
        elif isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )

    for group_name, labels, descriptions in (
        ("findings", FINDING_LABELS, FINDING_DESCRIPTIONS),
        ("limitations", LIMITATION_LABELS, LIMITATION_DESCRIPTIONS),
    ):
        messages = data[group_name]
        codes = [message["code"] for message in messages]
        if len(codes) != len(set(codes)):
            errors.append(f"$.{group_name}: codes must be unique")
        for index, message in enumerate(messages):
            if message["label"] != labels[message["code"]]:
                errors.append(
                    f"$.{group_name}[{index}].label: does not match code"
                )
            if message["description"] != descriptions[message["code"]]:
                errors.append(
                    f"$.{group_name}[{index}].description: does not match code"
                )

    ccc = data["cccComparables"]
    indexes = [row["index"] for row in ccc["rows"]]
    if indexes != list(range(len(indexes))):
        errors.append("$.cccComparables.rows: must retain contiguous stored row indexes")
    ccc_summary = ccc["summary"]
    total_count = ccc_summary["totalCount"]
    if total_count != len(ccc["rows"]):
        errors.append(
            "$.cccComparables.summary.totalCount: must match the number of rows"
        )
    ccc_count_pairs = (
        (
            "advertisedPrices",
            "advertisedPriceMissingCount",
        ),
        (
            "adjustedValues",
            "adjustedValueMissingCount",
        ),
        (
            "netAdjustments",
            "pairedValueMissingCount",
        ),
    )
    for summary_name, missing_name in ccc_count_pairs:
        if (
            ccc_summary[summary_name]["count"] + ccc_summary[missing_name]
            != total_count
        ):
            errors.append(
                f"$.cccComparables.summary.{summary_name}.count: does not reconcile "
                f"with {missing_name}"
            )
    if ccc_summary["pairedValueCount"] != ccc_summary["netAdjustments"]["count"]:
        errors.append(
            "$.cccComparables.summary.pairedValueCount: must match net adjustment count"
        )
    if sum(
        ccc_summary[name]
        for name in (
            "fullyDisclosedAdjustmentCount",
            "partiallyDisclosedAdjustmentCount",
            "undisclosedAdjustmentCount",
            "unavailableAdjustmentCount",
        )
    ) != total_count:
        errors.append(
            "$.cccComparables.summary: adjustment disclosure counts must match totalCount"
        )
    for index, row in enumerate(ccc["rows"]):
        disclosure = row["adjustmentDisclosure"]
        if row["adjustmentDisclosureLabel"] != CCC_DISCLOSURE_LABELS[disclosure]:
            errors.append(
                f"$.cccComparables.rows[{index}].adjustmentDisclosureLabel: "
                "does not match disclosure"
            )
    direction = ccc_summary["adjustmentDirection"]
    if direction is not None and (
        direction["label"] != CCC_ADJUSTMENT_DIRECTION_LABELS[direction["code"]]
    ):
        errors.append(
            "$.cccComparables.summary.adjustmentDirection.label: does not match code"
        )
    if direction is not None and (
        direction["description"] != FINDING_DESCRIPTIONS[direction["code"]]
    ):
        errors.append(
            "$.cccComparables.summary.adjustmentDirection.description: does not "
            "match code"
        )

    ccc_valuation = data["cccValuation"]
    if ccc_valuation["valueLabel"] != _CCC_VALUE_LABEL:
        errors.append("$.cccValuation.valueLabel: does not match value code")
    if ccc_valuation["explanation"] != _CCC_VALUE_EXPLANATION:
        errors.append("$.cccValuation.explanation: does not match value code")

    primary = data["primaryExternalEvidence"]
    secondary = data["secondaryExternalEvidence"]
    used = data["comparablesUsed"]
    if basis == NO_PRIMARY_EVIDENCE:
        if primary is not None:
            errors.append(
                "$.primaryExternalEvidence: must be null when evidence basis is NONE"
            )
    elif primary is None:
        errors.append(
            "$.primaryExternalEvidence: required for the stored primary evidence basis"
        )
    elif primary["evidenceBasis"] != basis:
        errors.append(
            "$.primaryExternalEvidence.evidenceBasis: must match assessment basis"
        )

    for section_name, section, expected_role, rows in (
        ("primaryExternalEvidence", primary, "PRIMARY", used["primary"]),
        ("secondaryExternalEvidence", secondary, "SECONDARY", used["secondary"]),
    ):
        if section is None:
            if rows:
                errors.append(
                    f"$.comparablesUsed.{expected_role.casefold()}: must be empty "
                    f"when {section_name} is null"
                )
            continue
        if section["role"] != expected_role:
            errors.append(f"$.{section_name}.role: expected {expected_role}")
        section_basis = section["evidenceBasis"]
        if section["selectedCount"] <= 0:
            errors.append(f"$.{section_name}.selectedCount: must be positive")
        if section["prices"]["count"] != section["selectedCount"]:
            errors.append(
                f"$.{section_name}.prices.count: must match selectedCount"
            )
        provider_stream = (
            "historical" if section_basis == LOSS_DATE_HISTORICAL else "current"
        )
        if section["provider"] != provenance["providers"][provider_stream]:
            errors.append(
                f"$.{section_name}.provider: must match provenance provider metadata"
            )
        if section["evidenceBasisLabel"] != EVIDENCE_BASIS_LABELS[section_basis]:
            errors.append(
                f"$.{section_name}.evidenceBasisLabel: does not match evidence basis"
            )
        if section["label"] != _EVIDENCE_SECTION_LABELS[
            (expected_role, section_basis)
        ]:
            errors.append(f"$.{section_name}.label: does not match role and basis")
        if section["description"] != _EVIDENCE_SECTION_DESCRIPTIONS[
            (expected_role, section_basis)
        ]:
            errors.append(f"$.{section_name}.description: does not match role and basis")
        section_coverage = section["coverage"]
        if section_coverage is not None and section_coverage["statusLabel"] != (
            HISTORICAL_COVERAGE_COPY[section_coverage["status"]][0]
        ):
            errors.append(
                f"$.{section_name}.coverage.statusLabel: does not match status"
            )
        if len(rows) != section["selectedCount"]:
            errors.append(
                f"$.comparablesUsed.{expected_role.casefold()}: count must match "
                f"$.{section_name}.selectedCount"
            )
        ranks = [row["rank"] for row in rows]
        if ranks != sorted(ranks) or len(ranks) != len(set(ranks)):
            errors.append(
                f"$.comparablesUsed.{expected_role.casefold()}: stored ranks must "
                "remain unique and ordered"
            )
        for index, row in enumerate(rows):
            row_path = f"$.comparablesUsed.{expected_role.casefold()}[{index}]"
            if row["evidenceRole"] != expected_role:
                errors.append(f"{row_path}.evidenceRole: does not match section role")
            if row["evidenceBasis"] != section_basis:
                errors.append(f"{row_path}.evidenceBasis: does not match section basis")
            if row["evidenceDate"] != section["evidenceDate"]:
                errors.append(f"{row_path}.evidenceDate: must match section evidence date")
            if row["tierLabel"] != COMPARABLE_TIER_LABELS[row["tier"]]:
                errors.append(f"{row_path}.tierLabel: does not match tier")
            if row["temporalBasisLabel"] != TEMPORAL_BASIS_LABELS[
                row["temporalBasis"]
            ]:
                errors.append(f"{row_path}.temporalBasisLabel: does not match basis")
            lifecycle = row["lifecycleEvidence"]
            if section_basis == LOSS_DATE_HISTORICAL:
                if row["temporalBasis"] != "LISTING_RECORD_ACTIVE_ON_DATE":
                    errors.append(
                        f"{row_path}.temporalBasis: historical evidence is mislabeled"
                    )
                if lifecycle is None:
                    errors.append(
                        f"{row_path}.lifecycleEvidence: required for historical evidence"
                    )
                elif lifecycle["evidenceDate"] != row["evidenceDate"]:
                    errors.append(
                        f"{row_path}.lifecycleEvidence.evidenceDate: must match row"
                    )
                elif lifecycle["basisLabel"] != TEMPORAL_BASIS_LABELS[
                    lifecycle["basis"]
                ]:
                    errors.append(
                        f"{row_path}.lifecycleEvidence.basisLabel: does not match basis"
                    )
                if lifecycle is not None:
                    record_first = _date_time_value(lifecycle["recordFirstSeenAt"])
                    record_last = _date_time_value(lifecycle["recordLastSeenAt"])
                    if record_first > record_last:
                        errors.append(
                            f"{row_path}.lifecycleEvidence: record interval is reversed"
                        )
                    source_first_text = lifecycle["sourceFirstSeenAt"]
                    source_last_text = lifecycle["sourceLastSeenAt"]
                    source_first = (
                        _date_time_value(source_first_text)
                        if source_first_text is not None
                        else None
                    )
                    source_last = (
                        _date_time_value(source_last_text)
                        if source_last_text is not None
                        else None
                    )
                    if (
                        source_first is not None
                        and source_last is not None
                        and source_first > source_last
                    ):
                        errors.append(
                            f"{row_path}.lifecycleEvidence: source interval is reversed"
                        )
                    if source_first is not None and record_first < source_first:
                        errors.append(
                            f"{row_path}.lifecycleEvidence: record begins before source"
                        )
                    if source_last is not None and record_last > source_last:
                        errors.append(
                            f"{row_path}.lifecycleEvidence: record ends after source"
                        )
                    evidence_day_start = datetime.combine(
                        date.fromisoformat(lifecycle["evidenceDate"]),
                        time.min,
                        tzinfo=timezone.utc,
                    )
                    evidence_next_day = evidence_day_start + timedelta(days=1)
                    if not (
                        record_first < evidence_next_day
                        and record_last >= evidence_day_start
                    ):
                        errors.append(
                            f"{row_path}.lifecycleEvidence: record interval does not "
                            "overlap evidence date"
                        )
            elif row["temporalBasis"] != CURRENT_MARKET or lifecycle is not None:
                errors.append(
                    f"{row_path}: current evidence cannot carry historical lifecycle data"
                )

    if secondary is not None:
        if basis == NO_PRIMARY_EVIDENCE:
            errors.append(
                "$.secondaryExternalEvidence: cannot exist without primary evidence"
            )
        elif secondary["evidenceBasis"] == basis:
            errors.append(
                "$.secondaryExternalEvidence.evidenceBasis: must differ from primary"
            )

    comparison = ccc_valuation["comparisonToPrimaryEvidence"]
    if comparison is not None:
        if basis == NO_PRIMARY_EVIDENCE or comparison["evidenceBasis"] != basis:
            errors.append(
                "$.cccValuation.comparisonToPrimaryEvidence.evidenceBasis: must "
                "match the primary evidence basis"
            )
        position = comparison["cccPositionInExternalRange"]
        if comparison["cccPositionLabel"] != CCC_POSITION_LABELS[position]:
            errors.append(
                "$.cccValuation.comparisonToPrimaryEvidence.cccPositionLabel: "
                "does not match position"
            )

        if (
            comparison["label"],
            comparison["firstValueLabel"],
            comparison["secondValueLabel"],
        ) != _PRIMARY_COMPARISON_COPY:
            errors.append(
                "$.cccValuation.comparisonToPrimaryEvidence: labels do not match "
                "the stored comparison"
            )

    supporting = ccc_valuation["supportingComparisons"]
    for key, copy_values in SUPPORTING_COMPARISON_COPY.items():
        value = supporting[key]
        if value is None:
            continue
        label, first_label, second_label = copy_values
        if (
            value["label"],
            value["firstValueLabel"],
            value["secondValueLabel"],
        ) != (label, first_label, second_label):
            errors.append(
                f"$.cccValuation.supportingComparisons.{key}: labels do not match "
                "the named stored comparison"
            )

    diagnostics = data["evidenceDiagnostics"]
    coverage = diagnostics["historicalCoverage"]
    if coverage is not None:
        expected_label, expected_description = HISTORICAL_COVERAGE_COPY[
            coverage["status"]
        ]
        if coverage["statusLabel"] != expected_label:
            errors.append(
                "$.evidenceDiagnostics.historicalCoverage.statusLabel: does not "
                "match status"
            )
        if coverage["description"] != expected_description:
            errors.append(
                "$.evidenceDiagnostics.historicalCoverage.description: does not "
                "match status"
            )
        if coverage["provider"] != provenance["providers"]["historical"]:
            errors.append(
                "$.evidenceDiagnostics.historicalCoverage.provider: must match "
                "provenance provider metadata"
            )
    exclusion_identities = [
        (exclusion["evidenceBasis"], exclusion["code"])
        for exclusion in diagnostics["exclusions"]
    ]
    if len(exclusion_identities) != len(set(exclusion_identities)):
        errors.append("$.evidenceDiagnostics.exclusions: entries must be unique")
    for index, exclusion in enumerate(diagnostics["exclusions"]):
        label, description = EXCLUSION_COPY[exclusion["code"]]
        if (exclusion["label"], exclusion["description"]) != (label, description):
            errors.append(
                f"$.evidenceDiagnostics.exclusions[{index}]: copy does not match code"
            )
        if exclusion["count"] <= 0:
            errors.append(
                f"$.evidenceDiagnostics.exclusions[{index}].count: must be positive"
            )
        if exclusion["evidenceBasis"] == CURRENT_MARKET and exclusion["code"] in {
            "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED",
            "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED",
        }:
            errors.append(
                f"$.evidenceDiagnostics.exclusions[{index}]: historical exclusion "
                "cannot be labeled current"
            )
    for index, issue in enumerate(diagnostics["historicalIssues"]):
        if issue["statusLabel"] != HISTORICAL_ISSUE_STATUS_LABELS[issue["status"]]:
            errors.append(
                f"$.evidenceDiagnostics.historicalIssues[{index}].statusLabel: "
                "does not match status"
            )
        reason_label, reason_description = HISTORICAL_ISSUE_REASON_COPY[
            issue["reason"]
        ]
        if (issue["reasonLabel"], issue["description"]) != (
            reason_label,
            reason_description,
        ):
            errors.append(
                f"$.evidenceDiagnostics.historicalIssues[{index}]: copy does not "
                "match reason"
            )
        is_ambiguous_reason = (
            issue["reason"] == "MULTIPLE_SOURCE_RECORDS_ON_EVIDENCE_DATE"
        )
        if (issue["status"] == "AMBIGUOUS") != is_ambiguous_reason:
            errors.append(
                f"$.evidenceDiagnostics.historicalIssues[{index}]: ambiguous status "
                "and reason must agree"
            )

    if provenance["runId"] != data["runId"]:
        errors.append("$.provenance.runId: must match top-level runId")
    if provenance["createdAt"] != data["analysisCreatedAt"]:
        errors.append(
            "$.provenance.createdAt: must match top-level analysisCreatedAt"
        )
    if provenance["presentationVersion"] != data["presentationVersion"]:
        errors.append(
            "$.provenance.presentationVersion: must match top-level presentationVersion"
        )
    digest = provenance["requestDigest"]
    if digest["label"] != _REQUEST_DIGEST_LABEL:
        errors.append("$.provenance.requestDigest.label: does not match digest role")
    if digest["description"] != _REQUEST_DIGEST_DESCRIPTION:
        errors.append(
            "$.provenance.requestDigest.description: does not match digest role"
        )
    return errors


def validate_analysis_presentation(
    presentation: AnalysisPresentation | Mapping[str, Any],
    *,
    forbidden_secret_values: Sequence[str] = (),
    include_environment_secrets: bool = True,
) -> None:
    """Strictly validate a Phase 3E presentation contract."""

    if isinstance(presentation, AnalysisPresentation):
        try:
            data = presentation.to_dict()
        except (AttributeError, TypeError, ValueError) as exc:
            raise AnalysisPresentationContractError(
                "Analysis presentation failed contract validation",
                (f"$: could not serialize presentation ({exc})",),
            ) from exc
    else:
        data = presentation
    compatibility_errors = _json_compatibility_errors(data)
    if compatibility_errors:
        raise AnalysisPresentationContractError(
            "Analysis presentation failed contract validation",
            tuple(compatibility_errors),
        )
    errors = sorted(
        Draft202012Validator(
            _read_presentation_schema(), format_checker=FormatChecker()
        ).iter_errors(data),
        key=lambda error: (_json_path(list(error.absolute_path)), error.message),
    )
    if errors:
        raise AnalysisPresentationContractError(
            "Analysis presentation failed contract validation",
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in errors
            ),
        )
    semantic_errors = _semantic_presentation_errors(data)
    security_errors = _presentation_security_errors(
        data,
        forbidden_secret_values,
        include_environment_secrets=include_environment_secrets,
    )
    details = tuple(sorted(set(semantic_errors + security_errors)))
    if details:
        raise AnalysisPresentationContractError(
            "Analysis presentation failed semantic validation", details
        )


def _money(value: int | None) -> dict[str, Any]:
    return {"cents": value, "display": format_money_cents(value)}


def _percentage(value: int | None) -> dict[str, Any]:
    return {"basisPoints": value, "display": format_basis_points(value)}


def _price_summary(data: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "count": data["count"],
        "minimumPrice": _money(data["minimumPriceCents"]),
        "maximumPrice": _money(data["maximumPriceCents"]),
        "medianPrice": _money(data["medianPriceCents"]),
        "range": _money(data["rangeCents"]),
        "medianAbsoluteDeviation": _money(data["medianAbsoluteDeviationCents"]),
        "centralHalfRange": _money(data["centralHalfRangeCents"]),
        "dispersion": _percentage(data["dispersionBasisPoints"]),
    }


def _money_summary(data: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "count": data["count"],
        "minimum": _money(data["minimumCents"]),
        "maximum": _money(data["maximumCents"]),
        "median": _money(data["medianCents"]),
        "range": _money(data["rangeCents"]),
    }


def _value_comparison(
    data: Mapping[str, Any] | None, comparison_name: str
) -> dict[str, Any] | None:
    if data is None:
        return None
    label, first_label, second_label = SUPPORTING_COMPARISON_COPY[comparison_name]
    return {
        "label": label,
        "firstValueLabel": first_label,
        "secondValueLabel": second_label,
        "firstValue": _money(data["firstValueCents"]),
        "secondValue": _money(data["secondValueCents"]),
        "difference": _money(data["differenceCents"]),
        "differencePercent": _percentage(data["differenceBasisPoints"]),
    }


def _primary_comparison(data: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None
    position = data["cccPositionInExternalRange"]
    label, first_label, second_label = _PRIMARY_COMPARISON_COPY
    return {
        "label": label,
        "evidenceBasis": data["evidenceBasis"],
        "firstValueLabel": first_label,
        "secondValueLabel": second_label,
        "firstValue": _money(data["externalMedianPriceCents"]),
        "secondValue": _money(data["cccVehicleValuationCents"]),
        "difference": _money(data["differenceCents"]),
        "differencePercent": _percentage(data["differenceBasisPoints"]),
        "cccPositionInExternalRange": position,
        "cccPositionLabel": CCC_POSITION_LABELS[position],
    }


def _ccc_row(data: Mapping[str, Any]) -> dict[str, Any]:
    adjustments = data["adjustments"]
    disclosure = data["adjustmentDisclosure"]
    return {
        "index": data["index"],
        "comparableNumber": data["comparableNumber"],
        "year": data["year"],
        "make": data["make"],
        "model": data["model"],
        "trim": data["trim"],
        "vin": data["vin"],
        "dealer": data["dealer"],
        "location": data["location"],
        "distanceMiles": data["distanceMiles"],
        "mileage": data["mileage"],
        "advertisedPrice": _money(data["listPriceCents"]),
        "cccAdjustedComparableValue": _money(data["adjustedValueCents"]),
        "netAdjustment": _money(data["netAdjustmentCents"]),
        "adjustments": {
            "package": _money(adjustments["packageCents"]),
            "options": _money(adjustments["optionsCents"]),
            "mileage": _money(adjustments["mileageCents"]),
            "condition": _money(adjustments["conditionCents"]),
        },
        "adjustmentDisclosure": disclosure,
        "adjustmentDisclosureLabel": CCC_DISCLOSURE_LABELS[disclosure],
        "contributionPercent": data["contributionPercent"],
    }


def _adjustment_direction(
    findings: Sequence[Mapping[str, Any]],
) -> dict[str, str] | None:
    matches = [
        finding
        for finding in findings
        if finding["code"] in CCC_ADJUSTMENT_DIRECTION_LABELS
    ]
    if not matches:
        return None
    if len(matches) != 1:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            ("$.result.discrepancyResult.findings: multiple CCC direction findings",),
        )
    finding = matches[0]
    return {
        "code": finding["code"],
        "label": CCC_ADJUSTMENT_DIRECTION_LABELS[finding["code"]],
        "description": FINDING_DESCRIPTIONS[finding["code"]],
    }


def _ccc_comparables(
    data: Mapping[str, Any], findings: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    return {
        "summary": {
            "totalCount": data["totalCount"],
            "advertisedPriceMissingCount": data["advertisedPriceMissingCount"],
            "adjustedValueMissingCount": data["adjustedValueMissingCount"],
            "pairedValueCount": data["pairedValueCount"],
            "pairedValueMissingCount": data["pairedValueMissingCount"],
            "fullyDisclosedAdjustmentCount": data[
                "fullyDisclosedAdjustmentCount"
            ],
            "partiallyDisclosedAdjustmentCount": data[
                "partiallyDisclosedAdjustmentCount"
            ],
            "undisclosedAdjustmentCount": data["undisclosedAdjustmentCount"],
            "unavailableAdjustmentCount": data["unavailableAdjustmentCount"],
            "advertisedPrices": _price_summary(data["advertisedPrices"]),
            "adjustedValues": _price_summary(data["adjustedValues"]),
            "netAdjustments": _money_summary(data["netAdjustments"]),
            "adjustmentDirection": _adjustment_direction(findings),
        },
        "rows": [_ccc_row(row) for row in data["comparables"]],
    }


def _provider_for_basis(
    artifact_data: Mapping[str, Any], evidence_basis: str
) -> Mapping[str, Any] | None:
    stream = "historical" if evidence_basis == LOSS_DATE_HISTORICAL else "current"
    return artifact_data["providers"][stream]


def _evidence_section(
    artifact_data: Mapping[str, Any],
    summary: Mapping[str, Any],
    role: str,
) -> dict[str, Any]:
    basis = summary["evidenceBasis"]
    provider = _provider_for_basis(artifact_data, basis)
    if provider is None:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            ("$.providers: evidence summary requires provider metadata",),
        )
    coverage: dict[str, Any] | None = None
    if basis == LOSS_DATE_HISTORICAL:
        historical_result = artifact_data["result"]["historicalMarketResult"]
        if historical_result is None:
            raise AnalysisPresentationContractError(
                "Analysis artifact could not be projected",
                ("$.result.historicalMarketResult: historical summary is missing",),
            )
        coverage_status = historical_result["coverage"]["status"]
        coverage = {
            "status": coverage_status,
            "statusLabel": HISTORICAL_COVERAGE_COPY[coverage_status][0],
            "asOfDate": historical_result["asOfDate"],
            "historyWindowDays": historical_result["coverage"][
                "historyWindowDays"
            ],
        }
    return {
        "role": role,
        "evidenceBasis": basis,
        "evidenceBasisLabel": EVIDENCE_BASIS_LABELS[basis],
        "label": _EVIDENCE_SECTION_LABELS[(role, basis)],
        "description": _EVIDENCE_SECTION_DESCRIPTIONS[(role, basis)],
        "provider": {"name": provider["name"], "version": provider["version"]},
        "evidenceDate": summary["evidenceDate"],
        "coverage": coverage,
        "resolvedCount": summary["resolvedCount"],
        "unresolvedCount": summary["unresolvedCount"],
        "ambiguousCount": summary["ambiguousCount"],
        "rankedCandidateCount": summary["rankedCandidateCount"],
        "eligibleCandidateCount": summary["eligibleCandidateCount"],
        "ineligibleCount": summary["ineligibleCount"],
        "identityMissingExcludedCount": summary["identityMissingExcludedCount"],
        "duplicateIdentityExcludedCount": summary[
            "duplicateIdentityExcludedCount"
        ],
        "comparisonSetLimitExcludedCount": summary[
            "comparisonSetLimitExcludedCount"
        ],
        "selectedCount": summary["selectedCount"],
        "selectedWeakCount": summary["selectedWeakCount"],
        "prices": _price_summary(summary["prices"]),
    }


def _ranking_for_basis(
    artifact_data: Mapping[str, Any], evidence_basis: str
) -> Mapping[str, Any]:
    key = "historicalRanking" if evidence_basis == LOSS_DATE_HISTORICAL else "currentRanking"
    ranking = artifact_data["result"][key]
    if ranking is None:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            (f"$.result.{key}: selected evidence requires a stored ranking",),
        )
    return ranking


def _candidate_at_stored_rank(
    ranking: Mapping[str, Any], rank: int
) -> Mapping[str, Any]:
    matches = [candidate for candidate in ranking["candidates"] if candidate["rank"] == rank]
    if len(matches) != 1:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            ("$.result.*Ranking.candidates: selected rank was not uniquely retained",),
        )
    return matches[0]


def _historical_lifecycle(
    artifact_data: Mapping[str, Any], listing: Mapping[str, Any]
) -> dict[str, Any]:
    historical_result = artifact_data["result"]["historicalMarketResult"]
    if historical_result is None:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            ("$.result.historicalMarketResult: historical lifecycle is unavailable",),
        )
    matches = [
        item
        for item in historical_result["evidence"]
        if item["listing"] == listing
    ]
    if not matches:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            ("$.result.historicalMarketResult.evidence: selected listing is missing",),
        )
    temporal = matches[0]["temporalEvidence"]
    return {
        "status": temporal["status"],
        "basis": temporal["basis"],
        "basisLabel": TEMPORAL_BASIS_LABELS[temporal["basis"]],
        "evidenceDate": temporal["evidenceDate"],
        "recordFirstSeenAt": temporal["recordFirstSeenAt"],
        "recordLastSeenAt": temporal["recordLastSeenAt"],
        "sourceFirstSeenAt": temporal["sourceFirstSeenAt"],
        "sourceLastSeenAt": temporal["sourceLastSeenAt"],
    }


def _used_comparable(
    artifact_data: Mapping[str, Any],
    selected: Mapping[str, Any],
    evidence_basis: str,
    role: str,
) -> dict[str, Any]:
    ranking = _ranking_for_basis(artifact_data, evidence_basis)
    candidate = _candidate_at_stored_rank(ranking, selected["rank"])
    listing = candidate["listing"]
    dealer = listing["dealer"]
    temporal_basis = selected["temporalBasis"]
    lifecycle = (
        _historical_lifecycle(artifact_data, listing)
        if evidence_basis == LOSS_DATE_HISTORICAL
        else None
    )
    return {
        "evidenceRole": role,
        "evidenceBasis": evidence_basis,
        "source": selected["source"],
        "sourceListingId": selected["sourceListingId"],
        "vin": selected["vin"],
        "year": selected["year"],
        "make": selected["make"],
        "model": selected["model"],
        "trim": selected["trim"],
        "mileage": selected["mileage"],
        "lossVehicleMileage": selected["lossVehicleMileage"],
        "mileageDifferenceFromLossVehicle": selected[
            "mileageDifferenceFromLossVehicle"
        ],
        "advertisedPrice": _money(selected["priceCents"]),
        "dealer": (
            {
                "name": dealer["name"],
                "city": dealer["city"],
                "state": dealer["state"],
                "postalCode": dealer["postalCode"],
            }
            if dealer is not None
            else None
        ),
        "distanceMiles": selected["distanceMiles"],
        "rank": selected["rank"],
        "score": selected["score"],
        "tier": selected["tier"],
        "tierLabel": COMPARABLE_TIER_LABELS[selected["tier"]],
        "temporalBasis": temporal_basis,
        "temporalBasisLabel": TEMPORAL_BASIS_LABELS[temporal_basis],
        "evidenceDate": selected["evidenceDate"],
        "lifecycleEvidence": lifecycle,
    }


def _used_comparables(
    artifact_data: Mapping[str, Any],
    summary: Mapping[str, Any] | None,
    role: str,
) -> list[dict[str, Any]]:
    if summary is None:
        return []
    basis = summary["evidenceBasis"]
    return [
        _used_comparable(artifact_data, selected, basis, role)
        for selected in summary["selectedEvidence"]
    ]


def _exclusion(
    evidence_basis: str, code: str, count: int
) -> dict[str, Any] | None:
    if count == 0:
        return None
    label, description = EXCLUSION_COPY[code]
    return {
        "evidenceBasis": evidence_basis,
        "code": code,
        "label": label,
        "description": description,
        "count": count,
        "pricesContributed": False,
    }


def _summary_exclusions(summary: Mapping[str, Any]) -> list[dict[str, Any]]:
    basis = summary["evidenceBasis"]
    definitions: list[tuple[str, str]] = []
    if basis == LOSS_DATE_HISTORICAL:
        definitions.extend(
            [
                (
                    "UNRESOLVED_HISTORICAL_RECORDS_EXCLUDED",
                    "unresolvedCount",
                ),
                (
                    "AMBIGUOUS_HISTORICAL_RECORDS_EXCLUDED",
                    "ambiguousCount",
                ),
            ]
        )
    definitions.extend(
        [
            ("INELIGIBLE_EXTERNAL_RECORDS_EXCLUDED", "ineligibleCount"),
            (
                "IDENTITY_MISSING_EXTERNAL_RECORDS_EXCLUDED",
                "identityMissingExcludedCount",
            ),
            (
                "DUPLICATE_EXTERNAL_IDENTITIES_EXCLUDED",
                "duplicateIdentityExcludedCount",
            ),
            (
                "EXTERNAL_COMPARISON_SET_BOUNDED",
                "comparisonSetLimitExcludedCount",
            ),
        ]
    )
    return [
        exclusion
        for code, field_name in definitions
        if (exclusion := _exclusion(basis, code, summary[field_name])) is not None
    ]


def _historical_coverage(
    artifact_data: Mapping[str, Any],
) -> dict[str, Any] | None:
    result = artifact_data["result"]["historicalMarketResult"]
    if result is None:
        return None
    status = result["coverage"]["status"]
    label, description = HISTORICAL_COVERAGE_COPY[status]
    provider = artifact_data["providers"]["historical"]
    if provider is None:
        raise AnalysisPresentationContractError(
            "Analysis artifact could not be projected",
            ("$.providers.historical: historical result requires provider metadata",),
        )
    return {
        "provider": {"name": provider["name"], "version": provider["version"]},
        "evidenceDate": result["evidenceDate"],
        "status": status,
        "statusLabel": label,
        "description": description,
        "asOfDate": result["asOfDate"],
        "historyWindowDays": result["coverage"]["historyWindowDays"],
    }


def _historical_issues(artifact_data: Mapping[str, Any]) -> list[dict[str, Any]]:
    result = artifact_data["result"]["historicalMarketResult"]
    if result is None:
        return []
    projected: list[dict[str, Any]] = []
    for issue in result["issues"]:
        reason_label, reason_description = HISTORICAL_ISSUE_REASON_COPY[
            issue["reason"]
        ]
        projected.append(
            {
                "status": issue["status"],
                "statusLabel": HISTORICAL_ISSUE_STATUS_LABELS[issue["status"]],
                "reason": issue["reason"],
                "reasonLabel": reason_label,
                "description": reason_description,
                "vin": issue["vin"],
                "sourceListingId": issue["sourceListingId"],
                "pricesContributed": False,
            }
        )
    return projected


def _message_projection(
    messages: Sequence[Mapping[str, Any]],
    labels: Mapping[str, str],
    descriptions: Mapping[str, str],
) -> list[dict[str, str]]:
    return [
        {
            "code": message["code"],
            "label": labels[message["code"]],
            "description": descriptions[message["code"]],
        }
        for message in messages
    ]


def _provenance(artifact_data: Mapping[str, Any]) -> dict[str, Any]:
    def provider(stream: str) -> dict[str, Any] | None:
        metadata = artifact_data["providers"][stream]
        return (
            {"name": metadata["name"], "version": metadata["version"]}
            if metadata is not None
            else None
        )

    providers = {
        "historical": provider("historical"),
        "current": provider("current"),
    }
    return {
        "runId": artifact_data["runId"],
        "presentationVersion": ANALYSIS_PRESENTATION_VERSION,
        "analysisRunSchemaVersion": artifact_data["analysisRunSchemaVersion"],
        "orchestrationAnalysisVersion": artifact_data["analysisVersion"],
        "discrepancyAnalysisVersion": artifact_data["discrepancyAnalysisVersion"],
        "comparableScoringVersion": artifact_data["comparableScoringVersion"],
        "createdAt": artifact_data["createdAt"],
        "providers": providers,
        "requestDigest": {
            "algorithm": "SHA-256",
            "value": artifact_data["requestDigest"],
            "label": _REQUEST_DIGEST_LABEL,
            "description": _REQUEST_DIGEST_DESCRIPTION,
        },
    }


class AnalysisPresentationProjector:
    """Side-effect-free projection of one already-validated audit artifact."""

    def project(self, artifact: AnalysisRunArtifact) -> AnalysisPresentation:
        if not isinstance(artifact, AnalysisRunArtifact):
            raise AnalysisPresentationContractError(
                "Presentation projector requires an AnalysisRunArtifact",
                (f"$: got {type(artifact).__name__}",),
            )
        try:
            artifact_data = artifact.to_dict()
            result = artifact_data["result"]["discrepancyResult"]
            request = artifact_data["result"]["discrepancyRequest"]
            basis = result["evidenceBasis"]
            historical = result["historicalExternalSummary"]
            current = result["currentExternalSummary"]

            primary_summary: Mapping[str, Any] | None
            if basis == LOSS_DATE_HISTORICAL:
                primary_summary = historical
            elif basis == CURRENT_MARKET:
                primary_summary = current
            elif basis == NO_PRIMARY_EVIDENCE:
                primary_summary = None
            else:
                raise KeyError("unknown primary evidence basis")
            if basis != NO_PRIMARY_EVIDENCE and primary_summary is None:
                raise KeyError("primary evidence summary is missing")

            secondary_summary = (
                current
                if basis == LOSS_DATE_HISTORICAL
                and current is not None
                and current["selectedCount"] > 0
                else None
            )

            findings = result["findings"]
            limitations = result["limitations"]
            vehicle = request["lossVehicle"]
            ccc_summary = result["cccComparableSummary"]
            supporting = result["secondaryComparisons"]

            exclusions: list[dict[str, Any]] = []
            for summary in (historical, current):
                if summary is not None:
                    exclusions.extend(_summary_exclusions(summary))

            presentation_data = {
                "presentationVersion": ANALYSIS_PRESENTATION_VERSION,
                "runId": artifact_data["runId"],
                "analysisCreatedAt": artifact_data["createdAt"],
                "assessment": {
                    "classification": result["classification"],
                    "classificationLabel": CLASSIFICATION_LABELS[
                        result["classification"]
                    ],
                    "evidenceStrength": result["evidenceStrength"],
                    "evidenceStrengthLabel": EVIDENCE_STRENGTH_LABELS[
                        result["evidenceStrength"]
                    ],
                    "evidenceBasis": basis,
                    "evidenceBasisLabel": EVIDENCE_BASIS_LABELS[basis],
                    "summary": CLASSIFICATION_SUMMARIES[result["classification"]],
                },
                "vehicle": {
                    "year": vehicle["year"],
                    "make": vehicle["make"],
                    "model": vehicle["model"],
                    "trim": vehicle["trim"],
                    "mileage": vehicle["mileage"],
                    "lossDate": request["lossDate"],
                    "postalCode": vehicle["postalCode"],
                },
                "cccValuation": {
                    "valueCode": "CCC_ADJUSTED_VEHICLE_VALUE",
                    "valueLabel": _CCC_VALUE_LABEL,
                    "adjustedVehicleValue": _money(
                        result["cccVehicleValuationCents"]
                    ),
                    "explanation": _CCC_VALUE_EXPLANATION,
                    "comparisonToPrimaryEvidence": _primary_comparison(
                        result["primaryComparison"]
                    ),
                    "supportingComparisons": {
                        key: _value_comparison(supporting[key], key)
                        for key in SUPPORTING_COMPARISON_COPY
                    },
                },
                "cccComparables": _ccc_comparables(ccc_summary, findings),
                "primaryExternalEvidence": (
                    _evidence_section(artifact_data, primary_summary, "PRIMARY")
                    if primary_summary is not None
                    else None
                ),
                "secondaryExternalEvidence": (
                    _evidence_section(artifact_data, secondary_summary, "SECONDARY")
                    if secondary_summary is not None
                    else None
                ),
                "comparablesUsed": {
                    "primary": _used_comparables(
                        artifact_data, primary_summary, "PRIMARY"
                    ),
                    "secondary": _used_comparables(
                        artifact_data, secondary_summary, "SECONDARY"
                    ),
                },
                "evidenceDiagnostics": {
                    "historicalCoverage": _historical_coverage(artifact_data),
                    "exclusions": exclusions,
                    "historicalIssues": _historical_issues(artifact_data),
                },
                "findings": _message_projection(
                    findings, FINDING_LABELS, FINDING_DESCRIPTIONS
                ),
                "limitations": _message_projection(
                    limitations, LIMITATION_LABELS, LIMITATION_DESCRIPTIONS
                ),
                "provenance": _provenance(artifact_data),
            }
            return AnalysisPresentation.from_dict(presentation_data)
        except AnalysisPresentationContractError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise AnalysisPresentationContractError(
                "Analysis artifact could not be projected",
                ("$: validated artifact does not satisfy the presentation boundary",),
            ) from exc


class AnalysisPresentationService:
    """Load a strictly validated run and return its Phase 3E presentation."""

    def __init__(
        self,
        repository: AnalysisRunRepository,
        *,
        projector: AnalysisPresentationProjector | None = None,
    ) -> None:
        if not isinstance(repository, AnalysisRunRepository):
            raise TypeError("repository must implement AnalysisRunRepository save/get")
        selected_projector = (
            projector if projector is not None else AnalysisPresentationProjector()
        )
        if not callable(getattr(selected_projector, "project", None)):
            raise TypeError("projector must expose project(artifact)")
        self._repository = repository
        self._projector = selected_projector

    def get(self, run_id: str) -> AnalysisPresentation:
        artifact = self._repository.get(run_id)
        presentation = self._projector.project(artifact)
        if not isinstance(presentation, AnalysisPresentation):
            raise AnalysisPresentationContractError(
                "Presentation projector returned an invalid value",
                (f"$: got {type(presentation).__name__}",),
            )
        validate_analysis_presentation(presentation)
        return presentation


__all__ = [
    "ANALYSIS_PRESENTATION_SCHEMA_PATH",
    "ANALYSIS_PRESENTATION_VERSION",
    "AnalysisPresentation",
    "AnalysisPresentationContractError",
    "AnalysisPresentationProjector",
    "AnalysisPresentationService",
    "CLASSIFICATION_LABELS",
    "CLASSIFICATION_SUMMARIES",
    "EVIDENCE_BASIS_LABELS",
    "EVIDENCE_STRENGTH_LABELS",
    "FINDING_DESCRIPTIONS",
    "FINDING_LABELS",
    "HISTORICAL_ISSUE_REASON_COPY",
    "LIMITATION_DESCRIPTIONS",
    "LIMITATION_LABELS",
    "format_basis_points",
    "format_money_cents",
    "validate_analysis_presentation",
]
