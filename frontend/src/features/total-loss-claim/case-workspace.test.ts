import { describe, expect, it } from "vitest";

import { createCaseWorkspace } from "./case-workspace";
import {
  TOTAL_LOSS_EDUCATION_STEPS,
  type TotalLossClaimJourneyState,
  type TotalLossClaimSecured,
  type TotalLossEducationStep,
  type TotalLossInsurerResponse,
  type TotalLossInsurerResponseAnalysis,
  type TotalLossPublishedReport,
  type TotalLossSentCommunication,
} from "./contracts";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-09-02T18:00:00.000Z";
const BASE = `/total-loss/cases/${CASE_ID}/claim/review`;
const sentMessage: TotalLossSentCommunication = {
  body: "Please review the attached evidence package.",
  communicationId: "11111111-1111-4111-8111-111111111111",
  createdAt: NOW,
  customerReportedSentAt: NOW,
  messageVersionId: "22222222-2222-4222-8222-222222222222",
  negotiationRoundId: "77777777-7777-4777-8777-777777777777",
  recipient: "adjuster@example.test",
  reportVersionId: REPORT_ID,
  state: "sent",
  subject: "Please review the valuation",
  versionNumber: 1,
};

const report: TotalLossPublishedReport = {
  conclusion: {
    classificationLabel: "Potential undervaluation",
    continuingSupported: true,
    indicatedDifference: null,
    insurerValuation: { amountMinorUnits: 1900000, currency: "USD", formatted: "$19,000" },
    limitations: [],
    preliminaryComparison: null,
    summary: "The evidence supports requesting a review.",
    supportedRange: null,
  },
  insurerEvidence: {
    adjustmentContext: null,
    comparableCount: 0,
    comparables: [],
    insurerName: null,
    methodologyStatement: null,
    summary: {
      adjustedValueMissingCount: 0,
      adjustedValues: null,
      advertisedPriceMissingCount: 0,
      advertisedPrices: null,
      fullyDisclosedAdjustmentCount: 0,
      partiallyDisclosedAdjustmentCount: 0,
      totalCount: 0,
      unavailableAdjustmentCount: 0,
      undisclosedAdjustmentCount: 0,
    },
  },
  issueDate: "2026-09-02",
  marketEvidence: {
    comparables: [],
    evidenceDateContext: { currentObservedDate: null, historicalEvidenceDate: null, lossDate: null },
    methodologyStatement: null,
    primary: null,
    secondary: null,
  },
  reportId: REPORT_ID,
  status: "published",
  subjectVehicle: { description: "2022 Example Sedan" },
  suggestedFilename: "Vehicle_Valuation_Report.pdf",
  versionLabel: "v1",
  versionNumber: 1,
};

function claim(
  nextState: TotalLossClaimJourneyState = "guide_result",
  completed: readonly TotalLossEducationStep[] = [],
  skipped: readonly TotalLossEducationStep[] = [],
): TotalLossClaimSecured {
  return {
    caseId: CASE_ID,
    commerce: null,
    contactEmail: null,
    state: "secured",
    workflow: { phase: "initial_request", currentTask: nextState, revision: 8 },
    journey: { nextState, fulfillmentState: "report_ready", retryable: false },
    negotiationHistory: ["awaiting_insurer_response", "insurer_response_received", "insurer_response_reviewing", "insurer_response_reviewed", "insurer_response_review_unavailable", "follow_up_preparation"].includes(nextState)
      ? [{ negotiationRoundId: sentMessage.negotiationRoundId, roundNumber: 1, outbound: sentMessage, responses: [], followUp: null, supersededFollowUpDrafts: [] }]
      : [],
    education: {
      reportVersionId: REPORT_ID,
      steps: Object.fromEntries(TOTAL_LOSS_EDUCATION_STEPS.map((step) => [step, {
        completedAt: completed.includes(step) ? NOW : null,
        skippedAt: skipped.includes(step) ? NOW : null,
        viewedAt: null,
      }])) as NonNullable<TotalLossClaimSecured["education"]>["steps"],
    },
  };
}

