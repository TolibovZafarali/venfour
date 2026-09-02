import { describe, expect, it } from "vitest";

import type { TotalLossClaimResolver } from "@/features/total-loss-claim/contracts";
import {
  authoritativeTotalLossClaimPath,
  canonicalCompletedAnalysisPath,
  completedAnalysisStage,
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
    ["guide_report", `/total-loss/cases/${CASE_ID}/claim/review/meaning`],
    ["guide_what_next", `/total-loss/cases/${CASE_ID}/claim/review/meaning`],
    ["prepare_request", `/total-loss/cases/${CASE_ID}/claim/review/request`],
    ["awaiting_insurer_response", `/total-loss/cases/${CASE_ID}/claim/review/waiting`],
    ["insurer_response_received", `/total-loss/cases/${CASE_ID}/claim/review/response-received`],
    ["insurer_response_reviewing", `/total-loss/cases/${CASE_ID}/claim/review/response-reviewing`],
    ["insurer_response_reviewed", `/total-loss/cases/${CASE_ID}/claim/review/response-reviewed`],
    ["follow_up_preparation", `/total-loss/cases/${CASE_ID}/claim/review/follow-up`],
    ["insurer_response_review_unavailable", `/total-loss/cases/${CASE_ID}/claim/review/response-reviewing`],
    ["no_dispute", `/total-loss/cases/${CASE_ID}/claim/review/result`],
  ] as const)("routes %s to its case-scoped state", (state, expected) => {
    expect(routeForJourneyState(CASE_ID, state)).toBe(expected);
    expect(authoritativeTotalLossClaimPath(securedResolver(state))).toBe(
      expected,
    );
  });

  it("resumes manual customers at Market for the legacy insurer milestone", () => {
    expect(authoritativeTotalLossClaimPath(securedResolver("guide_insurer_review"), "manual"))
      .toBe(`/total-loss/cases/${CASE_ID}/claim/review/market`);
    expect(routeForJourneyState(CASE_ID, "guide_valuation", "manual"))
      .toBe(`/total-loss/cases/${CASE_ID}/claim/review/market`);
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
    ["activity", "review_waiting"],
    ["review_sent", "review_waiting"],
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
    ["review_meaning", "meaning"],
    ["insurer_review", "insurer"],
    ["review_insurer", "insurer"],
    ["evidence", "market"],
    ["valuation", "market"],
    ["review_market", "market"],
    ["report", "meaning"],
    ["what_next", "meaning"],
    ["review_next", "meaning"],
    ["request", "request"],
    ["send", "request"],
    ["review_request", "request"],
    ["activity", "waiting"],
    ["review_sent", "waiting"],
    ["review_waiting", "waiting"],
    ["review_response", "response"],
    ["review_response_received", "response_received"],
    ["review_response_reviewing", "response_reviewing"],
    ["review_response_reviewed", "response_reviewed"],
    ["review_follow_up", "follow_up"],
  ] as const)("keeps %s links focused on %s", (view, section) => {
    expect(isCompletedAnalysisView(view)).toBe(true);
    expect(completedAnalysisStage(view, new URLSearchParams(), "report")).toBe(section);
  });

  it.each(["checkout", "checkout_return", "processing"] as const)(
    "does not classify %s as a completed analysis view",
    (view) => expect(isCompletedAnalysisView(view)).toBe(false),
  );

  it.each(["insurer", "market", "report"] as const)(
    "preserves the %s details query from shared links",
    (section) => {
      expect(
        completedAnalysisStage(
          "review_result",
          new URLSearchParams({ details: section }),
          "report",
        ),
      ).toBe(section === "report" ? "request" : section);
    },
  );

  it("preserves the insurer selection in legacy evidence links", () => {
    expect(
      completedAnalysisStage(
        "evidence",
        new URLSearchParams({ evidence: "insurer" }),
        "report",
      ),
    ).toBe("insurer");
  });

  it("prioritizes an explicit details link over the legacy evidence query", () => {
    expect(
      completedAnalysisStage(
        "evidence",
        new URLSearchParams({ details: "report", evidence: "insurer" }),
        "report",
      ),
    ).toBe("request");
  });

  it.each([
    ["review_request", "details=unknown", "request"],
    ["evidence", "evidence=unknown", "market"],
    ["overview", "evidence=insurer", "result"],
  ] satisfies ReadonlyArray<readonly [TotalLossClaimWorkflowView, string, string]>)(
    "ignores unrelated or invalid queries for %s links",
    (view, query, section) => {
      expect(completedAnalysisStage(view, new URLSearchParams(query), "report")).toBe(
        section,
      );
    },
  );

  it.each(["review_insurer", "insurer_review", "evidence"] as const)(
    "maps a manual %s link to Market without presenting an insurer review",
    (view) => {
      expect(completedAnalysisStage(view, new URLSearchParams("details=insurer"), "manual"))
        .toBe("market");
      expect(canonicalCompletedAnalysisPath(CASE_ID, view, new URLSearchParams("details=insurer&source=saved"), "manual"))
        .toBe(`/total-loss/cases/${CASE_ID}/claim/review/market?source=saved`);
    },
  );

  it.each([
    ["evidence", "evidence=insurer", "insurer?details=insurer"],
    ["review_market", "details=report", "request?details=report"],
    ["report", "", "meaning"],
    ["review_next", "", "meaning"],
    ["review_sent", "", "waiting"],
    ["review_response", "", "response"],
    ["review_response_received", "", "response-received"],
    ["review_response_reviewing", "", "response-reviewing"],
    ["review_response_reviewed", "", "response-reviewed"],
    ["review_result", "details=market&source=saved", "market?details=market&source=saved"],
  ] satisfies ReadonlyArray<readonly [TotalLossClaimWorkflowView, string, string]>)(
    "canonicalizes %s with %s while retaining valid detail intent",
    (view, query, suffix) => expect(canonicalCompletedAnalysisPath(CASE_ID, view, new URLSearchParams(query), "report"))
      .toBe(`/total-loss/cases/${CASE_ID}/claim/review/${suffix}`),
  );
});
