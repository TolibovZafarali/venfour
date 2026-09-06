"""Persisted sparse-market search bounds and nonempty independent evidence."""

from __future__ import annotations

import copy
import json
import os
from dataclasses import replace
from unittest.mock import patch

from tests.test_analysis_runs import (
    RecordingCurrentProvider, RecordingHistoricalProvider, TemporaryRepositoryTestCase,
    make_orchestrator, make_run_request,
)
from venfour.analysis_runs import canonical_json_bytes, default_report_evidence_context
from venfour.marketcheck import MarketCheckHistoricalProvider, MarketCheckProvider
from venfour.presentation import AnalysisPresentationProjector


class SparseCurrentProvider(RecordingCurrentProvider):
    drivetrain_discovery = staticmethod(MarketCheckProvider.drivetrain_discovery)

    def __init__(self, maximum_radius=250):
        super().__init__(tuple(2_100_000 + index * 10_000 for index in range(9)))
        self.maximum_search_radius_miles = maximum_radius
        self.queries = []

    def search(self, request):
        adapter = MarketCheckProvider("sparse-market-fixture-key", maximum_search_radius_miles=self.maximum_search_radius_miles)
        params = adapter._params(request, start=0, rows=min(request.result_limit, 50))
        self.queries.append({key: value for key, value in params.items() if key != "api_key"})
        result = super().search(request)
        listings = () if request.radius_miles < 200 else tuple(
            replace(row, drivetrain="FWD", drivetrain_recorded=True, distance_miles=150 + index * 5)
            for index, row in enumerate(result.listings)
        )
        return replace(result, listings=listings)


class EmptyLocalHistoricalProvider(RecordingHistoricalProvider):
    maximum_search_radius_miles = 100
    drivetrain_discovery = staticmethod(MarketCheckProvider.drivetrain_discovery)

    def __init__(self):
        super().__init__(())
        self.queries = []

    def search_historical(self, request):
        params = MarketCheckHistoricalProvider("sparse-market-fixture-key")._historical_params(request, start=0, rows=min(request.result_limit, 50))
        self.queries.append({key: value for key, value in params.items() if key != "api_key"})
        return super().search_historical(request)


