"""Offline coverage for rerunning live orchestration from canonical CCC JSON."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts.run_live_analysis import LiveAnalysisError, run_live_analysis
from tests.test_analysis_runs import (
    CURRENT_OBSERVED_DATE,
    POSTAL_CODE,
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    make_report,
)
from venfour.analysis_runs import FileAnalysisRunRepository


class LiveCanonicalAnalysisTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name)
        self.canonical_path = self.root / "canonical.json"
        self.canonical_path.write_text(
            json.dumps(make_report(), allow_nan=False),
            encoding="utf-8",
        )

    def test_runs_real_orchestration_without_invoking_pdf_extraction(self) -> None:
        current = RecordingCurrentProvider()
        historical = RecordingHistoricalProvider()
        repository_root = self.root / "runs"
        observed_date = date.fromisoformat(CURRENT_OBSERVED_DATE)

        with (
            patch.dict(
                os.environ,
                {"MARKETCHECK_API_KEY": "synthetic-market-key"},
                clear=True,
            ),
            patch(
                "scripts.run_live_analysis.MarketCheckProvider",
                return_value=current,
            ) as current_factory,
            patch(
                "scripts.run_live_analysis.MarketCheckHistoricalProvider",
                return_value=historical,
            ) as historical_factory,
            patch("scripts.extract_report_ai.extract_report_with_openai") as extractor,
        ):
            result = run_live_analysis(
                self.canonical_path,
                POSTAL_CODE,
                repository_root=repository_root,
                observed_date=observed_date,
            )

        extractor.assert_not_called()
        current_factory.assert_called_once_with("synthetic-market-key")
        historical_factory.assert_called_once_with(
            "synthetic-market-key",
            as_of_date=observed_date,
        )
        self.assertTrue((repository_root / f"{result.run_id}.json").is_file())
        loaded = FileAnalysisRunRepository(repository_root).get(result.run_id)
        self.assertEqual(loaded.to_dict(), result.artifact.to_dict())
        self.assertGreater(len(current.requests), 0)
        self.assertGreater(len(historical.requests), 0)

    def test_requires_marketcheck_but_not_openai_configuration(self) -> None:
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(
            LiveAnalysisError
        ) as raised:
            run_live_analysis(
                self.canonical_path,
                POSTAL_CODE,
                repository_root=self.root / "runs",
                observed_date=date.fromisoformat(CURRENT_OBSERVED_DATE),
            )

        self.assertEqual(str(raised.exception), "MARKETCHECK_API_KEY is not set")


if __name__ == "__main__":
    unittest.main()
