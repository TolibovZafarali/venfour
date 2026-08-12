#!/usr/bin/env python3
"""Run and persist live market analysis from validated canonical CCC JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.extract_report_ai import (  # noqa: E402
    OutputValidationError,
    PrototypeError,
    read_canonical_schema,
    validate_extraction,
)
from venfour.analysis_runs import (  # noqa: E402
    DEFAULT_ANALYSIS_RUN_DIR,
    FileAnalysisRunRepository,
)
from venfour.discrepancy import (  # noqa: E402
    DiscrepancyContractError,
    valuation_discrepancy_request_from_report,
)
from venfour.market import MarketProviderError  # noqa: E402
from venfour.marketcheck import (  # noqa: E402
    MarketCheckHistoricalProvider,
    MarketCheckProvider,
)
from venfour.orchestration import (  # noqa: E402
    AnalysisOrchestrationError,
    AnalysisOrchestrator,
    AnalysisRunRequest,
    AnalysisRunResult,
    CurrentMarketSearchConfiguration,
    HistoricalMarketSearchConfiguration,
)


class LiveAnalysisError(Exception):
    """Expected local input, configuration, or live-analysis failure."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run live MarketCheck analysis and immutable persistence from an "
            "already-extracted canonical CCC JSON artifact. No PDF extraction or "
            "OpenAI request is performed."
        )
    )
    parser.add_argument("canonical_json", type=Path, help="Canonical CCC JSON")
    parser.add_argument(
        "--postal-code",
        required=True,
        help="Verified vehicle postal code used as the market-search origin",
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
    normalized = value.strip() if isinstance(value, str) else value
    if not isinstance(normalized, str) or not normalized:
        raise LiveAnalysisError("A verified postal code is required")
    return normalized


def run_live_analysis(
    canonical_json: Path | str,
    postal_code: str,
    *,
    repository_root: Path | str = DEFAULT_ANALYSIS_RUN_DIR,
    observed_date: date | None = None,
) -> AnalysisRunResult:
    """Run the production orchestration path without the PDF extraction step."""

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

    api_key = os.environ.get("MARKETCHECK_API_KEY")
    if not isinstance(api_key, str) or not api_key.strip():
        raise LiveAnalysisError("MARKETCHECK_API_KEY is not set")
    try:
        current_provider = MarketCheckProvider(api_key)
        historical_provider = (
            MarketCheckHistoricalProvider(
                api_key,
                as_of_date=effective_observed_date,
            )
            if base_request.loss_date is not None
            else None
        )
    except (MarketProviderError, TypeError, ValueError) as exc:
        raise LiveAnalysisError(
            "MarketCheck providers could not be configured"
        ) from exc

    repository = FileAnalysisRunRepository(repository_root)
    orchestrator = AnalysisOrchestrator(
        repository,
        current_provider=current_provider,
        historical_provider=historical_provider,
    )
    request = AnalysisRunRequest(
        ccc_report=report,
        postal_code=normalized_postal,
        current_search=CurrentMarketSearchConfiguration(
            effective_observed_date.isoformat()
        ),
        historical_search=(
            HistoricalMarketSearchConfiguration()
            if historical_provider is not None
            else None
        ),
    )
    try:
        return orchestrator.run(request)
    except AnalysisOrchestrationError as exc:
        raise LiveAnalysisError("Live analysis could not complete") from exc


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = run_live_analysis(
            args.canonical_json,
            args.postal_code,
            repository_root=args.repository_root,
        )
    except LiveAnalysisError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    artifact_path = Path(args.repository_root).expanduser() / f"{result.run_id}.json"
    diagnostics = result.artifact.result["searchDiagnostics"]
    print(f"Created live analysis {result.run_id}")
    print(f"Artifact: {artifact_path.resolve()}")
    print(f"Classification: {result.classification}")
    print(
        "Current search stop: "
        f"{diagnostics['current']['stopReason']}"
    )
    if diagnostics["historical"] is not None:
        print(
            "Historical search stop: "
            f"{diagnostics['historical']['stopReason']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
