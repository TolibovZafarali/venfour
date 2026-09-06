"""Offline persistence and replay checks for preliminary qualification inputs."""

from __future__ import annotations

import copy
import unittest
from dataclasses import replace

from tests.test_analysis_runs import (
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    TemporaryRepositoryTestCase,
    make_orchestrator,
    make_report,
    make_run_request,
)
from venfour.analysis_runs import (
    AnalysisRunArtifact,
    AnalysisRunContractError,
    canonical_json_bytes,
    validate_analysis_run_artifact,
)
from venfour.orchestration import AnalysisInputError, AnalysisRunRequest
from venfour.preliminary_qualification import qualify_preliminary


class AnalysisRunQualificationTests(TemporaryRepositoryTestCase):
    def run_request(self, request, child="runs"):
        return make_orchestrator(
            self.repository(child),
            current_provider=RecordingCurrentProvider(),
            historical_provider=RecordingHistoricalProvider(),
        ).run(request).artifact.to_dict()

    def test_source_and_result_are_saved_and_replayed_without_external_state(self):
        report = make_report()
        request = replace(make_run_request(), qualification_source_report=report)
        report["valuation"]["baseVehicleValue"] = 1
        artifact = self.run_request(request)
        stored_source = artifact["request"]["qualificationSourceReport"]
        self.assertEqual(stored_source, make_report())
        self.assertEqual(artifact["analysisRunSchemaVersion"], "8")
        qualification = artifact["result"]["preliminaryQualification"]
        self.assertEqual(qualification["qualificationVersion"], "1")
        self.assertEqual(
            qualification,
            qualify_preliminary(
                source_report=stored_source,
                evidence_context=artifact["evidenceContext"],
                discrepancy_request=artifact["result"]["discrepancyRequest"],
                discrepancy_result=artifact["result"]["discrepancyResult"],
                current_ranking=artifact["result"]["currentRanking"],
                historical_ranking=artifact["result"]["historicalRanking"],
            ),
        )
        self.assertEqual(
            self.repository().get(artifact["runId"]).to_dict(), artifact
        )

    def test_unspecified_direct_report_source_differs_from_explicitly_unavailable(self):
        default_request = make_run_request()
        self.assertEqual(default_request.qualification_source_report, make_report())
        unavailable = self.run_request(
            replace(default_request, qualification_source_report=None)
        )
        self.assertIsNone(unavailable["request"]["qualificationSourceReport"])
        validate_analysis_run_artifact(unavailable)

    def test_manual_default_does_not_treat_synthetic_projection_as_report(self):
        context = {
            "inputMode": "MANUAL",
            "reportAvailable": False,
            "reportExtractionAvailable": False,
            "reportProvider": None,
            "reportAdapter": None,
            "partialExtraction": False,
            "offerAvailable": True,
            "insurerValuationAvailable": False,
            "reportComparablesAvailable": False,
            "reportAdjustmentsAvailable": False,
            "conditionInformationAvailable": False,
            "optionsInformationAvailable": False,
            "conditionAndOptionsDollarAdjusted": False,
        }
        request = AnalysisRunRequest(ccc_report=make_report(), evidence_context=context)
        self.assertIsNone(request.qualification_source_report)

    def test_qualification_source_changes_have_a_separate_digest_from_market_inputs(self):
        original = self.run_request(make_run_request(), "original")
        source = make_report()
        source["vehicle"]["equipment"].append("Additional source equipment")
        changed = self.run_request(
            replace(make_run_request(), qualification_source_report=source), "changed"
        )
        self.assertEqual(original["requestDigest"], changed["requestDigest"])
        self.assertEqual(
            original["searchDiagnosticsDigest"], changed["searchDiagnosticsDigest"]
        )
        self.assertNotEqual(
            original["result"]["preliminaryQualification"]["inputDigest"],
            changed["result"]["preliminaryQualification"]["inputDigest"],
        )
        self.assertEqual(
            original["result"]["discrepancyResult"],
            changed["result"]["discrepancyResult"],
        )

    def test_replay_rejects_modified_source_context_or_qualification(self):
        artifact = self.run_request(make_run_request())
        for field in ("source", "context", "result"):
            with self.subTest(field=field):
                changed = copy.deepcopy(artifact)
                if field == "source":
                    changed["request"]["qualificationSourceReport"]["vehicle"][
                        "equipment"
                    ].append("Additional source equipment")
                elif field == "context":
                    changed["evidenceContext"]["partialExtraction"] = True
                else:
                    changed["result"]["preliminaryQualification"]["inputDigest"] = "0" * 64
                with self.assertRaises(AnalysisRunContractError):
                    validate_analysis_run_artifact(changed)

    def test_invalid_source_fails_before_provider_retrieval(self):
        current = RecordingCurrentProvider()
        historical = RecordingHistoricalProvider()
        with self.assertRaises(AnalysisInputError):
            make_orchestrator(
                self.repository(), current_provider=current,
                historical_provider=historical,
            ).run(replace(make_run_request(), qualification_source_report={}))
        self.assertEqual(current.requests, [])
        self.assertEqual(historical.requests, [])

    def test_legacy_seven_round_trip_keeps_original_bytes_and_omits_qualification(self):
        artifact = self.run_request(make_run_request())
        legacy = copy.deepcopy(artifact)
        legacy["analysisRunSchemaVersion"] = "7"
        legacy["analysisVersion"] = "7"
        del legacy["request"]["qualificationSourceReport"]
        del legacy["result"]["preliminaryQualification"]
        before = canonical_json_bytes(legacy)
        replayed = AnalysisRunArtifact.from_dict(legacy).to_dict()
        self.assertEqual(canonical_json_bytes(replayed), before)
        self.assertEqual(replayed["requestDigest"], artifact["requestDigest"])
        self.assertEqual(
            replayed["searchDiagnosticsDigest"], artifact["searchDiagnosticsDigest"]
        )
        self.assertNotIn("preliminaryQualification", replayed["result"])
        legacy["result"]["preliminaryQualification"] = artifact["result"][
            "preliminaryQualification"
        ]
        with self.assertRaises(AnalysisRunContractError):
            validate_analysis_run_artifact(legacy)


if __name__ == "__main__":
    unittest.main()
