"""Confirmed configuration enters matching without rewriting source extraction."""

import copy
import unittest
from unittest.mock import patch, sentinel

from tests.test_valuation_inputs import snapshot
from tests.test_ccc_evidence import source_fixture
from venfour.creation import AnalysisCreationService
from venfour.report_ingestion import normalize_ccc_report, validate_effective_report
from venfour.valuation_inputs import empty_normalized_report


class ConfirmedConfigurationEvidenceTests(unittest.TestCase):
    def project(self, value, normalized=None):
        service = AnalysisCreationService(lambda _: None)
        with patch.object(service, "_run_legacy_report", return_value=sentinel.run) as run:
            result = service.create_from_confirmed_input(
                value, normalized_report=normalized,
            )
        self.assertIs(result, sentinel.run)
        return run.call_args.args[0]

    def test_explicit_provider_version_supplies_drivetrain_with_origin(self):
        report = self.project(snapshot(vehicle_configuration={
            "source": "marketcheck", "field": "version",
            "values": ["SE FWD", "SE Front Wheel Drive"],
        }))
        self.assertEqual(report["vehicle"]["drivetrain"], "FWD")
        source = report["vehicle"]["drivetrainSource"]
        self.assertIsNone(source["page"])
        self.assertEqual(source["section"], "Customer-confirmed provider configuration")
        self.assertIn("SE Front Wheel Drive", source["text"])
        self.assertEqual(report["comparables"], [])

    def test_display_trim_or_ambiguous_version_does_not_infer_drivetrain(self):
        for configuration in (
            None,
            {"source": "marketcheck", "field": "trim", "values": ["SE AWD"]},
            {"source": "other", "field": "version", "values": ["SE AWD"]},
            {"source": "marketcheck", "field": "version", "values": ["SE AWD", "SE"]},
            {"source": "marketcheck", "field": "version", "values": ["SE AWD", "SE FWD"]},
        ):
            with self.subTest(configuration=configuration):
                report = self.project(snapshot(
                    vehicle_trim="SE AWD", vehicle_configuration=configuration,
                ))
                self.assertNotIn("drivetrain", report["vehicle"])

    def test_confirmed_configuration_does_not_rewrite_old_extraction(self):
        extracted = empty_normalized_report()
        extracted["report"].update(provider="CCC", providerId="CCC")
        before = copy.deepcopy(extracted)
        report = self.project(snapshot(
            intake_mode="report",
            vehicle_configuration={
                "source": "marketcheck", "field": "version", "values": ["SE AWD"],
            },
        ), extracted)
        self.assertEqual(report["vehicle"]["drivetrain"], "AWD")
        self.assertEqual(extracted, before)
        self.assertEqual(extracted["schemaVersion"], "1")
        self.assertNotIn("drivetrain", extracted["vehicle"])

    def test_confirmed_drive_preserves_source_v2_and_labels_effective_provenance(self):
        extracted = normalize_ccc_report(source_fixture())
        before = copy.deepcopy(extracted)
        for drive in ("FWD", "AWD"):
            with self.subTest(drive=drive):
                report = self.project(snapshot(
                    intake_mode="report",
                    vehicle_configuration={
                        "source": "marketcheck", "field": "version", "values": [f"SE {drive}"],
                    },
                ), extracted)
                validate_effective_report(report)
                self.assertEqual(report["vehicle"]["drivetrain"], drive)
                check = next(row for row in report["evidence"]["fieldChecks"] if row["path"] == "vehicle.drivetrain")
                self.assertEqual(check["status"], "CAPTURED")
                self.assertEqual(check["sourceReferences"], [report["vehicle"]["drivetrainSource"]])
                self.assertIsNone(check["sourceReferences"][0]["page"])
                self.assertEqual(extracted, before)
                self.assertEqual(extracted["vehicle"]["drivetrain"], "FWD")


if __name__ == "__main__":
    unittest.main()