class SparseMarketRunTests(TemporaryRepositoryTestCase):
    def run_sparse(self, *, offer=25_704, mode="REPORT", maximum_radius=250, child="runs"):
        request = make_run_request()
        report = copy.deepcopy(request.ccc_report)
        report["vehicle"]["drivetrain"] = "FWD"
        report["valuation"]["adjustedVehicleValue"] = offer
        context = default_report_evidence_context({"cccVehicleValuation": offer, "cccComparables": report["comparables"]})
        source = copy.deepcopy(report)
        if mode == "MANUAL":
            source = None
            report["comparables"] = []
            context.update(inputMode="MANUAL", reportAvailable=False, reportExtractionAvailable=False,
                           reportProvider=None, reportAdapter=None, offerAvailable=True,
                           reportComparablesAvailable=False, reportAdjustmentsAvailable=False)
        current, historical = SparseCurrentProvider(maximum_radius), EmptyLocalHistoricalProvider()
        repository = self.repository(child)
        artifact = make_orchestrator(repository, current_provider=current, historical_provider=historical).run(
            replace(request, ccc_report=report, qualification_source_report=source, evidence_context=context)
        ).artifact
        return repository, artifact, current, historical

    def test_wider_current_search_keeps_historical_limit_and_replays_existing_versions(self):
        repository, artifact, current, historical = self.run_sparse()
        data = artifact.to_dict()
        self.assertEqual(data["analysisRunSchemaVersion"], "10")
        self.assertEqual(data["comparableScoringVersion"], "2")
        self.assertEqual([request.radius_miles for request in current.requests], [50, 100, 200])
        self.assertEqual([request.radius_miles for request in historical.requests], [50, 100])
        for stream, expected in (("current", [50, 100, 200, 250]), ("historical", [50, 100])):
            self.assertEqual([stage["radiusMiles"] for stage in data["request"]["configuredSearchPolicies"][stream]["stages"]], expected)
            self.assertEqual([stage["radiusMiles"] for stage in data["request"]["searchPolicies"][stream]["stages"]], expected)
        for provider in (current, historical):
            for query in provider.queries:
                self.assertEqual({key: query[key] for key in ("year", "make", "model", "trim", "drivetrain", "car_type", "has_price")},
                                 {"year": 2024, "make": "Synthetic", "model": "Sedan", "trim": "SEL", "drivetrain": "FWD", "car_type": "used", "has_price": "true"})
        current_diagnostics = data["result"]["searchDiagnostics"]["current"]
        self.assertEqual([attempt["returnedCount"] for attempt in current_diagnostics["attempts"]], [0, 0, 9])
        self.assertEqual([attempt["eligibleCount"] for attempt in current_diagnostics["attempts"]], [0, 0, 9])
        self.assertEqual(current_diagnostics["stopReason"], "SUFFICIENT_STRONG_MATCHES")
        self.assertEqual(data["result"]["searchDiagnostics"]["historical"]["stopReason"], "HISTORICAL_SEARCH_CEILING_REACHED")
        before = canonical_json_bytes(data)
        with patch.object(current, "search", side_effect=AssertionError("replay must stay offline")), patch.object(historical, "search_historical", side_effect=AssertionError("replay must stay offline")):
            restored = repository.get(artifact.run_id)
            presentation = AnalysisPresentationProjector().project(restored).to_dict()
        self.assertEqual(canonical_json_bytes(restored.to_dict()), before)
        self.assertEqual(presentation["presentationVersion"], "6")
        self.assertEqual(presentation["assessment"]["evidenceBasis"], "CURRENT_MARKET")
        self.assertEqual(len(presentation["comparablesUsed"]["primary"]), 9)
        self.assertTrue(all(row["evidenceBasis"] == "CURRENT_MARKET" for row in presentation["comparablesUsed"]["primary"]))

    def test_nonempty_wider_search_is_independent_of_all_four_insurer_values(self):
        runs = [self.run_sparse(offer=offer, child=str(offer)) for offer in (20_000, 24_000, 25_704, 30_000)]
        reference = runs[0][1].to_dict()
        reference_presentation = AnalysisPresentationProjector().project(runs[0][1]).to_dict()
        self.assertEqual(len(reference_presentation["comparablesUsed"]["primary"]), 9)
        classifications = set()
        for _, artifact, current, historical in runs:
            data = artifact.to_dict()
            self.assertEqual(current.queries, runs[0][2].queries)
            self.assertEqual(historical.queries, runs[0][3].queries)
            for field in ("currentMarketResult", "historicalMarketResult", "currentRanking", "historicalRanking", "searchDiagnostics"):
                self.assertEqual(data["result"][field], reference["result"][field])
            presentation = AnalysisPresentationProjector().project(artifact).to_dict()
            self.assertEqual(presentation["comparablesUsed"], reference_presentation["comparablesUsed"])
            self.assertEqual(presentation["primaryExternalEvidence"], reference_presentation["primaryExternalEvidence"])
            classifications.add(presentation["assessment"]["classification"])
        self.assertGreater(len(classifications), 1)

    def test_report_and_manual_paths_share_the_same_geographic_evidence(self):
        _, report, report_current, report_history = self.run_sparse(child="report")
        _, manual, manual_current, manual_history = self.run_sparse(child="manual", mode="MANUAL")
        self.assertEqual(report_current.queries, manual_current.queries)
        self.assertEqual(report_history.queries, manual_history.queries)
        for field in ("currentMarketResult", "historicalMarketResult", "currentRanking", "historicalRanking", "searchDiagnostics"):
            self.assertEqual(report.to_dict()["result"][field], manual.to_dict()["result"][field])
        for artifact, mode in ((report, "REPORT"), (manual, "MANUAL")):
            presentation = AnalysisPresentationProjector().project(artifact).to_dict()
            self.assertEqual(presentation["analysisScope"]["inputMode"], mode)
            self.assertEqual(presentation["assessment"]["evidenceBasis"], "CURRENT_MARKET")

    def test_previously_capped_version_ten_keeps_its_original_scope_after_wider_run(self):
        repository, old, _, _ = self.run_sparse(maximum_radius=100, child="capped")
        before = canonical_json_bytes(old.to_dict())
        _, expanded, _, _ = self.run_sparse(child="expanded")
        self.assertEqual(canonical_json_bytes(repository.get(old.run_id).to_dict()), before)
        self.assertEqual(old.to_dict()["result"]["searchDiagnostics"]["current"]["stopReason"], "CURRENT_SEARCH_CEILING_REACHED")
        self.assertEqual(old.to_dict()["result"]["currentMarketResult"]["listingCount"], 0)
        self.assertEqual(expanded.to_dict()["result"]["currentMarketResult"]["listingCount"], 9)
        self.assertNotEqual(old.search_diagnostics_digest, expanded.search_diagnostics_digest)

    def test_scope_diagnostics_distinguish_declared_capability_and_allowlist_only_bounds(self):
        for maximum, effective in ((175, [50, 100]), (500, [50, 100, 200, 250])):
            with self.subTest(maximum=maximum), patch.dict(os.environ, {"VENFOUR_PROVIDER_DIAGNOSTICS": "1"}, clear=False), self.assertLogs("venfour.provider_diagnostics", level="WARNING") as logs:
                self.run_sparse(maximum_radius=maximum, child=str(maximum))
            payloads = [json.loads(record.getMessage()) for record in logs.records]
            self.assertEqual(payloads, [
                {"event": "market_search_scope", "stream": "current", "declaredProviderMaximumRadiusMiles": maximum,
                 "configuredRadiiMiles": [50, 100, 200, 250], "effectiveRadiiMiles": effective},
                {"event": "market_search_scope", "stream": "historical", "declaredProviderMaximumRadiusMiles": 100,
                 "configuredRadiiMiles": [50, 100], "effectiveRadiiMiles": [50, 100]},
            ])
            rendered = "\n".join(record.getMessage() for record in logs.records)
            for private_value in ("synthetic-unused-provider-secret", "synthetic-unused-historical-secret", "SYNTHETICVIN", "63026", "25704", "api_key", "trim", "drivetrain"):
                self.assertNotIn(private_value, rendered)

    def test_scope_diagnostics_are_disabled_when_gate_is_absent_and_do_not_change_artifact(self):
        with patch.dict(os.environ, {"VENFOUR_PROVIDER_DIAGNOSTICS": "1"}, clear=False), self.assertLogs("venfour.provider_diagnostics", level="WARNING"):
            _, enabled, _, _ = self.run_sparse(child="logging-enabled")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VENFOUR_PROVIDER_DIAGNOSTICS", None)
            with self.assertNoLogs("venfour.provider_diagnostics", level="WARNING"):
                _, disabled, _, _ = self.run_sparse(child="logging-disabled")
        self.assertEqual(enabled.to_dict(), disabled.to_dict())
