import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { CompletedReviewNavigationHostContext, CompletedReviewProgressHostContext } from "@/components/completed-review-progress-host";
import {
  TotalLossDependenciesProvider,
  type TotalLossDependencies,
} from "@/features/total-loss/dependencies";
import { CompletedAnalysis } from "@/features/total-loss-claim/components/completed-analysis";
import type * as MessagePreparationComponents from "@/features/total-loss-claim/components/message-preparation";
import {
  TOTAL_LOSS_EDUCATION_STEPS,
  type TotalLossClaimJourneyState,
  type TotalLossClaimSecured,
  type TotalLossEducationStep,
  type TotalLossInsurerResponse,
  type TotalLossInsurerResponseAnalysis,
  type TotalLossPublishedReport,
  type TotalLossResponseDecisionInput,
  type TotalLossResponseRecommendation,
} from "@/features/total-loss-claim/contracts";
import { totalLossClaimQueryKeys, useTotalLossClaimQuery } from "@/features/total-loss-claim/queries";
import type { TotalLossClaimWorkflowView } from "@/features/total-loss-claim/workflow-route";
import { server } from "@/test/mocks/server";

const request = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/features/total-loss-claim/components/message-preparation", async (importOriginal) => ({
  ...await importOriginal<typeof MessagePreparationComponents>(),
  MessagePreparation: (props: { readonly claim: TotalLossClaimSecured }) => {
    request.render(props);
    return <><h1>{props.claim.messageDraft ? "Review and send your request" : "Prepare your request"}</h1><div data-testid="request-controls">Request controls</div></>;
  },
}));

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-29T18:00:00.000Z";
const BASE = `/total-loss/cases/${CASE_ID}/claim`;
const API = "*/api/v1/appraisal-cases/:caseId";
const RESPONSE_EVIDENCE_REF = `response_${"a".repeat(64)}`;
const CUSTOMER_OFFER_EVIDENCE_REF = `response_${"c".repeat(64)}`;
const CASE_EVIDENCE_REF = `case_${"b".repeat(64)}`;
const BEFORE_MEANING: TotalLossEducationStep[] = [
  "result", "insurer_review", "valuation",
];
const BEFORE_REQUEST: TotalLossEducationStep[] = [
  ...BEFORE_MEANING, "report", "what_next",
];

function money(amountMinorUnits: number, formatted: string) {
  return { amountMinorUnits, currency: "USD", formatted };
}

function reviewedResponseAnalysis(): TotalLossInsurerResponseAnalysis {
  return {
    schemaVersion: "1",
    analysisSummary: {
      whatInsurerSaid:
        "The insurer increased the offer but did not address the market listings.",
      whatThisMeans:
        "The offer changed, while the main market-evidence question remains unresolved.",
      responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
      caseEvidenceRefs: [CASE_EVIDENCE_REF],
    },
    insurerPosition: {
      category: "REVISED_OFFER",
      summary: "The insurer revised its offer without accepting the full request.",
      responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
    },
    revisedOffer: {
      status: "PRESENT",
      amountMinorUnits: 2_010_000,
      currency: "USD",
      source: "BOTH",
      responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
      visualSourceInterpretation: null,
    },
    requestDisposition: {
      category: "PARTIALLY_ACCEPTED",
      summary: "The insurer increased the offer but did not address every point.",
      responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
      caseEvidenceRefs: [CASE_EVIDENCE_REF],
    },
    responsePoints: [
      {
        topic: "Requested valuation review",
        disposition: "ACCEPTED",
        whatInsurerSaid: "A revised offer of $20,100 is available.",
        whatThisMeans: "The offer increased, but it remains below the selected median.",
        responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
        caseEvidenceRefs: [CASE_EVIDENCE_REF],
        confidence: "HIGH",
      },
    ],
    insurerArguments: [
      {
        argument: "The original comparable set remains appropriate.",
        whatItReliesOn: "The insurer repeated its prior comparable methodology.",
        responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
        caseEvidenceRefs: [CASE_EVIDENCE_REF],
      },
    ],
    importantChanges: [
      {
        description: "The insurer offer increased to $20,100.",
        responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
        caseEvidenceRefs: [CASE_EVIDENCE_REF],
      },
    ],
    unresolvedIssues: [
      {
        description: "The selected market listings were not addressed.",
        responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
        caseEvidenceRefs: [CASE_EVIDENCE_REF],
      },
    ],
    recommendedNextStep: {
      category: "REVIEW_REVISED_OFFER",
      explanation: "Review the revised amount and the unresolved market-evidence issue.",
      responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
      caseEvidenceRefs: [CASE_EVIDENCE_REF],
    },
    confidence: "HIGH",
    uncertainties: [],
    inputCoverage: {
      pastedText: "AVAILABLE",
      document: "NOT_PROVIDED",
      limitations: [],
    },
    untrustedInstructionDetected: false,
    untrustedInstructionFollowed: false,
  };
}

function reviewedResponseEvidence() {
  return {
    responseEvidence: [
      {
        evidenceRef: RESPONSE_EVIDENCE_REF,
        sourceType: "PASTED_TEXT" as const,
        content: "We can revise the offer to $20,100.",
        pageNumber: null,
      },
      {
        evidenceRef: CUSTOMER_OFFER_EVIDENCE_REF,
        sourceType: "CUSTOMER_SUPPLIED_OFFER" as const,
        content: null,
        pageNumber: null,
      },
    ],
    caseEvidence: [{
      evidenceRef: CASE_EVIDENCE_REF,
      evidenceType: "CUSTOMER_REQUEST" as const,
      summary: "Please review the valuation and selected market evidence.",
      amountMinorUnits: null,
      currency: null,
    }],
  };
}

function savedInsurerResponse(
  processingState: TotalLossInsurerResponse["processingState"],
  analysis: TotalLossInsurerResponseAnalysis | null = null,
  failureReason: TotalLossInsurerResponse["failureReason"] =
    processingState === "retryable_failed" ||
    processingState === "terminal_failed"
      ? "generic"
      : processingState === "unsupported"
        ? "unsupported_document"
        : null,
): TotalLossInsurerResponse {
  return {
    analysis,
    analysisEvidence: analysis ? reviewedResponseEvidence() : null,
    clientRequestId: "88888888-8888-4888-8888-888888888888",
    document: null,
    failureReason,
    recommendation: null,
    usableOffer: null,
    decision: null,
    processingState,
    receivedAt: NOW,
    responseId: "99999999-9999-4999-8999-999999999999",
    revisedOffer: { amountMinorUnits: 2_010_000, currency: "USD" },
    sourceType: "pasted_message",
    supersedesResponseId: null,
    text: "We can revise the offer to $20,100.",
  };
}

function waitingClaim(): TotalLossClaimSecured {
  return {
    ...claimProjection([...BEFORE_REQUEST, "send"]),
    journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
    workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
  };
}

function responseClaim(response = savedInsurerResponse("pending")): TotalLossClaimSecured {
  return {
    ...waitingClaim(),
    insurerResponse: response,
    journey: { fulfillmentState: "insurer_response_reviewing", nextState: "insurer_response_reviewing", retryable: false },
    workflow: { currentTask: "insurer_response_reviewing", phase: "negotiation", revision: 14 },
  };
}

function recommendedResponse(state: TotalLossResponseRecommendation["state"] = "CONTINUE_CHALLENGING", usable = true): TotalLossInsurerResponse {
  return {
    ...savedInsurerResponse("completed", reviewedResponseAnalysis()),
    recommendation: {
      recommendationId: "11111111-1111-4111-8111-111111111111",
      versionNumber: 1,
      analysisResultId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      schemaVersion: "1", policyVersion: "2", state,
      summary: "The saved valuation evidence supports this recommendation.",
      reasons: ["The revised amount was compared with the saved evidence range."],
      reasonCodes: ["OFFER_COMPARED_WITH_SAVED_EVIDENCE"],
      limitations: ["Advertised prices do not guarantee a settlement."],
      responseEvidenceRefs: [RESPONSE_EVIDENCE_REF], caseEvidenceRefs: [CASE_EVIDENCE_REF],
    },
    usableOffer: usable ? { offerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", amountMinorUnits: 2_010_000, currency: "USD", source: "CUSTOMER_RECORDED" } : null,
  };
}

function reviewedClaim(response = recommendedResponse()): TotalLossClaimSecured {
  return {
    ...responseClaim(response),
    journey: { fulfillmentState: "insurer_response_reviewed", nextState: "insurer_response_reviewed", retryable: false },
    workflow: { currentTask: "insurer_response_reviewed", phase: "negotiation", revision: 15 },
  };
}

function decisionResponse(response: TotalLossInsurerResponse, input: TotalLossResponseDecisionInput): TotalLossInsurerResponse {
  return {
    ...response,
    decision: {
      decisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", clientRequestId: input.clientRequestId,
      recommendationId: input.recommendationId, analysisResultId: response.recommendation!.analysisResultId,
      choice: input.choice, offerId: input.offerId,
      amountMinorUnits: input.choice === "ACCEPT_OFFER" ? response.usableOffer!.amountMinorUnits : null,
      currency: input.choice === "ACCEPT_OFFER" ? response.usableOffer!.currency : null, recordedAt: NOW,
    },
  };
}

function followUpJourneyClaim(sent = false): TotalLossClaimSecured {
  const response = recommendedResponse();
  const selected = decisionResponse(response, {
    clientRequestId: USER_ID, recommendationId: response.recommendation!.recommendationId, choice: "CONTINUE_CHALLENGING", offerId: null, workflowRevision: 15,
  });
  const draft = {
    ...claimProjection().messageDraft!, draftId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", purpose: "follow_up_reconsideration" as const,
    body: "Thank you for your response. Please explain how you considered the previous evidence.", subject: "Follow-up request - CLM-42",
  };
  const message = { ...draft, recipient: draft.recipient!, messageVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff", versionNumber: 1, state: "prepared" as const, createdAt: NOW };
  return {
    ...reviewedClaim(selected),
    workflow: { phase: "negotiation", currentTask: sent ? "awaiting_insurer_response" : "follow_up_preparation", revision: 16 },
    journey: { fulfillmentState: sent ? "awaiting_insurer_response" : "follow_up_preparation", nextState: sent ? "awaiting_insurer_response" : "follow_up_preparation", retryable: false },
    followUp: {
      state: sent ? "sent" : "draft", decisionId: selected.decision!.decisionId, responseId: selected.responseId,
      analysisResultId: selected.decision!.analysisResultId, reportVersionId: REPORT_ID, draft,
      preparedMessage: message, sentMessage: sent ? { ...message, state: "sent", customerReportedSentAt: NOW, communicationId: "12121212-1212-4212-8212-121212121212", negotiationRoundId: "13131313-1313-4313-8313-131313131313" } : null,
      reasonCode: null,
    },
  };
}

function responseWithDocument(processingState: TotalLossInsurerResponse["processingState"] = "pending") {
  return {
    ...savedInsurerResponse(processingState, processingState === "completed" ? reviewedResponseAnalysis() : null),
    document: {
      byteSize: 11,
      documentId: "77777777-7777-4777-8777-777777777777",
      mediaType: "image/png" as const,
      originalFilename: "insurer-response.png",
    },
    sourceType: "uploaded_document" as const,
  };
}

function responseFile(lastByte = 3) {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, lastByte])],
    "insurer-response.png",
    { type: "image/png" },
  );
}

function publicInsurerResponseProjection(
  response: TotalLossInsurerResponse,
) {
  const projection: Record<string, unknown> = { ...response };
  delete projection.analysis;
  delete projection.analysisEvidence;
  return projection;
}

function publicClaimProjection(claim: TotalLossClaimSecured) {
  if (
    !claim.insurerResponse ||
    claim.insurerResponse.processingState === "completed"
  ) {
    return claim;
  }
  return {
    ...claim,
    insurerResponse: publicInsurerResponseProjection(claim.insurerResponse),
  };
}

