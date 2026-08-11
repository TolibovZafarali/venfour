#!/usr/bin/env python3
"""Create the deterministic representative analysis run for local UI work."""

from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.test_analysis_runs import (  # noqa: E402
    CONSISTENT_PRICES,
    MATERIAL_PRICES,
    RUN_ID_1,
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    make_orchestrator,
    make_run_request,
)
from venfour.analysis_runs import (  # noqa: E402
    DEFAULT_ANALYSIS_RUN_DIR,
    AnalysisRunNotFoundError,
    FileAnalysisRunRepository,
)
from venfour.presentation import AnalysisPresentationService  # noqa: E402


FIXTURE_PATH = (
    REPO_ROOT
    / "tests"
    / "fixtures"
    / "analysis"
    / "analysis-presentation-material-undervalue.json"
)


def main() -> int:
    repository = FileAnalysisRunRepository(DEFAULT_ANALYSIS_RUN_DIR)
    try:
        repository.get(RUN_ID_1)
        created = False
    except AnalysisRunNotFoundError:
        make_orchestrator(
            repository,
            current_provider=RecordingCurrentProvider(CONSISTENT_PRICES),
            historical_provider=RecordingHistoricalProvider(MATERIAL_PRICES),
            run_id=RUN_ID_1,
        ).run(make_run_request())
        created = True

    actual = AnalysisPresentationService(repository).get(RUN_ID_1).to_dict()
    expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    if actual != expected:
        raise SystemExit(
            "The reserved representative run ID already contains different data."
        )

    action = "Created" if created else "Verified"
    print(f"{action} representative analysis {RUN_ID_1}")
    print(f"Artifact: {DEFAULT_ANALYSIS_RUN_DIR / f'{RUN_ID_1}.json'}")
    print(f"Frontend route: /analyses/{RUN_ID_1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
