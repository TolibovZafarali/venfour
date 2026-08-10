"""Offline end-to-end regression tests for the one-PDF report pipeline."""

from __future__ import annotations

import copy
import io
import json
import math
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

from scripts import process_report as process_report_cli
from scripts import run_live_pipeline_benchmark as live_pipeline
from scripts.analyze_report import (
    ANALYSIS_SCHEMA_PATH,
    AnalysisError,
    read_schema,
    validate_json,
)
from scripts.extract_report_ai import (
    AIExtractionResult,
    PrototypeError,
    read_canonical_schema,
    usage_details,
    validate_extraction,
)
from venfour.analysis import analyze_report
from venfour.pipeline import (
    PipelineError,
    ProcessReportResult,
    default_output_paths,
    process_report,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_DIR = REPO_ROOT / "tests" / "benchmarks"

# These are explicit synthetic test-stimulus values, not verified extracted ground
# truth. Their only purpose is to exercise the documented 98% rounding-review path.
ELANTRA_SYNTHETIC_CONTRIBUTIONS = [9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 7, 7]


def load_benchmark(name: str) -> dict[str, Any]:
    """Load a committed, manually verified benchmark subset."""

    with (BENCHMARK_DIR / f"{name}.json").open(encoding="utf-8") as source:
        return json.load(source)


def strict_extraction_from_benchmark(name: str) -> dict[str, Any]:
    """Expand verified benchmark facts into the complete API-strict shape.

    Values absent from the committed benchmark remain null or empty. This makes the
    fixture satisfy the real extraction contract without turning unverified fields
    into regression ground truth.
    """

    benchmark = load_benchmark(name)
    benchmark_vehicle = benchmark["vehicle"]
    benchmark_valuation = benchmark["valuation"]

    vehicle: dict[str, Any] = {
        "year": None,
        "make": None,
        "model": None,
        "trim": None,
        "vin": None,
        "mileage": None,
        "location": None,
        "bodyStyle": None,
        "engine": None,
        "transmission": None,
        "fuelType": None,
        "equipment": [],
    }
    vehicle.update(copy.deepcopy(benchmark_vehicle))

    valuation: dict[str, Any] = {
        "baseVehicleValue": None,
        "conditionAdjustment": None,
        "adjustedVehicleValue": None,
        "total": None,
    }
    valuation.update(copy.deepcopy(benchmark_valuation))

    condition: dict[str, Any] = {
        "totalAdjustment": None,
        "items": [],
    }
    benchmark_condition = benchmark.get("condition")
    if isinstance(benchmark_condition, dict):
        condition["totalAdjustment"] = benchmark_condition["totalAdjustment"]
        condition["items"] = [
            {
                "category": None,
                "component": None,
                "rating": None,
                "notes": None,
                "valueImpact": value,
            }
            for value in benchmark_condition["nonzeroValueImpacts"]
        ]

    comparables: list[dict[str, Any]] = []
    for index, verified_comparable in enumerate(benchmark["comparables"]):
        comparable: dict[str, Any] = {
            "number": None,
            "year": None,
            "make": None,
            "model": None,
            "trim": None,
            "vin": None,
            "dealer": None,
            "location": None,
            "distanceMiles": None,
            "mileage": None,
            "listPrice": None,
            "adjustments": {
                "package": None,
                "options": None,
                "mileage": None,
                "condition": None,
            },
            "adjustedValue": None,
            "contributionPercent": None,
        }
        comparable.update(copy.deepcopy(verified_comparable))
        if name == "elantra":
            comparable["contributionPercent"] = (
                ELANTRA_SYNTHETIC_CONTRIBUTIONS[index]
            )
        comparables.append(comparable)

    return {
        "report": {
            "provider": "CCC",
            "reportReferenceNumber": None,
            "claimReferenceNumber": None,
            "lossDate": None,
            "reportDate": None,
        },
        "vehicle": vehicle,
        "valuation": valuation,
        "condition": condition,
        "comparables": comparables,
        "valuationNotes": [],
        "supplementalInformation": {
            "historyChecks": [],
            "historyEvents": [],
            "recalls": [],
        },
    }


def finding(analysis: dict[str, Any], code: str) -> dict[str, Any]:
    matches = [item for item in analysis["findings"] if item["code"] == code]
    if len(matches) != 1:
        raise AssertionError(
            f"expected one {code} finding; got "
            f"{[item['code'] for item in analysis['findings']]}"
        )
    return matches[0]


class PipelineTestCase(unittest.TestCase):
    """Shared isolated paths and deterministic extraction helpers."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.input_pdf = self.root / "report.pdf"
        self.input_pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
        self.extraction_path = self.root / "outputs" / "report.json"
        self.analysis_path = self.root / "outputs" / "report.analysis.json"

    def extractor_for(
        self,
        data: Any,
        *,
        model: str = "fixture-extractor",
        usage: dict[str, int | None] | None = None,
    ) -> tuple[Any, list[tuple[Path, dict[str, Any]]]]:
        calls: list[tuple[Path, dict[str, Any]]] = []

        def extract(
            input_path: Path, canonical_schema: dict[str, Any]
        ) -> AIExtractionResult:
            self.assertNotIn("OPENAI_API_KEY", os.environ)
            calls.append((input_path, canonical_schema))
            return AIExtractionResult(data=data, model=model, usage=usage)

        return extract, calls

    def load_output(self, path: Path) -> dict[str, Any]:
        with path.open(encoding="utf-8") as source:
            loaded = json.load(source)
        self.assertIsInstance(loaded, dict)
        return loaded

    def assert_no_temporary_output(self, output_path: Path) -> None:
        temporary_files = list(
            output_path.parent.glob(f".{output_path.name}.*.tmp")
        )
        self.assertEqual(temporary_files, [])


class StrictFixtureTests(unittest.TestCase):
    def test_committed_benchmarks_expand_to_the_api_strict_contract(self) -> None:
        canonical_schema = read_canonical_schema()

        for name in ("camry", "elantra"):
            with self.subTest(report=name):
                benchmark_before = load_benchmark(name)
                extraction = strict_extraction_from_benchmark(name)
                validate_extraction(extraction, canonical_schema)
                self.assertEqual(load_benchmark(name), benchmark_before)

        elantra = strict_extraction_from_benchmark("elantra")
        contributions = [
            comparable["contributionPercent"]
            for comparable in elantra["comparables"]
        ]
        self.assertEqual(contributions, ELANTRA_SYNTHETIC_CONTRIBUTIONS)
        self.assertEqual(sum(contributions), 98)

    def test_extraction_usage_is_available_as_structured_metadata(self) -> None:
        response = {
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "total_tokens": 150,
                "input_tokens_details": {"cached_tokens": 20},
                "output_tokens_details": {"reasoning_tokens": 10},
            }
        }

        self.assertEqual(
            usage_details(response),
            {
                "inputTokens": 120,
                "outputTokens": 30,
                "totalTokens": 150,
                "cachedInputTokens": 20,
                "cacheWriteInputTokens": None,
                "reasoningOutputTokens": 10,
            },
        )


class EndToEndRegressionTests(PipelineTestCase):
    def run_regression(
        self, name: str
    ) -> tuple[dict[str, Any], dict[str, Any], ProcessReportResult]:
        extraction = strict_extraction_from_benchmark(name)
        extraction_before = copy.deepcopy(extraction)
        observed_analyzer_inputs: list[dict[str, Any]] = []
        extractor, extraction_calls = self.extractor_for(
            extraction,
            model="fixture-gpt-5.6-sol",
            usage={
                "inputTokens": 100,
                "outputTokens": 50,
                "totalTokens": 150,
            },
        )

        def observing_analyzer(report: dict[str, Any]) -> dict[str, Any]:
            observed_analyzer_inputs.append(report)
            return analyze_report(report)

        with patch.dict(os.environ, {}, clear=True):
            result = process_report(
                self.input_pdf,
                self.extraction_path,
                self.analysis_path,
                extractor=extractor,
                analyzer=observing_analyzer,
            )

        self.assertEqual(len(extraction_calls), 1)
        self.assertEqual(extraction_calls[0][0], self.input_pdf)
        self.assertIs(observed_analyzer_inputs[0], extraction)
        self.assertEqual(extraction, extraction_before)

        written_extraction = self.load_output(self.extraction_path)
        written_analysis = self.load_output(self.analysis_path)
        validate_extraction(written_extraction, read_canonical_schema())
        validate_json(
            written_analysis,
            read_schema(ANALYSIS_SCHEMA_PATH),
            "Analysis output",
        )
        self.assertEqual(written_extraction, extraction)
        self.assertEqual(result.extraction_path, self.extraction_path)
        self.assertEqual(result.analysis_path, self.analysis_path)
        self.assertEqual(result.model, "fixture-gpt-5.6-sol")
        self.assertEqual(result.usage["totalTokens"], 150)
        self.assertEqual(result.finding_counts, written_analysis["summary"]["findingCounts"])
        return written_extraction, written_analysis, result

    def test_camry_end_to_end_regression(self) -> None:
        extraction, analysis, result = self.run_regression("camry")

        self.assertEqual(len(extraction["comparables"]), 11)
        self.assertEqual(analysis["summary"]["comparableCount"], 11)
        self.assertEqual(
            finding(analysis, "VALUATION_ARITHMETIC")["status"], "PASS"
        )
        undisclosed = finding(analysis, "UNDISCLOSED_COMPARABLE_ADJUSTMENTS")
        self.assertEqual(undisclosed["status"], "REVIEW")
        self.assertEqual(undisclosed["comparableNumbers"], list(range(1, 12)))
        self.assertFalse(
            any(item["status"] == "WARNING" for item in analysis["findings"])
        )
        self.assertEqual(
            result.finding_counts,
            {"PASS": 2, "REVIEW": 4, "WARNING": 0},
        )
        self.assertTrue(self.extraction_path.is_file())
        self.assertTrue(self.analysis_path.is_file())

    def test_elantra_end_to_end_regression(self) -> None:
        extraction, analysis, result = self.run_regression("elantra")

        self.assertEqual(extraction["vehicle"]["bodyStyle"], "Sedan")
        self.assertEqual(len(extraction["comparables"]), 12)
        self.assertEqual(analysis["summary"]["comparableCount"], 12)
        self.assertEqual(extraction["condition"]["totalAdjustment"], 297)
        self.assertEqual(
            sum(item["valueImpact"] for item in extraction["condition"]["items"]),
            297,
        )
        self.assertEqual(analysis["metrics"]["condition"]["status"], "reconciled")

        reconciliation = finding(
            analysis, "COMPARABLE_ADJUSTMENT_RECONCILIATION"
        )
        self.assertEqual(reconciliation["status"], "PASS")
        self.assertEqual(reconciliation["comparableNumbers"], list(range(1, 7)))
        for comparable in extraction["comparables"][6:]:
            self.assertTrue(
                all(value is None for value in comparable["adjustments"].values())
            )
        undisclosed = finding(analysis, "UNDISCLOSED_COMPARABLE_ADJUSTMENTS")
        self.assertEqual(undisclosed["status"], "REVIEW")
        self.assertEqual(undisclosed["comparableNumbers"], list(range(7, 13)))

        mileage_direction = finding(analysis, "MILEAGE_ADJUSTMENT_DIRECTION")
        self.assertEqual(mileage_direction["status"], "PASS")
        self.assertEqual(mileage_direction["comparableNumbers"], list(range(1, 7)))
        self.assertEqual(
            analysis["metrics"]["mileageAdjustmentDirection"]["consistentCount"],
            6,
        )

        contribution = finding(analysis, "CONTRIBUTION_PERCENTAGES")
        self.assertEqual(contribution["status"], "REVIEW")
        self.assertIn("rounded", contribution["description"])
        self.assertEqual(
            analysis["metrics"]["contributionPercentages"]["displayedSum"],
            98,
        )
        self.assertFalse(
            any(item["status"] == "WARNING" for item in analysis["findings"])
        )
        self.assertEqual(
            result.finding_counts,
            {"PASS": 5, "REVIEW": 2, "WARNING": 0},
        )

    def test_success_replaces_preexisting_outputs_with_valid_json(self) -> None:
        self.extraction_path.parent.mkdir(parents=True)
        self.extraction_path.write_text("old extraction", encoding="utf-8")
        self.analysis_path.write_text("old analysis", encoding="utf-8")
        extraction = strict_extraction_from_benchmark("camry")
        extractor, _ = self.extractor_for(extraction)

        with patch.dict(os.environ, {}, clear=True):
            process_report(
                self.input_pdf,
                self.extraction_path,
                self.analysis_path,
                extractor=extractor,
            )

        self.assertEqual(self.load_output(self.extraction_path), extraction)
        self.assertEqual(
            self.load_output(self.analysis_path)["summary"]["comparableCount"],
            11,
        )
        self.assert_no_temporary_output(self.extraction_path)
        self.assert_no_temporary_output(self.analysis_path)


class PipelineFailureTests(PipelineTestCase):
    def test_missing_input_pdf_fails_before_extraction(self) -> None:
        missing_pdf = self.root / "missing.pdf"
        extractor = Mock(side_effect=AssertionError("extractor must not run"))

        with self.assertRaisesRegex(PipelineError, "Input file does not exist"):
            process_report(
                missing_pdf,
                self.extraction_path,
                self.analysis_path,
                extractor=extractor,
            )

        extractor.assert_not_called()
        self.assertFalse(self.extraction_path.exists())
        self.assertFalse(self.analysis_path.exists())

    def test_non_pdf_input_fails_before_extraction(self) -> None:
        text_path = self.root / "report.txt"
        text_path.write_bytes(b"%PDF-1.4\n%%EOF\n")
        extractor = Mock(side_effect=AssertionError("extractor must not run"))

        with self.assertRaisesRegex(PipelineError, "Input is not a PDF"):
            process_report(
                text_path,
                self.extraction_path,
                self.analysis_path,
                extractor=extractor,
            )

        extractor.assert_not_called()
        self.assertFalse(self.extraction_path.exists())
        self.assertFalse(self.analysis_path.exists())

    def test_extraction_failure_writes_neither_output(self) -> None:
        extractor = Mock(side_effect=PrototypeError("fixture extraction failed"))
        analyzer = Mock(side_effect=AssertionError("analyzer must not run"))

        with self.assertRaisesRegex(
            PipelineError, "Extraction failed: fixture extraction failed"
        ):
            process_report(
                self.input_pdf,
                self.extraction_path,
                self.analysis_path,
                extractor=extractor,
                analyzer=analyzer,
            )

        analyzer.assert_not_called()
        self.assertFalse(self.extraction_path.exists())
        self.assertFalse(self.analysis_path.exists())

    def test_invalid_extractor_result_is_a_clean_pipeline_failure(self) -> None:
        analyzer = Mock(side_effect=AssertionError("analyzer must not run"))

        with self.assertRaisesRegex(
            PipelineError, "extractor did not return AIExtractionResult"
        ):
            process_report(
                self.input_pdf,
                self.extraction_path,
                self.analysis_path,
                extractor=lambda _path, _schema: {},  # type: ignore[return-value]
                analyzer=analyzer,
            )

        analyzer.assert_not_called()
        self.assertFalse(self.extraction_path.exists())
        self.assertFalse(self.analysis_path.exists())

    def test_extraction_validation_failure_writes_neither_output(self) -> None:
        invalid = strict_extraction_from_benchmark("camry")
        del invalid["vehicle"]["bodyStyle"]
        extractor, _ = self.extractor_for(invalid)
        analyzer = Mock(side_effect=AssertionError("analyzer must not run"))

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(PipelineError) as raised:
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=analyzer,
                )

        self.assertEqual(str(raised.exception), "Extraction failed schema validation")
        self.assertTrue(
            any("bodyStyle" in detail for detail in raised.exception.details)
        )
        analyzer.assert_not_called()
        self.assertFalse(self.extraction_path.exists())
        self.assertFalse(self.analysis_path.exists())

    def test_duplicate_comparable_numbers_fail_before_analysis(self) -> None:
        invalid = strict_extraction_from_benchmark("elantra")
        invalid["comparables"][-1]["number"] = 1
        extractor, _ = self.extractor_for(invalid)
        analyzer = Mock(side_effect=AssertionError("analyzer must not run"))

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(PipelineError) as raised:
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=analyzer,
                )

        self.assertTrue(
            any("duplicate comparable number" in detail for detail in raised.exception.details)
        )
        analyzer.assert_not_called()
        self.assertFalse(self.extraction_path.exists())
        self.assertFalse(self.analysis_path.exists())

    def test_invalid_json_output_is_atomic_and_preserves_existing_files(self) -> None:
        old_extraction = b'{"sentinel": "old extraction"}\n'
        old_analysis = b'{"sentinel": "old analysis"}\n'
        self.extraction_path.parent.mkdir(parents=True)
        self.extraction_path.write_bytes(old_extraction)
        self.analysis_path.write_bytes(old_analysis)
        invalid_json = strict_extraction_from_benchmark("camry")
        invalid_json["valuation"]["total"] = math.nan
        extractor, _ = self.extractor_for(invalid_json)
        analyzer = Mock(side_effect=AssertionError("analyzer must not run"))

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(PipelineError, "Extraction output failed"):
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=analyzer,
                )

        analyzer.assert_not_called()
        self.assertEqual(self.extraction_path.read_bytes(), old_extraction)
        self.assertEqual(self.analysis_path.read_bytes(), old_analysis)
        self.assert_no_temporary_output(self.extraction_path)

    def test_extraction_replace_failure_preserves_existing_files(self) -> None:
        old_extraction = b'{"sentinel": "old extraction"}\n'
        old_analysis = b'{"sentinel": "old analysis"}\n'
        self.extraction_path.parent.mkdir(parents=True)
        self.extraction_path.write_bytes(old_extraction)
        self.analysis_path.write_bytes(old_analysis)
        extractor, _ = self.extractor_for(
            strict_extraction_from_benchmark("camry")
        )
        analyzer = Mock(side_effect=AssertionError("analyzer must not run"))

        with (
            patch.dict(os.environ, {}, clear=True),
            patch(
                "scripts.extract_report_ai.os.replace",
                side_effect=OSError("fixture replace failed"),
            ),
        ):
            with self.assertRaisesRegex(PipelineError, "Extraction output failed"):
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=analyzer,
                )

        analyzer.assert_not_called()
        self.assertEqual(self.extraction_path.read_bytes(), old_extraction)
        self.assertEqual(self.analysis_path.read_bytes(), old_analysis)
        self.assert_no_temporary_output(self.extraction_path)

    def test_analysis_generation_failure_retains_only_valid_extraction(self) -> None:
        extraction = strict_extraction_from_benchmark("camry")
        extraction_before = copy.deepcopy(extraction)
        extractor, _ = self.extractor_for(extraction)

        def failing_analyzer(report: dict[str, Any]) -> dict[str, Any]:
            self.assertIs(report, extraction)
            raise RuntimeError("fixture analyzer failed")

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(
                PipelineError, "Analysis generation failed: fixture analyzer failed"
            ):
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=failing_analyzer,
                )

        self.assertEqual(self.load_output(self.extraction_path), extraction_before)
        self.assertEqual(extraction, extraction_before)
        self.assertFalse(self.analysis_path.exists())

    def test_expected_analysis_error_is_normalized_to_pipeline_error(self) -> None:
        extraction = strict_extraction_from_benchmark("camry")
        extractor, _ = self.extractor_for(extraction)

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(
                PipelineError, "Analysis generation failed: fixture analysis error"
            ):
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=Mock(
                        side_effect=AnalysisError("fixture analysis error")
                    ),
                )

        self.assertEqual(self.load_output(self.extraction_path), extraction)
        self.assertFalse(self.analysis_path.exists())

    def test_analysis_schema_failure_preserves_previous_analysis(self) -> None:
        previous_analysis = b'{"sentinel": "previous analysis"}\n'
        self.analysis_path.parent.mkdir(parents=True)
        self.analysis_path.write_bytes(previous_analysis)
        extraction = strict_extraction_from_benchmark("elantra")
        extractor, _ = self.extractor_for(extraction)

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(
                PipelineError, "Analysis validation failed"
            ):
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=lambda report: {},
                )

        self.assertEqual(self.load_output(self.extraction_path), extraction)
        self.assertEqual(self.analysis_path.read_bytes(), previous_analysis)
        self.assert_no_temporary_output(self.analysis_path)

    def test_analysis_output_failure_is_atomic_and_keeps_new_extraction(self) -> None:
        previous_analysis = b'{"sentinel": "previous analysis"}\n'
        self.analysis_path.parent.mkdir(parents=True)
        self.analysis_path.write_bytes(previous_analysis)
        extraction = strict_extraction_from_benchmark("elantra")
        extractor, _ = self.extractor_for(extraction)

        def non_json_analysis(report: dict[str, Any]) -> dict[str, Any]:
            result = analyze_report(report)
            result["summary"]["total"] = math.inf
            return result

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(PipelineError, "Analysis output failed"):
                process_report(
                    self.input_pdf,
                    self.extraction_path,
                    self.analysis_path,
                    extractor=extractor,
                    analyzer=non_json_analysis,
                )

        self.assertEqual(self.load_output(self.extraction_path), extraction)
        self.assertEqual(self.analysis_path.read_bytes(), previous_analysis)
        self.assert_no_temporary_output(self.analysis_path)

    def test_input_and_output_paths_must_be_distinct(self) -> None:
        extractor = Mock(side_effect=AssertionError("extractor must not run"))

        with self.assertRaisesRegex(PipelineError, "paths must be different"):
            process_report(
                self.input_pdf,
                self.input_pdf,
                self.analysis_path,
                extractor=extractor,
            )

        extractor.assert_not_called()

    def test_case_only_path_alias_cannot_replace_the_input_pdf(self) -> None:
        input_path = self.root / "Report.pdf"
        input_bytes = b"%PDF-1.4\nsource must survive\n%%EOF\n"
        input_path.write_bytes(input_bytes)
        case_alias = self.root / "report.PDF"
        extractor = Mock(side_effect=AssertionError("extractor must not run"))

        with self.assertRaisesRegex(PipelineError, "paths must be different"):
            process_report(
                input_path,
                case_alias,
                self.analysis_path,
                extractor=extractor,
            )

        extractor.assert_not_called()
        self.assertEqual(input_path.read_bytes(), input_bytes)


class PipelinePathTests(unittest.TestCase):
    def test_default_paths_use_the_input_stem_and_processed_directories(self) -> None:
        extraction_path, analysis_path = default_output_paths("some/report.PDF")

        self.assertEqual(extraction_path.name, "report.json")
        self.assertEqual(analysis_path.name, "report.analysis.json")
        self.assertEqual(extraction_path.parent.name, "processed")
        self.assertEqual(analysis_path.parent.name, "processed")


class LivePipelineSafetyTests(unittest.TestCase):
    def test_elantra_live_stability_check_requires_rounding_review(self) -> None:
        extraction = strict_extraction_from_benchmark("elantra")
        analysis = analyze_report(extraction)

        self.assertEqual(
            live_pipeline.stable_analysis_mismatches(
                "elantra", extraction, analysis
            ),
            [],
        )

        finding(analysis, "CONTRIBUTION_PERCENTAGES")["description"] = (
            "Generic review without the expected caveat."
        )
        mismatches = live_pipeline.stable_analysis_mismatches(
            "elantra", extraction, analysis
        )
        self.assertTrue(
            any("CONTRIBUTION_PERCENTAGES" in mismatch for mismatch in mismatches)
        )

    def test_case_variant_output_directory_cannot_replace_tracked_benchmark(
        self,
    ) -> None:
        sample = live_pipeline.SAMPLES["camry"]
        benchmark_path = live_pipeline.BENCHMARKS_DIR / sample.benchmark_filename
        benchmark_before = benchmark_path.read_bytes()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            raw_dir.mkdir()
            (raw_dir / sample.pdf_filename).write_bytes(b"%PDF-1.4\n%%EOF\n")
            case_variant_output_dir = (
                live_pipeline.BENCHMARKS_DIR.parent
                / live_pipeline.BENCHMARKS_DIR.name.swapcase()
            )
            extractor = Mock(
                side_effect=AssertionError("live extraction must not run")
            )

            with (
                patch.object(
                    live_pipeline,
                    "extract_report_with_openai",
                    extractor,
                ),
                redirect_stdout(io.StringIO()),
            ):
                passed = live_pipeline.run_sample(
                    sample,
                    raw_dir,
                    case_variant_output_dir,
                    root / "analysis",
                )

        self.assertFalse(passed)
        extractor.assert_not_called()
        self.assertEqual(benchmark_path.read_bytes(), benchmark_before)


class ProcessReportCliTests(unittest.TestCase):
    def test_cli_runs_the_real_pipeline_with_only_openai_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_path = root / "camry.pdf"
            input_path.write_bytes(b"%PDF-1.4\n%%EOF\n")
            extraction_path = root / "camry.json"
            analysis_path = root / "camry.analysis.json"
            extraction = strict_extraction_from_benchmark("camry")
            fake_boundary = Mock(
                return_value=AIExtractionResult(
                    data=extraction,
                    model="fixture-gpt-5.6-sol",
                    usage=None,
                )
            )
            stdout = io.StringIO()
            stderr = io.StringIO()

            with (
                patch.dict(os.environ, {}, clear=True),
                patch(
                    "venfour.pipeline.extract_report_with_openai",
                    fake_boundary,
                ),
                redirect_stdout(stdout),
                redirect_stderr(stderr),
            ):
                exit_code = process_report_cli.main(
                    [
                        str(input_path),
                        "--extraction-output",
                        str(extraction_path),
                        "--analysis-output",
                        str(analysis_path),
                    ]
                )

            self.assertEqual(exit_code, 0, stderr.getvalue())
            self.assertTrue(extraction_path.is_file())
            self.assertTrue(analysis_path.is_file())
            self.assertIn("Findings: 2 PASS, 4 REVIEW, 0 WARNING", stdout.getvalue())
            fake_boundary.assert_called_once()

    def test_cli_success_returns_zero_and_prints_concise_summary(self) -> None:
        input_path = Path("fixtures/camry.pdf")
        extraction_path = Path("out/camry.json")
        analysis_path = Path("out/camry.analysis.json")
        result = ProcessReportResult(
            extraction_path=extraction_path,
            analysis_path=analysis_path,
            model="fixture-gpt-5.6-sol",
            usage={"totalTokens": 150},
            finding_counts={"PASS": 5, "REVIEW": 2, "WARNING": 0},
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(process_report_cli, "process_report", return_value=result) as run:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                exit_code = process_report_cli.main(
                    [
                        str(input_path),
                        "--extraction-output",
                        str(extraction_path),
                        "--analysis-output",
                        str(analysis_path),
                    ]
                )

        self.assertEqual(exit_code, 0)
        run.assert_called_once_with(
            input_path,
            extraction_path=extraction_path,
            analysis_path=analysis_path,
        )
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(
            stdout.getvalue().splitlines(),
            [
                "Processed camry.pdf",
                f"Extraction: {extraction_path}",
                f"Analysis: {analysis_path}",
                "Findings: 5 PASS, 2 REVIEW, 0 WARNING",
            ],
        )

    def test_cli_failure_returns_one_and_prints_validation_details(self) -> None:
        error = PipelineError(
            "Extraction failed schema validation",
            ("$.vehicle: 'bodyStyle' is a required property",),
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch.object(process_report_cli, "process_report", side_effect=error):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                exit_code = process_report_cli.main(["fixtures/invalid.pdf"])

        self.assertEqual(exit_code, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(
            stderr.getvalue().splitlines(),
            [
                "Error: Extraction failed schema validation",
                "  - $.vehicle: 'bodyStyle' is a required property",
            ],
        )


if __name__ == "__main__":
    unittest.main()
