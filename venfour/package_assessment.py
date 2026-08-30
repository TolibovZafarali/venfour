"""Deterministic paid-package source freezing and final assessment projection.

This module is deliberately downstream of a completed, immutable
``AnalysisRunArtifact``.  It performs no retrieval, provider call, extraction,
AI work, comparable ranking, or valuation re-analysis.  Its responsibilities
are limited to:

* binding already-authoritative inputs and artifacts into a content-addressed
  source snapshot;
* attaching truthful field-level provenance to material assessment values;
* projecting the existing deterministic analysis into
  ``FinalValuationAssessmentV1``; and
* comparing the final projection with the exact preliminary values shown to
  the customer.

The current methodology supports an advertised-price evidence range.  It does
not produce a point ACV, insurer-comparable weight, certified appraisal, legal
entitlement, or guaranteed settlement amount.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError

from venfour.analysis_runs import (
    AnalysisRunArtifact,
    AnalysisRunContractError,
    AnalysisRunValidationUnavailableError,
    canonical_json_bytes,
    validate_analysis_run_artifact,
)
from venfour.presentation import (
    AnalysisPresentation,
    AnalysisPresentationContractError,
    AnalysisPresentationProjector,
    validate_analysis_presentation,
)
from venfour.report_ingestion import (
    NormalizedReportContractError,
    ReportIngestionResult,
)


SOURCE_SNAPSHOT_SCHEMA_VERSION = "1"
FINAL_ASSESSMENT_SCHEMA_VERSION = "1"
FINAL_ASSESSMENT_METHODOLOGY_VERSION = "1"
SOURCE_SNAPSHOT_VALIDATOR_VERSION = "1"

RETRYABLE_OPERATIONAL_FAILURE = "RETRYABLE_OPERATIONAL_FAILURE"
HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED"
FATAL_LINEAGE_INTEGRITY_FAILURE = "FATAL_LINEAGE_INTEGRITY_FAILURE"
NEW_EVIDENCE_REQUIRED = "NEW_EVIDENCE_REQUIRED"
PACKAGE_FAILURE_CLASSIFICATIONS = frozenset(
    {
        RETRYABLE_OPERATIONAL_FAILURE,
        HUMAN_REVIEW_REQUIRED,
        FATAL_LINEAGE_INTEGRITY_FAILURE,
        NEW_EVIDENCE_REQUIRED,
    }
)

SUPPORTS_CONTINUATION = "SUPPORTS_CONTINUATION"
DOES_NOT_SUPPORT_CONTINUATION = "DOES_NOT_SUPPORT_CONTINUATION"
REVIEW_REQUIRED = "REVIEW_REQUIRED"

UNCHANGED_EVIDENCE = "UNCHANGED_EVIDENCE"
SOURCE_LINEAGE_CONFLICT = "SOURCE_LINEAGE_CONFLICT"

DESCRIPTIVE_ONLY = "DESCRIPTIVE_ONLY"
NOT_DETERMINED_BY_V1 = "NOT_DETERMINED_BY_V1"
SELECTED_ADVERTISED_PRICE_RANGE = "SELECTED_ADVERTISED_PRICE_RANGE"

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_SNAPSHOT_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "package" / "total-loss-source-snapshot-v1.schema.json"
)
FINAL_ASSESSMENT_SCHEMA_PATH = (
    REPO_ROOT
    / "schemas"
    / "package"
    / "final-valuation-assessment-v1.schema.json"
)

_SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MONEY_FIELDS = ("lowMinorUnits", "medianMinorUnits", "highMinorUnits")


class PackageAssessmentError(Exception):
    """A package source or assessment failed a bounded deterministic check."""

    def __init__(
        self,
        message: str,
        *,
        classification: str = FATAL_LINEAGE_INTEGRITY_FAILURE,
        code: str = "PACKAGE_ASSESSMENT_INVALID",
        details: Sequence[str] = (),
    ) -> None:
        super().__init__(message)
        if classification not in PACKAGE_FAILURE_CLASSIFICATIONS:
            raise ValueError("Package failure classification is invalid")
        if _SAFE_CODE.fullmatch(code) is None:
            raise ValueError("Package failure code is invalid")
        self.classification = classification
        self.code = code
        self.details = tuple(details)


def _failure(
    message: str,
    code: str,
    details: Sequence[str] = (),
    *,
    classification: str = FATAL_LINEAGE_INTEGRITY_FAILURE,
) -> PackageAssessmentError:
    return PackageAssessmentError(
        message,
        classification=classification,
        code=code,
        details=details,
    )


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


def canonical_package_digest(value: Any) -> str:
    """Return SHA-256 over the repository's canonical JSON representation."""

    try:
        return hashlib.sha256(canonical_json_bytes(value)).hexdigest()
    except AnalysisRunContractError as exc:
        raise _failure(
            "Package data is not canonical JSON",
            "PACKAGE_JSON_INVALID",
            getattr(exc, "details", (str(exc),)),
        ) from exc


def load_strict_package_json(value: str) -> dict[str, Any]:
    """Decode a strict JSON object, rejecting duplicate keys and constants."""

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, child in pairs:
            if key in result:
                raise ValueError(f"duplicate object key: {key}")
            result[key] = child
        return result

    def reject_constant(constant: str) -> None:
        raise ValueError(f"non-finite number: {constant}")

    try:
        decoded = json.loads(
            value,
            object_pairs_hook=object_pairs,
            parse_constant=reject_constant,
        )
    except (RecursionError, TypeError, ValueError) as exc:
        raise _failure(
            "Package JSON is invalid or ambiguous",
            "PACKAGE_JSON_INVALID",
        ) from exc
    if not isinstance(decoded, dict):
        raise _failure(
            "Package JSON root must be an object",
            "PACKAGE_JSON_INVALID",
        )
    return decoded


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
                else:
                    stack.append((f"{path}.{key}", child))
            continue
        if isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )
            continue
        errors.append(f"{path}: {type(value).__name__} is not JSON-compatible")
    return sorted(errors)


@lru_cache(maxsize=2)
def _read_schema(path: Path) -> dict[str, Any]:
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
    except (OSError, ValueError, SchemaError) as exc:
        raise _failure(
            "Package validation schema is unavailable",
            "PACKAGE_VALIDATION_UNAVAILABLE",
            classification=RETRYABLE_OPERATIONAL_FAILURE,
        ) from exc
    if not isinstance(schema, dict):
        raise _failure(
            "Package validation schema is invalid",
            "PACKAGE_VALIDATION_UNAVAILABLE",
            classification=RETRYABLE_OPERATIONAL_FAILURE,
        )
    return schema


def _json_path(parts: Sequence[Any]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part, ensure_ascii=True)}]"
    return path


def _validate_schema(data: Any, path: Path, code: str) -> None:
    compatibility = _json_compatibility_errors(data)
    if compatibility:
        raise _failure("Package data is not valid JSON", code, compatibility)
    try:
        errors = sorted(
            Draft202012Validator(
                _read_schema(path), format_checker=FormatChecker()
            ).iter_errors(data),
            key=lambda error: (_json_path(list(error.absolute_path)), error.message),
        )
    except PackageAssessmentError:
        raise
    except Exception as exc:
        raise _failure(
            "Package validation could not complete",
            "PACKAGE_VALIDATION_UNAVAILABLE",
            classification=RETRYABLE_OPERATIONAL_FAILURE,
        ) from exc
    if errors:
        raise _failure(
            "Package data failed schema validation",
            code,
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in errors
            ),
        )


