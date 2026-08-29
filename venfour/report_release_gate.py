"""Pure deterministic release predicate for independently reviewed reports.

The gate returns an intended transition only.  It cannot publish a report,
change a claim, create a refund, or write to storage or the database.  Callers
must apply any allowed transition through a separately fenced transaction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from venfour.package_assessment import canonical_package_digest
from venfour.report_review_evals import (
    ReportReviewEvalAttestationV1,
    ReportReviewEvalError,
    validate_report_review_eval_attestation,
)
from venfour.report_review import (
    MANDATORY_REPORT_REVIEW_CHECK_IDS,
    REPORT_REVIEW_PROMPT_VERSION,
    REPORT_REVIEW_PROVIDER_IDENTIFIER,
    REPORT_REVIEW_SCHEMA_VERSION,
    CompletedReportReview,
    ReportReviewConfiguration,
    ReportReviewError,
    ReportReviewInputV1,
    validate_report_quality_review_v1,
    validate_report_review_input_v1,
)


AUTO_RELEASE_SUPPORTABLE = "AUTO_RELEASE_SUPPORTABLE"
AUTO_RELEASE_NO_DISPUTE_REFUND = "AUTO_RELEASE_NO_DISPUTE_REFUND"
HUMAN_REVIEW = "HUMAN_REVIEW"
NO_ACTION = "NO_ACTION"

_UUID_PATTERN = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
_MODEL_IDENTIFIER_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,254}")
_VERSION_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or _UUID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{label} is invalid")
    parsed = UUID(value)
    if parsed.version != 4 or str(parsed) != value:
        raise ValueError(f"{label} is invalid")
    return value


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{label} is invalid")
    return value


def _model(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or _MODEL_IDENTIFIER_PATTERN.fullmatch(value) is None
    ):
        raise ValueError(f"{label} is invalid")
    return value


def _version(value: Any, label: str) -> str:
    if not isinstance(value, str) or _VERSION_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{label} is invalid")
    return value


@dataclass(frozen=True)
class ReportReleaseGateContext:
    """Authoritative current state reloaded after the AI call completes."""

    case_id: str
    source_snapshot_id: str
    final_assessment_id: str
    report_version_id: str
    source_snapshot_digest: str
    final_assessment_digest: str
    report_digest: str
    pdf_digest: str
    deterministic_validation_digest: str
    pdf_validation_digest: str
    final_continuation_status: str
    report_status: str
    source_validation_passed: bool
    report_json_schema_passed: bool
    deterministic_report_validation_passed: bool
    pdf_validation_passed: bool
    ai_schema_validation_passed: bool
    package_is_current: bool
    report_is_current: bool
    review_is_current: bool
    human_decision_recorded: bool
    provider_evaluation_passed: bool
    provider_evaluation_model_identifier: str | None
    provider_evaluation_prompt_version: str | None
    provider_evaluation_schema_version: str | None
    provider_evaluation_suite_digest: str | None
    provider_evaluation_attestation: ReportReviewEvalAttestationV1 | None = None

    def __post_init__(self) -> None:
        for name in (
            "case_id",
            "source_snapshot_id",
            "final_assessment_id",
            "report_version_id",
        ):
            _uuid(getattr(self, name), name.replace("_", " "))
        for name in (
            "source_snapshot_digest",
            "final_assessment_digest",
            "report_digest",
            "pdf_digest",
            "deterministic_validation_digest",
            "pdf_validation_digest",
        ):
            _digest(getattr(self, name), name.replace("_", " "))
        if self.final_continuation_status not in {
            "SUPPORTS_CONTINUATION",
            "DOES_NOT_SUPPORT_CONTINUATION",
            "REVIEW_REQUIRED",
            "NEW_EVIDENCE_REQUIRED",
        }:
            raise ValueError("final continuation status is invalid")
        if self.report_status not in {
            "draft",
            "reviewing",
            "published",
            "superseded",
        }:
            raise ValueError("report status is invalid")
        for name in (
            "source_validation_passed",
            "report_json_schema_passed",
            "deterministic_report_validation_passed",
            "pdf_validation_passed",
            "ai_schema_validation_passed",
            "package_is_current",
            "report_is_current",
            "review_is_current",
            "human_decision_recorded",
            "provider_evaluation_passed",
        ):
            if not isinstance(getattr(self, name), bool):
                raise TypeError(f"{name} must be boolean")
        optional_values = (
            self.provider_evaluation_model_identifier,
            self.provider_evaluation_prompt_version,
            self.provider_evaluation_schema_version,
            self.provider_evaluation_suite_digest,
        )
        if self.provider_evaluation_passed and any(
            value is None for value in optional_values
        ):
            raise ValueError(
                "provider evaluation attestation is incomplete"
            )
        if self.provider_evaluation_model_identifier is not None:
            _model(
                self.provider_evaluation_model_identifier,
                "provider evaluation model identifier",
            )
        if self.provider_evaluation_prompt_version is not None:
            _version(
                self.provider_evaluation_prompt_version,
                "provider evaluation prompt version",
            )
        if self.provider_evaluation_schema_version is not None:
            _version(
                self.provider_evaluation_schema_version,
                "provider evaluation schema version",
            )
        if self.provider_evaluation_suite_digest is not None:
            _digest(
                self.provider_evaluation_suite_digest,
                "provider evaluation suite digest",
            )
        if self.provider_evaluation_attestation is not None and not isinstance(
            self.provider_evaluation_attestation,
            ReportReviewEvalAttestationV1,
        ):
            raise TypeError(
                "provider_evaluation_attestation must be "
                "ReportReviewEvalAttestationV1"
            )


@dataclass(frozen=True)
class ReportReleaseDecision:
    disposition: str
    publish_report: bool
    refund_with_access_retained: bool
    enqueue_human_review: bool
    reason_codes: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.disposition not in {
            AUTO_RELEASE_SUPPORTABLE,
            AUTO_RELEASE_NO_DISPUTE_REFUND,
            HUMAN_REVIEW,
            NO_ACTION,
        }:
            raise ValueError("release disposition is invalid")
        if not self.reason_codes:
            raise ValueError("release decision requires a reason code")
        if self.disposition == AUTO_RELEASE_SUPPORTABLE and (
            not self.publish_report
            or self.refund_with_access_retained
            or self.enqueue_human_review
        ):
            raise ValueError("supportable release decision is invalid")
        if self.disposition == AUTO_RELEASE_NO_DISPUTE_REFUND and (
            not self.publish_report
            or not self.refund_with_access_retained
            or self.enqueue_human_review
        ):
            raise ValueError("no-dispute release decision is invalid")
        if self.disposition == HUMAN_REVIEW and (
            self.publish_report
            or self.refund_with_access_retained
            or not self.enqueue_human_review
        ):
            raise ValueError("human-review release decision is invalid")
        if self.disposition == NO_ACTION and (
            self.publish_report
            or self.refund_with_access_retained
            or self.enqueue_human_review
        ):
            raise ValueError("no-action release decision is invalid")


def _append_once(reasons: list[str], code: str) -> None:
    if code not in reasons:
        reasons.append(code)


class ReportReleaseGate:
    """Evaluate every release precondition without causing side effects."""

    def evaluate(
        self,
        *,
        context: ReportReleaseGateContext,
        request: ReportReviewInputV1,
        completed_review: CompletedReportReview,
        configuration: ReportReviewConfiguration,
    ) -> ReportReleaseDecision:
        if not isinstance(context, ReportReleaseGateContext):
            raise TypeError("context must be ReportReleaseGateContext")
        if not isinstance(request, ReportReviewInputV1):
            raise TypeError("request must be ReportReviewInputV1")
        if not isinstance(completed_review, CompletedReportReview):
            raise TypeError("completed_review must be CompletedReportReview")
        if not isinstance(configuration, ReportReviewConfiguration):
            raise TypeError("configuration must be ReportReviewConfiguration")

        if context.report_status == "published":
            return ReportReleaseDecision(
                disposition=NO_ACTION,
                publish_report=False,
                refund_with_access_retained=False,
                enqueue_human_review=False,
                reason_codes=("REPORT_ALREADY_PUBLISHED",),
            )
        if (
            context.report_status == "superseded"
            or not context.package_is_current
            or not context.report_is_current
            or not context.review_is_current
        ):
            return ReportReleaseDecision(
                disposition=NO_ACTION,
                publish_report=False,
                refund_with_access_retained=False,
                enqueue_human_review=False,
                reason_codes=("STALE_OR_SUPERSEDED_REVIEW",),
            )
        if context.human_decision_recorded:
            return ReportReleaseDecision(
                disposition=NO_ACTION,
                publish_report=False,
                refund_with_access_retained=False,
                enqueue_human_review=False,
                reason_codes=("HUMAN_DECISION_ALREADY_RECORDED",),
            )

        reasons: list[str] = []
        if not configuration.release_gate_enabled:
            _append_once(reasons, "RELEASE_GATE_DISABLED")
        if not configuration.approval_configuration_complete:
            _append_once(reasons, "RELEASE_APPROVAL_CONFIG_INCOMPLETE")
        if configuration.model_identifier != completed_review.configured_model_identifier:
            _append_once(reasons, "CONFIGURED_MODEL_MISMATCH")
        if completed_review.returned_model_identifier != configuration.model_identifier:
            _append_once(reasons, "RETURNED_MODEL_DRIFT")
        if (
            configuration.approved_model_identifier
            != completed_review.returned_model_identifier
        ):
            _append_once(reasons, "MODEL_NOT_RELEASE_APPROVED")
        if completed_review.provider_identifier != REPORT_REVIEW_PROVIDER_IDENTIFIER:
            _append_once(reasons, "REVIEW_PROVIDER_MISMATCH")
        if completed_review.prompt_version != REPORT_REVIEW_PROMPT_VERSION:
            _append_once(reasons, "REVIEW_PROMPT_VERSION_MISMATCH")
        if completed_review.schema_version != REPORT_REVIEW_SCHEMA_VERSION:
            _append_once(reasons, "REVIEW_SCHEMA_VERSION_MISMATCH")
        if configuration.approved_prompt_version != REPORT_REVIEW_PROMPT_VERSION:
            _append_once(reasons, "PROMPT_NOT_RELEASE_APPROVED")
        if configuration.approved_schema_version != REPORT_REVIEW_SCHEMA_VERSION:
            _append_once(reasons, "SCHEMA_NOT_RELEASE_APPROVED")

        if not context.provider_evaluation_passed:
            _append_once(reasons, "PROVIDER_EVAL_NOT_PASSED")
        attestation = context.provider_evaluation_attestation
        if attestation is None:
            _append_once(reasons, "PROVIDER_EVAL_ATTESTATION_MISSING")
        else:
            try:
                validate_report_review_eval_attestation(
                    attestation.to_dict(),
                    expected_model_identifier=(
                        completed_review.returned_model_identifier
                    ),
                    expected_prompt_version=completed_review.prompt_version,
                    expected_review_schema_version=(
                        completed_review.schema_version
                    ),
                    expected_eval_suite_digest=(
                        configuration.approved_eval_suite_digest
                    ),
                )
            except ReportReviewEvalError:
                _append_once(reasons, "PROVIDER_EVAL_ATTESTATION_INVALID")
            else:
                if not attestation.all_passed:
                    _append_once(reasons, "PROVIDER_EVAL_NOT_PASSED")
        if (
            context.provider_evaluation_model_identifier
            != completed_review.returned_model_identifier
        ):
            _append_once(reasons, "PROVIDER_EVAL_MODEL_MISMATCH")
        if (
            context.provider_evaluation_prompt_version
            != completed_review.prompt_version
        ):
            _append_once(reasons, "PROVIDER_EVAL_PROMPT_MISMATCH")
        if (
            context.provider_evaluation_schema_version
            != completed_review.schema_version
        ):
            _append_once(reasons, "PROVIDER_EVAL_SCHEMA_MISMATCH")
        if (
            context.provider_evaluation_suite_digest
            != configuration.approved_eval_suite_digest
        ):
            _append_once(reasons, "PROVIDER_EVAL_SUITE_MISMATCH")

        deterministic_checks = (
            (context.source_validation_passed, "SOURCE_VALIDATION_FAILED"),
            (
                context.report_json_schema_passed,
                "REPORT_JSON_SCHEMA_VALIDATION_FAILED",
            ),
            (
                context.deterministic_report_validation_passed,
                "REPORT_DETERMINISTIC_VALIDATION_FAILED",
            ),
            (context.pdf_validation_passed, "PDF_VALIDATION_FAILED"),
            (context.ai_schema_validation_passed, "AI_SCHEMA_VALIDATION_FAILED"),
        )
        for passed, code in deterministic_checks:
            if not passed:
                _append_once(reasons, code)

        try:
            validate_report_review_input_v1(request)
            validate_report_quality_review_v1(
                completed_review.review, request=request
            )
        except ReportReviewError:
            _append_once(reasons, "REVIEW_CONTRACT_INVALID")

        target = request.target
        current_target = {
            "caseId": context.case_id,
            "sourceSnapshotId": context.source_snapshot_id,
            "finalAssessmentId": context.final_assessment_id,
            "reportVersionId": context.report_version_id,
        }
        if dict(target) != current_target:
            _append_once(reasons, "REVIEW_TARGET_CHANGED")
        current_digests = {
            "sourceSnapshotDigest": context.source_snapshot_digest,
            "finalAssessmentDigest": context.final_assessment_digest,
            "reportDigest": context.report_digest,
            "pdfDigest": context.pdf_digest,
            "deterministicValidationDigest": (
                context.deterministic_validation_digest
            ),
            "pdfValidationDigest": context.pdf_validation_digest,
        }
        if dict(request.digests) != current_digests:
            _append_once(reasons, "REVIEW_INPUT_DIGESTS_STALE")
        if completed_review.input_digest != request.input_digest:
            _append_once(reasons, "REVIEW_INPUT_DIGEST_MISMATCH")
        if completed_review.output_digest != canonical_package_digest(
            completed_review.review.to_dict()
        ):
            _append_once(reasons, "REVIEW_OUTPUT_DIGEST_MISMATCH")

        review = completed_review.review
        if review.recommendation != "PASS":
            _append_once(reasons, "AI_RECOMMENDED_HUMAN_REVIEW")
        if review.confidence != "HIGH":
            _append_once(reasons, "AI_CONFIDENCE_NOT_HIGH")
        check_ids = [item["checkId"] for item in review.mandatory_checks]
        if (
            set(check_ids) != set(MANDATORY_REPORT_REVIEW_CHECK_IDS)
            or len(check_ids) != len(set(check_ids))
        ):
            _append_once(reasons, "AI_MANDATORY_CHECKS_INCOMPLETE")
        if any(item["status"] != "PASS" for item in review.mandatory_checks):
            _append_once(reasons, "AI_MANDATORY_CHECK_FAILED")
        if any(
            item["severity"] in {"CRITICAL", "HIGH"}
            for item in review.findings
        ):
            _append_once(reasons, "AI_SEVERE_FINDING")
        if review.unsupported_conclusions:
            _append_once(reasons, "AI_UNSUPPORTED_CONCLUSION")
        if review.conflicts:
            _append_once(reasons, "AI_MATERIAL_CONFLICT")
        if review.missing_evidence:
            _append_once(reasons, "AI_MISSING_EVIDENCE")
        source_validation = review.source_reference_validation
        if source_validation["status"] != "PASS" or source_validation[
            "unknownIds"
        ]:
            _append_once(reasons, "AI_SOURCE_REFERENCE_INVALID")
        if request.untrusted_instruction_signals:
            _append_once(reasons, "UNTRUSTED_INSTRUCTION_SIGNAL")
        if review.untrusted_instruction_followed:
            _append_once(reasons, "UNTRUSTED_INSTRUCTION_FOLLOWED")

        if context.final_continuation_status in {
            "REVIEW_REQUIRED",
            "NEW_EVIDENCE_REQUIRED",
        }:
            _append_once(reasons, context.final_continuation_status)
        if reasons:
            return ReportReleaseDecision(
                disposition=HUMAN_REVIEW,
                publish_report=False,
                refund_with_access_retained=False,
                enqueue_human_review=True,
                reason_codes=tuple(reasons),
            )
        if context.final_continuation_status == "SUPPORTS_CONTINUATION":
            return ReportReleaseDecision(
                disposition=AUTO_RELEASE_SUPPORTABLE,
                publish_report=True,
                refund_with_access_retained=False,
                enqueue_human_review=False,
                reason_codes=("ALL_RELEASE_CHECKS_PASSED",),
            )
        if context.final_continuation_status == "DOES_NOT_SUPPORT_CONTINUATION":
            return ReportReleaseDecision(
                disposition=AUTO_RELEASE_NO_DISPUTE_REFUND,
                publish_report=True,
                refund_with_access_retained=True,
                enqueue_human_review=False,
                reason_codes=("ALL_NO_DISPUTE_RELEASE_CHECKS_PASSED",),
            )
        return ReportReleaseDecision(
            disposition=HUMAN_REVIEW,
            publish_report=False,
            refund_with_access_retained=False,
            enqueue_human_review=True,
            reason_codes=("FINAL_CONTINUATION_STATUS_UNSUPPORTED",),
        )


__all__ = [
    "AUTO_RELEASE_NO_DISPUTE_REFUND",
    "AUTO_RELEASE_SUPPORTABLE",
    "HUMAN_REVIEW",
    "NO_ACTION",
    "ReportReleaseDecision",
    "ReportReleaseGate",
    "ReportReleaseGateContext",
]