const analysis: TotalLossInsurerResponseAnalysis = {
  schemaVersion: "1",
  analysisSummary: { whatInsurerSaid: "The offer was revised.", whatThisMeans: "Review the response.", caseEvidenceRefs: [], responseEvidenceRefs: [] },
  insurerPosition: { category: "REVISED_OFFER", summary: "Revised offer", responseEvidenceRefs: [] },
  revisedOffer: { status: "ABSENT", amountMinorUnits: null, currency: null, responseEvidenceRefs: [], source: null, visualSourceInterpretation: null },
  requestDisposition: { category: "PARTIALLY_ACCEPTED", summary: "Some points remain.", caseEvidenceRefs: [], responseEvidenceRefs: [] },
  responsePoints: [],
  insurerArguments: [],
  importantChanges: [],
  unresolvedIssues: [],
  recommendedNextStep: { category: "REVIEW_RESPONSE", explanation: "Review the response.", caseEvidenceRefs: [], responseEvidenceRefs: [] },
  confidence: "MEDIUM",
  uncertainties: [],
  inputCoverage: { pastedText: "AVAILABLE", document: "NOT_PROVIDED", limitations: [] },
  untrustedInstructionDetected: false,
  untrustedInstructionFollowed: false,
};

function response(processingState: TotalLossInsurerResponse["processingState"]): TotalLossInsurerResponse {
  return {
    analysis: processingState === "completed" ? analysis : null,
    analysisEvidence: processingState === "completed" ? { caseEvidence: [], responseEvidence: [] } : null,
    clientRequestId: "55555555-5555-4555-8555-555555555555",
    document: null,
    failureReason: processingState === "retryable_failed" ? "generic" : null,
    recommendation: null,
    usableOffer: null,
    decision: null,
    processingState,
    receivedAt: NOW,
    responseId: "66666666-6666-4666-8666-666666666666",
    revisedOffer: null,
    sourceType: "pasted_message",
    supersedesResponseId: null,
    text: "We revised our offer.",
  };
}

function workspace(savedClaim = claim(), intakeMode: "manual" | "report" = "report", selectedReport = report, hasDraft = false) {
  return createCaseWorkspace({ claim: savedClaim, report: selectedReport, intakeMode, hasDraft });
}

