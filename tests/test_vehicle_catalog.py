"""Tests for provider-neutral vehicle trim normalization."""

from __future__ import annotations

import unittest

from venfour.vehicle_catalog import (
    MAX_VEHICLE_CATALOG_TEXT_LENGTH,
    VehicleTrimOption,
    normalize_vehicle_trim_options,
)


def normalized_options(
    values: list[str], *, query_field: str = "version"
) -> tuple[VehicleTrimOption, ...]:
    return normalize_vehicle_trim_options(
        values,
        source="marketcheck",
        query_field=query_field,
    )


class VehicleTrimNormalizationTests(unittest.TestCase):
    def test_version_identity_collapses_only_equivalent_tesla_configurations(
        self,
    ) -> None:
        options = normalized_options(
            [
                "Long Range Battery",
                "Long Range",
                "Long Range Rear Wheel Drive",
                "Long Range AWD Dual Motor",
                "Dual Motor All-Wheel Drive Long Range",
                "Performance AWD Dual Motor",
                "Perfomance Dual Motor All Wheel Drive",
                "Standard Range Plus",
            ]
        )

        self.assertEqual(
            [option.label for option in options],
            [
                "Long Range",
                "Long Range Dual Motor AWD",
                "Long Range RWD",
                "Performance Dual Motor AWD",
                "Standard Range Plus",
            ],
        )
        by_label = {option.label: option for option in options}
        self.assertEqual(
            by_label["Long Range"].query_values,
            ("Long Range", "Long Range Battery"),
        )
        self.assertEqual(
            by_label["Long Range Dual Motor AWD"].query_values,
            (
                "Dual Motor All-Wheel Drive Long Range",
                "Long Range AWD Dual Motor",
            ),
        )
        self.assertEqual(
            by_label["Performance Dual Motor AWD"].query_values,
            (
                "Perfomance Dual Motor All Wheel Drive",
                "Performance AWD Dual Motor",
            ),
        )
        self.assertNotIn("Long Range Battery", by_label)
        self.assertTrue(
            all(option.query_field == "version" for option in options)
        )
        self.assertTrue(
            all(option.id.startswith("marketcheck-version-") for option in options)
        )

    def test_trim_fallback_never_discards_battery_and_keeps_drivetrains(self) -> None:
        options = normalized_options(
            [
                "Long Range",
                "Long Range Battery",
                " XLE ",
                "xle",
                "XLE AWD",
                "XLE All Wheel Drive",
                "XLE 4WD",
            ],
            query_field="trim",
        )

        self.assertEqual(
            [option.label for option in options],
            [
                "Long Range",
                "Long Range Battery",
                "XLE",
                "XLE 4WD",
                "XLE AWD",
            ],
        )
        by_label = {option.label: option for option in options}
        self.assertEqual(by_label["XLE"].query_values, ("XLE",))
        self.assertEqual(
            by_label["XLE AWD"].query_values,
            ("XLE All Wheel Drive", "XLE AWD"),
        )
        self.assertEqual(by_label["Long Range Battery"].query_field, "trim")

    def test_preserves_material_cross_manufacturer_configurations(self) -> None:
        cases = {
            "rav4": (
                [
                    "LE FWD",
                    "LE AWD",
                    "LE Hybrid FWD",
                    "LE Hybrid AWD",
                ],
                {"LE FWD", "LE AWD", "LE Hybrid FWD", "LE Hybrid AWD"},
            ),
            "ioniq": (
                [
                    "SE Standard Range RWD",
                    "SE Long Range RWD",
                    "SE Long Range AWD",
                ],
                {
                    "SE Standard Range RWD",
                    "SE Long Range RWD",
                    "SE Long Range AWD",
                },
            ),
            "x5": (
                ["sDrive40i", "xDrive40i", "xDrive45e", "M50i"],
                {"sDrive40i", "xDrive40i", "xDrive45e", "M50i"},
            ),
            "f150": (
                [
                    "XLT SuperCrew 5.5 ft Bed 4WD",
                    "XLT SuperCrew 6.5 ft Bed 4WD",
                    "XLT SuperCab 6.5 ft Bed 4WD",
                    "XLT SuperCrew 5.5 ft Bed RWD",
                ],
                {
                    "XLT SuperCrew 5.5 ft Bed 4WD",
                    "XLT SuperCrew 6.5 ft Bed 4WD",
                    "XLT SuperCab 6.5 ft Bed 4WD",
                    "XLT SuperCrew 5.5 ft Bed RWD",
                },
            ),
        }

        for name, (values, expected_labels) in cases.items():
            with self.subTest(name=name):
                options = normalized_options(values)
                self.assertEqual(
                    {option.label for option in options}, expected_labels
                )
                self.assertEqual(len(options), len(values))

    def test_unknown_word_order_is_not_assumed_to_be_synonymous(self) -> None:
        options = normalized_options(["Sport Touring", "Touring Sport"])

        self.assertEqual(
            [option.label for option in options],
            ["Sport Touring", "Touring Sport"],
        )

    def test_natural_sort_and_ids_are_deterministic(self) -> None:
        first = normalized_options(["Series 10", "Series 2", "Series 1"])
        second = normalized_options(["Series 1", "Series 10", "Series 2"])

        self.assertEqual(
            [option.label for option in first],
            ["Series 1", "Series 2", "Series 10"],
        )
        self.assertEqual(first, second)
        other_source = normalize_vehicle_trim_options(
            ["Series 1", "Series 10", "Series 2"],
            source="other-provider",
            query_field="version",
        )
        self.assertNotEqual(
            [option.id for option in first],
            [option.id for option in other_source],
        )

    def test_option_serializes_clean_label_and_raw_identity_separately(self) -> None:
        option = normalized_options(["Long Range Battery", "Long Range"])[0]

        self.assertEqual(
            option.to_dict(),
            {
                "source": "marketcheck",
                "id": option.id,
                "label": "Long Range",
                "trim": "Long Range",
                "queryField": "version",
                "queryValues": ["Long Range", "Long Range Battery"],
            },
        )

    def test_rejects_invalid_provider_identity_fields_and_raw_values(self) -> None:
        invalid_calls = (
            {"source": "MarketCheck", "query_field": "version"},
            {"source": "marketcheck", "query_field": "drivetrain"},
        )
        for arguments in invalid_calls:
            with self.subTest(arguments=arguments):
                with self.assertRaises(ValueError):
                    normalize_vehicle_trim_options(["XLE"], **arguments)

        for value in (
            "",
            "   ",
            "XLE, AWD",
            "X" * (MAX_VEHICLE_CATALOG_TEXT_LENGTH + 1),
            "XLE\nAWD",
        ):
            with self.subTest(value=value):
                with self.assertRaises((TypeError, ValueError)):
                    normalized_options([value])


if __name__ == "__main__":
    unittest.main()
