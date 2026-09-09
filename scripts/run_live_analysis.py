#!/usr/bin/env python3
"""Validate legacy canonical input while requiring the case-owned live workflow."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, NoReturn


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.extract_report_ai import (  # noqa: E402
    OutputValidationError,
    PrototypeError,
    read_canonical_schema,
    validate_extraction,
)
from venfour.analysis_runs import DEFAULT_ANALYSIS_RUN_DIR  # noqa: E402
from venfour.discrepancy import (  # noqa: E402
    DiscrepancyContractError,
    valuation_discrepancy_request_from_report,
)
from venfour.postal_codes import normalize_us_zip_code  # noqa: E402


class LiveAnalysisError(Exception):
    """Expected local input, configuration, or live-analysis failure."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate an already-extracted canonical CCC JSON artifact. Live "
            "research must run through the existing case analysis workflow, "
            "which owns the processing lease and shared request allowance."
        )
    )
    parser.add_argument("canonical_json", type=Path, help="Canonical CCC JSON")
    parser.add_argument(
        "--postal-code",
        required=True,
        help="Vehicle ZIP code used as the market-search origin",
    )
    parser.add_argument(
        "--repository-root",
        type=Path,
        default=DEFAULT_ANALYSIS_RUN_DIR,
        help=(
            "Immutable analysis-run directory "
            f"(default: {DEFAULT_ANALYSIS_RUN_DIR})"
        ),
    )
    return parser.parse_args(argv)


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate object key {key!r}")
        result[key] = value
    return result


def _reject_nonstandard_number(value: str) -> None:
    raise ValueError(f"non-standard JSON number {value}")


def load_canonical_json(path: Path | str) -> dict[str, Any]:
    """Read strict object-root JSON without accepting duplicate keys or NaN."""

    canonical_path = Path(path).expanduser()
    try:
        with canonical_path.open(encoding="utf-8") as source:
            report = json.load(
                source,
                object_pairs_hook=_reject_duplicate_keys,
                parse_constant=_reject_nonstandard_number,
            )
    except OSError as exc:
        raise LiveAnalysisError(
            f"Canonical CCC JSON could not be read: {canonical_path}"
        ) from exc
    except (json.JSONDecodeError, RecursionError, UnicodeError, ValueError) as exc:
        raise LiveAnalysisError(
            f"Canonical CCC JSON is not strict JSON: {canonical_path}"
        ) from exc
    if not isinstance(report, dict):
        raise LiveAnalysisError("Canonical CCC JSON root must be an object")
    return report


def _normalized_postal_code(value: str) -> str:
    try:
        return normalize_us_zip_code(value)
    except (TypeError, ValueError) as exc:
        raise LiveAnalysisError(
            "A 5-digit US ZIP code or ZIP+4 is required"
        ) from exc


def run_live_analysis(
    canonical_json: Path | str,
    postal_code: str,
    *,
    repository_root: Path | str = DEFAULT_ANALYSIS_RUN_DIR,
    observed_date: date | None = None,
) -> NoReturn:
    """Reject unscoped execution before any provider or account request."""

    report = load_canonical_json(canonical_json)
    normalized_postal = _normalized_postal_code(postal_code)
    try:
        validate_extraction(report, read_canonical_schema())
    except OutputValidationError as exc:
        raise LiveAnalysisError("Canonical CCC JSON failed validation") from exc
    except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
        raise LiveAnalysisError("Canonical CCC validation could not complete") from exc

    effective_observed_date = (
        datetime.now(timezone.utc).date()
        if observed_date is None
        else observed_date
    )
    if not isinstance(effective_observed_date, date) or isinstance(
        effective_observed_date, datetime
    ):
        raise LiveAnalysisError("Observed date must be a date")
    try:
        base_request = valuation_discrepancy_request_from_report(
            report,
            postal_code=normalized_postal,
        )
    except DiscrepancyContractError as exc:
        raise LiveAnalysisError("Canonical CCC JSON cannot be analyzed") from exc
    if (
        base_request.loss_date is not None
        and date.fromisoformat(base_request.loss_date) > effective_observed_date
    ):
        raise LiveAnalysisError("Report loss date cannot be in the future")

    raise LiveAnalysisError(
        "Unscoped live analysis is disabled. Submit or resume the existing "
        "total-loss case analysis workflow so its processing lease, canonical "
        "source, and cumulative shared request allowance are enforced. A local "
        "canonical JSON file alone cannot establish that case context."
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        run_live_analysis(
            args.canonical_json,
            args.postal_code,
            repository_root=args.repository_root,
        )
    except LiveAnalysisError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
