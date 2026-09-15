import { appraisalCasePresentation } from "./presentation";
import type { AppraisalCase } from "./types";

// Summary fields select the existing case entry. Each entry still resolves its
// own current, owner-checked workflow; the menu never advances that workflow.
export function appraisalWorkspaceHref(item: AppraisalCase): string {
  const caseId = encodeURIComponent(item.id);
  if (item.serviceType === "total_loss") {
    if (item.hasTotalLossClaimWorkflow) return `/total-loss/cases/${caseId}/claim`;
    if (item.hasFullReviewReport) return `/total-loss/cases/${caseId}/review-report`;
    if (item.analysisStatus || ["checking", "check_complete", "completed", "closed"].includes(item.status) ||
      ["ready_for_analysis", "analysis_complete", "analysis_processing", "analysis_failed"].includes(item.caseStage ?? "")) {
      return `/total-loss/cases/${caseId}/analysis`;
    }
    return `/start?service=total-loss&view=intake&caseId=${caseId}`;
  }
  return appraisalCasePresentation(item).action?.href ?? "/start?service=diminished-value";
}

const statusLabels: Record<string, string> = {
  uploading: "Report upload in progress", uploaded: "Report uploaded", extracting: "Reading your report",
  needs_confirmation: "Confirm report details", ready: "Report details saved",
  report_invalid: "Check your report", extraction_failed: "Report needs attention",
  review_preparing: "Review in progress", review_prepared: "Review prepared", review_failed: "Review needs attention",
  checkout: "Ready for checkout", purchase_complete: "Preparing your report", finalizing: "Preparing your report",
  report_ready: "Review complete", prepare_request: "Prepare your request", awaiting_insurer_response: "Waiting for response",
  insurer_response_received: "Response received", insurer_response_reviewing: "Reviewing the response",
  insurer_response_reviewed: "Response reviewed", follow_up_preparation: "Prepare your follow-up",
  insurer_response_review_unavailable: "Response needs attention", case_resolved: "Completed", case_closed: "Completed",
  resolved: "Completed", no_dispute_resolved: "Completed", no_dispute_supported: "Review complete",
  secure_claim: "Secure your review", exception_review: "Review needs attention", payment_review: "Payment under review",
};

export function appraisalWorkspaceLabel(item: AppraisalCase) {
  return item.vehicleLabel?.trim() || (item.serviceType === "total_loss" ? "Vehicle details to add" : "Diminished-value request");
}

export function appraisalWorkspaceStatus(item: AppraisalCase) {
  if (item.status === "closed" || item.caseStage === "closed") return "Completed";
  return statusLabels[item.workspaceStatus ?? ""] ?? appraisalCasePresentation(item).statusLabel;
}
