"""Deterministic regression tests for the valuation analysis layer."""

from __future__ import annotations

import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any
from unittest.mock import patch

from scripts.analyze_report import (
    ANALYSIS_SCHEMA_PATH,
    CANONICAL_SCHEMA_PATH,
    AnalysisError,
    load_json,
    main,
    read_schema,
    validate_json,
    write_output,
)
from venfour.analysis import analyze_report


REPO_ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_DIR = REPO_ROOT / "tests" / "benchmarks"


def make_comparable(
    number: int | None = 1,
    *,
    year: int | None = 2024,
    make: str | None = "Example",
    model: str | None = "Sedan",
    trim: str | None = "SEL",
    mileage: int | None = 60_000,
    list_price: float | None = 19_000,
    package: float | None = 100,
    options: float | None = 200,
    mileage_adjustment: float | None = 300,
    condition: float | None = -100,
    adjusted_value: float | None = 19_500,
    contribution: float | None = 100,
) -> dict[str, Any]:
    """Build one complete canonical comparable with independently editable data."""

    return {
        "number": number,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "vin": None,
        "dealer": None,
        "location": None,
        "distanceMiles": None,
        "mileage": mileage,
        "listPrice": list_price,
        "adjustments": {
            "package": package,
            "options": options,
            "mileage": mileage_adjustment,
            "condition": condition,
        },
        "adjustedValue": adjusted_value,
        "contributionPercent": contribution,
    }


