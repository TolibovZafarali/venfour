import { AUTH_RETURN_LOCATION_STORAGE_KEY } from "@/features/auth/return-location";
import type { Session } from "@supabase/supabase-js";
import type { AuthService } from "@/features/auth";
import type { AuthStateChangeListener } from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type { CustomerProfileService } from "@/features/customer-profile";
import type { FullReviewState } from "@/features/full-review/api";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import type { TotalLossDetailsService } from "@/features/total-loss/service";
import type { TotalLossCaseDetails, TotalLossDetailsScope, TotalLossDetailsChanges } from "@/features/total-loss/data-types";
import { materialUndervalueAnalysis } from "@/test/fixtures/analysis-presentation";
import { CASE_ID, OTHER_CASE_ID, USER_ID, REPORT_ID, RUN_ID, NOW, claimProjection, completedEducationSteps } from "./claim-fixtures";
import { isMessageScenario, messagePreview, resetMessagePreview, messageCasePath } from "./message-flow";
import { waitForEntryPreview } from "./entry-preview";

import { responseScenarios, isResponseScenario, responseClaim, responsePayload } from "./response-fixtures";
import { createSyntheticResponseFlow } from "./response-flow";

export const scenarios = [
  ...responseScenarios,
  ["free", "Free result", "A focused result with report upload in a modal."],
  ["listing", "Listing context", "Saved asking-price context."],
  ["insufficient", "Limited evidence", "The saved result without an estimate."],
  ["saved-report", "Limited evidence · saved report", "An earlier result that reuses the report uploaded at intake."],
  ["missing-detail", "Confirm drive type", "One missing fact with the insurer report already saved."],
  ["upload", "Report upload", "PDF upload in a modal over the saved result."],
  ["extracting", "Reading the report", "Saved report extraction in progress."],
  ["confirmation", "Confirm a fact", "Resolve one mileage difference."],
  ["strict", "Reviewing market evidence", "Review of saved report and market evidence."],
  ["report-invalid", "Incomplete report", "Replace a report that is missing valuation pages."],
  ["extraction-failed", "Report reading failed", "Retry reading the saved report without uploading it again."],
  ["review-insufficient", "Report saved · limited evidence", "The report is saved, but reliable market evidence is still missing."],
  ["review-failed", "Review interrupted", "Saved report with a market review that could not finish."],
  ["ready", "Ready for payment", "Review complete; explicit continuation."],
  ["payment-unverified", "Payment · unverified account", "Guest checkout before email verification, with no payment details entered."],
  ["payment", "Payment", import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX ? "Stripe test fields; payment submission disabled." : "Simulated fields and example price; no charge."],
  ["confirming", "Payment processing", "Payment confirmation at checkout, followed by report preparation."],
  ["paid", "Preparing valuation report", "Full-screen stars while the paid report is checked and prepared."],
  ["message", "Prepare your message · Interactive", "Create, edit, and simulate sending a fictional message. Edits survive refresh."],
  ["message-details", "Message · Missing details", "Enter an adjuster’s email and claim number, then create your message."],
  ["send", "Review your message · Interactive", "Start with a saved draft, edit it, and simulate sent confirmation."],
  ["no-dispute", "Review · valuation supported", "Completed review with no supported dispute and retained access after a simulated refund."],
  ["completed", "Completed review", "Existing review, evidence, and section navigation."],
  ["waiting", "Waiting for insurer · Interactive", "Start with a fictional sent message, open the sample report, and try the response form."],
  ["processing", "Free valuation processing", "Current star animation while the free valuation is prepared."],
  ["intake", "Saved appraisal details", "Existing-case intake within the same shell."],
  ["zero", "Zero-case customer", "Passive start without creating a case."],
] as const;
export type Scenario = typeof scenarios[number][0];
type Snapshot = { phase: Scenario; changed: number; transition: boolean; filename?: string; paymentFieldsEmpty?: boolean };
const storageKey = "venfour-workspace-visual-preview-v1";
const intakeDetailsKey = "venfour-workspace-preview-intake-details-v1";
export const GUEST_USER_ID = "99999999-9999-4999-8999-999999999999";
export function snapshot(): Snapshot {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved?.phase === "approval") return { ...saved, phase: "ready", transition: false };
    return saved && scenarios.some(([phase]) => phase === saved.phase) ? saved : { phase: "free", changed: Date.now(), transition: false };
  }
  catch { return { phase: "free", changed: Date.now(), transition: false }; }
}
function save(value: Snapshot) { localStorage.setItem(storageKey, JSON.stringify(value)); }
function setPhase(phase: Scenario, transition = false, filename = snapshot().filename) { save({ ...snapshot(), phase, transition, filename, changed: Date.now() }); }
export function resetScenario(phase: Scenario) {
  localStorage.removeItem(intakeDetailsKey);
  if (isMessageScenario(phase)) resetMessagePreview(phase);
  save({ phase, transition: false, changed: Date.now(), paymentFieldsEmpty: phase === "payment-unverified" });
  localStorage.removeItem("venfour-workspace-preview-signed-out");
  localStorage.removeItem(AUTH_RETURN_LOCATION_STORAGE_KEY);
  localStorage.removeItem(`venfour:claim-email-code-cooldown:${GUEST_USER_ID}`);
  sessionStorage.removeItem("venfour-workspace-preview-requests");
}
export function scenarioPath(phase: Scenario) {
  const base = `/total-loss/cases/${CASE_ID}`;
  if (isResponseScenario(phase)) return `${base}/claim/review/${phase === "acceptance" ? "resolution" : phase}`;
  if (isMessageScenario(phase)) return `${base}/claim/review/${phase === "waiting" ? "waiting" : "request"}`;
  return phase === "zero" ? "/app" : phase === "intake" ? `/start?service=total-loss&caseId=${CASE_ID}` : phase === "upload" ? `${base}/analysis?upload=report` : ["free", "listing", "insufficient", "saved-report", "missing-detail", "processing"].includes(phase) ? `${base}/analysis`
    : phase === "payment-unverified" || phase === "payment" || phase === "confirming" ? `${base}/claim/checkout` : phase === "paid" ? `${base}/claim/processing`
    : ["completed", "no-dispute"].includes(phase) ? `${base}/claim/review/result` : `${base}/review-report`;
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
  const hasReport = !["free", "upload", "listing", "insufficient", "saved-report", "missing-detail", "processing", "zero"].includes(phase);
  const ready = ["review-insufficient", "review-failed", "no-dispute", "strict", "ready", "payment-unverified", "payment", "confirming", "paid", "completed", "message", "message-details", "send", "waiting"].includes(phase);
  return {
    caseId, stage: "full_review", analysisInputId: RUN_ID, analysisInputRevision: 3,
    status: ready ? "ready" : phase === "report-invalid" ? "report_invalid" : phase === "extraction-failed" ? "extraction_failed" : phase === "confirmation" ? "needs_confirmation" : phase === "extracting" || phase === "strict" ? "extracting" : "report_required",
    ready, checkoutAvailable: phase === "ready", locked: ["payment-unverified", "payment", "confirming", "paid", "completed", "no-dispute", "message", "message-details", "send", "waiting"].includes(phase), canReuseReport: ["saved-report", "missing-detail"].includes(phase),
    report: hasReport ? { id: REPORT_ID, revision: 1, filename: snapshot().filename ?? "Insurer_valuation_report.pdf" } : null,
    message: phase === "report-invalid" ? "This file is missing valuation pages. Please upload the complete report." : phase === "extraction-failed" ? "We couldn’t read this report. Try reading the saved file again." : phase === "confirmation" ? "Confirm this detail so we can finish your review." : "Your report is saved.",
    issues: phase === "confirmation" ? [{ field: "mileage", code: "REPORT_FACT_CONFLICT", message: "Which mileage is correct for this review?", reportValue: 32000, savedValue: 30000 }] : [],
    paymentReadiness: {
      status: phase === "review-insufficient" ? "insufficient" : phase === "review-failed" ? "failed" : ["no-dispute", "ready", "payment-unverified", "payment", "confirming", "paid", "completed", "message", "message-details", "send", "waiting"].includes(phase) ? "eligible" : phase === "strict" ? "processing" : "not_evaluated",
      eligible: ["no-dispute", "ready", "payment-unverified", "payment", "confirming", "paid", "completed", "message", "message-details", "send", "waiting"].includes(phase),
      reviewId: "88888888-8888-4888-8888-888888888888", version: "1", digest: "a".repeat(64),
    },
  };
}
const responseCache = new Map<string, ReturnType<typeof responseClaim>>();
function responsePreviewKey(phase: Parameters<typeof responseClaim>[0]) {
  return `venfour:response-review-preview:${phase}:${snapshot().changed}`;
}
function savedResponseClaim(phase: Parameters<typeof responseClaim>[0]) {
  const key = responsePreviewKey(phase);
  if (!responseCache.has(key)) {
    let saved: ReturnType<typeof responseClaim> | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { /* Use the fictional starting state if local data is unreadable. */ }
    responseCache.set(key, saved ?? responseClaim(phase));
  }
  return responseCache.get(key)!;
}
function claim(caseId: string) {
  const phase = snapshot().phase;
  if (isMessageScenario(phase) && caseId === CASE_ID) return responsePayload(messagePreview(phase).claim);
  if (isResponseScenario(phase)) return { ...responsePayload(savedResponseClaim(phase)), caseId };
  if (phase === "payment-unverified") return {
    caseId, state: "secure_required", contactEmail: "preview@example.com", commerce: null, workflow: null,
  };
  const progress = completedEducationSteps();
  if (phase === "waiting") progress.send = { completedAt: NOW, viewedAt: NOW, skippedAt: null };
  const value = claimProjection({ continuingSupported: phase !== "no-dispute", entitlementStatus: phase === "no-dispute" ? "refunded_access_retained" : "active", journey: phase === "payment" || phase === "confirming" ? "checkout" : phase === "paid" ? "processing" : phase === "waiting" ? "awaiting_insurer_response" : "guide_result", progress, withDraft: phase === "send", fulfillmentState: phase === "paid" ? "finalizing" : undefined });
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
  result.vehicle = { ...result.vehicle, year: 2026, make: "Hyundai", model: "Kona", trim: "SE", mileage: 30000, lossDate: "2026-09-01", postalCode: "60601" };
  if (["saved-report", "missing-detail"].includes(phase)) return {
    ...result, runId: RUN_ID, primaryExternalEvidence: null,
    assessment: { ...result.assessment, classification: "INSUFFICIENT_EVIDENCE" },
    marketSearchContext: { baselineStatus: "LIMITED", summary: "Limited evidence", stopReasons: [], recovery: phase === "missing-detail" ? { kind: "UNRESOLVED_CONFIGURATION", field: "drivetrain", correctionStep: "vehicle", message: "Confirm your vehicle’s drive type so we can find the right comparable vehicles. Your valuation report and other details are saved." } : { kind: "UNRESOLVED_CONFIGURATION", field: "engine", correctionStep: null, message: "We need to check the vehicle details in your saved report. You don’t need to upload it again." } },
  };
  return { ...result, analysisScope: { ...result.analysisScope, reportAvailable: !["free", "listing", "insufficient", "upload"].includes(phase) }, runId: RUN_ID, presentationVersion: "8", vehicle: { ...result.vehicle, year: 2026, make: "Hyundai", model: "Kona", trim: "SE" }, preliminaryResult: {
    version: "1", outcome: phase === "insufficient" ? "INSUFFICIENT" : phase === "listing" ? "LISTING_CONTEXT" : "ESTIMATE", evidenceBasis: "CURRENT_MARKET", evidenceDate: "2026-09-15", sampleSize: phase === "insufficient" ? 0 : 6,
    estimatedRange: phase === "listing" || phase === "insufficient" ? null : { lowCents: 2300000, highCents: 2540000 },
    listingPriceSpan: phase === "listing" ? { lowCents: 2300000, highCents: 2540000 } : null,
    listings: phase === "insufficient" ? [] : [2300000, 2340000, 2400000, 2460000, 2500000, 2540000].map((askingPriceCents, index) => ({
      identity: `fictional-kona-${index + 1}`, year: 2026, make: "Hyundai", model: "Kona", trim: "SE",
      askingPriceCents, mileage: 29000 + index * 1000, distanceMiles: 12 + index * 7,
      certified: false, source: "Fictional dealer listing", listingUrl: null, limitations: [],
    })), limitations: phase === "insufficient" ? ["There are too few closely matched listings to show a useful range."] : [], reasonCodes: [], insurerComparison: null,
  } };
}
export function installPreviewFetch() {
  const localFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    record(method, url.pathname);
    if (url.origin !== location.origin) throw new Error("External requests are disabled in the workspace preview.");
    const messagePhase = snapshot().phase;
    if (isMessageScenario(messagePhase) && url.pathname.startsWith(messageCasePath + "/")) {
      const body = method === "GET" ? {} : JSON.parse(typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "{}");
      const reply = messagePreview(messagePhase).handle(url.pathname.slice(messageCasePath.length), method, body);
      if (reply) return Response.json(reply.data, { status: reply.status });
    }
    if (isResponseScenario(messagePhase) && url.pathname === `${messageCasePath}/reports/${REPORT_ID}/download` && method === "GET") return Response.json({
      downloadUrl: new URL("/fixtures/message-preview-report.pdf", location.origin).href,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), suggestedFilename: "Sample_Valuation_Report.pdf",
    });
    if ((messagePhase === "response-reviewed" || messagePhase === "follow-up" || messagePhase === "acceptance") && url.pathname.startsWith(messageCasePath + "/")) {
      const value = savedResponseClaim(messagePhase);
      const key = responsePreviewKey(messagePhase);
      const flow = createSyntheticResponseFlow(value, () => sessionStorage.setItem(key, JSON.stringify(value)), sessionStorage, `${key}:receipts`);
      const body = method === "GET" ? {} : JSON.parse(typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "{}");
      const reply = flow.handle(url.pathname.slice(messageCasePath.length), method, body);
      if (reply) return Response.json(reply.data, { status: reply.status });
    }
    const caseId = url.pathname.match(/appraisal-cases\/([^/]+)/)?.[1] ?? CASE_ID;
    if (url.pathname.endsWith("/full-review/report") && method === "POST") {
      const file = (init?.body as FormData).get("report") as File;
      setPhase("extracting", true, file.name);
      return Response.json(reportState(caseId));
    }
    if (url.pathname.endsWith("/intake-correction") && method === "POST") return Response.json({ caseId, analysisInputId: RUN_ID });
    if (url.pathname.endsWith("/full-review/extract") && method === "POST") { setPhase("extracting", true, "Saved_insurer_valuation.pdf"); return Response.json(reportState(caseId)); }
    if (url.pathname.endsWith("/full-review/confirmation") && method === "PATCH") { setPhase("strict", true); return Response.json(reportState(caseId)); }
    if (url.pathname.endsWith("/full-review") && method === "GET") return Response.json(reportState(caseId));
    if (url.pathname.endsWith("/post-continue") && method === "POST") { setPhase("payment"); return Response.json(claim(caseId)); }
    if (url.pathname.endsWith("/follow-up") && method === "GET") { const phase = snapshot().phase; return Response.json({ followUp: isResponseScenario(phase) ? savedResponseClaim(phase).followUp : null }); }
    if (url.pathname.endsWith("/claim") && method === "GET") return Response.json(claim(caseId));
    if (url.pathname.endsWith("/claim/access-link") && method === "POST") return Response.json({
      state: "secure_required", caseId, contactEmail: "preview@example.com",
      claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
    if (url.pathname.endsWith("/analysis") && method === "GET") return Response.json(snapshot().phase === "processing"
      ? { status: "processing", attemptCount: 1, processingExpiresAt: new Date(Date.now() + 600000).toISOString(), analysisInputId: RUN_ID, analysisInputRevision: 3 }
      : { status: "completed", attemptCount: 1, intakeCorrectionAllowed: true, runId: RUN_ID, analysisInputId: RUN_ID, analysisInputRevision: 3 });
    if (url.pathname.includes("/analyses/") && method === "GET") return Response.json(freeResult());
    if (url.pathname.endsWith("/checkout-quote") && method === "GET") return Response.json({ amountMinorUnits: 19900, availability: "available", currency: "USD" });
    if (url.pathname.endsWith("/checkout-sessions") && method === "POST") {
      if (snapshot().phase === "payment-unverified") return Response.json({ message: "Verify the preview account before payment." }, { status: 403 });
      if (import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX) return localFetch("/_local/stripe-checkout", { cache: "no-store" });
      return Response.json({ checkoutStatus: "open", checkoutUrl: null, checkoutSessionId: "cs_test_workspace_preview", clientSecret: "cs_test_workspace_preview_secret_fixture", publishableKey: "pk_test_visual_fixture", uiMode: "elements", entitlementStatus: null, orderStatus: "pending", state: "checkout_ready" });
    }
    throw new Error(`Unimplemented preview request: ${method} ${url.pathname}`);
  };
}
const session = { access_token: "workspace-preview", refresh_token: "workspace-preview", expires_in: 3600, token_type: "bearer", user: { id: USER_ID, aud: "authenticated", created_at: NOW, email: "preview@example.com", app_metadata: {}, user_metadata: {}, is_anonymous: false } } as Session;
const guestSession: Session = { ...session, access_token: "workspace-preview-guest", user: { ...session.user, id: GUEST_USER_ID, email: undefined, is_anonymous: true } };
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
const signedIn = async () => {
  if (snapshot().phase === "payment-unverified") setPhase("payment");
  localStorage.removeItem("venfour-workspace-preview-signed-out");
  listeners.forEach(listener => listener("SIGNED_IN", session));
  return session;
};
const simulatedSignIn = async (redirectTo: string) => { const url = new URL(redirectTo); url.searchParams.set("code", "simulated-login"); location.assign(url); };
export const previewAuth: AuthService = {
  getSession: async () => {
    await waitForEntryPreview();
    return localStorage.getItem("venfour-workspace-preview-signed-out") ? null : snapshot().phase === "payment-unverified" ? guestSession : session;
  },
  onAuthStateChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  exchangeCodeForSession: signedIn, verifyEmailOtp: signedIn, verifyEmailCode: signedIn,
  signInWithGoogle: simulatedSignIn, signInWithApple: simulatedSignIn,
  sendMagicLink: async () => undefined, sendEmailCode: async () => undefined,
  signOut: async () => { localStorage.setItem("venfour-workspace-preview-signed-out", "true"); listeners.forEach(listener => listener("SIGNED_OUT", null)); },
};
export function previewCases(): AppraisalCase[] {
  const phase = snapshot().phase;
  if (phase === "zero") return [];
  const base: AppraisalCase = { id: CASE_ID, userId: phase === "payment-unverified" ? GUEST_USER_ID : USER_ID, serviceType: "total_loss", status: "check_complete", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW, caseStage: "analysis_complete", analysisStatus: "completed", vehicleLabel: "2026 Hyundai Kona SE", hasFullReviewReport: !["free", "upload", "listing", "insufficient", "saved-report", "missing-detail", "processing"].includes(phase), hasTotalLossClaimWorkflow: isResponseScenario(phase) || ["payment-unverified", "payment", "confirming", "paid", "completed", "no-dispute", "message", "message-details", "send", "waiting"].includes(phase), workspaceStatus: isResponseScenario(phase) && savedResponseClaim(phase).resolution ? "case_closed" : phase === "waiting" ? "awaiting_insurer_response" : ["completed", "no-dispute"].includes(phase) ? "report_ready" : undefined };
  return [{ ...base, ...(phase === "intake" ? { status: "draft" as const, hasFullReviewReport: false, analysisStatus: null, caseStage: undefined } : {}) }, { ...base, id: OTHER_CASE_ID, vehicleLabel: "2024 Hyundai Elantra Limited", lastActivityAt: "2026-09-12T12:00:00Z", hasFullReviewReport: true, hasTotalLossClaimWorkflow: false, workspaceStatus: "review_prepared" }];
}
const previewDraft = (userId: string): AppraisalCase => ({ id: CASE_ID, userId, serviceType: "total_loss", status: "draft", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW });
const unexpectedWrite = async () => { record("BLOCKED", "case-write"); throw new Error("Case writes are disabled in this preview."); };
export const previewCaseService: AppraisalCaseService = {
  getWorkspaceRole: async () => "customer", listAppraisalCases: async () => previewCases(),
  getAppraisalCase: async ({ caseId }) => previewCases().find(item => item.id === caseId) ?? null,
  getRecentDraftAppraisalCase: async () => null,
  createAppraisalCase: unexpectedWrite, createOrGetAppraisalCase: unexpectedWrite, getOrCreateTotalLossDraft: async ({ userId }) => previewDraft(userId), touchAppraisalCase: unexpectedWrite,
};
const savedDetails: TotalLossCaseDetails = {
  caseId: CASE_ID, intakeMode: "manual", vin: null, vehicleYear: 2026,
  vehicleMake: "Hyundai", vehicleModel: "Kona", vehicleTrim: "SE",
  mileageAtLoss: 30000, postalCode: "60601", dateOfLoss: "2026-09-01",
  insurerName: null, insurerVehicleValuation: null,
  reportUploadRecoveryRequired: false, reportOriginalFilename: null,
  reportUploadedAt: null, intakeCompletedAt: null, createdAt: NOW, updatedAt: NOW,
};
function readPreviewDetails(scope: TotalLossDetailsScope): TotalLossCaseDetails | null {
  const saved = JSON.parse(localStorage.getItem(intakeDetailsKey) ?? "{}");
  const stored = saved[`${scope.userId}:${scope.caseId}`] as TotalLossCaseDetails | undefined;
  if (stored) return stored;
  const phase = snapshot().phase;
  if (phase === "zero") return null;
  if (phase === "intake") return { ...savedDetails, caseId: scope.caseId };
  const reportAvailable = !["free", "listing", "insufficient", "upload"].includes(phase);
  return { ...savedDetails, caseId: scope.caseId, intakeMode: reportAvailable ? "report" : "manual", insurerName: "Example Insurance", insurerVehicleValuation: 20000,
    reportOriginalFilename: reportAvailable ? "Insurer_valuation_report.pdf" : null, reportUploadedAt: reportAvailable ? NOW : null,
    intakeCompletedAt: NOW, analysisInputId: RUN_ID, analysisInputRevision: 3 };
}

