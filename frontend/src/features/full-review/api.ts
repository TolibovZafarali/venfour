import { environment } from "@/config/env";
import { sanitizeDisplayFilename, validateTotalLossPdf } from "@/features/total-loss/validation";
import { createApiClient } from "@/lib/api/client";

export interface FullReviewIssue {
  field: string; code: string; message: string; savedValue: string | number | null; reportValue: string | number | null;
}
export interface FullReviewState {
  caseId: string; stage: "full_review";
  analysisInputId: string | null; analysisInputRevision: number | null; checkoutAvailable: boolean;
  status: "report_required" | "uploading" | "uploaded" | "extracting" | "needs_confirmation" | "ready" | "report_invalid" | "extraction_failed";
  ready: boolean; issues: FullReviewIssue[]; message: string;
  paymentReadiness: { status: "not_evaluated" | "processing" | "eligible" | "insufficient" | "failed" | "awaiting_approval";
    eligible: boolean; reviewId: string | null; version: string | null; digest: string | null };
  report: { id: string; filename: string; revision: number } | null;
  canReuseReport: boolean; locked: boolean;
}
const client = createApiClient({ baseUrl: environment.apiBaseUrl });
const path = (caseId: string) => `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/full-review`;
export const fullReviewKey = (userId: string, caseId: string) => ["full-review", userId, caseId] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function positiveRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function checked(value: FullReviewState, caseId: string): FullReviewState {
  const payment = value?.paymentReadiness;
  if (value?.caseId !== caseId || value.stage !== "full_review" || typeof value.ready !== "boolean"
      || (value.analysisInputId !== null && (typeof value.analysisInputId !== "string" || !uuidPattern.test(value.analysisInputId)))
      || (value.analysisInputRevision !== null && !positiveRevision(value.analysisInputRevision)) || typeof value.checkoutAvailable !== "boolean"
      || !Array.isArray(value.issues) || typeof value.message !== "string" || typeof value.locked !== "boolean"
      || (value.report && (!uuidPattern.test(value.report.id) || !positiveRevision(value.report.revision)))
      || (value.ready && (value.status !== "ready" || !value.report || value.issues.length))
      || !payment || !["not_evaluated", "processing", "eligible", "insufficient", "failed", "awaiting_approval"].includes(payment.status)
      || typeof payment.eligible !== "boolean"
      || payment.eligible !== (payment.status === "eligible")
      || (payment.eligible && (!value.ready || typeof payment.reviewId !== "string" || !uuidPattern.test(payment.reviewId)
        || payment.version !== "1" || typeof payment.digest !== "string" || !/^[a-f0-9]{64}$/u.test(payment.digest)))
      || (value.checkoutAvailable && !payment.eligible)) {
    throw new Error("We couldn’t verify the saved report status. Please reload.");
  }
  return value;
}
export async function getFullReview(caseId: string, accessToken: string, signal?: AbortSignal) {
  return checked(await client.getAuthenticated<FullReviewState>(path(caseId), { accessToken, cache: "no-store", signal }), caseId);
}
export async function uploadFullReview(caseId: string, accessToken: string, file: File) {
  const validation = validateTotalLossPdf(file);
  if (!validation.valid) throw new Error(validation.error);
  const body = new FormData();
  body.append("report", file, sanitizeDisplayFilename(file.name));
  return checked(await client.postForm<FullReviewState>(`${path(caseId)}/report`, body, { accessToken }), caseId);
}
export async function extractFullReview(caseId: string, accessToken: string) {
  return checked(await client.postAuthenticated<FullReviewState>(`${path(caseId)}/extract`, { accessToken }), caseId);
}
export async function confirmFullReview(caseId: string, accessToken: string, report: NonNullable<FullReviewState["report"]>, resolutions: Record<string, string>) {
  return checked(await client.patchJson<FullReviewState>(`${path(caseId)}/confirmation`, {
    reportId: report.id, revision: report.revision, resolutions,
  }, { accessToken }), caseId);
}