function publishedReport(): TotalLossPublishedReport {
  return {
    conclusion: {
      classificationLabel: "Potential undervaluation",
      continuingSupported: true,
      indicatedDifference: money(144400, "$1,444"),
      insurerValuation: money(1904600, "$19,046"),
      limitations: [
        "Advertised prices are not completed-sale prices.",
        "No independent condition adjustment was calculated.",
        "The full package records additional provider coverage limitations.",
      ],
      preliminaryComparison: { status: "CONFIRMED", summary: "The completed review confirmed the saved result." },
      summary: "The completed evidence supports a written reconsideration request.",
      supportedRange: {
        low: money(1980000, "$19,800"),
        median: money(2049000, "$20,490"),
        high: money(2226300, "$22,263"),
        evidenceBasis: "Current advertised-price evidence",
      },
    },
    insurerEvidence: {
      adjustmentContext: "Only adjustments disclosed in the insurer report are shown.",
      comparableCount: 1,
      comparables: [{
        vehicle: "2022 Insurer Example Sedan",
        mileage: 32000,
        advertisedPrice: "$19,800",
        adjustedValue: "$19,500",
        netAdjustment: "-$300",
        adjustments: { condition: "-$500", mileage: "$200", options: null, package: null },
        adjustmentDisclosure: "Partially disclosed",
        contributionPercent: null,
      }],
      insurerName: "Example Insurance",
      methodologyStatement: "Every insurer comparable is shown descriptively.",
      summary: {
        totalCount: 1,
        adjustedValueMissingCount: 0,
        adjustedValues: { count: 1, low: money(1950000, "$19,500"), high: money(1950000, "$19,500"), median: money(1950000, "$19,500") },
        advertisedPriceMissingCount: 0,
        advertisedPrices: { count: 1, low: money(1980000, "$19,800"), high: money(1980000, "$19,800"), median: money(1980000, "$19,800") },
        fullyDisclosedAdjustmentCount: 0,
        partiallyDisclosedAdjustmentCount: 1,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 0,
      },
    },
    marketEvidence: {
      comparables: [{
        vehicle: "2022 Market Example Sedan",
        advertisedPrice: "$20,490",
        dealer: "Example Motors",
        location: "Chicago, IL",
        distanceMiles: 12.5,
        mileage: 31500,
        role: "PRIMARY",
        evidenceDate: "2026-08-28",
        temporalBasis: "CURRENT_MARKET",
      }],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement: "Only selected advertised-price evidence is shown.",
      primary: {
        label: "Current market evidence",
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        selectedCount: 1,
        prices: null,
      },
      secondary: null,
    },
    issueDate: "2026-08-29",
    reportId: REPORT_ID,
    status: "published",
    subjectVehicle: { description: "2022 Example Sedan" },
    suggestedFilename: "Venfour_Valuation_Evidence_Synthetic_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function claimProjection(completed: readonly TotalLossEducationStep[] = []): TotalLossClaimSecured {
  return {
    caseId: CASE_ID,
    state: "secured",
    contactEmail: "owner@example.com",
    commerce: {
      checkoutAvailable: false,
      entitlementStatus: "active",
      nextTask: "report_ready",
      orderStatus: "paid",
      paymentStatus: "succeeded",
    },
    education: {
      reportVersionId: REPORT_ID,
      steps: Object.fromEntries(TOTAL_LOSS_EDUCATION_STEPS.map((step) => [step, {
        completedAt: completed.includes(step) ? NOW : null,
        viewedAt: completed.includes(step) ? NOW : null,
        skippedAt: null,
      }])) as NonNullable<TotalLossClaimSecured["education"]>["steps"],
    },
    journey: { fulfillmentState: "report_ready", nextState: "guide_result", retryable: false },
    messageDraft: {
      draftId: "55555555-5555-4555-8555-555555555555",
      purpose: "initial_reconsideration",
      recipient: "adjuster@example.com",
      reportVersionId: REPORT_ID,
      revision: 1,
      subject: "Claim CLM-42 valuation reconsideration",
      body: "Legacy saved draft that must not be normalized by an evidence visit.",
      updatedAt: NOW,
    },
    report: publishedReport(),
    sendingDetails: null,
    workflow: { currentTask: "report_ready", phase: "initial_request", revision: 7 },
  };
}

interface EducationWrite {
  readonly step: TotalLossEducationStep;
  readonly state: string;
  readonly expectedWorkflowRevision: number;
}

interface InsurerResponseWrite {
  readonly clientRequestId: string;
  readonly documentId: string | null;
  readonly expectedWorkflowRevision: number;
  readonly responseText: string | null;
  readonly retainedDocumentId: string | null;
  readonly revisedOfferMinorUnits: number | null;
  readonly supersedesResponseId: string | null;
}

interface InsurerResponseUploadWrite {
  readonly byteSize: number;
  readonly clientRequestId: string;
  readonly contentDigest: string;
  readonly expectedWorkflowRevision: number;
  readonly mediaType: string;
  readonly originalFilename: string;
}

function installClaim(initialClaim = claimProjection(), failOnce?: TotalLossEducationStep, beforeSave?: () => Promise<void>) {
  let claim = initialClaim;
  let failed = false;
  const writes: EducationWrite[] = [];
  const responseWrites: InsurerResponseWrite[] = [];
  const responseUploadWrites: InsurerResponseUploadWrite[] = [];
  const draftWrites = vi.fn();
  server.use(
    http.get(`${API}/claim`, () =>
      HttpResponse.json(publicClaimProjection(claim)),
    ),
    http.put(`${API}/education/:step`, async ({ params, request: update }) => {
      const step = params.step as TotalLossEducationStep;
      const body = await update.json() as Omit<EducationWrite, "step">;
      writes.push({ step, ...body });
      expect(body.expectedWorkflowRevision).toBe(claim.workflow?.revision);
      await beforeSave?.();
      if (step === failOnce && !failed) {
        failed = true;
        return HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Please try again." } }, { status: 503 });
      }
      const steps = {
        ...claim.education!.steps,
        [step]: { completedAt: NOW, viewedAt: NOW, skippedAt: null },
      };
      const nextStates: Record<TotalLossEducationStep, TotalLossClaimJourneyState> = {
        result: "guide_result", insurer_review: "guide_insurer_review", valuation: "guide_valuation",
        report: "guide_report", what_next: "guide_what_next", send: "prepare_request",
      };
      const nextStep = TOTAL_LOSS_EDUCATION_STEPS.find((item) => !steps[item].completedAt && !steps[item].skippedAt);
      claim = {
        ...claim,
        education: { reportVersionId: REPORT_ID, steps },
        workflow: { ...claim.workflow!, revision: claim.workflow!.revision + 1 },
        journey: { fulfillmentState: "report_ready", nextState: nextStep ? nextStates[nextStep] : "awaiting_insurer_response", retryable: false },
      };
      return HttpResponse.json({ education: claim.education, workflowRevision: claim.workflow!.revision });
    }),
    http.patch(`${API}/message-draft`, () => {
      draftWrites();
      return HttpResponse.json({ error: { code: "UNEXPECTED_WRITE", message: "An evidence visit must not update a draft." } }, { status: 500 });
    }),
    http.post(`${API}/insurer-response`, async ({ request: update }) => {
      const body = await update.json() as InsurerResponseWrite;
      responseWrites.push(body);
      const response: TotalLossInsurerResponse = {
        analysis: null,
        analysisEvidence: null,
        responseId: body.supersedesResponseId ? body.clientRequestId : "99999999-9999-4999-8999-999999999999",
        clientRequestId: body.clientRequestId,
        receivedAt: NOW,
        sourceType: body.documentId || body.retainedDocumentId ? "uploaded_document" as const : "pasted_message" as const,
        text: body.responseText,
        document: body.documentId ? {
          documentId: body.documentId,
          originalFilename: "insurer-response.png",
          mediaType: "image/png" as const,
          byteSize: 11,
        } : body.retainedDocumentId ? claim.insurerResponse?.document ?? null : null,
        revisedOffer: body.revisedOfferMinorUnits ? { amountMinorUnits: body.revisedOfferMinorUnits, currency: "USD" } : null,
        processingState: "pending" as const,
        failureReason: null,
        recommendation: null,
        usableOffer: null,
        decision: null,
        supersedesResponseId: body.supersedesResponseId,
      };
      claim = {
        ...claim,
        insurerResponse: response,
        journey: { fulfillmentState: "insurer_response_reviewing", nextState: "insurer_response_reviewing", retryable: false },
        workflow: { ...claim.workflow!, currentTask: "insurer_response_reviewing", revision: claim.workflow!.revision + 1 },
      };
      return HttpResponse.json({
        state: "insurer_response_received",
        response: publicInsurerResponseProjection(response),
        workflowRevision: claim.workflow!.revision,
      });
    }),
    http.post(`${API}/insurer-response/upload`, async ({ request: update }) => {
      const body = await update.json() as InsurerResponseUploadWrite;
      responseUploadWrites.push(body);
      return HttpResponse.json({
        documentId: body.clientRequestId,
        uploadPath: `${USER_ID}/${CASE_ID}/insurer-responses/${body.clientRequestId}.png`,
        originalFilename: body.originalFilename,
        mediaType: body.mediaType,
        byteSize: body.byteSize,
        contentDigest: body.contentDigest,
      });
    }),
  );
  return {
    writes,
    responseWrites,
    responseUploadWrites,
    draftWrites,
    claim: () => claim,
    setClaim: (nextClaim: TotalLossClaimSecured) => {
      claim = nextClaim;
    },
  };
}

function JourneyHarness({ intakeMode, userId }: { readonly intakeMode: TotalLossIntakeMode; readonly userId: string }) {
  const { stage = "result", caseId = CASE_ID } = useParams();
  const query = useTotalLossClaimQuery({ accessToken: "completed-access-token", caseId, userId });
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  if (!query.data || query.data.state !== "secured" || !query.data.report) return <p>Loading saved report</p>;
  return <CompletedAnalysis
    accessToken="completed-access-token"
    caseId={caseId}
    claim={query.data}
    intakeMode={intakeMode}
    onRefresh={query.refetch}
    report={query.data.report}
    userId={userId}
    view={`review_${stage.replaceAll("-", "_")}` as TotalLossClaimWorkflowView}
  />;
}

function renderJourney(
  intakeMode: TotalLossIntakeMode,
  initialStage = "result",
  insurerResponseStorageService?: NonNullable<TotalLossDependencies["totalLossInsurerResponseStorageService"]>,
  progressHost: HTMLElement | null = null,
  navigationHost: HTMLElement | null = null,
  identity = { caseId: CASE_ID, userId: USER_ID },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: "/total-loss/cases/:caseId/claim/review/:stage", element: <JourneyHarness intakeMode={intakeMode} userId={identity.userId} /> }], {
    initialEntries: [`/total-loss/cases/${identity.caseId}/claim/review/${initialStage}`],
  });
  const dependencies = insurerResponseStorageService ? {
    totalLossInsurerResponseStorageService: insurerResponseStorageService,
  } as unknown as TotalLossDependencies : null;
  const result = render(
    <TotalLossDependenciesProvider dependencies={dependencies}>
      <CompletedReviewProgressHostContext.Provider value={progressHost}>
        <CompletedReviewNavigationHostContext.Provider value={navigationHost}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </CompletedReviewNavigationHostContext.Provider>
      </CompletedReviewProgressHostContext.Provider>
    </TotalLossDependenciesProvider>,
  );
  return { ...result, router, queryClient };
}

function backControl() {
  return screen.queryByRole("link", { name: /^Back$/u }) ?? screen.getByRole("button", { name: /^Back$/u });
}

