"""Contracts for report and no-report confirmed valuation inputs."""

from __future__ import annotations

import unittest

from venfour.valuation_inputs import (
    ConfirmedValuationInput,
    ValuationInputError,
    confirmed_normalized_report,
    evidence_context,
)


def snapshot(**overrides: object) -> dict:
    value = {
        "intake_mode": "manual",
        "vin": None,
        "vehicle_year": 2020,
        "vehicle_make": "Toyota",
        "vehicle_model": "Camry",
        "vehicle_trim": "SE",
        "mileage_at_loss": 51_000,
        "postal_code": "60611-1234",
        "date_of_loss": "2026-05-19",
        "insurer_name": "Example Insurance",
        "insurer_vehicle_valuation": None,
        "vehicle_condition": "Good",
        "vehicle_options_packages": [],
        "report_provider_name": None,
    }
    value.update(overrides)
    return value


class ConfirmedValuationInputTests(unittest.TestCase):
    def test_preserves_provider_configuration_separately_from_display_trim(
        self,
    ) -> None:
        confirmed = ConfirmedValuationInput.from_snapshot(
            snapshot(
                vehicle_trim="Long Range Dual Motor AWD",
                vehicle_configuration={
                    "source": "marketcheck",
                    "field": "version",
                    "values": [
                        "Dual Motor All-Whel Drive Long Range",
                        "Long Range AWD Dual Motor",
                    ],
                },
            )
        )

        self.assertEqual(confirmed.trim, "Long Range Dual Motor AWD")
        self.assertIsNotNone(confirmed.vehicle_configuration)
        assert confirmed.vehicle_configuration is not None
        self.assertEqual(
            confirmed.vehicle_configuration.values,
            (
                "Dual Motor All-Whel Drive Long Range",
                "Long Range AWD Dual Motor",
            ),
        )

    def test_rejects_malformed_provider_configuration(self) -> None:
        for configuration in (
            {"source": "marketcheck", "field": "version", "values": []},
            {"source": "marketcheck", "field": "trim", "values": ["SE,LE"]},
            {"source": "other", "field": "engine", "values": ["2.0L"]},
        ):
            with self.subTest(configuration=configuration), self.assertRaises(
                ValuationInputError
            ) as raised:
                ConfirmedValuationInput.from_snapshot(
                    snapshot(vehicle_configuration=configuration)
                )
            self.assertEqual(raised.exception.field, "vehicle_configuration")

    def test_manual_input_requires_trim_even_when_vin_is_present(self) -> None:
        with self.assertRaises(ValuationInputError) as raised:
            ConfirmedValuationInput.from_snapshot(
                snapshot(vin="4T1G11AK0LU000001", vehicle_trim=None)
            )
        self.assertEqual(raised.exception.field, "vehicle_trim")

    def test_manual_input_keeps_condition_and_options_optional(self) -> None:
        confirmed = ConfirmedValuationInput.from_snapshot(
            snapshot(vehicle_condition=None, vehicle_options_packages=None)
        )

        self.assertIsNone(confirmed.condition_summary)
        self.assertEqual(confirmed.equipment, ())

    def test_manual_projection_has_no_report_comparables_or_adjustments(self) -> None:
        confirmed = ConfirmedValuationInput.from_snapshot(snapshot())
        normalized = confirmed_normalized_report(confirmed)
        context = evidence_context(confirmed, normalized)

        self.assertEqual(normalized["comparables"], [])
        self.assertIsNone(normalized["valuation"]["adjustedVehicleValue"])
        self.assertEqual(context["inputMode"], "MANUAL")
        self.assertFalse(context["reportAvailable"])
        self.assertFalse(context["reportExtractionAvailable"])
        self.assertFalse(context["reportComparablesAvailable"])
        self.assertFalse(context["reportAdjustmentsAvailable"])
        self.assertFalse(context["conditionAndOptionsDollarAdjusted"])

    def test_customer_stated_offer_is_available_without_creating_report_evidence(self) -> None:
        confirmed = ConfirmedValuationInput.from_snapshot(
            snapshot(insurer_vehicle_valuation=17_750)
        )
        normalized = confirmed_normalized_report(confirmed)
        context = evidence_context(confirmed, normalized)

        self.assertEqual(normalized["valuation"]["insurerOffer"], 17_750)
        self.assertTrue(context["offerAvailable"])
        self.assertTrue(context["insurerValuationAvailable"])
        self.assertFalse(context["reportAvailable"])

    def test_report_input_can_continue_from_confirmed_facts_without_extraction(self) -> None:
        confirmed = ConfirmedValuationInput.from_snapshot(
            snapshot(
                intake_mode="report",
                report_provider_name="Acme Valuations",
            )
        )
        normalized = confirmed_normalized_report(confirmed)
        context = evidence_context(
            confirmed,
            normalized,
            report_extraction_available=False,
        )

        self.assertTrue(context["reportAvailable"])
        self.assertFalse(context["reportExtractionAvailable"])
        self.assertEqual(context["reportProvider"], "Acme Valuations")
        self.assertIsNone(context["reportAdapter"])
        self.assertEqual(normalized["comparables"], [])
        self.assertEqual(normalized["valuation"]["otherAdjustments"], [])


if __name__ == "__main__":
    unittest.main()
