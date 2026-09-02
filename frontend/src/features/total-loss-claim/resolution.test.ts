import { describe, expect, it } from "vitest";

import type { TotalLossClaimSecured, TotalLossInsurerResponse } from "./contracts";
import { canCloseCase, caseIsClosed, currentAcceptedOffer } from "./resolution";

const response: TotalLossInsurerResponse = {
  responseId: "response", clientRequestId: "response-request", receivedAt: "2026-09-02T12:00:00Z", sourceType: "pasted_message", text: "Offer",
  document: null, revisedOffer: null, supersedesResponseId: null, processingState: "completed", failureReason: null, analysis: null, analysisEvidence: null,
  recommendation: { recommendationId: "recommendation", versionNumber: 1, analysisResultId: "analysis", schemaVersion: "1", policyVersion: "2", state: "ACCEPT_OFFER", summary: "Review this offer", reasons: [], reasonCodes: [], limitations: [], caseEvidenceRefs: [], responseEvidenceRefs: [] },
  usableOffer: { offerId: "offer", amountMinorUnits: 2010000, currency: "USD", source: "RESPONSE_TEXT" },
  decision: { decisionId: "decision", clientRequestId: "decision-request", recommendationId: "recommendation", analysisResultId: "analysis", choice: "ACCEPT_OFFER", offerId: "offer", amountMinorUnits: 2010000, currency: "USD", recordedAt: "2026-09-02T12:00:00Z" },
};
function claim(): TotalLossClaimSecured {
  return { state: "secured", caseId: "case", contactEmail: null, insurerResponse: response,
    workflow: { phase: "negotiation", currentTask: "insurer_response_received", revision: 15 },
    commerce: { checkoutAvailable: false, entitlementStatus: "active", nextTask: "insurer_response_reviewed", orderStatus: "paid", paymentStatus: "succeeded" },
  };
}

describe("customer closure availability", () => {
  it("keeps an Accept decision open and binds finalization to its exact saved offer", () => {
    expect(caseIsClosed(claim())).toBe(false);
    expect(canCloseCase(claim())).toBe(true);
    expect(currentAcceptedOffer(claim())).toMatchObject({ decision: { decisionId: "decision" }, offer: { offerId: "offer", amountMinorUnits: 2010000, currency: "USD" } });
  });
  it.each([
    { offerId: "superseded" }, { amountMinorUnits: 1990000 }, { currency: "CAD" },
    { recommendationId: "old-recommendation" }, { analysisResultId: "old-analysis" },
  ])("rejects finalization from an outdated decision %o", (patch) => {
    expect(currentAcceptedOffer({ ...claim(), insurerResponse: { ...response, decision: { ...response.decision!, ...patch } } })).toBeNull();
  });
  it.each(["pending", "processing", "retryable_failed"] as const)("does not expose closure during %s processing", (processingState) => {
    expect(canCloseCase({ ...claim(), insurerResponse: { ...response, processingState } })).toBe(false);
  });
  it("allows manual closure at initial waiting without an offer and denies closure after terminal state", () => {
    const waiting = { ...claim(), insurerResponse: null, workflow: { phase: "negotiation" as const, currentTask: "awaiting_insurer_response", revision: 10 } };
    expect(canCloseCase(waiting)).toBe(true);
    expect(currentAcceptedOffer(waiting)).toBeNull();
    const closed = { ...waiting, workflow: { ...waiting.workflow, phase: "resolution" as const, currentTask: "resolved" } };
    expect(caseIsClosed(closed)).toBe(true);
    expect(canCloseCase(closed)).toBe(false);
  });
  it("requires paid access while preserving refunded access retained", () => {
    expect(canCloseCase({ ...claim(), commerce: { ...claim().commerce!, entitlementStatus: "suspended" } })).toBe(false);
    expect(canCloseCase({ ...claim(), commerce: { ...claim().commerce!, entitlementStatus: "refunded_access_retained" } })).toBe(true);
  });
});
