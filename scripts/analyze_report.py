#!/usr/bin/env python3
"""Run deterministic valuation analysis on canonical CCC report JSON."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from venfour.analysis import analyze_report  # noqa: E402


CANONICAL_SCHEMA_PATH = REPO_ROOT / "schemas" / "ccc" / "report.schema.json"
ANALYSIS_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "analysis" / "report-analysis.schema.json"
)


class AnalysisError(Exception):
    """Expected, user-facing analysis or input/output failure."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Analyze already-extracted canonical CCC report JSON without making "
            "external requests."
        )
    )
    parser.add_argument("input_json", type=Path, help="Canonical extraction JSON")
    parser.add_argument("output_json", type=Path, help="Analysis output JSON")
    return parser.parse_args(argv)


def load_json(path: Path | str) -> dict[str, Any]:
    """Read strict JSON with an object root."""

    json_path = Path(path)

    def reject_constant(value: str) -> Any:
        raise ValueError(f"non-finite JSON number {value}")

    try:
        with json_path.open(encoding="utf-8") as json_file:
            data = json.load(json_file, parse_constant=reject_constant)
        stack: list[tuple[str, Any]] = [("$", data)]
        while stack:
            value_path, value = stack.pop()
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"non-finite JSON number at {value_path}")
            if isinstance(value, dict):
                stack.extend(
                    (f"{value_path}.{key}", child) for key, child in value.items()
                )
            elif isinstance(value, list):
                stack.extend(
                    (f"{value_path}[{index}]", child)
                    for index, child in enumerate(value)
                )
    except OSError as exc:
        raise AnalysisError(f"JSON could not be read: {json_path} ({exc})") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise AnalysisError(f"Invalid JSON in {json_path}: {exc}") from exc

    if not isinstance(data, dict):
        raise AnalysisError(f"JSON root must be an object: {json_path}")
    return data


def read_schema(path: Path | str) -> dict[str, Any]:
    """Read and verify a Draft 2020-12 JSON Schema."""

    schema_path = Path(path)
    try:
        with schema_path.open(encoding="utf-8") as schema_file:
            schema = json.load(schema_file)
    except OSError as exc:
        raise AnalysisError(f"Schema could not be read: {schema_path} ({exc})") from exc
    except json.JSONDecodeError as exc:
        raise AnalysisError(f"Schema is not valid JSON: {schema_path} ({exc})") from exc

    if not isinstance(schema, dict):
        raise AnalysisError(f"Schema root must be an object: {schema_path}")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise AnalysisError(f"Invalid JSON Schema {schema_path}: {exc.message}") from exc
    return schema


def _json_path(parts: Sequence[Any]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part, ensure_ascii=False)}]"
    return path


def validate_json(data: Any, schema: Mapping[str, Any], label: str) -> None:
    """Raise AnalysisError with stable JSON paths for schema violations."""

    validator = Draft202012Validator(schema)
    errors = sorted(
        validator.iter_errors(data),
        key=lambda error: (list(error.absolute_path), error.message),
    )
    if not errors:
        return
    messages = [
        f"{_json_path(list(error.absolute_path))}: {error.message}"
        for error in errors
    ]
    raise AnalysisError(f"{label} failed schema validation: " + "; ".join(messages))


def write_output(path: Path | str, data: Any) -> None:
    """Write formatted JSON atomically in the destination directory."""

    output_path = Path(path)
    temporary_path: Path | None = None
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(
                data,
                temporary_file,
                indent=2,
                ensure_ascii=False,
                allow_nan=False,
            )
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, output_path)
    except (OSError, TypeError, ValueError) as exc:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise AnalysisError(f"Analysis output could not be written: {output_path} ({exc})") from exc


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    input_path = args.input_json.expanduser()
    output_path = args.output_json.expanduser()

    try:
        if input_path.resolve() == output_path.resolve():
            raise AnalysisError("Input and output paths must be different")
        canonical_schema = read_schema(CANONICAL_SCHEMA_PATH)
        analysis_schema = read_schema(ANALYSIS_SCHEMA_PATH)
        report = load_json(input_path)
        validate_json(report, canonical_schema, "Canonical report input")
        analysis = analyze_report(report)
        validate_json(analysis, analysis_schema, "Analysis output")
        write_output(output_path, analysis)
    except (AnalysisError, TypeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(
        f"Analyzed {input_path} to {output_path} "
        f"({analysis['summary']['comparableCount']} comparables, "
        f"{len(analysis['findings'])} findings)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
