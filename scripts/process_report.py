#!/usr/bin/env python3
"""Process one CCC PDF through extraction and deterministic analysis."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from venfour.pipeline import PipelineError, process_report  # noqa: E402


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract and validate one CCC PDF, run deterministic analysis, and "
            "atomically write both JSON artifacts."
        )
    )
    parser.add_argument("input_pdf", type=Path, help="Path to the source CCC PDF")
    parser.add_argument(
        "--extraction-output",
        type=Path,
        help=(
            "Validated extraction JSON path (default: "
            "data/extracted/processed/<input-stem>.json)"
        ),
    )
    parser.add_argument(
        "--analysis-output",
        type=Path,
        help=(
            "Validated analysis JSON path (default: "
            "data/analyzed/processed/<input-stem>.analysis.json)"
        ),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = process_report(
            args.input_pdf,
            extraction_path=args.extraction_output,
            analysis_path=args.analysis_output,
        )
    except PipelineError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        for detail in exc.details:
            print(f"  - {detail}", file=sys.stderr)
        return 1

    counts = result.finding_counts
    print(f"Processed {args.input_pdf.name}")
    print(f"Extraction: {result.extraction_path}")
    print(f"Analysis: {result.analysis_path}")
    print(
        "Findings: "
        f"{counts['PASS']} PASS, {counts['REVIEW']} REVIEW, "
        f"{counts['WARNING']} WARNING"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
