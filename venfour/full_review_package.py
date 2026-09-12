"""Freeze report review inputs beside the unchanged free-estimate source."""

from __future__ import annotations

import copy
from collections.abc import Mapping

from venfour.full_review_calculation import calculate_report_review


def review_source_view(source: Mapping) -> dict:
    """Select paid-review evidence after validating the complete sealed source."""
    view = copy.deepcopy(dict(source))
    review = source.get("fullReview")
    if not isinstance(review, Mapping):
        return view
    view["sourceDocument"] = copy.deepcopy(review["sourceDocument"])
    view["extraction"] = copy.deepcopy(review["extraction"])
    view["input"] = {**view["input"], "intakeMode": "REPORT", "reportUploadId": review["reportId"],
                     "confirmedFacts": copy.deepcopy(review["confirmedFacts"])}
    view["analysis"] = copy.deepcopy(review["analysis"])
    view["preliminary"]["presentation"] = copy.deepcopy(review["presentation"])
    from venfour.package_assessment import _presentation_range, _cutoff
    view["preliminary"]["supportedRange"] = _presentation_range(review["presentation"], source["preliminary"]["supportedRange"]["currency"])
    view["evidenceCutoff"] = _cutoff(review["analysis"]["artifact"])
    view["evidenceManifest"] = copy.deepcopy(review["evidenceManifest"])
    view["validationManifest"] = copy.deepcopy(review["validationManifest"])
    return view


def attach_full_review(source: Mapping, binding: Mapping, *, byte_size: int, digest: str, page_count: int) -> dict:
    from venfour.package_assessment import canonical_package_digest, _default_evidence_manifest, _default_validation_checks
    from venfour.package_processing import DeterministicPackageAssessmentBuilder

    row, readiness = binding["report"], binding["readiness"]
    if row["status"] != "ready" or readiness != row["readiness"] or row["document_sha256"] != digest or row["byte_size"] != byte_size:
        raise ValueError("The accepted report changed before package preparation")
    calculation = calculate_report_review(source["analysis"]["artifact"], row["extraction"], readiness,
                                          report_id=row["id"], created_at=source["createdAt"])
    artifact = calculation["artifact"]
    raw_facts = copy.deepcopy(readiness["effectiveInput"])
    # The reviewed insurer value is taken from the accepted report calculation.
    raw_facts["insurer_vehicle_valuation"] = calculation["presentation"]["insurerValuation"]["value"]["cents"] / 100
    equipment = raw_facts.get("vehicle_options_packages")
    if isinstance(equipment, list):
        raw_facts["vehicle_options_packages"] = ", ".join(equipment) or None
    facts = DeterministicPackageAssessmentBuilder._confirmed_facts({
        "source_intake_mode": "report", "confirmed_facts": raw_facts, "analysis_artifact": artifact,
    })
    extraction = dict(DeterministicPackageAssessmentBuilder._extraction({
        "normalized_extraction": row["extraction"], "extraction_schema_version": "1",
        "extraction_extracted_at": row["extracted_at"],
    }, {}))
    extraction["normalizedReportDigest"] = canonical_package_digest(row["extraction"]["normalizedReport"])
    manifest = _default_evidence_manifest(artifact, calculation["presentation"], facts)
    checks, limitations = _default_validation_checks(manifest, intake_mode="REPORT", confirmed_facts=facts, extraction=extraction)
    analysis = {**copy.deepcopy(source["analysis"]), "artifact": artifact, "artifactDigest": canonical_package_digest(artifact),
                "requestDigest": artifact["requestDigest"], "searchDiagnosticsDigest": artifact.get("searchDiagnosticsDigest"),
                "analysisRunSchemaVersion": artifact["analysisRunSchemaVersion"], "analysisVersion": artifact["analysisVersion"],
                "discrepancyAnalysisVersion": artifact["discrepancyAnalysisVersion"], "comparableScoringVersion": artifact["comparableScoringVersion"],
                "createdAt": artifact["createdAt"], "providers": artifact["providers"]}
    document = {"uploadId": row["id"], "bucket": row["storage_bucket"], "objectPath": row["storage_object_name"],
                "storageOwnerId": row["storage_owner_id"], "declaredMimeType": "application/pdf", "pageCount": page_count,
                "originalFilename": row["original_filename"], "uploadedAt": row["created_at"], "detectedMediaType": "application/pdf",
                "byteSize": byte_size, "sha256": digest}
    result = copy.deepcopy(dict(source))
    result.update(schemaVersion="2", fullReview={
        "reportId": row["id"], "reportRevision": row["revision"], "readiness": copy.deepcopy(readiness),
        "sourceDocument": document, "extraction": extraction, "confirmedFacts": facts, "analysis": analysis,
        "presentation": calculation["presentation"], "evidenceManifest": manifest,
        "validationManifest": {"validatorVersion": source["validationManifest"]["validatorVersion"], "checks": checks,
                               "limitations": sorted(set(limitations) | {"PDF_PAGE_AND_BOUNDING_BOX_PROVENANCE_UNAVAILABLE", "REVIEW_USES_PREVIOUSLY_VERIFIED_MARKET_EVIDENCE"})},
        "retainedEligibleIdentities": calculation["retainedEligibleIdentities"], "newProviderRequests": 0,
    })
    result["snapshotDigest"] = canonical_package_digest({key: value for key, value in result.items() if key != "snapshotDigest"})
    return result


def validate_full_review_source(source: Mapping) -> None:
    from venfour.package_assessment import canonical_package_digest, validate_total_loss_source_snapshot_v1
    from venfour.report_ingestion import ReportIngestionResult

    original = {key: copy.deepcopy(value) for key, value in source.items() if key != "fullReview"}
    original["schemaVersion"] = "1"
    original["snapshotDigest"] = canonical_package_digest({key: value for key, value in original.items() if key != "snapshotDigest"})
    validate_total_loss_source_snapshot_v1(original)
    review = source["fullReview"]
    wrapper = {key: copy.deepcopy(value) for key, value in review["extraction"].items() if key not in {"rowSchemaVersion", "wrapperSchemaVersion", "normalizedReportDigest", "extractedAt"}}
    wrapper["schemaVersion"] = review["extraction"]["wrapperSchemaVersion"]
    extraction = ReportIngestionResult.from_dict(wrapper).to_dict()
    row = {"id": review["reportId"], "revision": review["reportRevision"], "readiness": review["readiness"], "status": "ready",
           "document_sha256": review["sourceDocument"]["sha256"], "byte_size": review["sourceDocument"]["byteSize"],
           "storage_bucket": review["sourceDocument"]["bucket"], "storage_object_name": review["sourceDocument"]["objectPath"],
           "original_filename": review["sourceDocument"]["originalFilename"], "created_at": review["sourceDocument"]["uploadedAt"], "extraction": extraction,
           "storage_owner_id": review["sourceDocument"]["storageOwnerId"], "extracted_at": review["extraction"]["extractedAt"]}
    rebuilt = attach_full_review(original, {"report": row, "readiness": review["readiness"]}, byte_size=row["byte_size"], digest=row["document_sha256"], page_count=review["sourceDocument"]["pageCount"])
    if rebuilt != source:
        raise ValueError("Full review source does not match deterministic requalification")
