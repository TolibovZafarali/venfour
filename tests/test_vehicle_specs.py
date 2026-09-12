"""Offline specification regressions; saved discovery never supplies history."""

import copy
import json
import unittest
from dataclasses import replace
from pathlib import Path

from tests.test_comparable_evidence import FACTS, TARGET, observation
from venfour.analysis_runs import _target_from_data
from venfour.comparable_evidence import assess_observation, build_supporting_shortlist
from venfour.vehicle_specs import canonical, comparison, engine_attributes, material_conflicts


class VehicleSpecificationTests(unittest.TestCase):
    def test_structured_engine_aliases_and_provenance(self):
        left, right = {**FACTS, "engine": "2000cc inline-4"}, {**FACTS, "engine": "2.0 L I4"}
        result = comparison("engine", left["engine"], right["engine"], subject=left, candidate=right)
        self.assertEqual(result["status"], "MATCH", result)
        self.assertEqual(result["subject"], "2000cc inline-4")
        self.assertEqual(result["listing"], "2.0 L I4")
        self.assertEqual(result["canonicalSubject"]["displacementLiters"], 2)
        self.assertEqual(result["canonicalListing"]["cylinders"], 4)

    def test_family_names_never_become_false_conflicts_or_confirmed_matches(self):
        for engine in ("MPI NU PE", "Different manufacturer family", "2.0L (family: MPI NU PE)"):
            subject = {**FACTS, "engine": engine}
            result = assess_observation(TARGET, observation(), subject_material_facts=subject, free_estimate=True)
            self.assertTrue(result["verificationEligible"], result)
            self.assertNotIn("ENGINE_MISMATCH", result["reasonCodes"])
            self.assertIn("engine", result["unresolvedEstimateFacts"])
            self.assertFalse(result["strong"])
            self.assertFalse(result["estimateStrong"])
            self.assertFalse(result["supportingEligible"])
            self.assertEqual(result["tier"], "GOOD")
            self.assertFalse(assess_observation(TARGET, observation(), subject_material_facts=subject)["baselineEligible"])
        same = comparison("engine", "MPI NU PE", "MPI NU PE")
        self.assertEqual(same["status"], "UNRESOLVED")

    def test_real_material_conflicts_remain_excluded(self):
        for field, left, right in (
            ("engine", "2.0L I4", "1.6L I4"),
            ("engine", "2.0L I4 Naturally aspirated", "2.0L I4 Turbo"),
            ("engine", "2.0L I4 Non-hybrid", "2.0L I4 Hybrid"),
            ("engine", "3.0L I6", "3.0L V6"),
            ("fuelType", "Gasoline", "Electric / Unleaded"),
            ("bodyType", "SUV", "Sedan"), ("bodyType", "Van", "Minivan"),
            ("transmission", "Manual", "Automatic"), ("cabType", "Crew Cab", "Regular Cab"),
            ("bedLength", "5.5 ft", "8 ft"),
        ):
            with self.subTest(field=field, left=left, right=right):
                row = observation(); row["materialFacts"][field] = right
                result = assess_observation(TARGET, row, subject_material_facts={**FACTS, field: left}, free_estimate=True)
                self.assertFalse(result["verificationEligible"], result)
                self.assertIn(field.upper() + "_MISMATCH", result["reasonCodes"])
        self.assertFalse(assess_observation(TARGET, observation(drivetrain="AWD"), subject_material_facts=FACTS, free_estimate=True)["verificationEligible"])

    def test_ambiguous_specification_options_are_not_selected_silently(self):
        self.assertEqual(comparison("engine", "3.0L I4 / 2.0L I4", "2.0L I4")["status"], "UNRESOLVED")
        self.assertEqual(comparison("transmission", "Automatic/Manual", "Automatic")["status"], "UNRESOLVED")
        self.assertEqual(comparison("engine", "2.0L I4 unfamiliar version", "2.0L I4")["status"], "UNRESOLVED")
        self.assertEqual(comparison("engine", "2.0L I4 High output", "2.0L I4 Standard output")["status"], "CONFLICT")

    def test_generic_powertrain_label_does_not_certify_missing_engine_specs(self):
        row = observation(); row["materialFacts"] = {"bodyType":"Sedan", "powertrain":"Gasoline"}
        subject = {"bodyType":"Sedan", "powertrain":"ICE"}
        result = assess_observation(TARGET,row,subject_material_facts=subject,free_estimate=True)
        self.assertNotIn("POWERTRAIN_MISMATCH",result["reasonCodes"])
        self.assertTrue(result["verificationEligible"])
        self.assertFalse(result["estimateStrong"])
        self.assertFalse(result["strong"])
        self.assertEqual(result["tier"],"GOOD")
        self.assertFalse(assess_observation(TARGET,row,subject_material_facts=subject)["verificationEligible"])

    def test_trim_punctuation_does_not_reduce_qualification_score(self):
        subject = replace(TARGET, trim="Touring-Sport")
        result = assess_observation(subject, observation(trim="Touring Sport"), subject_material_facts=FACTS)
        self.assertTrue(result["verificationEligible"])
        self.assertEqual(result["score"], 100)

    def test_omitted_aspiration_or_partial_transmission_is_unresolved(self):
        self.assertEqual(comparison("engine", "2.0L I4", "2.0L I4 Turbo")["status"], "UNRESOLVED")
        self.assertEqual(comparison("transmission", "Automatic", "CVT")["status"], "UNRESOLVED")
        self.assertEqual(comparison("transmission", "Automatic", "8-speed automatic")["status"], "UNRESOLVED")
        self.assertEqual(comparison("transmission", "6-speed automatic", "8-speed automatic")["status"], "CONFLICT")

    def test_common_body_drive_fuel_and_dimension_aliases(self):
        for field, left, right in (
            ("bodyType", "Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]", "SUV"),
            ("bodyType", "Crossover", "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)"),
            ("bodyType", "Sedan/Saloon", "Sedan"), ("fuelType", "Petrol", "Unleaded"),
            ("drivetrain", "FWD/Front-Wheel Drive", "FWD"), ("bedLength", "5.5 ft", "66 in"),
            ("cylinders", "4.0", "4 cylinders"), ("transmission", "CVT", "Continuously Variable Transmission (CVT)"),
        ):
            self.assertEqual(comparison(field, left, right)["status"], "MATCH", (field, left, right))
        self.assertIsNone(canonical("drivetrain", "4x2"))
        self.assertEqual(comparison("drivetrain", "AWD", "4WD")["status"], "CONFLICT")
        self.assertEqual(comparison("bodyType", "Unrecognized body", "SUV")["status"], "UNRESOLVED")

    def test_conflicting_cylinder_sources_do_not_disappear_in_normalization(self):
        self.assertTrue(engine_attributes({"engine": "2.0L I4", "cylinders": "6"})["internalConflict"])
        result = assess_observation(TARGET, observation(), subject_material_facts={**FACTS, "cylinders": "6"}, free_estimate=True)
        self.assertFalse(result["verificationEligible"])

    def test_supporting_duplicates_use_canonical_facts_without_changing_baseline_prices(self):
        rows = [observation(n) for n in range(1,10)]
        high = observation(10,price=24000)
        alias = copy.deepcopy(high)
        alias["materialFacts"].update(bodyType="Sedan/Saloon", fuelType="Unleaded", engine="2000cc inline-4")
        result = build_supporting_shortlist(TARGET,rows+[high,alias],subject_material_facts=FACTS)
        self.assertEqual(len(result["listings"]),1)
        self.assertEqual(result["listings"][0]["verifiedAskingPrice"],24000)
        self.assertFalse(result["affectsBaselineValuation"])
        self.assertFalse(result["reassessmentRequired"])

    def test_repeated_vehicle_vocabulary_is_not_a_conflict(self):
        a, b = observation(), observation()
        b["materialFacts"].update(engine="2000cc inline 4", fuelType="Unleaded", bodyType="Sedan/Saloon")
        self.assertFalse(material_conflicts([a, b]))
        b["materialFacts"]["engine"] = "3.0L V6"
        self.assertTrue(material_conflicts([a, b]))


