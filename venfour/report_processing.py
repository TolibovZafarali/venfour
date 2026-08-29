"""Durable professional-report generation and independent-review orchestration.

The database owns identities, leases, publication, workflow transitions, and
refund fences.  This module performs only deterministic report/PDF work and
the separately configured quality-review call.  It never makes customer flow
reachable and exposes no report download boundary.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, runtime_checkable
from uuid import UUID, uuid4

import pymupdf

from venfour.commerce import (
    CommerceProviderContractError,
    CommerceUnavailableError,
)
from venfour.package_assessment import canonical_package_digest
from venfour.package_processing import (
    PACKAGE_WORK_TYPE,
    PACKAGE_WORK_VERSION,
    PackageExecutionResult,
    PackageProcessingContractError,
    PackageProcessingDatabaseGateway,
    PackageProcessingInputError,
    PackageProcessingUnavailableError,
    PackageStaleFenceError,
    PackageWorkBusyError,
    TotalLossPackageProcessor,
)
from venfour.report_review import (
    REPORT_REVIEW_PROMPT_VERSION,
    REPORT_REVIEW_PROVIDER_IDENTIFIER,
    REPORT_REVIEW_SCHEMA_VERSION,
    CompletedReportReview,
    OpenAIReportReviewer,
    ReportReviewConfiguration,
    ReportReviewError,
    ReportReviewInputV1,
    build_report_review_input_v1,
)
from venfour.report_review_evals import (
    ReportReviewEvalAttestationV1,
    ReportReviewEvalError,
)
from venfour.report_release_gate import (
    ReportReleaseDecision,
    ReportReleaseGate,
    ReportReleaseGateContext,
)
from venfour.supabase_gateway import (
    SupabaseContractError,
    SupabaseGatewayError,
    SupabaseUnavailableError,
)
from venfour.valuation_evidence_report import (
    PDF_VALIDATION_SCHEMA_VERSION,
    REPORT_RENDERER_VERSION,
    REPORT_SCHEMA_VERSION,
    REPORT_TEMPLATE_VERSION,
    ValuationEvidenceReportError,
    build_valuation_evidence_report_v1,
    render_valuation_evidence_report_pdf_v1,
    validate_valuation_evidence_report_pdf_v1,
)


REPORT_GENERATION_WORK_TYPE = "total_loss_report_generate"
REPORT_REVIEW_WORK_TYPE = "total_loss_report_review"
REPORT_WORK_VERSION = "1"
REPORT_VALIDATION_VERSION = PDF_VALIDATION_SCHEMA_VERSION
REPORT_RETRY_DELAY_SECONDS = 60
REPORT_MAX_ATTEMPTS = 3


class _NoDisputeRefundPendingError(PackageProcessingUnavailableError):
    """Publication succeeded but the idempotent refund still needs recovery."""


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise PackageProcessingContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (TypeError, ValueError) as exc:
        raise PackageProcessingContractError(f"{label} is invalid") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _request_uuid(value: Any, label: str) -> str:
    try:
        return _uuid(value, label)
    except PackageProcessingContractError as exc:
        raise PackageProcessingInputError(f"{label} is invalid") from exc


def _mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _positive_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _digest(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _string(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or any(ord(character) < 32 for character in value)
    ):
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _canonical_generated_at(value: Any) -> str:
    if not isinstance(value, str):
        raise PackageProcessingContractError("Report generation time is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PackageProcessingContractError(
            "Report generation time is invalid"
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() != UTC.utcoffset(parsed):
        raise PackageProcessingContractError("Report generation time is invalid")
    return parsed.isoformat().replace("+00:00", "Z")


def _pdf_text(path: Path, expected_digest: str) -> str:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise PackageProcessingContractError(
            "Private report is missing or unreadable"
        ) from exc
    if hashlib.sha256(data).hexdigest() != expected_digest:
        raise PackageProcessingContractError(
            "Private report digest does not match its immutable row"
        )
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PackageProcessingContractError(
            "Private report could not be parsed"
        ) from exc
    try:
        text = "\n".join(
            document.load_page(index).get_text("text")
            for index in range(document.page_count)
        )
    finally:
        document.close()
    if not text.strip():
        raise PackageProcessingContractError("Private report text is empty")
    return text


def build_deterministic_report_validation_manifest(
    *,
    source_snapshot_digest: str,
    final_assessment_digest: str,
    report_digest: str,
    pdf_validation_manifest: Mapping[str, Any],
) -> Mapping[str, Any]:
    unsigned = {
        "schemaVersion": "1",
        "status": "PASS",
        "sourceSnapshotDigest": source_snapshot_digest,
        "finalAssessmentDigest": final_assessment_digest,
        "reportDigest": report_digest,
        "checks": [
            {"checkId": "SOURCE_SCHEMA_AND_DIGEST", "status": "PASS"},
            {"checkId": "ASSESSMENT_SCHEMA_AND_DIGEST", "status": "PASS"},
            {"checkId": "REPORT_SCHEMA_AND_PROJECTION", "status": "PASS"},
            {"checkId": "PDF_PARSE_CONTENT_AND_METADATA", "status": "PASS"},
        ],
        "pdfValidationManifestDigest": canonical_package_digest(
            pdf_validation_manifest
        ),
    }
    return {**unsigned, "manifestDigest": canonical_package_digest(unsigned)}


@runtime_checkable
class ReportProcessingDatabaseGateway(Protocol):
    def enqueue_total_loss_report_generation(
        self, package_job_id: str
    ) -> Mapping[str, Any]: ...

    def resolve_workflow_work_item_kind(
        self, work_item_id: str
    ) -> Mapping[str, Any]: ...

    def claim_total_loss_report_generation_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_report_generation_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def upload_total_loss_deliverable_pdf(
        self,
        case_id: str,
        report_series_id: str,
        report_version_id: str,
        storage_locator: Mapping[str, Any],
        pdf: bytes,
        pdf_digest: str,
    ) -> str: ...

    def complete_total_loss_report_generation(
        self,
        work_item_id: str,
        processing_token: str,
        report: Mapping[str, Any],
        report_digest: str,
        renderer_version: str,
        template_version: str,
        schema_version: str,
        validation_version: str,
        validation_manifest: Mapping[str, Any],
        pdf_byte_size: int,
        pdf_digest: str,
    ) -> Mapping[str, Any]: ...

    def materialize_total_loss_deliverable(
        self,
        case_id: str,
        report_series_id: str,
        report_version_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ) -> Any: ...

    def claim_total_loss_report_review_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_report_review_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def begin_total_loss_ai_review(
        self,
        work_item_id: str,
        processing_token: str,
        provider_identifier: str,
        configured_model_identifier: str,
        prompt_version: str,
        schema_version: str,
        input_digest: str,
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_report_release_context(
        self,
        work_item_id: str,
        processing_token: str,
        ai_review_run_id: str,
    ) -> Mapping[str, Any]: ...

    def complete_total_loss_ai_review(
        self,
        work_item_id: str,
        processing_token: str,
        ai_review_run_id: str,
        terminal_status: str,
        returned_model_identifier: str | None,
        recommendation: str | None,
        confidence: str | None,
        review_result: Mapping[str, Any] | None,
        output_digest: str | None,
        usage_metadata: Mapping[str, Any] | None,
        failure_code: str | None,
        release_gate_manifest: Mapping[str, Any] | None,
        release_gate_digest: str | None,
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_report_release(
        self,
        work_item_id: str,
        processing_token: str,
        ai_review_run_id: str,
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_no_dispute_refund(
        self, report_version_id: str
    ) -> Mapping[str, Any]: ...

    def complete_total_loss_no_dispute_refund(
        self, report_version_id: str, refund_request_id: str
    ) -> Mapping[str, Any]: ...

    def hold_total_loss_no_dispute_refund_failure(
        self,
        report_version_id: str,
        refund_request_id: str | None = None,
    ) -> Mapping[str, Any]: ...

    def fail_total_loss_report_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        failure_code: str,
        failure_kind: str,
        retry_delay_seconds: int,
    ) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class ReportWorkExecutionResult:
    state: str
    work_item_id: str
    work_type: str
    package_job_id: str | None = None
    package_status: str | None = None
    attempt_count: int | None = None
    report_version_id: str | None = None
    ai_review_run_id: str | None = None
    release_disposition: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "workItemId": self.work_item_id,
            "workType": self.work_type,
            "packageJobId": self.package_job_id,
            "packageStatus": self.package_status,
            "attemptCount": self.attempt_count,
            "reportVersionId": self.report_version_id,
            "aiReviewRunId": self.ai_review_run_id,
            "releaseDisposition": self.release_disposition,
        }


class TotalLossReportProcessor:
    """Execute report generation and review under database-owned fences."""

    def __init__(
        self,
        database: ReportProcessingDatabaseGateway,
        *,
        reviewer: OpenAIReportReviewer | None = None,
        review_configuration: ReportReviewConfiguration | None = None,
        release_gate: ReportReleaseGate | None = None,
        provider_evaluation_attestation: Mapping[str, Any] | None = None,
        commerce_service: Any | None = None,
    ) -> None:
        if not isinstance(database, ReportProcessingDatabaseGateway):
            raise TypeError("database must expose report-processing methods")
        self._database = database
        self._review_configuration = (
            review_configuration or ReportReviewConfiguration()
        )
        self._reviewer = reviewer
        self._release_gate = release_gate or ReportReleaseGate()
        if provider_evaluation_attestation is None:
            self._provider_evaluation_attestation = None
        else:
            try:
                self._provider_evaluation_attestation = (
                    ReportReviewEvalAttestationV1.from_dict(
                        provider_evaluation_attestation,
                        expected_model_identifier=(
                            self._review_configuration.approved_model_identifier
                        ),
                        expected_prompt_version=(
                            self._review_configuration.approved_prompt_version
                        ),
                        expected_review_schema_version=(
                            self._review_configuration.approved_schema_version
                        ),
                        expected_eval_suite_digest=(
                            self._review_configuration.approved_eval_suite_digest
                        ),
                    )
                )
            except ReportReviewEvalError as exc:
                raise ValueError(
                    "provider_evaluation_attestation is invalid"
                ) from exc
        self._commerce_service = commerce_service

    @staticmethod
    def _failure_disposition(exc: Exception) -> tuple[str, str]:
        if isinstance(
            exc,
            (
                SupabaseUnavailableError,
                PackageProcessingUnavailableError,
            ),
        ):
            return "retryable", "REPORT_PROCESSING_UNAVAILABLE"
        if isinstance(exc, ReportReviewError):
            return (
                ("retryable", exc.code)
                if exc.retryable
                else ("human_review_required", exc.code)
            )
        if isinstance(
            exc,
            (
                ValuationEvidenceReportError,
                PackageProcessingContractError,
                SupabaseContractError,
            ),
        ):
            return "human_review_required", "REPORT_VALIDATION_FAILED"
        return "human_review_required", "REPORT_PROCESSING_FAILED"

    def _record_work_failure(
        self,
        work_item_id: str,
        processing_token: str,
        exc: Exception,
        attempt_count: int,
    ) -> Mapping[str, Any]:
        failure_kind, failure_code = self._failure_disposition(exc)
        if failure_kind == "retryable" and attempt_count >= REPORT_MAX_ATTEMPTS:
            failure_kind = "human_review_required"
            failure_code = "REPORT_RETRY_EXHAUSTED"
        try:
            row = _mapping(
                self._database.fail_total_loss_report_work_item(
                    work_item_id,
                    processing_token,
                    failure_code,
                    failure_kind,
                    REPORT_RETRY_DELAY_SECONDS
                    if failure_kind == "retryable"
                    else 0,
                ),
                "Report work failure",
            )
        except SupabaseGatewayError as failure_exc:
            raise PackageStaleFenceError(
                "Report failure fence changed"
            ) from failure_exc
        if row.get("outcome") not in {"completed", "existing"}:
            raise PackageStaleFenceError("Report failure fence changed")
        return row

    @staticmethod
    def _terminal_generation_result(
        claim: Mapping[str, Any], work_item_id: str
    ) -> ReportWorkExecutionResult:
        return ReportWorkExecutionResult(
            state=str(claim.get("outcome")),
            work_item_id=work_item_id,
            work_type=REPORT_GENERATION_WORK_TYPE,
            package_job_id=(
                _uuid(claim.get("package_job_id"), "Package job ID")
                if claim.get("package_job_id") is not None
                else None
            ),
            package_status=claim.get("package_status"),
            attempt_count=claim.get("attempt_count"),
            report_version_id=(
                _uuid(claim.get("report_version_id"), "Report version ID")
                if claim.get("report_version_id") is not None
                else None
            ),
        )

    def execute_generation(self, work_item_id: str) -> ReportWorkExecutionResult:
        selected_work_item_id = _request_uuid(work_item_id, "Work item ID")
        processing_token = str(uuid4())
        try:
            claim = _mapping(
                self._database.claim_total_loss_report_generation_work_item(
                    selected_work_item_id, processing_token
                ),
                "Report generation claim",
            )
        except SupabaseUnavailableError as exc:
            raise PackageProcessingUnavailableError(
                "Report generation could not be claimed"
            ) from exc
        except SupabaseGatewayError as exc:
            raise PackageProcessingContractError(
                "Report generation claim is invalid"
            ) from exc
        outcome = claim.get("outcome")
        if outcome == "busy":
            raise PackageWorkBusyError("Report generation is already processing")
        if outcome in {"completed", "terminal_failed"}:
            return self._terminal_generation_result(claim, selected_work_item_id)
        if outcome != "claimed":
            raise PackageProcessingContractError(
                "Report generation claim is invalid"
            )
        if claim.get("processing_token") != processing_token:
            raise PackageStaleFenceError("Report generation fence changed")
        attempt_count = _positive_integer(
            claim.get("attempt_count"), "Report attempt count"
        )
        try:
            return self._execute_generation_claimed(
                selected_work_item_id, processing_token, claim
            )
        except PackageStaleFenceError:
            raise
        except Exception as exc:
            failed = self._record_work_failure(
                selected_work_item_id,
                processing_token,
                exc,
                attempt_count,
            )
            if failed.get("work_item_status") == "retryable_failed":
                raise PackageProcessingUnavailableError(
                    "Report generation will be retried"
                ) from exc
            return ReportWorkExecutionResult(
                state="terminal_failed",
                work_item_id=selected_work_item_id,
                work_type=REPORT_GENERATION_WORK_TYPE,
                package_job_id=(
                    _uuid(claim.get("package_job_id"), "Package job ID")
                    if claim.get("package_job_id") is not None
                    else None
                ),
                package_status=failed.get("package_status"),
                attempt_count=attempt_count,
                report_version_id=(
                    _uuid(
                        failed.get("report_version_id"),
                        "Report version ID",
                    )
                    if failed.get("report_version_id") is not None
                    else None
                ),
            )

    def _execute_generation_claimed(
        self,
        selected_work_item_id: str,
        processing_token: str,
        claim: Mapping[str, Any],
    ) -> ReportWorkExecutionResult:
        context = _mapping(
            self._database.resolve_total_loss_report_generation_context(
                selected_work_item_id, processing_token
            ),
            "Report generation context",
        )
        case_id = _uuid(context.get("case_id"), "Case ID")
        package_job_id = _uuid(
            context.get("package_job_id"), "Package job ID"
        )
        report_series_id = _uuid(
            context.get("report_series_id"), "Report series ID"
        )
        report_version_id = _uuid(
            context.get("report_version_id"), "Report version ID"
        )
        final_assessment_id = _uuid(
            context.get("final_assessment_id"), "Final assessment ID"
        )
        version_number = _positive_integer(
            context.get("report_version_number"), "Report version number"
        )
        if (
            context.get("work_item_id") != selected_work_item_id
            or claim.get("case_id") != case_id
            or claim.get("package_job_id") != package_job_id
            or claim.get("report_series_id") != report_series_id
            or claim.get("report_version_id") != report_version_id
            or claim.get("report_version_number") != version_number
            or claim.get("document_id") != context.get("document_id")
            or claim.get("storage_bucket_id")
            != context.get("storage_bucket_id")
            or claim.get("storage_object_name")
            != context.get("storage_object_name")
            or claim.get("original_filename")
            != context.get("original_filename")
        ):
            raise PackageProcessingContractError(
                "Report generation identity changed after claim"
            )
        source = _mapping(context.get("source_snapshot"), "Source snapshot")
        assessment = _mapping(
            context.get("final_assessment"), "Final assessment"
        )
        generated_at = _canonical_generated_at(context.get("generated_at"))
        report = build_valuation_evidence_report_v1(
            source_snapshot=source,
            final_assessment=assessment,
            report_series_id=report_series_id,
            report_version_id=report_version_id,
            final_assessment_id=final_assessment_id,
            version_number=version_number,
            generated_at=generated_at,
        )
        report_payload = report.to_dict()
        pdf = render_valuation_evidence_report_pdf_v1(report)
        pdf_manifest = validate_valuation_evidence_report_pdf_v1(pdf, report)
        pdf_manifest_payload = pdf_manifest.to_dict()
        locator = {
            "storage_bucket_id": context.get("storage_bucket_id"),
            "storage_object_name": context.get("storage_object_name"),
        }
        upload_outcome = self._database.upload_total_loss_deliverable_pdf(
            case_id,
            report_series_id,
            report_version_id,
            locator,
            pdf,
            pdf_manifest.pdf_sha256,
        )
        if upload_outcome not in {"created", "existing"}:
            raise PackageProcessingContractError(
                "Report upload returned an invalid outcome"
            )
        completed = _mapping(
            self._database.complete_total_loss_report_generation(
                selected_work_item_id,
                processing_token,
                report_payload,
                report_payload["reportDigest"],
                REPORT_RENDERER_VERSION,
                REPORT_TEMPLATE_VERSION,
                REPORT_SCHEMA_VERSION,
                REPORT_VALIDATION_VERSION,
                pdf_manifest_payload,
                len(pdf),
                pdf_manifest.pdf_sha256,
            ),
            "Report generation completion",
        )
        if completed.get("outcome") not in {"completed", "existing"}:
            raise PackageStaleFenceError(
                "Report generation completion fence changed"
            )
        if completed.get("report_version_id") != report_version_id:
            raise PackageProcessingContractError(
                "Report generation completion changed report identity"
            )
        return ReportWorkExecutionResult(
            state="completed",
            work_item_id=selected_work_item_id,
            work_type=REPORT_GENERATION_WORK_TYPE,
            package_job_id=package_job_id,
            package_status=completed.get("package_status"),
            attempt_count=_positive_integer(
                claim.get("attempt_count"), "Report attempt count"
            ),
            report_version_id=report_version_id,
        )

    @staticmethod
    def _terminal_review_result(
        claim: Mapping[str, Any], work_item_id: str
    ) -> ReportWorkExecutionResult:
        return ReportWorkExecutionResult(
            state=_string(claim.get("outcome"), "Report review outcome"),
            work_item_id=work_item_id,
            work_type=REPORT_REVIEW_WORK_TYPE,
            package_job_id=(
                _uuid(claim.get("package_job_id"), "Package job ID")
                if claim.get("package_job_id") is not None
                else None
            ),
            package_status=claim.get("package_status"),
            attempt_count=claim.get("attempt_count"),
            report_version_id=(
                _uuid(claim.get("report_version_id"), "Report version ID")
                if claim.get("report_version_id") is not None
                else None
            ),
            ai_review_run_id=(
                _uuid(claim.get("ai_review_run_id"), "AI review run ID")
                if claim.get("ai_review_run_id") is not None
                else None
            ),
            release_disposition=(
                _string(
                    claim.get("release_disposition"),
                    "Release disposition",
                )
                if claim.get("release_disposition") is not None
                else None
            ),
        )

    def _release_gate_context(
        self,
        row: Mapping[str, Any],
        request: ReportReviewInputV1,
    ) -> ReportReleaseGateContext:
        attestation = self._provider_evaluation_attestation
        provider_evaluation_passed = bool(
            attestation is not None and attestation.all_passed
        )
        request_digests = request.digests
        return ReportReleaseGateContext(
            case_id=_uuid(row.get("case_id"), "Case ID"),
            source_snapshot_id=_uuid(
                row.get("source_snapshot_id"), "Source snapshot ID"
            ),
            final_assessment_id=_uuid(
                row.get("final_assessment_id"), "Final assessment ID"
            ),
            report_version_id=_uuid(
                row.get("report_version_id"), "Report version ID"
            ),
            source_snapshot_digest=_digest(
                row.get("source_snapshot_digest"), "Source snapshot digest"
            ),
            final_assessment_digest=_digest(
                row.get("final_assessment_digest"), "Final assessment digest"
            ),
            report_digest=_digest(row.get("report_digest"), "Report digest"),
            pdf_digest=_digest(row.get("pdf_digest"), "PDF digest"),
            deterministic_validation_digest=_digest(
                request_digests.get("deterministicValidationDigest"),
                "Deterministic validation digest",
            ),
            pdf_validation_digest=_digest(
                request_digests.get("pdfValidationDigest"),
                "PDF validation digest",
            ),
            final_continuation_status=_string(
                row.get("final_continuation_status"),
                "Final continuation status",
            ),
            report_status=_string(row.get("report_status"), "Report status"),
            source_validation_passed=_boolean(
                row.get("source_validation_passed"),
                "Source validation state",
            ),
            report_json_schema_passed=_boolean(
                row.get("report_json_schema_passed"),
                "Report schema validation state",
            ),
            deterministic_report_validation_passed=_boolean(
                row.get("deterministic_report_validation_passed"),
                "Deterministic report validation state",
            ),
            pdf_validation_passed=_boolean(
                row.get("pdf_validation_passed"), "PDF validation state"
            ),
            ai_schema_validation_passed=True,
            package_is_current=_boolean(
                row.get("package_is_current"), "Current package state"
            ),
            report_is_current=_boolean(
                row.get("report_is_current"), "Current report state"
            ),
            review_is_current=_boolean(
                row.get("review_is_current"), "Current review state"
            ),
            human_decision_recorded=_boolean(
                row.get("human_decision_recorded"), "Human decision state"
            ),
            provider_evaluation_passed=provider_evaluation_passed,
            provider_evaluation_model_identifier=(
                attestation.returned_model_identifier
                if attestation is not None
                else None
            ),
            provider_evaluation_prompt_version=(
                attestation.prompt_version if attestation is not None else None
            ),
            provider_evaluation_schema_version=(
                attestation.review_schema_version
                if attestation is not None
                else None
            ),
            provider_evaluation_suite_digest=(
                attestation.eval_suite_digest if attestation is not None else None
            ),
            provider_evaluation_attestation=attestation,
        )

    def _release_gate_manifest(
        self,
        *,
        package_job_id: str,
        work_item_id: str,
        ai_review_run_id: str,
        context: ReportReleaseGateContext,
        request: ReportReviewInputV1,
        completed_review: CompletedReportReview,
        decision: ReportReleaseDecision,
    ) -> Mapping[str, Any]:
        configuration = self._review_configuration
        return {
            "schemaVersion": "1",
            "disposition": decision.disposition,
            "caseId": context.case_id,
            "packageJobId": package_job_id,
            "workItemId": work_item_id,
            "reportVersionId": context.report_version_id,
            "sourceSnapshotId": context.source_snapshot_id,
            "finalAssessmentId": context.final_assessment_id,
            "aiReviewRunId": ai_review_run_id,
            "sourceSnapshotDigest": context.source_snapshot_digest,
            "finalAssessmentDigest": context.final_assessment_digest,
            "reportDigest": context.report_digest,
            "pdfDigest": context.pdf_digest,
            "inputDigest": request.input_digest,
            "outputDigest": completed_review.output_digest,
            "deterministicValidationDigest": (
                context.deterministic_validation_digest
            ),
            "pdfValidationDigest": context.pdf_validation_digest,
            "configuredModelIdentifier": (
                completed_review.configured_model_identifier
            ),
            "returnedModelIdentifier": completed_review.returned_model_identifier,
            "promptVersion": completed_review.prompt_version,
            "reviewSchemaVersion": completed_review.schema_version,
            "releaseGateEnabled": configuration.release_gate_enabled,
            "approvalConfigurationComplete": (
                configuration.approval_configuration_complete
            ),
            "approvedModelIdentifier": configuration.approved_model_identifier,
            "approvedPromptVersion": configuration.approved_prompt_version,
            "approvedSchemaVersion": configuration.approved_schema_version,
            "approvedEvalSuiteDigest": (
                configuration.approved_eval_suite_digest
            ),
            "providerEvaluationPassed": context.provider_evaluation_passed,
            "providerEvaluationModelIdentifier": (
                context.provider_evaluation_model_identifier
            ),
            "providerEvaluationPromptVersion": (
                context.provider_evaluation_prompt_version
            ),
            "providerEvaluationSchemaVersion": (
                context.provider_evaluation_schema_version
            ),
            "providerEvaluationSuiteDigest": (
                context.provider_evaluation_suite_digest
            ),
            "providerEvaluationAttestationDigest": (
                context.provider_evaluation_attestation.artifact_digest
                if context.provider_evaluation_attestation is not None
                else None
            ),
            "sourceValidationPassed": context.source_validation_passed,
            "reportJsonSchemaPassed": context.report_json_schema_passed,
            "deterministicReportValidationPassed": (
                context.deterministic_report_validation_passed
            ),
            "pdfValidationPassed": context.pdf_validation_passed,
            "aiSchemaValidationPassed": context.ai_schema_validation_passed,
            "packageIsCurrent": context.package_is_current,
            "reportIsCurrent": context.report_is_current,
            "reviewIsCurrent": context.review_is_current,
            "humanDecisionRecorded": context.human_decision_recorded,
            "reasonCodes": list(decision.reason_codes),
        }

    def _resolve_release(
        self,
        *,
        work_item_id: str,
        processing_token: str,
        ai_review_run_id: str,
    ) -> Mapping[str, Any]:
        released = _mapping(
            self._database.resolve_total_loss_report_release(
                work_item_id, processing_token, ai_review_run_id
            ),
            "Report release",
        )
        if released.get("outcome") not in {"completed", "existing"}:
            raise PackageStaleFenceError("Report release fence changed")
        if released.get("ai_review_run_id") != ai_review_run_id:
            raise PackageProcessingContractError(
                "Report release changed AI review identity"
            )
        return released

    def _finish_no_dispute_refund(
        self,
        report_version_id: str,
        release: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        try:
            return self._finish_no_dispute_refund_impl(
                report_version_id, release
            )
        except _NoDisputeRefundPendingError:
            raise
        except (
            CommerceProviderContractError,
            SupabaseContractError,
            PackageProcessingContractError,
        ) as exc:
            return self._hold_no_dispute_refund_failure(
                report_version_id,
                self._recoverable_refund_request_id(release),
                cause=exc,
            )
        except (
            CommerceUnavailableError,
            SupabaseUnavailableError,
            PackageProcessingUnavailableError,
        ) as exc:
            raise _NoDisputeRefundPendingError(
                "No-dispute refund remains pending"
            ) from exc
        except Exception as exc:
            return self._hold_no_dispute_refund_failure(
                report_version_id,
                self._recoverable_refund_request_id(release),
                cause=exc,
            )

    @staticmethod
    def _refund_request_id(row: Mapping[str, Any] | None) -> str | None:
        if row is None or row.get("refund_request_id") is None:
            return None
        return _uuid(row.get("refund_request_id"), "Refund request ID")

    @classmethod
    def _recoverable_refund_request_id(
        cls, row: Mapping[str, Any] | None
    ) -> str | None:
        try:
            return cls._refund_request_id(row)
        except PackageProcessingContractError:
            return None

    def _hold_no_dispute_refund_failure(
        self,
        report_version_id: str,
        refund_request_id: str | None,
        *,
        cause: Exception | None = None,
    ) -> Mapping[str, Any]:
        try:
            held = _mapping(
                self._database.hold_total_loss_no_dispute_refund_failure(
                    report_version_id, refund_request_id
                ),
                "No-dispute refund remediation",
            )
        except SupabaseUnavailableError as exc:
            raise _NoDisputeRefundPendingError(
                "No-dispute refund remediation could not be persisted"
            ) from exc
        except SupabaseGatewayError as exc:
            raise PackageProcessingContractError(
                "No-dispute refund remediation is invalid"
            ) from exc
        if held.get("outcome") not in {"completed", "existing"}:
            raise PackageProcessingContractError(
                "No-dispute refund remediation did not converge"
            ) from cause
        if held.get("report_version_id") != report_version_id:
            raise PackageProcessingContractError(
                "No-dispute refund remediation changed report identity"
            ) from cause
        held_refund_request_id = self._refund_request_id(held)
        if (
            refund_request_id is not None
            and held_refund_request_id != refund_request_id
        ):
            raise PackageProcessingContractError(
                "No-dispute refund remediation changed refund identity"
            ) from cause
        if (
            held.get("package_status") != "waiting_human_review"
            or held.get("workflow_task") != "exception_review"
        ):
            raise PackageProcessingContractError(
                "No-dispute refund remediation state is invalid"
            ) from cause
        return held

    def _completed_no_dispute_refund(
        self,
        row: Mapping[str, Any],
        report_version_id: str,
        refund_request_id: str | None = None,
    ) -> Mapping[str, Any]:
        if row.get("report_version_id") != report_version_id:
            raise PackageProcessingContractError(
                "No-dispute refund completion changed report identity"
            )
        completed_refund_request_id = self._refund_request_id(row)
        if completed_refund_request_id is None or (
            refund_request_id is not None
            and completed_refund_request_id != refund_request_id
        ):
            raise PackageProcessingContractError(
                "No-dispute refund completion changed refund identity"
            )
        if row.get("package_status") != "not_supportable":
            raise PackageProcessingContractError(
                "No-dispute refund completion state is invalid"
            )
        return row

    def resume_no_dispute_refund(
        self, report_version_id: str
    ) -> Mapping[str, Any]:
        """Resume one retained-access refund from its authoritative report."""

        selected_report_version_id = _request_uuid(
            report_version_id, "Report version ID"
        )
        return self._finish_no_dispute_refund(selected_report_version_id)

    def _finish_no_dispute_refund_impl(
        self,
        report_version_id: str,
        release: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        refund_context = _mapping(
            self._database.resolve_total_loss_no_dispute_refund(
                report_version_id
            ),
            "No-dispute refund context",
        )
        outcome = refund_context.get("outcome")
        if outcome == "completed":
            return self._completed_no_dispute_refund(
                refund_context, report_version_id
            )
        refund_request_id = self._refund_request_id(refund_context)
        if outcome == "human_review_required":
            return self._hold_no_dispute_refund_failure(
                report_version_id, refund_request_id
            )
        if outcome not in {
            "refund_required",
            "completion_required",
            "refund_in_progress",
        }:
            raise PackageProcessingContractError(
                "No-dispute refund context is invalid"
            )
        refund_status = refund_context.get("refund_status")
        if outcome == "refund_required" and (
            refund_status is not None or refund_request_id is not None
        ):
            raise PackageProcessingContractError(
                "No-dispute refund requirement is inconsistent"
            )
        if outcome == "completion_required" and (
            refund_status != "succeeded" or refund_request_id is None
        ):
            raise PackageProcessingContractError(
                "No-dispute refund completion is inconsistent"
            )
        if outcome == "refund_in_progress":
            if refund_status in {"failed", "canceled"}:
                return self._hold_no_dispute_refund_failure(
                    report_version_id, refund_request_id
                )
            if refund_status not in {"creating", "pending"}:
                raise PackageProcessingContractError(
                    "No-dispute refund status is invalid"
                )
        if self._commerce_service is None:
            raise _NoDisputeRefundPendingError(
                "No-dispute refund service is unavailable"
            )
        case_id = _uuid(refund_context.get("case_id"), "Case ID")
        order_id = _uuid(refund_context.get("order_id"), "Order ID")
        payment_transaction_id = _uuid(
            refund_context.get("payment_transaction_id"),
            "Payment transaction ID",
        )
        client_request_id = _uuid(
            refund_context.get("refund_client_request_id"),
            "Refund client request ID",
        )
        if release is not None:
            for key, expected in (
                ("case_id", case_id),
                ("order_id", order_id),
                ("payment_transaction_id", payment_transaction_id),
                ("refund_client_request_id", client_request_id),
            ):
                observed = release.get(key)
                if observed is not None and observed != expected:
                    raise PackageProcessingContractError(
                        "No-dispute refund identity changed after release"
                    )
        if outcome != "completion_required":
            projection = self._commerce_service.refund(
                case_id=case_id,
                order_id=order_id,
                payment_transaction_id=payment_transaction_id,
                client_request_id=client_request_id,
                reason_code="NO_MATERIAL_DISPUTE_SUPPORTED",
                access_policy="retain",
            )
            projection_status = getattr(projection, "refund_status", None)
            if projection_status in {"failed", "canceled"}:
                return self._hold_no_dispute_refund_failure(
                    report_version_id, refund_request_id
                )
            if projection_status in {"creating", "pending"}:
                raise _NoDisputeRefundPendingError(
                    "No-dispute refund has not completed"
                )
            if projection_status != "succeeded":
                raise PackageProcessingContractError(
                    "No-dispute refund result is invalid"
                )
        resolved = _mapping(
            self._database.resolve_total_loss_no_dispute_refund(
                report_version_id
            ),
            "Completed refund context",
        )
        resolved_outcome = resolved.get("outcome")
        resolved_refund_request_id = self._refund_request_id(resolved)
        if resolved_outcome == "completed":
            return self._completed_no_dispute_refund(
                resolved, report_version_id
            )
        if resolved_outcome == "human_review_required" or (
            resolved_outcome == "refund_in_progress"
            and resolved.get("refund_status") in {"failed", "canceled"}
        ):
            return self._hold_no_dispute_refund_failure(
                report_version_id, resolved_refund_request_id
            )
        if resolved_outcome == "refund_in_progress" and resolved.get(
            "refund_status"
        ) in {"creating", "pending"}:
            raise _NoDisputeRefundPendingError(
                "No-dispute refund has not completed"
            )
        if (
            resolved_outcome != "completion_required"
            or resolved.get("refund_status") != "succeeded"
            or resolved_refund_request_id is None
        ):
            raise PackageProcessingContractError(
                "Completed refund context is invalid"
            )
        completed = _mapping(
            self._database.complete_total_loss_no_dispute_refund(
                report_version_id, resolved_refund_request_id
            ),
            "No-dispute refund completion",
        )
        if completed.get("outcome") not in {"completed", "existing"}:
            raise PackageStaleFenceError(
                "No-dispute refund completion fence changed"
            )
        return self._completed_no_dispute_refund(
            completed,
            report_version_id,
            resolved_refund_request_id,
        )

    def execute_review(self, work_item_id: str) -> ReportWorkExecutionResult:
        selected_work_item_id = _request_uuid(work_item_id, "Work item ID")
        processing_token = str(uuid4())
        try:
            claim = _mapping(
                self._database.claim_total_loss_report_review_work_item(
                    selected_work_item_id, processing_token
                ),
                "Report review claim",
            )
        except SupabaseUnavailableError as exc:
            raise PackageProcessingUnavailableError(
                "Report review could not be claimed"
            ) from exc
        except SupabaseGatewayError as exc:
            raise PackageProcessingContractError(
                "Report review claim is invalid"
            ) from exc
        outcome = claim.get("outcome")
        if outcome == "busy":
            raise PackageWorkBusyError("Report review is already processing")
        if outcome in {"completed", "terminal_failed"}:
            terminal = self._terminal_review_result(
                claim, selected_work_item_id
            )
            if (
                terminal.state == "completed"
                and terminal.package_status == "refund_pending"
                and terminal.report_version_id is not None
            ):
                completed_refund = self._finish_no_dispute_refund(
                    terminal.report_version_id
                )
                return ReportWorkExecutionResult(
                    state="completed",
                    work_item_id=selected_work_item_id,
                    work_type=REPORT_REVIEW_WORK_TYPE,
                    package_job_id=terminal.package_job_id,
                    package_status=completed_refund.get("package_status"),
                    attempt_count=terminal.attempt_count,
                    report_version_id=terminal.report_version_id,
                    ai_review_run_id=terminal.ai_review_run_id,
                    release_disposition=(
                        terminal.release_disposition
                        or "AUTO_RELEASE_NO_DISPUTE_REFUND"
                    ),
                )
            return terminal
        if outcome != "claimed":
            raise PackageProcessingContractError("Report review claim is invalid")
        if claim.get("processing_token") != processing_token:
            raise PackageStaleFenceError("Report review fence changed")
        attempt_count = _positive_integer(
            claim.get("attempt_count"), "Report review attempt count"
        )
        try:
            return self._execute_review_claimed(
                selected_work_item_id, processing_token, claim
            )
        except (_NoDisputeRefundPendingError, PackageStaleFenceError):
            raise
        except Exception as exc:
            failed = self._record_work_failure(
                selected_work_item_id,
                processing_token,
                exc,
                attempt_count,
            )
            if failed.get("work_item_status") == "retryable_failed":
                raise PackageProcessingUnavailableError(
                    "Report review will be retried"
                ) from exc
            return ReportWorkExecutionResult(
                state="human_review_required",
                work_item_id=selected_work_item_id,
                work_type=REPORT_REVIEW_WORK_TYPE,
                package_job_id=(
                    _uuid(claim.get("package_job_id"), "Package job ID")
                    if claim.get("package_job_id") is not None
                    else None
                ),
                package_status=failed.get("package_status"),
                attempt_count=attempt_count,
                report_version_id=(
                    _uuid(
                        failed.get("report_version_id"),
                        "Report version ID",
                    )
                    if failed.get("report_version_id") is not None
                    else None
                ),
                release_disposition="HUMAN_REVIEW",
            )

    def _execute_review_claimed(
        self,
        selected_work_item_id: str,
        processing_token: str,
        claim: Mapping[str, Any],
    ) -> ReportWorkExecutionResult:
        context = _mapping(
            self._database.resolve_total_loss_report_review_context(
                selected_work_item_id, processing_token
            ),
            "Report review context",
        )
        case_id = _uuid(context.get("case_id"), "Case ID")
        package_job_id = _uuid(
            context.get("package_job_id"), "Package job ID"
        )
        report_series_id = _uuid(
            context.get("report_series_id"), "Report series ID"
        )
        report_version_id = _uuid(
            context.get("report_version_id"), "Report version ID"
        )
        source_snapshot_id = _uuid(
            context.get("source_snapshot_id"), "Source snapshot ID"
        )
        final_assessment_id = _uuid(
            context.get("final_assessment_id"), "Final assessment ID"
        )
        for key, expected in (
            ("work_item_id", selected_work_item_id),
            ("case_id", claim.get("case_id")),
            ("package_job_id", claim.get("package_job_id")),
            ("report_version_id", claim.get("report_version_id")),
            ("source_snapshot_id", claim.get("source_snapshot_id")),
            ("final_assessment_id", claim.get("final_assessment_id")),
        ):
            if context.get(key) != expected:
                raise PackageProcessingContractError(
                    "Report review identity changed after claim"
                )
        source = _mapping(context.get("source_snapshot"), "Source snapshot")
        assessment = _mapping(
            context.get("final_assessment"), "Final assessment"
        )
        report = _mapping(context.get("report"), "Report")
        pdf_validation_manifest = _mapping(
            context.get("validation_manifest"), "PDF validation manifest"
        )
        report_digest = _digest(
            context.get("report_digest"), "Report digest"
        )
        pdf_digest = _digest(context.get("pdf_digest"), "PDF digest")
        deterministic_manifest = build_deterministic_report_validation_manifest(
            source_snapshot_digest=_digest(
                context.get("source_snapshot_digest"),
                "Source snapshot digest",
            ),
            final_assessment_digest=_digest(
                context.get("assessment_digest"),
                "Final assessment digest",
            ),
            report_digest=report_digest,
            pdf_validation_manifest=pdf_validation_manifest,
        )
        locator = {
            "storage_bucket_id": context.get("storage_bucket_id"),
            "storage_object_name": context.get("storage_object_name"),
        }
        with self._database.materialize_total_loss_deliverable(
            case_id,
            report_series_id,
            report_version_id,
            locator,
            str(uuid4()),
        ) as report_path:
            request = build_report_review_input_v1(
                case_id=case_id,
                source_snapshot_id=source_snapshot_id,
                final_assessment_id=final_assessment_id,
                report_version_id=report_version_id,
                source_snapshot=source,
                final_assessment=assessment,
                report=report,
                report_digest=report_digest,
                pdf_digest=pdf_digest,
                pdf_extracted_text=_pdf_text(Path(report_path), pdf_digest),
                deterministic_validation_manifest=deterministic_manifest,
                pdf_validation_manifest=pdf_validation_manifest,
                source_document_included=False,
            )

        configured_model = (
            self._review_configuration.model_identifier or "unconfigured"
        )
        begun = _mapping(
            self._database.begin_total_loss_ai_review(
                selected_work_item_id,
                processing_token,
                REPORT_REVIEW_PROVIDER_IDENTIFIER,
                configured_model,
                REPORT_REVIEW_PROMPT_VERSION,
                REPORT_REVIEW_SCHEMA_VERSION,
                request.input_digest,
            ),
            "AI review start",
        )
        if begun.get("outcome") not in {"created", "existing"}:
            raise PackageStaleFenceError("AI review start fence changed")
        ai_review_run_id = _uuid(
            begun.get("ai_review_run_id"), "AI review run ID"
        )
        review_status = _string(
            begun.get("review_status"), "AI review status"
        )
        if begun.get("outcome") == "created" and review_status != "processing":
            raise PackageProcessingContractError(
                "New AI review is not processing"
            )
        if begun.get("outcome") == "existing" and review_status != "processing":
            if review_status not in {
                "completed",
                "failed",
                "refused",
                "timed_out",
            }:
                raise PackageProcessingContractError(
                    "Existing AI review status is invalid"
                )
            released = self._resolve_release(
                work_item_id=selected_work_item_id,
                processing_token=processing_token,
                ai_review_run_id=ai_review_run_id,
            )
            disposition = _string(
                released.get("disposition"), "Release disposition"
            )
            package_status = released.get("package_status")
            if disposition == "AUTO_RELEASE_NO_DISPUTE_REFUND":
                refunded = self._finish_no_dispute_refund(
                    report_version_id, released
                )
                package_status = refunded.get("package_status")
            return ReportWorkExecutionResult(
                state="completed",
                work_item_id=selected_work_item_id,
                work_type=REPORT_REVIEW_WORK_TYPE,
                package_job_id=package_job_id,
                package_status=package_status,
                attempt_count=_positive_integer(
                    claim.get("attempt_count"), "Report review attempt count"
                ),
                report_version_id=report_version_id,
                ai_review_run_id=ai_review_run_id,
                release_disposition=disposition,
            )
        completed_review: CompletedReportReview | None = None
        review_error: ReportReviewError | None = None
        try:
            if self._reviewer is None:
                raise ReportReviewError(
                    "Report review is not configured",
                    code="REPORT_REVIEW_NOT_CONFIGURED",
                    retryable=False,
                    run_status="failed",
                )
            completed_review = self._reviewer.review(request)
        except ReportReviewError as exc:
            if exc.retryable:
                raise
            review_error = exc

        if review_error is not None:
            completed = _mapping(
                self._database.complete_total_loss_ai_review(
                    selected_work_item_id,
                    processing_token,
                    ai_review_run_id,
                    review_error.run_status,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    review_error.code,
                    None,
                    None,
                ),
                "Failed AI review completion",
            )
            if completed.get("outcome") not in {"completed", "existing"}:
                raise PackageStaleFenceError(
                    "Failed AI review completion fence changed"
                )
            released = self._resolve_release(
                work_item_id=selected_work_item_id,
                processing_token=processing_token,
                ai_review_run_id=ai_review_run_id,
            )
            return ReportWorkExecutionResult(
                state="completed",
                work_item_id=selected_work_item_id,
                work_type=REPORT_REVIEW_WORK_TYPE,
                package_job_id=package_job_id,
                package_status=released.get("package_status"),
                attempt_count=_positive_integer(
                    claim.get("attempt_count"), "Report review attempt count"
                ),
                report_version_id=report_version_id,
                ai_review_run_id=ai_review_run_id,
                release_disposition=released.get("disposition"),
            )

        assert completed_review is not None
        release_row = _mapping(
            self._database.resolve_total_loss_report_release_context(
                selected_work_item_id,
                processing_token,
                ai_review_run_id,
            ),
            "Report release context",
        )
        release_context = self._release_gate_context(release_row, request)
        decision = self._release_gate.evaluate(
            context=release_context,
            request=request,
            completed_review=completed_review,
            configuration=self._review_configuration,
        )
        gate_manifest = self._release_gate_manifest(
            package_job_id=package_job_id,
            work_item_id=selected_work_item_id,
            ai_review_run_id=ai_review_run_id,
            context=release_context,
            request=request,
            completed_review=completed_review,
            decision=decision,
        )
        gate_digest = canonical_package_digest(gate_manifest)
        review_record = completed_review.to_record()
        completed = _mapping(
            self._database.complete_total_loss_ai_review(
                selected_work_item_id,
                processing_token,
                ai_review_run_id,
                "completed",
                completed_review.returned_model_identifier,
                completed_review.review.recommendation,
                completed_review.review.confidence,
                _mapping(review_record.get("reviewResult"), "AI review result"),
                completed_review.output_digest,
                _mapping(review_record.get("usageMetadata"), "AI review usage"),
                None,
                gate_manifest,
                gate_digest,
            ),
            "AI review completion",
        )
        if completed.get("outcome") not in {"completed", "existing"}:
            raise PackageStaleFenceError("AI review completion fence changed")
        released = self._resolve_release(
            work_item_id=selected_work_item_id,
            processing_token=processing_token,
            ai_review_run_id=ai_review_run_id,
        )
        disposition = _string(
            released.get("disposition"), "Release disposition"
        )
        package_status = released.get("package_status")
        if disposition == "AUTO_RELEASE_NO_DISPUTE_REFUND":
            refunded = self._finish_no_dispute_refund(
                report_version_id, released
            )
            package_status = refunded.get("package_status")
        return ReportWorkExecutionResult(
            state="completed",
            work_item_id=selected_work_item_id,
            work_type=REPORT_REVIEW_WORK_TYPE,
            package_job_id=package_job_id,
            package_status=package_status,
            attempt_count=_positive_integer(
                claim.get("attempt_count"), "Report review attempt count"
            ),
            report_version_id=report_version_id,
            ai_review_run_id=ai_review_run_id,
            release_disposition=disposition,
        )


class TotalLossWorkItemProcessor:
    """Route one opaque durable work identity to its fixed processor."""

    def __init__(
        self,
        database: ReportProcessingDatabaseGateway,
        package_processor: TotalLossPackageProcessor,
        report_processor: TotalLossReportProcessor,
        work_coordinator: Any | None = None,
    ) -> None:
        if not isinstance(database, ReportProcessingDatabaseGateway):
            raise TypeError("database must expose report-processing methods")
        if not callable(getattr(package_processor, "execute", None)):
            raise TypeError("package_processor must expose execute")
        if not isinstance(report_processor, TotalLossReportProcessor):
            raise TypeError("report_processor is invalid")
        if work_coordinator is not None and not callable(
            getattr(work_coordinator, "reconcile_due", None)
        ):
            raise TypeError("work_coordinator must expose reconcile_due")
        self._database = database
        self._package_processor = package_processor
        self._report_processor = report_processor
        self._work_coordinator = work_coordinator

    def _dispatch_due_work(self) -> None:
        if self._work_coordinator is not None:
            self._work_coordinator.reconcile_due()

    def execute(
        self, work_item_id: str
    ) -> PackageExecutionResult | ReportWorkExecutionResult:
        selected_work_item_id = _request_uuid(work_item_id, "Work item ID")
        try:
            row = _mapping(
                self._database.resolve_workflow_work_item_kind(
                    selected_work_item_id
                ),
                "Work-item kind",
            )
        except SupabaseUnavailableError as exc:
            raise PackageProcessingUnavailableError(
                "Work-item kind is unavailable"
            ) from exc
        except SupabaseGatewayError as exc:
            raise PackageProcessingContractError(
                "Work-item kind is invalid"
            ) from exc
        if row.get("work_item_id") != selected_work_item_id:
            raise PackageProcessingContractError("Work-item identity changed")
        work_type = row.get("work_type")
        work_version = row.get("work_version")
        if work_type == PACKAGE_WORK_TYPE and work_version == PACKAGE_WORK_VERSION:
            package_result = self._package_processor.execute(selected_work_item_id)
            if (
                package_result.state == "completed"
                and package_result.package_status == "assessment_ready"
                and package_result.package_job_id is not None
            ):
                queued = _mapping(
                    self._database.enqueue_total_loss_report_generation(
                        package_result.package_job_id
                    ),
                    "Report generation enqueue",
                )
                if queued.get("outcome") not in {"created", "existing"}:
                    raise PackageProcessingContractError(
                        "Report generation enqueue is invalid"
                    )
                if queued.get("package_job_id") != package_result.package_job_id:
                    raise PackageProcessingContractError(
                        "Report generation enqueue changed package identity"
                    )
                self._dispatch_due_work()
            return package_result
        if (
            work_type == REPORT_GENERATION_WORK_TYPE
            and work_version == REPORT_WORK_VERSION
        ):
            generation_result = self._report_processor.execute_generation(
                selected_work_item_id
            )
            if generation_result.state == "completed":
                self._dispatch_due_work()
            return generation_result
        if work_type == REPORT_REVIEW_WORK_TYPE and work_version == REPORT_WORK_VERSION:
            return self._report_processor.execute_review(selected_work_item_id)
        raise PackageProcessingContractError("Work-item kind is unsupported")


__all__ = [
    "REPORT_GENERATION_WORK_TYPE",
    "REPORT_MAX_ATTEMPTS",
    "REPORT_REVIEW_WORK_TYPE",
    "REPORT_VALIDATION_VERSION",
    "REPORT_WORK_VERSION",
    "ReportProcessingDatabaseGateway",
    "ReportWorkExecutionResult",
    "TotalLossReportProcessor",
    "TotalLossWorkItemProcessor",
    "build_deterministic_report_validation_manifest",
]
