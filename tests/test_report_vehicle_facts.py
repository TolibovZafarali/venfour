"""Sanitized regressions for separately labeled loss-vehicle engine facts."""

import copy
import tempfile
import unittest
from pathlib import Path

import pymupdf

from tests.test_ccc_evidence import source_fixture
from tests.test_report_ingestion import RecordingExtractor
from venfour.efficient_search import subject_material_facts
from venfour.report_ingestion import (
    ReportExtractionError, ReportIngestionResult, ReportIngestionService, normalized_report_to_legacy_report,
    validate_effective_report, validate_normalized_report,
)
from venfour.report_vehicle_facts import recover_labeled_engine_details


VIN = "5NPE24AF6GH000001"
DETAILS = f"CCC ONE\nVEHICLE INFORMATION\nVEHICLE DETAILS\nVIN\n{VIN}\nEngine -\nCylinders\n4\nDisplacement\n2.4L\nFuel Type\nGasoline\nVEHICLE HISTORY SUMMARY"


class ReportVehicleFactsTests(unittest.TestCase):
    def test_ingestion_recovers_omitted_rows_and_carries_sources_into_matching(self):
        raw = source_fixture()
        raw["vehicle"].update(vin=VIN, engine=None, drivetrain=None,
                              drivetrainSource={"page": None, "section": None, "label": None, "text": None})
        before = copy.deepcopy(raw)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.pdf"
            with pymupdf.open() as pdf:
                for text in ("", "CCC ONE", DETAILS, *("" for _ in range(17))):
                    pdf.new_page().insert_text((72, 72), text)
                pdf.save(path)
            ingestion = ReportIngestionService(ccc_extractor=RecordingExtractor(raw), ccc_schema_version="2").ingest(path)
            cached = ingestion.to_dict()
            cached["normalizedReport"]["vehicle"].pop("engineDetails")
            previous = copy.deepcopy(cached)
            extractor = RecordingExtractor(raw)
            service = ReportIngestionService(ccc_extractor=extractor, ccc_schema_version="2")
            recovered = service.recover_saved(ReportIngestionResult.from_dict(cached), path)
            self.assertEqual(recovered.to_dict()["normalizedReport"], ingestion.to_dict()["normalizedReport"])
            self.assertEqual(extractor.calls, [])
            self.assertEqual(cached, previous)
            cached["documentSha256"] = "b" * 64
            with self.assertRaises(ReportExtractionError):
                service.recover_saved(ReportIngestionResult.from_dict(cached), path)
        normalized = ingestion.to_dict()["normalizedReport"]
        validate_normalized_report(normalized)
        effective = normalized_report_to_legacy_report(normalized)
        validate_effective_report(effective)
        facts = subject_material_facts(effective)
        self.assertEqual((facts["engine"], facts["cylinders"]), ("2.4L 4 cylinder", "4"))
        self.assertIsNone(effective["vehicle"]["engine"])
        self.assertIsNone(effective["vehicle"]["drivetrain"])
        self.assertEqual({ref["page"] for ref in effective["vehicle"]["engineDetails"]["sourceReferences"]}, {3})
        self.assertEqual(raw, before)

    def test_never_borrows_specs_from_comparable_or_another_vehicle(self):
        vehicle = {"vin": VIN, "engine": None}
        for text in (DETAILS.replace(VIN, "5NPE24AF6GH000002"), DETAILS.replace("VEHICLE DETAILS", "COMPARABLE VEHICLES"), "scanned page"):
            with self.subTest(text=text):
                self.assertEqual(recover_labeled_engine_details(vehicle, [text]), vehicle)

    def test_conflicting_rows_or_engine_description_fail_closed(self):
        for vehicle, pages in (({"vin": VIN, "engine": "2.0L I4"}, [DETAILS]),
                               ({"vin": VIN}, [DETAILS, DETAILS.replace("2.4L", "2.0L")])):
            with self.subTest(vehicle=vehicle), self.assertRaises(ValueError):
                recover_labeled_engine_details(vehicle, pages)

    def test_partial_specs_stay_partial_and_cc_conversion_is_explicit(self):
        recovered = recover_labeled_engine_details({"vin": VIN}, [DETAILS.replace("2.4L", "2400 cc").replace("Cylinders\n4", "Cylinders\n-")])
        self.assertEqual(recovered["engineDetails"]["displacementLiters"], 2.4)
        self.assertIsNone(recovered["engineDetails"]["cylinders"])
        self.assertIsNone(subject_material_facts({"vehicle": recovered})["cylinders"])

    def test_unreferenced_or_conflicting_extracted_values_are_rejected(self):
        from venfour.report_vehicle_facts import validate_engine_details
        vehicle = recover_labeled_engine_details({"vin": VIN}, [DETAILS])
        for mutation in ("source", "value", "page"):
            changed = copy.deepcopy(vehicle)
            if mutation == "source": changed["engineDetails"]["sourceReferences"] = []
            if mutation == "value": changed["engineDetails"]["cylinders"] = 6
            if mutation == "page": changed["engineDetails"]["sourceReferences"][0]["page"] = 9
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_engine_details(changed, page_count=1)