describe("completed-analysis guided progression", () => {
  it.each(["manual", "report"] as const)("navigates %s follow-up confirmation to waiting when the live claim refresh replaces the editor", async (intakeMode) => {
    const saved = installClaim(followUpJourneyClaim());
    const sent = followUpJourneyClaim(true);
    server.use(http.post(`${API}/follow-up/sent`, async ({ request: update }) => {
      const input = await update.json() as { messageVersionId: string };
      expect(input.messageVersionId).toBe(sent.followUp!.preparedMessage!.messageVersionId);
      saved.setClaim(sent);
      return HttpResponse.json({
        state: "awaiting_insurer_response", workflowRevision: sent.workflow!.revision,
        messageVersionId: input.messageVersionId, communicationId: sent.followUp!.sentMessage!.communicationId,
        negotiationRoundId: sent.followUp!.sentMessage!.negotiationRoundId, customerReportedSentAt: NOW,
      });
    }));
    const view = renderJourney(intakeMode, "follow-up");
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click(await screen.findByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: "I sent the email with this PDF attached." }));
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/waiting`);
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });

  it("does not move a customer who left the follow-up while sent confirmation was pending", async () => {
    const saved = installClaim(followUpJourneyClaim());
    const sent = followUpJourneyClaim(true);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(`${API}/follow-up/sent`, async () => {
      await gate;
      saved.setClaim(sent);
      return HttpResponse.json({
        state: "awaiting_insurer_response", workflowRevision: sent.workflow!.revision,
        messageVersionId: sent.followUp!.preparedMessage!.messageVersionId,
        communicationId: sent.followUp!.sentMessage!.communicationId,
        negotiationRoundId: sent.followUp!.sentMessage!.negotiationRoundId, customerReportedSentAt: NOW,
      });
    }));
    const view = renderJourney("report", "follow-up");
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click(await screen.findByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: "I sent the email with this PDF attached." }));
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.click(screen.getByRole("link", { name: "Initial request" }));
    expect(await screen.findByRole("heading", { name: "Your sent request" })).toBeVisible();
    await act(async () => { release?.(); });
    await waitFor(() => expect(view.queryClient.getQueryData<TotalLossClaimSecured>(totalLossClaimQueryKeys.detail(USER_ID, CASE_ID))?.followUp?.state).toBe("sent"));
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(screen.getByRole("heading", { name: "Your sent request" })).toBeVisible();
  });

  it.each(["manual", "report"] as const)("resumes the same %s follow-up and keeps the original request and response review reachable", async (intakeMode) => {
    const current = followUpJourneyClaim();
    const installed = installClaim(current);
    const view = renderJourney(intakeMode, "follow-up");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Review and send your follow-up" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(current.followUp!.draft!.body);
    await user.click(screen.getByRole("link", { name: "Initial request" }));
    expect(await screen.findByRole("heading", { name: "Your sent request" })).toBeVisible();
    expect(screen.getByLabelText("Request message")).toHaveTextContent(current.messageDraft!.body);
    await user.click(screen.getByRole("link", { name: "Response review" }));
    expect(await screen.findByText("You chose to continue challenging")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Review my follow-up" }));
    expect(await screen.findByRole("heading", { name: "Review and send your follow-up" })).toBeVisible();
    expect(installed.draftWrites).not.toHaveBeenCalled();
    expect(installed.responseWrites).toHaveLength(0);
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/follow-up`);
  });

  it("resumes waiting after the follow-up is sent and blocks another response intake route", async () => {
    installClaim(followUpJourneyClaim(true));
    const view = renderJourney("report", "response");
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/waiting`);
    expect(screen.queryByRole("button", { name: "I received a response" })).not.toBeInTheDocument();
    expect(screen.getByText(/adding another insurer response is not available yet/u)).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "View your sent follow-up" }));
    expect(await screen.findByRole("heading", { name: "Your sent follow-up" })).toBeVisible();
    expect(screen.getByLabelText("Follow-up message")).toHaveTextContent(followUpJourneyClaim(true).followUp!.sentMessage!.body);
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    request.render.mockClear();
    window.sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("mounts progress and case navigation in their shell hosts with the same current step", async () => {
    const headerHost = document.createElement("div");
    const navigationHost = document.createElement("div");
    installClaim(claimProjection());
    const user = userEvent.setup();
    const view = renderJourney("report", "result", undefined, headerHost, navigationHost);

    try {
      const progress = await within(headerHost).findByRole("progressbar", { name: "Case journey" });
      expect(progress.parentElement).toBe(headerHost);
      expect(screen.queryByLabelText("Case journey progress")).not.toBeInTheDocument();
      expect(document.querySelector(".review-progress-caption")).not.toBeInTheDocument();
      expect(document.querySelector(".completed-analysis")?.contains(progress)).toBe(false);
      const navigation = within(navigationHost).getByRole("navigation", { name: "Case sections" });
      expect(navigation.parentElement).toBe(navigationHost);
      expect(document.querySelector(".completed-analysis")?.contains(navigation)).toBe(false);
      expect(within(navigation).queryByText("Current step", { exact: true })).not.toBeInTheDocument();
      expect(progress).toHaveAttribute("aria-valuemax", "8");
      expect(progress.firstElementChild).toHaveStyle({ transform: "scaleX(0.0625)" });

      await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
      expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
      expect(within(headerHost).getByRole("progressbar", { name: "Case journey" })).toBe(progress);
      expect(progress).toHaveAttribute("aria-valuenow", "1.5");
      expect(progress.firstElementChild).toHaveStyle({ transform: "scaleX(0.1875)" });
      await user.click(within(navigation).getByRole("link", { name: "Your result" }));
      expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
      expect(within(navigation).getByRole("link", { name: "Your result" })).toHaveAttribute("aria-current", "page");
      expect(within(navigation).getByRole("link", { name: "Insurer review" }).parentElement).toHaveAttribute("data-current", "true");
      expect(progress).toHaveAttribute("aria-valuenow", "1.5");
      expect(progress.firstElementChild).toHaveStyle({ transform: "scaleX(0.1875)" });
    } finally {
      view.unmount();
    }
  });

  it("exposes only reachable case sections before the first result acknowledgement", async () => {
    const saved = installClaim(claimProjection());
    const user = userEvent.setup();
    renderJourney("report");

    const navigation = await screen.findByRole("navigation", { name: "Case sections" });
    expect(within(navigation).getByRole("link", { name: /^Your result/u })).toHaveAttribute("aria-current", "page");
    for (const label of ["Insurer review", "Market evidence", "What it means", "Request preparation", "Waiting for insurer"]) {
      expect(within(within(navigation).getByRole("list")).getByText(label, { exact: true })).toBeVisible();
      expect(within(navigation).getByRole("option", { name: label })).toBeDisabled();
      expect(within(navigation).queryByRole("link", { name: new RegExp(`^${label}`, "u") })).not.toBeInTheDocument();
    }
    for (const label of ["Insurer response", "Response review"]) {
      expect(within(navigation).queryByRole("link", { name: new RegExp(`^${label}`, "u") })).not.toBeInTheDocument();
    }
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: /^Your result/u })).toHaveAttribute("href", `${BASE}/review/result`);
    expect(within(navigation).getByRole("link", { name: /^Insurer review/u })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).queryByRole("link", { name: /^Market evidence/u })).not.toBeInTheDocument();
    expect(saved.writes).toEqual([{ step: "result", state: "completed", expectedWorkflowRevision: 7 }]);
  });

  it.each(["report", "manual"] as const)("keeps the authoritative %s step stable while revisiting completed education and refreshing", async (intakeMode) => {
    const projection = claimProjection(BEFORE_REQUEST);
    const saved = installClaim({
      ...projection,
      messageDraft: null,
      journey: { fulfillmentState: "report_ready", nextState: "prepare_request", retryable: false },
    });
    const user = userEvent.setup();
    const view = renderJourney(intakeMode, "request");
    const navigation = await screen.findByRole("navigation", { name: "Case sections" });
    const progress = screen.getByRole("progressbar", { name: "Case journey" });
    const savedProgress = progress.getAttribute("aria-valuenow");
    const savedProgressLabel = progress.getAttribute("aria-valuetext");
    const originalRevision = saved.claim().workflow!.revision;
    const originalEducation = saved.claim().education;
    expect(progress).toHaveAttribute("data-current-step", "prepare_request");
    if (intakeMode === "manual") {
      expect(within(navigation).queryByText("Insurer review", { exact: true })).not.toBeInTheDocument();
    }
    request.render.mockClear();

    const sections = [
      ["Your result", "Your result", "result"],
      ...(intakeMode === "report" ? [["Insurer review", "How your insurer reached its value", "insurer"]] : []),
      ["Market evidence", "What the market evidence showed", "market"],
      ["What it means", "What the comparison means", "meaning"],
    ];
    for (const [label, heading, stage] of sections) {
      await user.click(within(navigation).getByRole("link", { name: new RegExp(`^${label}`, "u") }));
      expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
      expect(view.router.state.location.pathname).toBe(`${BASE}/review/${stage}`);
      expect(within(navigation).getByRole("link", { name: new RegExp(`^${label}`, "u") })).toHaveAttribute("aria-current", "page");
      expect(progress).toHaveAttribute("aria-valuenow", savedProgress);
      expect(progress).toHaveAttribute("aria-valuetext", savedProgressLabel);
    }
    await act(() => view.router.navigate(-1));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    await act(() => view.queryClient.refetchQueries({ type: "active" }));
    expect(progress).toHaveAttribute("aria-valuenow", savedProgress);
    expect(saved.claim().workflow!.revision).toBe(originalRevision);
    expect(saved.claim().education).toEqual(originalEducation);
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
    expect(request.render).not.toHaveBeenCalled();

    view.unmount();
    renderJourney(intakeMode, "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute("aria-valuetext", savedProgressLabel);
    expect(within(screen.getByRole("navigation", { name: "Case sections" })).getByRole("link", { name: /^Market evidence/u })).toHaveAttribute("aria-current", "page");
    expect(saved.claim().workflow!.revision).toBe(originalRevision);
    expect(saved.writes).toEqual([]);
  });

  it("updates the current request step when a same-report saved draft arrives during an earlier education visit", async () => {
    const projection = claimProjection(BEFORE_REQUEST);
    const saved = installClaim({
      ...projection,
      messageDraft: null,
      journey: { fulfillmentState: "report_ready", nextState: "prepare_request", retryable: false },
    });
    const view = renderJourney("report", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "Case sections" });
    const progress = screen.getByRole("progressbar", { name: "Case journey" });
    expect(progress).toHaveAttribute("aria-valuetext", "Step 5 of 8: Prepare request");
    expect(progress).toHaveAttribute("data-current-step", "prepare_request");
    expect(request.render).not.toHaveBeenCalled();
    const initialRevision = saved.claim().workflow!.revision;
    const initialEducation = saved.claim().education;

    saved.setClaim({ ...saved.claim(), messageDraft: projection.messageDraft });
    await act(() => view.queryClient.refetchQueries({ type: "active" }));

    await waitFor(() => expect(progress).toHaveAttribute("aria-valuetext", "Step 5 of 8: Send request"));
    expect(progress).toHaveAttribute("data-current-step", "send_request");
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/market`);
    expect(screen.getByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: /^Market evidence/u })).toHaveAttribute("aria-current", "page");
    expect(request.render).not.toHaveBeenCalled();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
    expect(saved.claim().workflow!.revision).toBe(initialRevision);
    expect(saved.claim().education).toEqual(initialEducation);
  });

  it("waits for the acknowledgement but never for animations when moving between stable review stages", async () => {
    const originalObserver = Object.getOwnPropertyDescriptor(window, "IntersectionObserver");
    let intersect!: IntersectionObserverCallback;
    class ControlledObserver {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: ControlledObserver });
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => { release = resolve; });
    const saved = installClaim(claimProjection(), undefined, () => pendingSave);
    const user = userEvent.setup();
    const view = renderJourney("report");

    try {
      expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
      const section = screen.getByRole("region", { name: "Completed analysis" });
      const content = section.querySelector(".review-stage-content");
      expect(content).not.toBeNull();
      const navigation = screen.getByRole("navigation", { name: "Review navigation" });
      expect(navigation.parentElement).toBe(content);
      expect(content?.lastElementChild).toBe(navigation);
      expect(section.querySelector("footer")).not.toBeInTheDocument();
      const entrance = section.querySelector<HTMLElement>("[data-review-entrance]")!;
      act(() => intersect([{
        target: entrance,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: entrance.getBoundingClientRect(),
        intersectionRect: entrance.getBoundingClientRect(),
        rootBounds: null,
        time: 0,
      }], {} as IntersectionObserver));
      expect(entrance).toHaveAttribute("data-scroll-reveal", "entering");

      await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
      await waitFor(() => expect(saved.writes).toHaveLength(1));
      expect(screen.getByRole("button", { name: "Saving progress…" })).toBeDisabled();
      expect(screen.getByRole("heading", { name: "Your result" })).toBeVisible();
      expect(view.router.state.location.pathname).toBe(`${BASE}/review/result`);
      expect(saved.claim().education?.steps.result.completedAt).toBeNull();
      expect(entrance).toHaveAttribute("data-scroll-reveal", "entering");

      await act(async () => { release(); await pendingSave; });
      expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
      expect(saved.claim().education?.steps.result.completedAt).toBe(NOW);
      expect(view.router.state.location.pathname).toBe(`${BASE}/review/insurer`);
      expect(screen.getByRole("region", { name: "Completed analysis" })).toBe(section);
      expect(section.querySelector(".review-stage-content")).toBe(content);
      expect(screen.getByRole("navigation", { name: "Review navigation" })).toBe(navigation);
      expect(content?.lastElementChild).toBe(navigation);
      expect(section.querySelectorAll("h1")).toHaveLength(1);

      for (let repeat = 0; repeat < 2; repeat += 1) {
        await user.click(backControl());
        expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
        expect(view.router.state.location.pathname).toBe(`${BASE}/review/result`);
        expect(section.querySelectorAll("h1")).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
        expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
        expect(view.router.state.location.pathname).toBe(`${BASE}/review/insurer`);
        expect(screen.getByRole("region", { name: "Completed analysis" })).toBe(section);
        expect(section.querySelector(".review-stage-content")).toBe(content);
        expect(section.querySelectorAll("h1")).toHaveLength(1);
      }
      expect(saved.writes).toEqual([{ step: "result", state: "completed", expectedWorkflowRevision: 7 }]);
      expect(saved.draftWrites).not.toHaveBeenCalled();
    } finally {
      release();
      view.unmount();
      if (originalObserver) Object.defineProperty(window, "IntersectionObserver", originalObserver);
      else Reflect.deleteProperty(window, "IntersectionObserver");
    }
  });

  it("marks Back unavailable while an acknowledgement is being saved", async () => {
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => { release = resolve; });
    installClaim(claimProjection(["result"]), undefined, () => pendingSave);
    const user = userEvent.setup();
    renderJourney("report", "insurer");

    await user.click(await screen.findByRole("button", { name: "See the market evidence" }));
    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    await act(async () => { release(); await pendingSave; });
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
  });

  it("does not navigate away from a route chosen while an acknowledgement is still saving", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const saved = installClaim(claimProjection(), undefined, () => pending);
    const { router } = renderJourney("report");
    await userEvent.setup().click(await screen.findByRole("button", { name: "See how the insurer reached its value" }));
    await waitFor(() => expect(saved.writes).toHaveLength(1));
    await act(() => router.navigate(`${BASE}/review/market`));
    await act(async () => { release(); await pending; });
    await waitFor(() => expect(saved.claim().education?.steps.result.completedAt).toBe(NOW));
    expect(router.state.location.pathname).toBe(`${BASE}/review/market`);
    expect(screen.getByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
  });

  it("walks report owners through the four evidence stages with ordered revision-fenced acknowledgements before mounting request controls", async () => {
    const saved = installClaim();
    const user = userEvent.setup();
    const { router } = renderJourney("report");

    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText("$20,490")).toBeVisible();
    expect(screen.getByText("Your insurer’s valuation appears low compared with the selected market listings.")).toBeVisible();
    expect(screen.getByText("$1,444 below the selected median")).toBeVisible();
    expect(screen.queryByText(/stored difference|completed evidence/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/midpoint|evidence strength|percentage difference/iu)).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
    expect(saved.writes).toEqual([]);

    await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/insurer`);
    expect(screen.getByText("Your insurer’s report includes 1 comparable vehicle.")).toBeVisible();
    expect(screen.getByText("The advertised-price median was $19,800. After the report’s adjustments, the median was $19,500.")).toBeVisible();
    expect(screen.getByText(/Some adjustment details were only partially disclosed/u)).toBeVisible();
    expect(screen.queryByText(/available for 0|not provided for 0|0 comparables/u)).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Insurer comparables" })).not.toBeVisible();
    await user.click(screen.getByText("Insurer comparable details"));
    expect(screen.getByRole("table", { name: "Insurer comparables" })).toBeVisible();
    expect(screen.getByText("-$500")).toBeVisible();
    expect(request.render).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/market`);
    await user.click(screen.getByText("See selected market listings"));
    const marketTable = screen.getByRole("table", { name: "Selected market listings" });
    expect(within(marketTable).getByText("Example Motors")).toBeVisible();
    expect(within(marketTable).getByText("Chicago, IL")).toBeVisible();
    expect(within(marketTable).getByText("12.5 mi")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(screen.getByText("Your insurer’s valuation is below the selected advertised-price range. Even the lowest listing used for this comparison, at $19,800, was $754 higher.")).toBeVisible();
    expect(screen.getByText("The valuation is $1,444 below the selected median of $20,490.")).toBeVisible();
    expect(screen.getByText("This comparison does not add dollar adjustments for differences in condition.")).toBeVisible();
    expect(screen.queryByText("Your insurer’s valuation appears low compared with the selected market listings.")).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
    expect(screen.queryByText("The full package records additional provider coverage limitations.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review my request" }));
    expect(await screen.findByTestId("request-controls")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(saved.writes).toEqual(BEFORE_REQUEST.map((step, index) => ({ step, state: "completed", expectedWorkflowRevision: 7 + index })));
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it("omits insurer education for manual owners and completes its compatibility marker only when leaving Market", async () => {
    const saved = installClaim();
    const user = userEvent.setup();
    const { router } = renderJourney("manual");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText("Insurer offer you entered")).toBeVisible();
    expect(screen.getByText("Offer")).toBeVisible();
    expect(screen.getByText("The offer you entered appears low compared with the selected market listings.")).toBeVisible();
    expect(screen.getByText(/did not provide the insurer.s valuation report/iu)).toBeVisible();
    expect(screen.queryByRole("button", { name: "See how the insurer reached its value" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(saved.writes.map(({ step }) => step)).toEqual(["result"]);
    expect(screen.queryByText("Insurer comparable details")).not.toBeInTheDocument();
    expect(screen.queryByText("2022 Insurer Example Sedan")).not.toBeInTheDocument();
    await user.click(backControl());
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(saved.writes.map(({ step }) => step)).toEqual(["result"]);

    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes.map(({ step }) => step)).toEqual(BEFORE_MEANING);
    expect(screen.getByText("The offer you entered is below the selected advertised-price range. Even the lowest listing used for this comparison, at $19,800, was $754 higher.")).toBeVisible();
    expect(screen.getByText("The offer is $1,444 below the selected median of $20,490.")).toBeVisible();
    expect(screen.queryByText(/Your insurer valued|Your insurer’s valuation is below/u)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot review which comparable vehicles or adjustments/iu)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Review my request" }));
    expect(await screen.findByTestId("request-controls")).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(saved.writes).toEqual(BEFORE_REQUEST.map((step, index) => ({ step, state: "completed", expectedWorkflowRevision: 7 + index })));
  });

  it.each(["report", "manual"] as const)("uses route history and persisted completion when %s owners go Back, Forward, or reload", async (intakeMode) => {
    const saved = installClaim(claimProjection(BEFORE_MEANING));
    const user = userEvent.setup();
    const view = renderJourney(intakeMode, "meaning");
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    await user.click(backControl());
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    await act(() => view.router.navigate(-1));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    await act(() => view.router.navigate(1));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes).toEqual([]);
    view.unmount();
    renderJourney(intakeMode, "meaning");
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
    expect(request.render).not.toHaveBeenCalled();
  });

  it.each([
    { intakeMode: "report" as const, stage: "meaning", initial: BEFORE_MEANING, failed: "what_next" as const, action: "Review my request", first: "report", destination: "request" },
    { intakeMode: "manual" as const, stage: "market", initial: ["result"] as TotalLossEducationStep[], failed: "valuation" as const, action: "Compare the values", first: "insurer_review", destination: "meaning" },
  ])("retains a successful first acknowledgement when the $intakeMode $stage sequence must be retried", async ({ intakeMode, stage, initial, failed, action, first, destination }) => {
    const saved = installClaim(claimProjection(initial), failed);
    const user = userEvent.setup();
    const { router } = renderJourney(intakeMode, stage);
    await screen.findByRole("button", { name: action });
    await user.click(screen.getByRole("button", { name: action }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/${stage}`);
    expect(saved.writes.map(({ step }) => step)).toEqual([first, failed]);
    expect(request.render).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/review/${destination}`));
    expect(saved.writes.map(({ step }) => step)).toEqual([first, failed, failed]);
    expect(saved.writes.map(({ expectedWorkflowRevision }) => expectedWorkflowRevision)).toEqual([7, 8, 8]);
    expect(saved.writes.every(({ state }) => state === "completed")).toBe(true);
  });

  it.each(["report", "manual"] as const)("does not acknowledge unseen stages or activate request editing from a premature %s deep link", async (intakeMode) => {
    const saved = installClaim();
    renderJourney(intakeMode, "request");
    expect(await screen.findByRole("link", { name: "Continue your review" })).toHaveAttribute("href", `${BASE}/review/result`);
    expect(request.render).not.toHaveBeenCalled();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it("shows the request-preparation state after education completes when no draft exists yet", async () => {
    const projection = claimProjection(BEFORE_REQUEST);
    installClaim({ ...projection, messageDraft: null });
    renderJourney("report", "request");
    expect(await screen.findByRole("heading", { name: "Prepare your request" })).toBeVisible();
    expect(screen.getByTestId("request-controls")).toBeVisible();
    expect(request.render).toHaveBeenLastCalledWith(expect.objectContaining({
      actionContainer: screen.getByRole("navigation", { name: "Review navigation" }),
    }));
  });

  it("preserves an old skipped compatibility marker rather than trying to rewrite it on a later manual visit", async () => {
    const projection = claimProjection(["result"]);
    const saved = installClaim({
      ...projection,
      education: {
        ...projection.education!,
        steps: {
          ...projection.education!.steps,
          insurer_review: { viewedAt: null, completedAt: null, skippedAt: NOW },
        },
      },
    });
    const user = userEvent.setup();
    renderJourney("manual", "market");
    await user.click(await screen.findByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes).toEqual([{ step: "valuation", state: "completed", expectedWorkflowRevision: 7 }]);
    expect(saved.claim().education!.steps.insurer_review).toEqual({ viewedAt: null, completedAt: null, skippedAt: NOW });
  });

  it("keeps missing insurer rows honest and suppresses technical codes or unavailable-value placeholders", async () => {
    const projection = claimProjection(["result"]);
    const report = projection.report!;
    installClaim({
      ...projection,
      report: {
        ...report,
        subjectVehicle: { description: "Unavailable" },
        conclusion: {
          ...report.conclusion,
          classificationLabel: "POTENTIAL_UNDERVALUE",
          summary: "The completed review compares CURRENT_MARKET evidence.",
          indicatedDifference: null,
        },
        insurerEvidence: {
          ...report.insurerEvidence,
          insurerName: "Unavailable",
          comparableCount: 0,
          comparables: [],
          methodologyStatement: "DESCRIPTIVE_ONLY and NOT_DETERMINED_BY_V1",
          summary: {
            ...report.insurerEvidence.summary,
            totalCount: 0,
            partiallyDisclosedAdjustmentCount: 0,
            adjustedValues: null,
            advertisedPrices: null,
          },
        },
      },
    });
    const user = userEvent.setup();
    const { router } = renderJourney("report", "insurer");
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(screen.getByText("No insurer comparables were available in the report for this review.")).toBeVisible();
    expect(screen.queryByText(/\b0 (?:insurer|comparable)|available for 0|not provided for 0/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByText("Insurer comparable details"));
    expect(screen.getByText("No insurer comparables were available in the report.")).toBeVisible();
    expect(screen.getByRole("region", { name: "Completed analysis" }).textContent).not.toMatch(/\bUnavailable\b|DESCRIPTIVE_ONLY|NOT_DETERMINED_BY_V1/u);
    await act(() => router.navigate(`${BASE}/review/result`));
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Completed analysis" }).textContent).not.toMatch(/\bUnavailable\b|POTENTIAL_UNDERVALUE|CURRENT_MARKET|midpoint|evidence strength|percentage difference|%/iu);
    expect(screen.queryByText("$1,444")).not.toBeInTheDocument();
  });

  it("shows a persisted customer-reported sent state without mounting the editor or claiming delivery", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({ ...projection, journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false }, workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 } });
    renderJourney("report", "waiting");
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(screen.getByText(/Based on your confirmation.*recorded.*sent/iu)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute(
      "aria-valuetext",
      "Current stage: Waiting for insurer. Case active.",
    );
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute("aria-valuenow", "5.5");
    expect(screen.getByText(/does not monitor.*cannot verify delivery, receipt, or detect a response automatically/iu)).toBeVisible();
    expect(screen.getByText(/return to this case.*I received a response/iu)).toBeVisible();
    expect(screen.queryByText(/delivery confirmed|insurer received|response.*within \d/iu)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I received a response" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /offer|negotiat|close/iu })).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
  });

  it("records an offer-only insurer response once and advances to the reviewing state", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    const installed = installClaim({
      ...projection,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    });
    renderJourney("report", "waiting");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "I received a response" }));
    expect(await screen.findByRole("heading", { name: "Add the insurer’s response" })).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: /^Revised offer/iu }), "21125.50");
    const save = screen.getByRole("button", { name: "Save response" });
    await Promise.all([user.click(save), user.click(save)]);

    expect(await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" })).toBeVisible();
    expect(installed.responseWrites).toHaveLength(1);
    expect(installed.responseWrites[0]).toMatchObject({
      documentId: null,
      expectedWorkflowRevision: 13,
      responseText: null,
      retainedDocumentId: null,
      revisedOfferMinorUnits: 2_112_550,
      supersedesResponseId: null,
    });
    expect(screen.getByText(/comparing what the insurer said with the request/iu)).toBeVisible();
    expect(screen.getByRole("region", { name: "Valuation report" })).toBeVisible();

    await user.click(
      screen.getByText("View the saved insurer response"),
    );
    expect(screen.getByText("$21,125.50")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Correct this response" }));
    expect(await screen.findByText("Correct saved response")).toBeVisible();
    const pasted = screen.getByRole("textbox", { name: /^Paste the response/iu });
    await user.type(pasted, "  Exact corrected reply.\n");
    await user.click(screen.getByRole("button", { name: "Save corrected response" }));

    expect(await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" })).toBeVisible();
    expect(installed.responseWrites).toHaveLength(2);
    expect(installed.responseWrites[1]).toMatchObject({
      responseText: "  Exact corrected reply.\n",
      revisedOfferMinorUnits: 2_112_550,
      supersedesResponseId: "99999999-9999-4999-8999-999999999999",
    });
    expect(installed.responseWrites[1].clientRequestId).not.toBe(installed.responseWrites[0].clientRequestId);
  });

  it("restores unsaved response text and offer after a remount and protected navigation", async () => {
    const installed = installClaim(waitingClaim());
    const user = userEvent.setup();
    const first = renderJourney("report", "response");
    const text = "  Please preserve this exact reply.\nSecond line. ";
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), text);
    await user.type(screen.getByRole("textbox", { name: /^Revised offer/iu }), "21456.78");

    const reload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    first.unmount();
    const resumed = renderJourney("report", "response");
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue(text);
    expect(screen.getByRole("textbox", { name: /^Revised offer/iu })).toHaveValue("$21,456.78");

    const navigation = screen.getByRole("navigation", { name: "Case sections" });
    await user.click(within(navigation).getByRole("link", { name: /^Your result/u }));
    expect(resumed.router.state.location.pathname).toBe(`${BASE}/review/response`);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("heading", { name: "Add the insurer’s response" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: /^Paste the response/iu })).toHaveValue(text);
    await user.click(within(navigation).getByRole("link", { name: /^Your result/u }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add the insurer’s response" })).toHaveFocus();
    await user.click(within(navigation).getByRole("link", { name: /^Your result/u }));
    await user.click(screen.getByRole("button", { name: "Leave page" }));
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    await act(() => resumed.router.navigate(`${BASE}/review/response`));
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue(text);
    expect(screen.getByRole("textbox", { name: /^Revised offer/iu })).toHaveValue("$21,456.78");
    expect(installed.responseWrites).toEqual([]);
    expect(installed.responseUploadWrites).toEqual([]);
  });

  it("clears submitted drafts and starts each correction from the saved response", async () => {
    const installed = installClaim(waitingClaim());
    const user = userEvent.setup();
    renderJourney("report", "response");
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), "Original submitted reply");
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Save response" }));
    await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" });
    expect(window.sessionStorage.length).toBe(0);
    const afterSubmit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterSubmit);
    expect(afterSubmit.defaultPrevented).toBe(false);

    await user.click(screen.getByRole("button", { name: "Correct this response" }));
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Original submitted reply");
    await user.clear(screen.getByRole("textbox", { name: /^Paste the response/iu }));
    await user.type(screen.getByRole("textbox", { name: /^Paste the response/iu }), "Corrected saved reply");
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Save corrected response" }));
    await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" });
    expect(window.sessionStorage.length).toBe(0);
    expect(installed.responseWrites).toHaveLength(2);
    expect(installed.responseWrites[1].supersedesResponseId).toBe("99999999-9999-4999-8999-999999999999");

    await user.click(screen.getByRole("button", { name: "Correct this response" }));
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Corrected saved reply");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("recognizes an already-recorded response after its submission acknowledgement is interrupted", async () => {
    const installed = installClaim(waitingClaim());
    const writes: InsurerResponseWrite[] = [];
    server.use(http.post(`${API}/insurer-response`, async ({ request }) => {
      const body = await request.json() as InsurerResponseWrite;
      writes.push(body);
      installed.setClaim(responseClaim({
        ...savedInsurerResponse("pending"),
        clientRequestId: body.clientRequestId,
        revisedOffer: null,
        text: body.responseText,
      }));
      return HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Submission acknowledgement interrupted." } }, { status: 503 });
    }));
    const user = userEvent.setup();
    renderJourney("report", "response");
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), "Already saved despite an interrupted acknowledgement.");
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" })).toBeVisible();
    expect(window.sessionStorage.length).toBe(0);
    expect(writes).toHaveLength(1);
  });

  it("isolates response drafts by case and signed-in owner", async () => {
    const otherCaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const installed = installClaim(waitingClaim());
    const user = userEvent.setup();
    const first = renderJourney("report", "response");
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), "Only this owner and case");
    first.unmount();

    installed.setClaim({ ...waitingClaim(), caseId: otherCaseId });
    const otherCase = renderJourney("report", "response", undefined, null, null, { caseId: otherCaseId, userId: USER_ID });
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("");
    otherCase.unmount();
    installed.setClaim(waitingClaim());
    const otherOwner = renderJourney("report", "response", undefined, null, null, { caseId: CASE_ID, userId: otherUserId });
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("");
    otherOwner.unmount();

    renderJourney("report", "response");
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Only this owner and case");
    expect(installed.responseWrites).toEqual([]);
  });

  it("keeps an unfinished new response separate from a correction of the same case", async () => {
    const installed = installClaim(waitingClaim());
    const user = userEvent.setup();
    const newResponse = renderJourney("report", "response");
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), "Unsubmitted new response");
    newResponse.unmount();
    installed.setClaim(responseClaim());
    const correction = renderJourney("report", "response");
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("We can revise the offer to $20,100.");
    await user.clear(screen.getByRole("textbox", { name: /^Paste the response/iu }));
    await user.type(screen.getByRole("textbox", { name: /^Paste the response/iu }), "Unsubmitted correction");
    correction.unmount();

    installed.setClaim(waitingClaim());
    const restoredNew = renderJourney("report", "response");
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Unsubmitted new response");
    restoredNew.unmount();
    installed.setClaim(responseClaim());
    renderJourney("report", "response");
    expect(await screen.findByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Unsubmitted correction");
    expect(installed.responseWrites).toEqual([]);
  });

  it.each([true, false])("preserves correction retain-file intent %s after remount", async (retain) => {
    const original = responseWithDocument();
    const installed = installClaim(responseClaim(original));
    const user = userEvent.setup();
    const first = renderJourney("report", "response");
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), " Additional clarification.");
    if (!retain) await user.click(screen.getByRole("button", { name: "Remove" }));
    first.unmount();
    renderJourney("report", "response");
    await screen.findByRole("textbox", { name: /^Paste the response/iu });
    if (retain) expect(screen.getByText("insurer-response.png")).toBeVisible();
    else expect(screen.queryByText("insurer-response.png")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save corrected response" }));
    await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" });
    expect(installed.responseWrites).toHaveLength(1);
    expect(installed.responseWrites[0]).toMatchObject({
      documentId: null,
      retainedDocumentId: retain ? original.document.documentId : null,
      supersedesResponseId: original.responseId,
    });
    expect(installed.responseUploadWrites).toEqual([]);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("isolates a correction draft when a different saved response arrives in the mounted case", async () => {
    const original = savedInsurerResponse("pending");
    const installed = installClaim(responseClaim(original));
    const user = userEvent.setup();
    const view = renderJourney("report", "response");
    await user.clear(await screen.findByRole("textbox", { name: /^Paste the response/iu }));
    await user.type(screen.getByRole("textbox", { name: /^Paste the response/iu }), "Unsubmitted correction of the original");
    installed.setClaim(responseClaim({
      ...original,
      responseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      supersedesResponseId: original.responseId,
      text: "A newer saved correction",
    }));
    await act(() => view.queryClient.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("A newer saved correction"));

    installed.setClaim(responseClaim(original));
    await act(() => view.queryClient.refetchQueries({ type: "active" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Unsubmitted correction of the original"));
    expect(installed.responseWrites).toEqual([]);
  });

  it.each([false, true])("restores an interrupted upload and preserves replay identity only for unchanged bytes (changed: %s)", async (changedBytes) => {
    const installed = installClaim(waitingClaim());
    const uploadPreparedResponse = vi.fn().mockRejectedValueOnce(new Error("Upload interrupted")).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const first = renderJourney("report", "response", { uploadPreparedResponse });
    await screen.findByRole("heading", { name: "Add the insurer’s response" });
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, responseFile());
    await screen.findByText("insurer-response.png");
    await user.click(screen.getByRole("button", { name: "Save response" }));
    await screen.findByText(/Your entries are still here/iu);
    expect(installed.responseUploadWrites).toHaveLength(1);
    const originalAttempt = installed.responseUploadWrites[0];
    expect(installed.responseWrites).toEqual([]);
    expect(window.sessionStorage.getItem(window.sessionStorage.key(0)!)).not.toContain("completed-access-token");
    first.unmount();

    renderJourney("report", "response", { uploadPreparedResponse });
    expect(await screen.findByRole("button", { name: "Choose file again" })).toBeVisible();
    expect(screen.getByText("insurer-response.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(installed.responseWrites).toEqual([]);
    expect(installed.responseUploadWrites).toHaveLength(1);
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, responseFile(changedBytes ? 4 : 3));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Choose file again" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save response" }));
    await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" });

    expect(installed.responseUploadWrites).toHaveLength(2);
    const retry = installed.responseUploadWrites[1];
    if (changedBytes) {
      expect(retry.clientRequestId).not.toBe(originalAttempt.clientRequestId);
      expect(retry.contentDigest).not.toBe(originalAttempt.contentDigest);
    } else {
      expect(retry).toEqual(originalAttempt);
    }
    expect(installed.responseWrites[0].clientRequestId).toBe(retry.clientRequestId);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("requires an explicit removal to submit restored text without its missing attachment", async () => {
    const installed = installClaim(waitingClaim());
    const uploadPreparedResponse = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const first = renderJourney("report", "response", { uploadPreparedResponse });
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), "The pasted reply is sufficient.");
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, responseFile());
    await screen.findByText("insurer-response.png");
    first.unmount();
    renderJourney("report", "response", { uploadPreparedResponse });
    await screen.findByRole("button", { name: "Choose file again" });
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(installed.responseWrites).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/choose.*file again|remove it/iu);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save response" }));
    await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" });
    expect(installed.responseWrites).toHaveLength(1);
    expect(installed.responseWrites[0]).toMatchObject({
      documentId: null,
      retainedDocumentId: null,
      responseText: "The pasted reply is sufficient.",
    });
    expect(installed.responseUploadWrites).toEqual([]);
    expect(uploadPreparedResponse).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps unload and navigation protection usable when browser draft storage is blocked", async () => {
    installClaim(waitingClaim());
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage blocked", "QuotaExceededError"); });
    const user = userEvent.setup();
    const view = renderJourney("report", "response");
    await user.type(await screen.findByRole("textbox", { name: /^Paste the response/iu }), "Keep this unsaved response");
    const reload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    await user.click(within(screen.getByRole("navigation", { name: "Case sections" })).getByRole("link", { name: /^Your result/u }));
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/response`);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: /^Paste the response/iu })).toHaveValue("Keep this unsaved response");
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" })).toBeVisible();
  });

  it("prepares, privately uploads, and records an original response file", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    const installed = installClaim({
      ...projection,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    });
    const uploadPreparedResponse = vi.fn(async () => undefined);
    renderJourney("report", "waiting", { uploadPreparedResponse });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "I received a response" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
      "insurer-response.png",
      { type: "image/png" },
    );
    await user.upload(fileInput!, file);
    expect(await screen.findByText("insurer-response.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save response" }));

    expect(await screen.findByRole("heading", { name: "Venfour is reviewing the insurer’s response" })).toBeVisible();
    expect(installed.responseUploadWrites).toHaveLength(1);
    expect(installed.responseUploadWrites[0]).toMatchObject({
      byteSize: file.size,
      expectedWorkflowRevision: 13,
      mediaType: "image/png",
      originalFilename: file.name,
    });
    expect(installed.responseUploadWrites[0].contentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(uploadPreparedResponse).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      clientRequestId: installed.responseUploadWrites[0].clientRequestId,
      file,
      preparation: expect.objectContaining({
        documentId: installed.responseUploadWrites[0].clientRequestId,
      }),
    }));
    expect(installed.responseWrites).toHaveLength(1);
    expect(installed.responseWrites[0]).toMatchObject({
      documentId: installed.responseUploadWrites[0].clientRequestId,
      responseText: null,
      retainedDocumentId: null,
      revisedOfferMinorUnits: null,
    });
  });

  it.each([
    ["insurer_response_received", "pending", "response-received?view=saved"],
    ["insurer_response_reviewing", "processing", "response-reviewing"],
    ["insurer_response_reviewed", "completed", "response-reviewed"],
  ] as const)("securely views and downloads the same-case saved original while %s", async (state, processingState, stage) => {
    const response = responseWithDocument(processingState);
    const installed = installClaim({
      ...responseClaim(response),
      journey: { fulfillmentState: state, nextState: state, retryable: false },
      workflow: { currentTask: state, phase: "negotiation", revision: 15 },
    });
    const accesses: { caseId: string; responseId: string; authorization: string | null }[] = [];
    const downloadUrl = "https://storage.example.test/original.png?token=signed&download=Insurer_Response_Original.png";
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/original/download`, ({ params, request }) => {
      accesses.push({ caseId: String(params.caseId), responseId: String(params.responseId), authorization: request.headers.get("Authorization") });
      return HttpResponse.json({ downloadUrl, expiresAt: "2099-01-01T00:00:00Z", suggestedFilename: "Insurer_Response_Original.png" });
    }));
    const replace = vi.fn();
    const previewWindow = { closed: false, close: vi.fn(), location: { replace }, opener: window } as unknown as Window;
    const opened = vi.spyOn(window, "open").mockReturnValue(previewWindow);
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderJourney("report", stage);
    await screen.findByRole("navigation", { name: "Case sections" });
    if (stage !== "response-received?view=saved") {
      await user.click(screen.getByText("View the saved insurer response"));
    }
    expect(accesses).toEqual([]);

    await user.click(screen.getByRole("button", { name: "View original" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://storage.example.test/original.png?token=signed"));
    expect(opened).toHaveBeenCalledWith("about:blank", "_blank");
    expect(previewWindow.opener).toBeNull();
    await user.click(screen.getByRole("button", { name: "Download original" }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    const anchor = clicked.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.href).toBe(downloadUrl);
    expect(anchor.download).toBe("Insurer_Response_Original.png");
    expect(accesses).toEqual(Array.from({ length: 2 }, () => ({
      caseId: CASE_ID,
      responseId: response.responseId,
      authorization: "Bearer completed-access-token",
    })));
    expect(installed.responseWrites).toEqual([]);
    expect(installed.responseUploadWrites).toEqual([]);
  });

  it("closes a reserved preview after denied original access and allows a fresh retry", async () => {
    installClaim(responseClaim(responseWithDocument()));
    let releaseDenied: (() => void) | undefined;
    const denied = new Promise<void>((resolve) => { releaseDenied = resolve; });
    const access = vi.fn();
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/original/download`, async () => {
      access();
      if (access.mock.calls.length === 1) {
        await denied;
        return HttpResponse.json({ error: { code: "CUSTOMER_DELIVERY_NOT_FOUND", message: "Original unavailable." } }, { status: 404 });
      }
      return HttpResponse.json({
        downloadUrl: "https://storage.example.test/original.png?token=retry",
        expiresAt: "2099-01-01T00:00:00Z",
        suggestedFilename: "Insurer_Response_Original.png",
      });
    }));
    const replace = vi.fn();
    const close = vi.fn();
    const previewWindow = { closed: false, close, location: { replace }, opener: window } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(previewWindow);
    const user = userEvent.setup();
    renderJourney("report", "response-received?view=saved");
    await user.click(await screen.findByRole("button", { name: "View original" }));
    await waitFor(() => expect(access).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Download original" })).toBeDisabled();
    expect(replace).not.toHaveBeenCalled();
    await act(async () => releaseDenied?.());
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent(/original|file/iu);
    expect(screen.getByRole("button", { name: "View original" })).toBeEnabled();
    expect(screen.getByText("We can revise the offer to $20,100.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "View original" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://storage.example.test/original.png?token=retry"));
    expect(access).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps text-only responses readable without requesting original access", async () => {
    installClaim(responseClaim());
    const access = vi.fn();
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/original/download`, () => {
      access();
      return new HttpResponse(null, { status: 404 });
    }));
    renderJourney("report", "response-received?view=saved");
    expect(await screen.findByText("We can revise the offer to $20,100.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "View original" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download original" })).not.toBeInTheDocument();
    expect(access).not.toHaveBeenCalled();
  });

  it("renders a legacy completed response review without inventing a recommendation or decision controls", async () => {
    const user = userEvent.setup();
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({
      ...projection,
      insurerResponse: savedInsurerResponse(
        "completed",
        reviewedResponseAnalysis(),
      ),
      journey: {
        fulfillmentState: "insurer_response_reviewed",
        nextState: "insurer_response_reviewed",
        retryable: false,
      },
      workflow: {
        currentTask: "insurer_response_reviewed",
        phase: "negotiation",
        revision: 15,
      },
    });

    renderJourney("report", "response-reviewed");

    expect(
      await screen.findByRole("heading", {
        name: "What the insurer’s response means",
      }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Insurer’s response" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "What changed" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "How they responded" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "What matters" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Venfour’s recommendation" }),
    ).toBeVisible();
    expect(screen.getByText("$19,046")).toBeVisible();
    expect(screen.getAllByText("$20,100.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Partially accepted")).toBeVisible();
    expect(screen.getByText("Recommendation unavailable")).toBeVisible();
    expect(screen.queryByText("Review their revised offer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept offer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue challenging" })).not.toBeInTheDocument();
    const basisControls = screen.getAllByText(/^Basis:/u);
    expect(basisControls.length).toBeGreaterThan(0);
    await user.click(basisControls[0]);
    expect(
      within(basisControls[0].parentElement!).getByText(
        /We can revise the offer to \$20,100\./u,
      ),
    ).toBeVisible();
    const caseBasis = basisControls.find((control) =>
      control.textContent?.includes("existing case evidence"),
    );
    expect(caseBasis).toBeDefined();
    if (!caseBasis!.parentElement?.hasAttribute("open")) {
      await user.click(caseBasis!);
    }
    expect(
      within(caseBasis!.parentElement!).getByText(
        "Please review the valuation and selected market evidence.",
      ),
    ).toBeVisible();
    expect(
      screen.getAllByText("We can revise the offer to $20,100.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Please review the valuation and selected market evidence.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/does not recalculate the vehicle’s value or change the published report/iu),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /reply|send|negotiate|close case/iu }),
    ).not.toBeInTheDocument();
  });

  it("labels a customer-recorded offer separately from insurer-authored response evidence", async () => {
    const analysis = reviewedResponseAnalysis();
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({
      ...projection,
      insurerResponse: {
        ...savedInsurerResponse("completed", analysis),
        analysis: {
          ...analysis,
          revisedOffer: {
            ...analysis.revisedOffer,
            source: "CUSTOMER_SUPPLIED",
            responseEvidenceRefs: [CUSTOMER_OFFER_EVIDENCE_REF],
          },
        },
      },
      journey: {
        fulfillmentState: "insurer_response_reviewed",
        nextState: "insurer_response_reviewed",
        retryable: false,
      },
      workflow: {
        currentTask: "insurer_response_reviewed",
        phase: "negotiation",
        revision: 15,
      },
    });

    renderJourney("report", "response-reviewed");

    await screen.findByRole("heading", {
      name: "What the insurer’s response means",
    });
    const customerBasis = screen.getAllByText(/^Basis:/u).find((control) =>
      control.textContent?.includes("revised-offer amount you recorded"),
    );
    expect(customerBasis).toBeDefined();
    expect(customerBasis).not.toHaveTextContent("part of the insurer response");
    await userEvent.click(customerBasis!);
    expect(
      within(customerBasis!.parentElement!).getByText("Amount you recorded"),
    ).toBeVisible();
  });

  it.each([
    ["CONTINUE_CHALLENGING", "Continue challenging"],
    ["NO_CLEAR_RECOMMENDATION", "No clear recommendation"],
  ] as const)("presents the persisted %s recommendation without making a customer choice on view", async (state, label) => {
    installClaim(reviewedClaim(recommendedResponse(state)));
    const writes = vi.fn();
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/decision`, () => {
      writes(); return new HttpResponse(null, { status: 500 });
    }));
    const view = renderJourney("report", "response-reviewed");
    await screen.findByRole("heading", { name: "Venfour’s recommendation" });
    const card = screen.getByRole("heading", { name: "Venfour’s recommendation" }).parentElement!;
    expect(within(card).getByText(label, { selector: "strong" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept offer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue challenging" })).toBeEnabled();
    expect(screen.queryByText("Review their revised offer")).not.toBeInTheDocument();
    expect(screen.getByText("The revised amount was compared with the saved evidence range.")).toBeVisible();
    expect(writes).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    await act(async () => { await view.queryClient.invalidateQueries(); });
    expect(within(card).getByText(label, { selector: "strong" })).toBeVisible();
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(["ACCEPT_OFFER", "CONTINUE_CHALLENGING"] as const)("records an explicit %s choice independently from the recommendation and resumes it", async (choice) => {
    const recommendationState = choice === "ACCEPT_OFFER" ? "CONTINUE_CHALLENGING" : "NO_CLEAR_RECOMMENDATION";
    const initial = reviewedClaim(recommendedResponse(recommendationState));
    const installed = installClaim(initial);
    const writes: TotalLossResponseDecisionInput[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/decision`, async ({ request: update, params }) => {
      const input = await update.json() as TotalLossResponseDecisionInput;
      expect(params.responseId).toBe(initial.insurerResponse!.responseId);
      writes.push(input);
      await gate;
      const response = decisionResponse(initial.insurerResponse!, input);
      installed.setClaim({ ...initial, insurerResponse: response, workflow: { ...initial.workflow!, revision: 16 } });
      return HttpResponse.json({ state: "insurer_response_reviewed", response: publicInsurerResponseProjection(response), workflowRevision: 16 });
    }));
    const user = userEvent.setup();
    const first = renderJourney("report", "response-reviewed");
    const label = choice === "ACCEPT_OFFER" ? "Accept offer" : "Continue challenging";
    const button = await screen.findByRole("button", { name: label });
    expect(writes).toHaveLength(0);
    await user.dblClick(button);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Saving choice…" })).toBeDisabled();
    expect(writes[0]).toEqual({
      clientRequestId: expect.any(String), recommendationId: initial.insurerResponse!.recommendation!.recommendationId,
      choice, offerId: choice === "ACCEPT_OFFER" ? initial.insurerResponse!.usableOffer!.offerId : null,
      workflowRevision: 15,
    });
    await act(async () => { release?.(); });
    const recorded = choice === "ACCEPT_OFFER" ? "You chose to accept $20,100.00" : "You chose to continue challenging";
    expect(await screen.findByText(recorded)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Accept offer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue challenging" })).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
    expect(screen.getByText(choice === "ACCEPT_OFFER" ? /case remains open/u : /Your choice is saved\. Review and send/u)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Prepare my follow-up" })).toBe(choice === "ACCEPT_OFFER" ? null : screen.getByRole("link", { name: "Prepare my follow-up" }));
    first.unmount();
    renderJourney("report", "response-reviewed");
    expect(await screen.findByText(recorded)).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(screen.getByText(recommendationState === "NO_CLEAR_RECOMMENDATION" ? "No clear recommendation" : "Continue challenging", { selector: ".response-recommendation > strong" })).toBeVisible();
  });

  it("offers Continue without inventing an Accept action from the analyzed amount", async () => {
    installClaim(reviewedClaim(recommendedResponse("NO_CLEAR_RECOMMENDATION", false)));
    renderJourney("report", "response-reviewed");
    expect(await screen.findByText("No clear recommendation")).toBeVisible();
    expect(screen.getAllByText("$20,100.00").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Accept offer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue challenging" })).toBeEnabled();
    expect(screen.getByText("No verified revised offer is available to accept.")).toBeVisible();
  });

  it("restores an interrupted explicit choice and retries the identical request after refresh", async () => {
    const initial = reviewedClaim();
    const installed = installClaim(initial);
    const writes: TotalLossResponseDecisionInput[] = [];
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/decision`, async ({ request: update }) => {
      const input = await update.json() as TotalLossResponseDecisionInput;
      writes.push(input);
      if (writes.length === 1) return HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Try again." } }, { status: 503 });
      const response = decisionResponse(initial.insurerResponse!, input);
      installed.setClaim({ ...initial, insurerResponse: response, workflow: { ...initial.workflow!, revision: 16 } });
      return HttpResponse.json({ state: "insurer_response_reviewed", response: publicInsurerResponseProjection(response), workflowRevision: 16 });
    }));
    const user = userEvent.setup();
    const first = renderJourney("report", "response-reviewed");
    await user.click(await screen.findByRole("button", { name: "Accept offer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t confirm");
    expect(window.sessionStorage.length).toBe(1);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    first.unmount();
    renderJourney("report", "response-reviewed");
    const retry = await screen.findByRole("button", { name: "Retry saving Accept offer" });
    expect(writes).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Continue challenging" })).toBeDisabled();
    await user.click(retry);
    expect(await screen.findByText("You chose to accept $20,100.00")).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("reconciles a lost write acknowledgement with the persisted decision without a second choice", async () => {
    const initial = reviewedClaim();
    const installed = installClaim(initial);
    const writes = vi.fn();
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/decision`, async ({ request: update }) => {
      const input = await update.json() as TotalLossResponseDecisionInput;
      writes();
      installed.setClaim({ ...initial, insurerResponse: decisionResponse(initial.insurerResponse!, input), workflow: { ...initial.workflow!, revision: 16 } });
      return HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Connection interrupted." } }, { status: 503 });
    }));
    renderJourney("report", "response-reviewed");
    await userEvent.click(await screen.findByRole("button", { name: "Continue challenging" }));
    expect(await screen.findByText("You chose to continue challenging")).toBeVisible();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("rebases only the workflow revision when explicitly retrying an unchanged decision", async () => {
    const initial = reviewedClaim();
    const installed = installClaim(initial);
    const writes: TotalLossResponseDecisionInput[] = [];
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/decision`, async ({ request: update }) => {
      const input = await update.json() as TotalLossResponseDecisionInput;
      writes.push(input);
      if (writes.length === 1) {
        installed.setClaim({ ...initial, workflow: { ...initial.workflow!, revision: 16 } });
        return HttpResponse.json({ error: { code: "CONFLICT", message: "The workflow changed." } }, { status: 409 });
      }
      const response = decisionResponse(initial.insurerResponse!, input);
      installed.setClaim({ ...initial, insurerResponse: response, workflow: { ...initial.workflow!, revision: 17 } });
      return HttpResponse.json({ state: "insurer_response_reviewed", response: publicInsurerResponseProjection(response), workflowRevision: 17 });
    }));
    renderJourney("report", "response-reviewed");
    await userEvent.click(await screen.findByRole("button", { name: "Accept offer" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Retry saving Accept offer" }));
    expect(await screen.findByText("You chose to accept $20,100.00")).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[0].workflowRevision).toBe(15);
    expect(writes[1]).toEqual({ ...writes[0], workflowRevision: 16 });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("isolates pending choices from a corrected response and its new recommendation", async () => {
    const initial = reviewedClaim();
    const installed = installClaim(initial);
    const writes: TotalLossResponseDecisionInput[] = [];
    server.use(http.post(`${API}/claim/insurer-responses/:responseId/decision`, async ({ request: update }) => {
      writes.push(await update.json() as TotalLossResponseDecisionInput);
      return HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Try again." } }, { status: 503 });
    }));
    const view = renderJourney("report", "response-reviewed");
    await userEvent.click(await screen.findByRole("button", { name: "Accept offer" }));
    await screen.findByRole("alert");
    const old = initial.insurerResponse!;
    const corrected = { ...recommendedResponse(), responseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", supersedesResponseId: old.responseId,
      recommendation: { ...old.recommendation!, recommendationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", analysisResultId: "ffffffff-ffff-4fff-8fff-ffffffffffff" } };
    installed.setClaim(reviewedClaim(corrected));
    await act(async () => { await view.queryClient.invalidateQueries(); });
    expect(await screen.findByRole("button", { name: "Accept offer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue challenging" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry saving Accept offer" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue challenging" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].recommendationId).toBe(corrected.recommendation.recommendationId);
    expect(writes[1].clientRequestId).not.toBe(writes[0].clientRequestId);
    expect(writes[1].offerId).toBeNull();
  });

  it("labels a visual transcription as derived and preserves original authority", async () => {
    const baseAnalysis = reviewedResponseAnalysis();
    const visualAnalysis: TotalLossInsurerResponseAnalysis = {
      ...baseAnalysis,
      inputCoverage: {
        document: "AVAILABLE",
        limitations: [
          "No reliable local text passages were extracted; the attached PDF must be interpreted directly.",
        ],
        pastedText: "NOT_PROVIDED",
      },
      revisedOffer: {
        ...baseAnalysis.revisedOffer,
        source: "INSURER_RESPONSE",
        visualSourceInterpretation: {
          confidence: "HIGH",
          derivation: "MODEL_VISUAL_TRANSCRIPTION",
          derivedText: "Revised settlement offer: $20,100.00",
          originalSourceAuthoritative: true,
          responseEvidenceRef: RESPONSE_EVIDENCE_REF,
          verificationRequired: true,
        },
      },
      uncertainties: [
        {
          caseEvidenceRefs: [],
          description:
            "The revised-offer amount was derived from a visual reading of the uploaded document. Check it against the saved original before relying on it.",
          responseEvidenceRefs: [RESPONSE_EVIDENCE_REF],
        },
      ],
    };
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({
      ...projection,
      insurerResponse: {
        ...savedInsurerResponse("completed", visualAnalysis),
        analysisEvidence: {
          ...reviewedResponseEvidence(),
          responseEvidence: [
            {
              content: null,
              evidenceRef: RESPONSE_EVIDENCE_REF,
              pageNumber: null,
              sourceType: "DOCUMENT_IMAGE",
            },
          ],
        },
        document: {
          byteSize: 512,
          documentId: "77777777-7777-4777-8777-777777777777",
          mediaType: "image/png",
          originalFilename: "insurer-response.png",
        },
        sourceType: "uploaded_document",
        text: null,
      },
      journey: {
        fulfillmentState: "insurer_response_reviewed",
        nextState: "insurer_response_reviewed",
        retryable: false,
      },
      workflow: {
        currentTask: "insurer_response_reviewed",
        phase: "negotiation",
        revision: 15,
      },
    });

    renderJourney("report", "response-reviewed");

    await screen.findByRole("heading", {
      name: "What the insurer’s response means",
    });
    expect(screen.getByText("Derived visual transcription")).toBeVisible();
    expect(
      screen.getByText("“Revised settlement offer: $20,100.00”"),
    ).toBeVisible();
    expect(
      screen.getByText(/saved insurer document.*authoritative source/iu),
    ).toBeVisible();
    expect(
      screen.getByText("Amount derived from the insurer document"),
    ).toBeVisible();
  });

  it("offers an owner-authorized retry only for a retryable response-review failure", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    const installed = installClaim({
      ...projection,
      insurerResponse: savedInsurerResponse("retryable_failed"),
      journey: {
        fulfillmentState: "insurer_response_review_unavailable",
        nextState: "insurer_response_review_unavailable",
        retryable: true,
      },
      workflow: {
        currentTask: "insurer_response_review_unavailable",
        phase: "negotiation",
        revision: 15,
      },
    });
    const retryBodies: unknown[] = [];
    server.use(
      http.post(`${API}/insurer-response-analysis/retry`, async ({ request }) => {
        retryBodies.push(await request.json());
        const next = {
          ...installed.claim(),
          insurerResponse: savedInsurerResponse("pending"),
          journey: {
            fulfillmentState: "insurer_response_reviewing" as const,
            nextState: "insurer_response_reviewing" as const,
            retryable: false,
          },
          workflow: {
            currentTask: "insurer_response_reviewing",
            phase: "negotiation" as const,
            revision: 16,
          },
        };
        installed.setClaim(next);
        return HttpResponse.json(publicClaimProjection(next));
      }),
    );

    renderJourney("report", "response-reviewing");
    const user = userEvent.setup();
    expect(
      await screen.findByRole("heading", {
        name: "The response review could not be completed",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try review again" }));

    expect(
      await screen.findByRole("heading", {
        name: "Venfour is reviewing the insurer’s response",
      }),
    ).toBeVisible();
    expect(retryBodies).toHaveLength(1);
    expect(retryBodies[0]).toMatchObject({
      expectedWorkflowRevision: 15,
      clientRequestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
    });
  });

  it.each(["unsupported", "terminal_failed"] as const)(
    "keeps an unavailable %s response review neutral and non-actionable",
    async (processingState) => {
      const projection = claimProjection([...BEFORE_REQUEST, "send"]);
      installClaim({
        ...projection,
        insurerResponse: savedInsurerResponse(processingState),
        journey: {
          fulfillmentState: "insurer_response_review_unavailable",
          nextState: "insurer_response_review_unavailable",
          retryable: false,
        },
        workflow: {
          currentTask: "insurer_response_review_unavailable",
          phase: "negotiation",
          revision: 15,
        },
      });

      renderJourney("report", "response-reviewing");
      expect(
        await screen.findByRole("heading", {
          name:
            processingState === "unsupported"
              ? "This response could not be fully reviewed"
              : "The response review could not be completed",
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Try review again" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Correct this response" })).toBeVisible();
    },
  );

  it("explains when a document-only response could not be read", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({
      ...projection,
      insurerResponse: {
        ...savedInsurerResponse(
          "terminal_failed",
          null,
          "unreadable_document",
        ),
        document: {
          byteSize: 4096,
          documentId: "77777777-7777-4777-8777-777777777777",
          mediaType: "application/pdf",
          originalFilename: "insurer-response.pdf",
        },
        revisedOffer: null,
        sourceType: "uploaded_document",
        text: null,
      },
      journey: {
        fulfillmentState: "insurer_response_review_unavailable",
        nextState: "insurer_response_review_unavailable",
        retryable: false,
      },
      workflow: {
        currentTask: "insurer_response_review_unavailable",
        phase: "negotiation",
        revision: 15,
      },
    });

    renderJourney("report", "response-reviewing");

    expect(
      await screen.findByRole("heading", {
        name: "This document could not be reviewed",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Venfour could not reliably read and analyze the submitted document. The original response remains saved, and no case evidence or valuation has changed.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Try review again" }),
    ).not.toBeInTheDocument();
  });

  it("returns a customer reviewing Meaning after sending to the saved request status", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({
      ...projection,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    });
    const user = userEvent.setup();
    const { router } = renderJourney("report", "meaning");

    expect(await screen.findByRole("button", { name: "Return to case status" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Prepare my request" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return to case status" }));
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/waiting`);
  });

  it("keeps the review frame and request URL when saved sent state replaces editing with read-only content", async () => {
    const saved = installClaim(claimProjection(BEFORE_REQUEST));
    const view = renderJourney("report", "request");
    expect(await screen.findByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Waiting for the insurer’s response" })).not.toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Completed analysis" });
    const content = section.querySelector(".review-stage-content");
    expect(content).not.toBeNull();

    const sent = claimProjection([...BEFORE_REQUEST, "send"]);
    server.use(http.get(`${API}/claim`, () => HttpResponse.json({
      ...sent,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    })));
    await act(() => view.queryClient.refetchQueries({ type: "active" }));

    expect(await screen.findByRole("heading", { name: "Your sent request" })).toBeVisible();
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(screen.getByRole("region", { name: "Completed analysis" })).toBe(section);
    expect(section.querySelector(".review-stage-content")).toBe(content);
    expect(section.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.queryByTestId("request-controls")).not.toBeInTheDocument();
    expect(screen.queryByText(/delivery confirmed|insurer received/u)).not.toBeInTheDocument();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it.each([
    ["insurer_response_received", "pending", "response-received"],
    ["insurer_response_reviewing", "processing", "response-reviewing"],
    ["insurer_response_reviewed", "completed", "response-reviewed"],
  ] as const)("keeps saved material reachable without mutations while the case is %s", async (journeyState, processingState, initialStage) => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    const saved = installClaim({
      ...projection,
      insurerResponse: savedInsurerResponse(processingState, processingState === "completed" ? reviewedResponseAnalysis() : null),
      journey: { fulfillmentState: journeyState, nextState: journeyState, retryable: false },
      workflow: { currentTask: journeyState, phase: "negotiation", revision: 15 },
    });
    const originalClaim = saved.claim();
    const user = userEvent.setup();
    const view = renderJourney("report", initialStage);
    const navigation = await screen.findByRole("navigation", { name: "Case sections" });
    const progress = screen.getByRole("progressbar", { name: "Case journey" });
    const progressLabel = progress.getAttribute("aria-valuetext");

    await user.click(within(navigation).getByRole("link", { name: /^Your result/u }));
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(progress).toHaveAttribute("aria-valuetext", progressLabel);
    await user.click(within(navigation).getByRole("link", { name: /^Initial request/u }));
    expect(await screen.findByRole("heading", { name: "Your sent request" })).toBeVisible();
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(screen.queryByTestId("request-controls")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark as sent|copy email|open email app/iu })).not.toBeInTheDocument();
    expect(progress).toHaveAttribute("aria-valuetext", progressLabel);

    await user.click(within(navigation).getByRole("link", { name: /^Waiting for insurer/u }));
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/waiting`);
    expect(screen.queryByRole("button", { name: "I received a response" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Completed analysis" })).toHaveAttribute("data-stage", "waiting");
    expect(progress).toHaveAttribute("aria-valuetext", progressLabel);

    await user.click(within(navigation).getByRole("link", { name: /^Insurer response/u }));
    expect(await screen.findByRole("heading", { name: "The insurer’s response is saved" })).toBeVisible();
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/response-received`);
    expect(view.router.state.location.search).toBe("?view=saved");
    expect(screen.getByText("We can revise the offer to $20,100.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Correct this response" })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: /^Insurer response/u })).toHaveAttribute("aria-current", "page");
    expect(progress).toHaveAttribute("aria-valuetext", progressLabel);
    if (journeyState !== "insurer_response_received") {
      expect(within(navigation).getByRole("link", { name: /^Response review/u })).toHaveAttribute("href", `${BASE}/review/${initialStage}`);
    }
    await act(() => view.queryClient.refetchQueries({ type: "active" }));
    expect(view.router.state.location.pathname).toBe(`${BASE}/review/response-received`);
    expect(view.router.state.location.search).toBe("?view=saved");
    expect(saved.claim()).toEqual(originalClaim);
    expect(saved.writes).toEqual([]);
    expect(saved.responseWrites).toEqual([]);
    expect(saved.responseUploadWrites).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
    expect(request.render).not.toHaveBeenCalled();

    view.unmount();
    renderJourney("report", "response-received?view=saved");
    expect(await screen.findByRole("heading", { name: "The insurer’s response is saved" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute("aria-valuetext", progressLabel);
    expect(saved.claim().workflow!.revision).toBe(15);
    expect(saved.responseWrites).toEqual([]);
  });

  it("does not show sent confirmation from the URL without a saved sent state", async () => {
    const projection = claimProjection(BEFORE_REQUEST);
    installClaim({ ...projection, journey: { ...projection.journey!, nextState: "prepare_request" } });
    const { router } = renderJourney("report", "waiting");
    expect(await screen.findByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(screen.queryByRole("heading", { name: "Waiting for the insurer’s response" })).not.toBeInTheDocument();
  });

  it("explains current listing timing once without treating a historical query date as available historical listings", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      marketEvidence: {
        ...report.marketEvidence,
        primary: {
          ...report.marketEvidence.primary!,
          label: "Primary current market evidence",
          description: "Current listings form the primary external evidence set selected by Phase 3D; they are not labeled as loss-date observations.",
        },
        evidenceDateContext: { ...report.marketEvidence.evidenceDateContext, historicalEvidenceDate: "2026-08-01" },
      },
    } });
    renderJourney("report", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByText(/^Venfour selected 1 current listing for /u)).toBeVisible();
    expect(screen.getByText("This listing was collected on Aug 28, 2026. It shows the market when collected, not necessarily on the date of loss.")).toBeVisible();
    expect(screen.queryByText(/verified as active|historical evidence (?:was|is) unavailable|limited historical coverage/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence used for the comparison|Current advertised-price evidence/u)).not.toBeInTheDocument();
    expect(screen.getByText(/Current listings form the primary external evidence set selected by Phase 3D/u)).not.toBeVisible();
  });

  it("keeps historical comparison prices separate from additional current listings", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, supportedRange: { ...report.conclusion.supportedRange!, evidenceBasis: "Historical advertised-price evidence from around the loss date" } },
      marketEvidence: {
        ...report.marketEvidence,
        comparables: [
          ...["$19,800", "$20,490", "$22,263"].map((advertisedPrice) => ({ ...report.marketEvidence.comparables[0], advertisedPrice, evidenceDate: "2026-08-01", temporalBasis: "Verified active on the evidence date from stored lifecycle records" })),
          { ...report.marketEvidence.comparables[0], role: "SECONDARY", advertisedPrice: "$25,000" },
        ],
        primary: { ...report.marketEvidence.primary!, label: "Primary loss-date historical evidence", description: "Resolved listings active on the loss date form the primary external evidence set selected by Phase 3D.", selectedCount: 3, evidenceDate: "2026-08-01" },
        secondary: { ...report.marketEvidence.primary!, label: "Secondary current market evidence", description: "Current evidence is retained as secondary context and is not combined with the primary loss-date historical price set." },
        evidenceDateContext: { ...report.marketEvidence.evidenceDateContext, historicalEvidenceDate: "2026-08-01" },
      },
    } });
    renderJourney("report", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByText("Venfour selected 3 historical listings for similar vehicles.")).toBeVisible();
    expect(screen.getByText("$19,800 to $22,263")).toBeVisible();
    expect(screen.getByText("These listings were verified as active on Aug 1, 2026, the date used for this comparison.")).toBeVisible();
    expect(screen.getByText("A further 1 current listing provides additional context from Aug 28, 2026. It is not included in the range above. Current listings do not establish prices on the date of loss.")).toBeVisible();
    expect(screen.queryByText(/selected 4|3 current listings|additional historical/u)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("See selected market listings"));
    expect(screen.getByRole("table", { name: "Selected market listings" })).toBeVisible();
    expect(screen.getByText("$25,000")).toBeVisible();
  });

  it("uses neutral timing when the paid evidence labels do not identify a current or historical group", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, supportedRange: { ...report.conclusion.supportedRange!, evidenceBasis: null } },
      marketEvidence: { ...report.marketEvidence, primary: { ...report.marketEvidence.primary!, label: null, description: null, evidenceDate: null } },
    } });
    renderJourney("manual", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByText(/^Venfour selected 1 listing for /u)).toBeVisible();
    expect(screen.getByText("The listing details explain when each price was observed.")).toBeVisible();
    expect(screen.queryByText(/listing was collected on|verified as active|insurer’s comparable vehicles|insurer’s adjustments/u)).not.toBeInTheDocument();
  });

  it.each([
    { insurer: 2300000, insurerLabel: "$23,000", difference: -251000, differenceLabel: "-$2,510", result: "$2,510 above the selected median", meaning: "The valuation is $2,510 above the selected median of $20,490.", position: "above" },
    { insurer: 2049000, insurerLabel: "$20,490", difference: 0, differenceLabel: "$0", result: "Matches the selected median", meaning: "The valuation matches the selected median of $20,490.", position: "within" },
  ])("describes the signed median comparison and $position range position without implying an increase", async ({ insurer, insurerLabel, difference, differenceLabel, result, meaning, position }) => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    const saved = installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, continuingSupported: false, classificationLabel: "No material discrepancy identified", insurerValuation: money(insurer, insurerLabel), indicatedDifference: money(difference, differenceLabel) },
    } });
    const { router } = renderJourney("report", "result");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText(result)).toBeVisible();
    expect(screen.queryByText(/appears low/u)).not.toBeInTheDocument();
    await act(() => router.navigate(`${BASE}/review/meaning`));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(screen.getByText(meaning)).toBeVisible();
    expect(screen.getByText(`Your insurer’s valuation is ${position} the selected advertised-price range.`)).toBeVisible();
    expect(screen.queryByText(/Even the lowest listing|reasonable basis to ask/u)).not.toBeInTheDocument();
    expect(saved.writes).toEqual([]);
  });

  it.each([
    ["report", 4],
    ["manual", 3],
  ] as const)("keeps an unsupported %s review accessible without projecting a case-closure state", async (intakeMode, total) => {
    const projection = claimProjection(BEFORE_REQUEST);
    const report = projection.report!;
    installClaim({
      ...projection,
      journey: { fulfillmentState: "no_dispute", nextState: "no_dispute", retryable: false },
      report: {
        ...report,
        conclusion: {
          ...report.conclusion,
          classificationLabel: "No material discrepancy identified",
          continuingSupported: false,
        },
      },
    });
    const { router } = renderJourney(intakeMode, "request");

    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/meaning`);
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute("aria-valuetext", `Step 1 of ${total}: Understand result`);
    expect(screen.queryByText(report.suggestedFilename)).not.toBeInTheDocument();
    expect(screen.getByText("PDF report · Issued Aug 29, 2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: /request/iu })).not.toBeInTheDocument();
  });

  it("omits monetary comparisons when the insurer value is missing or currencies differ", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, continuingSupported: false, classificationLabel: "Insufficient evidence", insurerValuation: { amountMinorUnits: null, currency: "USD", formatted: "Unavailable" }, indicatedDifference: null, supportedRange: null },
    } });
    const view = renderJourney("manual", "result");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.queryByText(/Not stated|Unavailable|selected median|Selected advertised-price range/u)).not.toBeInTheDocument();
    view.unmount();
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, insurerValuation: { ...report.conclusion.insurerValuation, currency: "CAD" } },
    } });
    renderJourney("manual", "meaning");
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(screen.queryByText(/Even the lowest listing|The offer is .*selected median|offer you entered is below/u)).not.toBeInTheDocument();
  });

  it("does not describe medians from different insurer subsets as a before-and-after adjustment", async () => {
    const projection = claimProjection(["result"]);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      insurerEvidence: {
        ...report.insurerEvidence,
        comparableCount: 2,
        summary: { ...report.insurerEvidence.summary, totalCount: 2, adjustedValueMissingCount: 1, advertisedPrices: { ...report.insurerEvidence.summary.advertisedPrices!, count: 2 } },
      },
    } });
    renderJourney("report", "insurer");
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(screen.getByText("Your insurer’s report includes 2 comparable vehicles.")).toBeVisible();
    expect(screen.getByText("The disclosed advertised prices had a median of $19,800. The disclosed adjusted values had a median of $19,500.")).toBeVisible();
    expect(screen.queryByText(/After the report’s adjustments/u)).not.toBeInTheDocument();
  });
});
