import type { AppraisalCaseService } from "@/features/cases/service";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import type { TotalLossPublishedReport } from "@/features/total-loss-claim/contracts";
import { claimProjection, CASE_ID, USER_ID, RUN_ID, REPORT_ID, completedEducationSteps, educationSteps } from "../workspace/claim-fixtures";
import { previewAuth, previewProfileService } from "../workspace/state";
import data from "./generated/case.json";

export { CASE_ID, USER_ID, previewAuth };
export const manifest = data.manifest;
export const report = data.report as TotalLossPublishedReport;
export const resultPath = `/total-loss/cases/${CASE_ID}/claim/review/result`;
const storageKey = "venfour-local-historical-showcase-v1";
const date = manifest.capturedAt;
function initial(complete = false) {
  const value = claimProjection({ continuingSupported: false, progress: complete ? completedEducationSteps() : educationSteps(false) });
  return { ...value, report, contactEmail: "showcase@example.test", sendingDetails: null };
}
export function savedClaim() {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") as ReturnType<typeof initial> ?? initial(); }
  catch { return initial(); }
}
export function resetShowcase(complete = false) {
  localStorage.setItem(storageKey, JSON.stringify(initial(complete)));
  localStorage.removeItem("venfour-workspace-preview-signed-out");
  localStorage.removeItem("venfour-workspace-visual-preview-v1");
  sessionStorage.removeItem("venfour-showcase-blocked-requests");
}
function blocked(method: string, path: string): never {
  const requests = JSON.parse(sessionStorage.getItem("venfour-showcase-blocked-requests") ?? "[]");
  requests.push({ method, path });
  sessionStorage.setItem("venfour-showcase-blocked-requests", JSON.stringify(requests));
  throw new Error(`This action is unavailable in the offline showcase: ${method} ${path}`);
}
export function installShowcaseFetch() {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("The showcase must run locally.");
  const assetFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.origin !== location.origin) return blocked(method, url.origin + url.pathname);
    if (url.pathname.startsWith("/generated/") && method === "GET") return assetFetch(input, init);
    const base = `/api/v1/appraisal-cases/${CASE_ID}`;
    if (url.pathname === `${base}/claim` && method === "GET") return Response.json(savedClaim());
    if (url.pathname === `${base}/follow-up` && method === "GET") return Response.json({ followUp: null });
    if (url.pathname === `${base}/analysis` && method === "GET") return Response.json({ status: "completed", runId: RUN_ID, analysisInputId: RUN_ID, analysisInputRevision: 1, attemptCount: 1, intakeCorrectionAllowed: false });
    if (url.pathname === `${base}/reports/${REPORT_ID}/download` && method === "GET") return Response.json({ downloadUrl: new URL(`/generated/${report.suggestedFilename}`, location.origin).href, expiresAt: new Date(Date.now() + 3600000).toISOString(), suggestedFilename: report.suggestedFilename });
    const step = url.pathname.startsWith(`${base}/education/`) ? url.pathname.slice(`${base}/education/`.length) : null;
    if (step && method === "PUT") {
      const value = savedClaim();
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (!(step in value.education!.steps) || !["viewed", "completed", "skipped"].includes(body.state)) return blocked(method, url.pathname);
      const key = step as keyof NonNullable<typeof value.education>["steps"];
      const field = `${body.state}At` as "viewedAt" | "completedAt" | "skippedAt";
      value.education!.steps[key][field] = new Date().toISOString();
      value.workflow.revision += 1;
      localStorage.setItem(storageKey, JSON.stringify(value));
      return Response.json({ education: value.education, workflowRevision: value.workflow.revision });
    }
    return blocked(method, url.pathname);
  };
}
const readonly = async () => { throw new Error("Case creation and edits are disabled in the local showcase."); };
const showcaseCase = { id: CASE_ID, userId: USER_ID, serviceType: "total_loss" as const, status: "check_complete" as const, createdAt: date, updatedAt: date, lastActivityAt: date, caseStage: "analysis_complete" as const, analysisStatus: "completed" as const, vehicleLabel: manifest.title, hasFullReviewReport: true, hasTotalLossClaimWorkflow: true, workspaceStatus: "report_ready" as const };
export const caseService: AppraisalCaseService = {
  getWorkspaceRole: async () => "customer", listAppraisalCases: async () => [showcaseCase],
  getAppraisalCase: async ({ caseId }) => caseId === CASE_ID ? showcaseCase : null,
  getRecentDraftAppraisalCase: async () => null,
  createAppraisalCase: readonly, createOrGetAppraisalCase: readonly, getOrCreateTotalLossDraft: readonly, touchAppraisalCase: readonly,
};
export const profileService = { ...previewProfileService, getProfile: async (userId: string) => {
  const value = await previewProfileService.getProfile(userId);
  return value ? { ...value, fullName: "Showcase visitor" } : null;
} };
export const details = {
  appraisalCaseService: caseService,
  totalLossDetailsService: { getDetails: async () => ({
    caseId: CASE_ID, intakeMode: "report", vin: null, vehicleYear: 2024, vehicleMake: "Hyundai", vehicleModel: "Elantra", vehicleTrim: "SEL",
    mileageAtLoss: 46926, postalCode: "63026", dateOfLoss: "2026-05-19", insurerName: "State Farm", insurerVehicleValuation: 19046,
    reportUploadRecoveryRequired: false, reportOriginalFilename: "insurer-report-redacted.pdf", reportUploadedAt: date, intakeCompletedAt: date, createdAt: date, updatedAt: date,
  }) },
  totalLossIdentityService: { getContact: async () => null }, totalLossReportStorageService: {}, vehicleLookupService: {},
} as unknown as TotalLossDependencies;
