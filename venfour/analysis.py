"""Deterministic analysis of canonical CCC valuation report data.

This module consumes already-extracted JSON-shaped mappings. It performs no
network access and has no dependency on the extraction implementation.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any


ANALYSIS_VERSION = "1"
ADJUSTMENT_FIELDS = ("package", "options", "mileage", "condition")
FINDING_STATUSES = ("PASS", "REVIEW", "WARNING")


def _decimal(value: Any) -> Decimal | None:
    """Return a finite Decimal for a JSON number, excluding booleans."""

    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return result if result.is_finite() else None


def _json_number(value: Decimal | None) -> int | float | None:
    """Convert an internal Decimal to a JSON-compatible finite number."""

    if value is None:
        return None
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def _number(value: Any) -> int | float | None:
    return _json_number(_decimal(value))


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _comparable_number(comparable: Mapping[str, Any]) -> int | None:
    number = comparable.get("number")
    if isinstance(number, int) and not isinstance(number, bool):
        return number
    if isinstance(number, float) and math.isfinite(number) and number.is_integer():
        return int(number)
    if isinstance(number, Decimal) and number.is_finite() and number == number.to_integral_value():
        return int(number)
    return None


def _format_number(value: Decimal | None) -> str:
    if value is None:
        return "unavailable"
    return format(value, "f")


def _statistics(values: list[Decimal]) -> dict[str, int | float | None]:
    if not values:
        return {
            "minimum": None,
            "maximum": None,
            "range": None,
            "mean": None,
            "median": None,
        }

    ordered = sorted(values)
    minimum = ordered[0]
    maximum = ordered[-1]
    count = len(ordered)
    midpoint = count // 2
    if count % 2:
        median = ordered[midpoint]
    else:
        median = (ordered[midpoint - 1] + ordered[midpoint]) / Decimal(2)

    return {
        "minimum": _json_number(minimum),
        "maximum": _json_number(maximum),
        "range": _json_number(maximum - minimum),
        "mean": _json_number(sum(ordered, Decimal(0)) / Decimal(count)),
        "median": _json_number(median),
    }


def _mileage_statistics(values: list[Decimal]) -> dict[str, int | float | None]:
    statistics = _statistics(values)
    statistics.pop("range")
    return statistics


def _normalized_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).casefold()
    return normalized or None


def _evidence(path: str, value: Any) -> dict[str, Any]:
    return {"path": path, "value": value}


def _valid_numbers(comparables: list[Mapping[str, Any]], indexes: list[int]) -> list[int]:
    return [
        number
        for index in indexes
        if (number := _comparable_number(comparables[index])) is not None
    ]


def analyze_report(report: Mapping[str, Any]) -> dict[str, Any]:
    """Return deterministic, frontend-friendly analysis for canonical report data.

    The function does not mutate ``report``. Missing optional data becomes a
    REVIEW finding or an unavailable metric; only definite arithmetic or
    structural contradictions become WARNING findings.
    """

    if not isinstance(report, Mapping):
        raise TypeError("report must be a JSON object")

    evidence_v2 = report.get("schemaVersion") == "2"
    findings: list[dict[str, Any]] = []

    def add_finding(
        code: str,
        status: str,
        category: str,
        title: str,
        description: str,
        evidence: list[dict[str, Any]],
        comparable_numbers: list[int] | None = None,
    ) -> None:
        if status not in FINDING_STATUSES:
            raise ValueError(f"unsupported finding status: {status}")
        findings.append(
            {
                "code": code,
                "status": status,
                "category": category,
                "title": title,
                "description": description,
                "comparableNumbers": comparable_numbers or [],
                "evidence": evidence,
            }
        )

    valuation = _mapping(report.get("valuation"))
    base_value = _decimal(valuation.get("baseVehicleValue"))
    condition_adjustment = _decimal(valuation.get("conditionAdjustment"))
    adjusted_vehicle_value = _decimal(valuation.get("adjustedVehicleValue"))
    total = _decimal(valuation.get("total"))

    valuation_evidence = [
        _evidence("$.valuation.baseVehicleValue", _number(valuation.get("baseVehicleValue"))),
        _evidence(
            "$.valuation.conditionAdjustment",
            _number(valuation.get("conditionAdjustment")),
        ),
        _evidence(
            "$.valuation.adjustedVehicleValue",
            _number(valuation.get("adjustedVehicleValue")),
        ),
    ]
    expected_adjusted = (
        base_value + condition_adjustment
        if base_value is not None and condition_adjustment is not None
        else None
    )
    valuation_difference = (
        adjusted_vehicle_value - expected_adjusted
        if adjusted_vehicle_value is not None and expected_adjusted is not None
        else None
    )
    if valuation_difference is None:
        valuation_status = "unverifiable"
        add_finding(
            "VALUATION_ARITHMETIC",
            "REVIEW",
            "arithmetic",
            "Valuation arithmetic cannot be fully verified",
            "Base value, condition adjustment, and adjusted vehicle value are not "
            "all available, so the valuation equation cannot be reconstructed.",
            valuation_evidence,
        )
    elif valuation_difference == 0:
        valuation_status = "reconciled"
        add_finding(
            "VALUATION_ARITHMETIC",
            "PASS",
            "arithmetic",
            "Valuation arithmetic reconciles",
            f"Base vehicle value {_format_number(base_value)} plus condition adjustment "
            f"{_format_number(condition_adjustment)} equals adjusted vehicle value "
            f"{_format_number(adjusted_vehicle_value)}.",
            valuation_evidence,
        )
    else:
        valuation_status = "mismatch"
        add_finding(
            "VALUATION_ARITHMETIC",
            "WARNING",
            "arithmetic",
            "Valuation arithmetic does not reconcile",
            f"Base vehicle value {_format_number(base_value)} plus condition adjustment "
            f"{_format_number(condition_adjustment)} gives expected adjusted vehicle "
            f"value {_format_number(expected_adjusted)}, but the report states "
            f"{_format_number(adjusted_vehicle_value)}; the difference is "
            f"{_format_number(valuation_difference)}.",
            valuation_evidence,
        )

    valuation_metric = {
        "status": valuation_status,
        "expectedAdjustedVehicleValue": _json_number(expected_adjusted),
        "difference": _json_number(valuation_difference),
    }

    condition = _mapping(report.get("condition"))
    raw_condition_items = condition.get("items")
    condition_items = raw_condition_items if isinstance(raw_condition_items, list) else []
    condition_values: list[Decimal] = []
    condition_value_evidence: list[dict[str, Any]] = []
    missing_condition_impacts = 0
    for index, raw_item in enumerate(condition_items):
        item = _mapping(raw_item)
        raw_impact = item.get("valueImpact")
        impact = _decimal(raw_impact)
        condition_value_evidence.append(
            _evidence(f"$.condition.items[{index}].valueImpact", _number(raw_impact))
        )
        if impact is None:
            missing_condition_impacts += 1
        else:
            condition_values.append(impact)

    disclosed_condition_sum = (
        sum(condition_values, Decimal(0)) if condition_values else None
    )
    condition_total = _decimal(condition.get("totalAdjustment"))
    complete_condition_breakdown = (
        isinstance(raw_condition_items, list)
        and bool(condition_items)
        and missing_condition_impacts == 0
    )
    difference_from_condition_total = (
        disclosed_condition_sum - condition_total
        if complete_condition_breakdown
        and disclosed_condition_sum is not None
        and condition_total is not None
        else None
    )
    difference_from_valuation_adjustment = (
        disclosed_condition_sum - condition_adjustment
        if complete_condition_breakdown
        and disclosed_condition_sum is not None
        and condition_adjustment is not None
        else None
    )
    condition_evidence = condition_value_evidence + [
        _evidence(
            "$.condition.totalAdjustment",
            _number(condition.get("totalAdjustment")),
        ),
        _evidence(
            "$.valuation.conditionAdjustment",
            _number(valuation.get("conditionAdjustment")),
        ),
    ]
    if (
        not complete_condition_breakdown
        or difference_from_condition_total is None
        or difference_from_valuation_adjustment is None
    ):
        condition_status = "unverifiable"
        add_finding(
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "REVIEW",
            "condition",
            "Condition adjustment cannot be fully reconstructed",
            "One or more condition item impacts or reported condition totals are "
            "unavailable, so the condition adjustment is not treated as an arithmetic "
            "error.",
            condition_evidence,
        )
    elif difference_from_condition_total == 0 and difference_from_valuation_adjustment == 0:
        condition_status = "reconciled"
        add_finding(
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "PASS",
            "condition",
            "Condition adjustment reconciles",
            f"The {len(condition_values)} disclosed condition item impacts sum to "
            f"{_format_number(disclosed_condition_sum)}, matching both the condition "
            "total and the valuation condition adjustment.",
            condition_evidence,
        )
    else:
        condition_status = "mismatch"
        add_finding(
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "WARNING",
            "condition",
            "Condition adjustment does not reconcile",
            f"The disclosed item impacts sum to {_format_number(disclosed_condition_sum)}; "
            f"the condition total is {_format_number(condition_total)} and the valuation "
            f"condition adjustment is {_format_number(condition_adjustment)}.",
            condition_evidence,
        )

    condition_metric = {
        "status": condition_status,
        "itemCount": len(condition_items),
        "usableValueImpactCount": len(condition_values),
        "missingValueImpactCount": missing_condition_impacts,
        "sumDisclosedValueImpacts": _json_number(disclosed_condition_sum),
        "totalAdjustment": _json_number(condition_total),
        "valuationConditionAdjustment": _json_number(condition_adjustment),
        "differenceFromTotalAdjustment": _json_number(difference_from_condition_total),
        "differenceFromValuationAdjustment": _json_number(
            difference_from_valuation_adjustment
        ),
    }

    raw_comparables = report.get("comparables")
    comparables = (
        [_mapping(comparable) for comparable in raw_comparables]
        if isinstance(raw_comparables, list)
        else []
    )
    comparable_count = len(comparables)
    if not comparables:
        add_finding(
            "NO_COMPARABLES",
            "REVIEW",
            "data_quality",
            "No comparable vehicles are available",
            "Comparable-based statistics and reconciliation checks cannot be performed.",
            [_evidence("$.comparables", raw_comparables if isinstance(raw_comparables, list) else None)],
        )

    valid_number_pairs = [
        (index, number)
        for index, comparable in enumerate(comparables)
        if (number := _comparable_number(comparable)) is not None
    ]
    valid_numbers = [number for _, number in valid_number_pairs]
    missing_number_indexes = [
        index
        for index, comparable in enumerate(comparables)
        if _comparable_number(comparable) is None
    ]
    number_counts = Counter(valid_numbers)
    duplicate_numbers = sorted(number for number, count in number_counts.items() if count > 1)
    expected_numbers = set(range(1, comparable_count + 1))
    missing_sequence_numbers = (
        []
        if missing_number_indexes
        else sorted(expected_numbers - set(valid_numbers))
    )
    out_of_order = valid_numbers != sorted(valid_numbers)
    number_evidence = [
        _evidence(f"$.comparables[{index}].number", comparable.get("number"))
        for index, comparable in enumerate(comparables)
    ]
    if comparables and not missing_number_indexes and not duplicate_numbers and valid_numbers == list(
        range(1, comparable_count + 1)
    ):
        add_finding(
            "COMPARABLE_NUMBERING",
            "PASS",
            "data_quality",
            "Comparable numbering is complete and unique",
            f"The {comparable_count} comparable rows are numbered consecutively from 1 "
            f"through {comparable_count}.",
            number_evidence,
            valid_numbers,
        )
    if missing_number_indexes:
        add_finding(
            "MISSING_COMPARABLE_NUMBER",
            "REVIEW",
            "data_quality",
            "Comparable number is missing",
            f"{len(missing_number_indexes)} comparable row(s) do not have a usable printed "
            "number.",
            [number_evidence[index] for index in missing_number_indexes],
        )
    if duplicate_numbers:
        duplicate_indexes = [
            index for index, number in valid_number_pairs if number in duplicate_numbers
        ]
        add_finding(
            "DUPLICATE_COMPARABLE_NUMBER",
            "WARNING",
            "data_quality",
            "Comparable numbers are duplicated",
            "A printed comparable number should identify one row, but duplicate values "
            f"were found: {duplicate_numbers}.",
            [number_evidence[index] for index in duplicate_indexes],
            duplicate_numbers,
        )
    if missing_sequence_numbers:
        add_finding(
            "COMPARABLE_NUMBER_SEQUENCE",
            "WARNING",
            "data_quality",
            "Comparable numbering has a sequence gap",
            f"For {comparable_count} rows, the expected consecutive sequence is missing "
            f"number(s) {missing_sequence_numbers}.",
            number_evidence,
            missing_sequence_numbers,
        )
    if out_of_order:
        add_finding(
            "COMPARABLE_NUMBER_ORDER",
            "REVIEW",
            "data_quality",
            "Comparable rows are not in numeric order",
            "The comparable rows are not ordered by their printed comparable numbers.",
            number_evidence,
            valid_numbers,
        )

    numbering_metric = {
        "integerNumberCount": len(valid_numbers),
        "missingNumberCount": len(missing_number_indexes),
        "duplicateNumbers": duplicate_numbers,
        "missingSequenceNumbers": missing_sequence_numbers,
        "outOfOrder": out_of_order,
    }

    vin_indexes: dict[str, list[int]] = {}
    for index, comparable in enumerate(comparables):
        raw_vin = comparable.get("vin")
        if not isinstance(raw_vin, str) or not raw_vin.strip():
            continue
        vin_indexes.setdefault(raw_vin.strip().upper(), []).append(index)
    duplicate_vins = {
        vin: indexes for vin, indexes in vin_indexes.items() if len(indexes) > 1
    }
    if duplicate_vins:
        duplicate_vin_indexes = sorted(
            index for indexes in duplicate_vins.values() for index in indexes
        )
        add_finding(
            "DUPLICATE_COMPARABLE_VIN",
            "REVIEW",
            "data_quality",
            "Comparable VIN is repeated",
            "The same non-empty VIN appears on more than one comparable row. This may "
            "represent duplicate comparable data and is surfaced for review without "
            "concluding that either row is invalid.",
            [
                _evidence(
                    f"$.comparables[{index}].vin", comparables[index].get("vin")
                )
                for index in duplicate_vin_indexes
            ],
            _valid_numbers(comparables, duplicate_vin_indexes),
        )

    adjusted_values: list[Decimal] = []
    mileage_values: list[Decimal] = []
    missing_adjusted_indexes: list[int] = []
    missing_list_price_indexes: list[int] = []
    missing_mileage_indexes: list[int] = []
    loss_vehicle = _mapping(report.get("vehicle"))
    loss_mileage = _decimal(loss_vehicle.get("mileage"))
    mileage_entries: list[dict[str, Any]] = []

    for index, comparable in enumerate(comparables):
        adjusted_value = _decimal(comparable.get("adjustedValue"))
        list_price = _decimal(comparable.get("listPrice"))
        mileage = _decimal(comparable.get("mileage"))
        if adjusted_value is None:
            missing_adjusted_indexes.append(index)
        else:
            adjusted_values.append(adjusted_value)
        if list_price is None and (not evidence_v2 or _decimal(_mapping(comparable.get("sourcePrice")).get("amount")) is None):
            missing_list_price_indexes.append(index)
        if mileage is None:
            missing_mileage_indexes.append(index)
        else:
            mileage_values.append(mileage)
        mileage_entries.append(
            {
                "index": index,
                "comparableNumber": _comparable_number(comparable),
                "mileage": _json_number(mileage),
                "differenceFromLossVehicle": _json_number(
                    mileage - loss_mileage
                    if mileage is not None and loss_mileage is not None
                    else None
                ),
            }
        )

    def add_missing_comparable_finding(
        indexes: list[int], code: str, title: str, field: str, noun: str
    ) -> None:
        if not indexes:
            return
        add_finding(
            code,
            "REVIEW",
            "data_quality",
            title,
            f"{len(indexes)} comparable row(s) have no usable {noun}.",
            [
                _evidence(f"$.comparables[{index}].{field}", _number(comparables[index].get(field)))
                for index in indexes
            ],
            _valid_numbers(comparables, indexes),
        )

    add_missing_comparable_finding(
        missing_list_price_indexes,
        "MISSING_LIST_PRICE",
        "Comparable list price is missing",
        "listPrice",
        "list price",
    )
    add_missing_comparable_finding(
        missing_adjusted_indexes,
        "MISSING_ADJUSTED_VALUE",
        "Comparable adjusted value is missing",
        "adjustedValue",
        "adjusted value",
    )
    add_missing_comparable_finding(
        missing_mileage_indexes,
        "MISSING_COMPARABLE_MILEAGE",
        "Comparable mileage is missing",
        "mileage",
        "mileage",
    )
    if comparables and loss_mileage is None:
        add_finding(
            "LOSS_VEHICLE_MILEAGE_UNAVAILABLE",
            "REVIEW",
            "mileage",
            "Loss vehicle mileage is unavailable",
            "Mileage differences and mileage-adjustment direction cannot be fully checked "
            "without loss vehicle mileage.",
            [_evidence("$.vehicle.mileage", _number(loss_vehicle.get("mileage")))],
        )

    adjusted_statistics = _statistics(adjusted_values)
    adjusted_value_metric = {
        "count": len(adjusted_values),
        "missingCount": len(missing_adjusted_indexes),
        **adjusted_statistics,
    }
    mileage_statistics = _mileage_statistics(mileage_values)
    mileage_metric = {
        "lossVehicleMileage": _json_number(loss_mileage),
        "count": len(mileage_values),
        "missingCount": len(missing_mileage_indexes),
        **mileage_statistics,
        "entries": mileage_entries,
    }

    adjustment_entries: list[dict[str, Any]] = []
    full_indexes: list[int] = []
    reconciled_indexes: list[int] = []
    mismatch_indexes: list[int] = []
    partial_indexes: list[int] = []
    undisclosed_indexes: list[int] = []
    undisclosed_nonzero_indexes: list[int] = []
    unavailable_adjustment_indexes: list[int] = []

    for index, comparable in enumerate(comparables):
        raw_adjustments = _mapping(comparable.get("adjustments"))
        component_decimals = {
            field: _decimal(raw_adjustments.get(field)) for field in ADJUSTMENT_FIELDS
        }
        components = {
            field: _json_number(value) for field, value in component_decimals.items()
        }
        disclosed_count = sum(value is not None for value in component_decimals.values())
        source_price = _mapping(comparable.get("sourcePrice"))
        list_price = _decimal(source_price.get("amount")) if evidence_v2 else _decimal(comparable.get("listPrice"))
        adjusted_value = _decimal(comparable.get("adjustedValue"))
        net_adjustment = (
            adjusted_value - list_price
            if adjusted_value is not None and list_price is not None
            else None
        )
        component_total: Decimal | None = None
        expected_value: Decimal | None = None
        difference: Decimal | None = None
        reconciled: bool | None = None

        if list_price is None or adjusted_value is None:
            disclosure = "unavailable"
            unavailable_adjustment_indexes.append(index)
        elif disclosed_count == len(ADJUSTMENT_FIELDS):
            disclosure = "full"
            full_indexes.append(index)
            component_total = sum(
                (value for value in component_decimals.values() if value is not None),
                Decimal(0),
            )
            expected_value = list_price + component_total
            difference = adjusted_value - expected_value
            reconciled = difference == 0
            if reconciled:
                reconciled_indexes.append(index)
            else:
                mismatch_indexes.append(index)
        elif disclosed_count == 0:
            disclosure = "none"
            undisclosed_indexes.append(index)
            if net_adjustment != 0:
                undisclosed_nonzero_indexes.append(index)
        else:
            disclosure = "partial"
            partial_indexes.append(index)

        adjustment_entries.append(
            {
                "index": index,
                "comparableNumber": _comparable_number(comparable),
                "listPrice": _number(comparable.get("listPrice")),
                **({"sourcePrice": dict(source_price)} if evidence_v2 else {}),
                "adjustedValue": _json_number(adjusted_value),
                "netAdjustment": _json_number(net_adjustment),
                "disclosure": disclosure,
                "components": components,
                "componentAdjustmentTotal": _json_number(component_total),
                "expectedAdjustedValue": _json_number(expected_value),
                "difference": _json_number(difference),
                "reconciled": reconciled,
            }
        )

    def adjustment_evidence(indexes: list[int]) -> list[dict[str, Any]]:
        evidence: list[dict[str, Any]] = []
        for index in indexes:
            comparable = comparables[index]
            raw_adjustments = _mapping(comparable.get("adjustments"))
            evidence.extend(
                [
                    _evidence(
                        f"$.comparables[{index}].sourcePrice.amount" if evidence_v2 else f"$.comparables[{index}].listPrice",
                        _number(_mapping(comparable.get("sourcePrice")).get("amount")) if evidence_v2 else _number(comparable.get("listPrice")),
                    ),
                    *[
                        _evidence(
                            f"$.comparables[{index}].adjustments.{field}",
                            _number(raw_adjustments.get(field)),
                        )
                        for field in ADJUSTMENT_FIELDS
                    ],
                    _evidence(
                        f"$.comparables[{index}].adjustedValue",
                        _number(comparable.get("adjustedValue")),
                    ),
                ]
            )
        return evidence

    if reconciled_indexes:
        add_finding(
            "COMPARABLE_ADJUSTMENT_RECONCILIATION",
            "PASS",
            "comparables",
            "Disclosed comparable adjustments reconcile",
            f"All four adjustment components reconcile exactly for {len(reconciled_indexes)} "
            "comparable(s).",
            adjustment_evidence(reconciled_indexes),
            _valid_numbers(comparables, reconciled_indexes),
        )
    if mismatch_indexes:
        mismatch_descriptions = []
        for index in mismatch_indexes:
            entry = adjustment_entries[index]
            mismatch_descriptions.append(
                f"comparable {entry['comparableNumber'] if entry['comparableNumber'] is not None else f'at index {index}'}: "
                f"{'source price' if evidence_v2 else 'list'} {entry['sourcePrice']['amount'] if evidence_v2 else entry['listPrice']}, components {entry['components']}, expected "
                f"{entry['expectedAdjustedValue']}, actual {entry['adjustedValue']}, difference "
                f"{entry['difference']}"
            )
        add_finding(
            "COMPARABLE_ADJUSTMENT_RECONCILIATION",
            "WARNING",
            "comparables",
            "Comparable adjustment arithmetic does not reconcile",
            "The disclosed adjustment arithmetic differs from the stated adjusted "
            "value for " + "; ".join(mismatch_descriptions) + ".",
            adjustment_evidence(mismatch_indexes),
            _valid_numbers(comparables, mismatch_indexes),
        )
    if undisclosed_nonzero_indexes:
        net_descriptions = [
            f"comparable {adjustment_entries[index]['comparableNumber'] if adjustment_entries[index]['comparableNumber'] is not None else f'at index {index}'} "
            f"net {adjustment_entries[index]['netAdjustment']}"
            for index in undisclosed_nonzero_indexes
        ]
        add_finding(
            "UNDISCLOSED_COMPARABLE_ADJUSTMENTS",
            "REVIEW",
            "transparency",
            "Comparable adjustments cannot be reconstructed",
            ("Adjusted value differs from the source price, but all component adjustment " if evidence_v2 else "Adjusted value differs from list price, but all component adjustment ")
            + "amounts are unavailable for " + ", ".join(net_descriptions) + ".",
            adjustment_evidence(undisclosed_nonzero_indexes),
            _valid_numbers(comparables, undisclosed_nonzero_indexes),
        )
    if partial_indexes:
        add_finding(
            "PARTIAL_COMPARABLE_ADJUSTMENTS",
            "REVIEW",
            "transparency",
            "Comparable adjustment breakdown is partial",
            f"Some, but not all, adjustment components are available for "
            f"{len(partial_indexes)} comparable(s). Missing components are not treated "
            "as zero, so the adjusted values cannot be fully reconciled.",
            adjustment_evidence(partial_indexes),
            _valid_numbers(comparables, partial_indexes),
        )

    adjustment_metric = {
        "fullyDisclosedCount": len(full_indexes),
        "partiallyDisclosedCount": len(partial_indexes),
        "undisclosedCount": len(undisclosed_indexes),
        "unavailableCount": len(unavailable_adjustment_indexes),
        "entries": adjustment_entries,
    }

    direction_entries: list[dict[str, Any]] = []
    consistent_direction_indexes: list[int] = []
    inconsistent_direction_indexes: list[int] = []
    unavailable_direction_indexes: list[int] = []
    for index, comparable in enumerate(comparables):
        comparable_mileage = _decimal(comparable.get("mileage"))
        adjustments = _mapping(comparable.get("adjustments"))
        mileage_adjustment = _decimal(adjustments.get("mileage"))
        mileage_difference = (
            comparable_mileage - loss_mileage
            if comparable_mileage is not None and loss_mileage is not None
            else None
        )
        if mileage_difference is None or mileage_adjustment is None:
            status = "unavailable"
            unavailable_direction_indexes.append(index)
        else:
            consistent = (
                (mileage_difference < 0 and mileage_adjustment <= 0)
                or (mileage_difference > 0 and mileage_adjustment >= 0)
                or (mileage_difference == 0 and mileage_adjustment == 0)
            )
            if consistent:
                status = "consistent"
                consistent_direction_indexes.append(index)
            else:
                status = "inconsistent"
                inconsistent_direction_indexes.append(index)
        direction_entries.append(
            {
                "index": index,
                "comparableNumber": _comparable_number(comparable),
                "lossVehicleMileage": _json_number(loss_mileage),
                "comparableMileage": _json_number(comparable_mileage),
                "mileageAdjustment": _json_number(mileage_adjustment),
                "mileageDifference": _json_number(mileage_difference),
                "status": status,
            }
        )

    def direction_evidence(indexes: list[int]) -> list[dict[str, Any]]:
        evidence = [_evidence("$.vehicle.mileage", _json_number(loss_mileage))]
        for index in indexes:
            comparable = comparables[index]
            adjustments = _mapping(comparable.get("adjustments"))
            evidence.extend(
                [
                    _evidence(
                        f"$.comparables[{index}].mileage",
                        _number(comparable.get("mileage")),
                    ),
                    _evidence(
                        f"$.comparables[{index}].adjustments.mileage",
                        _number(adjustments.get("mileage")),
                    ),
                ]
            )
        return evidence

    if consistent_direction_indexes:
        add_finding(
            "MILEAGE_ADJUSTMENT_DIRECTION",
            "PASS",
            "mileage",
            "Mileage adjustment directions are consistent",
            f"The disclosed mileage-adjustment signs are directionally consistent for "
            f"{len(consistent_direction_indexes)} comparable(s). No dollar-per-mile "
            "formula was inferred.",
            direction_evidence(consistent_direction_indexes),
            _valid_numbers(comparables, consistent_direction_indexes),
        )
    if inconsistent_direction_indexes:
        add_finding(
            "MILEAGE_ADJUSTMENT_DIRECTION",
            "REVIEW",
            "mileage",
            "Mileage adjustment direction is worth review",
            "The disclosed mileage-adjustment sign runs opposite to the general "
            "relationship between comparable and loss-vehicle mileage for "
            f"{len(inconsistent_direction_indexes)} comparable(s). This directional "
            "screen does not attempt to reproduce the provider's formula.",
            direction_evidence(inconsistent_direction_indexes),
            _valid_numbers(comparables, inconsistent_direction_indexes),
        )

    direction_metric = {
        "checkedCount": len(consistent_direction_indexes)
        + len(inconsistent_direction_indexes),
        "consistentCount": len(consistent_direction_indexes),
        "inconsistentCount": len(inconsistent_direction_indexes),
        "unavailableCount": len(unavailable_direction_indexes),
        "entries": direction_entries,
    }

    for field, label in (
        ("year", "year"),
        ("make", "make"),
        ("model", "model"),
        ("trim", "trim"),
    ):
        loss_raw = loss_vehicle.get(field)
        loss_comparison = (
            _decimal(loss_raw) if field == "year" else _normalized_text(loss_raw)
        )
        if loss_comparison is None:
            continue
        different_indexes: list[int] = []
        for index, comparable in enumerate(comparables):
            comparable_raw = comparable.get(field)
            comparable_comparison = (
                _decimal(comparable_raw)
                if field == "year"
                else _normalized_text(comparable_raw)
            )
            if comparable_comparison is not None and comparable_comparison != loss_comparison:
                different_indexes.append(index)
        if not different_indexes:
            continue
        numbers = _valid_numbers(comparables, different_indexes)
        subject = (
            f"Comparable {numbers[0]} is"
            if len(different_indexes) == 1 and numbers
            else f"{len(different_indexes)} comparables are"
        )
        evidence = [_evidence(f"$.vehicle.{field}", loss_raw)] + [
            _evidence(
                f"$.comparables[{index}].{field}", comparables[index].get(field)
            )
            for index in different_indexes
        ]
        add_finding(
            f"COMPARABLE_{field.upper()}_DIFFERENCE",
            "REVIEW",
            "attributes",
            f"Comparable {label} differs from the loss vehicle",
            f"{subject} a different {label} from the loss vehicle. The difference is "
            "reported as a factual comparison, not a conclusion that the comparable is "
            "invalid.",
            evidence,
            numbers,
        )

    contribution_values: list[Decimal] = []
    missing_contribution_indexes: list[int] = []
    contribution_evidence: list[dict[str, Any]] = []
    for index, comparable in enumerate(comparables):
        raw_contribution = comparable.get("contributionPercent")
        contribution = _decimal(raw_contribution)
        contribution_evidence.append(
            _evidence(
                f"$.comparables[{index}].contributionPercent",
                _number(raw_contribution),
            )
        )
        if contribution is None:
            missing_contribution_indexes.append(index)
        else:
            contribution_values.append(contribution)

    contribution_sum = (
        sum(contribution_values, Decimal(0)) if contribution_values else None
    )
    if not contribution_values:
        contribution_availability = "unavailable"
        if comparables:
            add_finding(
                "CONTRIBUTION_PERCENTAGES",
                "REVIEW",
                "transparency",
                "Comparable contribution percentages are unavailable",
                "The displayed comparable weighting is unavailable. Equal weighting is "
                "not assumed.",
                contribution_evidence,
                valid_numbers,
            )
    elif missing_contribution_indexes:
        contribution_availability = "partial"
        add_finding(
            "CONTRIBUTION_PERCENTAGES",
            "REVIEW",
            "transparency",
            "Comparable contribution percentages are incomplete",
            f"Contribution percentages are available for {len(contribution_values)} of "
            f"{comparable_count} comparables and total {_format_number(contribution_sum)} "
            "across the disclosed rows. Exact weighting cannot be reconstructed.",
            contribution_evidence,
            valid_numbers,
        )
    elif contribution_sum == Decimal(100):
        contribution_availability = "complete"
        add_finding(
            "CONTRIBUTION_PERCENTAGES",
            "PASS",
            "transparency",
            "Displayed contribution percentages total 100%",
            "All comparable contribution percentages are displayed and their displayed "
            "values total 100%. This check does not attempt to prove the base vehicle value.",
            contribution_evidence,
            valid_numbers,
        )
    else:
        contribution_availability = "complete"
        add_finding(
            "CONTRIBUTION_PERCENTAGES",
            "REVIEW",
            "transparency",
            "Displayed contribution percentages do not total 100%",
            f"The displayed comparable contribution percentages total "
            f"{_format_number(contribution_sum)}%. Displayed percentages may be rounded, "
            "so exact weighting cannot be reconstructed from them alone.",
            contribution_evidence,
            valid_numbers,
        )

    contribution_metric = {
        "availability": contribution_availability,
        "availableCount": len(contribution_values),
        "missingCount": len(missing_contribution_indexes),
        "displayedSum": _json_number(contribution_sum),
    }

    if evidence_v2:
        source_evidence = _mapping(report.get("evidence"))
        source_rows = source_evidence.get("contributionRows", [])
        bindings = source_evidence.get("contributionBindings", [])
        bound_rows: set[int] = set()
        unresolved_rows: set[int] = set()
        for row_index, source_row in enumerate(source_rows):
            matches = [item for item in bindings if item.get("rowIndex") == row_index]
            if len(matches) != 1 or matches[0].get("status") != "BOUND":
                unresolved_rows.add(row_index)
                continue
            comparable_index = matches[0].get("comparableIndex")
            if not isinstance(comparable_index, int) or not 0 <= comparable_index < len(comparables):
                unresolved_rows.add(row_index)
                continue
            comparable = comparables[comparable_index]
            binding = _mapping(comparable.get("contributionBinding"))
            if (binding.get("status") != "BOUND"
                or row_index not in binding.get("rowIndexes", [])
                or _decimal(source_row.get("contributionPercent")) is None
                or _decimal(source_row.get("contributionPercent")) != _decimal(comparable.get("contributionPercent"))):
                unresolved_rows.add(row_index)
                continue
            bound_rows.add(row_index)
        binding_status = (
            "BOUND"
            if source_rows and not unresolved_rows and not missing_contribution_indexes
            else "UNRESOLVED" if source_rows else "UNAVAILABLE"
        )
        findings[:] = [finding for finding in findings if finding["code"] != "CONTRIBUTION_PERCENTAGES"]
        complete = binding_status == "BOUND" and contribution_sum is not None
        add_finding(
            "CONTRIBUTION_PERCENTAGES",
            "PASS" if complete and contribution_sum == Decimal(100) else "REVIEW",
            "transparency",
            "Bound contribution percentages total 100%" if complete and contribution_sum == Decimal(100) else "Contribution evidence needs review",
            ("Contribution rows are linked to comparable identities and their logical comparable percentages total 100%. "
             "The total alone does not prove row linkage, the vendor's weighting method, or the base vehicle value.")
            if complete and contribution_sum == Decimal(100) else
            ("Some contribution evidence is unavailable, unresolved, or does not total 100%. "
             "This describes Venfour's representation and does not establish an insurer weighting error."),
            contribution_evidence + [_evidence("$.evidence.contributionBindings", bindings)],
            valid_numbers,
        )
        contribution_metric.update({
            "availability": "complete" if complete else "partial" if contribution_values else "unavailable",
            "bindingStatus": binding_status,
            "sourceRowCount": len(source_rows),
            "boundSourceRowCount": len(bound_rows),
            "unresolvedSourceRowCount": len(unresolved_rows),
        })

    finding_counts = {
        status: sum(finding["status"] == status for finding in findings)
        for status in FINDING_STATUSES
    }

    return {
        "analysisVersion": "2" if evidence_v2 else ANALYSIS_VERSION,
        "summary": {
            "baseVehicleValue": _json_number(base_value),
            "conditionAdjustment": _json_number(condition_adjustment),
            "adjustedVehicleValue": _json_number(adjusted_vehicle_value),
            "total": _json_number(total),
            "comparableCount": comparable_count,
            "findingCounts": finding_counts,
        },
        "metrics": {
            "valuationArithmetic": valuation_metric,
            "condition": condition_metric,
            "comparableAdjustedValues": adjusted_value_metric,
            "comparableMileage": mileage_metric,
            "comparableAdjustments": adjustment_metric,
            "mileageAdjustmentDirection": direction_metric,
            "contributionPercentages": contribution_metric,
            "comparableNumbering": numbering_metric,
        },
        "findings": findings,
    }
