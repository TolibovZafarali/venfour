"""Deterministic structured and PDF valuation-evidence report artifacts.

The issued content is projected only from a validated total-loss source
snapshot and ``FinalValuationAssessmentV1``. No provider retrieval, valuation
analysis, extraction, or generative writing occurs in this module.
"""

from __future__ import annotations

import copy
import hashlib
import html
import io
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

import pymupdf
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from venfour.analysis_runs import canonical_json_bytes
from venfour.package_assessment import (
    DESCRIPTIVE_ONLY,
    NOT_DETERMINED_BY_V1,
    SELECTED_ADVERTISED_PRICE_RANGE,
    FinalValuationAssessmentV1,
    PackageAssessmentError,
    TotalLossSourceSnapshotV1,
    canonical_package_digest,
    validate_final_valuation_assessment_v1,
    validate_total_loss_source_snapshot_v1,
)


REPORT_SCHEMA_VERSION = "1"
REPORT_TEMPLATE_VERSION = "1"
REPORT_RENDERER_VERSION = "1"
PDF_VALIDATION_SCHEMA_VERSION = "1"
REPORT_TITLE = "Venfour Total-Loss Valuation Evidence Package"
REPORT_STORAGE_FILENAME = "valuation-evidence-package.pdf"

VERIFIED_FACT = "VERIFIED_FACT"
CUSTOMER_SUPPLIED = "CUSTOMER_SUPPLIED"
INSURER_EXTRACTED = "INSURER_EXTRACTED"
MARKET_EVIDENCE = "MARKET_EVIDENCE"
AUTOMATED_CALCULATION = "AUTOMATED_CALCULATION"
ASSUMPTION = "ASSUMPTION"
UNAVAILABLE = "UNAVAILABLE"
DISPUTED = "DISPUTED"
DETERMINISTIC_FINDING = "DETERMINISTIC_FINDING"

EVIDENCE_LABELS = frozenset(
    {
        VERIFIED_FACT,
        CUSTOMER_SUPPLIED,
        INSURER_EXTRACTED,
        MARKET_EVIDENCE,
        AUTOMATED_CALCULATION,
        ASSUMPTION,
        UNAVAILABLE,
        DISPUTED,
        DETERMINISTIC_FINDING,
    }
)

REPO_ROOT = Path(__file__).resolve().parents[1]
REPORT_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "report" / "valuation-evidence-report-v1.schema.json"
)
PDF_VALIDATION_SCHEMA_PATH = (
    REPO_ROOT
    / "schemas"
    / "report"
    / "valuation-evidence-pdf-validation-v1.schema.json"
)

MANDATORY_PDF_SECTIONS = (
    ("PURPOSE_AND_SCOPE", "Purpose and scope"),
    ("EXECUTIVE_CONCLUSION", "Executive conclusion"),
    ("SUBJECT_VEHICLE", "Subject vehicle"),
    ("INSURER_VALUATION", "Insurer valuation reviewed"),
    ("INSURER_COMPARABLES", "Insurer comparable review"),
    ("MARKET_EVIDENCE", "Independent market evidence"),
    ("CALCULATIONS", "Adjustments and calculations"),
    ("RECONCILIATION", "Evidence reconciliation"),
    ("PRELIMINARY_FINAL", "Preliminary versus final"),
    ("FINDINGS", "Findings"),
    ("LIMITATIONS", "Assumptions and limitations"),
    ("SOURCE_INDEX", "Source and evidence index"),
    ("EXHIBITS", "Exhibits"),
)

_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_SAFE_FILENAME = re.compile(
    r"^Venfour_Valuation_Evidence_[A-Za-z0-9_-]+_v[1-9][0-9]*\.pdf$"
)
_PLACEHOLDER_PATTERNS = (
    re.compile(r"\{\{[^}]*\}\}"),
    re.compile(r"\[(?:placeholder|insert[^]]*)\]", re.IGNORECASE),
    re.compile(r"<placeholder[^>]*>", re.IGNORECASE),
    re.compile(r"\b(?:TODO|TBD)\b"),
)


