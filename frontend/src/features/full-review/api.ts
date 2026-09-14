import { environment } from "@/config/env";
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
