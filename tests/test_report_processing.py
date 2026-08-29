from __future__ import annotations

import hashlib
import unittest
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tests import test_report_review as _review_fixture
from tests import test_valuation_evidence_report as _report_fixture
from tests.test_analysis_runs import CONSISTENT_PRICES
from venfour.package_assessment import canonical_package_digest
from venfour.package_processing import (
    PACKAGE_WORK_TYPE,
    PACKAGE_WORK_VERSION,
    PackageExecutionResult,
    PackageProcessingContractError,
    PackageProcessingInputError,
    PackageProcessingUnavailableError,
)
from venfour.report_processing import (
    REPORT_GENERATION_WORK_TYPE,
    REPORT_MAX_ATTEMPTS,
    REPORT_RETRY_DELAY_SECONDS,
    REPORT_REVIEW_WORK_TYPE,
    REPORT_WORK_VERSION,
    ReportWorkExecutionResult,
    TotalLossReportProcessor,
    TotalLossWorkItemProcessor,
)
from venfour.report_release_gate import (
    AUTO_RELEASE_NO_DISPUTE_REFUND,
    AUTO_RELEASE_SUPPORTABLE,
    HUMAN_REVIEW,
    NO_ACTION,
)
from venfour.report_review import (
    REPORT_REVIEW_PROMPT_VERSION,
    REPORT_REVIEW_PROVIDER_IDENTIFIER,
    REPORT_REVIEW_SCHEMA_VERSION,
    CompletedReportReview,
    ReportQualityReviewV1,
    ReportReviewConfiguration,
    ReportReviewOutputError,
    ReportReviewRefusalError,
    ReportReviewTimeoutError,
)
from venfour.report_review_evals import (
    REPORT_REVIEW_EVAL_SCENARIO_IDS,
    build_report_review_eval_attestation_v1,
    report_review_eval_suite_digest,
)
from venfour.supabase_gateway import SupabaseUnavailableError
from venfour.valuation_evidence_report import (
    ValuationEvidenceReportError,
    render_valuation_evidence_report_pdf_v1,
    validate_valuation_evidence_report_pdf_v1,
)


PACKAGE_WORK_ITEM_ID = "00000000-0000-4000-8000-000000000201"
GENERATION_WORK_ITEM_ID = "00000000-0000-4000-8000-000000000202"
REVIEW_WORK_ITEM_ID = "00000000-0000-4000-8000-000000000203"
AI_REVIEW_RUN_ID = "00000000-0000-4000-8000-000000000204"
ORDER_ID = "00000000-0000-4000-8000-000000000205"
PAYMENT_TRANSACTION_ID = "00000000-0000-4000-8000-000000000206"
REFUND_REQUEST_ID = "00000000-0000-4000-8000-000000000207"
REPORT_DOCUMENT_ID = "00000000-0000-4000-8000-000000000208"
REVIEW_MODEL = _review_fixture.REVIEW_MODEL


class _StaticPackageProcessor:
    def __init__(self, result: PackageExecutionResult) -> None:
        self.result = result
        self.work_item_ids: list[str] = []

    def execute(self, work_item_id: str) -> PackageExecutionResult:
        self.work_item_ids.append(work_item_id)
        return self.result


class _FakeReviewer:
    def __init__(
        self,
        *,
        confidence: str = "HIGH",
        error: Exception | None = None,
    ) -> None:
        self.confidence = confidence
        self.error = error
        self.requests: list[Any] = []

    def review(self, request: Any) -> CompletedReportReview:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        payload = _review_fixture.pass_review_payload(
            request,
            confidence=self.confidence,
        )
        review = ReportQualityReviewV1.from_dict(payload, request=request)
        return CompletedReportReview(
            provider_identifier=REPORT_REVIEW_PROVIDER_IDENTIFIER,
            configured_model_identifier=REVIEW_MODEL,
            returned_model_identifier=REVIEW_MODEL,
            prompt_version=REPORT_REVIEW_PROMPT_VERSION,
            schema_version=REPORT_REVIEW_SCHEMA_VERSION,
            input_digest=request.input_digest,
            output_digest=canonical_package_digest(review.to_dict()),
            review=review,
            usage_metadata={"inputTokens": 100, "outputTokens": 50},
        )


class _FakeCommerceService:
    def __init__(
        self,
        *,
        refund_status: str = "succeeded",
        error: Exception | None = None,
    ) -> None:
        self.refund_status = refund_status
        self.error = error
        self.refunds: list[dict[str, Any]] = []

    def refund(self, **kwargs: Any) -> Any:
        self.refunds.append(dict(kwargs))
        if self.error is not None:
            raise self.error
        return SimpleNamespace(refund_status=self.refund_status)


