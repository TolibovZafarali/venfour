import { describe, expect, it } from "vitest";

import type { TotalLossClaimResolver } from "@/features/total-loss-claim/contracts";
import {
  authoritativeTotalLossClaimPath,
  routeForJourneyState,
  totalLossClaimViewPath,
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
    ["guide_result", `/total-loss/cases/${CASE_ID}/claim/review/result`],
    ["guide_insurer_review", `/total-loss/cases/${CASE_ID}/claim/review/insurer`],
    ["guide_valuation", `/total-loss/cases/${CASE_ID}/claim/review/market`],
    ["guide_report", `/total-loss/cases/${CASE_ID}/claim/review/next`],
    ["guide_what_next", `/total-loss/cases/${CASE_ID}/claim/review/next`],
    ["prepare_request", `/total-loss/cases/${CASE_ID}/claim/review/request`],
    ["awaiting_insurer_response", `/total-loss/cases/${CASE_ID}/claim/review/sent`],
    ["no_dispute", `/total-loss/cases/${CASE_ID}/claim/review/result`],
  ] as const)("routes %s to its case-scoped state", (state, expected) => {
    expect(routeForJourneyState(CASE_ID, state)).toBe(expected);
    expect(authoritativeTotalLossClaimPath(securedResolver(state))).toBe(
      expected,
    );
  });

  it.each([
    ["result", "review_result"],
    ["valuation", "review_market"],
    ["report", "review_next"],
    ["insurer_review", "review_insurer"],
    ["send", "review_request"],
    ["what_next", "review_next"],
    ["overview", "review_result"],
    ["evidence", "review_market"],
    ["request", "review_request"],
    ["activity", "review_sent"],
  ] as const)("maps the legacy %s view to the %s review stage", (legacy, stage) => {
    expect(totalLossClaimViewPath(CASE_ID, legacy)).toBe(
      totalLossClaimViewPath(CASE_ID, stage),
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
