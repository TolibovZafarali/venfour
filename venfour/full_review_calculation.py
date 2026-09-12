"""Requalify retained evidence against the accepted insurer report, offline."""

from __future__ import annotations

import copy
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from uuid import NAMESPACE_URL, UUID, uuid5

from venfour.analysis_runs import _historical_result_from_data, validate_analysis_run_artifact
from venfour.comparable_evidence import assess_observation, listing_from_observation, observation_identity
from venfour.discrepancy import valuation_discrepancy_request_from_report
from venfour.efficient_search import subject_material_facts, _historical_item
from venfour.market import MarketSearchResult
from venfour.orchestration import AnalysisOrchestrator, AnalysisRunRequest, CurrentMarketSearchConfiguration, HistoricalMarketSearchConfiguration
from venfour.presentation import AnalysisPresentationProjector
from venfour.report_ingestion import normalized_report_to_legacy_report
from venfour.subject_readiness import confirmed_subject_readiness
from venfour.valuation_inputs import ConfirmedValuationInput, apply_confirmed_vehicle_facts, confirmed_normalized_report, evidence_context


class _ReviewRepository:
    def __init__(self):
        self.artifacts = {}

    def save(self, artifact):
        self.artifacts[artifact.run_id] = artifact

    def get(self, run_id):
        return self.artifacts[run_id]


def calculate_report_review(free_artifact, extraction, readiness, *, report_id: str, created_at: str):
    """Use only previously verified, price-independent observations.

    These providers are projections of frozen records. They have no credentials,
    network client, gateway, request budget, or transport. Missing historical
    proof remains missing; a changed loss date never reuses a different date.
    """
    validate_analysis_run_artifact(free_artifact)
    normalized = extraction["normalizedReport"]
    effective = readiness["effectiveInput"]
    if readiness.get("ready") is not True or not confirmed_subject_readiness(effective, normalized)["ready"]:
        raise ValueError("Full review facts are unresolved")
    confirmed = ConfirmedValuationInput.from_snapshot(effective)
    effective_report = confirmed_normalized_report(confirmed, normalized)
    legacy = normalized_report_to_legacy_report(effective_report)
    apply_confirmed_vehicle_facts(legacy, confirmed)
    target = valuation_discrepancy_request_from_report(legacy, postal_code=confirmed.postal_code).loss_vehicle
    subject = subject_material_facts(legacy)
    search = free_artifact["result"].get("marketSearch") or {}
    retained = {"current": {}, "historical": {}}
    for row in search.get("observations", []):
        assessment = assess_observation(target, row, subject_material_facts=subject, evidence_date=confirmed.loss_date)
        if assessment["baselineEligible"] and row.get("stream") in retained:
            retained[row["stream"]].setdefault(observation_identity(row), copy.deepcopy(row))
    current_template = free_artifact["result"].get("currentMarketResult")
    historical_template = free_artifact["result"].get("historicalMarketResult")

    def current_search(request):
        rows = [listing_from_observation(row) for row in retained["current"].values()
                if row["listing"]["distanceMiles"] <= request.radius_miles]
        return MarketSearchResult(provider=current_template["provider"], request=request, listings=tuple(rows[:request.result_limit]))

    def historical_search(request):
        template = _historical_result_from_data(historical_template)
        rows = [_historical_item(row["historicalEvidence"]) for row in retained["historical"].values()
                if row["listing"]["distanceMiles"] <= request.radius_miles and row["relevantDate"] == request.evidence_date]
        return replace(template, request=request, evidence=tuple(rows[:request.result_limit]))

    current = SimpleNamespace(name=current_template["provider"], search=current_search, maximum_search_radius_miles=250) if current_template else None
    historical = (SimpleNamespace(name=historical_template["provider"], search_historical=historical_search, maximum_search_radius_miles=250)
                  if historical_template and historical_template["evidenceDate"] == confirmed.loss_date else None)
    observed = free_artifact["request"]["currentObservedDate"]
    run_id = str(UUID(bytes=uuid5(NAMESPACE_URL, f"venfour-report-review:{free_artifact['runId']}:{report_id}").bytes, version=4))
    result = AnalysisOrchestrator(
        _ReviewRepository(), current_provider=current, historical_provider=historical,
        current_provider_version="retained-evidence-1" if current else None,
        historical_provider_version="retained-evidence-1" if historical else None,
        run_id_factory=lambda: run_id, clock=lambda: datetime.fromisoformat(created_at.replace("Z", "+00:00")),
    ).run(AnalysisRunRequest(
        ccc_report=legacy, postal_code=confirmed.postal_code, loss_date_override=confirmed.loss_date,
        current_search=CurrentMarketSearchConfiguration(observed) if current and observed else None,
        historical_search=HistoricalMarketSearchConfiguration() if historical else None,
        evidence_context=evidence_context(confirmed, effective_report, adapter=extraction["adapter"],
                                          partial_extraction=extraction["partial"], report_extraction_available=True),
        qualification_source_report=normalized_report_to_legacy_report(normalized), vehicle_configuration=confirmed.vehicle_configuration,
    ))
    artifact = result.artifact.to_dict()
    return {"artifact": artifact, "presentation": AnalysisPresentationProjector().project(result.artifact).to_dict(),
            "retainedEligibleIdentities": {stream: sorted(rows) for stream, rows in retained.items()},
            "newProviderRequests": 0}
