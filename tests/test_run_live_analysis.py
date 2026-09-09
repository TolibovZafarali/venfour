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
from tests.test_analysis_runs import CURRENT_OBSERVED_DATE, POSTAL_CODE, make_report


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

    def test_unscoped_live_execution_is_rejected_before_provider_requests(self) -> None:
        repository_root = self.root / "runs"
        observed_date = date.fromisoformat(CURRENT_OBSERVED_DATE)

        with (
            patch.dict(
                os.environ,
                {"MARKETCHECK_API_KEY": "synthetic-market-key"},
                clear=True,
            ),
            patch("venfour.marketcheck._UrllibMarketCheckTransport.get") as transport,
            patch("scripts.extract_report_ai.extract_report_with_openai") as extractor,
            self.assertRaises(LiveAnalysisError) as raised,
        ):
            run_live_analysis(
                self.canonical_path,
                POSTAL_CODE,
                repository_root=repository_root,
                observed_date=observed_date,
            )

        extractor.assert_not_called()
        transport.assert_not_called()
        self.assertIn("Unscoped live analysis is disabled", str(raised.exception))
        self.assertFalse(repository_root.exists())

    def test_unscoped_path_cannot_create_a_fresh_allowance_without_configuration(self) -> None:
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(
            LiveAnalysisError
        ) as raised:
            run_live_analysis(
                self.canonical_path,
                POSTAL_CODE,
                repository_root=self.root / "runs",
                observed_date=date.fromisoformat(CURRENT_OBSERVED_DATE),
            )

        self.assertIn("cumulative shared request allowance", str(raised.exception))

    def test_rejects_malformed_zip_before_provider_configuration(self) -> None:
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(
            LiveAnalysisError
        ) as raised:
            run_live_analysis(
                self.canonical_path,
                "ABCDE",
                repository_root=self.root / "runs",
                observed_date=date.fromisoformat(CURRENT_OBSERVED_DATE),
            )

        self.assertEqual(
            str(raised.exception),
            "A 5-digit US ZIP code or ZIP+4 is required",
        )


if __name__ == "__main__":
    unittest.main()
