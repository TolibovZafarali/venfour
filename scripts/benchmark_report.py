#!/usr/bin/env python3
"""Compare a CCC extraction with a manually verified benchmark subset.

Benchmark JSON intentionally contains only fields that a person verified.  The
comparison is therefore subset-based: additional extraction fields are ignored,
while every benchmark field must be present and exactly equal.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


class _MissingValue:
    def __repr__(self) -> str:
        return "<missing>"


MISSING = _MissingValue()


@dataclass(frozen=True)
class BenchmarkMismatch:
    """One benchmark mismatch with machine-readable values and a JSON path."""

    path: str
    expected: Any
    actual: Any
    message: str | None = None

    def __str__(self) -> str:
        detail = f" ({self.message})" if self.message else ""
        return (
            f"{self.path}: expected={format_json_value(self.expected)}, "
            f"actual={format_json_value(self.actual)}{detail}"
        )


def format_json_value(value: Any) -> str:
    """Render mismatch values consistently, including the missing sentinel."""

    if value is MISSING:
        return "<missing>"
    if isinstance(value, Decimal):
        return format(value, "f")
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError):
        return repr(value)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)


def _as_decimal(value: Any) -> Decimal | None:
    if not _is_number(value):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _values_equal(expected: Any, actual: Any) -> bool:
    """Compare JSON values without a numeric tolerance.

    JSON does not distinguish ``1`` from ``1.0`` semantically, so numeric types
    may differ when their exact decimal values are the same.  Booleans never
    compare as numbers, and non-finite floats never compare equal.
    """

    if _is_number(expected) or _is_number(actual):
        expected_decimal = _as_decimal(expected)
        actual_decimal = _as_decimal(actual)
        return (
            expected_decimal is not None
            and actual_decimal is not None
            and expected_decimal == actual_decimal
        )
    return type(expected) is type(actual) and expected == actual


def _child_path(path: str, key: str) -> str:
    if key.isidentifier():
        return f"{path}.{key}"
    return f"{path}[{json.dumps(key, ensure_ascii=False)}]"


def _compare_subset(
    expected: Any,
    actual: Any,
    path: str,
    mismatches: list[BenchmarkMismatch],
) -> None:
    if isinstance(expected, Mapping):
        if not isinstance(actual, Mapping):
            mismatches.append(BenchmarkMismatch(path, expected, actual))
            return
        for key, expected_value in expected.items():
            child_path = _child_path(path, str(key))
            if key not in actual:
                mismatches.append(
                    BenchmarkMismatch(child_path, expected_value, MISSING)
                )
                continue
            _compare_subset(expected_value, actual[key], child_path, mismatches)
        return

    if isinstance(expected, list):
        if not isinstance(actual, list):
            mismatches.append(BenchmarkMismatch(path, expected, actual))
            return
        if len(expected) != len(actual):
            mismatches.append(
                BenchmarkMismatch(f"{path}.length", len(expected), len(actual))
            )
        for index, (expected_value, actual_value) in enumerate(
            zip(expected, actual)
        ):
            _compare_subset(
                expected_value,
                actual_value,
                f"{path}[{index}]",
                mismatches,
            )
        return

    if not _values_equal(expected, actual):
        mismatches.append(BenchmarkMismatch(path, expected, actual))


def _comparable_number(row: Any) -> Any:
    if not isinstance(row, Mapping):
        return MISSING
    return row.get("number", MISSING)


def _compare_comparables(
    expected: Any,
    actual: Any,
    mismatches: list[BenchmarkMismatch],
) -> None:
    path = "$.comparables"
    if not isinstance(expected, list):
        raise ValueError("benchmark comparables must be an array")
    if not isinstance(actual, list):
        mismatches.append(BenchmarkMismatch(path, expected, actual))
        return

    expected_numbers = [_comparable_number(row) for row in expected]
    if any(
        not isinstance(number, int) or isinstance(number, bool)
        for number in expected_numbers
    ):
        raise ValueError("every benchmark comparable must have an integer number")
    if len(set(expected_numbers)) != len(expected_numbers):
        raise ValueError("benchmark comparable numbers must be unique")

    if len(expected) != len(actual):
        mismatches.append(
            BenchmarkMismatch(f"{path}.length", len(expected), len(actual))
        )

    actual_numbers = [_comparable_number(row) for row in actual]
    if actual_numbers != expected_numbers:
        mismatches.append(
            BenchmarkMismatch(
                f"{path}[*].number",
                expected_numbers,
                actual_numbers,
                "comparable numbers must be complete and in benchmark order",
            )
        )

    indexes_by_number: dict[int, list[int]] = defaultdict(list)
    for index, number in enumerate(actual_numbers):
        if not isinstance(number, int) or isinstance(number, bool):
            mismatches.append(
                BenchmarkMismatch(
                    f"{path}[{index}].number",
                    "integer comparable number",
                    number,
                )
            )
            continue
        indexes_by_number[number].append(index)

    for number, indexes in indexes_by_number.items():
        for duplicate_index in indexes[1:]:
            mismatches.append(
                BenchmarkMismatch(
                    f"{path}[{duplicate_index}].number",
                    "unique comparable number",
                    number,
                    f"first occurrence is at index {indexes[0]}",
                )
            )

    expected_number_set = set(expected_numbers)
    for index, number in enumerate(actual_numbers):
        if (
            isinstance(number, int)
            and not isinstance(number, bool)
            and number not in expected_number_set
        ):
            mismatches.append(
                BenchmarkMismatch(
                    f"{path}[{index}].number",
                    MISSING,
                    number,
                    "unexpected comparable number",
                )
            )

    for expected_row, number in zip(expected, expected_numbers):
        indexes = indexes_by_number.get(number, [])
        row_path = f"{path}[number={number}]"
        if not indexes:
            mismatches.append(
                BenchmarkMismatch(
                    row_path,
                    expected_row,
                    MISSING,
                    "missing comparable number",
                )
            )
            continue
        actual_row = actual[indexes[0]]
        _compare_subset(expected_row, actual_row, row_path, mismatches)


def _condition_value_impacts(actual_condition: Mapping[str, Any]) -> list[tuple[int, Any]]:
    items = actual_condition.get("items", MISSING)
    if not isinstance(items, list):
        return []

    nonzero: list[tuple[int, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            nonzero.append((index, item))
            continue
        value = item.get("valueImpact", MISSING)
        if value is MISSING or value is None:
            continue
        decimal = _as_decimal(value)
        if decimal is not None and decimal == 0:
            continue
        nonzero.append((index, value))
    return nonzero


def _compare_condition(
    expected: Any,
    actual: Any,
    mismatches: list[BenchmarkMismatch],
) -> None:
    path = "$.condition"
    if not isinstance(expected, Mapping):
        raise ValueError("benchmark condition must be an object")
    if not isinstance(actual, Mapping):
        mismatches.append(BenchmarkMismatch(path, expected, actual))
        return

    for key, expected_value in expected.items():
        if key == "nonzeroValueImpacts":
            continue
        child_path = _child_path(path, str(key))
        if key not in actual:
            mismatches.append(BenchmarkMismatch(child_path, expected_value, MISSING))
        else:
            _compare_subset(expected_value, actual[key], child_path, mismatches)

    if "nonzeroValueImpacts" not in expected:
        return

    expected_values = expected["nonzeroValueImpacts"]
    if not isinstance(expected_values, list):
        raise ValueError("condition.nonzeroValueImpacts must be an array")

    actual_items = actual.get("items", MISSING)
    logical_path = f"{path}.items[*].valueImpact(nonzero)"
    if not isinstance(actual_items, list):
        mismatches.append(BenchmarkMismatch(logical_path, expected_values, MISSING))
        return

    indexed_values = _condition_value_impacts(actual)
    actual_values = [value for _, value in indexed_values]
    if len(expected_values) != len(actual_values):
        mismatches.append(
            BenchmarkMismatch(
                f"{logical_path}.length",
                len(expected_values),
                len(actual_values),
            )
        )

    for position, (expected_value, indexed_actual) in enumerate(
        zip(expected_values, indexed_values)
    ):
        item_index, actual_value = indexed_actual
        if not _values_equal(expected_value, actual_value):
            mismatches.append(
                BenchmarkMismatch(
                    f"{path}.items[{item_index}].valueImpact",
                    expected_value,
                    actual_value,
                    f"nonzero condition value at position {position}",
                )
            )

    expected_total = expected.get("totalAdjustment", MISSING)
    if expected_total is MISSING:
        return

    decimals = [_as_decimal(value) for value in actual_values]
    if any(value is None for value in decimals):
        actual_total: Any = "cannot sum non-numeric condition value impacts"
    else:
        actual_total = sum((value for value in decimals if value is not None), Decimal(0))
    if not _values_equal(expected_total, actual_total):
        mismatches.append(
            BenchmarkMismatch(
                f"{logical_path}.sum",
                expected_total,
                actual_total,
                "nonzero condition values must total the verified adjustment",
            )
        )


def compare_benchmark(
    benchmark: Mapping[str, Any], actual: Mapping[str, Any]
) -> list[BenchmarkMismatch]:
    """Return every mismatch between a benchmark subset and an extraction.

    Comparable rows are matched by their printed ``number`` rather than list
    position.  Count, numeric order, uniqueness, and unexpected numbers are also
    checked.  A benchmark condition may use the special verified-only field
    ``nonzeroValueImpacts``; it is compared with nonzero ``condition.items`` values
    in the extraction and its exact sum is checked against ``totalAdjustment``.
    """

    if not isinstance(benchmark, Mapping):
        raise TypeError("benchmark must be a JSON object")
    if not isinstance(actual, Mapping):
        return [BenchmarkMismatch("$", benchmark, actual)]

    mismatches: list[BenchmarkMismatch] = []
    for key, expected_value in benchmark.items():
        path = _child_path("$", str(key))
        if key not in actual:
            mismatches.append(BenchmarkMismatch(path, expected_value, MISSING))
            continue
        if key == "comparables":
            _compare_comparables(expected_value, actual[key], mismatches)
        elif key == "condition":
            _compare_condition(expected_value, actual[key], mismatches)
        else:
            _compare_subset(expected_value, actual[key], path, mismatches)
    return mismatches


def load_json(path: Path | str) -> Any:
    """Load strict JSON from ``path`` and reject non-finite numeric constants."""

    json_path = Path(path)

    def reject_constant(value: str) -> Any:
        raise ValueError(f"non-finite JSON number {value}")

    with json_path.open(encoding="utf-8") as json_file:
        return json.load(json_file, parse_constant=reject_constant)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare extracted CCC JSON with a verified benchmark subset."
    )
    parser.add_argument("benchmark_json", type=Path)
    parser.add_argument("actual_json", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        benchmark = load_json(args.benchmark_json)
        actual = load_json(args.actual_json)
        mismatches = compare_benchmark(benchmark, actual)
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if mismatches:
        print(f"FAIL: {len(mismatches)} benchmark mismatch(es)")
        for mismatch in mismatches:
            print(f"  - {mismatch}")
        return 1

    print("PASS: all verified benchmark fields match")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
