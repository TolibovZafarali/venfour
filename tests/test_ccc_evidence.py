"""Source-fidelity regressions from sanitized CCC table structures."""

import copy
import json
import unittest
from pathlib import Path

from scripts.extract_report_ai import (
    EXTRACTION_V2_INSTRUCTIONS, make_openai_schema, read_canonical_schema,
    validate_extraction, OutputValidationError,
)
from venfour.ccc_evidence import validate_ccc_source_claims
from venfour.report_ingestion import (
    NormalizedReportContractError, ReportIngestionService, normalize_ccc_report,
    normalized_report_to_legacy_report, validate_effective_report,
    validate_normalized_report,
)
from venfour.strict_structured_output import validate_strict_structured_output_schema


def source_fixture():
    return json.loads((Path(__file__).parent / "fixtures/ccc/kona-source-fidelity-v2.json").read_text())


class CccSourceFidelityTests(unittest.TestCase):
    def test_explicit_drive_take_price_and_reordered_contribution_bind_by_identity(self):
        raw = source_fixture()
        before = copy.deepcopy(raw)
        validate_extraction(raw, read_canonical_schema("2"))
        result = normalize_ccc_report(raw)
        self.assertEqual(raw, before)
        self.assertEqual(result["schemaVersion"], "2")
        self.assertEqual(result["vehicle"]["drivetrain"], "FWD")
        self.assertEqual(result["vehicle"]["drivetrainSource"]["page"], 3)
        inspected, advertised = result["comparables"]
        self.assertEqual((inspected["number"], inspected["contributionPercent"]), (7, 61))
        self.assertEqual(inspected["contributionBinding"]["rowIndexes"], [1])
        self.assertEqual(inspected["sourcePrice"], {"amount": 25541, "type": "TAKE", "label": "Take Price"})
        self.assertIsNone(inspected["listPrice"])
        self.assertEqual(advertised["listPrice"], 26558)
        self.assertEqual(sum(row["contributionPercent"] for row in result["comparables"]), 100)
        self.assertEqual(inspected["source"]["stockNumber"], "STOCK-7")
        self.assertEqual(inspected["source"]["updateDate"], "2026-06-13")
        contribution_field = next(row for row in result["evidence"]["fieldChecks"] if row["path"] == "comparables.0.contributionPercent")
        self.assertEqual(contribution_field["sourceReferences"][0]["page"], 14)
        effective = normalized_report_to_legacy_report(result)
        validate_effective_report(effective)
        self.assertEqual(effective["comparables"][0]["sourcePrice"]["type"], "TAKE")

    def test_ambiguous_identity_remains_unbound_and_duplicate_is_review(self):
        raw = source_fixture()
        duplicate = copy.deepcopy(raw["comparables"][0])
        duplicate["number"] = 15
        raw["comparables"].append(duplicate)
        result = normalize_ccc_report(raw)
        self.assertEqual(len(result["comparables"]), 3)
        self.assertEqual(result["evidence"]["contributionBindings"][1]["status"], "AMBIGUOUS")
        self.assertIsNone(result["comparables"][0]["contributionPercent"])
        self.assertEqual(result["evidence"]["duplicateIdentities"][0]["status"], "REVIEW")

    def test_repeated_detail_appearance_links_one_logical_vehicle(self):
        raw = source_fixture()
        repeated = copy.deepcopy(raw["comparables"][0])
        repeated["sourceReferences"][0]["page"] = 15
        raw["comparables"].append(repeated)
        result = normalize_ccc_report(raw)
        self.assertEqual(len(result["comparables"]), 2)
        self.assertEqual(result["evidence"]["appearanceLinks"][-1]["comparableIndex"], 0)
        self.assertEqual(len(result["comparables"][0]["sourceReferences"]), 3)
        self.assertEqual(result["evidence"]["duplicateIdentities"], [])

    def test_printed_number_alone_cannot_bind(self):
        raw = source_fixture()
        contribution = raw["contributionRows"][1]
        contribution.update(number=7, dealer=None, vin=None, stockNumber=None)
        contribution["sourcePrice"]["amount"] = None
        contribution["adjustedValue"] = None
        result = normalize_ccc_report(raw)
        self.assertEqual(result["evidence"]["contributionBindings"][1]["status"], "UNBOUND")
        self.assertIsNone(result["comparables"][0]["contributionPercent"])

    def test_conflicting_contribution_rows_do_not_choose_a_percentage(self):
        raw = source_fixture()
        repeated = copy.deepcopy(raw["contributionRows"][1])
        repeated["contributionPercent"] = 62
        raw["contributionRows"].append(repeated)
        result = normalize_ccc_report(raw)
        self.assertIsNone(result["comparables"][0]["contributionPercent"])
        self.assertEqual(result["comparables"][0]["contributionBinding"]["status"], "AMBIGUOUS")

    def test_conflicting_repeated_price_stays_ambiguous_after_third_appearance(self):
        raw = source_fixture()
        conflicting = copy.deepcopy(raw["comparables"][0])
        conflicting["sourcePrice"]["amount"] += 100
        raw["comparables"].extend([conflicting, copy.deepcopy(raw["comparables"][0])])
        result = normalize_ccc_report(raw)
        self.assertIsNone(result["comparables"][0]["sourcePrice"]["amount"])
        fields = [row for row in result["evidence"]["fieldChecks"] if row["path"] == "comparables.0.sourcePrice.amount"]
        self.assertEqual(len(fields), 1)
        self.assertEqual(fields[0]["status"], "AMBIGUOUS")

    def test_identity_price_conflict_fails_closed(self):
        raw = source_fixture()
        contribution = raw["contributionRows"][1]
        contribution["vin"] = raw["comparables"][0]["vin"]
        contribution["sourcePrice"]["amount"] += 1
        result = normalize_ccc_report(raw)
        self.assertEqual(result["evidence"]["contributionBindings"][1]["status"], "UNBOUND")

    def test_unique_price_alone_is_not_identity_or_adjusted_value_proof(self):
        raw = source_fixture()
        raw["contributionRows"][1]["adjustedValue"] = None
        result = normalize_ccc_report(raw)
        self.assertEqual(result["evidence"]["contributionBindings"][1]["status"], "UNBOUND")

    def test_conflicting_vin_cannot_fall_back_to_matching_price_tuple(self):
        raw = source_fixture()
        raw["contributionRows"][1]["vin"] = "KM8HB3AB0TU999999"
        result = normalize_ccc_report(raw)
        self.assertEqual(result["evidence"]["contributionBindings"][1]["status"], "UNBOUND")

    def test_missing_source_date_is_optional_when_update_date_was_captured(self):
        raw = source_fixture()
        raw["comparables"][0]["source"]["sourceDate"] = None
        result = normalize_ccc_report(raw)
        field = next(row for row in result["evidence"]["fieldChecks"] if row["path"] == "comparables.0.source.sourceDate")
        self.assertEqual((field["status"], field["materiality"]), ("UNAVAILABLE", "OPTIONAL"))

    def test_insufficient_optional_source_fact_is_distinct_from_material_unknown(self):
        raw = source_fixture()
        raw["report"]["insurer"] = None
        raw["vehicle"]["drivetrain"] = None
        raw["vehicle"]["drivetrainSource"] = dict.fromkeys(("page", "section", "label", "text"))
        result = normalize_ccc_report(raw)
        fields = {row["path"]: row for row in result["evidence"]["fieldChecks"]}
        self.assertEqual((fields["report.insurer"]["status"], fields["report.insurer"]["materiality"]), ("UNAVAILABLE", "OPTIONAL"))
        self.assertEqual((fields["vehicle.drivetrain"]["status"], fields["vehicle.drivetrain"]["materiality"]), ("UNAVAILABLE", "MATERIAL"))
        self.assertIsNone(result["vehicle"]["drivetrain"])

    def test_tampered_normalized_binding_fails_semantic_validation(self):
        result = normalize_ccc_report(source_fixture())
        result["comparables"][0]["contributionPercent"] = 39
        with self.assertRaises(NormalizedReportContractError):
            validate_normalized_report(result)

    def test_v1_is_retained_without_source_facts_or_reinterpretation(self):
        from tests.test_analysis_runs import make_report
        result = normalize_ccc_report(make_report())
        self.assertEqual(result["schemaVersion"], "1")
        self.assertNotIn("drivetrain", result["vehicle"])
        self.assertNotIn("evidence", result)
        self.assertNotIn("schemaVersion", normalized_report_to_legacy_report(result))

    def test_provider_schema_preflight_and_source_instructions(self):
        validate_strict_structured_output_schema(make_openai_schema(read_canonical_schema("2")))
        self.assertIn("Never move a percentage", EXTRACTION_V2_INSTRUCTIONS)
        self.assertEqual(ReportIngestionService()._ccc_schema_version, "2")

    def test_missing_explicit_drive_provenance_and_impossible_page_fail_closed(self):
        raw = source_fixture()
        raw["vehicle"]["drivetrainSource"]["text"] = "SE"
        with self.assertRaises(OutputValidationError):
            validate_extraction(raw, read_canonical_schema("2"))
        raw = source_fixture()
        with self.assertRaises(ValueError):
            validate_ccc_source_claims(raw, page_count=3)

    def test_take_label_cannot_be_validated_as_advertised_price(self):
        raw = source_fixture()
        raw["comparables"][0]["sourcePrice"]["type"] = "ADVERTISED"
        with self.assertRaises(OutputValidationError):
            validate_extraction(raw, read_canonical_schema("2"))

    def test_short_printed_price_labels_cannot_be_reclassified(self):
        for label, invalid_type in ((" Take", "ADVERTISED"), ("List", "TAKE"), ("Sold", "ADVERTISED")):
            with self.subTest(label=label, invalid_type=invalid_type):
                raw = source_fixture()
                raw["comparables"][0]["sourcePrice"].update(label=label, type=invalid_type)
                with self.assertRaises(OutputValidationError):
                    validate_extraction(raw, read_canonical_schema("2"))

    def test_date_conversion_must_match_complete_printed_date(self):
        raw = source_fixture()
        raw["comparables"][0]["source"]["updateDate"] = "0613-06-13"
        with self.assertRaises(OutputValidationError):
            validate_extraction(raw, read_canonical_schema("2"))
        raw["comparables"][0]["source"]["updateDate"] = "2026-07-13"
        with self.assertRaises(OutputValidationError):
            validate_extraction(raw, read_canonical_schema("2"))


if __name__ == "__main__":
    unittest.main()
