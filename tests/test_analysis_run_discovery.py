"""Versioned drivetrain discovery and immutable search provenance."""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from tests.test_analysis_runs import (
    RecordingCurrentProvider, RecordingHistoricalProvider, TemporaryRepositoryTestCase,
    make_orchestrator, make_run_request, remove_discovery_provenance,
)
from venfour.analysis_runs import (
    AnalysisRunArtifact, AnalysisRunContractError, canonical_json_bytes,
    default_report_evidence_context, validate_analysis_run_artifact,
)
from venfour.marketcheck import MarketCheckHistoricalProvider, MarketCheckProvider
from venfour.historical_market import HistoricalEvidenceIssue
from venfour.presentation import (
    AnalysisPresentation, AnalysisPresentationContractError,
    AnalysisPresentationProjector, validate_analysis_presentation,
)


class FilteredCurrentProvider(RecordingCurrentProvider):
    maximum_search_radius_miles = 250
    drivetrain_discovery = staticmethod(MarketCheckProvider.drivetrain_discovery)

    def __init__(self):
        super().__init__()
        self.queries = []

    def search(self, request):
        params = MarketCheckProvider(
            "discovery-fixture-key",
            maximum_search_radius_miles=self.maximum_search_radius_miles,
        )._params(request, start=0, rows=50)
        self.queries.append({key: value for key, value in params.items() if key != "api_key"})
        result = super().search(request)
        return replace(result, listings=tuple(replace(row, drivetrain="FWD", drivetrain_recorded=True) for row in result.listings))


class FilteredHistoricalProvider(RecordingHistoricalProvider):
    drivetrain_discovery = staticmethod(MarketCheckProvider.drivetrain_discovery)

    def __init__(self):
        super().__init__()
        self.queries = []

    def search_historical(self, request):
        params = MarketCheckHistoricalProvider("discovery-fixture-key")._historical_params(request, start=0, rows=50)
        self.queries.append({key: value for key, value in params.items() if key != "api_key"})
        result = super().search_historical(request)
        return replace(result, evidence=tuple(replace(item, listing=replace(item.listing, drivetrain="FWD", drivetrain_recorded=True)) for item in result.evidence))


