import { describe, expect, it } from "vitest";

import type { TotalLossClaimResolver } from "@/features/total-loss-claim/contracts";
import {
  authoritativeTotalLossClaimPath,
  completedAnalysisSection,
  isCompletedAnalysisView,
  routeForJourneyState,
  totalLossClaimViewPath,
  type TotalLossClaimWorkflowView,
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
  ] as const)("preserves the URL for the legacy %s view", (legacy, compatibleView) => {
    expect(totalLossClaimViewPath(CASE_ID, legacy)).toBe(
      totalLossClaimViewPath(CASE_ID, compatibleView),
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

describe("completed analysis deep-link compatibility", () => {
  it.each([
    ["overview", "result"],
    ["result", "result"],
    ["review_result", "result"],
    ["review_meaning", "result"],
    ["insurer_review", "insurer"],
    ["review_insurer", "insurer"],
    ["evidence", "market"],
    ["valuation", "market"],
    ["review_market", "market"],
    ["report", "report"],
    ["what_next", "report"],
    ["review_next", "report"],
    ["request", "request"],
    ["send", "request"],
    ["review_request", "request"],
    ["activity", "sent"],
    ["review_sent", "sent"],
  ] as const)("keeps %s links focused on %s", (view, section) => {
    expect(isCompletedAnalysisView(view)).toBe(true);
    expect(completedAnalysisSection(view, new URLSearchParams())).toBe(section);
  });

  it.each(["checkout", "checkout_return", "processing"] as const)(
    "does not classify %s as a completed analysis view",
    (view) => expect(isCompletedAnalysisView(view)).toBe(false),
  );

  it.each(["insurer", "market", "report"] as const)(
    "preserves the %s details query from shared links",
    (section) => {
      expect(
        completedAnalysisSection(
          "review_result",
          new URLSearchParams({ details: section }),
        ),
      ).toBe(section);
    },
  );

  it("preserves the insurer selection in legacy evidence links", () => {
    expect(
      completedAnalysisSection(
        "evidence",
        new URLSearchParams({ evidence: "insurer" }),
      ),
    ).toBe("insurer");
  });

  it("prioritizes an explicit details link over the legacy evidence query", () => {
    expect(
      completedAnalysisSection(
        "evidence",
        new URLSearchParams({ details: "report", evidence: "insurer" }),
      ),
    ).toBe("report");
  });

  it.each([
    ["review_request", "details=unknown", "request"],
    ["evidence", "evidence=unknown", "market"],
    ["overview", "evidence=insurer", "result"],
  ] satisfies ReadonlyArray<readonly [TotalLossClaimWorkflowView, string, string]>)(
    "ignores unrelated or invalid queries for %s links",
    (view, query, section) => {
      expect(completedAnalysisSection(view, new URLSearchParams(query))).toBe(
        section,
      );
    },
  );
});
