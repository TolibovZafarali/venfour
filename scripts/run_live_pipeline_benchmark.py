#!/usr/bin/env python3
"""Run verified live extraction benchmarks through the report pipeline."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.benchmark_report import compare_benchmark, load_json  # noqa: E402
from scripts.extract_report_ai import (  # noqa: E402
    AIExtractionResult,
    OutputValidationError,
    PrototypeError,
    extract_report_with_openai,
    read_canonical_schema,
    require_dependencies,
)
from scripts.run_live_benchmark import (  # noqa: E402
    BENCHMARKS_DIR,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_RAW_DIR,
    SAMPLES,
    Sample,
    selected_samples,
)
from venfour.pipeline import (  # noqa: E402
    PipelineError,
    ensure_distinct_paths,
    process_report,
)


DEFAULT_ANALYSIS_OUTPUT_DIR = REPO_ROOT / "data" / "analyzed" / "benchmarks"
MISSING = object()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract one or both CCC sample PDFs with GPT-5.6 Sol, compare "
            "verified fields, and run the validated deterministic pipeline."
        )
    )
    parser.add_argument(
        "sample",
        choices=(*SAMPLES, "all"),
        help="Benchmark sample to process, or 'all' for both samples",
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=DEFAULT_RAW_DIR,
        help=f"Directory containing source PDFs (default: {DEFAULT_RAW_DIR})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=(
            "Directory for validated extraction JSON "
            f"(default: {DEFAULT_OUTPUT_DIR})"
        ),
    )
    parser.add_argument(
        "--analysis-output-dir",
        type=Path,
        default=DEFAULT_ANALYSIS_OUTPUT_DIR,
        help=(
            "Directory for validated analysis JSON "
            f"(default: {DEFAULT_ANALYSIS_OUTPUT_DIR})"
        ),
    )
    return parser.parse_args(argv)


def _path_value(value: Any, *parts: str) -> Any:
    current = value
    for part in parts:
        if not isinstance(current, Mapping) or part not in current:
            return MISSING
        current = current[part]
    return current


def _format_value(value: Any) -> str:
    if value is MISSING:
        return "<missing>"
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError):
        return repr(value)


def _expect_equal(
    errors: list[str], path: str, actual: Any, expected: Any
) -> None:
    if actual != expected:
        errors.append(
            f"{path}: expected={_format_value(expected)}, "
            f"actual={_format_value(actual)}"
        )


def _expect_finding(
    errors: list[str],
    analysis: Mapping[str, Any],
    code: str,
    status: str,
    comparable_numbers: list[int] | None = None,
    description_contains: str | None = None,
) -> None:
    raw_findings = analysis.get("findings")
    findings = raw_findings if isinstance(raw_findings, list) else []
    matches = [
        finding
        for finding in findings
        if isinstance(finding, Mapping) and finding.get("code") == code
    ]
    if len(matches) != 1:
        errors.append(
            f"$.findings[code={code}]: expected exactly one finding, "
            f"actual={len(matches)}"
        )
        return

    finding = matches[0]
    _expect_equal(
        errors,
        f"$.findings[code={code}].status",
        finding.get("status", MISSING),
        status,
    )
    if comparable_numbers is not None:
        _expect_equal(
            errors,
            f"$.findings[code={code}].comparableNumbers",
            finding.get("comparableNumbers", MISSING),
            comparable_numbers,
        )
    if description_contains is not None:
        description = finding.get("description")
        if (
            not isinstance(description, str)
            or description_contains.casefold() not in description.casefold()
        ):
            errors.append(
                f"$.findings[code={code}].description: expected text containing "
                f"{_format_value(description_contains)}, "
                f"actual={_format_value(description)}"
            )


def _expect_no_warnings(
    errors: list[str], analysis: Mapping[str, Any]
) -> None:
    _expect_equal(
        errors,
        "$.summary.findingCounts.WARNING",
        _path_value(analysis, "summary", "findingCounts", "WARNING"),
        0,
    )
    raw_findings = analysis.get("findings")
    findings = raw_findings if isinstance(raw_findings, list) else []
    warning_codes = [
        finding.get("code")
        for finding in findings
        if isinstance(finding, Mapping) and finding.get("status") == "WARNING"
    ]
    if warning_codes:
        errors.append(
            "$.findings: expected no WARNING findings, "
            f"actual={_format_value(warning_codes)}"
        )


def stable_analysis_mismatches(
    sample_name: str,
    extraction: Any,
    analysis: Any,
) -> list[str]:
    """Return regressions in the verified stable analysis behavior."""

    if not isinstance(analysis, Mapping):
        return [
            "$: expected analysis object, "
            f"actual={_format_value(analysis)}"
        ]

    errors: list[str] = []
    if sample_name == "camry":
        _expect_equal(
            errors,
            "$.summary.comparableCount",
            _path_value(analysis, "summary", "comparableCount"),
            11,
        )
        _expect_finding(errors, analysis, "VALUATION_ARITHMETIC", "PASS")
        _expect_finding(
            errors,
            analysis,
            "UNDISCLOSED_COMPARABLE_ADJUSTMENTS",
            "REVIEW",
            list(range(1, 12)),
        )
        _expect_no_warnings(errors, analysis)
        return errors

    if sample_name == "elantra":
        _expect_equal(
            errors,
            "extraction.$.vehicle.bodyStyle",
            _path_value(extraction, "vehicle", "bodyStyle"),
            "Sedan",
        )
        _expect_equal(
            errors,
            "$.summary.comparableCount",
            _path_value(analysis, "summary", "comparableCount"),
            12,
        )
        _expect_equal(
            errors,
            "$.metrics.condition.totalAdjustment",
            _path_value(analysis, "metrics", "condition", "totalAdjustment"),
            297,
        )
        _expect_finding(
            errors,
            analysis,
            "CONDITION_ADJUSTMENT_RECONCILIATION",
            "PASS",
        )
        _expect_finding(
            errors,
            analysis,
            "COMPARABLE_ADJUSTMENT_RECONCILIATION",
            "PASS",
            list(range(1, 7)),
        )
        _expect_finding(
            errors,
            analysis,
            "MILEAGE_ADJUSTMENT_DIRECTION",
            "PASS",
            list(range(1, 7)),
        )
        _expect_finding(
            errors,
            analysis,
            "UNDISCLOSED_COMPARABLE_ADJUSTMENTS",
            "REVIEW",
            list(range(7, 13)),
        )
        _expect_finding(
            errors,
            analysis,
            "CONTRIBUTION_PERCENTAGES",
            "REVIEW",
            description_contains="round",
        )
        _expect_no_warnings(errors, analysis)
        return errors

    return [f"Unsupported benchmark sample: {sample_name}"]


def run_sample(
    sample: Sample,
    raw_dir: Path,
    output_dir: Path,
    analysis_output_dir: Path,
) -> bool:
    pdf_path = raw_dir / sample.pdf_filename
    benchmark_path = BENCHMARKS_DIR / sample.benchmark_filename
    extraction_path = output_dir / sample.output_filename
    analysis_path = analysis_output_dir / f"{sample.name}.analysis.json"

    print(f"\n=== {sample.name.upper()} LIVE PIPELINE BENCHMARK ===", flush=True)
    if not pdf_path.is_file():
        print(f"FAIL {sample.name}: source PDF not found: {pdf_path}")
        return False
    if not benchmark_path.is_file():
        print(f"FAIL {sample.name}: benchmark not found: {benchmark_path}")
        return False
    try:
        ensure_distinct_paths(
            pdf_path,
            benchmark_path,
            extraction_path,
            analysis_path,
        )
    except PipelineError as exc:
        print(f"FAIL {sample.name}: unsafe benchmark paths: {exc}")
        return False

    print(f"Source: {pdf_path}")
    print(f"Extraction: {extraction_path}")
    print(f"Analysis: {analysis_path}", flush=True)

    try:
        require_dependencies()
        canonical_schema = read_canonical_schema()
        live_extraction = extract_report_with_openai(pdf_path, canonical_schema)
    except OutputValidationError as exc:
        print(f"FAIL {sample.name}: live extraction failed schema validation")
        for detail in exc.errors:
            print(f"  - {detail}")
        return False
    except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
        print(f"FAIL {sample.name}: live extraction failed: {exc}")
        return False

    try:
        benchmark = load_json(benchmark_path)
        mismatches = compare_benchmark(benchmark, live_extraction.data)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"FAIL {sample.name}: benchmark comparison failed: {exc}")
        return False

    if mismatches:
        print(f"FAIL {sample.name}: {len(mismatches)} benchmark mismatch(es)")
        for mismatch in mismatches:
            print(f"  - {mismatch}")
        return False

    print(f"Verified extraction: PASS ({sample.name})")

    def reuse_live_extraction(
        _input_path: Path, _canonical_schema: dict[str, Any]
    ) -> AIExtractionResult:
        return live_extraction

    try:
        result = process_report(
            pdf_path,
            extraction_path=extraction_path,
            analysis_path=analysis_path,
            extractor=reuse_live_extraction,
        )
    except PipelineError as exc:
        print(f"FAIL {sample.name}: pipeline failed: {exc}")
        for detail in exc.details:
            print(f"  - {detail}")
        return False

    try:
        analysis = load_json(result.analysis_path)
        stable_mismatches = stable_analysis_mismatches(
            sample.name,
            live_extraction.data,
            analysis,
        )
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"FAIL {sample.name}: stable analysis check failed: {exc}")
        return False

    if stable_mismatches:
        print(
            f"FAIL {sample.name}: "
            f"{len(stable_mismatches)} stable analysis mismatch(es)"
        )
        for mismatch in stable_mismatches:
            print(f"  - {mismatch}")
        return False

    counts = result.finding_counts
    print(
        "Findings: "
        f"{counts['PASS']} PASS, {counts['REVIEW']} REVIEW, "
        f"{counts['WARNING']} WARNING"
    )
    print(
        f"PASS {sample.name}: verified extraction and stable analysis checks match"
    )
    return True


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set", file=sys.stderr)
        return 2

    raw_dir = args.raw_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    analysis_output_dir = args.analysis_output_dir.expanduser().resolve()
    results = [
        run_sample(sample, raw_dir, output_dir, analysis_output_dir)
        for sample in selected_samples(args.sample)
    ]

    passed = sum(results)
    print(f"\nLive pipeline benchmark summary: {passed}/{len(results)} passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
