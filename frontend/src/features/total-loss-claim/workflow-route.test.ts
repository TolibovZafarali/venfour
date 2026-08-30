import { describe, expect, it } from "vitest";

import type { TotalLossClaimResolver } from "@/features/total-loss-claim/contracts";
import {
  authoritativeTotalLossClaimPath,
  routeForJourneyState,
} from "@/features/total-loss-claim/workflow-route";

const CASE_ID = "33333333-3333-4333-8333-333333333333";

function securedResolver(
  nextState: NonNullable<
    TotalLossClaimResolver["journey"]
  >["nextState"],
): TotalLossClaimResolver {
  return {
    caseId: CASE_ID,
    commerce: {
      checkoutAvailable: false,
      entitlementStatus: "active",
      nextTask: "report_ready",
      orderStatus: "paid",
      paymentStatus: "succeeded",
    },
    contactEmail: null,
    education: null,
    journey: {
      fulfillmentState: "report_ready",
      nextState,
      retryable: false,
    },
    messageDraft: null,
    report: null,
    sendingDetails: null,
    state: "secured",
    workflow: {
      currentTask: "report_ready",
      phase: "initial_request",
      revision: 4,
    },
  };
}

describe("total-loss claim authoritative route decisions", () => {
  it.each([
    ["checkout", `/total-loss/cases/${CASE_ID}/claim/checkout`],
    ["checkout_confirmation", `/total-loss/cases/${CASE_ID}/claim/checkout`],
    ["processing", `/total-loss/cases/${CASE_ID}/claim/processing`],
    ["guide_result", `/total-loss/cases/${CASE_ID}/claim/guide/result`],
    ["guide_insurer_review", `/total-loss/cases/${CASE_ID}/claim/guide/insurer-review`],
    ["guide_valuation", `/total-loss/cases/${CASE_ID}/claim/guide/valuation`],
    ["guide_report", `/total-loss/cases/${CASE_ID}/claim/guide/report`],
    ["guide_what_next", `/total-loss/cases/${CASE_ID}/claim/guide/what-next`],
    ["prepare_request", `/total-loss/cases/${CASE_ID}/claim/guide/send`],
    ["awaiting_insurer_response", `/total-loss/cases/${CASE_ID}/claim/guide/send`],
    ["no_dispute", `/total-loss/cases/${CASE_ID}/claim/guide/result`],
  ] as const)("routes %s to its case-scoped state", (state, expected) => {
    expect(routeForJourneyState(CASE_ID, state)).toBe(expected);
    expect(authoritativeTotalLossClaimPath(securedResolver(state))).toBe(
      expected,
    );
  });

  it("keeps the pre-Milestone-6 secured projection backward compatible", () => {
    const legacy: TotalLossClaimResolver = {
      caseId: CASE_ID,
      commerce: {
        checkoutAvailable: true,
        entitlementStatus: null,
        nextTask: "checkout",
        orderStatus: null,
        paymentStatus: null,
      },
      contactEmail: null,
      state: "secured",
      workflow: { currentTask: "secure_claim", phase: "review", revision: 1 },
    };

    expect(authoritativeTotalLossClaimPath(legacy)).toBe(
      `/total-loss/cases/${CASE_ID}/claim/checkout`,
    );
  });
});