class _FakeReportDatabase:
    def __init__(
        self,
        *,
        source: Any,
        assessment: Any,
        report: Any,
        pdf: bytes,
    ) -> None:
        self.source = source
        self.assessment = assessment
        self.report = report
        self.pdf = pdf
        self.pdf_manifest = validate_valuation_evidence_report_pdf_v1(
            pdf, report
        ).to_dict()
        self.temporary_directory = TemporaryDirectory()

        lineage = source.to_dict()["lineage"]
        self.case_id = lineage["caseId"]
        self.package_job_id = lineage["packageJobId"]
        self.source_snapshot_id = lineage["sourceSnapshotId"]
        self.final_assessment_id = _report_fixture.FINAL_ASSESSMENT_ID
        self.report_series_id = _report_fixture.REPORT_SERIES_ID
        self.report_version_id = _report_fixture.REPORT_VERSION_ID

        self.work_kind = (PACKAGE_WORK_TYPE, PACKAGE_WORK_VERSION)
        self.enqueue_outcomes = ["created"]
        self.enqueues: list[str] = []

        self.generation_claim_outcome = "claimed"
        self.generation_claim_attempt_count = 1
        self.generation_upload_outcome = "created"
        self.generation_upload_error: Exception | None = None
        self.generation_completion_outcome = "completed"
        self.generation_claims: list[tuple[str, str]] = []
        self.generation_contexts: list[tuple[str, str]] = []
        self.uploads: list[dict[str, Any]] = []
        self.generation_completions: list[dict[str, Any]] = []
        self.work_failures: list[dict[str, Any]] = []
        self.failure_result: dict[str, Any] = {
            "outcome": "completed",
            "work_item_id": GENERATION_WORK_ITEM_ID,
            "work_item_status": "terminal_failed",
            "package_job_id": self.package_job_id,
            "package_status": "waiting_human_review",
            "report_version_id": self.report_version_id,
        }

        self.review_claim_outcome = "claimed"
        self.review_claim_attempt_count = 1
        self.review_claim_package_status: str | None = None
        self.review_claim_ai_review_run_id: str | None = None
        self.review_claim_release_disposition: str | None = None
        self.review_claims: list[tuple[str, str]] = []
        self.review_contexts: list[tuple[str, str]] = []
        self.materializations: list[dict[str, Any]] = []
        self.materialization_missing = False
        self.materialization_error: Exception | None = None
        self.ai_review_begins: list[dict[str, Any]] = []
        self.ai_review_begin_result: dict[str, Any] = {
            "outcome": "created",
            "ai_review_run_id": AI_REVIEW_RUN_ID,
            "review_status": "processing",
        }
        self.ai_review_completions: list[dict[str, Any]] = []
        self.release_context_calls: list[tuple[str, str, str]] = []
        self.release_context_overrides: dict[str, Any] = {}
        self.release_calls: list[tuple[str, str, str]] = []
        self.release_result: dict[str, Any] = self._release_result(
            AUTO_RELEASE_SUPPORTABLE,
            package_status="ready",
        )

        self.refund_contexts: list[dict[str, Any]] = []
        self.refund_resolutions: list[str] = []
        self.refund_completions: list[tuple[str, str]] = []
        self.refund_holds: list[tuple[str, str | None]] = []

    def close(self) -> None:
        self.temporary_directory.cleanup()

    def _release_result(
        self,
        disposition: str,
        *,
        package_status: str,
    ) -> dict[str, Any]:
        return {
            "outcome": "completed",
            "disposition": disposition,
            "case_id": self.case_id,
            "package_job_id": self.package_job_id,
            "work_item_id": REVIEW_WORK_ITEM_ID,
            "report_version_id": self.report_version_id,
            "ai_review_run_id": AI_REVIEW_RUN_ID,
            "package_status": package_status,
        }

    def set_release_result(
        self,
        disposition: str,
        *,
        package_status: str,
    ) -> None:
        self.release_result = self._release_result(
            disposition,
            package_status=package_status,
        )

    def configure_refund_recovery(self) -> None:
        common = {
            "case_id": self.case_id,
            "report_version_id": self.report_version_id,
            "package_job_id": self.package_job_id,
            "package_status": "refund_pending",
            "order_id": ORDER_ID,
            "payment_transaction_id": PAYMENT_TRANSACTION_ID,
            "refund_client_request_id": self.report_version_id,
            "access_policy": "retain",
        }
        self.refund_contexts = [
            {
                **common,
                "outcome": "refund_required",
                "refund_request_id": None,
                "refund_status": None,
            },
            {
                **common,
                "outcome": "completion_required",
                "refund_request_id": REFUND_REQUEST_ID,
                "refund_status": "succeeded",
            },
        ]

    def enqueue_total_loss_report_generation(
        self, package_job_id: str
    ) -> Mapping[str, Any]:
        self.enqueues.append(package_job_id)
        outcome = (
            self.enqueue_outcomes.pop(0)
            if len(self.enqueue_outcomes) > 1
            else self.enqueue_outcomes[0]
        )
        return {
            "outcome": outcome,
            "package_job_id": package_job_id,
            "work_item_id": GENERATION_WORK_ITEM_ID,
        }

    def resolve_workflow_work_item_kind(
        self, work_item_id: str
    ) -> Mapping[str, Any]:
        return {
            "work_item_id": work_item_id,
            "work_type": self.work_kind[0],
            "work_version": self.work_kind[1],
        }

    def claim_total_loss_report_generation_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        self.generation_claims.append((work_item_id, processing_token))
        return {
            "outcome": self.generation_claim_outcome,
            "case_id": self.case_id,
            "package_job_id": self.package_job_id,
            "work_item_id": work_item_id,
            "work_item_status": (
                "completed"
                if self.generation_claim_outcome == "completed"
                else "processing"
            ),
            "package_status": (
                "waiting_ai_review"
                if self.generation_claim_outcome == "completed"
                else "report_generating"
            ),
            "attempt_count": self.generation_claim_attempt_count,
            "processing_token": processing_token,
            "report_series_id": self.report_series_id,
            "report_version_id": self.report_version_id,
            "report_version_number": 1,
            "document_id": REPORT_DOCUMENT_ID,
            "storage_bucket_id": "case-deliverables",
            "storage_object_name": (
                f"cases/{self.case_id}/reports/{self.report_series_id}/versions/"
                f"{self.report_version_id}/valuation-evidence-package.pdf"
            ),
            "original_filename": "valuation-evidence-package.pdf",
        }

    def resolve_total_loss_report_generation_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        self.generation_contexts.append((work_item_id, processing_token))
        return {
            "case_id": self.case_id,
            "package_job_id": self.package_job_id,
            "work_item_id": work_item_id,
            "report_series_id": self.report_series_id,
            "report_version_id": self.report_version_id,
            "report_version_number": 1,
            "document_id": REPORT_DOCUMENT_ID,
            "final_assessment_id": self.final_assessment_id,
            "source_snapshot": self.source.to_dict(),
            "final_assessment": self.assessment.to_dict(),
            "generated_at": self.report.to_dict()["identity"]["generatedAt"],
            "storage_bucket_id": "case-deliverables",
            "storage_object_name": (
                f"cases/{self.case_id}/reports/{self.report_series_id}/versions/"
                f"{self.report_version_id}/valuation-evidence-package.pdf"
            ),
            "original_filename": "valuation-evidence-package.pdf",
        }

    def upload_total_loss_deliverable_pdf(
        self,
        case_id: str,
        report_series_id: str,
        report_version_id: str,
        storage_locator: Mapping[str, Any],
        pdf: bytes,
        pdf_digest: str,
    ) -> str:
        self.uploads.append(
            {
                "case_id": case_id,
                "report_series_id": report_series_id,
                "report_version_id": report_version_id,
                "storage_locator": dict(storage_locator),
                "pdf": pdf,
                "pdf_digest": pdf_digest,
            }
        )
        if self.generation_upload_error is not None:
            raise self.generation_upload_error
        return self.generation_upload_outcome

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
    ) -> Mapping[str, Any]:
        self.generation_completions.append(
            {
                "work_item_id": work_item_id,
                "processing_token": processing_token,
                "report": dict(report),
                "report_digest": report_digest,
                "renderer_version": renderer_version,
                "template_version": template_version,
                "schema_version": schema_version,
                "validation_version": validation_version,
                "validation_manifest": dict(validation_manifest),
                "pdf_byte_size": pdf_byte_size,
                "pdf_digest": pdf_digest,
            }
        )
        return {
            "outcome": self.generation_completion_outcome,
            "report_version_id": self.report_version_id,
            "package_status": "waiting_ai_review",
        }

    def fail_total_loss_report_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        failure_code: str,
        failure_kind: str,
        retry_delay_seconds: int,
    ) -> Mapping[str, Any]:
        self.work_failures.append(
            {
                "work_item_id": work_item_id,
                "processing_token": processing_token,
                "failure_code": failure_code,
                "failure_kind": failure_kind,
                "retry_delay_seconds": retry_delay_seconds,
            }
        )
        return self.failure_result

    def claim_total_loss_report_review_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        self.review_claims.append((work_item_id, processing_token))
        return {
            "outcome": self.review_claim_outcome,
            "case_id": self.case_id,
            "package_job_id": self.package_job_id,
            "work_item_id": work_item_id,
            "work_item_status": (
                "completed"
                if self.review_claim_outcome == "completed"
                else "processing"
            ),
            "package_status": self.review_claim_package_status
            or (
                "refund_pending"
                if self.review_claim_outcome == "completed"
                else "waiting_ai_review"
            ),
            "attempt_count": self.review_claim_attempt_count,
            "processing_token": processing_token,
            "report_version_id": self.report_version_id,
            "source_snapshot_id": self.source_snapshot_id,
            "final_assessment_id": self.final_assessment_id,
            "ai_review_run_id": self.review_claim_ai_review_run_id,
            "release_disposition": self.review_claim_release_disposition,
        }

    def resolve_total_loss_report_review_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        self.review_contexts.append((work_item_id, processing_token))
        return {
            "case_id": self.case_id,
            "package_job_id": self.package_job_id,
            "work_item_id": work_item_id,
            "report_series_id": self.report_series_id,
            "report_version_id": self.report_version_id,
            "source_snapshot_id": self.source_snapshot_id,
            "final_assessment_id": self.final_assessment_id,
            "source_snapshot": self.source.to_dict(),
            "source_snapshot_digest": self.source.to_dict()["snapshotDigest"],
            "final_assessment": self.assessment.to_dict(),
            "assessment_digest": self.assessment.to_dict()["assessmentDigest"],
            "report": self.report.to_dict(),
            "report_digest": self.report.to_dict()["reportDigest"],
            "validation_manifest": self.pdf_manifest,
            "pdf_digest": hashlib.sha256(self.pdf).hexdigest(),
            "storage_bucket_id": "case-deliverables",
            "storage_object_name": (
                f"cases/{self.case_id}/reports/{self.report_series_id}/versions/"
                f"{self.report_version_id}/valuation-evidence-package.pdf"
            ),
        }

    @contextmanager
    def materialize_total_loss_deliverable(
        self,
        case_id: str,
        report_series_id: str,
        report_version_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ):
        self.materializations.append(
            {
                "case_id": case_id,
                "report_series_id": report_series_id,
                "report_version_id": report_version_id,
                "storage_locator": dict(storage_locator),
                "cache_nonce": cache_nonce,
            }
        )
        path = Path(self.temporary_directory.name) / f"{cache_nonce}.pdf"
        if self.materialization_error is not None:
            raise self.materialization_error
        if not self.materialization_missing:
            path.write_bytes(self.pdf)
        yield path

    def begin_total_loss_ai_review(
        self,
        work_item_id: str,
        processing_token: str,
        provider_identifier: str,
        configured_model_identifier: str,
        prompt_version: str,
        schema_version: str,
        input_digest: str,
    ) -> Mapping[str, Any]:
        self.ai_review_begins.append(
            {
                "work_item_id": work_item_id,
                "processing_token": processing_token,
                "provider_identifier": provider_identifier,
                "configured_model_identifier": configured_model_identifier,
                "prompt_version": prompt_version,
                "schema_version": schema_version,
                "input_digest": input_digest,
            }
        )
        return self.ai_review_begin_result

    def resolve_total_loss_report_release_context(
        self,
        work_item_id: str,
        processing_token: str,
        ai_review_run_id: str,
    ) -> Mapping[str, Any]:
        self.release_context_calls.append(
            (work_item_id, processing_token, ai_review_run_id)
        )
        row = {
            "case_id": self.case_id,
            "source_snapshot_id": self.source_snapshot_id,
            "final_assessment_id": self.final_assessment_id,
            "report_version_id": self.report_version_id,
            "source_snapshot_digest": self.source.to_dict()["snapshotDigest"],
            "final_assessment_digest": self.assessment.to_dict()[
                "assessmentDigest"
            ],
            "report_digest": self.report.to_dict()["reportDigest"],
            "pdf_digest": hashlib.sha256(self.pdf).hexdigest(),
            "final_continuation_status": self.assessment.to_dict()[
                "continuationStatus"
            ],
            "report_status": "reviewing",
            "source_validation_passed": True,
            "report_json_schema_passed": True,
            "deterministic_report_validation_passed": True,
            "pdf_validation_passed": True,
            "package_is_current": True,
            "report_is_current": True,
            "review_is_current": True,
            "human_decision_recorded": False,
        }
        return {**row, **self.release_context_overrides}

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
    ) -> Mapping[str, Any]:
        self.ai_review_completions.append(
            {
                "work_item_id": work_item_id,
                "processing_token": processing_token,
                "ai_review_run_id": ai_review_run_id,
                "terminal_status": terminal_status,
                "returned_model_identifier": returned_model_identifier,
                "recommendation": recommendation,
                "confidence": confidence,
                "review_result": (
                    dict(review_result) if review_result is not None else None
                ),
                "output_digest": output_digest,
                "usage_metadata": (
                    dict(usage_metadata) if usage_metadata is not None else None
                ),
                "failure_code": failure_code,
                "release_gate_manifest": (
                    dict(release_gate_manifest)
                    if release_gate_manifest is not None
                    else None
                ),
                "release_gate_digest": release_gate_digest,
            }
        )
        return {"outcome": "completed", "ai_review_run_id": ai_review_run_id}

    def resolve_total_loss_report_release(
        self,
        work_item_id: str,
        processing_token: str,
        ai_review_run_id: str,
    ) -> Mapping[str, Any]:
        self.release_calls.append((work_item_id, processing_token, ai_review_run_id))
        return {**self.release_result, "ai_review_run_id": ai_review_run_id}

    def resolve_total_loss_no_dispute_refund(
        self, report_version_id: str
    ) -> Mapping[str, Any]:
        self.refund_resolutions.append(report_version_id)
        if not self.refund_contexts:
            raise AssertionError("refund recovery was not configured")
        if len(self.refund_contexts) > 1:
            return self.refund_contexts.pop(0)
        return self.refund_contexts[0]

    def complete_total_loss_no_dispute_refund(
        self, report_version_id: str, refund_request_id: str
    ) -> Mapping[str, Any]:
        self.refund_completions.append((report_version_id, refund_request_id))
        return {
            "outcome": "completed",
            "case_id": self.case_id,
            "report_version_id": report_version_id,
            "refund_request_id": refund_request_id,
            "package_status": "not_supportable",
            "workflow_task": "no_dispute_resolved",
            "entitlement_status": "refunded_access_retained",
        }

    def hold_total_loss_no_dispute_refund_failure(
        self,
        report_version_id: str,
        refund_request_id: str | None = None,
    ) -> Mapping[str, Any]:
        self.refund_holds.append((report_version_id, refund_request_id))
        return {
            "outcome": "completed",
            "case_id": self.case_id,
            "report_version_id": report_version_id,
            "refund_request_id": refund_request_id or REFUND_REQUEST_ID,
            "refund_status": "failed",
            "package_status": "waiting_human_review",
            "workflow_task": "exception_review",
            "entitlement_status": "active",
        }


class ReportProcessingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        helper = _report_fixture.ValuationEvidenceReportTests(
            "test_projects_complete_report_from_authoritative_contracts"
        )
        helper.setUp()
        cls.fixture_helper = helper
        cls.source, cls.assessment, cls.report = helper._report()
        cls.pdf = render_valuation_evidence_report_pdf_v1(cls.report)
        (
            cls.no_dispute_source,
            cls.no_dispute_assessment,
            cls.no_dispute_report,
        ) = helper._report(prices=CONSISTENT_PRICES)
        cls.no_dispute_pdf = render_valuation_evidence_report_pdf_v1(
            cls.no_dispute_report
        )
        cls.eval_digest = report_review_eval_suite_digest()
        cls.review_configuration = ReportReviewConfiguration(
            model_identifier=REVIEW_MODEL,
            approved_model_identifier=REVIEW_MODEL,
            approved_prompt_version=REPORT_REVIEW_PROMPT_VERSION,
            approved_schema_version=REPORT_REVIEW_SCHEMA_VERSION,
            approved_eval_suite_digest=cls.eval_digest,
            release_gate_enabled=True,
        )
        cls.attestation = build_report_review_eval_attestation_v1(
            returned_model_identifier=REVIEW_MODEL,
            prompt_version=REPORT_REVIEW_PROMPT_VERSION,
            review_schema_version=REPORT_REVIEW_SCHEMA_VERSION,
            eval_suite_digest=cls.eval_digest,
            passed_case_count=len(REPORT_REVIEW_EVAL_SCENARIO_IDS),
            total_case_count=len(REPORT_REVIEW_EVAL_SCENARIO_IDS),
            evaluated_at="2026-08-26T22:00:00Z",
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.fixture_helper.doCleanups()
        super().tearDownClass()

    def _database(self, *, no_dispute: bool = False) -> _FakeReportDatabase:
        if no_dispute:
            database = _FakeReportDatabase(
                source=self.no_dispute_source,
                assessment=self.no_dispute_assessment,
                report=self.no_dispute_report,
                pdf=self.no_dispute_pdf,
            )
        else:
            database = _FakeReportDatabase(
                source=self.source,
                assessment=self.assessment,
                report=self.report,
                pdf=self.pdf,
            )
        self.addCleanup(database.close)
        return database

    def _review_processor(
        self,
        database: _FakeReportDatabase,
        *,
        reviewer: Any | None,
        commerce_service: Any | None = None,
    ) -> TotalLossReportProcessor:
        return TotalLossReportProcessor(
            database,
            reviewer=reviewer,
            review_configuration=self.review_configuration,
            provider_evaluation_attestation=self.attestation.to_dict(),
            commerce_service=commerce_service,
        )

    def test_package_completion_enqueues_generation_idempotently(self) -> None:
        database = self._database()
        database.enqueue_outcomes = ["created", "existing"]
        package_result = PackageExecutionResult(
            state="completed",
            work_item_id=PACKAGE_WORK_ITEM_ID,
            package_job_id=database.package_job_id,
            package_status="assessment_ready",
            attempt_count=1,
            source_snapshot_id=database.source_snapshot_id,
            final_assessment_id=database.final_assessment_id,
        )
        package_processor = _StaticPackageProcessor(package_result)
        report_processor = TotalLossReportProcessor(database)
        processor = TotalLossWorkItemProcessor(
            database,
            package_processor,  # type: ignore[arg-type]
            report_processor,
        )

        first = processor.execute(PACKAGE_WORK_ITEM_ID)
        second = processor.execute(PACKAGE_WORK_ITEM_ID)

        self.assertIs(first, package_result)
        self.assertIs(second, package_result)
        self.assertEqual(
            database.enqueues,
            [database.package_job_id, database.package_job_id],
        )
        self.assertEqual(
            package_processor.work_item_ids,
            [PACKAGE_WORK_ITEM_ID, PACKAGE_WORK_ITEM_ID],
        )

    def test_completed_generation_duplicate_short_circuits(self) -> None:
        database = self._database()
        database.generation_claim_outcome = "completed"

        result = TotalLossReportProcessor(database).execute_generation(
            GENERATION_WORK_ITEM_ID
        )

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.package_status, "waiting_ai_review")
        self.assertEqual(result.report_version_id, database.report_version_id)
        self.assertEqual(database.generation_contexts, [])
        self.assertEqual(database.uploads, [])
        self.assertEqual(database.generation_completions, [])

    def test_generation_accepts_existing_upload_and_completion_replay(self) -> None:
        database = self._database()
        database.generation_upload_outcome = "existing"
        database.generation_completion_outcome = "existing"

        result = TotalLossReportProcessor(database).execute_generation(
            GENERATION_WORK_ITEM_ID
        )

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.package_status, "waiting_ai_review")
        self.assertEqual(len(database.uploads), 1)
        self.assertEqual(len(database.generation_completions), 1)
        self.assertEqual(
            database.uploads[0]["pdf_digest"],
            hashlib.sha256(database.uploads[0]["pdf"]).hexdigest(),
        )

    def test_generation_completes_with_canonical_report_and_pdf(self) -> None:
        database = self._database()

        result = TotalLossReportProcessor(database).execute_generation(
            GENERATION_WORK_ITEM_ID
        )

        self.assertEqual(result.work_type, REPORT_GENERATION_WORK_TYPE)
        self.assertEqual(result.report_version_id, database.report_version_id)
        self.assertEqual(result.attempt_count, 1)
        self.assertEqual(len(database.uploads), 1)
        self.assertEqual(len(database.generation_completions), 1)
        completion = database.generation_completions[0]
        uploaded = database.uploads[0]
        self.assertEqual(completion["report"], self.report.to_dict())
        self.assertEqual(
            completion["report_digest"],
            self.report.to_dict()["reportDigest"],
        )
        self.assertEqual(completion["pdf_digest"], uploaded["pdf_digest"])
        self.assertEqual(completion["pdf_byte_size"], len(uploaded["pdf"]))
        self.assertEqual(completion["validation_manifest"]["status"], "PASS")
        self.assertEqual(
            uploaded["storage_locator"],
            {
                "storage_bucket_id": "case-deliverables",
                "storage_object_name": (
                    f"cases/{database.case_id}/reports/"
                    f"{database.report_series_id}/versions/"
                    f"{database.report_version_id}/"
                    "valuation-evidence-package.pdf"
                ),
            },
        )
        self.assertEqual(
            completion["validation_manifest"]["filename"],
            "valuation-evidence-package.pdf",
        )
        self.assertNotEqual(
            completion["report"]["identity"]["suggestedFilename"],
            completion["validation_manifest"]["filename"],
        )

    def test_generation_rejects_claim_and_context_locator_disagreement(
        self,
    ) -> None:
        database = self._database()
        original_context = database.resolve_total_loss_report_generation_context

        def mismatched_context(
            work_item_id: str, processing_token: str
        ) -> Mapping[str, Any]:
            return {
                **original_context(work_item_id, processing_token),
                "storage_object_name": (
                    f"cases/{database.case_id}/reports/"
                    f"{database.report_series_id}/versions/"
                    f"{database.report_version_id}/different.pdf"
                ),
            }

        database.resolve_total_loss_report_generation_context = mismatched_context  # type: ignore[method-assign]

        result = TotalLossReportProcessor(database).execute_generation(
            GENERATION_WORK_ITEM_ID
        )

        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(database.uploads, [])
        self.assertEqual(
            database.work_failures[0]["failure_code"],
            "REPORT_VALIDATION_FAILED",
        )

    def test_retryable_storage_failure_is_durably_recorded(self) -> None:
        database = self._database()
        database.generation_upload_error = SupabaseUnavailableError(
            "Storage is unavailable"
        )
        database.failure_result = {
            **database.failure_result,
            "work_item_status": "retryable_failed",
            "package_status": "retryable_failed",
        }

        with self.assertRaises(PackageProcessingUnavailableError):
            TotalLossReportProcessor(database).execute_generation(
                GENERATION_WORK_ITEM_ID
            )

        processing_token = database.generation_claims[0][1]
        self.assertEqual(
            database.work_failures,
            [
                {
                    "work_item_id": GENERATION_WORK_ITEM_ID,
                    "processing_token": processing_token,
                    "failure_code": "REPORT_PROCESSING_UNAVAILABLE",
                    "failure_kind": "retryable",
                    "retry_delay_seconds": REPORT_RETRY_DELAY_SECONDS,
                }
            ],
        )
        self.assertEqual(len(database.uploads), 1)
        self.assertEqual(database.generation_completions, [])

    def test_deterministic_validation_failure_is_durably_held(self) -> None:
        database = self._database()

        with patch(
            "venfour.report_processing."
            "validate_valuation_evidence_report_pdf_v1",
            side_effect=ValuationEvidenceReportError(
                "The deterministic PDF validation failed"
            ),
        ):
            result = TotalLossReportProcessor(database).execute_generation(
                GENERATION_WORK_ITEM_ID
            )

        processing_token = database.generation_claims[0][1]
        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(result.package_status, "waiting_human_review")
        self.assertEqual(result.report_version_id, database.report_version_id)
        self.assertEqual(
            database.work_failures,
            [
                {
                    "work_item_id": GENERATION_WORK_ITEM_ID,
                    "processing_token": processing_token,
                    "failure_code": "REPORT_VALIDATION_FAILED",
                    "failure_kind": "human_review_required",
                    "retry_delay_seconds": 0,
                }
            ],
        )
        self.assertEqual(database.uploads, [])
        self.assertEqual(database.generation_completions, [])

    def test_retryable_failure_is_held_after_three_attempts(self) -> None:
        database = self._database()
        database.generation_claim_attempt_count = REPORT_MAX_ATTEMPTS
        database.generation_upload_error = SupabaseUnavailableError(
            "Storage is unavailable"
        )

        result = TotalLossReportProcessor(database).execute_generation(
            GENERATION_WORK_ITEM_ID
        )

        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(result.attempt_count, REPORT_MAX_ATTEMPTS)
        self.assertEqual(
            database.work_failures[0]["failure_code"],
            "REPORT_RETRY_EXHAUSTED",
        )
        self.assertEqual(
            database.work_failures[0]["failure_kind"],
            "human_review_required",
        )
        self.assertEqual(database.work_failures[0]["retry_delay_seconds"], 0)

    def test_programmer_error_is_held_without_retry(self) -> None:
        database = self._database()

        with patch(
            "venfour.report_processing.build_valuation_evidence_report_v1",
            side_effect=RuntimeError("unexpected implementation failure"),
        ):
            result = TotalLossReportProcessor(database).execute_generation(
                GENERATION_WORK_ITEM_ID
            )

        self.assertEqual(result.state, "terminal_failed")
        self.assertEqual(
            database.work_failures[0]["failure_code"],
            "REPORT_PROCESSING_FAILED",
        )
        self.assertEqual(
            database.work_failures[0]["failure_kind"],
            "human_review_required",
        )
        self.assertEqual(database.work_failures[0]["retry_delay_seconds"], 0)

    def test_missing_or_corrupt_private_pdf_is_durably_held(self) -> None:
        for name in ("missing", "corrupt"):
            with self.subTest(name=name):
                database = self._database()
                database.failure_result = {
                    **database.failure_result,
                    "work_item_id": REVIEW_WORK_ITEM_ID,
                    "package_status": "waiting_human_review",
                }
                if name == "missing":
                    database.materialization_missing = True
                else:
                    database.pdf = b"not a PDF"
                reviewer = _FakeReviewer()

                result = self._review_processor(
                    database, reviewer=reviewer
                ).execute_review(REVIEW_WORK_ITEM_ID)

                self.assertEqual(result.state, "human_review_required")
                self.assertEqual(
                    database.work_failures[0]["failure_code"],
                    "REPORT_VALIDATION_FAILED",
                )
                self.assertEqual(
                    database.work_failures[0]["failure_kind"],
                    "human_review_required",
                )
                self.assertEqual(reviewer.requests, [])

    def test_pass_high_review_reaches_supportable_release(self) -> None:
        database = self._database()
        reviewer = _FakeReviewer()
        processor = self._review_processor(database, reviewer=reviewer)

        result = processor.execute_review(REVIEW_WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.package_status, "ready")
        self.assertEqual(result.release_disposition, AUTO_RELEASE_SUPPORTABLE)
        self.assertEqual(len(reviewer.requests), 1)
        self.assertEqual(len(database.ai_review_begins), 1)
        self.assertEqual(len(database.ai_review_completions), 1)
        completion = database.ai_review_completions[0]
        self.assertEqual(completion["terminal_status"], "completed")
        self.assertEqual(completion["recommendation"], "PASS")
        self.assertEqual(completion["confidence"], "HIGH")
        self.assertEqual(
            completion["release_gate_manifest"]["disposition"],
            AUTO_RELEASE_SUPPORTABLE,
        )
        self.assertEqual(
            completion["release_gate_manifest"]["reasonCodes"],
            ["ALL_RELEASE_CHECKS_PASSED"],
        )
        self.assertEqual(
            completion["release_gate_digest"],
            canonical_package_digest(completion["release_gate_manifest"]),
        )

    def test_unconfigured_reviewer_persists_failure_and_routes_human_review(
        self,
    ) -> None:
        database = self._database()
        database.set_release_result(HUMAN_REVIEW, package_status="waiting_human_review")
        processor = TotalLossReportProcessor(database)

        result = processor.execute_review(REVIEW_WORK_ITEM_ID)

        self.assertEqual(result.release_disposition, HUMAN_REVIEW)
        self.assertEqual(result.package_status, "waiting_human_review")
        self.assertEqual(
            database.ai_review_begins[0]["configured_model_identifier"],
            "unconfigured",
        )
        completion = database.ai_review_completions[0]
        self.assertEqual(completion["terminal_status"], "failed")
        self.assertEqual(completion["failure_code"], "REPORT_REVIEW_NOT_CONFIGURED")
        self.assertIsNone(completion["release_gate_manifest"])
        self.assertEqual(database.release_context_calls, [])

    def test_malformed_medium_and_refusal_fail_closed(self) -> None:
        cases = (
            (
                "malformed",
                _FakeReviewer(error=ReportReviewOutputError("malformed output")),
                "failed",
                "REPORT_REVIEW_OUTPUT_INVALID",
            ),
            ("medium", _FakeReviewer(confidence="MEDIUM"), "completed", None),
            (
                "refusal",
                _FakeReviewer(error=ReportReviewRefusalError()),
                "refused",
                "REPORT_REVIEW_REFUSED",
            ),
        )
        for name, reviewer, terminal_status, failure_code in cases:
            with self.subTest(name=name):
                database = self._database()
                database.set_release_result(
                    HUMAN_REVIEW,
                    package_status="waiting_human_review",
                )
                result = self._review_processor(
                    database,
                    reviewer=reviewer,
                ).execute_review(REVIEW_WORK_ITEM_ID)

                self.assertEqual(result.release_disposition, HUMAN_REVIEW)
                self.assertEqual(result.package_status, "waiting_human_review")
                completion = database.ai_review_completions[0]
                self.assertEqual(completion["terminal_status"], terminal_status)
                self.assertEqual(completion["failure_code"], failure_code)
                if name == "medium":
                    self.assertEqual(
                        completion["release_gate_manifest"]["disposition"],
                        HUMAN_REVIEW,
                    )
                    self.assertIn(
                        "AI_CONFIDENCE_NOT_HIGH",
                        completion["release_gate_manifest"]["reasonCodes"],
                    )
                else:
                    self.assertIsNone(completion["release_gate_manifest"])

    def test_retryable_review_timeout_retries_twice_then_holds(self) -> None:
        for attempt_count in (1, REPORT_MAX_ATTEMPTS):
            with self.subTest(attempt_count=attempt_count):
                database = self._database()
                database.review_claim_attempt_count = attempt_count
                database.failure_result = {
                    **database.failure_result,
                    "work_item_id": REVIEW_WORK_ITEM_ID,
                    "work_item_status": (
                        "retryable_failed"
                        if attempt_count < REPORT_MAX_ATTEMPTS
                        else "terminal_failed"
                    ),
                    "package_status": (
                        "retryable_failed"
                        if attempt_count < REPORT_MAX_ATTEMPTS
                        else "waiting_human_review"
                    ),
                }
                reviewer = _FakeReviewer(error=ReportReviewTimeoutError())
                processor = self._review_processor(
                    database, reviewer=reviewer
                )

                if attempt_count < REPORT_MAX_ATTEMPTS:
                    with self.assertRaises(PackageProcessingUnavailableError):
                        processor.execute_review(REVIEW_WORK_ITEM_ID)
                else:
                    result = processor.execute_review(REVIEW_WORK_ITEM_ID)
                    self.assertEqual(result.state, "human_review_required")
                    self.assertEqual(
                        result.package_status, "waiting_human_review"
                    )

                failure = database.work_failures[0]
                self.assertEqual(
                    failure["failure_code"],
                    (
                        "REPORT_REVIEW_TIMEOUT"
                        if attempt_count < REPORT_MAX_ATTEMPTS
                        else "REPORT_RETRY_EXHAUSTED"
                    ),
                )
                self.assertEqual(
                    failure["failure_kind"],
                    (
                        "retryable"
                        if attempt_count < REPORT_MAX_ATTEMPTS
                        else "human_review_required"
                    ),
                )
                self.assertEqual(len(reviewer.requests), 1)
                self.assertEqual(database.ai_review_completions, [])

    def test_completed_logical_ai_run_resumes_release_without_provider(self) -> None:
        database = self._database()
        database.ai_review_begin_result = {
            "outcome": "existing",
            "ai_review_run_id": AI_REVIEW_RUN_ID,
            "review_status": "completed",
        }
        reviewer = _FakeReviewer()

        result = self._review_processor(
            database, reviewer=reviewer
        ).execute_review(REVIEW_WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.ai_review_run_id, AI_REVIEW_RUN_ID)
        self.assertEqual(result.release_disposition, AUTO_RELEASE_SUPPORTABLE)
        self.assertEqual(reviewer.requests, [])
        self.assertEqual(database.release_context_calls, [])
        self.assertEqual(database.ai_review_completions, [])
        self.assertEqual(
            database.release_calls,
            [
                (
                    REVIEW_WORK_ITEM_ID,
                    database.review_claims[0][1],
                    AI_REVIEW_RUN_ID,
                )
            ],
        )

    def test_duplicate_terminal_review_retains_ai_identity_and_disposition(
        self,
    ) -> None:
        database = self._database()
        database.review_claim_outcome = "completed"
        database.review_claim_package_status = "ready"
        database.review_claim_ai_review_run_id = AI_REVIEW_RUN_ID
        database.review_claim_release_disposition = AUTO_RELEASE_SUPPORTABLE

        result = TotalLossReportProcessor(database).execute_review(
            REVIEW_WORK_ITEM_ID
        )

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.ai_review_run_id, AI_REVIEW_RUN_ID)
        self.assertEqual(result.release_disposition, AUTO_RELEASE_SUPPORTABLE)
        self.assertEqual(result.package_status, "ready")
        self.assertEqual(database.review_contexts, [])
        self.assertEqual(database.ai_review_begins, [])

    def test_stale_or_superseded_review_records_no_action(self) -> None:
        cases = (
            ("stale", {"package_is_current": False}),
            ("superseded", {"report_status": "superseded"}),
        )
        for name, overrides in cases:
            with self.subTest(name=name):
                database = self._database()
                database.release_context_overrides = overrides
                database.set_release_result(
                    NO_ACTION,
                    package_status="waiting_ai_review",
                )
                result = self._review_processor(
                    database,
                    reviewer=_FakeReviewer(),
                ).execute_review(REVIEW_WORK_ITEM_ID)

                self.assertEqual(result.release_disposition, NO_ACTION)
                manifest = database.ai_review_completions[0][
                    "release_gate_manifest"
                ]
                self.assertEqual(manifest["disposition"], NO_ACTION)
                self.assertEqual(
                    manifest["reasonCodes"],
                    ["STALE_OR_SUPERSEDED_REVIEW"],
                )

    def test_no_dispute_release_refunds_and_completes_resolution(self) -> None:
        database = self._database(no_dispute=True)
        database.set_release_result(
            AUTO_RELEASE_NO_DISPUTE_REFUND,
            package_status="refund_pending",
        )
        database.release_result.update(
            {
                "order_id": ORDER_ID,
                "payment_transaction_id": PAYMENT_TRANSACTION_ID,
                "refund_client_request_id": database.report_version_id,
            }
        )
        database.configure_refund_recovery()
        commerce = _FakeCommerceService()

        result = self._review_processor(
            database,
            reviewer=_FakeReviewer(),
            commerce_service=commerce,
        ).execute_review(REVIEW_WORK_ITEM_ID)

        self.assertEqual(
            result.release_disposition,
            AUTO_RELEASE_NO_DISPUTE_REFUND,
        )
        self.assertEqual(result.package_status, "not_supportable")
        self.assertEqual(
            commerce.refunds,
            [
                {
                    "case_id": database.case_id,
                    "order_id": ORDER_ID,
                    "payment_transaction_id": PAYMENT_TRANSACTION_ID,
                    "client_request_id": database.report_version_id,
                    "reason_code": "NO_MATERIAL_DISPUTE_SUPPORTED",
                    "access_policy": "retain",
                }
            ],
        )
        self.assertEqual(
            database.refund_completions,
            [(database.report_version_id, REFUND_REQUEST_ID)],
        )

    def test_completed_review_resumes_refund_pending_idempotently(self) -> None:
        database = self._database(no_dispute=True)
        database.review_claim_outcome = "completed"
        database.review_claim_ai_review_run_id = AI_REVIEW_RUN_ID
        database.review_claim_release_disposition = (
            AUTO_RELEASE_NO_DISPUTE_REFUND
        )
        database.configure_refund_recovery()
        commerce = _FakeCommerceService()
        processor = TotalLossReportProcessor(
            database,
            commerce_service=commerce,
        )

        result = processor.execute_review(REVIEW_WORK_ITEM_ID)

        self.assertEqual(result.state, "completed")
        self.assertEqual(result.package_status, "not_supportable")
        self.assertEqual(
            result.release_disposition,
            AUTO_RELEASE_NO_DISPUTE_REFUND,
        )
        self.assertEqual(result.ai_review_run_id, AI_REVIEW_RUN_ID)
        self.assertEqual(len(commerce.refunds), 1)
        self.assertEqual(
            database.refund_completions,
            [(database.report_version_id, REFUND_REQUEST_ID)],
        )
        self.assertEqual(database.review_contexts, [])
        self.assertEqual(database.ai_review_begins, [])

    def test_public_refund_resume_validates_id_and_converges(self) -> None:
        database = self._database(no_dispute=True)
        database.configure_refund_recovery()
        processor = TotalLossReportProcessor(
            database,
            commerce_service=_FakeCommerceService(),
        )

        completed = processor.resume_no_dispute_refund(
            database.report_version_id
        )

        self.assertEqual(completed["outcome"], "completed")
        self.assertEqual(completed["package_status"], "not_supportable")
        self.assertEqual(
            database.refund_completions,
            [(database.report_version_id, REFUND_REQUEST_ID)],
        )
        with self.assertRaises(PackageProcessingInputError):
            processor.resume_no_dispute_refund("not-a-report-id")

    def test_terminal_refund_failure_routes_to_human_remediation(self) -> None:
        for refund_status in ("failed", "canceled"):
            with self.subTest(refund_status=refund_status):
                database = self._database(no_dispute=True)
                database.refund_contexts = [
                    {
                        "outcome": "human_review_required",
                        "case_id": database.case_id,
                        "report_version_id": database.report_version_id,
                        "package_job_id": database.package_job_id,
                        "package_status": "refund_pending",
                        "order_id": ORDER_ID,
                        "payment_transaction_id": PAYMENT_TRANSACTION_ID,
                        "refund_client_request_id": database.report_version_id,
                        "refund_request_id": REFUND_REQUEST_ID,
                        "refund_status": refund_status,
                        "access_policy": "retain",
                    }
                ]

                held = TotalLossReportProcessor(
                    database,
                    commerce_service=_FakeCommerceService(),
                ).resume_no_dispute_refund(database.report_version_id)

                self.assertEqual(held["outcome"], "completed")
                self.assertEqual(
                    held["package_status"], "waiting_human_review"
                )
                self.assertEqual(
                    database.refund_holds,
                    [(database.report_version_id, REFUND_REQUEST_ID)],
                )
                self.assertEqual(database.refund_completions, [])

    def test_refund_terminal_or_contract_result_is_not_left_pending(self) -> None:
        cases = (
            ("failed", None),
            ("canceled", None),
            ("invalid", None),
            ("exception", RuntimeError("unexpected refund contract")),
        )
        for name, error in cases:
            with self.subTest(name=name):
                database = self._database(no_dispute=True)
                database.configure_refund_recovery()
                commerce = _FakeCommerceService(
                    refund_status=name,
                    error=error,
                )

                held = TotalLossReportProcessor(
                    database,
                    commerce_service=commerce,
                ).resume_no_dispute_refund(database.report_version_id)

                self.assertEqual(
                    held["package_status"], "waiting_human_review"
                )
                self.assertEqual(
                    database.refund_holds,
                    [(database.report_version_id, None)],
                )
                self.assertEqual(database.refund_completions, [])

    def test_nonterminal_refund_result_remains_explicitly_retryable(self) -> None:
        for refund_status in ("creating", "pending"):
            with self.subTest(refund_status=refund_status):
                database = self._database(no_dispute=True)
                database.configure_refund_recovery()
                processor = TotalLossReportProcessor(
                    database,
                    commerce_service=_FakeCommerceService(
                        refund_status=refund_status
                    ),
                )

                with self.assertRaises(PackageProcessingUnavailableError):
                    processor.resume_no_dispute_refund(
                        database.report_version_id
                    )

                self.assertEqual(database.refund_holds, [])
                self.assertEqual(database.refund_completions, [])

    def test_generic_router_dispatches_report_kinds_and_rejects_unknown_kind(
        self,
    ) -> None:
        database = self._database()
        package_processor = _StaticPackageProcessor(
            PackageExecutionResult(
                state="completed",
                work_item_id=PACKAGE_WORK_ITEM_ID,
                package_job_id=database.package_job_id,
                package_status="ready",
            )
        )
        report_processor = TotalLossReportProcessor(database)
        processor = TotalLossWorkItemProcessor(
            database,
            package_processor,  # type: ignore[arg-type]
            report_processor,
        )
        generation_result = ReportWorkExecutionResult(
            state="completed",
            work_item_id=GENERATION_WORK_ITEM_ID,
            work_type=REPORT_GENERATION_WORK_TYPE,
        )
        review_result = ReportWorkExecutionResult(
            state="completed",
            work_item_id=REVIEW_WORK_ITEM_ID,
            work_type=REPORT_REVIEW_WORK_TYPE,
        )

        with patch.object(
            report_processor,
            "execute_generation",
            return_value=generation_result,
        ) as execute_generation, patch.object(
            report_processor,
            "execute_review",
            return_value=review_result,
        ) as execute_review:
            database.work_kind = (
                REPORT_GENERATION_WORK_TYPE,
                REPORT_WORK_VERSION,
            )
            self.assertIs(
                processor.execute(GENERATION_WORK_ITEM_ID),
                generation_result,
            )
            database.work_kind = (REPORT_REVIEW_WORK_TYPE, REPORT_WORK_VERSION)
            self.assertIs(processor.execute(REVIEW_WORK_ITEM_ID), review_result)

        execute_generation.assert_called_once_with(GENERATION_WORK_ITEM_ID)
        execute_review.assert_called_once_with(REVIEW_WORK_ITEM_ID)

        for work_type, work_version in (
            ("unknown_work", REPORT_WORK_VERSION),
            (REPORT_GENERATION_WORK_TYPE, "2"),
        ):
            with self.subTest(work_type=work_type, work_version=work_version):
                database.work_kind = (work_type, work_version)
                with self.assertRaises(PackageProcessingContractError):
                    processor.execute(GENERATION_WORK_ITEM_ID)


if __name__ == "__main__":
    unittest.main()
