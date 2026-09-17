import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTotalLossDraft } from "@/features/total-loss/draft";
import * as api from "@/features/total-loss-claim/api";
import { getFullReview } from "@/features/full-review/api";
import { CASE_ID, USER_ID, details, installShowcaseFetch, previewAuth, resetShowcase, simulatePayment, snapshot } from "./state";
import data from "./generated/case.json";
let originalFetch: typeof fetch;
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { originalFetch = window.fetch; network = vi.fn(); window.fetch = network as typeof fetch; installShowcaseFetch(); resetShowcase(); vi.useFakeTimers(); });
afterEach(() => { window.fetch = originalFetch; vi.useRealTimers(); });
async function paidClaim() {
  const submission = fetch(`/api/v1/appraisal-cases/${CASE_ID}/analysis`, { method: "POST" });
  await vi.advanceTimersByTimeAsync(700); await submission;
  const full = await getFullReview(CASE_ID, "local");
  await api.initializeTotalLossClaim(CASE_ID, "local", { expectedAnalysisInputId: full.analysisInputId!, expectedAnalysisInputRevision: 1, expectedReportId: full.report!.id, expectedReportRevision: 1, expectedStrictReviewId: full.paymentReadiness.reviewId!, expectedStrictReviewVersion: "1", expectedStrictReviewDigest: full.paymentReadiness.digest! });
  expect((await api.createTotalLossCheckout(CASE_ID, "local", crypto.randomUUID())).state).toBe("checkout_ready");
  simulatePayment();
  expect((await api.reconcileTotalLossCheckout(CASE_ID, "local", "cs_test_local_confirmation")).state).toBe("reconciled");
  vi.advanceTimersByTime(700); return api.getTotalLossClaim(CASE_ID, "local");
}
describe("synthetic records under current customer contracts", () => {
  it("prefills intake, preserves explicit consent and uses current qualifying data", async () => {
    expect(readTotalLossDraft().draft).toMatchObject({ step: "choice", mode: null, dirty: true, manual: { make: "Hyundai", model: "Elantra", mileageAtLoss: "50000", insurerVehicleValuation: "20000" }, contact: { email: "jordan@example.test", termsAccepted: false, privacyAccepted: false } });
    expect((await previewAuth.getSession())?.user.id).toBe(USER_ID);
    expect(data.analysis.presentationVersion).toBe("8"); expect(data.fullReview.paymentReadiness.eligible).toBe(true);
    expect(data.report.conclusion.continuingSupported).toBe(true); expect(network).not.toHaveBeenCalled();
  });
  it.each([false, true])("uses real API parsers through closure (response attachment: %s)", async (withDocument) => {
    let claim = await paidClaim();
    expect(claim.report?.conclusion.insurerValuation.amountMinorUnits).toBe(2000000);
    for (const step of ["result", "insurer_review", "valuation", "report", "what_next"] as const) {
      await api.updateTotalLossEducationProgress(CASE_ID, "local", step, "completed", claim.workflow!.revision);
      claim = await api.getTotalLossClaim(CASE_ID, "local");
    }
    await api.updateTotalLossSendingDetails(CASE_ID, "local", { adjusterName: "Taylor Morgan", adjusterEmail: "taylor.morgan@example.test", adjusterEmailConfirmed: true, claimReference: "DEMO-2026-0142", claimReferenceConfirmed: true, expectedRevision: claim.sendingDetails!.revision, expectedWorkflowRevision: claim.workflow!.revision });
    claim = await api.getTotalLossClaim(CASE_ID, "local");
    const first = await api.prepareTotalLossMessage(CASE_ID, "local", crypto.randomUUID(), claim.workflow!.revision);
    const draft = await api.updateTotalLossMessageDraft(CASE_ID, "local", { ...first.draft, recipient: first.draft.recipient!, expectedRevision: first.draft.revision, body: first.draft.body + "\nThank you again." });
    claim = await api.getTotalLossClaim(CASE_ID, "local");
    const prepared = await api.prepareTotalLossMessage(CASE_ID, "local", crypto.randomUUID(), claim.workflow!.revision);
    expect(prepared.messageVersion.body).toBe(draft.body);
    await api.confirmTotalLossMessageSent(CASE_ID, "local", { clientRequestId: crypto.randomUUID(), expectedWorkflowRevision: prepared.workflowRevision, messageVersionId: prepared.messageVersion.messageVersionId });
    claim = await api.getTotalLossClaim(CASE_ID, "local"); expect(claim.journey?.nextState).toBe("awaiting_insurer_response");
    expect(Object.keys(sessionStorage).some(key => key.startsWith("venfour:insurer-response-draft:v2:"))).toBe(true);
    let documentId: string | null = null;
    if (withDocument) {
      const clientRequestId = crypto.randomUUID();
      const preparation = await api.prepareTotalLossInsurerResponseUpload(CASE_ID, "local", { clientRequestId, ...data.responseDocument, contentDigest: data.responseDocumentDigest, expectedWorkflowRevision: claim.workflow!.revision, outboundCommunicationId: claim.responseIntake!.outboundCommunicationId, supersedesResponseId: null, mediaType: "application/pdf" });
      const bytes = readFileSync(`preview/showcase/generated/${data.responseDocument.originalFilename}`);
      await details.totalLossInsurerResponseStorageService!.uploadPreparedResponse({ caseId: CASE_ID, clientRequestId, preparation, file: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File });
      documentId = preparation.documentId;
    }
    await api.recordTotalLossInsurerResponse(CASE_ID, "local", { clientRequestId: crypto.randomUUID(), documentId, expectedWorkflowRevision: claim.workflow!.revision, outboundCommunicationId: claim.responseIntake!.outboundCommunicationId, responseText: data.response.text, retainedDocumentId: null, revisedOfferMinorUnits: data.response.offer, supersedesResponseId: null });
    vi.advanceTimersByTime(1000); claim = await api.getTotalLossClaim(CASE_ID, "local");
    const response = claim.insurerResponse!; expect(response.processingState).toBe("completed");
    expect(response.recommendation!.state).toBe(data.response.recommendation.state); expect(response.usableOffer!.amountMinorUnits).toBe(2450000);
    const choice = await api.recordTotalLossInsurerResponseDecision(CASE_ID, response.responseId, "local", { clientRequestId: crypto.randomUUID(), workflowRevision: claim.workflow!.revision, recommendationId: response.recommendation!.recommendationId, choice: "ACCEPT_OFFER", offerId: response.usableOffer!.offerId });
    await api.resolveTotalLossCase(CASE_ID, "local", { clientRequestId: crypto.randomUUID(), workflowRevision: choice.workflowRevision, resolutionCode: "ACCEPTED_VERIFIED_OFFER", decisionId: choice.response.decision!.decisionId, offerId: response.usableOffer!.offerId, amountMinorUnits: null, currency: null });
    claim = await api.getTotalLossClaim(CASE_ID, "local"); expect(claim.journey?.nextState).toBe("resolved"); expect(claim.resolution?.amountMinorUnits).toBe(2450000);
    expect((await api.getTotalLossReportDownload(CASE_ID, data.report.reportId, "local")).downloadUrl).toContain("/generated/");
    expect(network).not.toHaveBeenCalled(); resetShowcase(); expect(snapshot().paidAt).toBeNull(); expect(snapshot().records.claim.resolution).toBeNull(); expect(readTotalLossDraft().draft?.step).toBe("choice");
  });
  it("blocks premature payment, other cases, emails and external calls", async () => {
    expect(() => simulatePayment()).toThrow("qualifying review");
    await details.totalLossDetailsService.updateDetails({ caseId: CASE_ID, userId: USER_ID, changes: { insurerVehicleValuation: 25000 }, expectedUpdatedAt: snapshot().details.updatedAt });
    expect((await fetch(`/api/v1/appraisal-cases/${CASE_ID}/analysis`, { method: "POST" })).status).toBe(409);
    await expect(fetch("https://api.stripe.com/v1/payment_intents", { method: "POST" })).rejects.toThrow("Unavailable");
    await expect(fetch("https://app.venfour.com/api/v1/cases")).rejects.toThrow("Unavailable");
    await expect(fetch("/api/v1/appraisal-cases/77777777-7777-4777-8777-777777777777/claim")).rejects.toThrow("Unavailable");
    await expect(previewAuth.sendMagicLink("recipient@example.test", "http://localhost", "local")).rejects.toThrow("cannot contact providers");
    await previewAuth.signOut(); expect((await fetch(`/api/v1/appraisal-cases/${CASE_ID}/claim`)).status).toBe(401); expect(network).not.toHaveBeenCalled();
  });
});
