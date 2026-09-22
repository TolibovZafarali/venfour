"""Durable report extraction and strict requalification from saved evidence only."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from uuid import uuid4

from venfour.jurisdiction_adapter import observe_scope

from venfour.analysis_runs import AnalysisRunArtifact
from venfour.full_review import full_review_readiness
from venfour.full_review_calculation import calculate_report_review
from venfour.package_assessment import canonical_package_digest
from venfour.package_processing import (
    PackageProcessingContractError, PackageRetryLaterError, PackageStaleFenceError,
    PackageWorkBusyError, _request_uuid,
)
from venfour.presentation import AnalysisPresentationProjector
from venfour.report_ingestion import ReportIngestionResult, ReportIngestionService


@dataclass(frozen=True)
class FullReviewWorkExecutionResult:
    state: str
    work_item_id: str

    def to_dict(self):
        return {"state": self.state, "workItemId": self.work_item_id}


class FullReviewWorkProcessor:
    def __init__(self, gateway, *, ingestion_service=None):
        self.gateway = gateway
        self.ingestion = ingestion_service or ReportIngestionService()

    def execute(self, work_item_id: str) -> FullReviewWorkExecutionResult:
        work_item_id = _request_uuid(work_item_id, "Work item ID")
        token = str(uuid4())
        claim = self.gateway.claim_full_review_work(work_item_id, token)
        state = claim.get("state") if isinstance(claim, Mapping) else None
        if state in {"completed", "terminal_failed"}:
            return FullReviewWorkExecutionResult(state, work_item_id)
        if state == "already_processing":
            raise PackageWorkBusyError("Report preparation is already processing")
        if state == "retry_later":
            raise PackageRetryLaterError("Report preparation is waiting to retry")
        if state != "claimed":
            raise PackageProcessingContractError("Report preparation claim is invalid")
        try:
            context = claim["context"]
            case_id, user_id, row = context["case_id"], context["user_id"], context["report"]
            observe_scope(self.gateway, case_id, "full_review_process")
            if row.get("extraction") is None:
                with self.gateway.materialize_full_review_report(case_id, row) as path:
                    data = path.read_bytes()
                    if len(data) != row["byte_size"] or hashlib.sha256(data).hexdigest() != row["document_sha256"]:
                        raise PackageProcessingContractError("Saved report integrity check failed")
                    cached = (context.get("existing_report") or {}).get("extraction")
                    if isinstance(cached, Mapping) and cached.get("documentSha256") == row["document_sha256"]:
                        extraction = ReportIngestionResult.from_dict(cached).to_dict()
                    else:
                        extraction = self.ingestion.ingest(path).to_dict()
                    if extraction["documentSha256"] != row["document_sha256"]:
                        raise PackageProcessingContractError("Extracted report identity changed")
                    readiness = full_review_readiness(context["input"], extraction)
                row = self.gateway.transition_full_review_report(
                    case_id, user_id, row, readiness["status"], token=token,
                    extraction=extraction, readiness=readiness,
                )
            calculation, digest = None, None
            if row["status"] == "ready" and row["readiness"]["ready"] is True:
                calculation = calculate_report_review(
                    context["artifact"], row["extraction"], row["readiness"],
                    report_id=row["id"], created_at=datetime.now(timezone.utc).isoformat(),
                )
                artifact = AnalysisRunArtifact.from_dict(calculation["artifact"])
                if (calculation["newProviderRequests"] != 0 or
                        AnalysisPresentationProjector().project(artifact).to_dict() != calculation["presentation"]):
                    raise PackageProcessingContractError("Strict review could not be validated")
                digest = canonical_package_digest(calculation)
            if not self.gateway.complete_full_review_work(work_item_id, token, row["revision"], calculation, digest):
                raise PackageStaleFenceError("Report preparation lease changed")
        except PackageStaleFenceError:
            raise
        except Exception as exc:
            if not self.gateway.fail_full_review_work(work_item_id, token):
                raise PackageStaleFenceError("Report preparation failure lease changed") from exc
            raise PackageRetryLaterError("Saved report preparation will retry") from exc
        return FullReviewWorkExecutionResult("completed", work_item_id)
