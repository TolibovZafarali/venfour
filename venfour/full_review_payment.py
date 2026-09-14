"""Payment eligibility projected from the saved strict report requalification."""

from collections.abc import Mapping

from venfour.package_assessment import canonical_package_digest
from venfour.preliminary_qualification import MARKET_QUALIFYING_CLASSIFICATIONS


FULL_REVIEW_VERSION = "1"
FULL_REVIEW_WORK_TYPE = "total_loss_full_review_prepare"


def strict_result_eligible(calculation: Mapping) -> bool:
    """Preserve the strict result; neither listing context nor missing checks qualify."""
    try:
        result = calculation["artifact"]["result"]
        assessment = calculation["presentation"]["assessment"]
        discrepancy = result["discrepancyResult"]
        qualification = result["preliminaryQualification"]
        return (
            calculation["newProviderRequests"] == 0
            and assessment["classification"] == discrepancy["classification"]
            and assessment["evidenceStrength"] == discrepancy["evidenceStrength"]
            and discrepancy["evidenceStrength"] in {"MODERATE", "STRONG"}
            and discrepancy["classification"] in MARKET_QUALIFYING_CLASSIFICATIONS
            and qualification["qualificationVersion"] == "1"
            and qualification["marketClassification"] == discrepancy["classification"]
            and qualification["outcome"] == "CLEAR_MARKET_VALUE_GAP"
            and qualification["unresolvedMaterialChecks"] == []
            and qualification["applicableMaterialReviewComplete"] is True
        )
    except (KeyError, TypeError):
        return False


def matched_strict_review(context: Mapping) -> Mapping | None:
    """Check the immutable report, input, run, evaluator version and result digest."""
    report, review = context.get("report"), context.get("strict_review")
    if not isinstance(report, Mapping) or not isinstance(review, Mapping):
        return None
    try:
        if (report["status"] != "ready" or report["readiness"]["ready"] is not True
                or report["readiness"]["issues"] != []
                or review["review_version"] != FULL_REVIEW_VERSION
                or review["case_id"] != context["case_id"]
                or review["report_id"] != report["id"]
                or review["report_revision"] != report["revision"]
                or review["source_run_id"] != context["source_run_id"]
                or review["source_input_id"] != context["source_input_id"]
                or review["source_input_revision"] != context["source_input_revision"]
                or review["document_sha256"] != report["document_sha256"]
                or review["calculation_digest"] != canonical_package_digest(review["calculation"])):
            return None
    except (KeyError, TypeError, ValueError):
        return None
    return review


def payment_readiness(context: Mapping) -> dict:
    review = matched_strict_review(context)
    if review is not None:
        eligible = strict_result_eligible(review["calculation"])
        return {"status": "eligible" if eligible else "insufficient", "eligible": eligible,
                "reviewId": review["id"], "version": review["review_version"],
                "digest": review["calculation_digest"]}
    work = context.get("review_work") or {}
    status = "not_evaluated"
    if work.get("status") in {"queued", "dispatching", "processing", "retryable_failed"}:
        status = "processing"
    elif work.get("status") == "terminal_failed":
        status = "failed"
    return {"status": status, "eligible": False, "reviewId": None, "version": None, "digest": None}
