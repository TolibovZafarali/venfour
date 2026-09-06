"""Versioned qualification data projection without customer behavior changes."""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from tests.test_analysis_runs import (
    RecordingCurrentProvider,
    TemporaryRepositoryTestCase,
    make_orchestrator,
    make_run_request,
)
from venfour.analysis_runs import AnalysisRunArtifact
from venfour.presentation import (
    AnalysisPresentation,
    AnalysisPresentationContractError,
    AnalysisPresentationProjector,
    AnalysisPresentationService,
    validate_analysis_presentation,
)
from venfour.report_ingestion import (
    normalize_ccc_report,
    normalized_report_to_legacy_report,
)


class PreliminaryQualificationPresentationTests(TemporaryRepositoryTestCase):
    def new_presentation(self):
        repository, _, _, artifact = self.run_saved()
        return artifact, AnalysisPresentationService(repository).get(artifact.run_id)

    def test_new_run_projects_authoritative_qualification_without_recalculating(self):
        artifact, presentation = self.new_presentation()
        with patch(
            "venfour.preliminary_qualification.qualify_preliminary",
            side_effect=AssertionError("projection must not qualify the case again"),
        ):
            projected = AnalysisPresentationProjector().project(artifact)
        data = projected.to_dict()
        self.assertEqual(data, presentation.to_dict())
        self.assertEqual(data["presentationVersion"], "4")
        self.assertEqual(data["provenance"]["analysisRunSchemaVersion"], "8")
        self.assertEqual(
            data["preliminaryQualification"],
            artifact.to_dict()["result"]["preliminaryQualification"],
        )
        self.assertEqual(
            data["preliminaryQualification"]["marketClassification"],
            data["assessment"]["classification"],
        )

    def test_qualification_is_immutable_and_serializations_are_independent(self):
        _, presentation = self.new_presentation()
        data = presentation.to_dict()
        restored = AnalysisPresentation.from_dict(data)
        original = copy.deepcopy(data)
        data["preliminaryQualification"]["reasonCodes"].append("ALTERED")
        self.assertEqual(restored.to_dict(), original)
        self.assertEqual(presentation.to_dict(), original)
        with self.assertRaises(TypeError):
            restored.preliminary_qualification["outcome"] = "ALTERED"

    def test_qualification_version_presence_and_market_agreement_are_enforced(self):
        _, presentation = self.new_presentation()
        original = presentation.to_dict()
        mutations = []
        missing = copy.deepcopy(original)
        del missing["preliminaryQualification"]
        mutations.append(missing)
        for version in ("2", "3"):
            legacy = copy.deepcopy(original)
            legacy["presentationVersion"] = version
            legacy["provenance"]["presentationVersion"] = version
            legacy["provenance"]["analysisRunSchemaVersion"] = "7"
            mutations.append(legacy)
        wrong_market = copy.deepcopy(original)
        wrong_market["preliminaryQualification"]["marketClassification"] = (
            "POTENTIAL_UNDERVALUE"
        )
        mutations.append(wrong_market)
        unknown = copy.deepcopy(original)
        unknown["preliminaryQualification"]["futurePolicyField"] = True
        mutations.append(unknown)
        wrong_artifact_version = copy.deepcopy(original)
        wrong_artifact_version["provenance"]["analysisRunSchemaVersion"] = "7"
        mutations.append(wrong_artifact_version)
        for index, data in enumerate(mutations):
            with self.subTest(mutation=index):
                with self.assertRaises(AnalysisPresentationContractError):
                    validate_analysis_presentation(data)

    def test_legacy_run_keeps_original_projection_and_market_copy(self):
        artifact, presentation = self.new_presentation()
        legacy_data = artifact.to_dict()
        legacy_data["analysisRunSchemaVersion"] = "7"
        legacy_data["analysisVersion"] = "7"
        del legacy_data["request"]["qualificationSourceReport"]
        del legacy_data["result"]["preliminaryQualification"]
        legacy = AnalysisRunArtifact.from_dict(legacy_data)
        old = AnalysisPresentationProjector().project(legacy).to_dict()
        self.assertEqual(old["presentationVersion"], "2")
        self.assertNotIn("preliminaryQualification", old)
        current = presentation.to_dict()
        for key in current.keys() - {
            "presentationVersion", "provenance", "preliminaryQualification"
        }:
            with self.subTest(section=key):
                self.assertEqual(current[key], old[key])

    def test_original_golden_presentation_round_trips_without_qualification(self):
        fixture = Path(__file__).parent / "fixtures/analysis/analysis-presentation-material-undervalue.json"
        data = json.loads(fixture.read_text(encoding="utf-8"))
        self.assertEqual(data["presentationVersion"], "2")
        self.assertNotIn("preliminaryQualification", data)
        self.assertEqual(AnalysisPresentation.from_dict(data).to_dict(), data)

    def test_source_fidelity_presentation_v3_remains_readable_without_qualification(self):
        fixture = Path(__file__).parent / "fixtures/ccc/kona-source-fidelity-v2.json"
        report = normalized_report_to_legacy_report(
            normalize_ccc_report(json.loads(fixture.read_text()))
        )
        request = replace(
            make_run_request(current=True, historical=False),
            ccc_report=report,
            qualification_source_report=report,
        )
        artifact = make_orchestrator(
            self.repository("source-fidelity"),
            current_provider=RecordingCurrentProvider(()),
            historical_provider=None,
        ).run(request).artifact
        data = artifact.to_dict()
        data["analysisRunSchemaVersion"] = "7"
        data["analysisVersion"] = "7"
        del data["request"]["qualificationSourceReport"]
        del data["result"]["preliminaryQualification"]
        legacy = AnalysisRunArtifact.from_dict(data)
        presentation = AnalysisPresentationProjector().project(legacy).to_dict()
        self.assertEqual(presentation["presentationVersion"], "3")
        self.assertNotIn("preliminaryQualification", presentation)
        take = presentation["cccComparables"]["rows"][0]
        self.assertEqual(take["sourcePrice"]["type"], "TAKE")
        self.assertIsNone(take["advertisedPrice"]["cents"])
        self.assertEqual(AnalysisPresentation.from_dict(presentation).to_dict(), presentation)

    def test_embedded_qualification_schema_matches_authoritative_contract(self):
        schemas = Path(__file__).parents[1] / "schemas/analysis"
        source = json.loads((schemas / "preliminary-qualification.schema.json").read_text())
        presentation = json.loads((schemas / "analysis-presentation.schema.json").read_text())

        def definition_name(name):
            return "qualification" + name[0].upper() + name[1:]

        def rewrite(value):
            if isinstance(value, list):
                return [rewrite(item) for item in value]
            if isinstance(value, dict):
                return {
                    key: "#/$defs/" + definition_name(child[len("#/$defs/"):])
                    if key == "$ref" and isinstance(child, str) and child.startswith("#/$defs/")
                    else rewrite(child)
                    for key, child in value.items()
                }
            return value

        expected = rewrite({
            key: value for key, value in source.items()
            if key not in {"$schema", "$id", "$defs", "title"}
        })
        expected["title"] = "PreliminaryQualification"
        self.assertEqual(presentation["$defs"]["preliminaryQualification"], expected)
        for name, definition in source["$defs"].items():
            with self.subTest(definition=name):
                self.assertEqual(
                    presentation["$defs"][definition_name(name)], rewrite(definition)
                )
