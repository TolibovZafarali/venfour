"""Provider-neutral ingestion for privately stored valuation-report PDFs.

This boundary validates the server-materialized canonical PDF, detects a known
provider from document text when practical, selects a specialized adapter or a
generic structured extractor, and returns only normalized facts plus safe
extraction metadata. Raw document bytes and Storage locations never enter the
result contract.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

import pymupdf
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from scripts.extract_report_ai import (
    AIExtractionResult,
    MAX_PDF_BYTES,
    MODEL,
    OpenAI,
    OpenAIError,
    OutputValidationError,
    PrototypeError,
    delete_uploaded_file,
    extract_report_with_openai,
    get_field,
    make_openai_schema,
    parse_model_json,
    print_usage,
    read_canonical_schema,
    require_api_key,
    require_dependencies,
    response_text,
    upload_pdf,
    usage_details,
    validate_extraction,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
NORMALIZED_REPORT_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "normalized-valuation-report.schema.json"
)
MAX_REPORT_PAGES = 250
MAX_PROVIDER_TEXT_CHARACTERS = 250_000

CCC_ADAPTER = "CCC"
GENERIC_ADAPTER = "GENERIC"
REPORT_ADAPTERS = frozenset({CCC_ADAPTER, GENERIC_ADAPTER})
REPORT_CONFIDENCE_LEVELS = frozenset({"LOW", "MEDIUM", "HIGH"})

REQUIRED_CUSTOMER_CONFIRMATION_FIELDS = (
    "report.lossDate",
    "report.insurer",
    "vehicle.year",
    "vehicle.make",
    "vehicle.model",
    "vehicle.trim",
    "vehicle.mileage",
    "condition.preLossCondition",
    "vehicle.equipment",
)

GENERIC_EXTRACTION_INSTRUCTIONS = """\
Extract facts from the supplied insurer vehicle valuation document into the
provided Venfour normalized valuation-report schema.

This is fact extraction only. Do not judge claim fairness, estimate missing
values, or infer a settlement entitlement.

Rules:
- Use only information supported by the document. Return null for an unsupported
  scalar and an empty array only when no reliable items can be extracted.
- Include every schema field. Use ISO YYYY-MM-DD for dates when the complete date
  is printed and can be normalized reliably.
- Distinguish the insurance carrier (report.insurer) from the company or system
  that produced the valuation (report.provider).
- Set report.providerId only when the printed provider is clearly CCC, Mitchell,
  Audatex, the insurer itself, or another identifiable provider. Use OTHER for an
  identifiable provider outside those named values and null when unknown.
- Keep an insurer's stated offer separate from report valuation components. Do
  not treat taxes, fees, or a vehicle-value subtotal as an offer unless the
  document explicitly presents it as the settlement or offer amount.
- Preserve positive and negative signs on every adjustment. Never derive an
  undisclosed category amount from a net adjustment.
- Keep each comparable vehicle in its own item and never combine columns or rows
  belonging to different vehicles. Preserve printed comparable numbers.
- Put taxes, fees, prior-damage adjustments, and other adjustments only in their
  corresponding fields. Do not silently fold them into condition or mileage.
