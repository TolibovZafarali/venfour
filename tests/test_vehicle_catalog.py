"""Tests for provider-neutral vehicle trim normalization."""

from __future__ import annotations

import unittest

from venfour.vehicle_catalog import (
    MAX_VEHICLE_CATALOG_TEXT_LENGTH,
    VehicleTrimOption,
    VehicleTrimQueryValuesLimitError,
    normalize_vehicle_trim_catalog,
    normalize_vehicle_trim_options,
)


def normalized_options(
    values: list[str],
    *,
    query_field: str = "version",
    redundant_prefixes: tuple[str, ...] = (),
    allow_redundant_battery_aliases: bool = False,
) -> tuple[VehicleTrimOption, ...]:
    return normalize_vehicle_trim_options(
        values,
        source="marketcheck",
        query_field=query_field,
        redundant_prefixes=redundant_prefixes,
        allow_redundant_battery_aliases=allow_redundant_battery_aliases,
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
                "Dual Motor All-Whel Drive Long Range",
                "Performance AWD Dual Motor",
                "Perfomance Dual Motor All Wheel Drive",
                "Standard Range Plus",
            ],
            allow_redundant_battery_aliases=True,
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
                "Dual Motor All-Whel Drive Long Range",
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

    def test_version_battery_only_collapses_with_catalog_evidence(self) -> None:
        battery_only = normalized_options(
            ["Long Range Battery"],
            allow_redundant_battery_aliases=True,
        )
        without_electric_context = normalized_options(
            ["Long Range Battery", "Long Range"]
        )
        with_evidence = normalized_options(
            ["Long Range Battery", "Long Range"],
            allow_redundant_battery_aliases=True,
        )

        self.assertEqual(
            [option.label for option in battery_only],
            ["Long Range Battery"],
        )
        self.assertEqual(
            [option.label for option in without_electric_context],
            ["Long Range", "Long Range Battery"],
        )
        self.assertEqual(
            [option.label for option in with_evidence],
            ["Long Range"],
        )
        self.assertEqual(
            with_evidence[0].query_values,
            ("Long Range", "Long Range Battery"),
        )

    def test_partial_version_facets_retain_uncovered_trim_options(self) -> None:
        options = normalize_vehicle_trim_catalog(
            ["LE", "XLE", "Performance", "Long Range Battery"],
            [
                "LE FWD",
                "Performance Dual Motor AWD",
                "Long Range",
                "Long Range Battery",
            ],
            source="marketcheck",
            battery_electric_only=True,
        )

        self.assertEqual(
            [option.label for option in options],
            [
                "LE (configuration not specified)",
                "LE FWD",
                "Long Range",
                "Performance (configuration not specified)",
                "Performance Dual Motor AWD",
                "XLE",
            ],
        )
        by_label = {option.label: option for option in options}
        self.assertEqual(by_label["LE FWD"].query_field, "version")
        self.assertEqual(by_label["XLE"].query_field, "trim")
        self.assertEqual(
            by_label["Long Range"].query_values,
            ("Long Range", "Long Range Battery"),
        )

    def test_parent_like_trim_is_not_hidden_by_a_longer_version_name(self) -> None:
        options = normalize_vehicle_trim_catalog(
            ["Sport", "Sport Touring"],
            ["Sport Touring AWD"],
            source="marketcheck",
        )

        self.assertEqual(
            [(option.label, option.query_field) for option in options],
            [
                ("Sport", "trim"),
                ("Sport Touring (configuration not specified)", "trim"),
                ("Sport Touring AWD", "version"),
            ],
        )

    def test_exact_vehicle_context_prefixes_are_display_only(self) -> None:
        options = normalized_options(
            [
                "2024 Hyundai Elantra SEL IVT Front Wheel Drive",
                "Elantra SEL IVT FWD",
                "SEL IVT AWD",
            ],
            redundant_prefixes=(
                "2024 Hyundai Elantra",
                "Hyundai Elantra",
                "Elantra",
            ),
        )

        self.assertEqual(
            [option.label for option in options],
            ["SEL IVT AWD", "SEL IVT FWD"],
        )
        self.assertEqual(
            options[1].query_values,
            (
                "Elantra SEL IVT FWD",
                "2024 Hyundai Elantra SEL IVT Front Wheel Drive",
            ),
        )

    def test_numeric_model_prefix_does_not_hide_battery_capacity(self) -> None:
        options = normalized_options(
            [
                "Model 3 Long Range Battery",
                "Model 3 Long Range",
                "Model 3 Long Range 75 kWh Battery",
                "Model 3 Long Range 82 kWh Battery",
            ],
            redundant_prefixes=("Model 3",),
            allow_redundant_battery_aliases=True,
        )

        self.assertEqual(
            [option.label for option in options],
            ["Long Range", "75 kWh Long Range Battery", "82 kWh Long Range Battery"],
        )
        self.assertEqual(
            options[0].query_values,
            ("Model 3 Long Range", "Model 3 Long Range Battery"),
        )

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
        option = normalized_options(
            ["Long Range Battery", "Long Range"],
            allow_redundant_battery_aliases=True,
        )[0]

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
            "XLE\u2066 AWD",
            "X" * (MAX_VEHICLE_CATALOG_TEXT_LENGTH + 1),
            "XLE\nAWD",
        ):
            with self.subTest(value=value):
                with self.assertRaises((TypeError, ValueError)):
                    normalized_options([value])

    def test_rejects_more_raw_aliases_than_downstream_identity_can_retain(
        self,
    ) -> None:
        separators = (
            "-",
            "/",
            ".",
            ":",
            ";",
            "|",
            "~",
            "!",
            "?",
            "@",
            "#",
            "$",
            "%",
            "^",
            "&",
            "*",
            "_",
            "'",
            '"',
            "(",
            "[",
        )
        aliases = [
            f"Long{separator}Range Dual Motor AWD"
            for separator in separators
        ]

        with self.assertRaises(VehicleTrimQueryValuesLimitError):
            normalized_options(aliases)


class ExplicitVersionDrivetrainTests(unittest.TestCase):
    def test_explicit_aliases_must_agree(self) -> None:
        from venfour.vehicle_catalog import explicit_version_drivetrain

        self.assertEqual(
            explicit_version_drivetrain(("SE FWD", "SE Front Wheel Drive")),
            "FWD",
        )
        self.assertEqual(
            explicit_version_drivetrain(("SE 4WD", "SE 4x4")), "4WD"
        )

    def test_absent_conflicting_or_incomplete_aliases_remain_unknown(self) -> None:
        from venfour.vehicle_catalog import explicit_version_drivetrain

        for values in ((), ("SE",), ("SE AWD", "SE FWD"),
                       ("SE AWD", "SE"), ("SE AWD FWD",), (None,)):
            with self.subTest(values=values):
                self.assertIsNone(explicit_version_drivetrain(values))


if __name__ == "__main__":
    unittest.main()
