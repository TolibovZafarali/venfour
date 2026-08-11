"""Public contract coverage for deterministic Phase 3E presentation values."""

from __future__ import annotations

import json
import unittest
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from venfour.discrepancy import (
    MAX_SAFE_MONEY_CENTS,
    VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH,
)
from venfour.historical_market import HISTORICAL_SEARCH_RESULT_SCHEMA_PATH
from venfour.presentation import (
    ANALYSIS_PRESENTATION_SCHEMA_PATH,
    ANALYSIS_PRESENTATION_VERSION,
    CLASSIFICATION_LABELS,
    CLASSIFICATION_SUMMARIES,
    EVIDENCE_BASIS_LABELS,
    EVIDENCE_STRENGTH_LABELS,
    FINDING_DESCRIPTIONS,
    FINDING_LABELS,
    HISTORICAL_ISSUE_REASON_COPY,
    LIMITATION_DESCRIPTIONS,
    LIMITATION_LABELS,
    AnalysisPresentationContractError,
    format_basis_points,
    format_money_cents,
    validate_analysis_presentation,
)


EXPECTED_CLASSIFICATION_LABELS = {
    "INSUFFICIENT_EVIDENCE": "Insufficient evidence",
    "NO_MATERIAL_DISCREPANCY": "No material discrepancy detected",
    "POTENTIAL_UNDERVALUE": "Potential undervaluation signal",
    "MATERIAL_UNDERVALUE_SIGNAL": "Material undervaluation signal",
    "CONFLICTING_EVIDENCE": "Conflicting market evidence",
}

EXPECTED_EVIDENCE_STRENGTH_LABELS = {
    "LOW": "Low",
    "MODERATE": "Moderate",
    "STRONG": "Strong",
}

EXPECTED_EVIDENCE_BASIS_LABELS = {
    "NONE": "No primary external evidence",
    "LOSS_DATE_HISTORICAL": "Historical market evidence from the loss date",
    "CURRENT_MARKET": "Current market evidence",
}


def _load_schema(path: Path) -> dict[str, Any]:
    schema = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(schema, dict):
        raise AssertionError(f"schema root must be an object: {path}")
    return schema


def _assert_nonempty_copy(
    case: unittest.TestCase,
    values: Mapping[str, Any],
) -> None:
    for code, copy in values.items():
        with case.subTest(code=code):
            case.assertIsInstance(copy, str)
            case.assertEqual(copy, copy.strip())
            case.assertTrue(copy)


def _assert_nonempty_copy_pair(
    case: unittest.TestCase,
    values: Mapping[str, Any],
) -> None:
    for code, copy in values.items():
        with case.subTest(code=code):
            case.assertIsInstance(copy, tuple)
            case.assertEqual(len(copy), 2)
            for text in copy:
                case.assertIsInstance(text, str)
                case.assertEqual(text, text.strip())
                case.assertTrue(text)


def _object_schema_paths(schema: Any, path: str = "$") -> list[str]:
    """Return every explicit object-schema path, including nested branches."""

    paths: list[str] = []
    if isinstance(schema, dict):
        schema_type = schema.get("type")
        allows_object = schema_type == "object" or (
            isinstance(schema_type, list) and "object" in schema_type
        )
        if allows_object:
            paths.append(path)
        for key, child in schema.items():
            paths.extend(_object_schema_paths(child, f"{path}.{key}"))
    elif isinstance(schema, list):
        for index, child in enumerate(schema):
            paths.extend(_object_schema_paths(child, f"{path}[{index}]"))
    return paths


def _schema_at_path(schema: dict[str, Any], path: str) -> dict[str, Any]:
    current: Any = schema
    remainder = path.removeprefix("$.")
    if remainder == "$" or not remainder:
        return schema
    for component in remainder.split("."):
        while "[" in component:
            name, indexed = component.split("[", 1)
            if name:
                current = current[name]
            index_text, component = indexed.split("]", 1)
            current = current[int(index_text)]
        if component:
            current = current[component]
    if not isinstance(current, dict):
        raise AssertionError(f"expected object schema at {path}")
    return current


class PresentationMappingContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.discrepancy_schema = _load_schema(
            VALUATION_DISCREPANCY_RESULT_SCHEMA_PATH
        )
        cls.historical_schema = _load_schema(HISTORICAL_SEARCH_RESULT_SCHEMA_PATH)

    def test_classification_mappings_are_complete_and_reviewed(self) -> None:
        expected_codes = set(
            self.discrepancy_schema["properties"]["classification"]["enum"]
        )
        self.assertEqual(set(CLASSIFICATION_LABELS), expected_codes)
        self.assertEqual(set(CLASSIFICATION_SUMMARIES), expected_codes)
        self.assertEqual(dict(CLASSIFICATION_LABELS), EXPECTED_CLASSIFICATION_LABELS)
        _assert_nonempty_copy(self, CLASSIFICATION_SUMMARIES)

    def test_evidence_strength_labels_are_complete_and_reviewed(self) -> None:
        expected_codes = set(
            self.discrepancy_schema["properties"]["evidenceStrength"]["enum"]
        )
        self.assertEqual(set(EVIDENCE_STRENGTH_LABELS), expected_codes)
        self.assertEqual(
            dict(EVIDENCE_STRENGTH_LABELS),
            EXPECTED_EVIDENCE_STRENGTH_LABELS,
        )

    def test_evidence_basis_labels_are_complete_and_reviewed(self) -> None:
        expected_codes = set(
            self.discrepancy_schema["properties"]["evidenceBasis"]["enum"]
        )
        self.assertEqual(set(EVIDENCE_BASIS_LABELS), expected_codes)
        self.assertEqual(dict(EVIDENCE_BASIS_LABELS), EXPECTED_EVIDENCE_BASIS_LABELS)

    def test_finding_labels_cover_every_phase_3d_code(self) -> None:
        expected_codes = set(
            self.discrepancy_schema["$defs"]["finding"]["properties"]["code"][
                "enum"
            ]
        )
        self.assertEqual(set(FINDING_LABELS), expected_codes)
        self.assertEqual(set(FINDING_DESCRIPTIONS), expected_codes)
        _assert_nonempty_copy(self, FINDING_LABELS)
        _assert_nonempty_copy(self, FINDING_DESCRIPTIONS)

    def test_limitation_labels_cover_every_phase_3d_code(self) -> None:
        expected_codes = set(
            self.discrepancy_schema["$defs"]["limitation"]["properties"]["code"][
                "enum"
            ]
        )
        self.assertEqual(set(LIMITATION_LABELS), expected_codes)
        self.assertEqual(set(LIMITATION_DESCRIPTIONS), expected_codes)
        _assert_nonempty_copy(self, LIMITATION_LABELS)
        _assert_nonempty_copy(self, LIMITATION_DESCRIPTIONS)

    def test_historical_issue_copy_covers_every_reason(self) -> None:
        expected_codes = set(
            self.historical_schema["$defs"]["issue"]["properties"]["reason"][
                "enum"
            ]
        )
        self.assertEqual(set(HISTORICAL_ISSUE_REASON_COPY), expected_codes)
        _assert_nonempty_copy_pair(self, HISTORICAL_ISSUE_REASON_COPY)


class PresentationFormattingContractTests(unittest.TestCase):
    def test_money_cents_formatting_is_exact(self) -> None:
        expected = {
            0: "$0.00",
            1: "$0.01",
            -1: "-$0.01",
            1_961_700: "$19,617.00",
            MAX_SAFE_MONEY_CENTS: "$90,071,992,547,409.91",
        }
        for cents, display in expected.items():
            with self.subTest(cents=cents):
                self.assertEqual(format_money_cents(cents), display)

    def test_basis_point_formatting_uses_the_stored_integer(self) -> None:
        expected = {
            None: None,
            0: "0.00%",
            875: "8.75%",
            -500: "-5.00%",
            3333: "33.33%",
        }
        for basis_points, display in expected.items():
            with self.subTest(basis_points=basis_points):
                self.assertEqual(format_basis_points(basis_points), display)

    def test_money_formatter_rejects_bool_and_non_integer_values(self) -> None:
        for invalid in (True, False, 1.0, "100"):
            with self.subTest(value=invalid):
                with self.assertRaises(AnalysisPresentationContractError):
                    format_money_cents(invalid)  # type: ignore[arg-type]

    def test_basis_point_formatter_rejects_bool_and_non_integer_values(self) -> None:
        for invalid in (True, False, 8.75, "875"):
            with self.subTest(value=invalid):
                with self.assertRaises(AnalysisPresentationContractError):
                    format_basis_points(invalid)  # type: ignore[arg-type]


class PresentationSchemaContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = _load_schema(ANALYSIS_PRESENTATION_SCHEMA_PATH)

    def test_schema_meta_validates_as_draft_2020_12(self) -> None:
        self.assertEqual(
            self.schema["$schema"],
            "https://json-schema.org/draft/2020-12/schema",
        )
        Draft202012Validator.check_schema(self.schema)

    def test_schema_declares_the_public_presentation_version(self) -> None:
        self.assertIn("presentationVersion", self.schema["required"])
        self.assertEqual(
            self.schema["properties"]["presentationVersion"]["const"],
            ANALYSIS_PRESENTATION_VERSION,
        )

    def test_every_explicit_object_schema_rejects_unknown_properties(self) -> None:
        object_paths = _object_schema_paths(self.schema)
        self.assertTrue(object_paths)
        for path in object_paths:
            with self.subTest(path=path):
                object_schema = _schema_at_path(self.schema, path)
                self.assertIs(
                    object_schema.get("additionalProperties"),
                    False,
                    f"{path} must reject unknown properties",
                )

    def test_public_validator_rejects_non_presentations(self) -> None:
        for invalid in (None, True, [], {}, {"presentationVersion": "future"}):
            with self.subTest(value=invalid):
                with self.assertRaises(AnalysisPresentationContractError):
                    validate_analysis_presentation(invalid)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
