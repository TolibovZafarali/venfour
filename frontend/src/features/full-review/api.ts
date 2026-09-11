import { environment } from "@/config/env";
import { supabaseClientState } from "@/lib/supabase/client";
import { sanitizeDisplayFilename, validateTotalLossPdf } from "@/features/total-loss/validation";
import { createApiClient } from "@/lib/api/client";

export interface FullReviewIssue {
  field: string; code: string; message: string; savedValue: string | number | null; reportValue: string | number | null;
}
export interface FullReviewState {
  caseId: string; stage: "full_review";
  status: "report_required" | "uploading" | "uploaded" | "extracting" | "needs_confirmation" | "ready" | "report_invalid" | "extraction_failed";
  ready: boolean; issues: FullReviewIssue[]; message: string;
  report: { id: string; filename: string; revision: number } | null;
  canReuseReport: boolean; locked: boolean;
}
const client = createApiClient({ baseUrl: environment.apiBaseUrl });
const path = (caseId: string) => `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/full-review`;
export const fullReviewKey = (userId: string, caseId: string) => ["full-review", userId, caseId] as const;
function checked(value: FullReviewState, caseId: string): FullReviewState {
  if (value?.caseId !== caseId || value.stage !== "full_review" || typeof value.ready !== "boolean"
      || !Array.isArray(value.issues) || typeof value.message !== "string" || typeof value.locked !== "boolean"
      || (value.ready && (value.status !== "ready" || !value.report || value.issues.length))) {
    throw new Error("We couldn’t verify the saved report status. Please reload.");
  }
  return value;
}
export async function getFullReview(caseId: string, accessToken: string) {
  return checked(await client.getAuthenticated<FullReviewState>(path(caseId), { accessToken, cache: "no-store" }), caseId);
}
export async function uploadFullReview(caseId: string, accessToken: string, file: File) {
  const validation = validateTotalLossPdf(file);
  if (!validation.valid) throw new Error(validation.error);
  if (supabaseClientState.status !== "available") throw new Error("Private file storage is unavailable.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const upload = await client.postJson<{ reportId: string; bucket: string; path: string }>(`${path(caseId)}/report-upload`, {
    filename: sanitizeDisplayFilename(file.name), sha256, byteSize: file.size,
  }, { accessToken });
  if (upload.bucket !== "case-files" || !upload.path.endsWith(`/${caseId}/review-reports/${upload.reportId}.pdf`)) {
    throw new Error("The private upload destination is invalid.");
  }
  const result = await supabaseClientState.client.storage.from(upload.bucket).upload(upload.path, file, { contentType: "application/pdf", upsert: false, cacheControl: "0" });
  if (result.error) throw new Error("Your file upload did not finish. Please try again.");
  return extractFullReview(caseId, accessToken);
}
export async function extractFullReview(caseId: string, accessToken: string) {
  return checked(await client.postAuthenticated<FullReviewState>(`${path(caseId)}/extract`, { accessToken }), caseId);
}
export async function confirmFullReview(caseId: string, accessToken: string, report: NonNullable<FullReviewState["report"]>, resolutions: Record<string, string>) {
  return checked(await client.patchJson<FullReviewState>(`${path(caseId)}/confirmation`, {
    reportId: report.id, revision: report.revision, resolutions,
  }, { accessToken }), caseId);
}
