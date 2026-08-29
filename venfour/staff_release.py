"""Staff-only application boundary for Total-Loss release exceptions.

Supabase remains authoritative for staff membership, optimistic concurrency,
and every lifecycle mutation.  This module validates the bounded HTTP-facing
contract, projects only review-safe fields, and resumes the durable work that a
successful database decision makes eligible.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, runtime_checkable
from uuid import UUID

from venfour.package_processing import (
    PackageProcessingContractError,
    PackageProcessingUnavailableError,
)
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseContractError,
    SupabaseGatewayError,
    SupabaseUnavailableError,
)


APPROVE_UNCHANGED = "approve_unchanged"
REQUEST_REVISION = "request_revision"
NOT_SUPPORTABLE = "not_supportable"
NEW_EVIDENCE_REQUIRED = "new_evidence_required"

STAFF_RELEASE_DECISIONS = frozenset(
    {
        APPROVE_UNCHANGED,
        REQUEST_REVISION,
        NOT_SUPPORTABLE,
        NEW_EVIDENCE_REQUIRED,
    }
)

MAX_STAFF_RELEASE_RATIONALE_CHARACTERS = 4000
MAX_STAFF_RELEASE_PACKET_BYTES = 2 * 1024 * 1024
MAX_STAFF_ACCESS_TOKEN_CHARACTERS = 8192

_PUBLIC_TO_DATABASE_DECISION = {
    APPROVE_UNCHANGED: "approved",
    REQUEST_REVISION: "revision_requested",
    NOT_SUPPORTABLE: "not_supportable",
    NEW_EVIDENCE_REQUIRED: "new_evidence_required",
}
_DATABASE_TO_PUBLIC_DECISION = {
    value: key for key, value in _PUBLIC_TO_DATABASE_DECISION.items()
}
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_REVIEW_STATUSES = frozenset({"queued", "in_review", "resolved", "cancelled"})
_REPORT_STATUSES = frozenset(
    {
        "draft",
        "generated",
        "validated",
        "reviewing",
        "human_review_required",
        "published",
        "superseded",
        "failed",
    }
)
_PACKAGE_STATUSES = frozenset(
    {
        "queued",
        "processing",
        "source_frozen",
        "assessment_ready",
        "report_generating",
        "waiting_ai_review",
        "waiting_human_review",
        "refund_pending",
        "review_required",
        "ready",
        "not_supportable",
        "new_evidence_required",
        "retryable_failed",
        "failed",
    }
)
_FAILURE_STAGES = frozenset(
    {"report_generation", "report_review", "ai_review", "release_gate"}
)
_ARTIFACT_AVAILABILITY_KEYS = frozenset(
    {
        "report",
        "validationManifest",
        "pdf",
        "aiReview",
        "reviewResult",
        "releaseGateManifest",
    }
)
_FAILURE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class StaffReleaseError(Exception):
    """Base class for neutral staff-release application failures."""


class StaffReleaseInputError(StaffReleaseError):
    """The caller supplied a malformed or unbounded command."""


class StaffReleaseNotFoundError(StaffReleaseError):
    """No staff-authorized review packet was returned."""


class StaffReleaseConflictError(StaffReleaseError):
    """The release review changed before the requested decision."""


class StaffReleaseUnavailableError(StaffReleaseError):
    """A required durable dependency could not safely make progress."""


class StaffReleaseContractError(StaffReleaseError):
    """A trusted dependency returned an invalid release-review contract."""


@runtime_checkable
class StaffReleaseReviewGateway(Protocol):
    def get_total_loss_release_review(
        self, release_review_id: str, access_token: str
    ) -> Mapping[str, Any] | None: ...

    def decide_total_loss_release_review(
        self,
        release_review_id: str,
        expected_updated_at: str,
        decision: str,
        rationale: str,
        access_token: str,
    ) -> Mapping[str, Any]: ...


@runtime_checkable
class StaffReleaseWorkCoordinator(Protocol):
    def reconcile_due(self) -> Any: ...


@runtime_checkable
class NoDisputeRefundRecovery(Protocol):
    def resume_no_dispute_refund(
        self, report_version_id: str
    ) -> Mapping[str, Any]: ...


def _uuid4(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise StaffReleaseInputError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise StaffReleaseInputError(f"{label} is invalid") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise StaffReleaseInputError(f"{label} is invalid")
    return value


def _access_token(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= MAX_STAFF_ACCESS_TOKEN_CHARACTERS
        or value != value.strip()
        or any(
            character.isspace() or not 33 <= ord(character) <= 126
            for character in value
        )
    ):
        raise SupabaseAuthenticationError("Authentication is invalid")
    return value


def _contract_uuid4(value: Any, label: str) -> str:
    try:
        return _uuid4(value, label)
    except StaffReleaseInputError as exc:
        raise StaffReleaseContractError(f"{label} is invalid") from exc


def _optional_contract_uuid4(value: Any, label: str) -> str | None:
    if value is None:
        return None
    return _contract_uuid4(value, label)


def _timestamp(value: Any, label: str, *, input_value: bool = False) -> str:
    error_type = StaffReleaseInputError if input_value else StaffReleaseContractError
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 64
        or value != value.strip()
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise error_type(f"{label} is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise error_type(f"{label} is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise error_type(f"{label} is invalid")
    return value


def _optional_timestamp(value: Any, label: str) -> str | None:
    if value is None:
        return None
    return _timestamp(value, label)


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        raise StaffReleaseContractError(f"{label} is invalid")
    return value


def _optional_digest(value: Any, label: str) -> str | None:
    if value is None:
        return None
    return _digest(value, label)


def _choice(value: Any, choices: frozenset[str], label: str) -> str:
    if not isinstance(value, str) or value not in choices:
        raise StaffReleaseContractError(f"{label} is invalid")
    return value


def _optional_text(value: Any, label: str, maximum: int) -> str | None:
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= maximum
        or value != value.strip()
        or any(ord(character) < 32 and character not in "\n\r\t" for character in value)
        or chr(127) in value
    ):
        raise StaffReleaseContractError(f"{label} is invalid")
    return value


def _json_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise StaffReleaseContractError(f"{label} is invalid")
    try:
        encoded = json.dumps(
            dict(value),
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(encoded) > MAX_STAFF_RELEASE_PACKET_BYTES:
            raise ValueError("JSON object is too large")
        decoded = json.loads(encoded)
    except (TypeError, ValueError, UnicodeError) as exc:
        raise StaffReleaseContractError(f"{label} is invalid") from exc
    if not isinstance(decoded, dict):
        raise StaffReleaseContractError(f"{label} is invalid")
    return decoded


def _optional_json_object(value: Any, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    return _json_object(value, label)


def _optional_database_decision(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or value not in _DATABASE_TO_PUBLIC_DECISION:
        raise StaffReleaseContractError("Release review decision is invalid")
    return _DATABASE_TO_PUBLIC_DECISION[value]


def _optional_failure_code(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or _FAILURE_CODE.fullmatch(value) is None:
        raise StaffReleaseContractError("Release review failure code is invalid")
    return value


def _artifact_availability(value: Any) -> dict[str, bool]:
    if not isinstance(value, Mapping) or set(value) != _ARTIFACT_AVAILABILITY_KEYS:
        raise StaffReleaseContractError("Artifact availability is invalid")
    selected = dict(value)
    if any(not isinstance(item, bool) for item in selected.values()):
        raise StaffReleaseContractError("Artifact availability is invalid")
    return selected


@dataclass(frozen=True)
class StaffReleaseReview:
    release_review_id: str
    case_id: str
    review_status: str
    assigned_staff_user_id: str | None
    decision: str | None
    rationale: str | None
    due_at: str | None
    resolved_at: str | None
    updated_at: str
    ai_review_run_id: str | None
    report_version_id: str
    resulting_report_version_id: str | None
    report_status: str
    report: Mapping[str, Any] | None
    report_digest: str | None
    validation_manifest: Mapping[str, Any] | None
    pdf_digest: str | None
    source_snapshot_id: str
    source_snapshot_digest: str
    final_assessment_id: str
    assessment_digest: str
    final_assessment: Mapping[str, Any]
    review_result: Mapping[str, Any] | None
    release_gate_manifest: Mapping[str, Any] | None
    failure_stage: str | None
    failure_code: str | None
    artifact_availability: Mapping[str, bool]

    def to_dict(self) -> dict[str, Any]:
        return {
            "releaseReviewId": self.release_review_id,
            "caseId": self.case_id,
            "reviewStatus": self.review_status,
            "assignedStaffUserId": self.assigned_staff_user_id,
            "decision": self.decision,
            "rationale": self.rationale,
            "dueAt": self.due_at,
            "resolvedAt": self.resolved_at,
            "updatedAt": self.updated_at,
            "aiReviewRunId": self.ai_review_run_id,
            "reportVersionId": self.report_version_id,
            "resultingReportVersionId": self.resulting_report_version_id,
            "reportStatus": self.report_status,
            "report": dict(self.report) if self.report is not None else None,
            "reportDigest": self.report_digest,
            "validationManifest": (
                dict(self.validation_manifest)
                if self.validation_manifest is not None
                else None
            ),
            "pdfDigest": self.pdf_digest,
            "sourceSnapshotId": self.source_snapshot_id,
            "sourceSnapshotDigest": self.source_snapshot_digest,
            "finalAssessmentId": self.final_assessment_id,
            "assessmentDigest": self.assessment_digest,
            "finalAssessment": dict(self.final_assessment),
            "reviewResult": (
                dict(self.review_result)
                if self.review_result is not None
                else None
            ),
            "releaseGateManifest": (
                dict(self.release_gate_manifest)
                if self.release_gate_manifest is not None
                else None
            ),
            "failureStage": self.failure_stage,
            "failureCode": self.failure_code,
            "artifactAvailability": dict(self.artifact_availability),
        }


@dataclass(frozen=True)
class StaffReleaseDecision:
    outcome: str
    release_review_id: str
    case_id: str
    decision: str
    report_version_id: str
    resulting_report_version_id: str | None
    report_status: str
    package_status: str
    workflow_task: str
    generation_work_item_id: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome,
            "releaseReviewId": self.release_review_id,
            "caseId": self.case_id,
            "decision": self.decision,
            "reportVersionId": self.report_version_id,
            "resultingReportVersionId": self.resulting_report_version_id,
            "reportStatus": self.report_status,
            "packageStatus": self.package_status,
            "workflowTask": self.workflow_task,
            "generationWorkItemId": self.generation_work_item_id,
        }


class StaffReleaseReviewService:
    """Expose DB-authorized release reviews and converge decision side effects."""

    def __init__(
        self,
        gateway: StaffReleaseReviewGateway,
        *,
        work_coordinator: StaffReleaseWorkCoordinator | None = None,
        refund_recovery: NoDisputeRefundRecovery | None = None,
    ) -> None:
        if not isinstance(gateway, StaffReleaseReviewGateway):
            raise TypeError("gateway must expose staff release-review RPCs")
        if work_coordinator is not None and not isinstance(
            work_coordinator, StaffReleaseWorkCoordinator
        ):
            raise TypeError("work_coordinator must expose reconcile_due")
        if refund_recovery is not None and not isinstance(
            refund_recovery, NoDisputeRefundRecovery
        ):
            raise TypeError(
                "refund_recovery must expose resume_no_dispute_refund"
            )
        self._gateway = gateway
        self._work_coordinator = work_coordinator
        self._refund_recovery = refund_recovery

    @staticmethod
    def _translate_dependency_error(exc: Exception) -> Exception:
        if isinstance(exc, SupabaseAuthenticationError):
            return SupabaseAuthenticationError("Authentication is invalid")
        if isinstance(
            exc,
            (
                SupabaseUnavailableError,
                PackageProcessingUnavailableError,
                OSError,
            ),
        ):
            return StaffReleaseUnavailableError(
                "Staff release review is temporarily unavailable"
            )
        if isinstance(
            exc,
            (
                SupabaseContractError,
                PackageProcessingContractError,
            ),
        ):
            return StaffReleaseContractError(
                "Staff release dependency returned an invalid contract"
            )
        if isinstance(exc, SupabaseGatewayError):
            return StaffReleaseUnavailableError(
                "Staff release review is temporarily unavailable"
            )
        if isinstance(exc, StaffReleaseInputError):
            return StaffReleaseInputError(str(exc))
        if isinstance(exc, StaffReleaseNotFoundError):
            return StaffReleaseNotFoundError(str(exc))
        if isinstance(exc, StaffReleaseConflictError):
            return StaffReleaseConflictError(str(exc))
        if isinstance(exc, StaffReleaseContractError):
            return StaffReleaseContractError(str(exc))
        if isinstance(exc, StaffReleaseUnavailableError):
            return StaffReleaseUnavailableError(str(exc))
        return StaffReleaseUnavailableError(
            "Staff release review is temporarily unavailable"
        )

    def get_review(
        self, release_review_id: str, access_token: str
    ) -> StaffReleaseReview:
        selected_review_id = _uuid4(
            release_review_id, "Release review ID"
        )
        selected_access_token = _access_token(access_token)
        try:
            row = self._gateway.get_total_loss_release_review(
                selected_review_id, selected_access_token
            )
        except Exception as exc:
            translated = self._translate_dependency_error(exc)
            raise translated from exc
        if row is None:
            raise StaffReleaseNotFoundError("Release review was not found")
        if not isinstance(row, Mapping):
            raise StaffReleaseContractError("Release review is invalid")
        if row.get("release_review_id") != selected_review_id:
            raise StaffReleaseContractError(
                "Release review identity changed"
            )
        ai_review_run_id = _optional_contract_uuid4(
            row.get("ai_review_run_id"), "AI review run ID"
        )
        resulting_report_version_id = _optional_contract_uuid4(
            row.get("resulting_report_version_id"),
            "Resulting report version ID",
        )
        report = _optional_json_object(row.get("report"), "Report")
        report_digest = _optional_digest(
            row.get("report_digest"), "Report digest"
        )
        validation_manifest = _optional_json_object(
            row.get("validation_manifest"), "Validation manifest"
        )
        pdf_digest = _optional_digest(row.get("pdf_digest"), "PDF digest")
        review_result = _optional_json_object(
            row.get("review_result"), "Review result"
        )
        release_gate_manifest = _optional_json_object(
            row.get("release_gate_manifest"), "Release gate manifest"
        )
        artifact_availability = _artifact_availability(
            row.get("artifact_availability")
        )
        expected_availability = {
            "report": report is not None,
            "validationManifest": validation_manifest is not None,
            "pdf": pdf_digest is not None,
            "aiReview": ai_review_run_id is not None,
            "reviewResult": review_result is not None,
            "releaseGateManifest": release_gate_manifest is not None,
        }
        if artifact_availability != expected_availability:
            raise StaffReleaseContractError(
                "Artifact availability conflicts with the review packet"
            )
        failure_stage = row.get("failure_stage")
        if failure_stage is not None:
            failure_stage = _choice(
                failure_stage, _FAILURE_STAGES, "Release review failure stage"
            )
        failure_code = _optional_failure_code(row.get("failure_code"))
        report_artifacts = (
            report is not None,
            report_digest is not None,
            validation_manifest is not None,
            pdf_digest is not None,
        )
        if len(set(report_artifacts)) != 1:
            raise StaffReleaseContractError(
                "Report artifact availability is inconsistent"
            )
        if report is None and (
            failure_stage != "report_generation"
            or row.get("report_status") != "failed"
            or failure_code is None
            or ai_review_run_id is not None
            or review_result is not None
            or release_gate_manifest is not None
        ):
            raise StaffReleaseContractError(
                "Generation-failure review packet is inconsistent"
            )
        if report is not None and failure_stage == "report_generation":
            raise StaffReleaseContractError(
                "Generation-failure review packet contains generated artifacts"
            )
        if failure_stage in {"report_review", "ai_review"} and failure_code is None:
            raise StaffReleaseContractError(
                "Release review failure details are incomplete"
            )
        if failure_stage in {None, "release_gate"} and failure_code is not None:
            raise StaffReleaseContractError(
                "Release review failure details conflict with its stage"
            )
        if failure_stage == "release_gate" and (
            ai_review_run_id is None
            or review_result is None
            or release_gate_manifest is None
        ):
            raise StaffReleaseContractError(
                "Release-gate review packet is incomplete"
            )

        return StaffReleaseReview(
            release_review_id=selected_review_id,
            case_id=_contract_uuid4(row.get("case_id"), "Case ID"),
            review_status=_choice(
                row.get("review_status"),
                _REVIEW_STATUSES,
                "Release review status",
            ),
            assigned_staff_user_id=_optional_contract_uuid4(
                row.get("assigned_staff_user_id"), "Assigned staff user ID"
            ),
            decision=_optional_database_decision(row.get("decision")),
            rationale=_optional_text(
                row.get("rationale"),
                "Release review rationale",
                10000,
            ),
            due_at=_optional_timestamp(row.get("due_at"), "Review due time"),
            resolved_at=_optional_timestamp(
                row.get("resolved_at"), "Review resolution time"
            ),
            updated_at=_timestamp(
                row.get("updated_at"), "Review update time"
            ),
            ai_review_run_id=ai_review_run_id,
            report_version_id=_contract_uuid4(
                row.get("report_version_id"), "Report version ID"
            ),
            resulting_report_version_id=resulting_report_version_id,
            report_status=_choice(
                row.get("report_status"),
                _REPORT_STATUSES,
                "Report status",
            ),
            report=report,
            report_digest=report_digest,
            validation_manifest=validation_manifest,
            pdf_digest=pdf_digest,
            source_snapshot_id=_contract_uuid4(
                row.get("source_snapshot_id"), "Source snapshot ID"
            ),
            source_snapshot_digest=_digest(
                row.get("source_snapshot_digest"),
                "Source snapshot digest",
            ),
            final_assessment_id=_contract_uuid4(
                row.get("final_assessment_id"), "Final assessment ID"
            ),
            assessment_digest=_digest(
                row.get("assessment_digest"), "Assessment digest"
            ),
            final_assessment=_json_object(
                row.get("final_assessment"), "Final assessment"
            ),
            review_result=review_result,
            release_gate_manifest=release_gate_manifest,
            failure_stage=failure_stage,
            failure_code=failure_code,
            artifact_availability=artifact_availability,
        )

    @staticmethod
    def _decision_inputs(
        expected_updated_at: Any,
        decision: Any,
        rationale: Any,
    ) -> tuple[str, str, str, str]:
        selected_timestamp = _timestamp(
            expected_updated_at,
            "Expected update time",
            input_value=True,
        )
        if not isinstance(decision, str) or decision not in STAFF_RELEASE_DECISIONS:
            raise StaffReleaseInputError("Release review decision is invalid")
        if not isinstance(rationale, str):
            raise StaffReleaseInputError("Release review rationale is invalid")
        selected_rationale = rationale.strip()
        if (
            not 1
            <= len(selected_rationale)
            <= MAX_STAFF_RELEASE_RATIONALE_CHARACTERS
            or any(
                ord(character) < 32 and character not in "\n\r\t"
                for character in selected_rationale
            )
            or chr(127) in selected_rationale
        ):
            raise StaffReleaseInputError("Release review rationale is invalid")
        return (
            selected_timestamp,
            decision,
            _PUBLIC_TO_DATABASE_DECISION[decision],
            selected_rationale,
        )

    def decide(
        self,
        release_review_id: str,
        access_token: str,
        *,
        expected_updated_at: Any,
        decision: Any,
        rationale: Any,
    ) -> StaffReleaseDecision:
        selected_review_id = _uuid4(
            release_review_id, "Release review ID"
        )
        selected_access_token = _access_token(access_token)
        (
            selected_timestamp,
            public_decision,
            database_decision,
            selected_rationale,
        ) = self._decision_inputs(expected_updated_at, decision, rationale)
        try:
            row = self._gateway.decide_total_loss_release_review(
                selected_review_id,
                selected_timestamp,
                database_decision,
                selected_rationale,
                selected_access_token,
            )
        except Exception as exc:
            translated = self._translate_dependency_error(exc)
            raise translated from exc
        if not isinstance(row, Mapping):
            raise StaffReleaseContractError(
                "Release review decision is invalid"
            )
        outcome = row.get("outcome")
        if outcome not in {"completed", "existing"}:
            raise StaffReleaseConflictError(
                "Release review changed before the decision"
            )
        if row.get("release_review_id") != selected_review_id:
            raise StaffReleaseContractError(
                "Release review decision changed identity"
            )
        if row.get("decision") != database_decision:
            raise StaffReleaseConflictError(
                "Release review was resolved differently"
            )

        report_version_id = _contract_uuid4(
            row.get("report_version_id"), "Report version ID"
        )
        case_id = _contract_uuid4(row.get("case_id"), "Case ID")
        resulting_report_version_id = _optional_contract_uuid4(
            row.get("resulting_report_version_id"),
            "Resulting report version ID",
        )
        generation_work_item_id = _optional_contract_uuid4(
            row.get("generation_work_item_id"),
            "Generation work item ID",
        )
        report_status = _choice(
            row.get("report_status"),
            _REPORT_STATUSES,
            "Report status",
        )
        package_status = _choice(
            row.get("package_status"),
            _PACKAGE_STATUSES,
            "Package status",
        )
        workflow_task = _optional_text(
            row.get("workflow_task"), "Workflow task", 64
        )
        if workflow_task is None:
            raise StaffReleaseContractError("Workflow task is invalid")

        if database_decision == "revision_requested":
            if (
                resulting_report_version_id is None
                or generation_work_item_id is None
            ):
                raise StaffReleaseContractError(
                    "Revision decision replacement lineage is incomplete"
                )
            if self._work_coordinator is None:
                raise StaffReleaseUnavailableError(
                    "Revision dispatch is unavailable"
                )
            try:
                self._work_coordinator.reconcile_due()
            except Exception as exc:
                translated = self._translate_dependency_error(exc)
                raise translated from exc
        elif (
            resulting_report_version_id is not None
            or generation_work_item_id is not None
        ):
            raise StaffReleaseContractError(
                "Non-revision decision contains replacement lineage"
            )

        if package_status == "refund_pending":
            if self._refund_recovery is None:
                raise StaffReleaseUnavailableError(
                    "No-dispute refund recovery is unavailable"
                )
            try:
                refund = self._refund_recovery.resume_no_dispute_refund(
                    report_version_id
                )
            except Exception as exc:
                translated = self._translate_dependency_error(exc)
                raise translated from exc
            if not isinstance(refund, Mapping) or refund.get("outcome") not in {
                "completed",
                "existing",
                "human_review_required",
            }:
                raise StaffReleaseContractError(
                    "No-dispute refund recovery is invalid"
                )
            package_status = _choice(
                refund.get("package_status"),
                _PACKAGE_STATUSES,
                "Refund package status",
            )
            refunded_task = _optional_text(
                refund.get("workflow_task"), "Refund workflow task", 64
            )
            if refunded_task is not None:
                workflow_task = refunded_task

        return StaffReleaseDecision(
            outcome=outcome,
            release_review_id=selected_review_id,
            case_id=case_id,
            decision=public_decision,
            report_version_id=report_version_id,
            resulting_report_version_id=resulting_report_version_id,
            report_status=report_status,
            package_status=package_status,
            workflow_task=workflow_task,
            generation_work_item_id=generation_work_item_id,
        )


__all__ = [
    "APPROVE_UNCHANGED",
    "MAX_STAFF_ACCESS_TOKEN_CHARACTERS",
    "MAX_STAFF_RELEASE_PACKET_BYTES",
    "MAX_STAFF_RELEASE_RATIONALE_CHARACTERS",
    "NEW_EVIDENCE_REQUIRED",
    "NOT_SUPPORTABLE",
    "REQUEST_REVISION",
    "STAFF_RELEASE_DECISIONS",
    "NoDisputeRefundRecovery",
    "StaffReleaseConflictError",
    "StaffReleaseContractError",
    "StaffReleaseDecision",
    "StaffReleaseError",
    "StaffReleaseInputError",
    "StaffReleaseNotFoundError",
    "StaffReleaseReview",
    "StaffReleaseReviewGateway",
    "StaffReleaseReviewService",
    "StaffReleaseUnavailableError",
    "StaffReleaseWorkCoordinator",
]
