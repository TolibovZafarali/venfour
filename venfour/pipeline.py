"""End-to-end orchestration for one CCC PDF.

The extraction and analysis implementations remain independent. This module
coordinates them, applies both output contracts, and persists each valid JSON
artifact atomically.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scripts.analyze_report import (
    ANALYSIS_SCHEMA_PATH,
    AnalysisError,
    read_schema,
    validate_json,
    write_output as write_analysis_output,
)
from scripts.extract_report_ai import (
    AIExtractionResult,
    OutputValidationError,
    PrototypeError,
    extract_report_with_openai,
    read_canonical_schema,
    validate_extraction,
    validate_input,
    write_output as write_extraction_output,
)
from venfour.analysis import analyze_report


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EXTRACTION_DIR = REPO_ROOT / "data" / "extracted" / "processed"
DEFAULT_ANALYSIS_DIR = REPO_ROOT / "data" / "analyzed" / "processed"

Extractor = Callable[[Path, dict[str, Any]], AIExtractionResult]
Analyzer = Callable[[Mapping[str, Any]], dict[str, Any]]


class PipelineError(Exception):
    """Expected end-to-end processing failure with optional validation details."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class ProcessReportResult:
    """Artifacts and request metadata produced by a successful pipeline run."""

    extraction_path: Path
    analysis_path: Path
    model: str
    usage: dict[str, int | None] | None
    finding_counts: dict[str, int]


def default_output_paths(input_pdf: Path | str) -> tuple[Path, Path]:
    """Return the repository's conventional output paths for one PDF."""

    stem = Path(input_pdf).stem
    return (
        DEFAULT_EXTRACTION_DIR / f"{stem}.json",
        DEFAULT_ANALYSIS_DIR / f"{stem}.analysis.json",
    )


def ensure_distinct_paths(*paths: Path) -> None:
    """Reject aliases that could make one artifact replace another file."""

    try:
        resolved = [path.resolve() for path in paths]
    except (OSError, RuntimeError) as exc:
        raise PipelineError(
            f"Input or output path could not be resolved: {exc}"
        ) from exc
    normalized = [
        unicodedata.normalize("NFC", str(path)).casefold() for path in resolved
    ]

    for left_index, left in enumerate(paths):
        for right_index in range(left_index + 1, len(paths)):
            right = paths[right_index]
            same_existing_file = False
            try:
                same_existing_file = (
                    left.exists() and right.exists() and left.samefile(right)
                )
            except OSError:
                pass
            if (
                resolved[left_index] == resolved[right_index]
                or normalized[left_index] == normalized[right_index]
                or same_existing_file
            ):
                raise PipelineError(
                    "Input and output paths must be different files"
                )


def process_report(
    input_pdf: Path | str,
    extraction_path: Path | str | None = None,
    analysis_path: Path | str | None = None,
    *,
    extractor: Extractor | None = None,
    analyzer: Analyzer | None = None,
) -> ProcessReportResult:
    """Extract, validate, analyze, validate, and atomically persist one report.

    The extraction is committed after extraction validation and before analysis.
    Consequently, a later analysis failure intentionally leaves the new valid
    extraction in place, while the analysis destination remains untouched.
    """

    input_path = Path(input_pdf).expanduser()
    default_extraction, default_analysis = default_output_paths(input_path)
    extraction_output = (
        Path(extraction_path).expanduser()
        if extraction_path is not None
        else default_extraction
    )
    analysis_output = (
        Path(analysis_path).expanduser()
        if analysis_path is not None
        else default_analysis
    )
    ensure_distinct_paths(input_path, extraction_output, analysis_output)

    try:
        validate_input(input_path)
        canonical_schema = read_canonical_schema()
        analysis_schema = read_schema(ANALYSIS_SCHEMA_PATH)
    except (PrototypeError, AnalysisError, OSError, RuntimeError) as exc:
        raise PipelineError(f"Pipeline setup failed: {exc}") from exc

    extraction_function = (
        extractor if extractor is not None else extract_report_with_openai
    )
    try:
        extraction = extraction_function(input_path, canonical_schema)
    except OutputValidationError as exc:
        raise PipelineError(
            "Extraction failed schema validation",
            tuple(exc.errors),
        ) from exc
    except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise PipelineError(f"Extraction failed: {exc}") from exc
    if not isinstance(extraction, AIExtractionResult):
        raise PipelineError(
            "Extraction failed: extractor did not return AIExtractionResult"
        )

    try:
        validate_extraction(extraction.data, canonical_schema)
    except OutputValidationError as exc:
        raise PipelineError(
            "Extraction failed schema validation",
            tuple(exc.errors),
        ) from exc
    except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise PipelineError(f"Extraction validation failed: {exc}") from exc

    try:
        write_extraction_output(extraction_output, extraction.data)
    except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise PipelineError(f"Extraction output failed: {exc}") from exc

    analysis_function = analyzer if analyzer is not None else analyze_report
    try:
        analysis = analysis_function(extraction.data)
    except (AnalysisError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise PipelineError(f"Analysis generation failed: {exc}") from exc

    try:
        validate_json(analysis, analysis_schema, "Analysis output")
    except AnalysisError as exc:
        raise PipelineError(f"Analysis validation failed: {exc}") from exc

    try:
        write_analysis_output(analysis_output, analysis)
    except (AnalysisError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise PipelineError(f"Analysis output failed: {exc}") from exc

    finding_counts = dict(analysis["summary"]["findingCounts"])
    return ProcessReportResult(
        extraction_path=extraction_output,
        analysis_path=analysis_output,
        model=extraction.model,
        usage=extraction.usage,
        finding_counts=finding_counts,
    )


__all__ = [
    "DEFAULT_ANALYSIS_DIR",
    "DEFAULT_EXTRACTION_DIR",
    "PipelineError",
    "ProcessReportResult",
    "default_output_paths",
    "ensure_distinct_paths",
    "process_report",
]
