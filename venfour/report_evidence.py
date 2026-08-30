"""Bind document understanding to the immutable valuation inputs it produced."""
from __future__ import annotations

from collections.abc import Mapping

from venfour.analysis_runs import AnalysisRunArtifact
from venfour.discrepancy import valuation_discrepancy_request_from_report
from venfour.report_ingestion import ReportIngestionResult, normalized_report_to_legacy_report


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