describe("persistent case workspace projection", () => {
  it("retains a confirmed initial request in the closed workspace from its durable communication", () => {
    const saved = claim("awaiting_insurer_response", TOTAL_LOSS_EDUCATION_STEPS);
    const closed: TotalLossClaimSecured = {
      ...saved,
      journey: { nextState: "resolved", fulfillmentState: "resolved", retryable: false },
      workflow: { phase: "resolution", currentTask: "resolved", revision: 9 },
      resolution: { code: "CUSTOMER_STOPPED_PURSUING", resolvedAt: NOW, customerConfirmed: true, clientRequestId: CASE_ID, offerId: null, amountMinorUnits: null, currency: null, amountSource: null, recommendationId: null, decisionId: null, responseId: null },
    };

    expect(workspace(closed).sections.find((section) => section.stage === "request")).toMatchObject({ label: "Initial request", available: true, complete: true });
    expect(workspace({ ...closed, negotiationHistory: [] }).sections.some((section) => section.stage === "request")).toBe(false);
  });

  it("opens closed cases in the existing workspace with education and saved responses available", () => {
    const saved: TotalLossClaimSecured = { ...claim("resolved"), insurerResponse: response("completed"),
      workflow: { phase: "resolution", currentTask: "resolved", revision: 9 },
      resolution: { code: "RESOLVED_WITH_INSURER", resolvedAt: NOW, customerConfirmed: true, clientRequestId: CASE_ID, offerId: null, amountMinorUnits: null, currency: null, amountSource: null, recommendationId: null, decisionId: null, responseId: null },
    };
    const result = workspace(saved);
    expect(result.currentPath).toBe(`${BASE}/resolution`);
    expect(result.currentLabel).toBe("Case closed");
    expect(result.progress.isCaseClosed).toBe(true);
    expect(result.sections.filter((section) => ["result", "insurer", "market", "meaning", "response_received", "response_reviewed", "resolution"].includes(section.stage)).every((section) => section.available)).toBe(true);
    expect(result.sections.some((section) => section.stage === "waiting")).toBe(false);
    expect(result.sections.find((section) => section.stage === "result")?.complete).toBe(false);
  });
  it.each(["report", "manual"] as const)("resumes the follow-up and retains response and initial-request history for %s intake", (intakeMode) => {
    const savedResponse = response("completed");
    const continued = { ...savedResponse, decision: {
      decisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recommendationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", analysisResultId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      choice: "CONTINUE_CHALLENGING" as const, offerId: null, amountMinorUnits: null, currency: null, recordedAt: NOW,
    } };
    const saved = { ...claim("follow_up_preparation", TOTAL_LOSS_EDUCATION_STEPS), insurerResponse: continued };
    const result = workspace(saved, intakeMode);
    expect(result.currentPath).toBe(`${BASE}/follow-up`);
    expect(result.currentLabel).toBe("Prepare follow-up");
    expect(result.sections.find((section) => section.stage === "follow_up")).toMatchObject({ available: true, complete: false, current: true });
    expect(result.sections.find((section) => section.stage === "request")).toMatchObject({ label: "Initial request", available: true, complete: true });
    expect(result.sections.find((section) => section.stage === "response_reviewed")).toMatchObject({ available: true, complete: true });
    const accepted = workspace({ ...saved, insurerResponse: { ...continued, decision: { ...continued.decision, choice: "ACCEPT_OFFER" } } }, intakeMode);
    expect(accepted.sections.some((section) => section.stage === "follow_up")).toBe(false);
  });
  it("starts with only the result reachable and no implied completed sections", () => {
    const result = workspace();
    expect(result.currentPath).toBe(`${BASE}/result`);
    expect(result.currentStage).toBe("result");
    expect(result.sections.filter((section) => section.available).map((section) => section.stage)).toEqual(["result"]);
    expect(result.sections.some((section) => section.complete)).toBe(false);
    expect(result.sections.find((section) => section.stage === "response_received")).toMatchObject({ available: false, complete: false });
    const reviewed = workspace({ ...claim("insurer_response_reviewed"), insurerResponse: response("completed") });
    expect(result.sections).toHaveLength(reviewed.sections.length);
    expect(result.sections.findIndex((section) => section.stage === "waiting")).toBe(reviewed.sections.findIndex((section) => section.stage === "waiting"));
  });

  it("keeps completed education reachable while unlocking the next section", () => {
    const result = workspace(claim("guide_valuation", ["result", "insurer_review"]));
    expect(result.sections.filter((section) => section.available).map((section) => section.stage)).toEqual(["result", "insurer", "market"]);
    expect(result.sections.filter((section) => section.complete).map((section) => section.stage)).toEqual(["result", "insurer"]);
    expect(result.sections.find((section) => section.current)?.stage).toBe("market");
  });

  it("omits insurer review for manual intake and follows its canonical market route", () => {
    const result = workspace(claim("guide_insurer_review", ["result"]), "manual");
    expect(result.currentPath).toBe(`${BASE}/market`);
    expect(result.currentStage).toBe("market");
    expect(result.progress.position).toBe(2);
    expect(result.sections.map((section) => section.stage)).not.toContain("insurer");
    expect(result.sections.find((section) => section.stage === "market")?.available).toBe(true);
    expect(workspace(claim("guide_report", ["result", "insurer_review", "valuation"]), "manual").sections.find((section) => section.stage === "market")?.complete).toBe(true);
  });

  it("respects saved skip access without inventing completion for unmarked sections", () => {
    const result = workspace(claim("prepare_request", ["result"], ["valuation"]));
    expect(result.sections.filter((section) => section.available).map((section) => section.stage)).toEqual(["result", "insurer", "market", "meaning", "request"]);
    expect(result.sections.filter((section) => section.complete).map((section) => section.stage)).toEqual(["result", "market"]);
  });

  it("keeps a saved completed section accessible independently of other missing markers", () => {
    const result = workspace(claim("guide_result", ["valuation"]));
    expect(result.sections.find((section) => section.stage === "market")).toMatchObject({ available: true, complete: true, current: false });
    expect(result.currentStage).toBe("result");
    expect(result.sections.find((section) => section.stage === "request")?.available).toBe(false);
  });

  it("does not apply another report version's completion to the current report", () => {
    const saved = claim("guide_result", TOTAL_LOSS_EDUCATION_STEPS);
    const result = workspace({ ...saved, education: { ...saved.education!, reportVersionId: "other-report" } });
    expect(result.sections.filter((section) => section.available).map((section) => section.stage)).toEqual(["result"]);
    expect(result.sections.some((section) => section.complete)).toBe(false);
  });

  it("keeps request and waiting available after sending without completing active waiting", () => {
    const result = workspace(claim("awaiting_insurer_response", TOTAL_LOSS_EDUCATION_STEPS));
    expect(result.currentPath).toBe(`${BASE}/waiting`);
    expect(result.sections.find((section) => section.stage === "request")).toMatchObject({ label: "Initial request", href: `${BASE}/request`, available: true, complete: true });
    expect(result.sections.find((section) => section.stage === "waiting")).toMatchObject({ available: true, complete: false, current: true });
    expect(result.progress.current.id).toBe("waiting_for_insurer");
  });

  it("uses the saved current stage when earlier section links are inspected or revisited", () => {
    const saved = claim("awaiting_insurer_response", TOTAL_LOSS_EDUCATION_STEPS);
    const before = structuredClone(saved);
    const result = workspace(saved);
    for (const section of result.sections.filter((section) => section.available)) {
      expect(section.href).toContain(BASE);
      expect(workspace(saved).progress).toEqual(result.progress);
      expect(workspace(saved).currentPath).toBe(`${BASE}/waiting`);
    }
    expect(saved).toEqual(before);
  });

  it.each([
    ["awaiting_insurer_response", "waiting"],
    ["insurer_response_reviewed", "response_reviewed"],
    ["follow_up_preparation", "follow_up"],
    ["resolved", "resolution"],
  ] as const)("uses the authoritative %s journey when the saved response and legacy task describe another step", (nextState, currentStage) => {
    const saved: TotalLossClaimSecured = {
      ...claim(nextState, TOTAL_LOSS_EDUCATION_STEPS),
      insurerResponse: response("completed"),
      workflow: { phase: "negotiation", currentTask: "insurer_response_reviewed", revision: 20 },
    };
    const before = structuredClone(saved);
    const result = workspace(saved);

    expect(result.currentStage).toBe(currentStage);
    expect(result.currentPath).toBe(`${BASE}/${currentStage.replaceAll("_", "-")}`);
    expect(saved).toEqual(before);
  });

  it("distinguishes preparing and sending at the authoritative request stage", () => {
    const saved = claim("prepare_request", TOTAL_LOSS_EDUCATION_STEPS.filter((step) => step !== "send"));
    expect(workspace(saved).currentLabel).toBe("Prepare request");
    expect(workspace(saved, "report", report, true).currentLabel).toBe("Send request");
    expect(workspace(saved).sections.find((section) => section.stage === "request")).toMatchObject({ available: true, complete: false });
  });

  it.each([
    ["insurer_response_received", "pending", "response_received", "response_reviewing", false],
    ["insurer_response_reviewing", "processing", "response_reviewing", "response_reviewing", false],
    ["insurer_response_reviewed", "completed", "response_reviewed", "response_reviewed", true],
    ["insurer_response_review_unavailable", "retryable_failed", "response_reviewing", "response_reviewing", false],
  ] as const)("preserves history and the current stage for %s", (state, processingState, currentStage, reviewStage, complete) => {
    const result = workspace({ ...claim(state, TOTAL_LOSS_EDUCATION_STEPS), insurerResponse: response(processingState) });
    expect(result.currentStage).toBe(currentStage);
    expect(result.sections.find((section) => section.stage === "waiting")).toMatchObject({ available: true, complete: true, current: false });
    expect(result.sections.find((section) => section.stage === "response_received")).toMatchObject({ label: "Insurer response", href: `${BASE}/response-received?view=saved`, available: true, complete: true });
    expect(result.currentPath).not.toContain("?");
    expect(result.sections.find((section) => section.label === "Response review")).toMatchObject({ stage: reviewStage, available: state !== "insurer_response_received", complete });
    expect(result.sections.find((section) => section.stage === "request")?.label).toBe("Initial request");
    if (state === "insurer_response_review_unavailable") expect(result.currentLabel).toBe("Response review needs attention");
  });

  it("does not declare review completion without the saved analysis and evidence", () => {
    const result = workspace({ ...claim("insurer_response_reviewing", TOTAL_LOSS_EDUCATION_STEPS), insurerResponse: { ...response("completed"), analysisEvidence: null } });
    expect(result.sections.find((section) => section.label === "Response review")).toMatchObject({ stage: "response_reviewing", complete: false });
  });

  it("retains the existing no-dispute route without adding request or closure semantics", () => {
    const unsupportedReport = { ...report, conclusion: { ...report.conclusion, continuingSupported: false } };
    const result = workspace(claim("no_dispute", ["result", "insurer_review", "valuation"]), "report", unsupportedReport);
    expect(result.currentPath).toBe(`${BASE}/result`);
    expect(result.progress.total).toBe(4);
    expect(result.sections.map((section) => section.stage)).toEqual(["result", "insurer", "market", "meaning"]);
    expect(result.sections.find((section) => section.stage === "meaning")?.available).toBe(true);
  });

  it("preserves a sent request if a later report no longer supports continuation", () => {
    const unsupportedReport = { ...report, conclusion: { ...report.conclusion, continuingSupported: false } };
    const result = workspace(claim("awaiting_insurer_response"), "manual", unsupportedReport);
    expect(result.currentPath).toBe(`${BASE}/waiting`);
    expect(result.sections.find((section) => section.stage === "request")).toMatchObject({ available: true, complete: true });
    expect(result.sections.find((section) => section.stage === "waiting")).toMatchObject({ available: true, complete: false });
  });
});