class ValuationEvidenceReportError(Exception):
    """A deterministic report or rendered artifact failed validation."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "VALUATION_EVIDENCE_REPORT_INVALID",
        details: Sequence[str] = (),
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = tuple(details)


def _failure(
    message: str,
    code: str,
    details: Sequence[str] = (),
) -> ValuationEvidenceReportError:
    return ValuationEvidenceReportError(message, code=code, details=details)


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {str(key): _freeze_json(child) for key, child in value.items()}
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


@lru_cache(maxsize=2)
def _read_schema(path: Path) -> dict[str, Any]:
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
    except (OSError, ValueError, SchemaError) as exc:
        raise _failure(
            "Report validation schema is unavailable",
            "REPORT_VALIDATION_UNAVAILABLE",
        ) from exc
    if not isinstance(schema, dict):
        raise _failure(
            "Report validation schema is invalid",
            "REPORT_VALIDATION_UNAVAILABLE",
        )
    return schema


def _json_path(parts: Sequence[Any]) -> str:
    result = "$"
    for part in parts:
        if isinstance(part, int):
            result += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            result += f".{part}"
        else:
            result += f"[{json.dumps(part, ensure_ascii=True)}]"
    return result


def _validate_schema(value: Any, path: Path, code: str) -> None:
    try:
        errors = sorted(
            Draft202012Validator(
                _read_schema(path), format_checker=FormatChecker()
            ).iter_errors(value),
            key=lambda error: (_json_path(list(error.absolute_path)), error.message),
        )
    except ValuationEvidenceReportError:
        raise
    except Exception as exc:
        raise _failure(
            "Report validation could not complete",
            "REPORT_VALIDATION_UNAVAILABLE",
        ) from exc
    if errors:
        raise _failure(
            "Report artifact failed schema validation",
            code,
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in errors
            ),
        )


def _mapping_data(value: Any, label: str) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return copy.deepcopy(dict(value))
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        result = to_dict()
        if isinstance(result, Mapping):
            return copy.deepcopy(dict(result))
    raise _failure(f"{label} is invalid", "REPORT_SOURCE_INVALID")


def _canonical_utc(value: str, label: str) -> tuple[str, str]:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise _failure(
            f"{label} must be a canonical UTC timestamp",
            "REPORT_IDENTITY_INVALID",
        )
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise _failure(
            f"{label} must be a canonical UTC timestamp",
            "REPORT_IDENTITY_INVALID",
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise _failure(
            f"{label} must be a canonical UTC timestamp",
            "REPORT_IDENTITY_INVALID",
        )
    if parsed.utcoffset().total_seconds() != 0:
        raise _failure(
            f"{label} must be a canonical UTC timestamp",
            "REPORT_IDENTITY_INVALID",
        )
    return value, parsed.date().isoformat()


def _money(minor_units: int | None, currency: str = "USD") -> dict[str, Any]:
    if minor_units is None:
        return {"minorUnits": None, "currency": currency, "display": "Unavailable"}
    if isinstance(minor_units, bool) or not isinstance(minor_units, int):
        raise _failure("Money value is invalid", "REPORT_SOURCE_INVALID")
    sign = "-" if minor_units < 0 else ""
    absolute = abs(minor_units)
    return {
        "minorUnits": minor_units,
        "currency": currency,
        "display": f"{sign}${absolute // 100:,}.{absolute % 100:02d}",
    }


def _display(value: Any) -> str:
    if value is None:
        return "Unavailable"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, Mapping):
        values = value.get("values")
        if isinstance(values, Sequence) and not isinstance(values, (str, bytes)):
            return ", ".join(str(item) for item in values) or "Unavailable"
        return "; ".join(f"{key}: {child}" for key, child in value.items())
    return str(value)


def _vehicle_display(value: Mapping[str, Any]) -> str:
    return " ".join(
        str(value.get(key)).strip()
        for key in ("year", "make", "model", "trim")
        if value.get(key) is not None and str(value.get(key)).strip()
    )


def _classification_label(code: str) -> str:
    labels = {
        "MATERIAL_UNDERVALUE_SIGNAL": "Material undervaluation signal",
        "POTENTIAL_UNDERVALUE": "Potential undervaluation signal",
        "NO_MATERIAL_DISCREPANCY": "No material discrepancy identified",
        "INSUFFICIENT_EVIDENCE": "Insufficient evidence",
    }
    return labels.get(code, code.replace("_", " ").title())


def _conclusion_summary(assessment: Mapping[str, Any]) -> str:
    classification = assessment["finalClassification"]
    if classification == "MATERIAL_UNDERVALUE_SIGNAL":
        lead = (
            "The deterministic assessment identified a material undervaluation "
            "signal in the reviewed evidence."
        )
    elif classification == "POTENTIAL_UNDERVALUE":
        lead = (
            "The deterministic assessment identified a potential undervaluation "
            "signal in the reviewed evidence."
        )
    elif classification == "NO_MATERIAL_DISCREPANCY":
        lead = (
            "The deterministic assessment did not identify a material discrepancy "
            "in the reviewed evidence."
        )
    elif classification == "INSUFFICIENT_EVIDENCE":
        lead = (
            "The deterministic assessment found that the available evidence was "
            "insufficient to support a valuation-dispute conclusion."
        )
    else:
        lead = (
            "The deterministic assessment requires review before a valuation-dispute "
            "conclusion can be relied upon."
        )
    if assessment["supportedRange"] is not None:
        lead += (
            " The stated range is a range of selected advertised prices, not a point "
            "actual-cash-value determination or guaranteed settlement amount."
        )
    return lead


def _evidence_label_for_source(
    reference: Mapping[str, Any], intake_mode: str
) -> str:
    pointer = reference["jsonPointer"]
    if "/findings/" in pointer or "/limitations/" in pointer:
        return DETERMINISTIC_FINDING
    if "cccComparableSummary/comparables/" in pointer:
        return INSURER_EXTRACTED
    if pointer.endswith("/cccVehicleValuationCents"):
        return INSURER_EXTRACTED if intake_mode == "REPORT" else CUSTOMER_SUPPLIED
    if pointer.startswith("/result/discrepancyRequest/lossVehicle/") or pointer == (
        "/result/discrepancyRequest/lossDate"
    ):
        return INSURER_EXTRACTED if intake_mode == "REPORT" else CUSTOMER_SUPPLIED
    source_kind = reference["sourceKind"]
    return {
        "CUSTOMER_CONFIRMED_INPUT": CUSTOMER_SUPPLIED,
        "INSURER_COMPARABLE": INSURER_EXTRACTED,
        "EXTERNAL_PROVIDER_RECORD": MARKET_EVIDENCE,
        "ANALYSIS_CALCULATION": AUTOMATED_CALCULATION,
    }[source_kind]


def _local_reference(
    source: Mapping[str, Any],
    *,
    pointer: str,
    identity: str,
    evidence_label: str,
) -> dict[str, Any]:
    payload = {
        "sourceSnapshotDigest": source["snapshotDigest"],
        "sourceArtifact": "SOURCE_SNAPSHOT",
        "jsonPointer": pointer,
        "sourceIdentity": identity,
        "evidenceLabel": evidence_label,
        "locationPrecision": "JSON_POINTER",
        "pageNumber": None,
    }
    return {
        "evidenceId": f"ref_{canonical_package_digest(payload)}",
        "evidenceLabel": evidence_label,
        "sourceArtifact": "SOURCE_SNAPSHOT",
        "jsonPointer": pointer,
        "sourceIdentity": identity,
        "locationPrecision": "JSON_POINTER",
        "pageNumber": None,
    }


def _evidence_index(source: Mapping[str, Any]) -> list[dict[str, Any]]:
    intake_mode = source["input"]["intakeMode"]
    rows = [
        {
            "evidenceId": reference["evidenceId"],
            "evidenceLabel": _evidence_label_for_source(reference, intake_mode),
            "sourceArtifact": reference["artifact"],
            "jsonPointer": reference["jsonPointer"],
            "sourceIdentity": reference["sourceIdentity"],
            "locationPrecision": reference["locationPrecision"],
            "pageNumber": reference["pageNumber"],
        }
        for reference in source["evidenceManifest"]
    ]
    facts = source["input"]["confirmedFacts"]
    for field, label in (
        ("insurerName", CUSTOMER_SUPPLIED),
        ("priorTitleStatus", CUSTOMER_SUPPLIED),
        ("condition", CUSTOMER_SUPPLIED),
        ("existingDamageDescription", CUSTOMER_SUPPLIED),
        ("optionsPackages", CUSTOMER_SUPPLIED),
    ):
        if facts.get(field) is not None:
            rows.append(
                _local_reference(
                    source,
                    pointer=f"/input/confirmedFacts/{field}",
                    identity=field,
                    evidence_label=label,
                )
            )
    unique = {row["evidenceId"]: row for row in rows}
    return sorted(unique.values(), key=lambda row: row["evidenceId"])


def _reference_id(index: Sequence[Mapping[str, Any]], pointer: str) -> str:
    matches = [row["evidenceId"] for row in index if row["jsonPointer"] == pointer]
    if len(matches) != 1:
        raise _failure(
            "Report provenance is incomplete",
            "REPORT_PROVENANCE_INVALID",
            (f"{pointer}: expected one evidence reference",),
        )
    return matches[0]


def _reference_ids(
    index: Sequence[Mapping[str, Any]], pointers: Sequence[str]
) -> list[str]:
    return [_reference_id(index, pointer) for pointer in pointers]


def _fact(
    *,
    key: str,
    label: str,
    value: Any,
    evidence_label: str,
    evidence_ids: Sequence[str],
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": copy.deepcopy(value),
        "displayValue": _display(value),
        "evidenceLabel": evidence_label if value is not None else UNAVAILABLE,
        "evidenceIds": list(evidence_ids) if value is not None else [],
    }


def _subject_facts(
    source: Mapping[str, Any],
    assessment: Mapping[str, Any],
    index: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    vehicle = assessment["subjectVehicle"]
    confirmed = source["input"]["confirmedFacts"]
    source_label = (
        INSURER_EXTRACTED
        if source["input"]["intakeMode"] == "REPORT"
        else CUSTOMER_SUPPLIED
    )
    facts: list[dict[str, Any]] = []
    pointers = {
        "year": "/result/discrepancyRequest/lossVehicle/year",
        "make": "/result/discrepancyRequest/lossVehicle/make",
        "model": "/result/discrepancyRequest/lossVehicle/model",
        "trim": "/result/discrepancyRequest/lossVehicle/trim",
        "mileage": "/result/discrepancyRequest/lossVehicle/mileage",
        "postalCode": "/result/discrepancyRequest/lossVehicle/postalCode",
        "lossDate": "/result/discrepancyRequest/lossDate",
        "vin": "/vin",
        "vehicleConfiguration": "/vehicleConfiguration",
        "priorTitleStatus": "/input/confirmedFacts/priorTitleStatus",
        "condition": "/input/confirmedFacts/condition",
        "existingDamageDescription": "/input/confirmedFacts/existingDamageDescription",
        "optionsPackages": "/input/confirmedFacts/optionsPackages",
    }
    rows = (
        ("vin", "VIN", vehicle.get("vin"), CUSTOMER_SUPPLIED),
        ("year", "Year", vehicle["year"], source_label),
        ("make", "Make", vehicle["make"], source_label),
        ("model", "Model", vehicle["model"], source_label),
        ("trim", "Trim", vehicle["trim"], source_label),
        (
            "vehicleConfiguration",
            "Drivetrain / configuration",
            vehicle.get("vehicleConfiguration"),
            CUSTOMER_SUPPLIED,
        ),
        ("mileage", "Mileage", vehicle["mileage"], source_label),
        ("postalCode", "Loss-location postal code", vehicle["postalCode"], source_label),
        ("lossDate", "Date of loss", vehicle["lossDate"], source_label),
        (
            "optionsPackages",
            "Relevant equipment / packages",
            confirmed.get("optionsPackages"),
            CUSTOMER_SUPPLIED,
        ),
        (
            "priorTitleStatus",
            "Prior title status",
            confirmed.get("priorTitleStatus"),
            CUSTOMER_SUPPLIED,
        ),
        ("condition", "Customer-described condition", confirmed.get("condition"), CUSTOMER_SUPPLIED),
        (
            "existingDamageDescription",
            "Customer-described prior damage",
            confirmed.get("existingDamageDescription"),
            CUSTOMER_SUPPLIED,
        ),
    )
    for key, label, value, evidence_label in rows:
        evidence_ids = (
            [_reference_id(index, pointers[key])]
            if value is not None
            else []
        )
        facts.append(
            _fact(
                key=key,
                label=label,
                value=value,
                evidence_label=evidence_label,
                evidence_ids=evidence_ids,
            )
        )
    return facts


def _insurer_comparables(assessment: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in assessment["insurerComparables"]["rows"]:
        facts = row["facts"]
        adjustments = facts.get("adjustments") or {}
        rows.append(
            {
                "comparableNumber": facts.get("comparableNumber"),
                "vehicleDisplay": _vehicle_display(facts),
                "vin": facts.get("vin"),
                "dealer": facts.get("dealer"),
                "location": facts.get("location"),
                "distanceMiles": facts.get("distanceMiles"),
                "mileage": facts.get("mileage"),
                "advertisedPrice": (facts.get("advertisedPrice") or {}).get("display"),
                "adjustedValue": (facts.get("cccAdjustedComparableValue") or {}).get("display"),
                "netAdjustment": (facts.get("netAdjustment") or {}).get("display"),
                "adjustments": {
                    name: (adjustments.get(name) or {}).get("display")
                    for name in ("package", "options", "mileage", "condition")
                },
                "adjustmentDisclosure": facts.get("adjustmentDisclosureLabel")
                or facts.get("adjustmentDisclosure", "Unavailable"),
                "contributionPercent": facts.get("contributionPercent"),
                "evidenceLabel": INSURER_EXTRACTED,
                "evidenceIds": list(row["evidenceIds"]),
            }
        )
    return rows


def _market_summary(value: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    provider = value.get("provider") or {}
    return {
        "role": value["role"],
        "evidenceBasis": value["evidenceBasis"],
        "label": value["label"],
        "description": value["description"],
        "provider": provider.get("name") or "Unavailable",
        "evidenceDate": value["evidenceDate"],
        "selectedCount": value["selectedCount"],
        "prices": copy.deepcopy(value["prices"]),
    }


def _market_comparables(assessment: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    selected = assessment["externalEvidence"]["selectedComparables"]
    for role_name in ("primary", "secondary"):
        for row in selected[role_name]:
            facts = row["facts"]
            dealer = facts.get("dealer") or {}
            location = ", ".join(
                str(dealer[key])
                for key in ("city", "state", "postalCode")
                if dealer.get(key) is not None
            )
            rows.append(
                {
                    "role": facts["evidenceRole"],
                    "evidenceBasis": facts["evidenceBasis"],
                    "source": facts["source"],
                    "sourceListingId": facts["sourceListingId"],
                    "vehicleDisplay": _vehicle_display(facts),
                    "vin": facts.get("vin"),
                    "mileage": facts.get("mileage"),
                    "advertisedPrice": facts["advertisedPrice"]["display"],
                    "dealer": dealer.get("name"),
                    "location": location or None,
                    "distanceMiles": facts.get("distanceMiles"),
                    "rank": facts.get("rank"),
                    "score": facts.get("score"),
                    "tier": facts.get("tierLabel") or facts["tier"],
                    "temporalBasis": facts.get("temporalBasisLabel")
                    or facts["temporalBasis"],
                    "evidenceDate": facts["evidenceDate"],
                    "evidenceLabel": MARKET_EVIDENCE,
                    "evidenceIds": list(row["evidenceIds"]),
                }
            )
    return rows


def _value_fact(
    key: str,
    label: str,
    value: Any,
    evidence_ids: Sequence[str],
    *,
    money: bool = False,
    basis_points: bool = False,
) -> dict[str, Any]:
    if money:
        display_value = _money(value)["display"] if value is not None else "Unavailable"
    elif basis_points and value is not None:
        display_value = f"{value / 100:.2f}%"
    else:
        display_value = _display(value)
    return {
        "key": key,
        "label": label,
        "value": copy.deepcopy(value),
        "displayValue": display_value,
        "evidenceLabel": AUTOMATED_CALCULATION if value is not None else UNAVAILABLE,
        "evidenceIds": list(evidence_ids) if value is not None else [],
    }


def _calculations(
    assessment: Mapping[str, Any], index: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    primary = assessment["calculations"]["primaryComparison"]
    if primary is not None:
        ids = [_reference_id(index, "/result/discrepancyResult/primaryComparison")]
        rows.append(
            {
                "code": "PRIMARY_EVIDENCE_COMPARISON",
                "label": "Primary evidence comparison",
                "description": (
                    "Deterministic comparison of the insurer valuation with the "
                    "selected primary advertised-price median."
                ),
                "values": [
                    _value_fact("externalMedian", "External advertised-price median", primary.get("externalMedianPriceCents"), ids, money=True),
                    _value_fact("insurerValuation", "Insurer valuation reviewed", primary.get("cccVehicleValuationCents"), ids, money=True),
                    _value_fact("difference", "Median difference", primary.get("differenceCents"), ids, money=True),
                    _value_fact("differencePercent", "Median difference percent", primary.get("differenceBasisPoints"), ids, basis_points=True),
                    _value_fact("rangePosition", "Insurer position in selected range", primary.get("cccPositionInExternalRange"), ids),
                ],
                "evidenceLabel": AUTOMATED_CALCULATION,
                "evidenceIds": ids,
            }
        )
    secondary = assessment["calculations"]["secondaryComparisons"]
    if secondary:
        ids = [_reference_id(index, "/result/discrepancyResult/secondaryComparisons")]
        for name, value in sorted(secondary.items()):
            if value is None:
                continue
            code = re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()
            rows.append(
                {
                    "code": code,
                    "label": re.sub(r"(?<!^)(?=[A-Z])", " ", name).capitalize(),
                    "description": "Stored deterministic comparison retained from the final assessment.",
                    "values": [
                        _value_fact("firstValue", "First value", value.get("firstValueCents"), ids, money=True),
                        _value_fact("secondValue", "Second value", value.get("secondValueCents"), ids, money=True),
                        _value_fact("difference", "Difference", value.get("differenceCents"), ids, money=True),
                        _value_fact("differencePercent", "Difference percent", value.get("differenceBasisPoints"), ids, basis_points=True),
                    ],
                    "evidenceLabel": AUTOMATED_CALCULATION,
                    "evidenceIds": ids,
                }
            )
    return rows


def _range(value: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return {
        "semantics": value["semantics"],
        "evidenceBasis": value["evidenceBasis"],
        "low": _money(value["lowMinorUnits"], value["currency"]),
        "median": _money(value["medianMinorUnits"], value["currency"]),
        "high": _money(value["highMinorUnits"], value["currency"]),
        "evidenceLabel": AUTOMATED_CALCULATION,
        "evidenceIds": list(value["evidenceIds"]),
    }


def _preliminary_final(assessment: Mapping[str, Any]) -> dict[str, Any]:
    comparison = copy.deepcopy(assessment["preliminaryToFinalComparison"])
    if assessment["continuationStatus"] == "REVIEW_REQUIRED":
        status = "REVIEW_REQUIRED"
        summary = "The final assessment requires review before release."
    elif assessment["continuationStatus"] == "NEW_EVIDENCE_REQUIRED":
        status = "NEW_EVIDENCE_REQUIRED"
        summary = "The final assessment requires new evidence before continuation."
    elif comparison["materialChange"]:
        status = "MATERIALLY_DIFFERENT"
        summary = "The final assessment materially differs from the preliminary result."
    else:
        status = "CONFIRMED"
        summary = "The final assessment confirms the preliminary result without a material change."
    return {"status": status, "summary": summary, **comparison}


def _message(
    value: Mapping[str, Any], evidence_label: str
) -> dict[str, Any]:
    return {
        "code": value["code"],
        "label": value.get("label") or value["code"].replace("_", " ").title(),
        "description": value["description"],
        "evidenceLabel": evidence_label,
        "evidenceIds": list(value.get("evidenceIds", [])),
    }


def _project_report_data(
    *,
    source: Mapping[str, Any],
    assessment: Mapping[str, Any],
    report_series_id: str,
    report_version_id: str,
    final_assessment_id: str,
    version_number: int,
    generated_at: str,
) -> dict[str, Any]:
    generated_at, issue_date = _canonical_utc(generated_at, "Report generation time")
    for label, value in (
        ("Report series ID", report_series_id),
        ("Report version ID", report_version_id),
        ("Final assessment ID", final_assessment_id),
    ):
        if not isinstance(value, str) or _UUID.fullmatch(value) is None:
            raise _failure(f"{label} is invalid", "REPORT_IDENTITY_INVALID")
    if isinstance(version_number, bool) or not isinstance(version_number, int) or version_number < 1:
        raise _failure("Report version number is invalid", "REPORT_IDENTITY_INVALID")

    case_id = assessment["lineage"]["caseId"]
    case_reference = case_id.replace("-", "")[:12].upper()
    filename = f"Venfour_Valuation_Evidence_{case_reference}_v{version_number}.pdf"
    index = _evidence_index(source)
    insurer = assessment["insurerValuationReviewed"]
    source_label = (
        INSURER_EXTRACTED
        if source["input"]["intakeMode"] == "REPORT"
        else CUSTOMER_SUPPLIED
    )
    insurer_name = source["input"]["confirmedFacts"].get("insurerName")
    insurer_name_ids = (
        [_reference_id(index, "/input/confirmedFacts/insurerName")]
        if insurer_name is not None
        else []
    )
    insurer_name_fact = _fact(
        key="insurerName",
        label="Insurer",
        value=insurer_name,
        evidence_label=CUSTOMER_SUPPLIED,
        evidence_ids=insurer_name_ids,
    )
    claim_reference_fact = _fact(
        key="claimReference",
        label="Confirmed claim / report reference",
        value=None,
        evidence_label=UNAVAILABLE,
        evidence_ids=[],
    )
    evidence_ids = (
        list(assessment["supportedRange"]["evidenceIds"])
        if assessment["supportedRange"] is not None
        else [
            evidence_id
            for finding in assessment["findings"]
            for evidence_id in finding["evidenceIds"]
        ]
    )
    reconciliation_summary = (
        "The supported range follows directly from the minimum, median, and maximum "
        "advertised prices in the selected primary evidence set. No point actual-cash "
        "value or independent dollar adjustment was added."
        if assessment["supportedRange"] is not None
        else "No supported advertised-price range is stated because the final assessment did not contain a complete eligible primary evidence range."
    )
    reviewed_evidence = [
        {
            "label": "Customer-confirmed intake facts",
            "description": "Vehicle and claim context retained in the immutable source snapshot.",
            "evidenceLabel": CUSTOMER_SUPPLIED,
        },
        {
            "label": "Deterministic analysis artifact",
            "description": "The immutable analysis run, calculations, findings, and limitations.",
            "evidenceLabel": AUTOMATED_CALCULATION,
        },
        {
            "label": "Independent market records",
            "description": "Selected external advertised-price evidence retained by the analysis engine.",
            "evidenceLabel": MARKET_EVIDENCE,
        },
    ]
    if source["input"]["intakeMode"] == "REPORT":
        reviewed_evidence.insert(
            1,
            {
                "label": "Insurer valuation report extraction",
                "description": "Normalized report facts and insurer comparables frozen with the source document digest.",
                "evidenceLabel": INSURER_EXTRACTED,
            },
        )
    findings = [_message(value, DETERMINISTIC_FINDING) for value in assessment["findings"]]
    assumptions = [_message(value, ASSUMPTION) for value in assessment["assumptions"]]
    assumptions.append(
        {
            "code": "NO_PHYSICAL_VEHICLE_INSPECTION",
            "label": "No physical vehicle inspection",
            "description": "Venfour did not physically inspect the subject vehicle for this evidence package.",
            "evidenceLabel": ASSUMPTION,
            "evidenceIds": [],
        }
    )
    limitations = [_message(value, DETERMINISTIC_FINDING) for value in assessment["limitations"]]
    report = {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "identity": {
            "title": REPORT_TITLE,
            "reportSeriesId": report_series_id,
            "reportVersionId": report_version_id,
            "finalAssessmentId": final_assessment_id,
            "caseId": case_id,
            "versionNumber": version_number,
            "versionLabel": f"v{version_number}",
            "generatedAt": generated_at,
            "issueDate": issue_date,
            "suggestedFilename": filename,
        },
        "lineage": {
            "sourceSnapshotId": assessment["lineage"]["sourceSnapshotId"],
            "analysisRunId": assessment["lineage"]["analysisRunId"],
            "finalAssessmentId": final_assessment_id,
            "sourceSnapshotDigest": assessment["sourceSnapshotDigest"],
            "analysisArtifactDigest": assessment["analysisArtifactDigest"],
            "finalAssessmentDigest": assessment["assessmentDigest"],
            "assessmentMethodologyVersion": assessment["methodologyVersion"],
        },
        "evidenceCutoff": copy.deepcopy(source["evidenceCutoff"]),
        "purposeAndScope": {
            "intendedUse": "Organize valuation evidence for an informed request that the insurer reconsider the vehicle valuation.",
            "scopeStatement": "This self-service evidence package summarizes the frozen insurer, customer, market, and deterministic calculation records identified below.",
            "reviewedEvidence": reviewed_evidence,
            "physicalInspectionPerformed": False,
            "certifiedAppraisal": False,
            "legalDetermination": False,
        },
        "executiveConclusion": {
            "classification": assessment["finalClassification"],
            "classificationLabel": _classification_label(assessment["finalClassification"]),
            "continuationStatus": assessment["continuationStatus"],
            "evidenceStrength": assessment["evidenceStrength"],
            "evidenceBasis": assessment["evidenceBasis"],
            "summary": _conclusion_summary(assessment),
            "insurerValuation": {
                "value": _money(insurer["valueMinorUnits"], insurer["currency"]),
                "evidenceLabel": source_label,
                "evidenceIds": list(insurer["evidenceIds"]),
            },
            "supportedAdvertisedPriceRange": _range(assessment["supportedRange"]),
            "pointAcvDetermined": False,
        },
        "subjectVehicle": {
            "vehicleDisplay": _vehicle_display(assessment["subjectVehicle"]),
            "facts": _subject_facts(source, assessment, index),
        },
        "insurerValuationReviewed": {
            "insurerName": insurer_name_fact,
            "claimReference": claim_reference_fact,
            "source": insurer["source"],
            "valuation": _money(insurer["valueMinorUnits"], insurer["currency"]),
            "evidenceLabel": source_label,
            "evidenceIds": list(insurer["evidenceIds"]),
        },
        "insurerComparableReview": {
            "methodologyTreatment": assessment["insurerComparables"]["methodologyTreatment"],
            "weightingStatus": assessment["insurerComparables"]["weightingStatus"],
            "methodologyStatement": "Every insurer comparable available in the frozen assessment is shown descriptively. V1 does not assign a professional retained, challenged, or excluded weight.",
            "summary": copy.deepcopy(assessment["insurerComparables"]["summary"]),
            "comparables": _insurer_comparables(assessment),
        },
        "independentMarketEvidence": {
            "primary": _market_summary(assessment["externalEvidence"]["primary"]),
            "secondary": _market_summary(assessment["externalEvidence"]["secondary"]),
            "comparables": _market_comparables(assessment),
        },
        "adjustmentsAndCalculations": {
            "methodologyStatement": "Only stored deterministic calculations are shown. No report-generation adjustment or professional weighting is added.",
            "calculations": _calculations(assessment, index),
        },
        "evidenceReconciliation": {
            "summary": reconciliation_summary,
            "basis": assessment["evidenceBasis"],
            "pointAcvDetermined": False,
            "evidenceLabel": DETERMINISTIC_FINDING,
            "evidenceIds": sorted(set(evidence_ids)),
        },
        "preliminaryVersusFinal": _preliminary_final(assessment),
        "findings": findings,
        "assumptionsAndLimitations": {
            "assumptions": assumptions,
            "limitations": limitations,
        },
        "sourceEvidenceIndex": index,
        "exhibits": [],
    }
    return report


@dataclass(frozen=True)
class ValuationEvidenceReportV1:
    identity: Mapping[str, Any]
    lineage: Mapping[str, Any]
    evidence_cutoff: Mapping[str, Any]
    purpose_and_scope: Mapping[str, Any]
    executive_conclusion: Mapping[str, Any]
    subject_vehicle: Mapping[str, Any]
    insurer_valuation_reviewed: Mapping[str, Any]
    insurer_comparable_review: Mapping[str, Any]
    independent_market_evidence: Mapping[str, Any]
    adjustments_and_calculations: Mapping[str, Any]
    evidence_reconciliation: Mapping[str, Any]
    preliminary_versus_final: Mapping[str, Any]
    findings: tuple[Mapping[str, Any], ...]
    assumptions_and_limitations: Mapping[str, Any]
    source_evidence_index: tuple[Mapping[str, Any], ...]
    exhibits: tuple[Mapping[str, Any], ...]
    report_digest: str
    schema_version: str = REPORT_SCHEMA_VERSION

    def __post_init__(self) -> None:
        for field_name in (
            "identity",
            "lineage",
            "evidence_cutoff",
            "purpose_and_scope",
            "executive_conclusion",
            "subject_vehicle",
            "insurer_valuation_reviewed",
            "insurer_comparable_review",
            "independent_market_evidence",
            "adjustments_and_calculations",
            "evidence_reconciliation",
            "preliminary_versus_final",
            "assumptions_and_limitations",
        ):
            object.__setattr__(self, field_name, _freeze_json(getattr(self, field_name)))
        for field_name in ("findings", "source_evidence_index", "exhibits"):
            object.__setattr__(
                self,
                field_name,
                tuple(_freeze_json(item) for item in getattr(self, field_name)),
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "identity": _thaw_json(self.identity),
            "lineage": _thaw_json(self.lineage),
            "evidenceCutoff": _thaw_json(self.evidence_cutoff),
            "purposeAndScope": _thaw_json(self.purpose_and_scope),
            "executiveConclusion": _thaw_json(self.executive_conclusion),
            "subjectVehicle": _thaw_json(self.subject_vehicle),
            "insurerValuationReviewed": _thaw_json(self.insurer_valuation_reviewed),
            "insurerComparableReview": _thaw_json(self.insurer_comparable_review),
            "independentMarketEvidence": _thaw_json(self.independent_market_evidence),
            "adjustmentsAndCalculations": _thaw_json(self.adjustments_and_calculations),
            "evidenceReconciliation": _thaw_json(self.evidence_reconciliation),
            "preliminaryVersusFinal": _thaw_json(self.preliminary_versus_final),
            "findings": _thaw_json(self.findings),
            "assumptionsAndLimitations": _thaw_json(self.assumptions_and_limitations),
            "sourceEvidenceIndex": _thaw_json(self.source_evidence_index),
            "exhibits": _thaw_json(self.exhibits),
            "reportDigest": self.report_digest,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ValuationEvidenceReportV1:
        validate_valuation_evidence_report_v1(value)
        return cls(
            identity=value["identity"],
            lineage=value["lineage"],
            evidence_cutoff=value["evidenceCutoff"],
            purpose_and_scope=value["purposeAndScope"],
            executive_conclusion=value["executiveConclusion"],
            subject_vehicle=value["subjectVehicle"],
            insurer_valuation_reviewed=value["insurerValuationReviewed"],
            insurer_comparable_review=value["insurerComparableReview"],
            independent_market_evidence=value["independentMarketEvidence"],
            adjustments_and_calculations=value["adjustmentsAndCalculations"],
            evidence_reconciliation=value["evidenceReconciliation"],
            preliminary_versus_final=value["preliminaryVersusFinal"],
            findings=tuple(value["findings"]),
            assumptions_and_limitations=value["assumptionsAndLimitations"],
            source_evidence_index=tuple(value["sourceEvidenceIndex"]),
            exhibits=tuple(value["exhibits"]),
            report_digest=value["reportDigest"],
            schema_version=value["schemaVersion"],
        )


def _referenced_evidence_ids(report: Mapping[str, Any]) -> set[str]:
    identifiers: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, Mapping):
            for key, child in value.items():
                if key == "evidenceIds" and isinstance(child, Sequence):
                    identifiers.update(item for item in child if isinstance(item, str))
                else:
                    walk(child)
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            for child in value:
                walk(child)

    walk(report)
    return identifiers


def _validate_report_semantics(report: Mapping[str, Any]) -> None:
    unsigned = {
        key: copy.deepcopy(value) for key, value in report.items() if key != "reportDigest"
    }
    if report["reportDigest"] != canonical_package_digest(unsigned):
        raise _failure("Report digest does not match", "REPORT_DIGEST_MISMATCH")
    identity = report["identity"]
    if identity["title"] != REPORT_TITLE:
        raise _failure("Report title is invalid", "REPORT_IDENTITY_INVALID")
    if identity["versionLabel"] != f"v{identity['versionNumber']}":
        raise _failure("Report version label is invalid", "REPORT_IDENTITY_INVALID")
    expected_filename = (
        f"Venfour_Valuation_Evidence_{identity['caseId'].replace('-', '')[:12].upper()}_"
        f"v{identity['versionNumber']}.pdf"
    )
    if identity["suggestedFilename"] != expected_filename:
        raise _failure("Report filename is invalid", "REPORT_IDENTITY_INVALID")
    if _SAFE_FILENAME.fullmatch(identity["suggestedFilename"]) is None:
        raise _failure("Report filename is unsafe", "REPORT_IDENTITY_INVALID")
    _canonical_utc(identity["generatedAt"], "Report generation time")
    insurer_review = report["insurerComparableReview"]
    if insurer_review["methodologyTreatment"] != DESCRIPTIVE_ONLY:
        raise _failure(
            "Insurer comparable methodology was overstated",
            "REPORT_METHODOLOGY_INVALID",
        )
    if insurer_review["weightingStatus"] != NOT_DETERMINED_BY_V1:
        raise _failure(
            "Insurer comparable weighting was invented",
            "REPORT_METHODOLOGY_INVALID",
        )
    if report["executiveConclusion"]["pointAcvDetermined"]:
        raise _failure("Report cannot invent a point ACV", "REPORT_METHODOLOGY_INVALID")
    supported_range = report["executiveConclusion"]["supportedAdvertisedPriceRange"]
    if supported_range is not None and supported_range["semantics"] != (
        SELECTED_ADVERTISED_PRICE_RANGE
    ):
        raise _failure("Supported range semantics are invalid", "REPORT_METHODOLOGY_INVALID")
    index_ids = [row["evidenceId"] for row in report["sourceEvidenceIndex"]]
    if len(index_ids) != len(set(index_ids)):
        raise _failure("Evidence index contains duplicate IDs", "REPORT_PROVENANCE_INVALID")
    missing = sorted(_referenced_evidence_ids(report) - set(index_ids))
    if missing:
        raise _failure(
            "Report references evidence absent from its source index",
            "REPORT_PROVENANCE_INVALID",
            tuple(missing),
        )
    for section in (
        report["subjectVehicle"]["facts"],
        (
            report["insurerValuationReviewed"]["insurerName"],
            report["insurerValuationReviewed"]["claimReference"],
        ),
    ):
        for fact in section:
            if fact["value"] is None:
                if fact["evidenceLabel"] != UNAVAILABLE or fact["evidenceIds"]:
                    raise _failure(
                        "Unavailable report fact has invalid provenance",
                        "REPORT_PROVENANCE_INVALID",
                    )
            elif fact["evidenceLabel"] == UNAVAILABLE or not fact["evidenceIds"]:
                raise _failure(
                    "Available report fact is missing provenance",
                    "REPORT_PROVENANCE_INVALID",
                )


def validate_valuation_evidence_report_v1(
    value: ValuationEvidenceReportV1 | Mapping[str, Any],
    *,
    source_snapshot: TotalLossSourceSnapshotV1 | Mapping[str, Any] | None = None,
    final_assessment: FinalValuationAssessmentV1 | Mapping[str, Any] | None = None,
) -> None:
    report = value.to_dict() if isinstance(value, ValuationEvidenceReportV1) else value
    _validate_schema(report, REPORT_SCHEMA_PATH, "VALUATION_EVIDENCE_REPORT_INVALID")
    _validate_report_semantics(report)
    if (source_snapshot is None) != (final_assessment is None):
        raise _failure(
            "Source snapshot and final assessment must be validated together",
            "REPORT_SOURCE_INVALID",
        )
    if source_snapshot is None or final_assessment is None:
        return
    source = _mapping_data(source_snapshot, "Source snapshot")
    assessment = _mapping_data(final_assessment, "Final assessment")
    try:
        validate_total_loss_source_snapshot_v1(source)
        validate_final_valuation_assessment_v1(assessment, source_snapshot=source)
    except PackageAssessmentError as exc:
        raise _failure(
            "Report source lineage is invalid",
            "REPORT_SOURCE_INVALID",
            exc.details or (exc.code,),
        ) from exc
    identity = report["identity"]
    expected = _project_report_data(
        source=source,
        assessment=assessment,
        report_series_id=identity["reportSeriesId"],
        report_version_id=identity["reportVersionId"],
        final_assessment_id=identity["finalAssessmentId"],
        version_number=identity["versionNumber"],
        generated_at=identity["generatedAt"],
    )
    expected["reportDigest"] = canonical_package_digest(expected)
    if canonical_json_bytes(report) != canonical_json_bytes(expected):
        raise _failure(
            "Report does not match its immutable source and final assessment",
            "REPORT_SOURCE_MISMATCH",
        )


def build_valuation_evidence_report_v1(
    *,
    source_snapshot: TotalLossSourceSnapshotV1 | Mapping[str, Any],
    final_assessment: FinalValuationAssessmentV1 | Mapping[str, Any],
    report_series_id: str,
    report_version_id: str,
    final_assessment_id: str,
    version_number: int,
    generated_at: str,
) -> ValuationEvidenceReportV1:
    source = _mapping_data(source_snapshot, "Source snapshot")
    assessment = _mapping_data(final_assessment, "Final assessment")
    try:
        validate_total_loss_source_snapshot_v1(source)
        validate_final_valuation_assessment_v1(assessment, source_snapshot=source)
    except PackageAssessmentError as exc:
        raise _failure(
            "Report source lineage is invalid",
            "REPORT_SOURCE_INVALID",
            exc.details or (exc.code,),
        ) from exc
    unsigned = _project_report_data(
        source=source,
        assessment=assessment,
        report_series_id=report_series_id,
        report_version_id=report_version_id,
        final_assessment_id=final_assessment_id,
        version_number=version_number,
        generated_at=generated_at,
    )
    data = {**unsigned, "reportDigest": canonical_package_digest(unsigned)}
    report = ValuationEvidenceReportV1.from_dict(data)
    validate_valuation_evidence_report_v1(
        report,
        source_snapshot=source,
        final_assessment=assessment,
    )
    return report


def suggested_report_filename(
    report: ValuationEvidenceReportV1 | Mapping[str, Any],
) -> str:
    value = report.to_dict() if isinstance(report, ValuationEvidenceReportV1) else report
    validate_valuation_evidence_report_v1(value)
    return value["identity"]["suggestedFilename"]


def _clean_text(value: Any) -> str:
    text = str(value if value is not None else "Unavailable")
    text = (
        text.replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
    )
    text = "".join(character for character in text if ord(character) >= 32 or character in "\n\t")
    return text


def _paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(_clean_text(value)).replace("\n", "<br/>"), style)


def _tag(value: str) -> str:
    return value.replace("_", " ")


def _id_paragraph(value: str, style: ParagraphStyle) -> Paragraph:
    chunks = [value[index : index + 18] for index in range(0, len(value), 18)]
    return Paragraph("<br/>".join(html.escape(chunk) for chunk in chunks), style)


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    ink = colors.HexColor("#17252D")
    muted = colors.HexColor("#52636B")
    accent = colors.HexColor("#236B6B")
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=27,
            textColor=ink,
            alignment=TA_LEFT,
            spaceAfter=18,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=15,
            textColor=muted,
            spaceAfter=7,
        ),
        "section": ParagraphStyle(
            "ReportSection",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=18,
            textColor=accent,
            spaceBefore=13,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "subsection": ParagraphStyle(
            "ReportSubsection",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=13,
            textColor=ink,
            spaceBefore=8,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "ReportBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12,
            textColor=ink,
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "ReportSmall",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7,
            leading=9,
            textColor=ink,
        ),
        "tiny": ParagraphStyle(
            "ReportTiny",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=5.8,
            leading=7.2,
            textColor=ink,
            wordWrap="CJK",
        ),
        "label": ParagraphStyle(
            "ReportLabel",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7,
            leading=9,
            textColor=muted,
        ),
        "coverMeta": ParagraphStyle(
            "CoverMeta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=ink,
        ),
        "centerSmall": ParagraphStyle(
            "CenterSmall",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7,
            leading=9,
            alignment=TA_CENTER,
            textColor=muted,
        ),
    }


def _table(
    rows: Sequence[Sequence[Any]],
    widths: Sequence[float],
    styles: Mapping[str, ParagraphStyle],
    *,
    repeat_rows: int = 1,
    font_style: str = "small",
) -> LongTable:
    rendered: list[list[Any]] = []
    for row_index, row in enumerate(rows):
        row_style = styles["label"] if row_index < repeat_rows else styles[font_style]
        rendered.append(
            [
                value if isinstance(value, Paragraph) else _paragraph(value, row_style)
                for value in row
            ]
        )
    table = LongTable(rendered, colWidths=list(widths), repeatRows=repeat_rows, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, repeat_rows - 1), colors.HexColor("#E8EFEF")),
                ("TEXTCOLOR", (0, 0), (-1, repeat_rows - 1), colors.HexColor("#233B43")),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#B9C8CC")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, repeat_rows), (-1, -1), [colors.white, colors.HexColor("#F7F9F9")]),
            ]
        )
    )
    return table


class _InvariantCanvas(Canvas):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["invariant"] = 1
        kwargs["pageCompression"] = 1
        super().__init__(*args, **kwargs)


def _header_footer(
    canvas: Canvas,
    document: SimpleDocTemplate,
    identity: Mapping[str, Any],
) -> None:
    canvas.saveState()
    width, height = LETTER
    if document.page > 1:
        canvas.setFont("Helvetica-Bold", 7)
        canvas.setFillColor(colors.HexColor("#52636B"))
        canvas.drawString(0.68 * inch, height - 0.42 * inch, REPORT_TITLE)
        canvas.setStrokeColor(colors.HexColor("#CAD5D8"))
        canvas.line(0.68 * inch, height - 0.50 * inch, width - 0.68 * inch, height - 0.50 * inch)
    canvas.setStrokeColor(colors.HexColor("#CAD5D8"))
    canvas.line(0.68 * inch, 0.48 * inch, width - 0.68 * inch, 0.48 * inch)
    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(colors.HexColor("#52636B"))
    canvas.drawString(0.68 * inch, 0.29 * inch, f"Report ID: {identity['reportVersionId']}")
    canvas.drawRightString(
        width - 0.68 * inch,
        0.29 * inch,
        f"{identity['versionLabel']}  |  Page {document.page}",
    )
    canvas.restoreState()


def _section(title: str, styles: Mapping[str, ParagraphStyle]) -> Paragraph:
    return _paragraph(title, styles["section"])


def _render_report_story(
    report: Mapping[str, Any], styles: Mapping[str, ParagraphStyle]
) -> list[Any]:
    story: list[Any] = []
    identity = report["identity"]
    subject = report["subjectVehicle"]
    conclusion = report["executiveConclusion"]
    story.extend(
        [
            Spacer(1, 0.55 * inch),
            _paragraph("VENFOUR", styles["label"]),
            Spacer(1, 0.18 * inch),
            _paragraph(identity["title"], styles["title"]),
            _paragraph("Professional organization of total-loss valuation evidence", styles["subtitle"]),
            Spacer(1, 0.35 * inch),
            Table(
                [
                    [_paragraph("Subject vehicle", styles["label"]), _paragraph(subject["vehicleDisplay"], styles["coverMeta"])],
                    [_paragraph("Insurer", styles["label"]), _paragraph(report["insurerValuationReviewed"]["insurerName"]["displayValue"], styles["coverMeta"])],
                    [_paragraph("Date of loss", styles["label"]), _paragraph(report["evidenceCutoff"]["lossDate"], styles["coverMeta"])],
                    [_paragraph("Issue date", styles["label"]), _paragraph(identity["issueDate"], styles["coverMeta"])],
                    [_paragraph("Report ID", styles["label"]), _paragraph(identity["reportVersionId"], styles["coverMeta"])],
                    [_paragraph("Version", styles["label"]), _paragraph(identity["versionLabel"], styles["coverMeta"])],
                ],
                colWidths=[1.35 * inch, 4.85 * inch],
                style=TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LINEBELOW", (0, 0), (-1, -2), 0.35, colors.HexColor("#D8E0E2")),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ]
                ),
            ),
            Spacer(1, 0.55 * inch),
            _paragraph(
                "Evidence-first, deterministic report. This package is not a certified appraisal, legal valuation determination, or guarantee of settlement.",
                styles["subtitle"],
            ),
            PageBreak(),
        ]
    )

    purpose = report["purposeAndScope"]
    story.append(_section("Purpose and scope", styles))
    story.append(_paragraph(purpose["intendedUse"], styles["body"]))
    story.append(_paragraph(purpose["scopeStatement"], styles["body"]))
    reviewed_rows = [["Evidence category", "What was reviewed", "Attribution"]]
    for row in purpose["reviewedEvidence"]:
        reviewed_rows.append([row["label"], row["description"], _tag(row["evidenceLabel"])])
    story.append(_table(reviewed_rows, [1.55 * inch, 3.75 * inch, 1.3 * inch], styles))
    story.append(
        _paragraph(
            "No physical vehicle inspection was performed. The package does not determine legal entitlement and is not a certified appraisal.",
            styles["body"],
        )
    )

    story.append(_section("Executive conclusion", styles))
    range_value = conclusion["supportedAdvertisedPriceRange"]
    executive_rows = [
        ["Classification", conclusion["classificationLabel"]],
        ["Evidence strength", conclusion["evidenceStrength"]],
        ["Evidence basis", conclusion["evidenceBasis"]],
        ["Insurer valuation reviewed", conclusion["insurerValuation"]["value"]["display"]],
        [
            "Supported advertised-price range",
            (
                f"{range_value['low']['display']} to {range_value['high']['display']} "
                f"(median {range_value['median']['display']})"
                if range_value is not None
                else "Unavailable"
            ),
        ],
    ]
    story.append(_table(executive_rows, [2.25 * inch, 4.35 * inch], styles, repeat_rows=0))
    story.append(_paragraph(conclusion["summary"], styles["body"]))

    story.append(_section("Subject vehicle", styles))
    vehicle_rows = [["Fact", "Value", "Evidence label"]]
    for fact in subject["facts"]:
        vehicle_rows.append([fact["label"], fact["displayValue"], _tag(fact["evidenceLabel"])])
    story.append(_table(vehicle_rows, [2.25 * inch, 2.9 * inch, 1.45 * inch], styles))

    insurer = report["insurerValuationReviewed"]
    story.append(_section("Insurer valuation reviewed", styles))
    insurer_rows = [
        ["Insurer", insurer["insurerName"]["displayValue"]],
        ["Confirmed claim / report reference", insurer["claimReference"]["displayValue"]],
        ["Valuation source", insurer["source"]],
        ["Valuation reviewed", insurer["valuation"]["display"]],
        ["Evidence label", _tag(insurer["evidenceLabel"])],
    ]
    story.append(_table(insurer_rows, [2.25 * inch, 4.35 * inch], styles, repeat_rows=0))

    insurer_comps = report["insurerComparableReview"]
    story.append(_section("Insurer comparable review", styles))
    story.append(_paragraph(insurer_comps["methodologyStatement"], styles["body"]))
    story.append(
        _paragraph(
            f"Methodology treatment: {insurer_comps['methodologyTreatment']} | Professional weighting: {insurer_comps['weightingStatus']}",
            styles["body"],
        )
    )
    insurer_rows = [["Comp", "Vehicle / VIN", "Mileage", "Advertised", "Adjusted", "Net adj.", "Dealer / location"]]
    for comp in insurer_comps["comparables"]:
        insurer_rows.append(
            [
                comp["comparableNumber"] if comp["comparableNumber"] is not None else "-",
                f"{comp['vehicleDisplay']}\n{comp['vin'] or 'VIN unavailable'}",
                _display(comp["mileage"]),
                comp["advertisedPrice"] or "Unavailable",
                comp["adjustedValue"] or "Unavailable",
                comp["netAdjustment"] or "Unavailable",
                f"{comp['dealer'] or 'Unavailable'}\n{comp['location'] or 'Unavailable'}",
            ]
        )
    if len(insurer_rows) == 1:
        story.append(_paragraph("No insurer comparable rows were available in the frozen assessment.", styles["body"]))
    else:
        story.append(_table(insurer_rows, [0.36 * inch, 1.35 * inch, 0.63 * inch, 0.78 * inch, 0.78 * inch, 0.7 * inch, 2.0 * inch], styles, font_style="tiny"))
        story.append(_paragraph("Disclosed insurer adjustments", styles["subsection"]))
        adjustment_rows = [["Comp", "Package", "Options", "Mileage", "Condition", "Disclosure", "Contribution"]]
        for comp in insurer_comps["comparables"]:
            adjustment_rows.append(
                [
                    comp["comparableNumber"] if comp["comparableNumber"] is not None else "-",
                    comp["adjustments"]["package"] or "Unavailable",
                    comp["adjustments"]["options"] or "Unavailable",
                    comp["adjustments"]["mileage"] or "Unavailable",
                    comp["adjustments"]["condition"] or "Unavailable",
                    comp["adjustmentDisclosure"],
                    f"{comp['contributionPercent']}%" if comp["contributionPercent"] is not None else "Unavailable",
                ]
            )
        story.append(_table(adjustment_rows, [0.45 * inch, 0.82 * inch, 0.82 * inch, 0.82 * inch, 0.82 * inch, 1.45 * inch, 0.85 * inch], styles, font_style="tiny"))

    market = report["independentMarketEvidence"]
    story.append(_section("Independent market evidence", styles))
    for role in ("primary", "secondary"):
        summary = market[role]
        if summary is not None:
            story.append(_paragraph(summary["label"], styles["subsection"]))
            story.append(_paragraph(summary["description"], styles["body"]))
            story.append(
                _paragraph(
                    f"Evidence date: {summary['evidenceDate']} | Selected: {summary['selectedCount']} | Provider: {summary['provider']}",
                    styles["body"],
                )
            )
    market_rows = [["Role / rank", "Vehicle / VIN", "Mileage", "Advertised", "Dealer / location", "Distance", "Match / temporal basis"]]
    for comp in market["comparables"]:
        market_rows.append(
            [
                f"{comp['role']} #{comp['rank'] if comp['rank'] is not None else '-'}",
                f"{comp['vehicleDisplay']}\n{comp['vin'] or 'VIN unavailable'}",
                _display(comp["mileage"]),
                comp["advertisedPrice"],
                f"{comp['dealer'] or 'Unavailable'}\n{comp['location'] or 'Unavailable'}",
                f"{_display(comp['distanceMiles'])} mi" if comp["distanceMiles"] is not None else "Unavailable",
                f"{comp['tier']}\n{comp['temporalBasis']}\n{comp['evidenceDate']}",
            ]
        )
    if len(market_rows) == 1:
        story.append(_paragraph("No selected independent market comparables were available.", styles["body"]))
    else:
        story.append(_table(market_rows, [0.62 * inch, 1.24 * inch, 0.6 * inch, 0.76 * inch, 1.45 * inch, 0.62 * inch, 1.31 * inch], styles, font_style="tiny"))

    calculations = report["adjustmentsAndCalculations"]
    story.append(_section("Adjustments and calculations", styles))
    story.append(_paragraph(calculations["methodologyStatement"], styles["body"]))
    for calculation in calculations["calculations"]:
        block: list[Any] = [
            _paragraph(calculation["label"], styles["subsection"]),
            _paragraph(calculation["description"], styles["body"]),
        ]
        values = [["Measure", "Value"]] + [
            [value["label"], value["displayValue"]] for value in calculation["values"]
        ]
        block.append(_table(values, [3.25 * inch, 3.35 * inch], styles))
        story.append(KeepTogether(block))
    if not calculations["calculations"]:
        story.append(_paragraph("No deterministic comparison calculation was available.", styles["body"]))

    reconciliation = report["evidenceReconciliation"]
    story.append(_section("Evidence reconciliation", styles))
    story.append(_paragraph(reconciliation["summary"], styles["body"]))
    story.append(_paragraph(f"Evidence basis: {reconciliation['basis']}", styles["body"]))

    comparison = report["preliminaryVersusFinal"]
    story.append(_section("Preliminary versus final", styles))
    story.append(_paragraph(comparison["summary"], styles["body"]))
    comparison_rows = [
        ["Measure", "Preliminary", "Final"],
        ["Classification", comparison["preliminary"]["classification"], comparison["final"]["classification"]],
        ["Range low", _money(comparison["preliminary"]["supportedRange"]["lowMinorUnits"])["display"], _money(comparison["final"]["supportedRange"]["lowMinorUnits"])["display"]],
        ["Range median", _money(comparison["preliminary"]["supportedRange"]["medianMinorUnits"])["display"], _money(comparison["final"]["supportedRange"]["medianMinorUnits"])["display"]],
        ["Range high", _money(comparison["preliminary"]["supportedRange"]["highMinorUnits"])["display"], _money(comparison["final"]["supportedRange"]["highMinorUnits"])["display"]],
    ]
    story.append(_table(comparison_rows, [2.1 * inch, 2.25 * inch, 2.25 * inch], styles))

    story.append(_section("Findings", styles))
    for number, finding in enumerate(report["findings"], 1):
        story.append(
            KeepTogether(
                [
                    _paragraph(f"{number}. {finding['label']} [{_tag(finding['evidenceLabel'])}]", styles["subsection"]),
                    _paragraph(finding["description"], styles["body"]),
                ]
            )
        )
    if not report["findings"]:
        story.append(_paragraph("No structured findings were recorded.", styles["body"]))

    story.append(_section("Assumptions and limitations", styles))
    for group_name in ("assumptions", "limitations"):
        story.append(_paragraph(group_name.title(), styles["subsection"]))
        for item in report["assumptionsAndLimitations"][group_name]:
            story.append(
                KeepTogether(
                    [
                        _paragraph(f"{item['label']} [{_tag(item['evidenceLabel'])}]", styles["subsection"]),
                        _paragraph(item["description"], styles["body"]),
                    ]
                )
            )

    story.append(_section("Source and evidence index", styles))
    story.append(
        _paragraph(
            "Stable evidence IDs below identify the frozen artifact and JSON location supporting report facts. Page-level insurer-document coordinates were not available in V1 and are not invented.",
            styles["body"],
        )
    )
    source_rows: list[list[Any]] = [["Evidence ID", "Label", "Artifact", "Source identity", "JSON pointer"]]
    for reference in report["sourceEvidenceIndex"]:
        source_rows.append(
            [
                _id_paragraph(reference["evidenceId"], styles["tiny"]),
                _tag(reference["evidenceLabel"]),
                reference["sourceArtifact"],
                reference["sourceIdentity"],
                reference["jsonPointer"],
            ]
        )
    story.append(_table(source_rows, [1.28 * inch, 1.03 * inch, 0.9 * inch, 1.15 * inch, 2.24 * inch], styles, font_style="tiny"))

    story.append(_section("Exhibits", styles))
    if report["exhibits"]:
        exhibit_rows = [["Exhibit", "Title", "Status", "Reason"]]
        for exhibit in report["exhibits"]:
            exhibit_rows.append(
                [
                    exhibit["identifier"],
                    exhibit["title"],
                    "Included" if exhibit["included"] else "Not included",
                    exhibit["reason"],
                ]
            )
        story.append(_table(exhibit_rows, [0.8 * inch, 1.8 * inch, 0.85 * inch, 3.15 * inch], styles))
    else:
        story.append(
            _paragraph(
                "No third-party images or source documents are appended. The evidence index preserves the material source identifiers without reproducing material whose reuse rights were not established.",
                styles["body"],
            )
        )
    return story


def render_valuation_evidence_report_pdf_v1(
    report: ValuationEvidenceReportV1 | Mapping[str, Any],
) -> bytes:
    value = report.to_dict() if isinstance(report, ValuationEvidenceReportV1) else copy.deepcopy(dict(report))
    validate_valuation_evidence_report_v1(value)
    buffer = io.BytesIO()
    styles = _styles()
    identity = value["identity"]
    document = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        rightMargin=0.68 * inch,
        leftMargin=0.68 * inch,
        topMargin=0.62 * inch,
        bottomMargin=0.62 * inch,
        title=REPORT_TITLE,
        author="Venfour",
        subject="Total-loss vehicle valuation evidence",
        creator=f"Venfour renderer {REPORT_RENDERER_VERSION}",
    )

    def page(canvas: Canvas, doc: SimpleDocTemplate) -> None:
        canvas.setTitle(REPORT_TITLE)
        canvas.setAuthor("Venfour")
        canvas.setSubject("Total-loss vehicle valuation evidence")
        canvas.setCreator(f"Venfour renderer {REPORT_RENDERER_VERSION}")
        canvas.setKeywords(
            f"reportVersionId={identity['reportVersionId']};reportDigest={value['reportDigest']};template={REPORT_TEMPLATE_VERSION}"
        )
        _header_footer(canvas, doc, identity)

    try:
        document.build(
            _render_report_story(value, styles),
            onFirstPage=page,
            onLaterPages=page,
            canvasmaker=_InvariantCanvas,
        )
    except Exception as exc:
        raise _failure("PDF rendering failed", "REPORT_PDF_RENDER_FAILED") from exc
    rendered = buffer.getvalue()
    if not rendered.startswith(b"%PDF-"):
        raise _failure("PDF renderer returned invalid bytes", "REPORT_PDF_RENDER_FAILED")
    return rendered


@dataclass(frozen=True)
class ReportPdfValidationManifestV1:
    status: str
    report_version_id: str
    report_digest: str
    renderer_version: str
    template_version: str
    filename: str
    media_type: str
    pdf_sha256: str
    byte_size: int
    page_count: int
    extracted_text_digest: str
    mandatory_section_checks: tuple[Mapping[str, Any], ...]
    required_content_checks: tuple[Mapping[str, Any], ...]
    blank_pages: tuple[int, ...]
    unresolved_placeholders: tuple[str, ...]
    manifest_digest: str
    schema_version: str = PDF_VALIDATION_SCHEMA_VERSION

    def __post_init__(self) -> None:
        for field_name in ("mandatory_section_checks", "required_content_checks"):
            object.__setattr__(
                self,
                field_name,
                tuple(_freeze_json(item) for item in getattr(self, field_name)),
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "status": self.status,
            "reportVersionId": self.report_version_id,
            "reportDigest": self.report_digest,
            "rendererVersion": self.renderer_version,
            "templateVersion": self.template_version,
            "filename": self.filename,
            "mediaType": self.media_type,
            "pdfSha256": self.pdf_sha256,
            "byteSize": self.byte_size,
            "pageCount": self.page_count,
            "extractedTextDigest": self.extracted_text_digest,
            "mandatorySectionChecks": _thaw_json(self.mandatory_section_checks),
            "requiredContentChecks": _thaw_json(self.required_content_checks),
            "blankPages": list(self.blank_pages),
            "unresolvedPlaceholders": list(self.unresolved_placeholders),
            "manifestDigest": self.manifest_digest,
        }

    @classmethod
    def from_dict(
        cls, value: Mapping[str, Any]
    ) -> ReportPdfValidationManifestV1:
        validate_report_pdf_manifest_v1(value)
        return cls(
            status=value["status"],
            report_version_id=value["reportVersionId"],
            report_digest=value["reportDigest"],
            renderer_version=value["rendererVersion"],
            template_version=value["templateVersion"],
            filename=value["filename"],
            media_type=value["mediaType"],
            pdf_sha256=value["pdfSha256"],
            byte_size=value["byteSize"],
            page_count=value["pageCount"],
            extracted_text_digest=value["extractedTextDigest"],
            mandatory_section_checks=tuple(value["mandatorySectionChecks"]),
            required_content_checks=tuple(value["requiredContentChecks"]),
            blank_pages=tuple(value["blankPages"]),
            unresolved_placeholders=tuple(value["unresolvedPlaceholders"]),
            manifest_digest=value["manifestDigest"],
            schema_version=value["schemaVersion"],
        )


def validate_report_pdf_manifest_v1(
    value: ReportPdfValidationManifestV1 | Mapping[str, Any],
) -> None:
    data = value.to_dict() if isinstance(value, ReportPdfValidationManifestV1) else value
    _validate_schema(data, PDF_VALIDATION_SCHEMA_PATH, "REPORT_PDF_MANIFEST_INVALID")
    unsigned = {
        key: copy.deepcopy(child)
        for key, child in data.items()
        if key != "manifestDigest"
    }
    if data["manifestDigest"] != canonical_package_digest(unsigned):
        raise _failure("PDF validation manifest digest does not match", "REPORT_PDF_MANIFEST_INVALID")


def _required_pdf_content(report: Mapping[str, Any]) -> list[tuple[str, str]]:
    identity = report["identity"]
    conclusion = report["executiveConclusion"]
    result = [
        ("REPORT_TITLE", REPORT_TITLE),
        ("REPORT_ID", identity["reportVersionId"]),
        ("REPORT_VERSION", identity["versionLabel"]),
        ("ISSUE_DATE", identity["issueDate"]),
        ("SUBJECT_VEHICLE", report["subjectVehicle"]["vehicleDisplay"]),
        (
            "INSURER_VALUATION",
            conclusion["insurerValuation"]["value"]["display"],
        ),
        ("METHODOLOGY_TREATMENT", DESCRIPTIVE_ONLY),
        ("WEIGHTING_STATUS", NOT_DETERMINED_BY_V1),
    ]
    supported = conclusion["supportedAdvertisedPriceRange"]
    if supported is not None:
        result.extend(
            [
                ("SUPPORTED_RANGE_LOW", supported["low"]["display"]),
                ("SUPPORTED_RANGE_MEDIAN", supported["median"]["display"]),
                ("SUPPORTED_RANGE_HIGH", supported["high"]["display"]),
            ]
        )
    return result


def validate_valuation_evidence_report_pdf_v1(
    pdf: bytes | bytearray | memoryview | Path | str,
    report: ValuationEvidenceReportV1 | Mapping[str, Any],
) -> ReportPdfValidationManifestV1:
    value = report.to_dict() if isinstance(report, ValuationEvidenceReportV1) else copy.deepcopy(dict(report))
    validate_valuation_evidence_report_v1(value)
    if isinstance(pdf, (Path, str)):
        try:
            data = Path(pdf).read_bytes()
        except OSError as exc:
            raise _failure("Rendered PDF is unavailable", "REPORT_PDF_INVALID") from exc
    elif isinstance(pdf, (bytes, bytearray, memoryview)):
        data = bytes(pdf)
    else:
        raise _failure("Rendered PDF input is invalid", "REPORT_PDF_INVALID")
    if len(data) == 0 or not data.startswith(b"%PDF-"):
        raise _failure("Rendered PDF magic bytes are invalid", "REPORT_PDF_INVALID")
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise _failure("Rendered PDF could not be parsed", "REPORT_PDF_INVALID") from exc
    try:
        if document.needs_pass:
            raise _failure("Rendered PDF must not be encrypted", "REPORT_PDF_INVALID")
        page_count = document.page_count
        if page_count < 1:
            raise _failure("Rendered PDF has no pages", "REPORT_PDF_INVALID")
        page_texts = [document.load_page(index).get_text("text") for index in range(page_count)]
        metadata = document.metadata or {}
    finally:
        document.close()
    blank_pages = [index + 1 for index, text in enumerate(page_texts) if not text.strip()]
    extracted_text = "\n".join(page_texts)
    unresolved = sorted(
        {
            match.group(0)
            for pattern in _PLACEHOLDER_PATTERNS
            for match in pattern.finditer(extracted_text)
        }
    )
    section_checks = [
        {"code": code, "status": "PASS"}
        for code, heading in MANDATORY_PDF_SECTIONS
        if heading in extracted_text
    ]
    missing_sections = [
        heading for _, heading in MANDATORY_PDF_SECTIONS if heading not in extracted_text
    ]
    content_checks = [
        {"code": code, "status": "PASS"}
        for code, expected in _required_pdf_content(value)
        if expected in extracted_text
    ]
    missing_content = [
        code
        for code, expected in _required_pdf_content(value)
        if expected not in extracted_text
    ]
    metadata_errors: list[str] = []
    if metadata.get("title") != REPORT_TITLE:
        metadata_errors.append("PDF title metadata does not match")
    keywords = metadata.get("keywords") or ""
    if value["identity"]["reportVersionId"] not in keywords:
        metadata_errors.append("PDF report identity metadata does not match")
    if value["reportDigest"] not in keywords:
        metadata_errors.append("PDF report digest metadata does not match")
    errors: list[str] = []
    if blank_pages:
        errors.append(f"blank pages: {blank_pages}")
    if unresolved:
        errors.append(f"unresolved placeholders: {unresolved}")
    if missing_sections:
        errors.append(f"missing mandatory sections: {missing_sections}")
    if missing_content:
        errors.append(f"missing required content checks: {missing_content}")
    errors.extend(metadata_errors)
    if errors:
        raise _failure(
            "Rendered PDF failed deterministic validation",
            "REPORT_PDF_INVALID",
            tuple(errors),
        )
    unsigned = {
        "schemaVersion": PDF_VALIDATION_SCHEMA_VERSION,
        "status": "PASS",
        "reportVersionId": value["identity"]["reportVersionId"],
        "reportDigest": value["reportDigest"],
        "rendererVersion": REPORT_RENDERER_VERSION,
        "templateVersion": REPORT_TEMPLATE_VERSION,
        # Storage identity is intentionally independent from the friendly
        # customer download name projected into report.identity.
        "filename": REPORT_STORAGE_FILENAME,
        "mediaType": "application/pdf",
        "pdfSha256": hashlib.sha256(data).hexdigest(),
        "byteSize": len(data),
        "pageCount": page_count,
        "extractedTextDigest": hashlib.sha256(extracted_text.encode("utf-8")).hexdigest(),
        "mandatorySectionChecks": section_checks,
        "requiredContentChecks": content_checks,
        "blankPages": [],
        "unresolvedPlaceholders": [],
    }
    manifest = ReportPdfValidationManifestV1.from_dict(
        {**unsigned, "manifestDigest": canonical_package_digest(unsigned)}
    )
    return manifest


__all__ = [
    "ASSUMPTION",
    "AUTOMATED_CALCULATION",
    "CUSTOMER_SUPPLIED",
    "DESCRIPTIVE_ONLY",
    "DETERMINISTIC_FINDING",
    "DISPUTED",
    "EVIDENCE_LABELS",
    "INSURER_EXTRACTED",
    "MARKET_EVIDENCE",
    "NOT_DETERMINED_BY_V1",
    "PDF_VALIDATION_SCHEMA_VERSION",
    "REPORT_RENDERER_VERSION",
    "REPORT_SCHEMA_VERSION",
    "REPORT_STORAGE_FILENAME",
    "REPORT_TEMPLATE_VERSION",
    "REPORT_TITLE",
    "ReportPdfValidationManifestV1",
    "UNAVAILABLE",
    "VERIFIED_FACT",
    "ValuationEvidenceReportError",
    "ValuationEvidenceReportV1",
    "build_valuation_evidence_report_v1",
    "render_valuation_evidence_report_pdf_v1",
    "suggested_report_filename",
    "validate_report_pdf_manifest_v1",
    "validate_valuation_evidence_report_pdf_v1",
    "validate_valuation_evidence_report_v1",
]
