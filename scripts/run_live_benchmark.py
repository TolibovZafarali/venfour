#!/usr/bin/env python3
"""Run fresh CCC report extractions and compare verified benchmark fields."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.benchmark_report import compare_benchmark, load_json  # noqa: E402


EXTRACTOR_PATH = REPO_ROOT / "scripts" / "extract_report_ai.py"
BENCHMARKS_DIR = REPO_ROOT / "tests" / "benchmarks"
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw" / "ccc"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data" / "extracted" / "benchmarks"


@dataclass(frozen=True)
class Sample:
    name: str
    pdf_filename: str
    benchmark_filename: str

    @property
    def output_filename(self) -> str:
        return f"{self.name}.json"


SAMPLES = {
    "camry": Sample(
        name="camry",
        pdf_filename="ccc-001-camry-auto-club.pdf",
        benchmark_filename="camry.json",
    ),
    "elantra": Sample(
        name="elantra",
        pdf_filename="ccc-002-elantra-state-farm.pdf",
        benchmark_filename="elantra.json",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract one or both CCC sample PDFs with GPT-5.6 Sol and compare "
            "the result with manually verified benchmark fields."
        )
    )
    parser.add_argument(
        "sample",
        choices=(*SAMPLES, "all"),
        help="Benchmark sample to extract, or 'all' for both samples",
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
            "Directory for generated extraction JSON "
            f"(default: {DEFAULT_OUTPUT_DIR})"
        ),
    )
    return parser.parse_args()


def selected_samples(name: str) -> list[Sample]:
    if name == "all":
        return list(SAMPLES.values())
    return [SAMPLES[name]]


def run_sample(sample: Sample, raw_dir: Path, output_dir: Path) -> bool:
    pdf_path = raw_dir / sample.pdf_filename
    benchmark_path = BENCHMARKS_DIR / sample.benchmark_filename
    output_path = output_dir / sample.output_filename

    print(f"\n=== {sample.name.upper()} LIVE BENCHMARK ===", flush=True)
    if not pdf_path.is_file():
        print(f"FAIL {sample.name}: source PDF not found: {pdf_path}")
        return False
    if not benchmark_path.is_file():
        print(f"FAIL {sample.name}: benchmark not found: {benchmark_path}")
        return False

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Source: {pdf_path}")
    print(f"Generated JSON: {output_path}", flush=True)
    completed = subprocess.run(
        [sys.executable, str(EXTRACTOR_PATH), str(pdf_path), str(output_path)],
        cwd=REPO_ROOT,
        check=False,
    )
    if completed.returncode != 0:
        print(
            f"FAIL {sample.name}: extraction or schema validation exited "
            f"with status {completed.returncode}"
        )
        return False

    try:
        benchmark = load_json(benchmark_path)
        actual = load_json(output_path)
        mismatches = compare_benchmark(benchmark, actual)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"FAIL {sample.name}: benchmark comparison failed: {exc}")
        return False

    if mismatches:
        print(f"FAIL {sample.name}: {len(mismatches)} benchmark mismatch(es)")
        for mismatch in mismatches:
            print(f"  - {mismatch}")
        return False

    print(f"PASS {sample.name}: all manually verified fields match")
    return True


def main() -> int:
    args = parse_args()
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set", file=sys.stderr)
        return 2

    raw_dir = args.raw_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    results = [
        run_sample(sample, raw_dir, output_dir)
        for sample in selected_samples(args.sample)
    ]

    passed = sum(results)
    print(f"\nLive benchmark summary: {passed}/{len(results)} passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
