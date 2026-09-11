"""Incomplete customer facts must not reach a metered search boundary."""

import copy
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from dataclasses import replace

from venfour.subject_readiness import SubjectReadinessError, confirmed_subject_readiness, subject_readiness
from venfour.valuation_inputs import ConfirmedValuationInput, apply_confirmed_vehicle_facts, confirmed_normalized_report
from venfour.report_ingestion import normalized_report_to_legacy_report, validate_effective_report, normalize_ccc_report
from venfour.discrepancy import valuation_discrepancy_request_from_report
from venfour.efficient_search import EfficientMarketSearch, subject_material_facts
from venfour.case_analyses import CaseAnalysisService
from tests.test_case_analyses import CASE_ID, USER_ID, INPUT_ID, FakeCaseGateway
from tests.test_ccc_evidence import source_fixture
from tests import test_efficient_search as search_fixtures
from tests.test_efficient_search import FixtureTransport, SUBJECT_FACTS, candidate


CANARY = json.loads((Path(__file__).parent / "fixtures/incomplete_manual_canary.json").read_text())
COMPLETE = {**CANARY, "vehicle_facts": {**SUBJECT_FACTS, "drivetrain": "FWD"}}


class SubjectReadinessTests(unittest.TestCase):
    def test_actual_incomplete_manual_intake_has_exact_actionable_fields(self):
        result = confirmed_subject_readiness(CANARY)
        self.assertFalse(result["ready"])
        self.assertEqual({row["field"] for row in result["issues"]},
                         {"drivetrain", "bodyType", "engine", "fuelType", "transmission"})
        self.assertTrue(all(row["correctionStep"] == "vehicle" for row in result["issues"]))

    def test_owned_submit_and_resume_stop_before_claim_or_factory(self):
        gateway = FakeCaseGateway()
        gateway.get_total_loss_analysis_status = Mock()
        gateway.claim_total_loss_analysis = Mock()
        gateway.fail_total_loss_analysis = Mock()
        gateway.get_total_loss_analysis_status.return_value = {
            "outcome": "not_submitted", "input_snapshot": {**CANARY, "vehicle_trim": "Other/Not sure", "analysis_input_id": INPUT_ID},
        }
        factory = Mock(side_effect=AssertionError("No provider construction"))
        service = CaseAnalysisService(gateway, creation_service_factory=factory)
        before = copy.deepcopy(CANARY)
        for action in (service.status, service.submit, service.submit):
            response = action(CASE_ID, USER_ID).to_dict()
            self.assertEqual(response["status"], "failed")
            self.assertEqual(response["attemptCount"], 0)
            self.assertFalse(response["subjectReadiness"]["ready"])
            self.assertEqual(response["subjectReadiness"]["correctionMode"], "resume")
        gateway.claim_total_loss_analysis.assert_not_called()
        gateway.fail_total_loss_analysis.assert_not_called()
        factory.assert_not_called()
        self.assertEqual(CANARY, before)

    def test_actual_subject_stops_before_any_budget_or_transport_method(self):
        confirmed = ConfirmedValuationInput.from_snapshot(CANARY)
        report = normalized_report_to_legacy_report(confirmed_normalized_report(confirmed))
        target = valuation_discrepancy_request_from_report(report, postal_code=confirmed.postal_code).loss_vehicle
        budget = Mock()
        provider = Mock()
        engine = EfficientMarketSearch(current_provider=provider, historical_provider=provider, budget=budget)
        with self.assertRaises(SubjectReadinessError):
            engine.run(target=target, current_request=None, historical_request=None,
                       observed_date="2026-09-11", subject_facts=subject_material_facts(report))
        self.assertEqual(budget.mock_calls, [])
        self.assertEqual(provider.mock_calls, [])

    def test_complete_manual_does_not_require_vin_offer_or_optional_metadata(self):
        result = confirmed_subject_readiness({**COMPLETE, "vin": None, "insurer_vehicle_valuation": None,
                                              "vehicle_condition": None, "vehicle_options_packages": None})
        self.assertEqual(result, {"ready": True, "issues": []})

    def test_free_estimate_accepts_unknown_specs_and_keeps_full_review_strict(self):
        self.assertEqual(confirmed_subject_readiness(CANARY, stage="free_estimate"), {"ready": True, "issues": []})
        self.assertFalse(confirmed_subject_readiness(CANARY)["ready"])
        conflict = {**COMPLETE, "vehicle_facts": {**COMPLETE["vehicle_facts"], "doors": "2"}}
        self.assertEqual([i["field"] for i in confirmed_subject_readiness(conflict, stage="free_estimate")["issues"]], ["doors"])

    def test_discovered_material_variants_require_one_targeted_fact(self):
        from venfour.subject_readiness import free_estimate_ambiguity
        from tests.test_comparable_evidence import observation
        rows = [observation(i) for i in range(4)]
        for row in rows[2:]:
            row["materialFacts"]["fuelType"] = "Electric"
        self.assertEqual([i["field"] for i in free_estimate_ambiguity({}, rows)], ["fuelType"])
        self.assertEqual(free_estimate_ambiguity({}, rows[:3]), [])
        self.assertEqual(free_estimate_ambiguity({"fuelType": "Gasoline"}, rows), [])

    def test_truck_needs_cab_and_bed_but_a_sedan_does_not(self):
        value = {**COMPLETE, "vehicle_facts": {**COMPLETE["vehicle_facts"], "bodyType": "Pickup"}}
        self.assertEqual({row["field"] for row in confirmed_subject_readiness(value)["issues"]}, {"cabType", "bedLength"})

    def test_generic_powertrain_label_cannot_replace_engine_facts(self):
        value = {**COMPLETE, "vehicle_facts": {"bodyType": "Sedan", "drivetrain": "FWD", "powertrain": "ICE"}}
        self.assertEqual({row["field"] for row in confirmed_subject_readiness(value)["issues"]}, {"engine", "fuelType", "transmission"})

    def test_unknown_trim_and_internal_conflicts_are_rejected(self):
        for changes, field in (({"vehicle_trim": "Other/Not sure"}, "trim"),
                               ({"vehicle_facts": {**COMPLETE["vehicle_facts"], "cylinders": "6"}}, "cylinders"),
                               ({"vehicle_facts": {**COMPLETE["vehicle_facts"], "doors": "2"}}, "doors"),
                               ({"vehicle_configuration": {"source": "marketcheck", "field": "version", "values": ["SEL AWD"]}}, "drivetrain")):
            with self.subTest(field=field):
                self.assertIn(field, {row["field"] for row in confirmed_subject_readiness({**COMPLETE, **changes})["issues"]})

    def test_complete_subject_reaches_adaptive_discovery_with_mock_transport(self):
        transport = FixtureTransport(current=[candidate(i) for i in range(3)])
        with patch("socket.create_connection", side_effect=AssertionError("Offline test")):
            search_fixtures.EfficientSearchTests().run_fixture(transport, streams=("current",), subject_facts=SUBJECT_FACTS)
        self.assertGreater(len(transport.calls), 0)

    def test_confirmed_facts_preserve_report_extraction_and_effective_contract(self):
        extracted = normalize_ccc_report(source_fixture())
        before = copy.deepcopy(extracted)
        confirmed = ConfirmedValuationInput.from_snapshot({**COMPLETE, "intake_mode": "report"})
        report = normalized_report_to_legacy_report(confirmed_normalized_report(confirmed, extracted))
        apply_confirmed_vehicle_facts(report, confirmed)
        validate_effective_report(report)
        self.assertEqual(report["confirmedVehicleFacts"], COMPLETE["vehicle_facts"])
        self.assertEqual(extracted, before)

    def test_explicit_no_options_does_not_become_an_equipment_package(self):
        self.assertEqual(ConfirmedValuationInput.from_snapshot(CANARY).equipment, ())


if __name__ == "__main__":
    unittest.main()
