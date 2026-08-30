"""Deferred report evidence survives analysis and remains source-grounded."""
import copy
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from tests.test_analysis_runs import (
    TemporaryRepositoryTestCase, make_orchestrator, RecordingCurrentProvider,
    RecordingHistoricalProvider, CURRENT_OBSERVED_DATE, POSTAL_CODE,
)
from tests.test_case_analyses import FakeCaseGateway, USER_ID, JOB_ID, TOKEN_ID
from tests import test_package_assessment as package_fixtures
from venfour.case_analyses import SupabaseAnalysisRunRepository
from venfour.creation import AnalysisCreationService
from venfour.analysis_runs import AnalysisRunWriteError
from venfour.package_processing import DeterministicPackageAssessmentBuilder, PackageProcessingContractError
from venfour.report_evidence import validate_report_evidence_for_artifact
from venfour.report_ingestion import ReportIngestionResult
from venfour.supabase_gateway import SupabaseUnavailableError
from venfour.valuation_evidence_report import build_valuation_evidence_report_v1, INSURER_EXTRACTED
from scripts.recover_local_report_package import local_status


def ingestion_from_source(source):
    extraction = source["extraction"]
    return ReportIngestionResult.from_dict({
        "schemaVersion": extraction["wrapperSchemaVersion"],
        **{key: extraction[key] for key in (
            "adapter", "provider", "providerId", "confidence", "partial", "warnings",
            "missingRequiredFields", "model", "normalizedReport", "documentSha256",
        )},
    })