def _artifact_data(
    artifact: AnalysisRunArtifact | Mapping[str, Any],
) -> tuple[AnalysisRunArtifact, dict[str, Any]]:
    try:
        selected = (
            artifact
            if isinstance(artifact, AnalysisRunArtifact)
            else AnalysisRunArtifact.from_dict(artifact)
        )
        validate_analysis_run_artifact(
            selected,
            include_environment_secrets=False,
        )
        return selected, selected.to_dict()
    except (AnalysisRunContractError, AnalysisRunValidationUnavailableError) as exc:
        raise _failure(
            "Analysis artifact failed deterministic replay validation",
            "ANALYSIS_ARTIFACT_INVALID",
            getattr(exc, "details", (str(exc),)),
        ) from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise _failure(
            "Analysis artifact is invalid",
            "ANALYSIS_ARTIFACT_INVALID",
        ) from exc


def _presentation_data(
    presentation: AnalysisPresentation | Mapping[str, Any],
) -> tuple[AnalysisPresentation, dict[str, Any]]:
    try:
        selected = (
            presentation
            if isinstance(presentation, AnalysisPresentation)
            else AnalysisPresentation.from_dict(presentation)
        )
        validate_analysis_presentation(
            selected,
            include_environment_secrets=False,
        )
        return selected, selected.to_dict()
    except AnalysisPresentationContractError as exc:
        raise _failure(
            "Preliminary presentation failed validation",
            "PRELIMINARY_PRESENTATION_INVALID",
            getattr(exc, "details", (str(exc),)),
        ) from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise _failure(
            "Preliminary presentation is invalid",
            "PRELIMINARY_PRESENTATION_INVALID",
        ) from exc


def _money_cents(value: Mapping[str, Any] | None) -> int | None:
    if value is None:
        return None
    cents = value.get("cents")
    return cents if isinstance(cents, int) and not isinstance(cents, bool) else None


def _presentation_range(presentation: Mapping[str, Any], currency: str) -> dict[str, Any]:
    primary = presentation["primaryExternalEvidence"]
    if primary is None:
        return {
            "lowMinorUnits": None,
            "medianMinorUnits": None,
            "highMinorUnits": None,
            "currency": currency,
        }
    prices = primary["prices"]
    return {
        "lowMinorUnits": _money_cents(prices["minimumPrice"]),
        "medianMinorUnits": _money_cents(prices["medianPrice"]),
        "highMinorUnits": _money_cents(prices["maximumPrice"]),
        "currency": currency,
    }


def _evidence_id_payload(reference: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: copy.deepcopy(value)
        for key, value in reference.items()
        if key != "evidenceId"
    }


def evidence_reference_id(reference: Mapping[str, Any]) -> str:
    return f"ev_{canonical_package_digest(_evidence_id_payload(reference))}"


def _reference(
    *,
    source_kind: str,
    artifact: str,
    json_pointer: str,
    source_identity: str,
    location_precision: str,
) -> dict[str, Any]:
    reference = {
        "sourceKind": source_kind,
        "artifact": artifact,
        "jsonPointer": json_pointer,
        "sourceIdentity": source_identity,
        "locationPrecision": location_precision,
        "pageNumber": None,
    }
    return {"evidenceId": evidence_reference_id(reference), **reference}


def _default_evidence_manifest(
    artifact: Mapping[str, Any],
    presentation: Mapping[str, Any],
    confirmed_facts: Mapping[str, Any],
) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []

    def add(
        source_kind: str,
        source_artifact: str,
        pointer: str,
        identity: str,
        precision: str = "JSON_POINTER",
    ) -> None:
        references.append(
            _reference(
                source_kind=source_kind,
                artifact=source_artifact,
                json_pointer=pointer,
                source_identity=identity,
                location_precision=precision,
            )
        )

    for field in (
        "year",
        "make",
        "model",
        "trim",
        "mileage",
        "postalCode",
        "lossDate",
    ):
        pointer = (
            "/result/discrepancyRequest/lossDate"
            if field == "lossDate"
            else f"/result/discrepancyRequest/lossVehicle/{field}"
        )
        add("ANALYSIS_CALCULATION", "ANALYSIS_RUN", pointer, field)
    for field in ("vin", "vehicleConfiguration"):
        if confirmed_facts.get(field) is not None:
            add(
                "CUSTOMER_CONFIRMED_INPUT",
                "CONFIRMED_INPUT",
                f"/{field}",
                field,
            )
    add(
        "ANALYSIS_CALCULATION",
        "ANALYSIS_RUN",
        "/result/discrepancyResult/cccVehicleValuationCents",
        "insurer-valuation",
    )

    ccc_rows = artifact["result"]["discrepancyResult"][
        "cccComparableSummary"
    ]["comparables"]
    for index, row in enumerate(ccc_rows):
        identity = row.get("vin") or row.get("comparableNumber") or index
        add(
            "INSURER_COMPARABLE",
            "ANALYSIS_RUN",
            f"/result/discrepancyResult/cccComparableSummary/comparables/{index}",
            f"insurer-comparable:{identity}",
        )

    for summary_name in ("historicalExternalSummary", "currentExternalSummary"):
        summary = artifact["result"]["discrepancyResult"][summary_name]
        if summary is None:
            continue
        add(
            "ANALYSIS_CALCULATION",
            "ANALYSIS_RUN",
            f"/result/discrepancyResult/{summary_name}/prices",
            f"{summary_name}:prices",
        )
        for index, row in enumerate(summary["selectedEvidence"]):
            identity = row.get("sourceListingId") or row.get("vin") or index
            add(
                "EXTERNAL_PROVIDER_RECORD",
                "ANALYSIS_RUN",
                f"/result/discrepancyResult/{summary_name}/selectedEvidence/{index}",
                f"{summary_name}:{identity}",
            )

    for field in ("primaryComparison", "secondaryComparisons"):
        add(
            "ANALYSIS_CALCULATION",
            "ANALYSIS_RUN",
            f"/result/discrepancyResult/{field}",
            field,
        )
    for index, finding in enumerate(presentation["findings"]):
        add(
            "ANALYSIS_CALCULATION",
            "ANALYSIS_RUN",
            f"/result/discrepancyResult/findings/{index}",
            f"finding:{finding['code']}",
        )
    for index, limitation in enumerate(presentation["limitations"]):
        add(
            "ANALYSIS_CALCULATION",
            "ANALYSIS_RUN",
            f"/result/discrepancyResult/limitations/{index}",
            f"limitation:{limitation['code']}",
        )

    unique: dict[str, dict[str, Any]] = {}
    for reference in references:
        unique[reference["evidenceId"]] = reference
    return sorted(unique.values(), key=lambda item: item["evidenceId"])