class KonaDiscoveryRegressionTests(unittest.TestCase):
    def test_saved_31_observations_and_nine_vehicles_no_fabricated_history(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/vehicle-specs/kona-discovery.json").read_text())
        original = copy.deepcopy(fixture)
        target = _target_from_data(fixture["target"])
        rows = fixture["observations"]
        self.assertEqual(len(rows), 31)
        self.assertEqual(len({row["listing"]["vin"] for row in rows}), 9)
        self.assertFalse(any(row["sourceEndpoint"] == "history" for row in rows))
        for facts in (fixture["subjectFacts"], {**fixture["subjectFacts"], "engine": "2.0L (family: MPI NU PE)", "bodyType": "SUV"}):
            assessments = [assess_observation(target, row, subject_material_facts=facts, free_estimate=True) for row in rows]
            self.assertEqual(len({row["listing"]["vin"] for result,row in zip(assessments,rows) if result["verificationEligible"]}),4)
            self.assertFalse(any("ENGINE_MISMATCH" in result["reasonCodes"] for result in assessments))
            self.assertTrue(any(result["verificationEligible"] and row["stream"] == "historical" for result, row in zip(assessments, rows)))
            self.assertFalse(any(result["strong"] or result["supportingEligible"] for result in assessments))
            self.assertFalse(any(result["baselineEligible"] for result, row in zip(assessments, rows) if row["stream"] == "historical"))
        # The PDF-confirmed FWD fact is a separate scenario, not a silent edit
        # to the immutable intake that was actually submitted.
        confirmed = replace(target, drivetrain="FWD", drivetrain_recorded=True)
        for row in rows:
            result = assess_observation(confirmed, row, subject_material_facts=fixture["subjectFacts"], free_estimate=True)
            if row["listing"]["drivetrain"] != "FWD":
                self.assertFalse(result["verificationEligible"])
                self.assertIn("DRIVETRAIN_MISMATCH", result["reasonCodes"])
        self.assertEqual(fixture, original)