class AnalysisRunDiscoveryTests(TemporaryRepositoryTestCase):
    def filtered_run(self, *, drive="FWD", offer=25_704, child="runs", input_mode="REPORT", subject_trim=None):
        current, historical = FilteredCurrentProvider(), FilteredHistoricalProvider()
        request = make_run_request()
        report = copy.deepcopy(request.ccc_report)
        report["vehicle"]["drivetrain"] = drive
        if subject_trim is not None:
            report["vehicle"]["trim"] = subject_trim
        report["valuation"]["adjustedVehicleValue"] = offer
        source = copy.deepcopy(report)
        source["vehicle"]["drivetrain"] = "AWD"
        context = default_report_evidence_context({"cccVehicleValuation": offer, "cccComparables": report["comparables"]})
        if input_mode == "MANUAL":
            context.update(inputMode="MANUAL", reportAvailable=False, reportExtractionAvailable=False,
                           reportProvider=None, reportAdapter=None, offerAvailable=True,
                           reportComparablesAvailable=False, reportAdjustmentsAvailable=False)
            report["comparables"] = []
            source = None
        repository = self.repository(child)
        with patch.object(MarketCheckProvider, "lookup_drivetrain", side_effect=AssertionError("complete filtered evidence needs no enrichment")) as lookup:
            artifact = make_orchestrator(repository, current_provider=current, historical_provider=historical, resolution_lookup=lookup).run(
                replace(request, ccc_report=report, qualification_source_report=source, evidence_context=context)
            ).artifact
            lookup.assert_not_called()
        return artifact, current, historical

    def test_effective_report_and_manual_subject_drive_each_provider_search(self):
        for mode in ("REPORT", "MANUAL"):
            with self.subTest(mode=mode):
                artifact, current, historical = self.filtered_run(input_mode=mode, child=mode)
                data = artifact.to_dict()
                self.assertEqual(data["analysisRunSchemaVersion"], "10")
                for provider, stream in ((current, "current"), (historical, "historical")):
                    self.assertTrue(provider.queries)
                    self.assertTrue(all(query["drivetrain"] == "FWD" for query in provider.queries))
                    for attempt in data["result"]["searchDiagnostics"][stream]["attempts"]:
                        self.assertEqual(attempt["result"]["request"]["drivetrainDiscovery"]["filterValue"], "FWD")
                self.assertEqual(data["result"]["preliminaryResolution"]["budget"]["providerRequestCount"], 0)
                if mode == "REPORT":
                    self.assertEqual(data["request"]["qualificationSourceReport"]["vehicle"]["drivetrain"], "AWD")
                presentation = AnalysisPresentationProjector().project(artifact).to_dict()
                self.assertEqual(presentation["presentationVersion"], "6")
                for stream in ("current", "historical"):
                    self.assertEqual(presentation["provenance"]["drivetrainDiscovery"][stream], data["request"][f"{stream}SearchRequest"]["drivetrainDiscovery"])

    def test_insurer_value_never_changes_discovery_parameters_or_market_evidence(self):
        outputs = [self.filtered_run(offer=offer, child=str(offer)) for offer in (20_000, 24_000, 25_704, 30_000)]
        reference = outputs[0][0].to_dict()
        for artifact, current, historical in outputs[1:]:
            self.assertEqual(current.queries, outputs[0][1].queries)
            self.assertEqual(historical.queries, outputs[0][2].queries)
            for key in ("currentMarketResult", "historicalMarketResult", "currentRanking", "historicalRanking", "searchDiagnostics"):
                self.assertEqual(artifact.to_dict()["result"][key], reference["result"][key])

    def test_unknown_drive_and_unverified_awd_mapping_remain_explicitly_unfiltered(self):
        for drive, status in ((None, "SUBJECT_DRIVETRAIN_UNKNOWN"), ("AWD", "PROVIDER_MAPPING_UNVERIFIED")):
            artifact, current, historical = self.filtered_run(drive=drive, child=str(drive), subject_trim="SE FWD" if drive is None else None)
            for provider in (current, historical):
                self.assertTrue(all("drivetrain" not in query for query in provider.queries))
            for stream in ("current", "historical"):
                self.assertEqual(artifact.to_dict()["request"][f"{stream}SearchRequest"]["drivetrainDiscovery"], {"version": "1", "status": status, "filterValue": None})

    def test_four_wheel_drive_filter_does_not_admit_contradictory_returned_facts(self):
        artifact, current, historical = self.filtered_run(drive="4WD")
        for provider in (current, historical):
            self.assertTrue(all(query["drivetrain"] == "4WD" for query in provider.queries))
        for stream in ("current", "historical"):
            candidates = artifact.to_dict()["result"][f"{stream}Ranking"]["candidates"]
            self.assertTrue(all(not row["eligible"] and "DRIVETRAIN_MISMATCH" in row["reasons"] for row in candidates))

    def test_old_nine_round_trips_without_claiming_filtered_search(self):
        _, _, _, artifact = self.run_saved()
        legacy = artifact.to_dict()
        remove_discovery_provenance(legacy)
        legacy.update(analysisRunSchemaVersion="9", analysisVersion="9")
        before = canonical_json_bytes(legacy)
        restored = AnalysisRunArtifact.from_dict(legacy)
        self.assertEqual(canonical_json_bytes(restored.to_dict()), before)
        presentation = AnalysisPresentationProjector().project(restored).to_dict()
        self.assertEqual(presentation["presentationVersion"], "5")
        self.assertNotIn("drivetrainDiscovery", presentation["provenance"])
        legacy["request"]["currentSearchRequest"]["drivetrainDiscovery"] = {"version": "1", "status": "SUBJECT_DRIVETRAIN_UNKNOWN", "filterValue": None}
        with self.assertRaises(AnalysisRunContractError):
            validate_analysis_run_artifact(legacy)

    def test_new_artifact_requires_marker_and_rejects_changed_filter(self):
        artifact, _, _ = self.filtered_run()
        for mutation in ("missing", "changed"):
            data = artifact.to_dict()
            request = data["request"]["currentSearchRequest"]
            if mutation == "missing":
                del request["drivetrainDiscovery"]
            else:
                request["drivetrainDiscovery"]["filterValue"] = "4WD"
            with self.subTest(mutation=mutation):
                with self.assertRaises(AnalysisRunContractError):
                    validate_analysis_run_artifact(data)

    def test_dated_configuration_conflict_is_projected_as_an_excluded_issue(self):
        class ConflictingHistoricalProvider(FilteredHistoricalProvider):
            def search_historical(self, request):
                result = super().search_historical(request)
                excluded = result.evidence[0].listing
                return replace(result, evidence=result.evidence[1:], issues=(HistoricalEvidenceIssue(
                    status="UNRESOLVED", reason="VEHICLE_CONFIGURATION_CONFLICT",
                    vin=excluded.vin, source_listing_id=excluded.source_listing_id,
                ),))

        report = copy.deepcopy(make_run_request().ccc_report)
        report["vehicle"]["drivetrain"] = "FWD"
        artifact = make_orchestrator(
            self.repository(), current_provider=FilteredCurrentProvider(),
            historical_provider=ConflictingHistoricalProvider(),
        ).run(replace(make_run_request(), ccc_report=report)).artifact
        data = AnalysisPresentationProjector().project(artifact).to_dict()
        issue = next(item for item in data["evidenceDiagnostics"]["historicalIssues"] if item["reason"] == "VEHICLE_CONFIGURATION_CONFLICT")
        self.assertFalse(issue["pricesContributed"])
        self.assertEqual(issue["reasonLabel"], "Vehicle configuration conflict")
        self.assertTrue(all(row["vin"] != issue["vin"] for row in data["comparablesUsed"]["primary"] if row["evidenceBasis"] == "LOSS_DATE_HISTORICAL"))

    def test_presentation_discovery_is_versioned_immutable_and_matches_canonical_schema(self):
        artifact, _, _ = self.filtered_run()
        data = AnalysisPresentationProjector().project(artifact).to_dict()
        restored = AnalysisPresentation.from_dict(data)
        original = copy.deepcopy(data)
        data["provenance"]["drivetrainDiscovery"]["current"]["filterValue"] = "4WD"
        self.assertEqual(restored.to_dict(), original)
        with self.assertRaises(TypeError):
            restored.provenance["drivetrainDiscovery"]["current"]["filterValue"] = "4WD"
        del original["provenance"]["drivetrainDiscovery"]
        with self.assertRaises(AnalysisPresentationContractError):
            validate_analysis_presentation(original)
        schemas = Path(__file__).parents[1] / "schemas"
        canonical = json.loads((schemas / "market/search-request.schema.json").read_text())["$defs"]["drivetrainDiscovery"]
        embedded = json.loads((schemas / "analysis/analysis-presentation.schema.json").read_text())["$defs"]["drivetrainDiscovery"]
        self.assertEqual(embedded, {**canonical, "title": "DrivetrainDiscovery"})