def _default_validation_checks(
    manifest: Sequence[Mapping[str, Any]],
    *,
    intake_mode: str,
    confirmed_facts: Mapping[str, Any],
    extraction: Mapping[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    def ids(
        *,
        kinds: set[str] | None = None,
        identities: set[str] | None = None,
    ) -> list[str]:
        selected = []
        for reference in manifest:
            if kinds is not None and reference["sourceKind"] not in kinds:
                continue
            if identities is not None and reference["sourceIdentity"] not in identities:
                continue
            selected.append(reference["evidenceId"])
        return sorted(set(selected))

    analysis_ids = ids(kinds={"ANALYSIS_CALCULATION"})
    insurer_ids = ids(kinds={"INSURER_COMPARABLE"})
    external_ids = ids(kinds={"EXTERNAL_PROVIDER_RECORD"})
    vehicle_ids = ids(
        identities={
            "year",
            "make",
            "model",
            "trim",
            "mileage",
            "postalCode",
            "lossDate",
        }
    )
    checks: list[tuple[str, str, list[str]]] = [
        ("CASE_RUN_LINEAGE", "PASS", analysis_ids[:1]),
        ("ANALYSIS_ARTIFACT_INTEGRITY", "PASS", analysis_ids),
        ("PRELIMINARY_PRESENTATION_LINEAGE", "PASS", analysis_ids),
        ("INPUT_REVISION_LINEAGE", "PASS", vehicle_ids),
        ("SUBJECT_VEHICLE_IDENTITY", "PASS", vehicle_ids),
        ("MILEAGE_CONSISTENCY", "PASS", ids(identities={"mileage"})),
        (
            "INSURER_VALUATION_FIELDS",
            "PASS",
            ids(identities={"insurer-valuation"}),
        ),
        ("COMPARABLE_IDENTITIES", "PASS", insurer_ids + external_ids),
        ("ADJUSTMENT_SIGNS", "PASS", insurer_ids),
        ("ADJUSTMENT_ARITHMETIC", "PASS", insurer_ids),
        ("EXTERNAL_EVIDENCE_SELECTION", "PASS", external_ids),
        ("SELECTED_RANGE_CALCULATION", "PASS", analysis_ids),
        ("EVIDENCE_CUTOFF", "PASS", ids(identities={"lossDate"})),
        ("SCHEMA_PROVIDER_VERSIONS", "PASS", analysis_ids[:1]),
    ]
    limitations: list[str] = []
    if intake_mode == "REPORT":
        checks.extend(
            (
                ("SOURCE_DOCUMENT_INTEGRITY", "PASS", []),
                ("NORMALIZED_EXTRACTION_INTEGRITY", "PASS", []),
            )
        )
        normalized = (
            extraction.get("normalizedReport")
            if isinstance(extraction, Mapping)
            else None
        )
        report_vehicle = (
            normalized.get("vehicle") if isinstance(normalized, Mapping) else None
        )
        if isinstance(report_vehicle, Mapping):
            compared_fields = ("year", "make", "model", "trim", "mileage")

            def equivalent(left: Any, right: Any) -> bool:
                if isinstance(left, str) and isinstance(right, str):
                    return " ".join(left.split()).casefold() == " ".join(
                        right.split()
                    ).casefold()
                return left == right

            source_differences = [
                field
                for field in compared_fields
                if report_vehicle.get(field) is not None
                and not equivalent(
                    report_vehicle.get(field), confirmed_facts.get(field)
                )
            ]
            checks.append(
                (
                    "REPORT_VEHICLE_FACT_CONSISTENCY",
                    "WARNING" if source_differences else "PASS",
                    vehicle_ids,
                )
            )
            if source_differences:
                limitations.append(
                    "REPORT_VEHICLE_FACTS_DIFFER_FROM_CONFIRMED_INPUT"
                )
            report_vin = report_vehicle.get("vin")
            confirmed_vin = confirmed_facts.get("vin")
            if report_vin is not None and confirmed_vin is not None:
                vin_matches = equivalent(report_vin, confirmed_vin)
                checks.append(
                    (
                        "VIN_CONSISTENCY",
                        "PASS" if vin_matches else "WARNING",
                        ids(identities={"vin"}),
                    )
                )
                if not vin_matches:
                    limitations.append(
                        "REPORT_VIN_DIFFERS_FROM_CONFIRMED_INPUT"
                    )
    if confirmed_facts.get("vin") is not None:
        if not any(code == "VIN_CONSISTENCY" for code, _status, _ids in checks):
            limitations.append("VIN_CROSS_SOURCE_CONSISTENCY_UNAVAILABLE")
    if confirmed_facts.get("vehicleConfiguration") is not None:
        checks.append(
            (
                "VEHICLE_CONFIGURATION_CONSISTENCY",
                "PASS",
                ids(identities={"vehicleConfiguration"}),
            )
        )
        limitations.append("VEHICLE_CONFIGURATION_SOURCE_LOCATION_UNAVAILABLE")
    return (
        [
            {"code": code, "status": status, "evidenceIds": evidence_ids}
            for code, status, evidence_ids in checks
        ],
        limitations,
    )


def _evidence_id(
    manifest: Sequence[Mapping[str, Any]], json_pointer: str
) -> str:
    matches = [
        item["evidenceId"]
        for item in manifest
        if item["jsonPointer"] == json_pointer
    ]
    if len(matches) != 1:
        raise _failure(
            "Assessment provenance is incomplete",
            "ASSESSMENT_PROVENANCE_INVALID",
            (f"{json_pointer}: expected one evidence reference",),
        )
    return matches[0]


def _evidence_ids(
    manifest: Sequence[Mapping[str, Any]], json_pointers: Sequence[str]
) -> list[str]:
    return [_evidence_id(manifest, pointer) for pointer in json_pointers]


def _parse_iso_datetime(value: Any, path: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise _failure("Package timestamp is invalid", "SOURCE_SNAPSHOT_INVALID", (path,))
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise _failure(
            "Package timestamp is invalid", "SOURCE_SNAPSHOT_INVALID", (path,)
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise _failure("Package timestamp is invalid", "SOURCE_SNAPSHOT_INVALID", (path,))
    return parsed


def _validate_source_semantics(data: Mapping[str, Any]) -> None:
    source_created_at = _parse_iso_datetime(data["createdAt"], "$.createdAt")
    if (
        source_created_at is None
        or not data["createdAt"].endswith("Z")
        or source_created_at.utcoffset().total_seconds() != 0
    ):
        raise _failure(
            "Source snapshot creation timestamp must be canonical UTC",
            "SOURCE_SNAPSHOT_INVALID",
            ("$.createdAt",),
        )
    artifact, artifact_data = _artifact_data(data["analysis"]["artifact"])
    _, presentation = _presentation_data(data["preliminary"]["presentation"])
    projected = AnalysisPresentationProjector().project(artifact).to_dict()
    if canonical_json_bytes(projected) != canonical_json_bytes(presentation):
        raise _failure(
            "Preliminary presentation does not match its analysis run",
            "PRELIMINARY_PRESENTATION_LINEAGE_MISMATCH",
        )

    lineage = data["lineage"]
    analysis = data["analysis"]
    preliminary = data["preliminary"]
    source_input = data["input"]
    if lineage["analysisRunId"] != artifact_data["runId"]:
        raise _failure(
            "Analysis run identity does not match package lineage",
            "ANALYSIS_RUN_LINEAGE_MISMATCH",
        )
    if presentation["runId"] != lineage["analysisRunId"]:
        raise _failure(
            "Preliminary presentation run does not match package lineage",
            "PRELIMINARY_PRESENTATION_LINEAGE_MISMATCH",
        )

    expected_analysis = {
        "artifactDigest": canonical_package_digest(artifact_data),
        "requestDigest": artifact_data["requestDigest"],
        "searchDiagnosticsDigest": artifact_data.get("searchDiagnosticsDigest"),
        "analysisRunSchemaVersion": artifact_data["analysisRunSchemaVersion"],
        "analysisVersion": artifact_data["analysisVersion"],
        "discrepancyAnalysisVersion": artifact_data[
            "discrepancyAnalysisVersion"
        ],
        "comparableScoringVersion": artifact_data["comparableScoringVersion"],
        "createdAt": artifact_data["createdAt"],
        "providers": artifact_data["providers"],
    }
    for key, expected in expected_analysis.items():
        if analysis[key] != expected:
            raise _failure(
                "Frozen analysis metadata does not match the artifact",
                "ANALYSIS_ARTIFACT_DIGEST_MISMATCH",
                (f"$.analysis.{key}",),
            )

    if preliminary["presentationDigest"] != canonical_package_digest(presentation):
        raise _failure(
            "Preliminary presentation digest does not match",
            "PRELIMINARY_SNAPSHOT_DIGEST_MISMATCH",
        )
    if preliminary["snapshotDigest"] != canonical_package_digest(
        preliminary["snapshot"]
    ):
        raise _failure(
            "Frozen preliminary snapshot digest does not match its exact payload",
            "PRELIMINARY_SNAPSHOT_DIGEST_MISMATCH",
        )
    nested_presentation = preliminary["snapshot"].get("presentation")
    if isinstance(nested_presentation, Mapping) and canonical_json_bytes(
        nested_presentation
    ) != canonical_json_bytes(presentation):
        raise _failure(
            "Preliminary snapshot contains a different presentation",
            "PRELIMINARY_PRESENTATION_LINEAGE_MISMATCH",
        )
    expected_preliminary = {
        "classification": presentation["assessment"]["classification"],
        "insurerValueMinorUnits": presentation["insurerValuation"]["value"][
            "cents"
        ],
        "supportedRange": _presentation_range(
            presentation, preliminary["supportedRange"]["currency"]
        ),
        "presentationSchemaVersion": presentation["presentationVersion"],
    }
    for key, expected in expected_preliminary.items():
        if preliminary[key] != expected:
            raise _failure(
                "Preliminary scalar values do not match the frozen presentation",
                "PRELIMINARY_PRESENTATION_LINEAGE_MISMATCH",
                (f"$.preliminary.{key}",),
            )

    if source_input["inputDigest"] != canonical_package_digest(
        source_input["confirmedFacts"]
    ):
        raise _failure(
            "Confirmed input digest does not match",
            "CONFIRMED_INPUT_DIGEST_MISMATCH",
        )
    facts = source_input["confirmedFacts"]
    if source_input["intakeMode"] == "MANUAL" and facts["insurerName"] is None:
        raise _failure("Manual input requires an insurer name", "SOURCE_FACT_CONFLICT")
    vehicle = presentation["vehicle"]
    fact_pairs = {
        "year": vehicle["year"],
        "make": vehicle["make"],
        "model": vehicle["model"],
        "trim": vehicle["trim"],
        "mileage": vehicle["mileage"],
        "postalCode": vehicle["postalCode"],
        "lossDate": vehicle["lossDate"],
    }
    for key, expected in fact_pairs.items():
        if facts[key] != expected:
            raise _failure(
                "Confirmed source facts conflict with the analysis artifact",
                "SOURCE_FACT_CONFLICT",
                (f"$.input.confirmedFacts.{key}",),
                classification=HUMAN_REVIEW_REQUIRED,
            )
    insurer_value = facts["insurerVehicleValuationMinorUnits"]
    artifact_value = presentation["insurerValuation"]["value"]["cents"]
    if insurer_value != artifact_value:
        raise _failure(
            "Confirmed insurer value conflicts with the analysis artifact",
            "SOURCE_FACT_CONFLICT",
            ("$.input.confirmedFacts.insurerVehicleValuationMinorUnits",),
            classification=HUMAN_REVIEW_REQUIRED,
        )

    mode = source_input["intakeMode"]
    if mode != presentation["analysisScope"]["inputMode"]:
        raise _failure(
            "Frozen intake mode does not match the analysis presentation",
            "SOURCE_MODE_CONFLICT",
        )
    document = data["sourceDocument"]
    extraction = data["extraction"]
    if mode == "MANUAL":
        if (
            document is not None
            or extraction is not None
            or source_input["reportUploadId"] is not None
        ):
            raise _failure(
                "Manual source cannot contain a report document or extraction",
                "SOURCE_MODE_CONFLICT",
            )
    else:
        if document is None or extraction is None:
            raise _failure(
                "Report source is missing its frozen document or extraction",
                "SOURCE_PROVENANCE_INCOMPLETE",
                classification=HUMAN_REVIEW_REQUIRED,
            )
        if document["uploadId"] != source_input["reportUploadId"]:
            raise _failure(
                "Report upload identity does not match frozen input",
                "SOURCE_REPORT_LINEAGE_MISMATCH",
            )
        if document["sha256"] != extraction["documentSha256"]:
            raise _failure(
                "Source report digest does not match extraction provenance",
                "SOURCE_DOCUMENT_DIGEST_MISMATCH",
            )
        if extraction["normalizedReportDigest"] != canonical_package_digest(
            extraction["normalizedReport"]
        ):
            raise _failure(
                "Normalized report digest does not match",
                "NORMALIZED_REPORT_DIGEST_MISMATCH",
            )
        wrapper = {
            "schemaVersion": extraction["wrapperSchemaVersion"],
            "adapter": extraction["adapter"],
            "provider": extraction["provider"],
            "providerId": extraction["providerId"],
            "confidence": extraction["confidence"],
            "partial": extraction["partial"],
            "warnings": extraction["warnings"],
            "missingRequiredFields": extraction["missingRequiredFields"],
            "documentSha256": extraction["documentSha256"],
            "model": extraction["model"],
            "normalizedReport": extraction["normalizedReport"],
        }
        try:
            ReportIngestionResult.from_dict(wrapper)
        except (NormalizedReportContractError, TypeError, ValueError) as exc:
            raise _failure(
                "Frozen report extraction is invalid",
                "NORMALIZED_REPORT_INVALID",
                getattr(exc, "details", (str(exc),)),
            ) from exc

    cutoff = data["evidenceCutoff"]
    if cutoff["lossDate"] != presentation["vehicle"]["lossDate"]:
        raise _failure(
            "Evidence cutoff loss date does not match the analysis",
            "EVIDENCE_CUTOFF_MISMATCH",
        )
    created = _parse_iso_datetime(cutoff["analysisCreatedAt"], "analysisCreatedAt")
    if created is None or cutoff["analysisCreatedAt"] != artifact_data["createdAt"]:
        raise _failure(
            "Evidence cutoff creation time does not match the analysis",
            "EVIDENCE_CUTOFF_MISMATCH",
        )
    current_date = cutoff["currentObservedDate"]
    if current_date is not None and date.fromisoformat(current_date) > created.date():
        raise _failure(
            "Current evidence date is after analysis creation",
            "EVIDENCE_CUTOFF_MISMATCH",
        )

    manifest = data["evidenceManifest"]
    identifiers = [item["evidenceId"] for item in manifest]
    if len(identifiers) != len(set(identifiers)):
        raise _failure(
            "Evidence identifiers are not unique",
            "SOURCE_PROVENANCE_INVALID",
        )
    for index, reference in enumerate(manifest):
        if reference["evidenceId"] != evidence_reference_id(reference):
            raise _failure(
                "Evidence identifier does not match its locator",
                "SOURCE_PROVENANCE_INVALID",
                (f"$.evidenceManifest[{index}]",),
            )

    validation_manifest = data["validationManifest"]
    check_codes = [item["code"] for item in validation_manifest["checks"]]
    if len(check_codes) != len(set(check_codes)):
        raise _failure(
            "Validation check identifiers are not unique",
            "SOURCE_VALIDATION_MANIFEST_INVALID",
        )
    missing_check_evidence = sorted(
        {
            evidence_id
            for check in validation_manifest["checks"]
            for evidence_id in check["evidenceIds"]
            if evidence_id not in set(identifiers)
        }
    )
    if missing_check_evidence:
        raise _failure(
            "Validation checks reference unknown evidence",
            "SOURCE_VALIDATION_MANIFEST_INVALID",
            tuple(missing_check_evidence),
        )

    unsigned = {
        key: copy.deepcopy(value)
        for key, value in data.items()
        if key != "snapshotDigest"
    }
    if data["snapshotDigest"] != canonical_package_digest(unsigned):
        raise _failure(
            "Source snapshot digest does not match",
            "SOURCE_SNAPSHOT_DIGEST_MISMATCH",
        )


@dataclass(frozen=True)
class TotalLossSourceSnapshotV1:
    lineage: Mapping[str, Any]
    created_at: str
    input: Mapping[str, Any]
    source_document: Mapping[str, Any] | None
    extraction: Mapping[str, Any] | None
    analysis: Mapping[str, Any]
    preliminary: Mapping[str, Any]
    evidence_cutoff: Mapping[str, Any]
    evidence_manifest: tuple[Mapping[str, Any], ...]
    validation_manifest: Mapping[str, Any]
    snapshot_digest: str
    schema_version: str = SOURCE_SNAPSHOT_SCHEMA_VERSION

    def __post_init__(self) -> None:
        for field_name in (
            "lineage",
            "input",
            "analysis",
            "preliminary",
            "evidence_cutoff",
            "validation_manifest",
        ):
            object.__setattr__(self, field_name, _freeze_json(getattr(self, field_name)))
        for field_name in ("source_document", "extraction"):
            value = getattr(self, field_name)
            object.__setattr__(
                self, field_name, _freeze_json(value) if value is not None else None
            )
        object.__setattr__(
            self,
            "evidence_manifest",
            tuple(_freeze_json(item) for item in self.evidence_manifest),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "lineage": _thaw_json(self.lineage),
            "createdAt": self.created_at,
            "input": _thaw_json(self.input),
            "sourceDocument": _thaw_json(self.source_document),
            "extraction": _thaw_json(self.extraction),
            "analysis": _thaw_json(self.analysis),
            "preliminary": _thaw_json(self.preliminary),
            "evidenceCutoff": _thaw_json(self.evidence_cutoff),
            "evidenceManifest": _thaw_json(self.evidence_manifest),
            "validationManifest": _thaw_json(self.validation_manifest),
            "snapshotDigest": self.snapshot_digest,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TotalLossSourceSnapshotV1:
        validate_total_loss_source_snapshot_v1(data)
        return cls(
            lineage=data["lineage"],
            created_at=data["createdAt"],
            input=data["input"],
            source_document=data["sourceDocument"],
            extraction=data["extraction"],
            analysis=data["analysis"],
            preliminary=data["preliminary"],
            evidence_cutoff=data["evidenceCutoff"],
            evidence_manifest=tuple(data["evidenceManifest"]),
            validation_manifest=data["validationManifest"],
            snapshot_digest=data["snapshotDigest"],
            schema_version=data["schemaVersion"],
        )


def validate_total_loss_source_snapshot_v1(
    value: TotalLossSourceSnapshotV1 | Mapping[str, Any],
) -> None:
    data = value.to_dict() if isinstance(value, TotalLossSourceSnapshotV1) else value
    _validate_schema(data, SOURCE_SNAPSHOT_SCHEMA_PATH, "SOURCE_SNAPSHOT_INVALID")
    _validate_source_semantics(data)


def _cutoff(artifact: Mapping[str, Any]) -> dict[str, Any]:
    request = artifact["request"]
    historical = artifact["result"]["historicalMarketResult"]
    return {
        "lossDate": artifact["result"]["discrepancyRequest"]["lossDate"],
        "currentObservedDate": request["currentObservedDate"],
        "historicalEvidenceDate": (
            historical["evidenceDate"] if historical is not None else None
        ),
        "historicalProviderAsOfDate": (
            historical["asOfDate"] if historical is not None else None
        ),
        "analysisCreatedAt": artifact["createdAt"],
    }


def build_total_loss_source_snapshot_v1(
    *,
    lineage: Mapping[str, Any],
    created_at: str,
    intake_mode: str,
    analysis_input_revision: int,
    analysis_input_id: str,
    confirmed_facts: Mapping[str, Any],
    artifact: AnalysisRunArtifact | Mapping[str, Any],
    preliminary_presentation: AnalysisPresentation | Mapping[str, Any],
    preliminary_snapshot: Mapping[str, Any],
    preliminary_snapshot_digest: str,
    preliminary_snapshot_schema_version: str,
    source_document: Mapping[str, Any] | None = None,
    extraction: Mapping[str, Any] | None = None,
    validation_checks: Sequence[Mapping[str, Any]] = (),
    validation_limitations: Sequence[str] = (),
) -> TotalLossSourceSnapshotV1:
    """Freeze one validated existing run without performing new analysis work."""

    _, artifact_data = _artifact_data(artifact)
    _, presentation = _presentation_data(preliminary_presentation)
    mode = intake_mode.strip().upper() if isinstance(intake_mode, str) else intake_mode
    facts = copy.deepcopy(dict(confirmed_facts))
    selected_document = (
        copy.deepcopy(dict(source_document)) if source_document is not None else None
    )
    selected_extraction = (
        copy.deepcopy(dict(extraction)) if extraction is not None else None
    )
    if selected_extraction is not None:
        selected_extraction["normalizedReportDigest"] = canonical_package_digest(
            selected_extraction["normalizedReport"]
        )

    currency = "USD"
    selected_preliminary_snapshot = copy.deepcopy(dict(preliminary_snapshot))
    preliminary = {
        "snapshot": selected_preliminary_snapshot,
        "snapshotSchemaVersion": preliminary_snapshot_schema_version,
        "presentation": presentation,
        "presentationDigest": canonical_package_digest(presentation),
        "snapshotDigest": preliminary_snapshot_digest,
        "presentationSchemaVersion": presentation["presentationVersion"],
        "classification": presentation["assessment"]["classification"],
        "insurerValueMinorUnits": presentation["insurerValuation"]["value"][
            "cents"
        ],
        "supportedRange": _presentation_range(presentation, currency),
    }
    source_input = {
        "intakeMode": mode,
        "analysisInputRevision": analysis_input_revision,
        "analysisInputId": analysis_input_id,
        "reportUploadId": (
            selected_document["uploadId"] if selected_document is not None else None
        ),
        "confirmedFacts": facts,
        "inputDigest": canonical_package_digest(facts),
    }
    analysis = {
        "artifact": artifact_data,
        "artifactDigest": canonical_package_digest(artifact_data),
        "requestDigest": artifact_data["requestDigest"],
        "searchDiagnosticsDigest": artifact_data.get("searchDiagnosticsDigest"),
        "analysisRunSchemaVersion": artifact_data["analysisRunSchemaVersion"],
        "analysisVersion": artifact_data["analysisVersion"],
        "discrepancyAnalysisVersion": artifact_data["discrepancyAnalysisVersion"],
        "comparableScoringVersion": artifact_data["comparableScoringVersion"],
        "createdAt": artifact_data["createdAt"],
        "providers": artifact_data["providers"],
    }
    manifest = _default_evidence_manifest(artifact_data, presentation, facts)
    default_checks, default_limitations = _default_validation_checks(
        manifest,
        intake_mode=mode,
        confirmed_facts=facts,
        extraction=selected_extraction,
    )
    supplied_checks = [copy.deepcopy(dict(item)) for item in validation_checks]
    validation_manifest = {
        "validatorVersion": SOURCE_SNAPSHOT_VALIDATOR_VERSION,
        "checks": [*default_checks, *supplied_checks],
        "limitations": sorted(
            {
                "INSURER_COMPARABLE_WEIGHTING_NOT_DETERMINED",
                "PAGE_LEVEL_CITATIONS_UNAVAILABLE",
                *default_limitations,
                *validation_limitations,
            }
        ),
    }
    unsigned = {
        "schemaVersion": SOURCE_SNAPSHOT_SCHEMA_VERSION,
        "lineage": copy.deepcopy(dict(lineage)),
        "createdAt": created_at,
        "input": source_input,
        "sourceDocument": selected_document,
        "extraction": selected_extraction,
        "analysis": analysis,
        "preliminary": preliminary,
        "evidenceCutoff": _cutoff(artifact_data),
        "evidenceManifest": manifest,
        "validationManifest": validation_manifest,
    }
    data = {**unsigned, "snapshotDigest": canonical_package_digest(unsigned)}
    return TotalLossSourceSnapshotV1.from_dict(data)


def _rounded_basis_points(difference: int, baseline: int) -> int | None:
    if baseline == 0:
        return None
    value = (Decimal(difference * 10_000) / Decimal(baseline)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    return int(value)


def build_preliminary_final_comparison(
    preliminary: Mapping[str, Any], final: Mapping[str, Any]
) -> dict[str, Any]:
    """Compare exact customer-visible values with no unstated materiality threshold."""

    preliminary_range = preliminary["supportedRange"]
    final_range = final["supportedRange"]
    absolute: dict[str, int | None] = {}
    percentages: dict[str, int | None] = {}
    for field in _MONEY_FIELDS:
        before = preliminary_range[field]
        after = final_range[field]
        if before is None or after is None:
            absolute[field] = None
            percentages[field] = None
        else:
            difference = after - before
            absolute[field] = difference
            percentages[field] = _rounded_basis_points(difference, before)
    classification_changed = (
        preliminary["classification"] != final["classification"]
    )
    range_availability_changed = all(
        preliminary_range[field] is not None for field in _MONEY_FIELDS
    ) != all(final_range[field] is not None for field in _MONEY_FIELDS)
    material = (
        classification_changed
        or preliminary_range["currency"] != final_range["currency"]
        or any(
            preliminary_range[field] != final_range[field]
            for field in _MONEY_FIELDS
        )
    )
    return {
        "preliminary": copy.deepcopy(dict(preliminary)),
        "final": copy.deepcopy(dict(final)),
        "absoluteChangesMinorUnits": absolute,
        "percentageChangesBasisPoints": percentages,
        "classificationChanged": classification_changed,
        "rangeAvailabilityChanged": range_availability_changed,
        "materialChange": material,
        "reasonCodes": [SOURCE_LINEAGE_CONFLICT if material else UNCHANGED_EVIDENCE],
    }


def _continuation_status(classification: str) -> str:
    if classification in {"POTENTIAL_UNDERVALUE", "MATERIAL_UNDERVALUE_SIGNAL"}:
        return SUPPORTS_CONTINUATION
    if classification == "NO_MATERIAL_DISCREPANCY":
        return DOES_NOT_SUPPORT_CONTINUATION
    if classification == "INSUFFICIENT_EVIDENCE":
        return NEW_EVIDENCE_REQUIRED
    return REVIEW_REQUIRED


def _assessment_semantic_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    unsigned = {
        key: copy.deepcopy(value)
        for key, value in data.items()
        if key != "assessmentDigest"
    }
    if data["assessmentDigest"] != canonical_package_digest(unsigned):
        errors.append("$.assessmentDigest: does not match canonical assessment JSON")
    if data["continuationStatus"] != _continuation_status(
        data["finalClassification"]
    ):
        errors.append("$.continuationStatus: does not match final classification")
    expected_comparison = build_preliminary_final_comparison(
        data["preliminaryToFinalComparison"]["preliminary"],
        data["preliminaryToFinalComparison"]["final"],
    )
    if data["preliminaryToFinalComparison"] != expected_comparison:
        errors.append(
            "$.preliminaryToFinalComparison: does not match the visible values"
        )
    if data["insurerComparables"]["methodologyTreatment"] != DESCRIPTIVE_ONLY:
        errors.append("$.insurerComparables: treatment must remain descriptive")
    if data["insurerComparables"]["weightingStatus"] != NOT_DETERMINED_BY_V1:
        errors.append("$.insurerComparables: weighting cannot be invented")
    return errors


@dataclass(frozen=True)
class FinalValuationAssessmentV1:
    lineage: Mapping[str, Any]
    source_snapshot_digest: str
    analysis_artifact_digest: str
    subject_vehicle: Mapping[str, Any]
    insurer_valuation_reviewed: Mapping[str, Any]
    insurer_comparables: Mapping[str, Any]
    external_evidence: Mapping[str, Any]
    calculations: Mapping[str, Any]
    supported_range: Mapping[str, Any] | None
    preliminary_classification: str
    final_classification: str
    evidence_strength: str
    evidence_basis: str
    continuation_status: str
    findings: tuple[Mapping[str, Any], ...]
    limitations: tuple[Mapping[str, Any], ...]
    assumptions: tuple[Mapping[str, Any], ...]
    validation_issues: tuple[Mapping[str, Any], ...]
    preliminary_to_final_comparison: Mapping[str, Any]
    assessment_digest: str
    schema_version: str = FINAL_ASSESSMENT_SCHEMA_VERSION
    methodology_version: str = FINAL_ASSESSMENT_METHODOLOGY_VERSION

    def __post_init__(self) -> None:
        for field_name in (
            "lineage",
            "subject_vehicle",
            "insurer_valuation_reviewed",
            "insurer_comparables",
            "external_evidence",
            "calculations",
            "preliminary_to_final_comparison",
        ):
            object.__setattr__(self, field_name, _freeze_json(getattr(self, field_name)))
        if self.supported_range is not None:
            object.__setattr__(self, "supported_range", _freeze_json(self.supported_range))
        for field_name in (
            "findings",
            "limitations",
            "assumptions",
            "validation_issues",
        ):
            object.__setattr__(
                self,
                field_name,
                tuple(_freeze_json(item) for item in getattr(self, field_name)),
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "methodologyVersion": self.methodology_version,
            "lineage": _thaw_json(self.lineage),
            "sourceSnapshotDigest": self.source_snapshot_digest,
            "analysisArtifactDigest": self.analysis_artifact_digest,
            "subjectVehicle": _thaw_json(self.subject_vehicle),
            "insurerValuationReviewed": _thaw_json(self.insurer_valuation_reviewed),
            "insurerComparables": _thaw_json(self.insurer_comparables),
            "externalEvidence": _thaw_json(self.external_evidence),
            "calculations": _thaw_json(self.calculations),
            "supportedRange": _thaw_json(self.supported_range),
            "preliminaryClassification": self.preliminary_classification,
            "finalClassification": self.final_classification,
            "evidenceStrength": self.evidence_strength,
            "evidenceBasis": self.evidence_basis,
            "continuationStatus": self.continuation_status,
            "findings": _thaw_json(self.findings),
            "limitations": _thaw_json(self.limitations),
            "assumptions": _thaw_json(self.assumptions),
            "validationIssues": _thaw_json(self.validation_issues),
            "preliminaryToFinalComparison": _thaw_json(
                self.preliminary_to_final_comparison
            ),
            "assessmentDigest": self.assessment_digest,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> FinalValuationAssessmentV1:
        validate_final_valuation_assessment_v1(data)
        return cls(
            lineage=data["lineage"],
            source_snapshot_digest=data["sourceSnapshotDigest"],
            analysis_artifact_digest=data["analysisArtifactDigest"],
            subject_vehicle=data["subjectVehicle"],
            insurer_valuation_reviewed=data["insurerValuationReviewed"],
            insurer_comparables=data["insurerComparables"],
            external_evidence=data["externalEvidence"],
            calculations=data["calculations"],
            supported_range=data["supportedRange"],
            preliminary_classification=data["preliminaryClassification"],
            final_classification=data["finalClassification"],
            evidence_strength=data["evidenceStrength"],
            evidence_basis=data["evidenceBasis"],
            continuation_status=data["continuationStatus"],
            findings=tuple(data["findings"]),
            limitations=tuple(data["limitations"]),
            assumptions=tuple(data["assumptions"]),
            validation_issues=tuple(data["validationIssues"]),
            preliminary_to_final_comparison=data["preliminaryToFinalComparison"],
            assessment_digest=data["assessmentDigest"],
            schema_version=data["schemaVersion"],
            methodology_version=data["methodologyVersion"],
        )


def validate_final_valuation_assessment_v1(
    value: FinalValuationAssessmentV1 | Mapping[str, Any],
    *,
    source_snapshot: TotalLossSourceSnapshotV1 | Mapping[str, Any] | None = None,
) -> None:
    data = value.to_dict() if isinstance(value, FinalValuationAssessmentV1) else value
    _validate_schema(data, FINAL_ASSESSMENT_SCHEMA_PATH, "FINAL_ASSESSMENT_INVALID")
    errors = _assessment_semantic_errors(data)
    if source_snapshot is not None:
        source = (
            source_snapshot.to_dict()
            if isinstance(source_snapshot, TotalLossSourceSnapshotV1)
            else source_snapshot
        )
        validate_total_loss_source_snapshot_v1(source)
        source_ids = {item["evidenceId"] for item in source["evidenceManifest"]}
        referenced: list[str] = []
        referenced.extend(data["subjectVehicle"]["evidenceIds"])
        referenced.extend(data["insurerValuationReviewed"]["evidenceIds"])
        for row in data["insurerComparables"]["rows"]:
            referenced.extend(row["evidenceIds"])
        for role in ("primary", "secondary"):
            for row in data["externalEvidence"]["selectedComparables"][role]:
                referenced.extend(row["evidenceIds"])
        for item in (*data["findings"], *data["limitations"]):
            referenced.extend(item["evidenceIds"])
        missing = sorted(set(referenced) - source_ids)
        if missing:
            errors.append("$.evidenceIds: contains references absent from source snapshot")
        if data["sourceSnapshotDigest"] != source["snapshotDigest"]:
            errors.append("$.sourceSnapshotDigest: does not match source snapshot")
        if data["analysisArtifactDigest"] != source["analysis"]["artifactDigest"]:
            errors.append("$.analysisArtifactDigest: does not match source snapshot")
        presentation = source["preliminary"]["presentation"]
        artifact_result = source["analysis"]["artifact"]["result"][
            "discrepancyResult"
        ]
        facts = source["input"]["confirmedFacts"]
        expected_lineage = {
            key: source["lineage"][key]
            for key in (
                "caseId",
                "packageJobId",
                "entitlementId",
                "preliminarySnapshotId",
                "sourceSnapshotId",
                "analysisRunId",
            )
        }
        if data["lineage"] != expected_lineage:
            errors.append("$.lineage: does not match source snapshot")
        expected_vehicle = {
            "year": presentation["vehicle"]["year"],
            "make": presentation["vehicle"]["make"],
            "model": presentation["vehicle"]["model"],
            "trim": presentation["vehicle"]["trim"],
            "vehicleConfiguration": facts.get("vehicleConfiguration"),
            "vin": facts.get("vin"),
            "mileage": presentation["vehicle"]["mileage"],
            "postalCode": presentation["vehicle"]["postalCode"],
            "lossDate": presentation["vehicle"]["lossDate"],
        }
        if {
            key: value
            for key, value in data["subjectVehicle"].items()
            if key != "evidenceIds"
        } != expected_vehicle:
            errors.append("$.subjectVehicle: does not match source evidence")
        expected_insurer = {
            "source": presentation["insurerValuation"]["source"],
            "valueMinorUnits": presentation["insurerValuation"]["value"]["cents"],
            "currency": source["preliminary"]["supportedRange"]["currency"],
        }
        if {
            key: value
            for key, value in data["insurerValuationReviewed"].items()
            if key != "evidenceIds"
        } != expected_insurer:
            errors.append(
                "$.insurerValuationReviewed: does not match source evidence"
            )
        if data["insurerComparables"]["summary"] != presentation[
            "cccComparables"
        ]["summary"]:
            errors.append("$.insurerComparables.summary: does not match source")
        if [row["facts"] for row in data["insurerComparables"]["rows"]] != list(
            presentation["cccComparables"]["rows"]
        ):
            errors.append("$.insurerComparables.rows: do not match source")
        if data["externalEvidence"]["primary"] != presentation[
            "primaryExternalEvidence"
        ] or data["externalEvidence"]["secondary"] != presentation[
            "secondaryExternalEvidence"
        ]:
            errors.append("$.externalEvidence: summaries do not match source")
        for role in ("primary", "secondary"):
            if [
                row["facts"]
                for row in data["externalEvidence"]["selectedComparables"][role]
            ] != list(presentation["comparablesUsed"][role]):
                errors.append(
                    f"$.externalEvidence.selectedComparables.{role}: does not match source"
                )
        expected_calculations = {
            "primaryComparison": artifact_result["primaryComparison"],
            "secondaryComparisons": artifact_result["secondaryComparisons"],
            "insurerComparableSummary": artifact_result["cccComparableSummary"],
        }
        if data["calculations"] != expected_calculations:
            errors.append("$.calculations: do not match source analysis")
        if data["preliminaryClassification"] != source["preliminary"][
            "classification"
        ]:
            errors.append("$.preliminaryClassification: does not match source")
        if data["finalClassification"] != presentation["assessment"][
            "classification"
        ]:
            errors.append("$.finalClassification: does not match source")
        if data["evidenceStrength"] != presentation["assessment"][
            "evidenceStrength"
        ]:
            errors.append("$.evidenceStrength: does not match source")
        if data["evidenceBasis"] != presentation["assessment"]["evidenceBasis"]:
            errors.append("$.evidenceBasis: does not match source")
        expected_range = source["preliminary"]["supportedRange"]
        if data["supportedRange"] is None:
            if any(expected_range[field] is not None for field in _MONEY_FIELDS):
                errors.append("$.supportedRange: unexpectedly absent")
        else:
            visible_range = {
                key: data["supportedRange"][key]
                for key in (*_MONEY_FIELDS, "currency")
            }
            if visible_range != expected_range:
                errors.append("$.supportedRange: does not match source evidence")
            if data["supportedRange"]["semantics"] != SELECTED_ADVERTISED_PRICE_RANGE:
                errors.append("$.supportedRange.semantics: is invalid")
        expected_preliminary_values = {
            "classification": source["preliminary"]["classification"],
            "supportedRange": copy.deepcopy(expected_range),
        }
        expected_final_values = {
            "classification": presentation["assessment"]["classification"],
            "supportedRange": _presentation_range(
                presentation, expected_range["currency"]
            ),
        }
        expected_source_comparison = build_preliminary_final_comparison(
            expected_preliminary_values, expected_final_values
        )
        if data["preliminaryToFinalComparison"] != expected_source_comparison:
            errors.append(
                "$.preliminaryToFinalComparison: does not match source evidence"
            )
        expected_findings = [
            (item["code"], item["label"], item["description"])
            for item in presentation["findings"]
        ]
        actual_findings = [
            (item["code"], item["label"], item["description"])
            for item in data["findings"]
        ]
        if actual_findings != expected_findings:
            errors.append("$.findings: do not match source")
        expected_limitations = [
            (item["code"], item["label"], item["description"])
            for item in presentation["limitations"]
        ]
        actual_limitations = [
            (item["code"], item["label"], item["description"])
            for item in data["limitations"]
        ]
        if actual_limitations != expected_limitations:
            errors.append("$.limitations: do not match source")
    if errors:
        raise _failure(
            "Final valuation assessment failed semantic validation",
            "FINAL_ASSESSMENT_INVALID",
            tuple(errors),
        )


def _message_rows(
    rows: Sequence[Mapping[str, Any]],
    manifest: Sequence[Mapping[str, Any]],
    kind: str,
) -> list[dict[str, Any]]:
    return [
        {
            "code": row["code"],
            "label": row["label"],
            "description": row["description"],
            "evidenceIds": [
                _evidence_id(
                    manifest,
                    f"/result/discrepancyResult/{kind}/{index}",
                )
            ],
        }
        for index, row in enumerate(rows)
    ]


def build_final_valuation_assessment_v1(
    source_snapshot: TotalLossSourceSnapshotV1 | Mapping[str, Any],
) -> FinalValuationAssessmentV1:
    """Project one frozen source snapshot without rerunning any valuation work."""

    source = (
        source_snapshot.to_dict()
        if isinstance(source_snapshot, TotalLossSourceSnapshotV1)
        else copy.deepcopy(dict(source_snapshot))
    )
    validate_total_loss_source_snapshot_v1(source)
    presentation = source["preliminary"]["presentation"]
    artifact = source["analysis"]["artifact"]
    manifest = source["evidenceManifest"]
    result = artifact["result"]["discrepancyResult"]
    facts = source["input"]["confirmedFacts"]

    vehicle_paths = [
        "/result/discrepancyRequest/lossVehicle/year",
        "/result/discrepancyRequest/lossVehicle/make",
        "/result/discrepancyRequest/lossVehicle/model",
        "/result/discrepancyRequest/lossVehicle/trim",
        "/result/discrepancyRequest/lossVehicle/mileage",
        "/result/discrepancyRequest/lossVehicle/postalCode",
        "/result/discrepancyRequest/lossDate",
    ]
    for optional in ("vin", "vehicleConfiguration"):
        if facts.get(optional) is not None:
            vehicle_paths.append(f"/{optional}")
    subject_vehicle = {
        "year": presentation["vehicle"]["year"],
        "make": presentation["vehicle"]["make"],
        "model": presentation["vehicle"]["model"],
        "trim": presentation["vehicle"]["trim"],
        "vehicleConfiguration": facts.get("vehicleConfiguration"),
        "vin": facts.get("vin"),
        "mileage": presentation["vehicle"]["mileage"],
        "postalCode": presentation["vehicle"]["postalCode"],
        "lossDate": presentation["vehicle"]["lossDate"],
        "evidenceIds": _evidence_ids(manifest, vehicle_paths),
    }
    currency = source["preliminary"]["supportedRange"]["currency"]
    insurer_valuation = {
        "source": presentation["insurerValuation"]["source"],
        "valueMinorUnits": presentation["insurerValuation"]["value"]["cents"],
        "currency": currency,
        "evidenceIds": [
            _evidence_id(
                manifest,
                "/result/discrepancyResult/cccVehicleValuationCents",
            )
        ],
    }
    insurer_rows = [
        {
            "facts": copy.deepcopy(row),
            "evidenceIds": [
                _evidence_id(
                    manifest,
                    f"/result/discrepancyResult/cccComparableSummary/comparables/{index}",
                )
            ],
        }
        for index, row in enumerate(presentation["cccComparables"]["rows"])
    ]
    insurer_comparables = {
        "methodologyTreatment": DESCRIPTIVE_ONLY,
        "weightingStatus": NOT_DETERMINED_BY_V1,
        "summary": copy.deepcopy(presentation["cccComparables"]["summary"]),
        "rows": insurer_rows,
    }

    selected: dict[str, list[dict[str, Any]]] = {"primary": [], "secondary": []}
    for role in ("primary", "secondary"):
        summary_name = (
            "historicalExternalSummary"
            if presentation[
                "primaryExternalEvidence" if role == "primary" else "secondaryExternalEvidence"
            ]
            is not None
            and presentation[
                "primaryExternalEvidence" if role == "primary" else "secondaryExternalEvidence"
            ]["evidenceBasis"]
            == "LOSS_DATE_HISTORICAL"
            else "currentExternalSummary"
        )
        for index, row in enumerate(presentation["comparablesUsed"][role]):
            selected[role].append(
                {
                    "facts": copy.deepcopy(row),
                    "evidenceIds": [
                        _evidence_id(
                            manifest,
                            f"/result/discrepancyResult/{summary_name}/selectedEvidence/{index}",
                        )
                    ],
                }
            )
    external_evidence = {
        "primary": copy.deepcopy(presentation["primaryExternalEvidence"]),
        "secondary": copy.deepcopy(presentation["secondaryExternalEvidence"]),
        "selectedComparables": selected,
    }
    calculations = {
        "primaryComparison": copy.deepcopy(result["primaryComparison"]),
        "secondaryComparisons": copy.deepcopy(result["secondaryComparisons"]),
        "insurerComparableSummary": copy.deepcopy(result["cccComparableSummary"]),
    }
    range_data = source["preliminary"]["supportedRange"]
    supported_range = None
    primary = presentation["primaryExternalEvidence"]
    if all(range_data[field] is not None for field in _MONEY_FIELDS):
        summary_name = (
            "historicalExternalSummary"
            if primary["evidenceBasis"] == "LOSS_DATE_HISTORICAL"
            else "currentExternalSummary"
        )
        supported_range = {
            "semantics": SELECTED_ADVERTISED_PRICE_RANGE,
            "evidenceBasis": presentation["assessment"]["evidenceBasis"],
            **copy.deepcopy(range_data),
            "evidenceIds": [
                _evidence_id(
                    manifest,
                    f"/result/discrepancyResult/{summary_name}/prices",
                )
            ],
        }

    classification = presentation["assessment"]["classification"]
    preliminary_values = {
        "classification": source["preliminary"]["classification"],
        "supportedRange": copy.deepcopy(source["preliminary"]["supportedRange"]),
    }
    final_values = {
        "classification": classification,
        "supportedRange": _presentation_range(presentation, currency),
    }
    comparison = build_preliminary_final_comparison(
        preliminary_values, final_values
    )
    findings = _message_rows(presentation["findings"], manifest, "findings")
    limitations = _message_rows(
        presentation["limitations"], manifest, "limitations"
    )
    lineage = {
        key: source["lineage"][key]
        for key in (
            "caseId",
            "packageJobId",
            "entitlementId",
            "preliminarySnapshotId",
            "analysisRunId",
        )
    }
    lineage["sourceSnapshotId"] = source["lineage"]["sourceSnapshotId"]
    unsigned = {
        "schemaVersion": FINAL_ASSESSMENT_SCHEMA_VERSION,
        "methodologyVersion": FINAL_ASSESSMENT_METHODOLOGY_VERSION,
        "lineage": lineage,
        "sourceSnapshotDigest": source["snapshotDigest"],
        "analysisArtifactDigest": source["analysis"]["artifactDigest"],
        "subjectVehicle": subject_vehicle,
        "insurerValuationReviewed": insurer_valuation,
        "insurerComparables": insurer_comparables,
        "externalEvidence": external_evidence,
        "calculations": calculations,
        "supportedRange": supported_range,
        "preliminaryClassification": source["preliminary"]["classification"],
        "finalClassification": classification,
        "evidenceStrength": presentation["assessment"]["evidenceStrength"],
        "evidenceBasis": presentation["assessment"]["evidenceBasis"],
        "continuationStatus": _continuation_status(classification),
        "findings": findings,
        "limitations": limitations,
        "assumptions": [],
        "validationIssues": [],
        "preliminaryToFinalComparison": comparison,
    }
    data = {**unsigned, "assessmentDigest": canonical_package_digest(unsigned)}
    assessment = FinalValuationAssessmentV1.from_dict(data)
    validate_final_valuation_assessment_v1(assessment, source_snapshot=source)
    return assessment


__all__ = [
    "DESCRIPTIVE_ONLY",
    "DOES_NOT_SUPPORT_CONTINUATION",
    "FATAL_LINEAGE_INTEGRITY_FAILURE",
    "FINAL_ASSESSMENT_METHODOLOGY_VERSION",
    "FINAL_ASSESSMENT_SCHEMA_PATH",
    "FINAL_ASSESSMENT_SCHEMA_VERSION",
    "FinalValuationAssessmentV1",
    "HUMAN_REVIEW_REQUIRED",
    "NEW_EVIDENCE_REQUIRED",
    "NOT_DETERMINED_BY_V1",
    "PACKAGE_FAILURE_CLASSIFICATIONS",
    "PackageAssessmentError",
    "RETRYABLE_OPERATIONAL_FAILURE",
    "REVIEW_REQUIRED",
    "SELECTED_ADVERTISED_PRICE_RANGE",
    "SOURCE_LINEAGE_CONFLICT",
    "SOURCE_SNAPSHOT_SCHEMA_PATH",
    "SOURCE_SNAPSHOT_SCHEMA_VERSION",
    "SUPPORTS_CONTINUATION",
    "TotalLossSourceSnapshotV1",
    "UNCHANGED_EVIDENCE",
    "build_final_valuation_assessment_v1",
    "build_preliminary_final_comparison",
    "build_total_loss_source_snapshot_v1",
    "canonical_package_digest",
    "evidence_reference_id",
    "load_strict_package_json",
    "validate_final_valuation_assessment_v1",
    "validate_total_loss_source_snapshot_v1",
]