def make_report(
    *,
    comparables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a small, internally consistent canonical report."""

    return {
        "report": {
            "provider": "CCC",
            "reportReferenceNumber": None,
            "claimReferenceNumber": None,
            "lossDate": None,
            "reportDate": None,
        },
        "vehicle": {
            "year": 2024,
            "make": "Example",
            "model": "Sedan",
            "trim": "SEL",
            "vin": "TESTVIN0000000001",
            "mileage": 50_000,
            "location": None,
            "bodyStyle": "Sedan",
            "engine": None,
            "transmission": None,
            "fuelType": None,
            "equipment": [],
        },
        "valuation": {
            "baseVehicleValue": 20_000,
            "conditionAdjustment": 100,
            "adjustedVehicleValue": 20_100,
            "total": 20_123.45,
        },
        "condition": {
            "totalAdjustment": 100,
            "items": [
                {
                    "category": "Exterior",
                    "component": "Paint",
                    "rating": "Dealer Ready",
                    "notes": None,
                    "valueImpact": 100,
                }
            ],
        },
        "comparables": comparables
        if comparables is not None
        else [make_comparable()],
        "valuationNotes": [],
        "supplementalInformation": {
            "historyChecks": [],
            "historyEvents": [],
            "recalls": [],
        },
    }


def benchmark_to_canonical(benchmark: dict[str, Any]) -> dict[str, Any]:
    """Convert only manually verified benchmark facts to canonical report shape."""

    report = copy.deepcopy(benchmark)
    condition = report.get("condition")
    if condition is not None:
        impacts = condition.pop("nonzeroValueImpacts")
        # Include ordinary zero rows so the test also proves zero is usable data.
        items: list[dict[str, int]] = [{"valueImpact": 0}]
        for impact in impacts:
            items.extend(({"valueImpact": impact}, {"valueImpact": 0}))
        condition["items"] = items
    return report


def load_benchmark(name: str) -> dict[str, Any]:
    with (BENCHMARK_DIR / f"{name}.json").open(encoding="utf-8") as source:
        return benchmark_to_canonical(json.load(source))


def findings(result: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [item for item in result["findings"] if item["code"] == code]


def evidence_pairs(finding: dict[str, Any]) -> set[tuple[str, str]]:
    """Use JSON rendering so lists/dicts can be compared in a set."""

    return {
        (item["path"], json.dumps(item.get("value"), sort_keys=True))
        for item in finding["evidence"]
    }


def metric_section(result: dict[str, Any], *names: str) -> dict[str, Any]:
    """Accept a small set of readable metric labels during contract integration."""

    for name in names:
        value = result["metrics"].get(name)
        if isinstance(value, dict):
            return value
    raise AssertionError(
        f"none of metric sections {names!r} exist; got {result['metrics'].keys()}"
    )


class AnalyzerTestCase(unittest.TestCase):
    def assert_finding(
        self,
        result: dict[str, Any],
        code: str,
        status: str,
        *,
        count: int | None = None,
    ) -> dict[str, Any]:
        matches = findings(result, code)
        if count is not None:
            self.assertEqual(len(matches), count, code)
        self.assertTrue(matches, f"missing {code}; got {[f['code'] for f in result['findings']]}")
        self.assertEqual(matches[0]["status"], status)
        return matches[0]

    def assert_no_finding(self, result: dict[str, Any], code: str) -> None:
        self.assertEqual(findings(result, code), [])


class ValuationArithmeticTests(AnalyzerTestCase):
    def test_valuation_arithmetic_pass_and_total_is_informational(self) -> None:
        report = make_report()
        report["valuation"]["total"] = 99_999

        result = analyze_report(report)

        finding = self.assert_finding(
            result, "VALUATION_ARITHMETIC", "PASS", count=1
        )
        self.assertEqual(result["summary"]["baseVehicleValue"], 20_000)
        self.assertEqual(result["summary"]["conditionAdjustment"], 100)
        self.assertEqual(result["summary"]["adjustedVehicleValue"], 20_100)
        self.assertEqual(result["summary"]["total"], 99_999)
        self.assertNotIn("total", finding["description"].lower())

    def test_valuation_arithmetic_warning_has_source_evidence(self) -> None:
        report = make_report()
        report["valuation"]["adjustedVehicleValue"] = 20_099

        result = analyze_report(report)

        finding = self.assert_finding(
            result, "VALUATION_ARITHMETIC", "WARNING", count=1
        )
        pairs = evidence_pairs(finding)
        self.assertIn(("$.valuation.baseVehicleValue", "20000"), pairs)
        self.assertIn(("$.valuation.conditionAdjustment", "100"), pairs)
        self.assertIn(("$.valuation.adjustedVehicleValue", "20099"), pairs)


class ConditionAnalysisTests(AnalyzerTestCase):
    def test_condition_total_pass_includes_zero_items(self) -> None:
        report = make_report()
        report["valuation"]["conditionAdjustment"] = 80
        report["valuation"]["adjustedVehicleValue"] = 20_080
        report["condition"] = {
            "totalAdjustment": 80,
            "items": [
                {"valueImpact": 100},
                {"valueImpact": 0},
                {"valueImpact": -20},
            ],
        }

        result = analyze_report(report)

        finding = self.assert_finding(
            result, "CONDITION_ADJUSTMENT_RECONCILIATION", "PASS", count=1
        )
        self.assertIn(("$.condition.totalAdjustment", "80"), evidence_pairs(finding))

    def test_condition_total_mismatch_is_warning(self) -> None:
        report = make_report()
        report["condition"]["totalAdjustment"] = 99

        result = analyze_report(report)

        finding = self.assert_finding(
            result,
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "WARNING",
            count=1,
        )
        pairs = evidence_pairs(finding)
        self.assertIn(("$.condition.items[0].valueImpact", "100"), pairs)
        self.assertIn(("$.condition.totalAdjustment", "99"), pairs)
        self.assertIn(("$.valuation.conditionAdjustment", "100"), pairs)

    def test_incomplete_condition_values_are_review_not_warning(self) -> None:
        report = make_report()
        report["condition"]["items"].append({"valueImpact": None})

        result = analyze_report(report)

        finding = self.assert_finding(
            result,
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "REVIEW",
            count=1,
        )
        self.assertIn(
            ("$.condition.items[1].valueImpact", "null"), evidence_pairs(finding)
        )


class ComparableAdjustmentTests(AnalyzerTestCase):
    def test_fully_disclosed_adjustments_reconcile(self) -> None:
        result = analyze_report(make_report())

        finding = self.assert_finding(
            result,
            "COMPARABLE_ADJUSTMENT_RECONCILIATION",
            "PASS",
            count=1,
        )
        self.assertEqual(finding["comparableNumbers"], [1])

    def test_fully_disclosed_adjustment_mismatch_is_warning(self) -> None:
        report = make_report()
        report["comparables"][0]["adjustedValue"] = 19_501

        result = analyze_report(report)

        finding = self.assert_finding(
            result,
            "COMPARABLE_ADJUSTMENT_RECONCILIATION",
            "WARNING",
            count=1,
        )
        self.assertEqual(finding["comparableNumbers"], [1])
        pairs = evidence_pairs(finding)
        for path in (
            "$.comparables[0].listPrice",
            "$.comparables[0].adjustments.package",
            "$.comparables[0].adjustments.options",
            "$.comparables[0].adjustments.mileage",
            "$.comparables[0].adjustments.condition",
            "$.comparables[0].adjustedValue",
        ):
            self.assertTrue(any(pair[0] == path for pair in pairs), path)
        entry = result["metrics"]["comparableAdjustments"]["entries"][0]
        self.assertEqual(entry["componentAdjustmentTotal"], 500)
        self.assertEqual(entry["expectedAdjustedValue"], 19_500)
        self.assertEqual(entry["difference"], 1)
        self.assertFalse(entry["reconciled"])

    def test_all_null_breakdown_with_nonzero_net_is_undisclosed(self) -> None:
        comparable = make_comparable(
            package=None,
            options=None,
            mileage_adjustment=None,
            condition=None,
            adjusted_value=19_250,
            contribution=None,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "UNDISCLOSED_COMPARABLE_ADJUSTMENTS", "REVIEW", count=1
        )
        self.assertEqual(finding["comparableNumbers"], [1])
        pairs = evidence_pairs(finding)
        self.assertIn(("$.comparables[0].listPrice", "19000"), pairs)
        self.assertIn(("$.comparables[0].adjustedValue", "19250"), pairs)
        entry = result["metrics"]["comparableAdjustments"]["entries"][0]
        self.assertEqual(entry["netAdjustment"], 250)
        self.assertEqual(entry["disclosure"], "none")
        self.assertIsNone(entry["componentAdjustmentTotal"])
        self.assertIsNone(entry["expectedAdjustedValue"])

    def test_partially_disclosed_breakdown_is_unverifiable(self) -> None:
        comparable = make_comparable(
            package=100,
            options=None,
            mileage_adjustment=0,
            condition=0,
            adjusted_value=19_100,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        self.assert_finding(
            result, "PARTIAL_COMPARABLE_ADJUSTMENTS", "REVIEW", count=1
        )
        self.assertFalse(
            any(
                finding["code"] == "COMPARABLE_ADJUSTMENT_RECONCILIATION"
                and finding["status"] == "WARNING"
                for finding in result["findings"]
            )
        )

    def test_null_component_is_not_treated_as_zero_even_when_net_is_zero(self) -> None:
        comparable = make_comparable(
            package=None,
            options=0,
            mileage_adjustment=0,
            condition=0,
            adjusted_value=19_000,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "PARTIAL_COMPARABLE_ADJUSTMENTS", "REVIEW", count=1
        )
        self.assertIn(
            ("$.comparables[0].adjustments.package", "null"),
            evidence_pairs(finding),
        )
        entry = result["metrics"]["comparableAdjustments"]["entries"][0]
        self.assertEqual(entry["disclosure"], "partial")
        self.assertIsNone(entry["componentAdjustmentTotal"])
        self.assertIsNone(entry["expectedAdjustedValue"])

    def test_positive_component_adjustments_are_added(self) -> None:
        comparable = make_comparable(
            mileage=50_000,
            package=100,
            options=50,
            mileage_adjustment=0,
            condition=25,
            adjusted_value=19_175,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        self.assert_finding(
            result, "COMPARABLE_ADJUSTMENT_RECONCILIATION", "PASS", count=1
        )

    def test_negative_component_adjustments_are_subtracted(self) -> None:
        comparable = make_comparable(
            mileage=50_000,
            package=-100,
            options=-50,
            mileage_adjustment=0,
            condition=-25,
            adjusted_value=18_825,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        self.assert_finding(
            result, "COMPARABLE_ADJUSTMENT_RECONCILIATION", "PASS", count=1
        )


class MileageDirectionTests(AnalyzerTestCase):
    def test_lower_mileage_with_negative_adjustment_is_consistent(self) -> None:
        comparable = make_comparable(
            mileage=40_000,
            package=0,
            options=0,
            mileage_adjustment=-100,
            condition=0,
            adjusted_value=18_900,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "MILEAGE_ADJUSTMENT_DIRECTION", "PASS", count=1
        )
        self.assertEqual(finding["comparableNumbers"], [1])

    def test_higher_mileage_with_positive_adjustment_is_consistent(self) -> None:
        result = analyze_report(make_report())

        self.assert_finding(
            result, "MILEAGE_ADJUSTMENT_DIRECTION", "PASS", count=1
        )

    def test_equal_mileage_with_zero_adjustment_is_consistent(self) -> None:
        comparable = make_comparable(
            mileage=50_000,
            package=0,
            options=0,
            mileage_adjustment=0,
            condition=0,
            adjusted_value=19_000,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        self.assert_finding(
            result, "MILEAGE_ADJUSTMENT_DIRECTION", "PASS", count=1
        )

    def test_inconsistent_mileage_direction_is_review(self) -> None:
        comparable = make_comparable(
            mileage=40_000,
            package=0,
            options=0,
            mileage_adjustment=100,
            condition=0,
            adjusted_value=19_100,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "MILEAGE_ADJUSTMENT_DIRECTION", "REVIEW", count=1
        )
        self.assertEqual(finding["comparableNumbers"], [1])

    def test_missing_comparable_mileage_is_review(self) -> None:
        comparable = make_comparable(
            mileage=None,
            package=None,
            options=None,
            mileage_adjustment=None,
            condition=None,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "MISSING_COMPARABLE_MILEAGE", "REVIEW", count=1
        )
        self.assertIn(("$.comparables[0].mileage", "null"), evidence_pairs(finding))

    def test_missing_mileage_adjustment_is_unavailable_not_zero(self) -> None:
        comparable = make_comparable(
            mileage=40_000,
            package=None,
            options=None,
            mileage_adjustment=None,
            condition=None,
            adjusted_value=18_900,
        )

        result = analyze_report(make_report(comparables=[comparable]))

        self.assert_no_finding(result, "MILEAGE_ADJUSTMENT_DIRECTION")
        self.assert_finding(
            result, "UNDISCLOSED_COMPARABLE_ADJUSTMENTS", "REVIEW", count=1
        )


class ComparableDataQualityTests(AnalyzerTestCase):
    def test_comparable_count_is_exposed_without_assuming_twelve(self) -> None:
        comparables = [make_comparable(number=number) for number in range(1, 4)]

        result = analyze_report(make_report(comparables=comparables))

        self.assertEqual(result["summary"]["comparableCount"], 3)

    def test_duplicate_comparable_number_is_warning(self) -> None:
        comparables = [make_comparable(number=1), make_comparable(number=1)]

        result = analyze_report(make_report(comparables=comparables))

        finding = self.assert_finding(
            result, "DUPLICATE_COMPARABLE_NUMBER", "WARNING", count=1
        )
        self.assertEqual(finding["comparableNumbers"], [1])
        self.assertTrue(
            any(path == "$.comparables[1].number" for path, _ in evidence_pairs(finding))
        )

    def test_duplicate_nonempty_vin_is_review(self) -> None:
        comparables = [make_comparable(number=1), make_comparable(number=2)]
        comparables[0]["vin"] = "1TESTVIN000000001"
        comparables[1]["vin"] = "1testvin000000001"

        result = analyze_report(make_report(comparables=comparables))

        finding = self.assert_finding(
            result, "DUPLICATE_COMPARABLE_VIN", "REVIEW", count=1
        )
        self.assertEqual(finding["comparableNumbers"], [1, 2])
        self.assertIn(
            ("$.comparables[1].vin", '"1testvin000000001"'),
            evidence_pairs(finding),
        )

    def test_missing_number_in_sequence_is_warning(self) -> None:
        comparables = [make_comparable(number=1), make_comparable(number=3)]

        result = analyze_report(make_report(comparables=comparables))

        finding = self.assert_finding(
            result, "COMPARABLE_NUMBER_SEQUENCE", "WARNING", count=1
        )
        self.assertIn(2, finding["comparableNumbers"])
        self.assertTrue(finding["evidence"])
        self.assertEqual(
            result["metrics"]["comparableNumbering"]["missingSequenceNumbers"],
            [2],
        )

    def test_null_comparable_number_is_review(self) -> None:
        result = analyze_report(
            make_report(comparables=[make_comparable(number=None)])
        )

        finding = self.assert_finding(
            result, "MISSING_COMPARABLE_NUMBER", "REVIEW", count=1
        )
        self.assertIn(("$.comparables[0].number", "null"), evidence_pairs(finding))
        self.assert_no_finding(result, "COMPARABLE_NUMBER_SEQUENCE")
        self.assertEqual(
            result["metrics"]["comparableNumbering"]["missingSequenceNumbers"],
            [],
        )

    def test_integral_float_comparable_number_is_usable(self) -> None:
        report = make_report(comparables=[make_comparable(number=1.0)])

        result = analyze_report(report)

        self.assert_no_finding(result, "MISSING_COMPARABLE_NUMBER")
        self.assert_no_finding(result, "COMPARABLE_NUMBER_SEQUENCE")
        self.assert_finding(result, "COMPARABLE_NUMBERING", "PASS", count=1)

    def test_missing_list_price_is_review(self) -> None:
        comparable = make_comparable(list_price=None, adjusted_value=19_500)

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "MISSING_LIST_PRICE", "REVIEW", count=1
        )
        self.assertIn(
            ("$.comparables[0].listPrice", "null"), evidence_pairs(finding)
        )

    def test_missing_adjusted_value_is_review(self) -> None:
        comparable = make_comparable(adjusted_value=None)

        result = analyze_report(make_report(comparables=[comparable]))

        finding = self.assert_finding(
            result, "MISSING_ADJUSTED_VALUE", "REVIEW", count=1
        )
        self.assertIn(
            ("$.comparables[0].adjustedValue", "null"), evidence_pairs(finding)
        )


class AttributeDifferenceTests(AnalyzerTestCase):
    def assert_attribute_difference(
        self, field: str, value: Any, code: str
    ) -> dict[str, Any]:
        comparable = make_comparable(**{field: value})
        result = analyze_report(make_report(comparables=[comparable]))
        finding = self.assert_finding(result, code, "REVIEW", count=1)
        self.assertEqual(finding["comparableNumbers"], [1])
        self.assertTrue(
            any(
                path == f"$.comparables[0].{field}"
                for path, _ in evidence_pairs(finding)
            )
        )
        return finding

    def test_different_year_is_review(self) -> None:
        self.assert_attribute_difference(
            "year", 2023, "COMPARABLE_YEAR_DIFFERENCE"
        )

    def test_different_make_is_review(self) -> None:
        self.assert_attribute_difference(
            "make", "Other", "COMPARABLE_MAKE_DIFFERENCE"
        )

    def test_different_model_is_review(self) -> None:
        self.assert_attribute_difference(
            "model", "Hatchback", "COMPARABLE_MODEL_DIFFERENCE"
        )

    def test_different_trim_is_review(self) -> None:
        self.assert_attribute_difference(
            "trim", "Limited", "COMPARABLE_TRIM_DIFFERENCE"
        )


class ComparableStatisticsTests(AnalyzerTestCase):
    def analyze_values(
        self, adjusted_values: list[float], mileages: list[int] | None = None
    ) -> dict[str, Any]:
        if mileages is None:
            mileages = [50_000] * len(adjusted_values)
        comparables = []
        for index, (adjusted_value, mileage) in enumerate(
            zip(adjusted_values, mileages), start=1
        ):
            comparables.append(
                make_comparable(
                    number=index,
                    mileage=mileage,
                    list_price=adjusted_value,
                    package=0,
                    options=0,
                    mileage_adjustment=0,
                    condition=0,
                    adjusted_value=adjusted_value,
                    contribution=100 / len(adjusted_values),
                )
            )
        return analyze_report(make_report(comparables=comparables))

    def test_adjusted_value_statistics(self) -> None:
        result = self.analyze_values([10, 20, 30])
        stats = metric_section(
            result, "comparableAdjustedValues", "adjustedValueStatistics"
        )

        self.assertEqual(stats["count"], 3)
        self.assertEqual(stats["minimum"], 10)
        self.assertEqual(stats["maximum"], 30)
        self.assertEqual(stats["range"], 20)
        self.assertEqual(stats["mean"], 20)
        self.assertEqual(stats["median"], 20)

    def test_odd_median_is_middle_value(self) -> None:
        result = self.analyze_values([100, 10, 20])
        stats = metric_section(
            result, "comparableAdjustedValues", "adjustedValueStatistics"
        )
        self.assertEqual(stats["median"], 20)

    def test_even_median_averages_middle_values(self) -> None:
        result = self.analyze_values([100, 10, 30, 20])
        stats = metric_section(
            result, "comparableAdjustedValues", "adjustedValueStatistics"
        )
        self.assertEqual(stats["median"], 25)

    def test_missing_adjusted_value_is_excluded_from_statistics(self) -> None:
        report = make_report(
            comparables=[
                make_comparable(number=1, adjusted_value=10),
                make_comparable(number=2, adjusted_value=None),
                make_comparable(number=3, adjusted_value=30),
            ]
        )

        result = analyze_report(report)
        stats = metric_section(
            result, "comparableAdjustedValues", "adjustedValueStatistics"
        )

        self.assertEqual(stats["count"], 2)
        self.assertEqual(stats["median"], 20)

    def test_mileage_statistics_and_loss_vehicle_differences(self) -> None:
        result = self.analyze_values([10, 20, 30], [40_000, 50_000, 70_000])
        stats = metric_section(result, "comparableMileage", "mileageStatistics")

        self.assertEqual(stats["count"], 3)
        self.assertEqual(stats["minimum"], 40_000)
        self.assertEqual(stats["maximum"], 70_000)
        self.assertEqual(stats["mean"], 160_000 / 3)
        self.assertEqual(stats["median"], 50_000)
        differences = [
            entry["differenceFromLossVehicle"] for entry in stats["entries"]
        ]
        self.assertEqual(differences, [-10_000, 0, 20_000])


class ContributionTests(AnalyzerTestCase):
    def contribution_result(self, values: list[float | None]) -> dict[str, Any]:
        comparables = [
            make_comparable(number=index, contribution=value)
            for index, value in enumerate(values, start=1)
        ]
        return analyze_report(make_report(comparables=comparables))

    def contribution_metrics(self, result: dict[str, Any]) -> dict[str, Any]:
        return metric_section(
            result, "contributionPercentages", "contributions"
        )

    def test_contribution_percentages_total_100(self) -> None:
        result = self.contribution_result([40, 60])
        metrics = self.contribution_metrics(result)

        self.assertEqual(metrics["availableCount"], 2)
        self.assertEqual(metrics["displayedSum"], 100)
        self.assertEqual(metrics["availability"], "complete")
        self.assert_finding(
            result, "CONTRIBUTION_PERCENTAGES", "PASS", count=1
        )

    def test_contribution_percentages_not_100_are_review_not_warning(self) -> None:
        result = self.contribution_result([48, 50])
        metrics = self.contribution_metrics(result)

        self.assertEqual(metrics["displayedSum"], 98)
        finding = self.assert_finding(
            result, "CONTRIBUTION_PERCENTAGES", "REVIEW", count=1
        )
        self.assertIn("rounded", finding["description"].lower())

    def test_absent_contribution_percentages_are_unavailable(self) -> None:
        result = self.contribution_result([None, None])
        metrics = self.contribution_metrics(result)

        self.assertEqual(metrics["availableCount"], 0)
        self.assertIsNone(metrics["displayedSum"])
        self.assertEqual(metrics["availability"], "unavailable")
        self.assert_finding(
            result, "CONTRIBUTION_PERCENTAGES", "REVIEW", count=1
        )

    def test_partial_contributions_are_not_summed_as_complete_weighting(self) -> None:
        result = self.contribution_result([60, None])
        metrics = self.contribution_metrics(result)

        self.assertEqual(metrics["availableCount"], 1)
        self.assertEqual(metrics["displayedSum"], 60)
        self.assertEqual(metrics["availability"], "partial")
        self.assert_finding(
            result, "CONTRIBUTION_PERCENTAGES", "REVIEW", count=1
        )


class OutputContractTests(AnalyzerTestCase):
    def test_analysis_version_summary_metrics_and_findings_are_stable(self) -> None:
        result = analyze_report(make_report())

        self.assertEqual(result["analysisVersion"], "1")
        self.assertEqual(
            set(result), {"analysisVersion", "summary", "metrics", "findings"}
        )
        self.assertIsInstance(result["findings"], list)

    def test_every_review_and_warning_has_nonempty_source_evidence(self) -> None:
        comparable = make_comparable(
            mileage=None,
            list_price=None,
            package=None,
            options=None,
            mileage_adjustment=None,
            condition=None,
            adjusted_value=20_000,
            contribution=None,
        )
        report = make_report(comparables=[comparable])
        report["valuation"]["adjustedVehicleValue"] = 0

        result = analyze_report(report)

        review_or_warning = [
            finding
            for finding in result["findings"]
            if finding["status"] in {"REVIEW", "WARNING"}
        ]
        self.assertTrue(review_or_warning)
        for finding in review_or_warning:
            with self.subTest(code=finding["code"]):
                self.assertTrue(finding["evidence"])
                self.assertTrue(
                    all(item["path"].startswith("$.") for item in finding["evidence"])
                )

    def test_analysis_does_not_mutate_input(self) -> None:
        report = make_report()
        original = copy.deepcopy(report)

        analyze_report(report)

        self.assertEqual(report, original)

    def test_generated_output_validates_against_analysis_schema(self) -> None:
        schema = read_schema(ANALYSIS_SCHEMA_PATH)
        result = analyze_report(make_report())

        validate_json(result, schema, "analysis output")

    def test_invalid_output_is_rejected_by_analysis_schema(self) -> None:
        schema = read_schema(ANALYSIS_SCHEMA_PATH)
        result = analyze_report(make_report())
        result["findings"][0]["status"] = "ACCUSATION"

        with self.assertRaises(AnalysisError):
            validate_json(result, schema, "analysis output")


class RealBenchmarkBehaviorTests(AnalyzerTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.camry = load_benchmark("camry")
        cls.elantra = load_benchmark("elantra")

    def test_camry_known_analysis_behavior(self) -> None:
        result = analyze_report(copy.deepcopy(self.camry))

        self.assertEqual(result["summary"]["comparableCount"], 11)
        self.assert_finding(result, "VALUATION_ARITHMETIC", "PASS", count=1)
        undisclosed = self.assert_finding(
            result, "UNDISCLOSED_COMPARABLE_ADJUSTMENTS", "REVIEW", count=1
        )
        self.assertEqual(undisclosed["comparableNumbers"], list(range(1, 12)))
        adjusted_stats = result["metrics"]["comparableAdjustedValues"]
        self.assertEqual(adjusted_stats["count"], 11)
        self.assertEqual(adjusted_stats["minimum"], 28_081)
        self.assertEqual(adjusted_stats["maximum"], 35_832)
        self.assertEqual(adjusted_stats["range"], 7_751)
        self.assertAlmostEqual(adjusted_stats["mean"], 31_008.454545454544)
        self.assertEqual(adjusted_stats["median"], 31_215)
        missing_mileage = self.assert_finding(
            result, "MISSING_COMPARABLE_MILEAGE", "REVIEW", count=1
        )
        self.assertEqual(missing_mileage["comparableNumbers"], [9, 10, 11])
        self.assertEqual(
            sum(
                all(value is None for value in row["adjustments"].values())
                and row["adjustedValue"] != row["listPrice"]
                for row in self.camry["comparables"]
            ),
            11,
        )

    def test_elantra_known_analysis_behavior(self) -> None:
        result = analyze_report(copy.deepcopy(self.elantra))

        self.assertEqual(result["summary"]["comparableCount"], 12)
        condition = self.assert_finding(
            result,
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "PASS",
            count=1,
        )
        self.assertIn(
            ("$.condition.totalAdjustment", "297"), evidence_pairs(condition)
        )

        reconciled = self.assert_finding(
            result,
            "COMPARABLE_ADJUSTMENT_RECONCILIATION",
            "PASS",
            count=1,
        )
        self.assertEqual(reconciled["comparableNumbers"], list(range(1, 7)))

        undisclosed = self.assert_finding(
            result, "UNDISCLOSED_COMPARABLE_ADJUSTMENTS", "REVIEW", count=1
        )
        self.assertEqual(undisclosed["comparableNumbers"], list(range(7, 13)))
        adjustment_entries = result["metrics"]["comparableAdjustments"]["entries"]
        for entry in adjustment_entries[6:]:
            self.assertEqual(entry["disclosure"], "none")
            self.assertIsNone(entry["componentAdjustmentTotal"])
            self.assertIsNone(entry["expectedAdjustedValue"])

        adjusted_stats = result["metrics"]["comparableAdjustedValues"]
        self.assertEqual(adjusted_stats["count"], 12)
        self.assertEqual(adjusted_stats["minimum"], 16_763)
        self.assertEqual(adjusted_stats["maximum"], 20_318)
        self.assertEqual(adjusted_stats["range"], 3_555)
        self.assertAlmostEqual(adjusted_stats["mean"], 18_718.416666666668)
        self.assertEqual(adjusted_stats["median"], 18_841)

        direction = self.assert_finding(
            result, "MILEAGE_ADJUSTMENT_DIRECTION", "PASS", count=1
        )
        self.assertEqual(direction["comparableNumbers"], list(range(1, 7)))

    def test_benchmark_inputs_are_not_mutated(self) -> None:
        for report in (self.camry, self.elantra):
            with self.subTest(vehicle=report["vehicle"]["model"]):
                original = copy.deepcopy(report)
                analyze_report(report)
                self.assertEqual(report, original)


class AnalyzerCliTests(unittest.TestCase):
    def test_canonical_and_analysis_schema_constants_exist(self) -> None:
        self.assertTrue(CANONICAL_SCHEMA_PATH.is_file())
        self.assertTrue(ANALYSIS_SCHEMA_PATH.is_file())

    def test_load_json_returns_object(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text('{"vehicle": {}}', encoding="utf-8")

            self.assertEqual(load_json(path), {"vehicle": {}})

    def test_load_json_rejects_malformed_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text("{", encoding="utf-8")

            with self.assertRaises(AnalysisError):
                load_json(path)

    def test_load_json_rejects_non_object_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text("[]", encoding="utf-8")

            with self.assertRaises(AnalysisError):
                load_json(path)

    def test_load_json_rejects_exponent_overflow(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text(
                '{"valuation": {"baseVehicleValue": 1e309}}',
                encoding="utf-8",
            )

            with self.assertRaises(AnalysisError):
                load_json(path)

    def test_read_schema_rejects_invalid_schema(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.schema.json"
            path.write_text('{"type": "not-a-json-schema-type"}', encoding="utf-8")

            with self.assertRaises(AnalysisError):
                read_schema(path)

    def test_write_output_uses_atomic_replace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "nested" / "analysis.json"
            real_replace = os.replace
            with patch("scripts.analyze_report.os.replace", wraps=real_replace) as replace:
                write_output(output_path, {"analysisVersion": "1"})

            replace.assert_called_once()
            temporary_path, destination = replace.call_args.args
            self.assertEqual(Path(destination), output_path)
            self.assertEqual(Path(temporary_path).parent, output_path.parent)
            self.assertFalse(Path(temporary_path).exists())
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8")),
                {"analysisVersion": "1"},
            )

    def test_write_output_cleans_temporary_file_when_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "analysis.json"
            with patch(
                "scripts.analyze_report.os.replace", side_effect=OSError("replace failed")
            ):
                with self.assertRaises(AnalysisError):
                    write_output(output_path, {"analysisVersion": "1"})

            self.assertFalse(output_path.exists())
            self.assertEqual(list(Path(directory).glob(".*.tmp")), [])

    def test_cli_writes_valid_analysis_without_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.json"
            output_path = Path(directory) / "output.json"
            input_path.write_text(json.dumps(make_report()), encoding="utf-8")
            stdout = io.StringIO()
            stderr = io.StringIO()

            with (
                patch.dict(os.environ, {}, clear=True),
                redirect_stdout(stdout),
                redirect_stderr(stderr),
            ):
                return_code = main([str(input_path), str(output_path)])

            self.assertEqual(return_code, 0, stderr.getvalue())
            self.assertTrue(output_path.is_file())
            result = json.loads(output_path.read_text(encoding="utf-8"))
            validate_json(result, read_schema(ANALYSIS_SCHEMA_PATH), "analysis output")
            self.assertIn("Analyzed", stdout.getvalue())
            self.assertEqual(stderr.getvalue(), "")

    def test_cli_returns_nonzero_for_malformed_input(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "bad.json"
            output_path = Path(directory) / "output.json"
            input_path.write_text("{", encoding="utf-8")
            stderr = io.StringIO()

            with redirect_stderr(stderr):
                return_code = main([str(input_path), str(output_path)])

            self.assertNotEqual(return_code, 0)
            self.assertFalse(output_path.exists())
            self.assertIn("Error:", stderr.getvalue())

    def test_cli_validates_canonical_input_before_analysis(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "bad-report.json"
            output_path = Path(directory) / "output.json"
            # Canonical schema permits sparse objects but comparables must be an array.
            input_path.write_text('{"comparables": "not-an-array"}', encoding="utf-8")
            stderr = io.StringIO()

            with redirect_stderr(stderr):
                return_code = main([str(input_path), str(output_path)])

            self.assertNotEqual(return_code, 0)
            self.assertFalse(output_path.exists())
            self.assertIn("canonical", stderr.getvalue().lower())


if __name__ == "__main__":
    unittest.main()
