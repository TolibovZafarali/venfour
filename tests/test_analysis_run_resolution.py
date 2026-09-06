"""Resolution-stage persistence, source preservation, and offline replay."""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from unittest.mock import patch

from tests.test_analysis_runs import (
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    TemporaryRepositoryTestCase,
    make_orchestrator,
    make_run_request,
)
from venfour.analysis_runs import (
    AnalysisRunArtifact,
    AnalysisRunContractError,
    canonical_json_bytes,
    validate_analysis_run_artifact,
)
from venfour.marketcheck import MarketCheckProvider
from venfour.presentation import AnalysisPresentationProjector, AnalysisPresentationService


def comparable_vin(index):
    return f"1HGBH41JXMN10{index:04d}"


class CurrentProvider(RecordingCurrentProvider):
    def search(self, request):
        result = super().search(request)
        return replace(result, listings=tuple(
            replace(row, vin=comparable_vin(index), drivetrain=None, drivetrain_recorded=True)
            for index, row in enumerate(result.listings, 1)
        ))


class HistoricalProvider(RecordingHistoricalProvider):
    def search_historical(self, request):
        result = super().search_historical(request)
        return replace(result, evidence=tuple(
            replace(item, listing=replace(item.listing, vin=comparable_vin(index), drivetrain=None, drivetrain_recorded=True))
            for index, item in enumerate(result.evidence, 1)
        ))


class SpecificationTransport:
    def __init__(self, drivetrain):
        self.drivetrain = drivetrain
        self.calls = []

    def get(self, endpoint, params, headers, timeout):
        self.calls.append({"endpoint": endpoint, "vin": params["vin"], "timeout": timeout})
        return json.dumps({"num_found": 1, "listings": [{
            "id": f"listing-{params['vin']}", "vin": params["vin"],
            "build": {"year": 2024, "make": "Synthetic", "model": "Sedan", "drivetrain": self.drivetrain},
        }]}).encode()