function savePreviewDetails(scope: TotalLossDetailsScope, changes: TotalLossDetailsChanges | Partial<TotalLossCaseDetails>): TotalLossCaseDetails {
  const current = readPreviewDetails(scope) ?? savedDetails;
  const details = { ...current, ...changes, caseId: scope.caseId,
    updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() };
  const saved = JSON.parse(localStorage.getItem(intakeDetailsKey) ?? "{}");
  saved[`${scope.userId}:${scope.caseId}`] = details;
  localStorage.setItem(intakeDetailsKey, JSON.stringify(saved));
  return details;
}

const previewIntakeDetailsService = {
  getDetails: async scope => readPreviewDetails(scope),
  createDetails: async input => savePreviewDetails(input, input.values),
  saveDetails: async input => savePreviewDetails(input, input.values),
  updateDetails: async input => savePreviewDetails(input, input.changes),
  confirmIntake: async input => {
    const details = savePreviewDetails(input, { intakeCompletedAt: new Date().toISOString(), analysisInputId: RUN_ID, analysisInputRevision: 4 });
    setPhase("processing");
    return details;
  },
} satisfies Pick<TotalLossDetailsService, "getDetails" | "createDetails" | "saveDetails" | "updateDetails" | "confirmIntake">;

export const previewDetails = {
  appraisalCaseService: previewCaseService,
  totalLossDetailsService: previewIntakeDetailsService,
  totalLossIdentityService: { getContact: async () => null },
  totalLossReportStorageService: {},
  vehicleLookupService: {
    listMakes: async () => ["Hyundai"], listModels: async () => ["Kona"],
    listTrims: async () => [{ source: "preview", id: "preview-se", label: "SE", trim: "SE", queryField: "trim", queryValues: ["SE"] }],
  },
} as unknown as TotalLossDependencies;
