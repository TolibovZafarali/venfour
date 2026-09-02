import { beforeEach, describe, expect, it } from "vitest";

import { clearResponseDecisionAttempt, readResponseDecisionAttempt, responseDecisionAttemptKey, writeResponseDecisionAttempt } from "./response-decision-attempt";

const recommendationId = "11111111-1111-4111-8111-111111111111";
const input = {
  clientRequestId: "22222222-2222-4222-8222-222222222222", recommendationId,
  choice: "ACCEPT_OFFER" as const, offerId: "33333333-3333-4333-8333-333333333333", workflowRevision: 15,
};
const offer = { offerId: input.offerId, amountMinorUnits: 2_010_000, currency: "USD", source: "CUSTOMER_RECORDED" as const };

describe("response decision retry identity", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("does not create an attempt just because a recommendation is viewed", () => {
    const key = responseDecisionAttemptKey("owner", "case", "response", recommendationId);
    expect(readResponseDecisionAttempt(key, recommendationId, offer)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("persists the exact explicit request and removes it only after acknowledgement", () => {
    const key = responseDecisionAttemptKey("owner", "case", "response", recommendationId);
    expect(writeResponseDecisionAttempt(key, input)).toBe(true);
    expect(readResponseDecisionAttempt(key, recommendationId, offer)).toEqual(input);
    clearResponseDecisionAttempt(key);
    expect(readResponseDecisionAttempt(key, recommendationId, offer)).toBeNull();
  });

  it.each([
    ["other", "case", "response", recommendationId],
    ["owner", "other", "response", recommendationId],
    ["owner", "case", "correction", recommendationId],
    ["owner", "case", "response", "44444444-4444-4444-8444-444444444444"],
  ])("isolates a saved attempt from another identity %s/%s/%s/%s", (owner, caseId, responseId, recommendation) => {
    writeResponseDecisionAttempt(responseDecisionAttemptKey("owner", "case", "response", recommendationId), input);
    expect(readResponseDecisionAttempt(responseDecisionAttemptKey(owner, caseId, responseId, recommendation), recommendation, offer)).toBeNull();
  });

  it("rejects changed offer identities and malformed or cross-choice saved input", () => {
    const key = responseDecisionAttemptKey("owner", "case", "response", recommendationId);
    writeResponseDecisionAttempt(key, input);
    expect(readResponseDecisionAttempt(key, recommendationId, { ...offer, offerId: recommendationId })).toBeNull();
    expect(readResponseDecisionAttempt(key, recommendationId, null)).toBeNull();
    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, ...input, choice: "CONTINUE_CHALLENGING" }));
    expect(readResponseDecisionAttempt(key, recommendationId, offer)).toBeNull();
    window.sessionStorage.setItem(key, "not-json");
    expect(readResponseDecisionAttempt(key, recommendationId, offer)).toBeNull();
  });
});
