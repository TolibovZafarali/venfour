import type { QueryClient } from "@tanstack/react-query";
import { totalLossQueryKeys } from "@/features/total-loss/queries";
import type { Session } from "@supabase/supabase-js";
import type { AuthService, AuthStateChangeListener } from "@/features/auth";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { CustomerProfileService } from "@/features/customer-profile";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import type { TotalLossCaseDetails, TotalLossContact } from "@/features/total-loss/data-types";
import { createEmptyTotalLossDraft, readTotalLossDraft, writeTotalLossDraft } from "@/features/total-loss/draft";
import type { TotalLossPublishedReport } from "@/features/total-loss-claim/contracts";
import { CASE_ID, USER_ID, INPUT_ID, REPORT_ID, initialRecords, publish, advanceResponse, recordRequest, type Records } from "./records";
import data from "./generated/case.json";

export { CASE_ID, USER_ID };
export const manifest = data.manifest;
export const report = data.report as TotalLossPublishedReport;
export const startPath = `/start?service=total-loss&caseId=${CASE_ID}`;
export const resultPath = `/total-loss/cases/${CASE_ID}/claim/review/result`;
const storageKey = "venfour-local-customer-showcase-v3";
const date = manifest.capturedAt;
const RUN_ID = manifest.sourceRunId;
const filename = data.filename;
const base = `/api/v1/appraisal-cases/${CASE_ID}`;
const contact = { firstName: "Jordan", lastName: "Example", email: "jordan@example.test", phoneNumber: "3145550142", termsAccepted: false, privacyAccepted: false, operationalFollowUpAllowed: false };
const initialDetails: TotalLossCaseDetails = {
  caseId: CASE_ID, intakeMode: "report", vin: data.facts.vin, vehicleYear: data.facts.year, vehicleMake: data.facts.make, vehicleModel: data.facts.model, vehicleTrim: data.facts.trim,
  mileageAtLoss: data.facts.mileage, postalCode: data.facts.postalCode, dateOfLoss: data.facts.lossDate, insurerName: data.facts.insurerName, insurerVehicleValuation: data.facts.insurerVehicleValuationMinorUnits / 100,
  reportProvider: "CCC", reportExtractionStatus: "confirmed", reportExtractedAt: date, reportFactsConfirmedAt: date,
  analysisInputId: INPUT_ID, analysisInputRevision: 1, reportStorageOwnerId: USER_ID,
  reportUploadRecoveryRequired: false, reportOriginalFilename: filename, reportUploadedAt: date, intakeCompletedAt: null, createdAt: date, updatedAt: date,
};
interface State { analysisSubmitted: boolean; initialized: boolean; paidAt: number | null; details: TotalLossCaseDetails; contact: TotalLossContact | null; records: Records; signedOut: boolean }
function initial(): State { return { analysisSubmitted: false, initialized: false, paidAt: null, details: initialDetails, contact: null, records: initialRecords(), signedOut: false }; }
export function snapshot(): State {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? initial(); } catch { return initial(); }
}
function wire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(row).filter(([key]) => !((key === "analysis" || key === "analysisEvidence") && "processingState" in row && row.processingState !== "completed")).map(([key, item]) => [key, wire(item)]));
  }
  return value;
}
function save(value: State) { localStorage.setItem(storageKey, JSON.stringify(value)); }
export function resetShowcase() {
  save(initial());
  for (const storage of [sessionStorage, localStorage]) {
    for (const key of Object.keys(storage)) {
      if ((key.startsWith("venfour:") && (key.includes(CASE_ID) || key.includes(USER_ID))) || key === "venfour-showcase-blocked-requests") storage.removeItem(key);
    }
  }
  const draft = createEmptyTotalLossDraft();
  writeTotalLossDraft({ ...draft, dirty: true, reservedCaseId: CASE_ID, ownerUserId: USER_ID,
    manual: { ...draft.manual, vehicleYear: String(data.facts.year), make: data.facts.make, model: data.facts.model, trim: data.facts.trim, mileageAtLoss: String(data.facts.mileage), zipCode: data.facts.postalCode, dateOfLoss: data.facts.lossDate, insurerName: data.facts.insurerName, insurerVehicleValuation: String(data.facts.insurerVehicleValuationMinorUnits / 100) },
    contact, reportProvider: "CCC", reportExtractionStatus: "complete",
  });
}
export function prepareShowcase() {
  if (!localStorage.getItem(storageKey)) resetShowcase();
  const draft = readTotalLossDraft().draft;
  if (!snapshot().analysisSubmitted && draft) writeTotalLossDraft({ ...draft, dirty: true });
}
export function savedClaim() {
  const current = snapshot();
  if (current.paidAt && !current.records.claim.report && Date.now() - current.paidAt >= 650) publish(current.records);
  advanceResponse(current.records);
  save(current); return current.records.claim;
}
function blocked(method: string, path: string): never {
  const requests = JSON.parse(sessionStorage.getItem("venfour-showcase-blocked-requests") ?? "[]");
  requests.push({ method, path }); sessionStorage.setItem("venfour-showcase-blocked-requests", JSON.stringify(requests));
  throw new Error(`Unavailable in this local synthetic case: ${method} ${path}`);
}
const unavailable = async (): Promise<never> => { throw new Error("This local showcase cannot contact providers or send email. Reset walkthrough to restore the synthetic case."); };
export function simulatePayment() {
  const current = snapshot();
  if (!current.initialized || !data.fullReview.paymentReadiness.eligible) throw new Error("A qualifying review is required before payment.");
  if (current.paidAt) return;
  current.paidAt = Date.now();
  const claim = current.records.claim;
  claim.commerce = { ...claim.commerce!, checkoutAvailable: false, entitlementStatus: "active", orderStatus: "paid", paymentStatus: "succeeded", nextTask: "processing" };
  claim.journey = { nextState: "processing", fulfillmentState: "finalizing", retryable: false };
  claim.workflow = { phase: "initial_request", currentTask: "processing", revision: claim.workflow!.revision + 1 };
  save(current);
}
function fixtureMatchesDetails() {
  const current = snapshot().details;
  return (["vehicleYear", "vehicleMake", "vehicleModel", "vehicleTrim", "mileageAtLoss", "postalCode", "dateOfLoss", "insurerName", "insurerVehicleValuation"] as const)
    .every(key => current[key] == null || current[key] === initialDetails[key]);
}
export function installShowcaseFetch(queryClient?: QueryClient) {
  if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("The showcase must run locally in development.");
  const assetFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== location.origin) return blocked(method, url.origin + url.pathname);
    if (url.pathname.startsWith("/generated/") && method === "GET") return assetFetch(input, init);
    const path = url.pathname;
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (snapshot().signedOut) return Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in to open this case." } }, { status: 401 });
    if (path === `${base}/claim` && method === "GET") return Response.json(wire(savedClaim()));
    if (path === `${base}/analysis` && ["GET", "POST"].includes(method)) {
      if (method === "POST" && !fixtureMatchesDetails()) return Response.json({ error: { code: "CONFLICT", message: "This offline result belongs to the prefilled synthetic case. Reset the walkthrough to restore its inputs." } }, { status: 409 });
      if (method === "POST") { save({ ...snapshot(), analysisSubmitted: true }); await new Promise(resolve => setTimeout(resolve, 650)); }
      return Response.json(!snapshot().analysisSubmitted
        ? { status: "not_submitted", analysisInputId: INPUT_ID, analysisInputRevision: 1 }
        : { status: "completed", runId: RUN_ID, analysisInputId: INPUT_ID, analysisInputRevision: 1, attemptCount: 1, intakeCorrectionAllowed: false });
    }
    if (path === `/api/v1/analyses/${RUN_ID}` && method === "GET") return Response.json(data.analysis);
    if ((path === `${base}/full-review` && method === "GET") || (path === `${base}/full-review/report` && method === "POST")) return Response.json(data.fullReview);
    if (path === `${base}/post-continue` && method === "POST") {
      const full = data.fullReview;
      if (!fixtureMatchesDetails() || !snapshot().analysisSubmitted || !full.paymentReadiness.eligible || body.expectedAnalysisInputId !== INPUT_ID || body.expectedAnalysisInputRevision !== 1 || body.expectedReportId !== full.report.id || body.expectedReportRevision !== 1 || body.expectedStrictReviewId !== full.paymentReadiness.reviewId || body.expectedStrictReviewDigest !== full.paymentReadiness.digest) return Response.json({ error: { code: "CONFLICT", message: "The current qualifying review is required." } }, { status: 409 });
      const reviewedDetails = saveDetails({ intakeMode: "report" });
      const queryKey = totalLossQueryKeys.details(USER_ID, CASE_ID);
      await queryClient?.cancelQueries({ queryKey, exact: true }); queryClient?.setQueryData(queryKey, reviewedDetails);
      save({ ...snapshot(), initialized: true }); return Response.json(wire(savedClaim()));
    }
    if (path === `${base}/checkout-quote` && method === "GET") return Response.json({ amountMinorUnits: 19900, availability: "available", currency: "USD" });
    // Only the provider boundary is substituted. No Stripe session is created.
    if (path === `${base}/checkout-sessions` && method === "POST" && snapshot().initialized) return Response.json({ checkoutStatus: "open", checkoutUrl: null, checkoutSessionId: "cs_test_local_confirmation", clientSecret: "cs_test_local_confirmation_secret_offline", publishableKey: "pk_test_offline", uiMode: "elements", entitlementStatus: null, orderStatus: "pending", state: "checkout_ready" });
    if (path === `${base}/checkout-reconciliation` && method === "POST" && snapshot().paidAt) return Response.json({ checkoutStatus: "complete", checkoutUrl: null, checkoutSessionId: "cs_test_local_confirmation", entitlementStatus: "active", orderStatus: "paid", state: "reconciled" });
    if (path === `${base}/reports/${REPORT_ID}/download` && method === "GET" && savedClaim().report) return Response.json({ downloadUrl: new URL(`/generated/${report.suggestedFilename}`, location.origin).href, expiresAt: new Date(Date.now() + 3600000).toISOString(), suggestedFilename: report.suggestedFilename });
    if (path.startsWith(`${base}/education/`) && method === "PUT") {
      const current = snapshot(), claim = current.records.claim;
      const step = path.slice(`${base}/education/`.length) as keyof NonNullable<typeof claim.education>["steps"];
      if (!claim.education || !(step in claim.education.steps) || !["viewed", "completed", "skipped"].includes(body.state)) return blocked(method, path);
      const progress = { ...claim.education.steps, [step]: { ...claim.education.steps[step], [`${body.state}At`]: new Date().toISOString() } };
      claim.education = { ...claim.education, steps: progress };
      claim.workflow = { ...claim.workflow!, revision: claim.workflow!.revision + 1 };
      save(current); return Response.json({ education: claim.education, workflowRevision: claim.workflow.revision });
    }
    if (path.startsWith(`${base}/`)) {
      const current = snapshot();
      const reply = recordRequest(current.records, path.slice(base.length), method, body);
      if (reply) { save(current); return Response.json(wire(reply.data), { status: reply.status }); }
    }
    return blocked(method, path);
  };
}
const session: Session = { access_token: "local-showcase", refresh_token: "local-showcase", expires_in: 3600, token_type: "bearer", user: { id: USER_ID, aud: "authenticated", created_at: date, email: contact.email, email_confirmed_at: date, app_metadata: {}, user_metadata: {}, is_anonymous: false } };
const listeners = new Set<AuthStateChangeListener>();
const signedIn = async () => { save({ ...snapshot(), signedOut: false }); listeners.forEach(listener => listener("SIGNED_IN", session)); return session; };
export const previewAuth: AuthService = {
  getSession: async () => snapshot().signedOut ? null : session,
  onAuthStateChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  exchangeCodeForSession: signedIn, verifyEmailOtp: signedIn, verifyEmailCode: signedIn,
  signInWithGoogle: async redirect => { await signedIn(); location.assign(redirect); }, signInWithApple: async redirect => { await signedIn(); location.assign(redirect); },
  sendMagicLink: unavailable, sendEmailCode: unavailable,
  signOut: async () => { save({ ...snapshot(), signedOut: true }); listeners.forEach(listener => listener("SIGNED_OUT", null)); },
};
function showcaseCase() {
  const complete = snapshot().analysisSubmitted;
  return { id: CASE_ID, userId: USER_ID, serviceType: "total_loss" as const, status: complete ? "check_complete" as const : "draft" as const, createdAt: date, updatedAt: snapshot().details.updatedAt, lastActivityAt: date, vehicleLabel: manifest.title, hasFullReviewReport: true, hasTotalLossClaimWorkflow: snapshot().initialized };
}
export const caseService: AppraisalCaseService = {
  getWorkspaceRole: async () => "customer", listAppraisalCases: async () => [showcaseCase()], getAppraisalCase: async ({ caseId }) => caseId === CASE_ID ? showcaseCase() : null,
  getRecentDraftAppraisalCase: async () => null, createAppraisalCase: async () => showcaseCase(), createOrGetAppraisalCase: async () => showcaseCase(), getOrCreateTotalLossDraft: async () => showcaseCase(), touchAppraisalCase: async () => showcaseCase(),
};
export const profileService: CustomerProfileService = {
  getProfile: async () => ({ userId: USER_ID, fullName: "Jordan Example", fullNameConfirmedAt: date, serviceTermsVersion: "2026-08-23", serviceTermsAcknowledgedAt: date, privacyNoticeVersion: "2026-08-23", privacyNoticeAcknowledgedAt: date, operationalFollowUpAllowed: false, operationalFollowUpUpdatedAt: date, createdAt: date, updatedAt: date }),
  confirmProfile: unavailable,
};
function saveDetails(values: Partial<TotalLossCaseDetails>) {
  const current = snapshot();
  const details = { ...current.details, ...values, updatedAt: new Date().toISOString() };
  save({ ...current, details }); return details;
}
export const details: TotalLossDependencies = {
  appraisalCaseService: caseService,
  totalLossDetailsService: {
    getDetails: async () => snapshot().details,
    createDetails: async ({ values }) => saveDetails(values), updateDetails: async ({ changes }) => saveDetails(changes), saveDetails: async ({ values }) => saveDetails(values),
    confirmIntake: async () => saveDetails({ intakeCompletedAt: new Date().toISOString() }),
    acquireReportUploadLease: unavailable, reclaimReportUploadLease: unavailable, renewReportUploadLease: unavailable,
    markReportUploadReady: unavailable, completeReportUploadRecovery: unavailable, finalizeReportUpload: unavailable, cancelReportUpload: unavailable,
  },
  totalLossIdentityService: {
    getContact: async () => snapshot().contact,
    saveContactAndBeginClaim: async input => {
      const now = new Date().toISOString();
      const value: TotalLossContact = { ...input, fullName: `${input.firstName} ${input.lastName}`, emailVerifiedAt: now, serviceTermsAcknowledgedAt: now, privacyNoticeAcknowledgedAt: now, operationalFollowUpUpdatedAt: now, createdAt: now, updatedAt: now };
      save({ ...snapshot(), contact: value }); return { claimId: null, expiresAt: null, contact: value };
    }, completeIdentityClaim: async () => undefined,
  },
  totalLossInsurerResponseStorageService: {
    uploadPreparedResponse: async ({ caseId, preparation, file }) => {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
      if (caseId !== CASE_ID || snapshot().signedOut || preparation.documentId !== data.responseDocument.documentId || digest !== data.responseDocumentDigest) throw new Error("Only this case’s synthetic response can use its precomputed review.");
      const current = snapshot(); current.records.responseUploadVerified = true; save(current);
    },
  },
  totalLossReportStorageService: {
    downloadReport: async () => (await fetch(`/generated/${filename}`)).blob(),
    uploadReport: unavailable, downloadReportBackup: unavailable, storeReportBackup: unavailable, restoreReport: unavailable, deleteReportBackup: async () => undefined,
  },
  vehicleLookupService: { listMakes: async () => ["Hyundai"], listModels: async () => ["Elantra"], listTrims: async () => [{ source: "local", id: "local-sel", label: "SEL", trim: "SEL", queryField: "trim", queryValues: ["SEL"] }], decodeVin: unavailable },
};
