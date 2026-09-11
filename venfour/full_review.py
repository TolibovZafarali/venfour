"""Report-backed readiness, independent of the saved approximate estimate."""

from __future__ import annotations

import copy
import hashlib
from datetime import datetime, timezone
from collections.abc import Mapping
from typing import Any
from uuid import uuid4

from venfour.report_ingestion import ReportIngestionResult, ReportIngestionService, validate_canonical_pdf
from venfour.subject_readiness import FIELD_LABELS, VEHICLE_FACT_FIELDS, confirmed_subject_readiness, known, validate_vehicle_facts


REPORT_RECOVERY = {
    "REPORT_REQUIRED": "Upload the complete vehicle valuation report from your insurer. Your free estimate is saved.",
    "REPORT_INCOMPLETE": "This PDF is missing vehicle or valuation details. Ask your insurer for the complete total-loss valuation report, including comparable vehicles and adjustments.",
    "REPORT_IDENTITY_CONFLICT": "This report appears to describe a different vehicle. Upload the report for the vehicle in this case.",
    "REPORT_UNREADABLE": "We couldn’t read enough of this report. Upload a clear, complete PDF from your insurer.",
    "REPORT_EXTRACTION_FAILED": "We couldn’t finish reading your report. Your file is saved. Try again or upload another copy.",
}


def _same(left: Any, right: Any) -> bool:
    if isinstance(left, str) and isinstance(right, str):
        return " ".join(left.casefold().split()) == " ".join(right.casefold().split())
    return left == right


def report_failure(code: str) -> dict[str, Any]:
    return {"stage": "full_review", "status": "report_required" if code == "REPORT_REQUIRED" else "report_invalid",
            "ready": False, "issues": [], "code": code, "message": REPORT_RECOVERY[code]}


