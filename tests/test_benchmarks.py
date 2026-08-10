"""Deterministic regression tests for manually verified CCC benchmarks."""

from __future__ import annotations

import copy
import unittest
from pathlib import Path
from typing import Any

from scripts.benchmark_report import BenchmarkMismatch, compare_benchmark, load_json


REPO_ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_DIR = REPO_ROOT / "tests" / "benchmarks"


def make_candidate(benchmark: dict[str, Any]) -> dict[str, Any]:
    """Turn benchmark-only condition checks into extraction-shaped test data."""

    candidate = copy.deepcopy(benchmark)
    condition = candidate.get("condition")
    if condition is not None:
        values = condition.pop("nonzeroValueImpacts")
        items: list[dict[str, int]] = [{"valueImpact": 0}]
        for value in values:
            items.extend(({"valueImpact": value}, {"valueImpact": 0}))
        condition["items"] = items
    return candidate


class BenchmarkComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.camry = load_json(BENCHMARK_DIR / "camry.json")
        cls.elantra = load_json(BENCHMARK_DIR / "elantra.json")

    def candidate(self, name: str) -> dict[str, Any]:
        benchmark = self.camry if name == "camry" else self.elantra
        return make_candidate(benchmark)

    def compare(self, name: str, actual: dict[str, Any]) -> list[BenchmarkMismatch]:
        benchmark = self.camry if name == "camry" else self.elantra
        return compare_benchmark(benchmark, actual)

    def assert_mismatch_path(
        self, mismatches: list[BenchmarkMismatch], path: str
    ) -> BenchmarkMismatch:
        for mismatch in mismatches:
            if mismatch.path == path:
                return mismatch
        self.fail(
            f"expected mismatch at {path}; got "
            f"{[mismatch.path for mismatch in mismatches]}"
        )

    def test_verified_fixtures_match_extraction_shaped_candidates(self) -> None:
        for name in ("camry", "elantra"):
            with self.subTest(report=name):
                self.assertEqual(self.compare(name, self.candidate(name)), [])

    def test_fixtures_contain_only_the_verified_field_subset(self) -> None:
        common_vehicle_fields = {"year", "make", "model", "trim", "vin", "mileage"}
        self.assertEqual(set(self.camry["vehicle"]), common_vehicle_fields)
        self.assertEqual(
            set(self.elantra["vehicle"]), common_vehicle_fields | {"bodyStyle"}
        )
        self.assertEqual(
            set(self.camry["valuation"]),
            {
                "baseVehicleValue",
                "conditionAdjustment",
                "adjustedVehicleValue",
                "total",
            },
        )
        self.assertEqual(set(self.elantra["condition"]), {
            "totalAdjustment",
            "nonzeroValueImpacts",
        })
        for benchmark in (self.camry, self.elantra):
            for comparable in benchmark["comparables"]:
                self.assertEqual(
                    set(comparable),
                    {
                        "number",
                        "mileage",
                        "listPrice",
                        "adjustments",
                        "adjustedValue",
                    },
                )
                self.assertEqual(
                    set(comparable["adjustments"]),
                    {"package", "options", "mileage", "condition"},
                )

    def test_elantra_verified_condition_values_total_297(self) -> None:
        values = self.elantra["condition"]["nonzeroValueImpacts"]
        self.assertEqual(values, [44, 148, 55, 44, 34, -28])
        self.assertEqual(sum(values), 297)
        self.assertEqual(self.elantra["condition"]["totalAdjustment"], 297)

    def test_verified_comparable_counts_numbers_and_null_adjustments(self) -> None:
        self.assertEqual(
            [row["number"] for row in self.camry["comparables"]],
            list(range(1, 12)),
        )
        self.assertEqual(
            [row["number"] for row in self.elantra["comparables"]],
            list(range(1, 13)),
        )

        for row in self.camry["comparables"]:
            self.assertTrue(
                all(value is None for value in row["adjustments"].values())
            )
        for row in self.elantra["comparables"][6:]:
            self.assertTrue(
                all(value is None for value in row["adjustments"].values())
            )

    def test_unverified_actual_fields_are_ignored(self) -> None:
        actual = self.candidate("camry")
        actual["vehicle"]["location"] = "not benchmarked"
        actual["comparables"][0]["dealer"] = "not benchmarked"
        actual["supplementalInformation"] = {"recalls": ["not benchmarked"]}
        self.assertEqual(self.compare("camry", actual), [])

    def test_wrong_loss_vehicle_year_make_model_or_trim_fails(self) -> None:
        bad_values = {
            "year": 2024,
            "make": "Honda",
            "model": "Corolla",
            "trim": "LE",
        }
        for field, value in bad_values.items():
            with self.subTest(field=field):
                actual = self.candidate("camry")
                actual["vehicle"][field] = value
                mismatch = self.assert_mismatch_path(
                    self.compare("camry", actual), f"$.vehicle.{field}"
                )
                self.assertEqual(mismatch.actual, value)

    def test_wrong_vin_fails(self) -> None:
        actual = self.candidate("elantra")
        actual["vehicle"]["vin"] = "KMHLS4DG6RU000000"
        self.assert_mismatch_path(
            self.compare("elantra", actual), "$.vehicle.vin"
        )

    def test_wrong_loss_vehicle_mileage_fails(self) -> None:
        actual = self.candidate("camry")
        actual["vehicle"]["mileage"] = 7193
        self.assert_mismatch_path(
            self.compare("camry", actual), "$.vehicle.mileage"
        )

    def test_wrong_valuation_numbers_fail(self) -> None:
        for field in (
            "baseVehicleValue",
            "conditionAdjustment",
            "adjustedVehicleValue",
            "total",
        ):
            with self.subTest(field=field):
                actual = self.candidate("elantra")
                actual["valuation"][field] += 1
                self.assert_mismatch_path(
                    self.compare("elantra", actual), f"$.valuation.{field}"
                )

    def test_numeric_comparison_has_no_tolerance(self) -> None:
        actual = self.candidate("camry")
        actual["valuation"]["total"] += 0.000000001
        self.assert_mismatch_path(
            self.compare("camry", actual), "$.valuation.total"
        )

    def test_equal_integer_and_float_json_numbers_match(self) -> None:
        actual = self.candidate("elantra")
        actual["valuation"]["total"] = 19046.0
        self.assertEqual(self.compare("elantra", actual), [])

    def test_missing_comparable_fails_count_order_and_number_checks(self) -> None:
        actual = self.candidate("camry")
        del actual["comparables"][5]
        mismatches = self.compare("camry", actual)
        self.assert_mismatch_path(mismatches, "$.comparables.length")
        self.assert_mismatch_path(mismatches, "$.comparables[*].number")
        self.assert_mismatch_path(mismatches, "$.comparables[number=6]")

    def test_extra_comparable_fails_count_order_and_number_checks(self) -> None:
        actual = self.candidate("elantra")
        extra = copy.deepcopy(actual["comparables"][-1])
        extra["number"] = 13
        actual["comparables"].append(extra)
        mismatches = self.compare("elantra", actual)
        self.assert_mismatch_path(mismatches, "$.comparables.length")
        self.assert_mismatch_path(mismatches, "$.comparables[*].number")
        self.assert_mismatch_path(mismatches, "$.comparables[12].number")

    def test_duplicate_comparable_number_fails_uniqueness(self) -> None:
        actual = self.candidate("elantra")
        actual["comparables"][-1]["number"] = 1
        mismatches = self.compare("elantra", actual)
        duplicate = self.assert_mismatch_path(
            mismatches, "$.comparables[11].number"
        )
        self.assertIn("first occurrence", duplicate.message or "")
        self.assert_mismatch_path(mismatches, "$.comparables[number=12]")

    def test_comparable_array_row_shift_fails_order_check(self) -> None:
        actual = self.candidate("camry")
        actual["comparables"][0], actual["comparables"][1] = (
            actual["comparables"][1],
            actual["comparables"][0],
        )
        mismatches = self.compare("camry", actual)
        self.assert_mismatch_path(mismatches, "$.comparables[*].number")

    def test_comparable_fields_are_matched_by_printed_number(self) -> None:
        actual = self.candidate("camry")
        actual["comparables"][0]["number"] = 2
        actual["comparables"][1]["number"] = 1
        mismatches = self.compare("camry", actual)
        self.assert_mismatch_path(mismatches, "$.comparables[number=1].mileage")
        self.assert_mismatch_path(mismatches, "$.comparables[number=2].mileage")
        self.assert_mismatch_path(mismatches, "$.comparables[number=1].listPrice")

    def test_wrong_comparable_list_price_fails(self) -> None:
        actual = self.candidate("elantra")
        actual["comparables"][2]["listPrice"] = 19999
        self.assert_mismatch_path(
            self.compare("elantra", actual),
            "$.comparables[number=3].listPrice",
        )

    def test_wrong_comparable_adjusted_value_fails(self) -> None:
        actual = self.candidate("camry")
        actual["comparables"][7]["adjustedValue"] = 31231
        self.assert_mismatch_path(
            self.compare("camry", actual),
            "$.comparables[number=8].adjustedValue",
        )

    def test_wrong_adjustment_sign_fails(self) -> None:
        actual = self.candidate("elantra")
        actual["comparables"][0]["adjustments"]["mileage"] = 727
        mismatch = self.assert_mismatch_path(
            self.compare("elantra", actual),
            "$.comparables[number=1].adjustments.mileage",
        )
        self.assertEqual(mismatch.expected, -727)
        self.assertEqual(mismatch.actual, 727)

    def test_invented_adjustment_where_null_is_expected_fails(self) -> None:
        actual = self.candidate("camry")
        actual["comparables"][0]["adjustments"]["package"] = 57
        mismatch = self.assert_mismatch_path(
            self.compare("camry", actual),
            "$.comparables[number=1].adjustments.package",
        )
        self.assertIsNone(mismatch.expected)
        self.assertEqual(mismatch.actual, 57)

    def test_elantra_summary_rows_cannot_borrow_detailed_adjustments(self) -> None:
        for summary_index in range(6, 12):
            with self.subTest(comparable=summary_index + 1):
                actual = self.candidate("elantra")
                source_index = summary_index - 6
                actual["comparables"][summary_index]["adjustments"] = copy.deepcopy(
                    actual["comparables"][source_index]["adjustments"]
                )
                mismatches = self.compare("elantra", actual)
                number = summary_index + 1
                for field in ("package", "options", "mileage", "condition"):
                    self.assert_mismatch_path(
                        mismatches,
                        f"$.comparables[number={number}].adjustments.{field}",
                    )

    def test_incorrect_elantra_condition_total_fails(self) -> None:
        actual = self.candidate("elantra")
        actual["condition"]["totalAdjustment"] = 298
        self.assert_mismatch_path(
            self.compare("elantra", actual), "$.condition.totalAdjustment"
        )

    def test_incorrect_elantra_nonzero_condition_value_and_sum_fail(self) -> None:
        actual = self.candidate("elantra")
        first_nonzero_index = next(
            index
            for index, item in enumerate(actual["condition"]["items"])
            if item["valueImpact"] != 0
        )
        actual["condition"]["items"][first_nonzero_index]["valueImpact"] = 45
        mismatches = self.compare("elantra", actual)
        self.assert_mismatch_path(
            mismatches,
            f"$.condition.items[{first_nonzero_index}].valueImpact",
        )
        self.assert_mismatch_path(
            mismatches,
            "$.condition.items[*].valueImpact(nonzero).sum",
        )

    def test_incorrect_elantra_body_style_mapping_fails(self) -> None:
        actual = self.candidate("elantra")
        actual["vehicle"]["bodyStyle"] = "w/Intelligent Variable Transmission"
        mismatch = self.assert_mismatch_path(
            self.compare("elantra", actual), "$.vehicle.bodyStyle"
        )
        self.assertEqual(mismatch.expected, "Sedan")

    def test_mismatch_text_reports_path_expected_and_actual(self) -> None:
        actual = self.candidate("camry")
        actual["vehicle"]["vin"] = "wrong"
        mismatch = self.assert_mismatch_path(
            self.compare("camry", actual), "$.vehicle.vin"
        )
        rendered = str(mismatch)
        self.assertIn("$.vehicle.vin", rendered)
        self.assertIn('expected="4T1DAACK2SU623063"', rendered)
        self.assertIn('actual="wrong"', rendered)


if __name__ == "__main__":
    unittest.main()
