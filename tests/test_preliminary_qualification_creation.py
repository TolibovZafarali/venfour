"""Qualification reviews source facts without changing customer comparison inputs."""

import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch, sentinel

from tests.test_ccc_evidence import source_fixture
from tests.test_valuation_inputs import snapshot
from venfour.analysis import analyze_report
from venfour.creation import AnalysisCreationService
from venfour.report_ingestion import normalize_ccc_report, validate_effective_report


class PreliminaryQualificationCreationTests(unittest.TestCase):
    def test_customer_offer_and_configuration_do_not_rewrite_report_checks(self):
        normalized = normalize_ccc_report(source_fixture())
        before = copy.deepcopy(normalized)
        service = AnalysisCreationService(lambda _: None)
        with patch.object(service, "_run_legacy_report", return_value=sentinel.run) as run:
            service.create_from_confirmed_input(snapshot(
                intake_mode="report", insurer_vehicle_valuation=19000,
                mileage_at_loss=50000,
                vehicle_configuration={
                    "source": "marketcheck", "field": "version", "values": ["SE AWD"],
                },
            ), normalized_report=normalized, report_adapter="CCC")
        effective = run.call_args.args[0]
        source = run.call_args.kwargs["qualification_source_report"]
        self.assertEqual(effective["valuation"]["adjustedVehicleValue"], 19000)
        self.assertEqual(effective["vehicle"]["drivetrain"], "AWD")
        self.assertEqual(effective["vehicle"]["mileage"], 50000)
        self.assertEqual(source["valuation"]["adjustedVehicleValue"], before["valuation"]["adjustedVehicleValue"])
        self.assertEqual(source["vehicle"]["drivetrain"], "FWD")
        self.assertEqual(source["vehicle"]["mileage"], before["vehicle"]["mileage"])
        validate_effective_report(source)
        self.assertEqual(analyze_report(source)["metrics"]["valuationArithmetic"]["status"], "reconciled")
        self.assertEqual(normalized, before)

    def test_manual_and_unextracted_report_have_no_report_audit_source(self):
        service = AnalysisCreationService(lambda _: None)
        for mode in ("manual", "report"):
            with self.subTest(mode=mode), patch.object(service, "_run_legacy_report", return_value=sentinel.run) as run:
                service.create_from_confirmed_input(snapshot(intake_mode=mode))
            self.assertIsNone(run.call_args.kwargs["qualification_source_report"])

    def test_ingested_offer_does_not_replace_printed_arithmetic_source(self):
        normalized = normalize_ccc_report(source_fixture())
        normalized["valuation"]["insurerOffer"] = 18000
        before = copy.deepcopy(normalized)
        ingestion = SimpleNamespace(
            normalized_report=normalized, provider="CCC", adapter="CCC", partial=True,
            to_dict=lambda: {"normalizedReport": copy.deepcopy(normalized)},
        )
        service = AnalysisCreationService(
            lambda _: None, ingestion_service=SimpleNamespace(ingest=lambda _: ingestion),
        )
        with patch.object(service, "_run_legacy_report", return_value=sentinel.run) as run:
            service.create("unused-fixture.pdf", "63123")
        self.assertEqual(run.call_args.args[0]["valuation"]["adjustedVehicleValue"], 18000)
        source = run.call_args.kwargs["qualification_source_report"]
        self.assertEqual(source["valuation"]["adjustedVehicleValue"], before["valuation"]["adjustedVehicleValue"])
        self.assertEqual(normalized, before)


if __name__ == "__main__":
    unittest.main()