def full_review_readiness(snapshot: Mapping[str, Any], extraction: Mapping[str, Any] | None,
                          resolutions: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Reconcile printed facts without modifying the free input or extraction.

    Only explicitly identified conflicts may be resolved. Vehicle identity
    mismatches and missing valuation pages require the correct document.
    """
    if extraction is None:
        return report_failure("REPORT_REQUIRED")
    ingestion = ReportIngestionResult.from_dict(extraction)
    normalized = ingestion.to_dict()["normalizedReport"]
    vehicle, report, valuation = (normalized[key] for key in ("vehicle", "report", "valuation"))
    if ingestion.confidence == "LOW":
        return report_failure("REPORT_UNREADABLE")
    if (not report.get("provider") or not report.get("insurer") or not report.get("lossDate")
            or any(not known(vehicle.get(field)) for field in ("year", "make", "model", "mileage"))
            or not any(isinstance(valuation.get(field), (int, float)) and not isinstance(valuation[field], bool)
                       and valuation[field] > 0 for field in ("baseVehicleValue", "adjustedVehicleValue"))
            or not normalized.get("comparables")):
        return report_failure("REPORT_INCOMPLETE")
    for field, saved_key in (("year", "vehicle_year"), ("make", "vehicle_make"), ("model", "vehicle_model"), ("vin", "vin")):
        if known(snapshot.get(saved_key)) and known(vehicle.get(field)) and not _same(snapshot[saved_key], vehicle[field]):
            return report_failure("REPORT_IDENTITY_CONFLICT")
    effective = copy.deepcopy(dict(snapshot))
    effective["intake_mode"] = "report"
    facts = copy.deepcopy(dict(snapshot.get("vehicle_facts") or {}))
    choices = dict(resolutions or {})
    issues: list[dict[str, Any]] = []
    applicable: set[str] = set()

    def reconcile(field: str, saved: Any, printed: Any) -> Any:
        if not known(printed):
            return saved
        if known(saved) and not _same(saved, printed):
            applicable.add(field)
            choice = choices.get(field)
            if choice not in (None, "report", "saved"):
                raise ValueError("Invalid report conflict resolution")
            if choice is None:
                issues.append({"field": field, "code": "REPORT_FACT_CONFLICT", "savedValue": saved,
                               "reportValue": printed, "message": f"Which {FIELD_LABELS.get(field, field).lower()} should the full review use?"})
            return saved if choice == "saved" else printed
        return printed

    for field, saved_key, printed in (
        ("trim", "vehicle_trim", vehicle.get("trim")), ("mileage", "mileage_at_loss", vehicle.get("mileage")),
        ("lossDate", "date_of_loss", report.get("lossDate")),
    ):
        effective[saved_key] = reconcile(field, snapshot.get(saved_key), printed)
    for field in VEHICLE_FACT_FIELDS:
        printed = vehicle.get("bodyStyle" if field == "bodyType" else field)
        value = reconcile(field, facts.get(field), printed)
        if known(value):
            facts[field] = str(value)
    effective.update({"vehicle_year": vehicle["year"], "vehicle_make": vehicle["make"], "vehicle_model": vehicle["model"],
                      "insurer_name": report["insurer"], "vehicle_facts": facts})
    effective["insurer_vehicle_valuation"] = valuation.get("insurerOffer")
    effective["vehicle_options_packages"] = vehicle.get("equipment")
    effective["vehicle_condition"] = normalized["condition"].get("preLossCondition")
    # Configuration identity is separate from customer-confirmed detailed facts.
    # A corrected drive type must not silently retain a conflicting catalog token.
    if choices.get("drivetrain") == "report":
        effective["vehicle_configuration"] = None
    strict = confirmed_subject_readiness(effective, normalized, stage="full_review")
    for issue in strict["issues"]:
        field = issue["field"]
        if field in VEHICLE_FACT_FIELDS and not any(row["field"] == field for row in issues):
            applicable.add(field)
            if field in choices:
                facts.update(validate_vehicle_facts({field: choices[field]}))
            else:
                issues.append({**issue, "savedValue": None, "reportValue": None})
        elif not any(row["field"] == field for row in issues):
            issues.append({**issue, "savedValue": None, "reportValue": None})
    if set(choices) - applicable:
        raise ValueError("A resolution was supplied for an unrelated report fact")
    if not issues:
        issues = [{**issue, "savedValue": None, "reportValue": None}
                  for issue in confirmed_subject_readiness(effective, normalized, stage="full_review")["issues"]]
    return {"stage": "full_review", "status": "needs_confirmation" if issues else "ready", "ready": not issues,
            "issues": issues, "code": None,
            "message": "Confirm the highlighted detail. Your free estimate is unchanged." if issues else "Your report is ready for the full review.",
            "effectiveInput": effective, "resolutions": choices, "documentSha256": ingestion.document_sha256}


class FullReviewConflict(ValueError):
    """The source or report changed while the customer was preparing it."""


class FullReviewService:
    def __init__(self, gateway: Any, *, ingestion_service: Any = None):
        self.gateway = gateway
        self.ingestion = ingestion_service or ReportIngestionService()

    def _context(self, case_id: str, user_id: str) -> dict[str, Any]:
        context = self.gateway.get_full_review_context(case_id, user_id)
        if not isinstance(context, Mapping):
            raise LookupError("Full review was not found")
        return dict(context)

    @staticmethod
    def _public(context: Mapping[str, Any]) -> dict[str, Any]:
        report = context.get("report")
        readiness = report.get("readiness") if report else None
        readiness = readiness or report_failure("REPORT_REQUIRED")
        status = report["status"] if report else "report_required"
        if status == "extracting" and report.get("processing_expires_at"):
            expires = datetime.fromisoformat(report["processing_expires_at"].replace("Z", "+00:00"))
            if expires <= datetime.now(timezone.utc):
                status = "extraction_failed"
        if status == "extraction_failed":
            readiness = report_failure("REPORT_EXTRACTION_FAILED")
        return {"caseId": context["case_id"], "stage": "full_review", "status": status,
                "ready": status == "ready" and readiness.get("ready") is True,
                "issues": copy.deepcopy(readiness.get("issues", [])), "message": readiness["message"],
                "report": {"id": report["id"], "filename": report["original_filename"], "revision": report["revision"]} if report else None,
                "canReuseReport": bool(context.get("existing_report")) and report is None,
                "locked": context.get("locked") is True}

    def status(self, case_id: str, user_id: str) -> dict[str, Any]:
        return self._public(self._context(case_id, user_id))

    def prepare_upload(self, case_id: str, user_id: str, filename: str, digest: str, byte_size: int) -> dict[str, Any]:
        context = self._context(case_id, user_id)
        if context.get("locked"):
            raise FullReviewConflict("The report for this review is already locked")
        row = self.gateway.begin_full_review_report(case_id, user_id, str(uuid4()), filename, digest, byte_size)
        return {"reportId": row["id"], "bucket": row["storage_bucket"], "path": row["storage_object_name"]}

    def upload(self, case_id: str, user_id: str, path: Any, filename: str, *, cached_extraction: Any = None) -> dict[str, Any]:
        context = self._context(case_id, user_id)
        if context.get("locked"):
            raise FullReviewConflict("The report for this review is already locked")
        document = validate_canonical_pdf(path)
        row = self.gateway.begin_full_review_report(case_id, user_id, str(uuid4()), filename, document.sha256, path.stat().st_size)
        self.gateway.upload_full_review_report(case_id, row, path.read_bytes())
        row = self.gateway.transition_full_review_report(case_id, user_id, row, "uploaded")
        return self.extract(case_id, user_id, expected_report_id=row["id"], cached_extraction=cached_extraction)

    def reuse(self, case_id: str, user_id: str) -> dict[str, Any]:
        context = self._context(case_id, user_id)
        if context.get("report"):
            return self._public(context)
        saved = context.get("existing_report")
        if not saved:
            return self._public(context)
        with self.gateway.materialize_existing_full_review_report(case_id, saved) as path:
            return self.upload(case_id, user_id, path, saved["original_filename"], cached_extraction=saved.get("extraction"))

    def extract(self, case_id: str, user_id: str, *, expected_report_id: str | None = None,
                cached_extraction: Any = None) -> dict[str, Any]:
        context = self._context(case_id, user_id)
        row = context.get("report")
        if not row:
            return self.reuse(case_id, user_id)
        if expected_report_id and row["id"] != expected_report_id:
            raise FullReviewConflict("The uploaded report changed")
        if row["status"] in {"ready", "needs_confirmation", "report_invalid"}:
            return self._public(context)
        if row["status"] == "uploading":
            row = self.gateway.transition_full_review_report(case_id, user_id, row, "uploaded")
        token = str(uuid4())
        row = self.gateway.transition_full_review_report(case_id, user_id, row, "extracting", token=token)
        try:
            with self.gateway.materialize_full_review_report(case_id, row) as path:
                if hashlib.sha256(path.read_bytes()).hexdigest() != row["document_sha256"]:
                    raise FullReviewConflict("The stored report failed its integrity check")
                if isinstance(cached_extraction, Mapping) and cached_extraction.get("documentSha256") == row["document_sha256"]:
                    extraction = ReportIngestionResult.from_dict(cached_extraction).to_dict()
                else:
                    extraction = self.ingestion.ingest(path).to_dict()
                readiness = full_review_readiness(context["input"], extraction)
        except Exception:
            self.gateway.transition_full_review_report(case_id, user_id, row, "extraction_failed", token=token,
                                                       readiness=report_failure("REPORT_EXTRACTION_FAILED"))
        else:
            self.gateway.transition_full_review_report(case_id, user_id, row, readiness["status"], token=token,
                                                       extraction=extraction, readiness=readiness)
        return self.status(case_id, user_id)

    def confirm(self, case_id: str, user_id: str, report_id: str, revision: int,
                resolutions: Mapping[str, Any]) -> dict[str, Any]:
        context = self._context(case_id, user_id)
        row = context.get("report")
        if not row or row["id"] != report_id or row["revision"] != revision or row["status"] != "needs_confirmation":
            raise FullReviewConflict("The report changed; reload it before confirming")
        previous = row["readiness"].get("resolutions", {})
        readiness = full_review_readiness(context["input"], row["extraction"], {**previous, **resolutions})
        self.gateway.transition_full_review_report(case_id, user_id, row, readiness["status"], readiness=readiness)
        return self.status(case_id, user_id)
