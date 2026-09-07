import type { AdminFilterDefinition } from "./collection";
import { humanizeAdminCode } from "./ui-format";

const statusOptions = (statuses: readonly string[]) => [{ value: "", label: "All statuses" }, ...statuses.map(value => ({ value, label: humanizeAdminCode(value) }))];
export const attentionFilter: AdminFilterDefinition = { key: "attention", label: "Attention filter", options: [{ value: "", label: "Any attention state" }, { value: "true", label: "Needs attention" }, { value: "false", label: "No recorded issues" }] };
export const caseFilters: readonly AdminFilterDefinition[] = [
  { key: "status", label: "Current case stage", options: statusOptions(["intake_not_started", "intake_in_progress", "report_uploaded", "report_required", "ready_for_analysis", "analysis_processing", "analysis_failed", "analysis_complete", "secure_claim", "finalizing", "report_generation_queued", "report_reviewing", "report_ready", "exception_review", "refund_pending", "awaiting_insurer_response", "insurer_response_received", "insurer_response_reviewing", "insurer_response_reviewed", "follow_up_preparation", "no_dispute_resolved", "resolved", "closed", "needs_attention"]) },
  attentionFilter,
  { key: "identity", label: "Case ownership", options: [{ value: "", label: "All ownership" }, { value: "account", label: "Registered accounts" }, { value: "guest", label: "Guest sessions" }] },
  { key: "active", label: "Case activity", options: [{ value: "", label: "All cases" }, { value: "true", label: "Active cases" }, { value: "false", label: "Closed cases" }] },
];
export const reportFilters: readonly AdminFilterDefinition[] = [
  { key: "kind", label: "Report type", options: [{ value: "", label: "All reports" }, { value: "uploaded", label: "Uploaded source reports" }, { value: "generated", label: "Generated reports" }] },
  { key: "status", label: "Report status", options: statusOptions(["uploaded", "uploading", "unavailable", "pending", "ready", "draft", "generated", "validated", "reviewing", "human_review_required", "published", "superseded", "failed"]) },
  attentionFilter,
];
export const processingFilters: readonly AdminFilterDefinition[] = [
  { key: "kind", label: "Processing family", options: [{ value: "", label: "All processing" }, { value: "initial_analysis", label: "Free valuation" }, { value: "paid_package", label: "Paid review" }, { value: "insurer_response", label: "Insurer response" }] },
  { key: "status", label: "Processing status", options: statusOptions(["queued", "pending", "processing", "source_frozen", "assessment_ready", "report_generating", "waiting_ai_review", "waiting_human_review", "refund_pending", "review_required", "new_evidence_required", "retryable_failed", "failed", "terminal_failed", "unsupported", "completed", "ready", "not_supportable", "superseded"]) },
  { key: "active", label: "Active processing", options: [{ value: "", label: "All activity" }, { value: "true", label: "Active processing" }, { value: "false", label: "Not actively processing" }] },
  attentionFilter,
];
export const paymentFilters: readonly AdminFilterDefinition[] = [
  { key: "status", label: "Order status", options: statusOptions(["pending", "paid", "partially_refunded", "refunded", "disputed", "void"]) },
  attentionFilter,
];
export const activityFilters: readonly AdminFilterDefinition[] = [
  { key: "status", label: "Event type", options: [{ value: "", label: "All event types" }, ...["package.assessment_completed", "package.processing_failed", "report.generated", "report.published", "report.human_review_required", "report.release_review_resolved", "message.prepared", "message.email_app_opened", "message.customer_reported_sent", "insurer_response.recorded", "insurer_response.analysis_completed", "insurer_response.analysis_failed", "insurer_response.decision_recorded", "follow_up.prepared", "follow_up.customer_reported_sent", "case.customer_resolution_confirmed"].map(value => ({ value, label: humanizeAdminCode(value) }))] },
];
