"""Explicit continuation from an immutable free result and a ready insurer report."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from venfour.analysis_runs import AnalysisRunArtifact
from venfour.commerce import (
    CommerceConflictError, CommerceInputError, CommerceNotFoundError,
    CommerceUnavailableError,
)
from venfour.package_assessment import canonical_package_digest
from venfour.presentation import AnalysisPresentationProjector
from venfour.supabase_gateway import SupabaseContractError
from venfour.full_review_payment import matched_strict_review, strict_result_eligible


def _uuid(value: Any) -> str:
    try:
        parsed = UUID(value) if isinstance(value, str) else None
    except ValueError as exc:
        raise CommerceInputError("Continuation identity is invalid") from exc
    if parsed is None or parsed.version != 4 or str(parsed) != value:
        raise CommerceInputError("Continuation identity is invalid")
    return value


def _revision(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 9007199254740991:
        raise CommerceInputError("Continuation revision is invalid")
    return value


class TotalLossClaimInitializationService:
    def __init__(self, gateway: Any, claim_service: Any, commerce_service: Any):
        self._gateway = gateway
        self._claim_service = claim_service
        self._commerce_service = commerce_service

    @property
    def checkout_available(self) -> bool:
        return getattr(self._commerce_service, "checkout_configured", False) is True

    def initialize(
        self, case_id: str, access_token: str, *, expected_analysis_input_id: str,
        expected_analysis_input_revision: int, expected_report_id: str,
        expected_report_revision: int,
        expected_strict_review_id: str, expected_strict_review_version: str,
        expected_strict_review_digest: str,
    ) -> dict[str, Any]:
        case_id = _uuid(case_id)
        input_id = _uuid(expected_analysis_input_id)
        input_revision = _revision(expected_analysis_input_revision)
        report_id = _uuid(expected_report_id)
        report_revision = _revision(expected_report_revision)
        strict_review_id = _uuid(expected_strict_review_id)
        if (expected_strict_review_version != "1" or not isinstance(expected_strict_review_digest, str)
                or len(expected_strict_review_digest) != 64
                or any(c not in "0123456789abcdef" for c in expected_strict_review_digest)):
            raise CommerceInputError("Strict review identity is invalid")
        if not self.checkout_available:
            raise CommerceUnavailableError("Checkout configuration is unavailable")
        user_id = self._gateway.authenticate(access_token)
        context = self._gateway.get_full_review_context(case_id, user_id)
        if context is None:
            raise CommerceNotFoundError("Full review was not found")
        if (not isinstance(context, Mapping) or context.get("case_id") != case_id
                or context.get("user_id") != user_id):
            raise SupabaseContractError("Full review ownership response is invalid")
        report = context.get("report")
        current_revision = context.get("source_input_revision", (context.get("input") or {}).get("analysis_input_revision"))
        if context.get("source_input_id") != input_id or current_revision != input_revision:
            raise CommerceConflictError("The saved analysis changed; reopen the full review")
        if (not isinstance(report, Mapping) or report.get("id") != report_id
                or report.get("revision") != report_revision):
            raise CommerceConflictError("The saved report changed; reopen the full review")
        review = matched_strict_review(context)
        if (review is None or review.get("id") != strict_review_id
                or review.get("review_version") != expected_strict_review_version
                or review.get("calculation_digest") != expected_strict_review_digest
                or not strict_result_eligible(review["calculation"])):
            raise CommerceConflictError("The saved review is not eligible for continuation")
        if (report.get("status") != "ready" or not isinstance(report.get("readiness"), Mapping)
                or report["readiness"].get("ready") is not True
                or self._gateway.full_review_ready(case_id, user_id) is not True):
            raise CommerceConflictError("The insurer report is not ready for continuation")
        try:
            artifact = AnalysisRunArtifact.from_dict(context["artifact"])
            presentation = AnalysisPresentationProjector().project(artifact).to_dict()
        except Exception as exc:
            raise SupabaseContractError("The saved analysis could not be validated") from exc
        if (artifact.run_id != context.get("source_run_id")
                or report.get("source_run_id") != artifact.run_id
                or report.get("source_input_id") != input_id):
            raise SupabaseContractError("The saved report source is invalid")
        digest = canonical_package_digest({"schemaVersion": "1", "presentation": presentation})
        outcome = self._gateway.initialize_total_loss_post_continue(
            case_id, user_id, artifact.run_id, input_id, input_revision,
            report_id, report_revision, presentation, digest,
            strict_review_id, expected_strict_review_version, expected_strict_review_digest,
        )
        if outcome == "not_found":
            raise CommerceNotFoundError("Full review was not found")
        if outcome in {"stale", "not_ready"}:
            raise CommerceConflictError("The saved review changed; reopen it before continuing")
        if outcome not in {"created", "existing"}:
            raise SupabaseContractError("Claim initialization response is invalid")
        return self._claim_service.resolve(case_id, access_token).to_dict()
