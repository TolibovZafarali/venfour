"""Fictional sparse-market evidence preserves existing qualification rules."""

import copy
import unittest
from dataclasses import replace

from tests.test_comparable_evidence import TARGET, observation
from venfour.comparable_evidence import assess_observation


class SparseCandidateMatchingTests(unittest.TestCase):
    def setUp(self):
        self.target = replace(TARGET, mileage=2_908)
        self.subject = {
            "bodyType": "SUV", "doors": "5", "engine": "2.0L (family: fictional family)",
            "cylinders": "4", "fuelType": "Unleaded", "transmission": "Automatic",
            "certified": None, "warranty": None, "equipment": [],
        }
        self.row = observation(mileage=14_725, distanceMiles=103.21)
        self.row["materialFacts"] = {
            "bodyType": "SUV", "doors": "5", "engine": "2.0L I4", "cylinders": "4",
            "fuelType": "Unleaded", "transmission": "CVT", "powertrain": "Combustion",
            "certified": True, "warranty": None, "equipment": None,
        }

    def assess(self, row=None, subject=None, **kwargs):
        return assess_observation(
            self.target, row if row is not None else self.row,
            subject_material_facts=subject if subject is not None else self.subject,
            free_estimate=True, **kwargs,
        )

    def test_certification_is_the_hard_rejection_not_partial_specs_or_mileage(self):
        rejected = self.assess()
        self.assertEqual(rejected["score"], 76.45)
        self.assertFalse(rejected["verificationEligible"])
        self.assertFalse(rejected["baselineEligible"])
        self.assertEqual(rejected["tier"], "INELIGIBLE")
        self.assertIn("CERTIFIED_PREMIUM_UNKNOWN", rejected["reasonCodes"])

        # Isolate the premium flag on fictional evidence; no real record changes.
        without_premium = copy.deepcopy(self.row)
        without_premium["materialFacts"]["certified"] = None
        qualified = self.assess(without_premium)
        self.assertEqual(qualified["score"], rejected["score"])
        self.assertTrue(qualified["verificationEligible"])
        self.assertTrue(qualified["baselineEligible"])
        self.assertEqual(qualified["tier"], "GOOD")
        self.assertEqual(qualified["unresolvedEstimateFacts"], ["engine", "transmission"])
        self.assertIn("SUPPORTING_MILEAGE_WINDOW_EXCEEDED", qualified["reasonCodes"])
        self.assertFalse(qualified["strong"])
        self.assertFalse(qualified["estimateStrong"])
        self.assertFalse(qualified["supportingEligible"])

    def test_complete_engine_or_transmission_cannot_hide_unverified_premium(self):
        for facts in (
            {"engine": "2.0L I4 (family: fictional family)"},
            {"transmission": "CVT"},
            {"engine": "2.0L I4 (family: fictional family)", "transmission": "CVT"},
        ):
            with self.subTest(facts=facts):
                result = self.assess(subject={**self.subject, **facts})
                self.assertFalse(result["verificationEligible"])
                self.assertEqual(result["tier"], "INELIGIBLE")
                self.assertIn("CERTIFIED_PREMIUM_UNKNOWN", result["reasonCodes"])

    def test_known_premium_mismatch_remains_ineligible_even_at_matching_mileage(self):
        row = copy.deepcopy(self.row)
        row["listing"]["mileage"] = self.target.mileage
        result = self.assess(row, subject={**self.subject, "certified": False})
        self.assertFalse(result["verificationEligible"])
        self.assertIn("CERTIFIED_MISMATCH", result["reasonCodes"])
        self.assertNotIn("SUPPORTING_MILEAGE_WINDOW_EXCEEDED", result["reasonCodes"])

    def test_qualified_historical_discovery_still_requires_history_verification(self):
        row = copy.deepcopy(self.row)
        row["materialFacts"]["certified"] = None
        row.update(stream="historical", sourceEndpoint="recents", dateVerified=False,
                   priceVerified=False, relevantDate="2026-08-11")
        result = self.assess(row, evidence_date="2026-08-11")
        self.assertTrue(result["verificationEligible"])
        self.assertFalse(result["baselineEligible"])
        self.assertIn("DATE_CONTEXT_UNVERIFIED", result["reasonCodes"])
        self.assertIn("ASKING_PRICE_UNVERIFIED", result["reasonCodes"])
        self.assertFalse(result["supportingEligible"])


if __name__ == "__main__":
    unittest.main()
