from __future__ import annotations

import copy
import json
import unittest
from typing import Any

from tests.test_analysis_runs import (
    MATERIAL_PRICES,
    TemporaryRepositoryTestCase,
    make_report,
)
from venfour.package_assessment import (
    DESCRIPTIVE_ONLY,
    FATAL_LINEAGE_INTEGRITY_FAILURE,
    HUMAN_REVIEW_REQUIRED,
    NEW_EVIDENCE_REQUIRED,
    NOT_DETERMINED_BY_V1,
    SELECTED_ADVERTISED_PRICE_RANGE,
    SOURCE_LINEAGE_CONFLICT,
    SUPPORTS_CONTINUATION,
    UNCHANGED_EVIDENCE,
    FinalValuationAssessmentV1,
    PackageAssessmentError,
    TotalLossSourceSnapshotV1,
    build_final_valuation_assessment_v1,
    build_preliminary_final_comparison,
    build_total_loss_source_snapshot_v1,
    canonical_package_digest,
    load_strict_package_json,
    validate_final_valuation_assessment_v1,
    validate_total_loss_source_snapshot_v1,
)
from venfour.presentation import AnalysisPresentationProjector
from venfour.report_ingestion import normalize_ccc_report


def _uuid(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


class PackageAssessmentTests(TemporaryRepositoryTestCase):
    def _source(
        self,
        *,
        current: bool = True,
        historical: bool = True,
        facts_override: dict[str, Any] | None = None,
        document_sha256: str | None = None,
        extraction_sha256: str | None = None,
        preliminary_digest: str | None = None,
    ) -> tuple[Any, Any, Any, TotalLossSourceSnapshotV1]:
        _, current_provider, historical_provider, artifact = self.run_saved(
            current=current,
            historical=historical,
            current_prices=MATERIAL_PRICES,
            historical_prices=MATERIAL_PRICES,
        )
        presentation = AnalysisPresentationProjector().project(artifact)
        visible = presentation.to_dict()
        vehicle = visible["vehicle"]
        lineage = {
            "caseId": _uuid(11),
            "packageJobId": _uuid(12),
            "entitlementId": _uuid(13),
            "preliminarySnapshotId": _uuid(14),
            "sourceSnapshotId": _uuid(15),
            "analysisJobId": _uuid(16),
            "analysisRunId": artifact.run_id,
            "ownerUserIdAtCreation": _uuid(17),
            "productIdentifier": "total_loss_advisory_package",
            "productVersion": "v1",
        }
        facts: dict[str, Any] = {
            "vin": "1ABCDEFGH23456789",
            "year": vehicle["year"],
            "make": vehicle["make"],
            "model": vehicle["model"],
            "trim": vehicle["trim"],
            "vehicleConfiguration": None,
            "mileage": vehicle["mileage"],
            "postalCode": vehicle["postalCode"],
            "lossDate": vehicle["lossDate"],
            "insurerName": "Synthetic Insurance",
            "insurerVehicleValuationMinorUnits": visible["insurerValuation"][
                "value"
            ]["cents"],
            "priorTitleStatus": None,
            "condition": None,
            "existingDamageDescription": None,
            "optionsPackages": None,
            "intakeCompletedAt": "2026-08-20T10:30:00Z",
        }
        facts.update(facts_override or {})
        document_digest = document_sha256 or "a" * 64
        extraction_digest = extraction_sha256 or document_digest
        source_document = {
            "bucket": "case-files",
            "storageOwnerId": lineage["ownerUserIdAtCreation"],
            "objectPath": (
                f"{lineage['ownerUserIdAtCreation']}/"
                f"{lineage['caseId']}/valuation-report.pdf"
            ),
            "uploadId": _uuid(18),
            "originalFilename": "valuation-report.pdf",
            "uploadedAt": "2026-08-20T10:00:00Z",
            "detectedMediaType": "application/pdf",
            "declaredMimeType": "application/pdf",
            "byteSize": 48_231,
            "pageCount": 12,
            "sha256": document_digest,
        }
        extraction = {
            "rowSchemaVersion": "1",
            "wrapperSchemaVersion": "1",
            "adapter": "CCC",
            "provider": "CCC",
            "providerId": "CCC",
            "confidence": "HIGH",
            "partial": False,
            "warnings": [],
            "missingRequiredFields": [],
            "model": "fixture-extractor-1",
            "extractedAt": "2026-08-20T10:01:00Z",
            "normalizedReport": normalize_ccc_report(make_report()),
            "documentSha256": extraction_digest,
        }
        preliminary_snapshot = {
            "schemaVersion": "1",
            "presentation": visible,
            "customerVisibleResult": {
                "classification": visible["assessment"]["classification"],
                "insurerValueMinorUnits": visible["insurerValuation"]["value"][
                    "cents"
                ],
            },
        }
        snapshot = build_total_loss_source_snapshot_v1(
            lineage=lineage,
            created_at="2026-08-26T18:45:12.345678Z",
            intake_mode="REPORT",
            analysis_input_revision=3,
            analysis_input_id=_uuid(19),
            confirmed_facts=facts,
            artifact=artifact,
            preliminary_presentation=presentation,
            preliminary_snapshot=preliminary_snapshot,
            preliminary_snapshot_digest=(
                preliminary_digest
                if preliminary_digest is not None
                else canonical_package_digest(preliminary_snapshot)
            ),
            preliminary_snapshot_schema_version="1",
            source_document=source_document,
            extraction=extraction,
            validation_checks=(),
            validation_limitations=("PDF_PAGE_AND_BOUNDING_BOX_PROVENANCE_UNAVAILABLE",),
        )
        return current_provider, historical_provider, artifact, snapshot

    def test_freezes_real_artifact_and_builds_final_without_provider_calls(self) -> None:
        current, historical, artifact, source = self._source()
        request_counts = (len(current.requests), len(historical.requests))

        assessment = build_final_valuation_assessment_v1(source)

        self.assertEqual(request_counts, (len(current.requests), len(historical.requests)))
        self.assertEqual(assessment.final_classification, "MATERIAL_UNDERVALUE_SIGNAL")
        self.assertEqual(assessment.continuation_status, SUPPORTS_CONTINUATION)
        self.assertEqual(
            assessment.insurer_comparables["methodologyTreatment"], DESCRIPTIVE_ONLY
        )
        self.assertEqual(
            assessment.insurer_comparables["weightingStatus"],
            NOT_DETERMINED_BY_V1,
        )
        self.assertEqual(
            assessment.supported_range["semantics"],
            SELECTED_ADVERTISED_PRICE_RANGE,
        )
        self.assertEqual(
            assessment.supported_range["lowMinorUnits"], MATERIAL_PRICES[0]
        )
        self.assertEqual(
            assessment.supported_range["medianMinorUnits"], MATERIAL_PRICES[2]
        )
        self.assertEqual(
            assessment.supported_range["highMinorUnits"], MATERIAL_PRICES[-1]
        )
        self.assertEqual(
            assessment.analysis_artifact_digest,
            canonical_package_digest(artifact.to_dict()),
        )
        self.assertNotIn("pointValueMinorUnits", assessment.to_dict())

    def test_preliminary_snapshot_and_presentation_have_independent_digests(self) -> None:
        _, _, _, source = self._source()
        payload = source.to_dict()
        self.assertEqual(
            payload["preliminary"]["snapshotDigest"],
            canonical_package_digest(payload["preliminary"]["snapshot"]),
        )
        self.assertEqual(
            payload["preliminary"]["presentationDigest"],
            canonical_package_digest(payload["preliminary"]["presentation"]),
        )
        self.assertNotEqual(
            payload["preliminary"]["snapshotDigest"],
            payload["preliminary"]["presentationDigest"],
        )

    def test_source_and_assessment_round_trip_with_strict_digests(self) -> None:
        _, _, _, source = self._source()
        assessment = build_final_valuation_assessment_v1(source)

        source_copy = TotalLossSourceSnapshotV1.from_dict(source.to_dict())
        assessment_copy = FinalValuationAssessmentV1.from_dict(assessment.to_dict())

        self.assertEqual(source_copy.to_dict(), source.to_dict())
        self.assertEqual(assessment_copy.to_dict(), assessment.to_dict())
        validate_final_valuation_assessment_v1(
            assessment_copy, source_snapshot=source_copy
        )

    def test_source_creation_timestamp_is_utc_and_digest_bound(self) -> None:
        _, _, _, source = self._source()
        payload = source.to_dict()
        self.assertEqual(payload["createdAt"], "2026-08-26T18:45:12.345678Z")
        unsigned = {
            key: value for key, value in payload.items() if key != "snapshotDigest"
        }
        self.assertEqual(payload["snapshotDigest"], canonical_package_digest(unsigned))

        payload["createdAt"] = "2026-08-26T18:45:12.345678+00:00"
        payload["snapshotDigest"] = canonical_package_digest(unsigned | {
            "createdAt": payload["createdAt"]
        })
        with self.assertRaises(PackageAssessmentError) as raised:
            validate_total_loss_source_snapshot_v1(payload)
        self.assertEqual(raised.exception.code, "SOURCE_SNAPSHOT_INVALID")

    def test_provenance_ids_are_content_addressed_and_resolve(self) -> None:
        _, _, _, source = self._source()
        assessment = build_final_valuation_assessment_v1(source).to_dict()
        source_payload = source.to_dict()
        source_ids = {
            reference["evidenceId"]
            for reference in source_payload["evidenceManifest"]
        }
        self.assertTrue(source_ids)
        self.assertTrue(
            all(
                reference["pageNumber"] is None
                for reference in source_payload["evidenceManifest"]
            )
        )

        validation = source_payload["validationManifest"]
        check_codes = {check["code"] for check in validation["checks"]}
        self.assertTrue(
            {
                "CASE_RUN_LINEAGE",
                "ANALYSIS_ARTIFACT_INTEGRITY",
                "PRELIMINARY_PRESENTATION_LINEAGE",
                "SOURCE_DOCUMENT_INTEGRITY",
                "NORMALIZED_EXTRACTION_INTEGRITY",
                "SUBJECT_VEHICLE_IDENTITY",
                "INSURER_VALUATION_FIELDS",
                "COMPARABLE_IDENTITIES",
                "ADJUSTMENT_ARITHMETIC",
                "EXTERNAL_EVIDENCE_SELECTION",
                "EVIDENCE_CUTOFF",
            }.issubset(check_codes)
        )
        checks_by_code = {
            check["code"]: check for check in validation["checks"]
        }
        self.assertEqual(checks_by_code["ANALYSIS_ARTIFACT_INTEGRITY"]["status"], "PASS")
        self.assertEqual(checks_by_code["VIN_CONSISTENCY"]["status"], "WARNING")
        self.assertTrue(
            all(
                evidence_id in source_ids
                for check in validation["checks"]
                for evidence_id in check["evidenceIds"]
            )
        )
        self.assertIn(
            "PAGE_LEVEL_CITATIONS_UNAVAILABLE",
            validation["limitations"],
        )
        self.assertIn(
            "INSURER_COMPARABLE_WEIGHTING_NOT_DETERMINED",
            validation["limitations"],
        )
        self.assertIn(
            "REPORT_VIN_DIFFERS_FROM_CONFIRMED_INPUT",
            validation["limitations"],
        )
        referenced = set(assessment["subjectVehicle"]["evidenceIds"])
        referenced.update(assessment["insurerValuationReviewed"]["evidenceIds"])
        referenced.update(assessment["supportedRange"]["evidenceIds"])
        for rows in assessment["externalEvidence"]["selectedComparables"].values():
            for row in rows:
                referenced.update(row["evidenceIds"])
        self.assertLessEqual(referenced, source_ids)

    def test_conflicting_confirmed_fact_requires_human_review(self) -> None:
        with self.assertRaises(PackageAssessmentError) as raised:
            self._source(facts_override={"mileage": 99_999})

        self.assertEqual(raised.exception.classification, HUMAN_REVIEW_REQUIRED)
        self.assertEqual(raised.exception.code, "SOURCE_FACT_CONFLICT")

    def test_document_and_extraction_digest_mismatch_is_fatal(self) -> None:
        with self.assertRaises(PackageAssessmentError) as raised:
            self._source(document_sha256="a" * 64, extraction_sha256="b" * 64)

        self.assertEqual(
            raised.exception.classification, FATAL_LINEAGE_INTEGRITY_FAILURE
        )
        self.assertEqual(raised.exception.code, "SOURCE_DOCUMENT_DIGEST_MISMATCH")

    def test_incorrect_preliminary_digest_is_rejected(self) -> None:
        with self.assertRaises(PackageAssessmentError) as raised:
            self._source(preliminary_digest="f" * 64)

        self.assertEqual(raised.exception.code, "PRELIMINARY_SNAPSHOT_DIGEST_MISMATCH")

    def test_analysis_run_lineage_mismatch_is_rejected(self) -> None:
        _, _, _, source = self._source()
        payload = source.to_dict()
        payload["lineage"]["analysisRunId"] = _uuid(99)
        unsigned = {
            key: value
            for key, value in payload.items()
            if key != "snapshotDigest"
        }
        payload["snapshotDigest"] = canonical_package_digest(unsigned)

        with self.assertRaises(PackageAssessmentError) as raised:
            validate_total_loss_source_snapshot_v1(payload)

        self.assertEqual(
            raised.exception.code,
            "ANALYSIS_RUN_LINEAGE_MISMATCH",
        )

    def test_rehashed_final_value_tamper_is_still_rejected_against_source(self) -> None:
        _, _, _, source = self._source()
        payload = build_final_valuation_assessment_v1(source).to_dict()
        payload["supportedRange"]["lowMinorUnits"] += 1
        unsigned = {key: value for key, value in payload.items() if key != "assessmentDigest"}
        payload["assessmentDigest"] = canonical_package_digest(unsigned)

        with self.assertRaises(PackageAssessmentError) as raised:
            validate_final_valuation_assessment_v1(payload, source_snapshot=source)

        self.assertEqual(raised.exception.code, "FINAL_ASSESSMENT_INVALID")
        self.assertTrue(
            any("supportedRange" in detail for detail in raised.exception.details)
        )

    def test_insufficient_evidence_is_valid_new_evidence_outcome(self) -> None:
        _, _, _, source = self._source(current=False, historical=False)

        assessment = build_final_valuation_assessment_v1(source)

        self.assertEqual(assessment.final_classification, "INSUFFICIENT_EVIDENCE")
        self.assertEqual(assessment.continuation_status, NEW_EVIDENCE_REQUIRED)
        self.assertIsNone(assessment.supported_range)

    def test_preliminary_final_comparison_uses_exact_minor_units(self) -> None:
        preliminary = {
            "classification": "POTENTIAL_UNDERVALUE",
            "supportedRange": {
                "lowMinorUnits": 100,
                "medianMinorUnits": 200,
                "highMinorUnits": 300,
                "currency": "USD",
            },
        }
        final = copy.deepcopy(preliminary)
        unchanged = build_preliminary_final_comparison(preliminary, final)
        self.assertFalse(unchanged["materialChange"])
        self.assertEqual(unchanged["reasonCodes"], [UNCHANGED_EVIDENCE])

        final["supportedRange"]["lowMinorUnits"] = 110
        changed = build_preliminary_final_comparison(preliminary, final)
        self.assertTrue(changed["materialChange"])
        self.assertEqual(changed["absoluteChangesMinorUnits"]["lowMinorUnits"], 10)
        self.assertEqual(changed["percentageChangesBasisPoints"]["lowMinorUnits"], 1000)
        self.assertEqual(changed["reasonCodes"], [SOURCE_LINEAGE_CONFLICT])

    def test_strict_json_rejects_duplicate_keys_and_non_finite_numbers(self) -> None:
        for encoded in ('{"value": 1, "value": 2}', '{"value": NaN}'):
            with self.subTest(encoded=encoded):
                with self.assertRaises(PackageAssessmentError) as raised:
                    load_strict_package_json(encoded)
                self.assertEqual(raised.exception.code, "PACKAGE_JSON_INVALID")

        decoded = load_strict_package_json(json.dumps({"value": 1}))
        self.assertEqual(decoded, {"value": 1})

    def test_source_schema_rejects_unknown_top_level_property(self) -> None:
        _, _, _, source = self._source()
        payload = source.to_dict()
        payload["unexpected"] = True
        unsigned = {key: value for key, value in payload.items() if key != "snapshotDigest"}
        payload["snapshotDigest"] = canonical_package_digest(unsigned)

        with self.assertRaises(PackageAssessmentError) as raised:
            validate_total_loss_source_snapshot_v1(payload)

        self.assertEqual(raised.exception.code, "SOURCE_SNAPSHOT_INVALID")


if __name__ == "__main__":
    unittest.main()
