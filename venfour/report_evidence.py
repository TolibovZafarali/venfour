"""Bind document understanding to the immutable valuation inputs it produced."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from venfour.analysis_runs import AnalysisRunArtifact
from venfour.discrepancy import valuation_discrepancy_request_from_report
from venfour.report_ingestion import ReportIngestionResult, normalized_report_to_legacy_report


CUSTOMER_SUPPLIED = "CUSTOMER_SUPPLIED"
INSURER_EXTRACTED = "INSURER_EXTRACTED"
REPORT_LOCAL_SOURCE_ARTIFACT = "SOURCE_SNAPSHOT"

_CUSTOMER_CONFIRMED_REPORT_FIELDS = frozenset(
    {
        "insurerName",
        "priorTitleStatus",
        "condition",
        "existingDamageDescription",
        "optionsPackages",
    }
)
_EXTRACTED_INSURER_POINTER = "/extraction/normalizedReport/report/insurer"


@dataclass(frozen=True)
class ReportLocalEvidenceSource:
    """One report-local reference resolved from an allowed frozen source path."""

    source_identity: str
    evidence_label: str
    value: Any


def resolve_report_local_evidence_source(
    source_snapshot: Mapping[str, Any], json_pointer: str
) -> ReportLocalEvidenceSource | None:
    """Resolve only the source-snapshot paths a report may cite locally."""

    if not isinstance(json_pointer, str):
        return None
    source_input = source_snapshot.get("input")
    if not isinstance(source_input, Mapping):
        return None
    confirmed_facts = source_input.get("confirmedFacts")
    if not isinstance(confirmed_facts, Mapping):
        return None

    confirmed_prefix = "/input/confirmedFacts/"
    if json_pointer.startswith(confirmed_prefix):
        field = json_pointer.removeprefix(confirmed_prefix)
        value = confirmed_facts.get(field)
        if field not in _CUSTOMER_CONFIRMED_REPORT_FIELDS or value is None:
            return None
        return ReportLocalEvidenceSource(
            source_identity=field,
            evidence_label=CUSTOMER_SUPPLIED,
            value=value,
        )

    if (
        json_pointer != _EXTRACTED_INSURER_POINTER
        or source_input.get("intakeMode") != "REPORT"
        or confirmed_facts.get("insurerName") is not None
    ):
        return None
    extraction = source_snapshot.get("extraction")
    normalized_report = (
        extraction.get("normalizedReport")
        if isinstance(extraction, Mapping)
        else None
    )
    report = (
        normalized_report.get("report")
        if isinstance(normalized_report, Mapping)
        else None
    )
    insurer_name = report.get("insurer") if isinstance(report, Mapping) else None
    if insurer_name is None:
        return None
    return ReportLocalEvidenceSource(
        source_identity="insurerName",
        evidence_label=INSURER_EXTRACTED,
        value=insurer_name,
    )


def validate_report_evidence_for_artifact(ingestion: ReportIngestionResult, artifact: Mapping):
    """Reject evidence that would change any original insurer-analysis input."""
    AnalysisRunArtifact.from_dict(artifact)
    original = artifact["request"]["baseDiscrepancyRequest"]
    derived = valuation_discrepancy_request_from_report(
        normalized_report_to_legacy_report(ingestion.to_dict()["normalizedReport"]),
        postal_code=original["lossVehicle"]["postalCode"],
    ).to_dict()
    if derived != original:
        raise ValueError("Report evidence does not match the immutable analysis inputs")


def package_report_facts(context: Mapping) -> tuple[dict, bool]:
    """Fill missing report-input fields from stored evidence, never edit intake."""
    raw = dict(context["confirmed_facts"])
    fields = {
        "vehicle_year": "year", "vehicle_make": "make", "vehicle_model": "model",
        "vehicle_trim": "trim", "mileage_at_loss": "mileage", "date_of_loss": "lossDate",
    }
    deferred = context.get("source_intake_mode") == "report" and any(
        raw.get(key) is None for key in (*fields, "insurer_name")
    )
    if not deferred:
        return raw, False
    ingestion = ReportIngestionResult.from_dict(context["normalized_extraction"])
    artifact = context["analysis_artifact"]
    validate_report_evidence_for_artifact(ingestion, artifact)
    original = artifact["request"]["baseDiscrepancyRequest"]
    vehicle = original["lossVehicle"]
    for key, source in fields.items():
        if raw.get(key) is None:
            raw[key] = original["lossDate"] if source == "lossDate" else vehicle[source]
    if raw.get("insurer_vehicle_valuation") is None:
        # Use the existing adapter's exact dollars; package validation binds cents.
        raw["insurer_vehicle_valuation"] = normalized_report_to_legacy_report(
            ingestion.to_dict()["normalizedReport"]
        )["valuation"]["adjustedVehicleValue"]
    # VIN/configuration retain customer-input provenance; report values remain in
    # the separately sealed extraction, without inventing customer confirmation.
    return raw, True