- Extract only loss-vehicle equipment and packages into vehicle.equipment.
- Do not invent confidence scores, explanations, or analysis conclusions.
"""


class ReportIngestionError(Exception):
    """Base class for expected provider-neutral report-ingestion failures."""


class ReportDocumentInvalidError(ReportIngestionError):
    """The canonical internal PDF is empty, unsafe, encrypted, or unreadable."""


class ReportExtractionError(ReportIngestionError):
    """No valid normalized extraction could be produced."""


class NormalizedReportContractError(ReportIngestionError):
    """Normalized report data failed its repository contract."""

    def __init__(self, details: tuple[str, ...]) -> None:
        super().__init__("Normalized valuation report failed validation")
        self.details = details


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


@dataclass(frozen=True)
class ValidatedReportDocument:
    """Safe metadata for one already-validated canonical internal PDF."""

    path: Path
    sha256: str
    page_count: int
    provider_text: str


@dataclass(frozen=True)
class ReportIngestionResult:
    """Normalized report facts and bounded, customer-safe extraction metadata."""

    normalized_report: Mapping[str, Any]
    adapter: str
    provider: str | None
    provider_id: str | None
    confidence: str
    partial: bool
    warnings: tuple[str, ...]
    missing_required_fields: tuple[str, ...]
    document_sha256: str
    model: str | None = None
    usage: Mapping[str, int | None] | None = None

    def __post_init__(self) -> None:
        validate_normalized_report(self.normalized_report)
        if self.adapter not in REPORT_ADAPTERS:
            raise ValueError("Unknown report adapter")
        if self.confidence not in REPORT_CONFIDENCE_LEVELS:
            raise ValueError("Unknown report confidence")
        if not isinstance(self.partial, bool):
            raise ValueError("Report partial status is invalid")
        if self.partial != bool(self.missing_required_fields):
            raise ValueError("Report partial status does not match missing fields")
        if self.provider is not None and (
            not isinstance(self.provider, str)
            or not self.provider.strip()
            or len(self.provider) > 200
            or any(
                ord(character) < 32 or ord(character) == 127
                for character in self.provider
            )
        ):
            raise ValueError("Report provider is invalid")
        if self.provider_id not in {
            None,
            "CCC",
            "MITCHELL",
            "AUDATEX",
            "INSURER",
            "OTHER",
        }:
            raise ValueError("Report provider ID is invalid")
        if not isinstance(self.document_sha256, str) or (
            len(self.document_sha256) != 64
            or any(
                character not in "0123456789abcdef"
                for character in self.document_sha256
            )
        ):
            raise ValueError("Document digest is invalid")
        if self.model is not None and (
            not isinstance(self.model, str) or not self.model.strip()
        ):
            raise ValueError("Report extraction model is invalid")
        if not all(
            isinstance(item, str) and bool(item.strip()) for item in self.warnings
        ):
            raise ValueError("Report extraction warnings are invalid")
        if not all(
            isinstance(item, str) and bool(item.strip())
            for item in self.missing_required_fields
        ):
            raise ValueError("Report missing fields are invalid")
        if self.usage is not None and not isinstance(self.usage, Mapping):
            raise ValueError("Report extraction usage is invalid")
        object.__setattr__(
            self, "normalized_report", _freeze_json(self.normalized_report)
        )
        object.__setattr__(self, "warnings", tuple(self.warnings))
        object.__setattr__(
            self, "missing_required_fields", tuple(self.missing_required_fields)
        )
        if self.usage is not None:
            object.__setattr__(self, "usage", _freeze_json(self.usage))

    def to_dict(self, *, include_usage: bool = False) -> dict[str, Any]:
        result = {
            "schemaVersion": "1",
            "adapter": self.adapter,
            "provider": self.provider,
            "providerId": self.provider_id,
            "confidence": self.confidence,
            "partial": self.partial,
            "warnings": list(self.warnings),
            "missingRequiredFields": list(self.missing_required_fields),
            "documentSha256": self.document_sha256,
            "model": self.model,
            "normalizedReport": _thaw_json(self.normalized_report),
        }
        if include_usage:
            result["usage"] = _thaw_json(self.usage)
        return result

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ReportIngestionResult:
        if not isinstance(data, Mapping) or data.get("schemaVersion") != "1":
            raise NormalizedReportContractError(
                ("$: unsupported extraction result schema",)
            )
        normalized = data.get("normalizedReport")
        validate_normalized_report(normalized)
        warnings = data.get("warnings")
        missing = data.get("missingRequiredFields")
        if not isinstance(warnings, list) or not all(
            isinstance(item, str) and item for item in warnings
        ):
            raise NormalizedReportContractError(("$.warnings: invalid",))
        if not isinstance(missing, list) or not all(
            isinstance(item, str) and item for item in missing
        ):
            raise NormalizedReportContractError(
                ("$.missingRequiredFields: invalid",)
            )
        return cls(
            normalized_report=normalized,
            adapter=data.get("adapter"),
            provider=data.get("provider"),
            provider_id=data.get("providerId"),
            confidence=data.get("confidence"),
            partial=data.get("partial"),
            warnings=tuple(warnings),
            missing_required_fields=tuple(missing),
            document_sha256=data.get("documentSha256"),
            model=data.get("model"),
            usage=data.get("usage"),
        )


@lru_cache(maxsize=1)
def read_normalized_report_schema(version: str = "1") -> dict[str, Any]:
    if version not in {"1", "2"}:
        raise NormalizedReportContractError(("$.schemaVersion: unsupported version",))
    path = NORMALIZED_REPORT_SCHEMA_PATH if version == "1" else NORMALIZED_REPORT_SCHEMA_PATH.with_name("normalized-valuation-report-v2.schema.json")
    try:
        schema = json.loads(
            path.read_text(encoding="utf-8")
        )
        Draft202012Validator.check_schema(schema)
    except (OSError, ValueError, SchemaError) as exc:
        raise NormalizedReportContractError(
            ("$: normalized report schema is unavailable",)
        ) from exc
    return schema


def _json_path(parts: Any) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part, ensure_ascii=True)}]"
    return path


def validate_normalized_report(data: Any) -> None:
    schema = read_normalized_report_schema(data.get("schemaVersion", "1") if isinstance(data, Mapping) else "1")
    errors = sorted(
        Draft202012Validator(
            schema, format_checker=FormatChecker()
        ).iter_errors(data),
        key=lambda error: (list(error.absolute_path), error.message),
    )
    if errors:
        raise NormalizedReportContractError(
            tuple(
                f"{_json_path(error.absolute_path)}: {error.message}"
                for error in errors
            )
        )
    if isinstance(data, Mapping) and data.get("schemaVersion") == "2":
        from venfour.ccc_evidence import normalize_ccc_evidence_v2, validate_ccc_source_claims
        plain = _thaw_json(data)
        source_data = {
            "report": plain["report"], "vehicle": plain["vehicle"],
            "comparables": plain["evidence"]["comparableAppearances"],
            "contributionRows": plain["evidence"]["contributionRows"],
        }
        try:
            validate_ccc_source_claims(source_data)
        except ValueError as exc:
            raise NormalizedReportContractError((str(exc),)) from exc
        expected = normalize_ccc_evidence_v2(source_data, plain)
        if any(plain[field] != expected[field] for field in ("comparables", "evidence")):
            raise NormalizedReportContractError(("$.evidence: source relationships do not match deterministic normalization",))


def validate_effective_report(data: Any) -> None:
    """Validate the versioned input projection used by the live orchestrator."""
    version = data.get("schemaVersion", "1") if isinstance(data, Mapping) else "1"
    if version == "1":
        legacy = _thaw_json(data)
        vehicle = legacy.get("vehicle", {}) if isinstance(legacy, Mapping) else {}
        if "drivetrain" in vehicle:
            from venfour.ccc_evidence import DRIVETRAINS
            if vehicle["drivetrain"] not in DRIVETRAINS | {None}:
                raise NormalizedReportContractError(("$.vehicle.drivetrain: invalid explicit configuration",))
            vehicle.pop("drivetrain")
            vehicle.pop("drivetrainSource", None)
        validate_extraction(legacy, read_canonical_schema())
        return
    if version != "2":
        raise NormalizedReportContractError(("$.schemaVersion: unsupported effective report",))
    schema = json.loads((REPO_ROOT / "schemas" / "ccc" / "effective-report-v2.schema.json").read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(data), key=lambda error: str(error.path))
    if errors:
        raise NormalizedReportContractError(tuple(f"{_json_path(error.path)}: {error.message}" for error in errors))
    raw = _thaw_json(data)
    raw["comparables"] = raw["evidence"]["comparableAppearances"]
    raw["contributionRows"] = raw["evidence"]["contributionRows"]
    expected = normalized_report_to_legacy_report(normalize_ccc_report(raw))
    if any(data[field] != expected[field] for field in ("comparables", "evidence")):
        raise NormalizedReportContractError(("$.evidence: effective source relationships do not match normalization",))


def validate_canonical_pdf(path: Path | str) -> ValidatedReportDocument:
    """Validate a server-owned canonical PDF before any external processing."""

    source_path = Path(path)
    try:
        if not source_path.is_file():
            raise ReportDocumentInvalidError("Valuation report was not found")
        size = source_path.stat().st_size
        if size <= 0:
            raise ReportDocumentInvalidError("Valuation report is empty")
        if size > MAX_PDF_BYTES:
            raise ReportDocumentInvalidError(
                "Valuation report exceeds the size limit"
            )
        with source_path.open("rb") as source:
            header = source.read(5)
            digest = hashlib.sha256()
            digest.update(header)
            copied = len(header)
            while chunk := source.read(1024 * 1024):
                copied += len(chunk)
                if copied > MAX_PDF_BYTES:
                    raise ReportDocumentInvalidError(
                        "Valuation report exceeds the size limit"
                    )
                digest.update(chunk)
    except ReportDocumentInvalidError:
        raise
    except OSError as exc:
        raise ReportDocumentInvalidError(
            "Valuation report could not be read"
        ) from exc
    if header != b"%PDF-":
        raise ReportDocumentInvalidError("Valuation report is not a canonical PDF")

    try:
        document = pymupdf.open(source_path)
        try:
            if document.needs_pass:
                raise ReportDocumentInvalidError(
                    "Password-protected valuation reports cannot be processed"
                )
            page_count = document.page_count
            if page_count < 1:
                raise ReportDocumentInvalidError("Valuation report has no pages")
            if page_count > MAX_REPORT_PAGES:
                raise ReportDocumentInvalidError(
                    "Valuation report has too many pages"
                )
            text_parts: list[str] = []
            remaining = MAX_PROVIDER_TEXT_CHARACTERS
            for page_number in range(page_count):
                page = document.load_page(page_number)
                if remaining <= 0:
                    break
                text = page.get_text("text")
                if text:
                    text_parts.append(text[:remaining])
                    remaining -= len(text_parts[-1])
        finally:
            document.close()
    except ReportDocumentInvalidError:
        raise
    except (RuntimeError, ValueError, OSError) as exc:
        raise ReportDocumentInvalidError(
            "Valuation report is corrupt or unreadable"
        ) from exc

    return ValidatedReportDocument(
        path=source_path,
        sha256=digest.hexdigest(),
        page_count=page_count,
        provider_text="\n".join(text_parts),
    )


def detect_report_provider(document_text: str) -> tuple[str | None, str | None]:
    """Return a normalized provider ID/name only when document text supports it."""

    normalized = " ".join(document_text.casefold().split())
    known_patterns = (
        (
            "CCC",
            "CCC",
            (
                "ccc one",
                "ccc intelligent solutions",
                "ccc information services",
                "valuation detail by ccc",
            ),
        ),
        (
            "MITCHELL",
            "Mitchell",
            ("mitchell workcenter", "mitchell cloud estimating", "mitchell international"),
        ),
        (
            "AUDATEX",
            "Audatex",
            ("audatex", "solera audatex"),
        ),
    )
    for provider_id, provider_name, patterns in known_patterns:
        if any(pattern in normalized for pattern in patterns):
            return provider_id, provider_name
    return None, None


def _nullable_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    return normalized or None


def _date_text(value: Any) -> str | None:
    text = _nullable_text(value)
    if text is None:
        return None
    for date_format in (None, "%m/%d/%Y", "%m-%d-%Y"):
        try:
            if date_format is None:
                return datetime.fromisoformat(text).date().isoformat()
            return datetime.strptime(text, date_format).date().isoformat()
        except ValueError:
            continue
    return None


def _string_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := _nullable_text(item)) is not None]


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def normalize_ccc_report(data: Mapping[str, Any]) -> dict[str, Any]:
    """Map the established CCC extraction contract into the neutral contract."""

    report = _mapping(data.get("report"))
    vehicle = _mapping(data.get("vehicle"))
    valuation = _mapping(data.get("valuation"))
    condition = _mapping(data.get("condition"))
    supplemental = _mapping(data.get("supplementalInformation"))
    comparables: list[dict[str, Any]] = []
    raw_comparables = data.get("comparables")
    if isinstance(raw_comparables, list):
        for raw in raw_comparables:
            comparable = _mapping(raw)
            adjustments = _mapping(comparable.get("adjustments"))
            comparables.append(
                {
                    "number": comparable.get("number"),
                    "year": comparable.get("year"),
                    "make": _nullable_text(comparable.get("make")),
                    "model": _nullable_text(comparable.get("model")),
                    "trim": _nullable_text(comparable.get("trim")),
                    "vin": _nullable_text(comparable.get("vin")),
                    "dealer": _nullable_text(comparable.get("dealer")),
                    "location": _nullable_text(comparable.get("location")),
                    "distanceMiles": comparable.get("distanceMiles"),
                    "mileage": comparable.get("mileage"),
                    "listPrice": comparable.get("listPrice"),
                    "adjustments": {
                        "package": adjustments.get("package"),
                        "options": adjustments.get("options"),
                        "mileage": adjustments.get("mileage"),
                        "condition": adjustments.get("condition"),
                        "priorDamage": None,
                        "other": None,
                    },
                    "adjustedValue": comparable.get("adjustedValue"),
                    "contributionPercent": comparable.get("contributionPercent"),
                }
            )
    condition_items: list[dict[str, Any]] = []
    raw_condition_items = condition.get("items")
    if isinstance(raw_condition_items, list):
        for raw in raw_condition_items:
            item = _mapping(raw)
            condition_items.append(
                {
                    "category": _nullable_text(item.get("category")),
                    "component": _nullable_text(item.get("component")),
                    "rating": _nullable_text(item.get("rating")),
                    "notes": _nullable_text(item.get("notes")),
                    "valueImpact": item.get("valueImpact"),
                }
            )
    provider = _nullable_text(report.get("provider"))
    provider_id = "CCC" if provider and provider.casefold() in {"ccc", "ccc one"} else None
    normalized = {
        "schemaVersion": "1",
        "report": {
            "provider": provider,
            "providerId": provider_id,
            "insurer": None,
            "reportReferenceNumber": _nullable_text(
                report.get("reportReferenceNumber")
            ),
            "claimReferenceNumber": _nullable_text(
                report.get("claimReferenceNumber")
            ),
            "lossDate": _date_text(report.get("lossDate")),
            "reportDate": _date_text(report.get("reportDate")),
            "effectiveDate": None,
        },
        "vehicle": {
            "year": vehicle.get("year"),
            "make": _nullable_text(vehicle.get("make")),
            "model": _nullable_text(vehicle.get("model")),
            "trim": _nullable_text(vehicle.get("trim")),
            "vin": _nullable_text(vehicle.get("vin")),
            "mileage": vehicle.get("mileage"),
            "location": _nullable_text(vehicle.get("location")),
            "bodyStyle": _nullable_text(vehicle.get("bodyStyle")),
            "engine": _nullable_text(vehicle.get("engine")),
            "transmission": _nullable_text(vehicle.get("transmission")),
            "fuelType": _nullable_text(vehicle.get("fuelType")),
            "equipment": _string_items(vehicle.get("equipment")),
        },
        "valuation": {
            "baseVehicleValue": valuation.get("baseVehicleValue"),
            "conditionAdjustment": valuation.get("conditionAdjustment"),
            "adjustedVehicleValue": valuation.get("adjustedVehicleValue"),
            "insurerOffer": None,
            "taxes": [],
            "fees": [],
            "priorDamageAdjustment": None,
            "otherAdjustments": [],
            "total": valuation.get("total"),
        },
        "condition": {
            "preLossCondition": None,
            "totalAdjustment": condition.get("totalAdjustment"),
            "items": condition_items,
        },
        "comparables": comparables,
        "valuationNotes": _string_items(data.get("valuationNotes")),
        "supplementalInformation": {
            "historyChecks": _string_items(supplemental.get("historyChecks")),
            "historyEvents": _string_items(supplemental.get("historyEvents")),
            "recalls": _string_items(supplemental.get("recalls")),
        },
    }
    if data.get("schemaVersion") == "2":
        from venfour.ccc_evidence import normalize_ccc_evidence_v2
        normalized = normalize_ccc_evidence_v2(data, normalized)
    validate_normalized_report(normalized)
    return normalized


def normalized_report_to_legacy_report(
    normalized: Mapping[str, Any],
) -> dict[str, Any]:
    """Project neutral facts to the stable internal discrepancy input shape."""

    validate_normalized_report(normalized)
    report = _mapping(normalized["report"])
    vehicle = _mapping(normalized["vehicle"])
    valuation = _mapping(normalized["valuation"])
    condition = _mapping(normalized["condition"])
    comparables: list[dict[str, Any]] = []
    for raw in normalized["comparables"]:
        comparable = _mapping(raw)
        adjustments = _mapping(comparable.get("adjustments"))
        comparables.append(
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
                    "package": adjustments.get("package"),
                    "options": adjustments.get("options"),
                    "mileage": adjustments.get("mileage"),
                    "condition": adjustments.get("condition"),
                },
                "adjustedValue": comparable.get("adjustedValue"),
                "contributionPercent": comparable.get("contributionPercent"),
            }
        )
    legacy = {
        "report": {
            "provider": report.get("provider") or "Unknown valuation provider",
            "reportReferenceNumber": report.get("reportReferenceNumber"),
            "claimReferenceNumber": report.get("claimReferenceNumber"),
            "lossDate": report.get("lossDate"),
            "reportDate": report.get("reportDate"),
        },
        "vehicle": {
            "year": vehicle.get("year"),
            "make": vehicle.get("make"),
            "model": vehicle.get("model"),
            "trim": vehicle.get("trim"),
            "vin": vehicle.get("vin"),
            "mileage": vehicle.get("mileage"),
            "location": vehicle.get("location"),
            "bodyStyle": vehicle.get("bodyStyle"),
            "engine": vehicle.get("engine"),
            "transmission": vehicle.get("transmission"),
            "fuelType": vehicle.get("fuelType"),
            "equipment": list(vehicle.get("equipment") or []),
        },
        "valuation": {
            "baseVehicleValue": valuation.get("baseVehicleValue"),
            "conditionAdjustment": valuation.get("conditionAdjustment"),
            "adjustedVehicleValue": (
                valuation.get("insurerOffer")
                if valuation.get("insurerOffer") is not None
                else valuation.get("adjustedVehicleValue")
            ),
            "total": valuation.get("total"),
        },
        "condition": {
            "totalAdjustment": condition.get("totalAdjustment"),
            "items": [dict(item) for item in condition.get("items") or []],
        },
        "comparables": comparables,
        "valuationNotes": list(normalized.get("valuationNotes") or []),
        "supplementalInformation": dict(normalized["supplementalInformation"]),
    }
    if normalized["schemaVersion"] == "2":
        legacy["schemaVersion"] = "2"
        legacy["report"]["insurer"] = report["insurer"]
        legacy["report"]["effectiveDate"] = report["effectiveDate"]
        legacy["vehicle"]["drivetrain"] = vehicle["drivetrain"]
        legacy["vehicle"]["drivetrainSource"] = copy.deepcopy(vehicle["drivetrainSource"])
        for target, source in zip(legacy["comparables"], normalized["comparables"], strict=True):
            for field in ("drivetrain", "sourcePrice", "source", "sourceReferences", "contributionBinding"):
                target[field] = copy.deepcopy(source[field])
        legacy["evidence"] = copy.deepcopy(normalized["evidence"])
    return legacy


def _value_at_path(data: Mapping[str, Any], path: str) -> Any:
    value: Any = data
    for part in path.split("."):
        if not isinstance(value, Mapping):
            return None
        value = value.get(part)
    return value


def _missing_confirmation_fields(normalized: Mapping[str, Any]) -> tuple[str, ...]:
    missing: list[str] = []
    for path in REQUIRED_CUSTOMER_CONFIRMATION_FIELDS:
        value = _value_at_path(normalized, path)
        if value is None or value == "" or value == []:
            missing.append(path)
    return tuple(missing)


def _confidence(
    *, adapter: str, provider_id: str | None, missing_count: int
) -> str:
    if missing_count == 0 and (adapter == CCC_ADAPTER or provider_id is not None):
        return "HIGH"
    if missing_count <= 3:
        return "MEDIUM"
    return "LOW"


def extract_generic_report_with_openai(
    input_path: Path, normalized_schema: dict[str, Any]
) -> AIExtractionResult:
    """Extract an unknown/non-CCC report with the neutral strict schema."""

    require_api_key()
    require_dependencies()
    api_schema = make_openai_schema(normalized_schema)
    api_schema.pop("$id", None)

    def remove_local_only_formats(node: Any) -> None:
        if isinstance(node, dict):
            node.pop("format", None)
            for child in node.values():
                remove_local_only_formats(child)
        elif isinstance(node, list):
            for child in node:
                remove_local_only_formats(child)

    # The API schema stays within Structured Outputs' supported subset. The
    # repository schema still performs strict date-format validation locally.
    remove_local_only_formats(api_schema)
    try:
        client = OpenAI()
    except OpenAIError as exc:
        raise PrototypeError(
            "OpenAI client could not be initialized"
        ) from exc
    file_id = upload_pdf(client, input_path)
    try:
        try:
            response = client.responses.create(
                model=MODEL,
                instructions=GENERIC_EXTRACTION_INSTRUCTIONS,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_file",
                                "file_id": file_id,
                                "detail": "high",
                            },
                            {
                                "type": "input_text",
                                "text": (
                                    "Extract every supported field into the supplied "
                                    "provider-neutral JSON schema."
                                ),
                            },
                        ],
                    }
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "normalized_valuation_report",
                        "schema": api_schema,
                        "strict": True,
                    }
                },
                max_output_tokens=20_000,
                store=False,
            )
        except OpenAIError as exc:
            raise PrototypeError("OpenAI extraction request failed") from exc
    finally:
        delete_uploaded_file(client, file_id)
    print_usage(response)
    return AIExtractionResult(
        data=parse_model_json(response_text(response)),
        model=str(get_field(response, "model", MODEL) or MODEL),
        usage=usage_details(response),
    )


Extractor = Callable[[Path, dict[str, Any]], AIExtractionResult]


class ReportIngestionService:
    """Validate, route, normalize, and describe one canonical internal PDF."""

    def __init__(
        self,
        *,
        ccc_extractor: Extractor = extract_report_with_openai,
        generic_extractor: Extractor = extract_generic_report_with_openai,
        ccc_schema_version: str | None = None,
    ) -> None:
        if not callable(ccc_extractor) or not callable(generic_extractor):
            raise TypeError("Report extractors must be callable")
        self._ccc_extractor = ccc_extractor
        self._generic_extractor = generic_extractor
        self._ccc_schema_version = ccc_schema_version or ("2" if ccc_extractor is extract_report_with_openai else "1")
        if self._ccc_schema_version not in {"1", "2"}:
            raise ValueError("Unsupported CCC extraction schema version")

    def ingest(self, pdf_path: Path | str) -> ReportIngestionResult:
        document = validate_canonical_pdf(pdf_path)
        detected_id, detected_name = detect_report_provider(document.provider_text)
        adapter = CCC_ADAPTER if detected_id == "CCC" else GENERIC_ADAPTER
        try:
            if adapter == CCC_ADAPTER:
                ccc_schema = read_canonical_schema(self._ccc_schema_version)
                extracted = self._ccc_extractor(document.path, ccc_schema)
                if not isinstance(extracted, AIExtractionResult):
                    raise ReportExtractionError(
                        "Report adapter returned an invalid result"
                    )
                validate_extraction(extracted.data, ccc_schema)
                if self._ccc_schema_version == "2":
                    from venfour.ccc_evidence import validate_ccc_source_claims
                    validate_ccc_source_claims(extracted.data, page_count=document.page_count)
                normalized = normalize_ccc_report(extracted.data)
            else:
                normalized_schema = read_normalized_report_schema()
                extracted = self._generic_extractor(document.path, normalized_schema)
                if not isinstance(extracted, AIExtractionResult):
                    raise ReportExtractionError(
                        "Report adapter returned an invalid result"
                    )
                normalized = copy.deepcopy(extracted.data)
                validate_normalized_report(normalized)
                extracted_report = _mapping(normalized.get("report"))
                if extracted_report.get("providerId") == "CCC":
                    ccc_schema = read_canonical_schema(self._ccc_schema_version)
                    extracted = self._ccc_extractor(document.path, ccc_schema)
                    if not isinstance(extracted, AIExtractionResult):
                        raise ReportExtractionError(
                            "Report adapter returned an invalid result"
                        )
                    validate_extraction(extracted.data, ccc_schema)
                    if self._ccc_schema_version == "2":
                        from venfour.ccc_evidence import validate_ccc_source_claims
                        validate_ccc_source_claims(extracted.data, page_count=document.page_count)
                    normalized = normalize_ccc_report(extracted.data)
                    detected_id, detected_name = "CCC", "CCC"
                    adapter = CCC_ADAPTER
        except ReportIngestionError:
            raise
        except (
            OutputValidationError,
            PrototypeError,
            OSError,
            RuntimeError,
            TypeError,
            ValueError,
        ) as exc:
            raise ReportExtractionError("Valuation report extraction failed") from exc

        report = _mapping(normalized.get("report"))
        extracted_provider = _nullable_text(report.get("provider"))
        extracted_provider_id = report.get("providerId")
        provider_id = detected_id or (
            extracted_provider_id if isinstance(extracted_provider_id, str) else None
        )
        provider = detected_name or extracted_provider
        if provider_id is not None and report.get("providerId") is None:
            normalized["report"]["providerId"] = provider_id
        if provider is not None and report.get("provider") is None:
            normalized["report"]["provider"] = provider
        validate_normalized_report(normalized)

        missing = _missing_confirmation_fields(normalized)
        warnings: list[str] = []
        if adapter == GENERIC_ADAPTER:
            warnings.append(
                "This report used the generic extraction path; confirm every "
                "vehicle and claim fact before analysis."
            )
        if provider_id is None:
            warnings.append(
                "The valuation provider could not be identified reliably."
            )
        if missing:
            warnings.append(
                "Some analysis-critical facts were not available and require "
                "customer confirmation."
            )
        return ReportIngestionResult(
            normalized_report=normalized,
            adapter=adapter,
            provider=provider,
            provider_id=provider_id,
            confidence=_confidence(
                adapter=adapter,
                provider_id=provider_id,
                missing_count=len(missing),
            ),
            partial=bool(missing),
            warnings=tuple(warnings),
            missing_required_fields=missing,
            document_sha256=document.sha256,
            model=extracted.model,
            usage=extracted.usage,
        )


__all__ = [
    "CCC_ADAPTER",
    "GENERIC_ADAPTER",
    "MAX_REPORT_PAGES",
    "NORMALIZED_REPORT_SCHEMA_PATH",
    "NormalizedReportContractError",
    "ReportDocumentInvalidError",
    "ReportExtractionError",
    "ReportIngestionError",
    "ReportIngestionResult",
    "ReportIngestionService",
    "ValidatedReportDocument",
    "detect_report_provider",
    "extract_generic_report_with_openai",
    "normalize_ccc_report",
    "normalized_report_to_legacy_report",
    "read_normalized_report_schema",
    "validate_canonical_pdf",
    "validate_effective_report",
    "validate_normalized_report",
]
