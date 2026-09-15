import type { Session } from "@supabase/supabase-js";
import type { AuthService } from "@/features/auth";
import type { AuthStateChangeListener } from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type { CustomerProfileService } from "@/features/customer-profile";
import type { FullReviewState } from "@/features/full-review/api";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";
import { materialUndervalueAnalysis } from "@/test/fixtures/analysis-presentation";
import { CASE_ID, OTHER_CASE_ID, USER_ID, REPORT_ID, RUN_ID, NOW, claimProjection, completedEducationSteps } from "./claim-fixtures";

export const scenarios = [
  ["free", "Free result", "A focused result with report upload in a modal."],
  ["listing", "Listing context", "Saved asking-price context."],
  ["insufficient", "Limited evidence", "The saved result without an estimate."],
  ["upload", "Report upload", "PDF upload in a modal over the saved result."],
  ["extracting", "Reading the report", "Saved report extraction in progress."],
  ["confirmation", "Confirm a fact", "Resolve one mileage difference."],
  ["strict", "Strict review", "Review of saved report and market evidence."],
  ["ready", "Ready for payment", "Review complete; explicit continuation."],
  ["payment", "Payment", "Simulated fields and example price; no charge."],
  ["confirming", "Payment processing", "Payment confirmation at checkout, followed by report preparation."],
  ["paid", "Preparing valuation report", "Full-screen stars while the paid report is checked and prepared."],
  ["completed", "Completed review", "Existing review, evidence, and section navigation."],
  ["waiting", "Waiting for response", "The existing insurer-response workflow."],
  ["processing", "Free valuation processing", "Processing within the stable shell."],
  ["intake", "Saved appraisal details", "Existing-case intake within the same shell."],
  ["zero", "Zero-case customer", "Passive start without creating a case."],
] as const;
export type Scenario = typeof scenarios[number][0];
type Snapshot = { phase: Scenario; changed: number; transition: boolean; filename?: string };
const storageKey = "venfour-workspace-visual-preview-v1";
export function snapshot(): Snapshot {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved?.phase === "approval") return { ...saved, phase: "ready", transition: false };
    return saved ?? { phase: "free", changed: Date.now(), transition: false };
  }
  catch { return { phase: "free", changed: Date.now(), transition: false }; }
}
function save(value: Snapshot) { localStorage.setItem(storageKey, JSON.stringify(value)); }
function setPhase(phase: Scenario, transition = false, filename = snapshot().filename) { save({ phase, transition, filename, changed: Date.now() }); }
export function resetScenario(phase: Scenario) {
  save({ phase, transition: false, changed: Date.now() });
  localStorage.removeItem("venfour-workspace-preview-signed-out");
  sessionStorage.removeItem("venfour-workspace-preview-requests");
}
export function scenarioPath(phase: Scenario) {
  const base = `/total-loss/cases/${CASE_ID}`;
  return phase === "zero" ? "/app" : phase === "intake" ? `/start?service=total-loss&caseId=${CASE_ID}` : phase === "upload" ? `${base}/analysis?upload=report` : ["free", "listing", "insufficient", "processing"].includes(phase) ? `${base}/analysis`
    : phase === "payment" || phase === "confirming" ? `${base}/claim/checkout` : phase === "paid" ? `${base}/claim/processing`
    : phase === "completed" ? `${base}/claim/review/result` : phase === "waiting" ? `${base}/claim/review/waiting` : `${base}/review-report`;
}
function record(method: string, path: string) {
  const requests = JSON.parse(sessionStorage.getItem("venfour-workspace-preview-requests") ?? "[]");
  requests.push({ method, path });
  sessionStorage.setItem("venfour-workspace-preview-requests", JSON.stringify(requests));
}
function reportState(caseId: string): FullReviewState {
  const current = snapshot();
  let phase = current.phase;
  const { transition, changed } = current;
  if (transition && Date.now() - changed > 4500) {
    if (phase === "extracting") { setPhase("confirmation"); phase = "confirmation"; }
    else if (phase === "strict") { setPhase("ready"); phase = "ready"; }
  }
  if (caseId === OTHER_CASE_ID) phase = "ready";
  const hasReport = !["free", "upload", "listing", "insufficient", "processing", "zero"].includes(phase);
  const ready = ["strict", "ready", "payment", "confirming", "paid", "completed", "waiting"].includes(phase);
  return {
    caseId, stage: "full_review", analysisInputId: RUN_ID, analysisInputRevision: 3,
    status: ready ? "ready" : phase === "confirmation" ? "needs_confirmation" : phase === "extracting" || phase === "strict" ? "extracting" : "report_required",
    ready, checkoutAvailable: phase === "ready", locked: ["payment", "confirming", "paid", "completed", "waiting"].includes(phase), canReuseReport: false,
    report: hasReport ? { id: REPORT_ID, revision: 1, filename: snapshot().filename ?? "Insurer_valuation_report.pdf" } : null,
    message: phase === "confirmation" ? "Confirm this detail so we can finish your review." : "Your report is saved.",
    issues: phase === "confirmation" ? [{ field: "mileage", code: "REPORT_FACT_CONFLICT", message: "Which mileage should the full review use?", reportValue: 32000, savedValue: 30000 }] : [],
    paymentReadiness: {
      status: ["ready", "payment", "confirming", "paid", "completed", "waiting"].includes(phase) ? "eligible" : phase === "strict" ? "processing" : "not_evaluated",
      eligible: ["ready", "payment", "confirming", "paid", "completed", "waiting"].includes(phase),
      reviewId: "88888888-8888-4888-8888-888888888888", version: "1", digest: "a".repeat(64),
    },
  };
}
function claim(caseId: string) {
  const phase = snapshot().phase;
  const progress = completedEducationSteps();
  if (phase === "waiting") progress.send = { completedAt: NOW, viewedAt: NOW, skippedAt: null };
  const value = claimProjection({ journey: phase === "payment" || phase === "confirming" ? "checkout" : phase === "paid" ? "processing" : phase === "waiting" ? "awaiting_insurer_response" : "guide_result", progress, fulfillmentState: phase === "paid" ? "finalizing" : undefined });
  if (phase === "confirming") return {
    ...value, caseId,
    commerce: { ...value.commerce, checkoutAvailable: false, paymentStatus: "pending", orderStatus: "pending", nextTask: "checkout_confirmation" },
    journey: { ...value.journey, nextState: "checkout_confirmation" },
  };
  return { ...value, caseId, report: phase === "paid" ? null : value.report };
}
function freeResult() {
  const phase = snapshot().phase;
  const result = structuredClone(materialUndervalueAnalysis);
  return { ...result, runId: RUN_ID, presentationVersion: "8", vehicle: { ...result.vehicle, year: 2026, make: "Hyundai", model: "Kona", trim: "SE" }, preliminaryResult: {
    version: "1", outcome: phase === "insufficient" ? "INSUFFICIENT" : phase === "listing" ? "LISTING_CONTEXT" : "ESTIMATE", evidenceBasis: "CURRENT_MARKET", evidenceDate: "2026-09-15", sampleSize: phase === "insufficient" ? 0 : 6,
    estimatedRange: phase === "listing" || phase === "insufficient" ? null : { lowCents: 2300000, highCents: 2540000 },
    listingPriceSpan: phase === "listing" ? { lowCents: 2300000, highCents: 2540000 } : null,
    listings: [], limitations: phase === "insufficient" ? ["There are too few closely matched listings to show a useful range."] : [], reasonCodes: [], insurerComparison: null,
  } };
}
export function installPreviewFetch() {
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    record(method, url.pathname);
    if (url.origin !== location.origin) throw new Error("External requests are disabled in the workspace preview.");
    const caseId = url.pathname.match(/appraisal-cases\/([^/]+)/)?.[1] ?? CASE_ID;
    if (url.pathname.endsWith("/full-review/report") && method === "POST") {
      const file = (init?.body as FormData).get("report") as File;
      setPhase("extracting", true, file.name);
      return Response.json(reportState(caseId));
    }
    if (url.pathname.endsWith("/full-review/confirmation") && method === "PATCH") { setPhase("strict", true); return Response.json(reportState(caseId)); }
    if (url.pathname.endsWith("/full-review") && method === "GET") return Response.json(reportState(caseId));
    if (url.pathname.endsWith("/post-continue") && method === "POST") { setPhase("payment"); return Response.json(claim(caseId)); }
    if (url.pathname.endsWith("/claim") && method === "GET") return Response.json(claim(caseId));
    if (url.pathname.endsWith("/analysis") && method === "GET") return Response.json(snapshot().phase === "processing"
      ? { status: "processing", attemptCount: 1, processingExpiresAt: new Date(Date.now() + 600000).toISOString(), analysisInputId: RUN_ID, analysisInputRevision: 3 }
      : { status: "completed", attemptCount: 1, intakeCorrectionAllowed: true, runId: RUN_ID, analysisInputId: RUN_ID, analysisInputRevision: 3 });
    if (url.pathname.includes("/analyses/") && method === "GET") return Response.json(freeResult());
    if (url.pathname.endsWith("/checkout-quote") && method === "GET") return Response.json({ amountMinorUnits: 19900, availability: "available", currency: "USD" });
    if (url.pathname.endsWith("/checkout-sessions") && method === "POST") return Response.json({ checkoutStatus: "open", checkoutUrl: null, checkoutSessionId: "cs_test_workspace_preview", clientSecret: "cs_test_workspace_preview_secret_fixture", publishableKey: "pk_test_visual_fixture", uiMode: "elements", entitlementStatus: null, orderStatus: "pending", state: "checkout_ready" });
    throw new Error(`Unimplemented preview request: ${method} ${url.pathname}`);
  };
}
const session = { access_token: "workspace-preview", refresh_token: "workspace-preview", expires_in: 3600, token_type: "bearer", user: { id: USER_ID, aud: "authenticated", created_at: NOW, email: "preview@example.com", app_metadata: {}, user_metadata: {}, is_anonymous: false } } as Session;
export const previewProfileService: CustomerProfileService = {
  getProfile: async userId => userId === USER_ID ? {
    userId, fullName: "Jordan Rivera", fullNameConfirmedAt: NOW,
    serviceTermsVersion: "2026-08-23", serviceTermsAcknowledgedAt: NOW,
    privacyNoticeVersion: "2026-08-23", privacyNoticeAcknowledgedAt: NOW,
    operationalFollowUpAllowed: false, operationalFollowUpUpdatedAt: NOW,
    createdAt: NOW, updatedAt: NOW,
  } : null,
  confirmProfile: async () => { throw new Error("Profile writes are disabled in this preview."); },
};
const listeners = new Set<AuthStateChangeListener>();
const signedIn = async () => { localStorage.removeItem("venfour-workspace-preview-signed-out"); listeners.forEach(listener => listener("SIGNED_IN", session)); return session; };
const simulatedSignIn = async (redirectTo: string) => { const url = new URL(redirectTo); url.searchParams.set("code", "simulated-login"); location.assign(url); };
export const previewAuth: AuthService = {
  getSession: async () => localStorage.getItem("venfour-workspace-preview-signed-out") ? null : session,
  onAuthStateChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  exchangeCodeForSession: signedIn, verifyEmailOtp: signedIn, verifyEmailCode: signedIn,
  signInWithGoogle: simulatedSignIn, signInWithApple: simulatedSignIn,
  sendMagicLink: async () => undefined, sendEmailCode: async () => undefined,
  signOut: async () => { localStorage.setItem("venfour-workspace-preview-signed-out", "true"); listeners.forEach(listener => listener("SIGNED_OUT", null)); },
};
export function previewCases(): AppraisalCase[] {
  const phase = snapshot().phase;
  if (phase === "zero") return [];
  const base: AppraisalCase = { id: CASE_ID, userId: USER_ID, serviceType: "total_loss", status: "check_complete", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW, caseStage: "analysis_complete", analysisStatus: "completed", vehicleLabel: "2026 Hyundai Kona SE", hasFullReviewReport: !["free", "upload", "listing", "insufficient", "processing"].includes(phase), hasTotalLossClaimWorkflow: ["payment", "confirming", "paid", "completed", "waiting"].includes(phase), workspaceStatus: phase === "waiting" ? "awaiting_insurer_response" : phase === "completed" ? "report_ready" : undefined };
  return [{ ...base, ...(phase === "intake" ? { status: "draft" as const, hasFullReviewReport: false, analysisStatus: null, caseStage: undefined } : {}) }, { ...base, id: OTHER_CASE_ID, vehicleLabel: "2024 Hyundai Elantra Limited", lastActivityAt: "2026-09-12T12:00:00Z", hasFullReviewReport: true, hasTotalLossClaimWorkflow: false, workspaceStatus: "review_prepared" }];
}
const unexpectedWrite = async () => { record("BLOCKED", "case-write"); throw new Error("Case writes are disabled in this preview."); };
export const previewCaseService: AppraisalCaseService = {
  getWorkspaceRole: async () => "customer", listAppraisalCases: async () => previewCases(),
  getAppraisalCase: async ({ caseId }) => previewCases().find(item => item.id === caseId) ?? null,
  getRecentDraftAppraisalCase: async () => null,
  createAppraisalCase: unexpectedWrite, createOrGetAppraisalCase: unexpectedWrite, getOrCreateTotalLossDraft: unexpectedWrite, touchAppraisalCase: unexpectedWrite,
};
const savedDetails: TotalLossCaseDetails = {
  caseId: CASE_ID, intakeMode: "manual", vin: null, vehicleYear: 2026,
  vehicleMake: "Hyundai", vehicleModel: "Kona", vehicleTrim: "SE",
  mileageAtLoss: 30000, postalCode: "60601", dateOfLoss: "2026-09-01",
  insurerName: null, insurerVehicleValuation: null,
  reportUploadRecoveryRequired: false, reportOriginalFilename: null,
  reportUploadedAt: null, intakeCompletedAt: null, createdAt: NOW, updatedAt: NOW,
};
export const previewDetails = {
  appraisalCaseService: previewCaseService,
  totalLossDetailsService: { getDetails: async () => snapshot().phase === "intake" ? savedDetails : { ...savedDetails, intakeMode: "report" } },
  totalLossIdentityService: { getContact: async () => null },
  totalLossReportStorageService: {},
  vehicleLookupService: {
    listMakes: async () => ["Hyundai"], listModels: async () => ["Kona"],
    listTrims: async () => [{ source: "preview", id: "preview-se", label: "SE", trim: "SE", queryField: "trim", queryValues: ["SE"] }],
  },
} as unknown as TotalLossDependencies;