class ReportEvidenceTests(TemporaryRepositoryTestCase):
    def setUp(self):
        super().setUp()
        _, _, self.artifact, source = package_fixtures.PackageAssessmentTests._source(self)
        self.source = source.to_dict()
        self.ingestion = ingestion_from_source(self.source)

    def context(self):
        source = self.source
        lineage = source["lineage"]
        return {
            **{target: lineage[key] for target, key in (
                ("case_id", "caseId"), ("package_job_id", "packageJobId"),
                ("entitlement_id", "entitlementId"), ("preliminary_snapshot_id", "preliminarySnapshotId"),
                ("source_snapshot_id", "sourceSnapshotId"), ("analysis_job_id", "analysisJobId"),
                ("analysis_run_id", "analysisRunId"), ("owner_user_id", "ownerUserIdAtCreation"),
                ("product_identifier", "productIdentifier"), ("product_version", "productVersion"),
            )},
            "source_intake_mode": "report", "source_analysis_input_revision": 3,
            "source_analysis_input_id": source["input"]["analysisInputId"],
            "confirmed_facts": {"postal_code": source["input"]["confirmedFacts"]["postalCode"],
                                "intake_completed_at": "2026-08-20T10:30:00Z"},
            "normalized_extraction": self.ingestion.to_dict(), "extraction_schema_version": "1",
            "extraction_extracted_at": source["extraction"]["extractedAt"],
            "analysis_artifact": self.artifact.to_dict(),
            "preliminary_snapshot": source["preliminary"]["snapshot"],
            "preliminary_snapshot_digest": source["preliminary"]["snapshotDigest"],
            "preliminary_snapshot_schema_version": "1",
        }

    def test_deferred_report_builds_without_fabricating_customer_facts(self):
        context = self.context()
        original = copy.deepcopy(context["confirmed_facts"])
        builder = DeterministicPackageAssessmentBuilder(clock=lambda: datetime(2026, 8, 26, tzinfo=timezone.utc))
        snapshot = builder.build_source_snapshot(context, self.source["sourceDocument"]).to_dict()
        self.assertEqual(context["confirmed_facts"], original)
        self.assertEqual(snapshot["input"]["confirmedFacts"]["year"], self.source["input"]["confirmedFacts"]["year"])
        self.assertIsNone(snapshot["input"]["confirmedFacts"]["vin"])
        self.assertIsNone(snapshot["input"]["confirmedFacts"]["insurerName"])
        self.assertIn("REPORT_INPUT_FACTS_DERIVED_FROM_IMMUTABLE_ANALYSIS", snapshot["validationManifest"]["limitations"])
        assessment = builder.build_final_assessment(snapshot)
        self.assertEqual(assessment.to_dict()["continuationStatus"], "SUPPORTS_CONTINUATION")

    def test_changed_insurer_evidence_cannot_be_attached_to_the_original_result(self):
        validate_report_evidence_for_artifact(self.ingestion, self.artifact.to_dict())
        for field in ("mileage", "year"):
            changed = self.ingestion.to_dict()
            changed["normalizedReport"]["vehicle"][field] += 1
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_report_evidence_for_artifact(ReportIngestionResult.from_dict(changed), self.artifact.to_dict())

    def test_report_insurer_is_not_labeled_as_customer_supplied(self):
        context = self.context()
        context["normalized_extraction"]["normalizedReport"]["report"]["insurer"] = "Example Insurance"
        builder = DeterministicPackageAssessmentBuilder(clock=lambda: datetime(2026, 8, 26, tzinfo=timezone.utc))
        source = builder.build_source_snapshot(context, self.source["sourceDocument"])
        report = build_valuation_evidence_report_v1(
            source_snapshot=source, final_assessment=builder.build_final_assessment(source),
            report_series_id="00000000-0000-4000-8000-000000000131",
            report_version_id="00000000-0000-4000-8000-000000000132",
            final_assessment_id="00000000-0000-4000-8000-000000000133",
            version_number=1, generated_at="2026-08-26T20:00:00Z",
        ).to_dict()
        name = report["insurerValuationReviewed"]["insurerName"]
        self.assertEqual(name["value"], "Example Insurance")
        self.assertEqual(name["evidenceLabel"], INSURER_EXTRACTED)
        self.assertTrue(name["evidenceIds"])

    def test_owned_repository_saves_analysis_and_evidence_atomically(self):
        gateway = FakeCaseGateway()
        gateway.complete_total_loss_report_analysis = Mock(return_value=True)
        repository = SupabaseAnalysisRunRepository(gateway, USER_ID, job_id=JOB_ID, processing_token=TOKEN_ID)
        repository.record_report_ingestion(self.ingestion)
        repository.save(self.artifact)
        gateway.complete_total_loss_report_analysis.assert_called_once_with(
            JOB_ID, TOKEN_ID, self.artifact.run_id, self.artifact.to_dict(), self.ingestion.to_dict(),
        )
        self.assertEqual(repository.completed_run_id, self.artifact.run_id)

    def test_uploaded_analysis_records_evidence_before_its_real_orchestration_completes(self):
        gateway = FakeCaseGateway()
        gateway.complete_total_loss_report_analysis = Mock(return_value=True)
        repository = SupabaseAnalysisRunRepository(gateway, USER_ID, job_id=JOB_ID, processing_token=TOKEN_ID)
        service = AnalysisCreationService(
            lambda _date: make_orchestrator(repository,
                current_provider=RecordingCurrentProvider(), historical_provider=RecordingHistoricalProvider()),
            ingestion_service=Mock(ingest=Mock(return_value=self.ingestion)),
            report_ingestion_recorder=repository.record_report_ingestion,
            date_factory=lambda: date.fromisoformat(CURRENT_OBSERVED_DATE),
        )
        result = service.create(Path("synthetic-report.pdf"), POSTAL_CODE)
        args = gateway.complete_total_loss_report_analysis.call_args.args
        self.assertEqual(args[3], result.artifact.to_dict())
        self.assertEqual(args[4], self.ingestion.to_dict())
        self.assertEqual(gateway.completions, [])

    def test_ambiguous_completion_requires_both_saved_artifact_and_exact_evidence(self):
        gateway = FakeCaseGateway()
        gateway.artifacts[(USER_ID, self.artifact.run_id)] = self.artifact.to_dict()
        gateway.complete_total_loss_report_analysis = Mock(side_effect=SupabaseUnavailableError("connection lost"))
        for evidence in (None, {"different": True}, self.ingestion.to_dict()):
            with self.subTest(evidence_present=evidence is not None):
                gateway.get_owned_total_loss_report_evidence = Mock(return_value=evidence)
                repository = SupabaseAnalysisRunRepository(gateway, USER_ID, job_id=JOB_ID, processing_token=TOKEN_ID)
                repository.record_report_ingestion(self.ingestion)
                if evidence == self.ingestion.to_dict():
                    repository.save(self.artifact)
                    self.assertEqual(repository.completed_run_id, self.artifact.run_id)
                else:
                    with self.assertRaises(AnalysisRunWriteError):
                        repository.save(self.artifact)

    def test_invalid_report_evidence_is_a_lineage_failure_not_an_operational_retry(self):
        context = self.context()
        context["normalized_extraction"]["normalizedReport"]["vehicle"]["year"] += 1
        with self.assertRaises(PackageProcessingContractError):
            DeterministicPackageAssessmentBuilder().build_source_snapshot(context, self.source["sourceDocument"])


class LocalReportRecoverySafetyTests(unittest.TestCase):
    def test_unsafe_configuration_is_rejected_before_reading_local_status(self):
        for override in (
            {"VENFOUR_LOCAL_FULL_FLOW": "0"},
            {"VENFOUR_LOCAL_POST_CONTINUE": "1"},
            {"K_SERVICE": "deployed"},
            {"SUPABASE_URL": "https://remote.example.test"},
            {"VENFOUR_PUBLIC_APP_ORIGIN": "https://remote.example.test"},
            {"STRIPE_SECRET_KEY": "sk_" + "live_" + "fixture"},
        ):
            with self.subTest(override=override), patch("scripts.recover_local_report_package.subprocess.run") as command:
                with self.assertRaises(ValueError):
                    local_status({"VENFOUR_LOCAL_FULL_FLOW": "1", **override})
                command.assert_not_called()

    def test_remote_database_returned_by_status_is_rejected(self):
        status = '{"API_URL":"http://127.0.0.1:54321","DB_URL":"postgresql://remote.example.test:54322/postgres"}'
        with patch("scripts.recover_local_report_package.subprocess.run", return_value=Mock(stdout=status)):
            with self.assertRaises(ValueError):
                local_status({"VENFOUR_LOCAL_FULL_FLOW": "1"})
