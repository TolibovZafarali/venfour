"""Offline coverage for provider-neutral valuation-report ingestion."""

from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf

from scripts.extract_report_ai import AIExtractionResult
from tests.test_analysis_runs import make_report
from venfour.report_ingestion import (
    CCC_ADAPTER,
    GENERIC_ADAPTER,
    ReportDocumentInvalidError,
    ReportIngestionService,
    detect_report_provider,
    validate_canonical_pdf,
    validate_normalized_report,
)
from venfour.valuation_inputs import empty_normalized_report


def write_pdf(
    path: Path,
    text: str,
    *,
    pages: int = 1,
    encrypted: bool = False,
) -> None:
    document = pymupdf.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 72), f"{text} page {index + 1}")
    save_options = {}
    if encrypted:
        save_options = {
            "encryption": pymupdf.PDF_ENCRYPT_AES_256,
            "owner_pw": "owner-password",
            "user_pw": "user-password",
        }
    document.save(path, **save_options)
    document.close()


class RecordingExtractor:
    def __init__(self, data: dict) -> None:
        self.data = data
        self.calls: list[Path] = []

    def __call__(self, path: Path, _schema: dict) -> AIExtractionResult:
        self.calls.append(path)
        return AIExtractionResult(
            data=copy.deepcopy(self.data),
            model="fixture-model",
            usage={"inputTokens": 1},
        )


def generic_report(*, complete: bool = True) -> dict:
    report = empty_normalized_report()
    report["report"].update(
        {
            "provider": "Acme Valuations",
            "providerId": "OTHER",
            "insurer": "Example Insurance" if complete else None,
            "lossDate": "2026-05-19" if complete else None,
        }
    )
    report["vehicle"].update(
        {
            "year": 2020,
            "make": "Toyota",
            "model": "Camry",
            "trim": "SE" if complete else None,
            "vin": "4T1G11AK0LU000001",
            "mileage": 51_000,
            "equipment": ["Convenience package"] if complete else [],
        }
    )
    report["condition"]["preLossCondition"] = "Good" if complete else None
    report["valuation"]["adjustedVehicleValue"] = 18_500
    validate_normalized_report(report)
    return report


class CanonicalPdfValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def test_valid_pdf_returns_only_bounded_safe_metadata(self) -> None:
        path = self.root / "report.pdf"
        write_pdf(path, "CCC ONE valuation report")

        document = validate_canonical_pdf(path)

        self.assertEqual(document.path, path)
        self.assertEqual(document.page_count, 1)
        self.assertEqual(len(document.sha256), 64)
        self.assertIn("CCC ONE", document.provider_text)

    def test_corrupt_magic_encrypted_and_absurd_page_documents_are_rejected(self) -> None:
        corrupt = self.root / "corrupt.pdf"
        corrupt.write_bytes(b"%PDF-not-a-real-document")
        with self.assertRaises(ReportDocumentInvalidError):
            validate_canonical_pdf(corrupt)

        wrong_magic = self.root / "wrong.pdf"
        wrong_magic.write_bytes(b"not a PDF")
        with self.assertRaises(ReportDocumentInvalidError):
            validate_canonical_pdf(wrong_magic)

        encrypted = self.root / "encrypted.pdf"
        write_pdf(encrypted, "private valuation", encrypted=True)
        with self.assertRaises(ReportDocumentInvalidError):
            validate_canonical_pdf(encrypted)

        many_pages = self.root / "many-pages.pdf"
        write_pdf(many_pages, "valuation", pages=3)
        with patch("venfour.report_ingestion.MAX_REPORT_PAGES", 2):
            with self.assertRaises(ReportDocumentInvalidError):
                validate_canonical_pdf(many_pages)

    def test_provider_detection_is_conservative(self) -> None:
        self.assertEqual(
            detect_report_provider("Produced by CCC Intelligent Solutions"),
            ("CCC", "CCC"),
        )
        self.assertEqual(
            detect_report_provider("Mitchell WorkCenter valuation"),
            ("MITCHELL", "Mitchell"),
        )
        self.assertEqual(
            detect_report_provider("Insurer vehicle valuation"),
            (None, None),
        )


class ReportIngestionRoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def test_ccc_text_selects_specialized_adapter_and_normalizes_legacy_shape(self) -> None:
        path = self.root / "ccc.pdf"
        write_pdf(path, "CCC ONE valuation detail")
        ccc = RecordingExtractor(make_report())
        generic = RecordingExtractor(generic_report())

        result = ReportIngestionService(
            ccc_extractor=ccc,
            generic_extractor=generic,
        ).ingest(path)

        self.assertEqual(result.adapter, CCC_ADAPTER)
        self.assertEqual(result.provider_id, "CCC")
        self.assertEqual(len(ccc.calls), 1)
        self.assertEqual(generic.calls, [])
        self.assertEqual(result.normalized_report["schemaVersion"], "1")
        self.assertIn("report.insurer", result.missing_required_fields)
        self.assertTrue(result.partial)

    def test_unknown_provider_uses_generic_fallback_without_a_dead_end(self) -> None:
        path = self.root / "unknown.pdf"
        write_pdf(path, "Acme vehicle valuation document")
        ccc = RecordingExtractor(make_report())
        generic = RecordingExtractor(generic_report())

        result = ReportIngestionService(
            ccc_extractor=ccc,
            generic_extractor=generic,
        ).ingest(path)

        self.assertEqual(result.adapter, GENERIC_ADAPTER)
        self.assertEqual(result.provider, "Acme Valuations")
        self.assertEqual(result.provider_id, "OTHER")
        self.assertEqual(ccc.calls, [])
        self.assertEqual(len(generic.calls), 1)
        self.assertFalse(result.partial)
        self.assertEqual(result.confidence, "HIGH")
        self.assertTrue(any("generic extraction" in item for item in result.warnings))

    def test_incomplete_generic_extraction_returns_manual_confirmation_fields(self) -> None:
        path = self.root / "partial.pdf"
        write_pdf(path, "unidentified valuation document")
        result = ReportIngestionService(
            ccc_extractor=RecordingExtractor(make_report()),
            generic_extractor=RecordingExtractor(generic_report(complete=False)),
        ).ingest(path)

        self.assertTrue(result.partial)
        self.assertEqual(result.confidence, "LOW")
        self.assertIn("vehicle.trim", result.missing_required_fields)
        self.assertIn("condition.preLossCondition", result.missing_required_fields)
        self.assertNotIn("storage", str(result.to_dict()).casefold())


if __name__ == "__main__":
    unittest.main()