class AnalysisRunResolutionTests(TemporaryRepositoryTestCase):
    def resolved_run(self, *, drive="FWD", offer=20_000, child="runs"):
        repository = self.repository(child)
        current, historical = CurrentProvider(), HistoricalProvider()
        transport = SpecificationTransport(drive)
        provider = MarketCheckProvider("specification-test-key", transport=transport)
        request = make_run_request()
        report = copy.deepcopy(request.ccc_report)
        report["vehicle"]["drivetrain"] = "FWD"
        report["valuation"]["adjustedVehicleValue"] = offer
        orchestrator = make_orchestrator(
            repository, current_provider=current, historical_provider=historical,
            resolution_lookup=provider.lookup_drivetrain,
        )
        with patch("venfour.marketcheck._lookup_time", return_value="2026-09-05T12:00:00Z"):
            artifact = orchestrator.run(replace(request, ccc_report=report)).artifact
        return repository, current, historical, transport, artifact

    def test_enrichment_preserves_raw_search_and_projects_resolved_historical_lifecycle(self):
        repository, current, historical, transport, artifact = self.resolved_run()
        data = artifact.to_dict()
        self.assertEqual(data["analysisRunSchemaVersion"], "9")
        for row in data["result"]["currentMarketResult"]["listings"]:
            self.assertIsNone(row["drivetrain"])
        for item in data["result"]["historicalMarketResult"]["evidence"]:
            self.assertIsNone(item["listing"]["drivetrain"])
        for stream in ("current", "historical"):
            candidates = data["result"][f"{stream}Ranking"]["candidates"]
            self.assertTrue(all(row["listing"]["drivetrain"] == "FWD" for row in candidates))
            self.assertTrue(all(row["eligible"] for row in candidates))
        self.assertEqual(len(transport.calls), 5)
        counts = (len(current.requests), len(historical.requests), len(transport.calls))
        with patch.object(MarketCheckProvider, "lookup_drivetrain", side_effect=AssertionError("replay cannot call a provider")):
            restored = repository.get(artifact.run_id)
            presentation = AnalysisPresentationService(repository).get(artifact.run_id).to_dict()
        self.assertEqual(restored.to_dict(), data)
        self.assertEqual(presentation["presentationVersion"], "5")
        self.assertEqual(presentation["preliminaryResolution"], data["result"]["preliminaryResolution"])
        self.assertTrue(all(row["lifecycleEvidence"] is not None for row in presentation["comparablesUsed"]["primary"]))
        self.assertEqual(counts, (len(current.requests), len(historical.requests), len(transport.calls)))

    def test_known_conflicts_change_eligibility_without_rewriting_prices(self):
        _, _, _, _, artifact = self.resolved_run(drive="AWD")
        data = artifact.to_dict()
        for stream in ("current", "historical"):
            ranked = data["result"][f"{stream}Ranking"]["candidates"]
            self.assertTrue(all(not row["eligible"] for row in ranked))
            self.assertTrue(all("DRIVETRAIN_MISMATCH" in row["reasons"] for row in ranked))
        raw_prices = {row["vin"]: row["price"] for row in data["result"]["currentMarketResult"]["listings"]}
        final_prices = {row["listing"]["vin"]: row["listing"]["price"] for row in data["result"]["currentRanking"]["candidates"]}
        self.assertEqual(raw_prices, final_prices)
        self.assertEqual(data["result"]["preliminaryQualification"]["outcome"], "IMPORTANT_INFORMATION_NEEDED")
        validate_analysis_run_artifact(data)

    def test_insurer_amount_does_not_change_resolution_calls_or_underlying_evidence(self):
        outputs = [self.resolved_run(offer=offer, child=f"offer-{offer}") for offer in (10_000, 20_000, 30_000)]
        first = outputs[0][4].to_dict()
        for _, current, historical, transport, artifact in outputs[1:]:
            data = artifact.to_dict()
            self.assertEqual(transport.calls, outputs[0][3].calls)
            self.assertEqual(current.requests, outputs[0][1].requests)
            self.assertEqual(historical.requests, outputs[0][2].requests)
            for field in ("currentMarketResult", "historicalMarketResult", "currentRanking", "historicalRanking", "searchDiagnostics"):
                self.assertEqual(data["result"][field], first["result"][field])
            for field in ("attempts", "evidenceUpdates", "budget"):
                self.assertEqual(data["result"]["preliminaryResolution"][field], first["result"]["preliminaryResolution"][field])

    def test_replay_rejects_unsupported_overlay_raw_evidence_and_resolution_tampering(self):
        _, _, _, _, artifact = self.resolved_run()
        original = artifact.to_dict()
        for target in ("lookup", "overlay", "raw", "ledger"):
            with self.subTest(target=target):
                data = copy.deepcopy(original)
                if target == "lookup":
                    attempt = next(row for row in data["result"]["preliminaryResolution"]["attempts"] if row["lookupResult"] is not None)
                    attempt["lookupResult"]["drivetrain"] = "AWD"
                elif target == "overlay":
                    data["result"]["currentRanking"]["candidates"][0]["listing"]["price"] += 1
                elif target == "raw":
                    data["result"]["currentMarketResult"]["listings"][0]["drivetrain"] = "FWD"
                else:
                    data["result"]["preliminaryResolution"]["evidenceUpdates"] = []
                with self.assertRaises(AnalysisRunContractError):
                    validate_analysis_run_artifact(data)

    def test_legacy_eight_remains_byte_identical_and_projects_version_four(self):
        _, _, _, artifact = self.run_saved()
        legacy = artifact.to_dict()
        legacy["analysisRunSchemaVersion"] = "8"
        legacy["analysisVersion"] = "8"
        del legacy["result"]["preliminaryResolution"]
        before = canonical_json_bytes(legacy)
        restored = AnalysisRunArtifact.from_dict(legacy)
        self.assertEqual(canonical_json_bytes(restored.to_dict()), before)
        presentation = AnalysisPresentationProjector().project(restored).to_dict()
        self.assertEqual(presentation["presentationVersion"], "4")
        self.assertNotIn("preliminaryResolution", presentation)
