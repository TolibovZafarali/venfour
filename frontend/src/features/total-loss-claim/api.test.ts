import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  createTotalLossCheckout,
  getTotalLossCheckoutQuote,
  getTotalLossClaim,
  getTotalLossInsurerResponseDownload,
  getTotalLossFollowUp,
  generateTotalLossFollowUp,
  getTotalLossMessageDraft,
  initializeTotalLossClaim,
  prepareTotalLossInsurerResponseUpload,
  recordTotalLossInsurerResponse,
  recordTotalLossInsurerResponseDecision,
  retryTotalLossInsurerResponseAnalysis,
  renewTotalLossClaimAccessLink,
  requestTotalLossClaimRecovery,
} from "@/features/total-loss-claim/api";
import { server } from "@/test/mocks/server";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CASE_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const RESPONSE_REF = `response_${"a".repeat(64)}`;
const CASE_REF = `case_${"b".repeat(64)}`;
const RECOMMENDATION_ID = "11111111-1111-4111-8111-111111111111";
const ANALYSIS_RESULT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function savedFollowUpProjection() {
  return {
    state: "draft", decisionId: OFFER_ID, responseId: CLAIM_ID, analysisResultId: ANALYSIS_RESULT_ID, reportVersionId: OTHER_CASE_ID,
    draft: { draftId: RECOMMENDATION_ID, purpose: "follow_up_reconsideration", recipient: "adjuster@example.com", subject: "Follow-up", body: "Thank you for reviewing my request.", reportVersionId: OTHER_CASE_ID, revision: 1, updatedAt: "2026-09-02T12:00:00Z" },
    preparedMessage: null, sentMessage: null, reasonCode: null,
  };
}

describe("follow-up API contracts", () => {
  it("maps the distinct immutable sent state and retains its exact message", async () => {
    const followUp = savedFollowUpProjection();
    const sentMessage = {
      ...followUp.draft, state: "sent", messageVersionId: CASE_ID, createdAt: "2026-09-02T12:01:00Z", versionNumber: 2,
      customerReportedSentAt: "2026-09-02T12:02:00Z", communicationId: CLAIM_ID, negotiationRoundId: OFFER_ID,
    };
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/follow-up", () => HttpResponse.json({ ...followUp, state: "sent", sentMessage })));
    await expect(getTotalLossFollowUp(CASE_ID, "owner-token")).resolves.toMatchObject({ state: "sent", sentMessage: { state: "sent", body: sentMessage.body, messageVersionId: CASE_ID, customerReportedSentAt: sentMessage.customerReportedSentAt } });
  });
  it("reads a saved follow-up and generation binds the explicit decision", async () => {
    const followUp = savedFollowUpProjection();
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/follow-up", () => HttpResponse.json(followUp)),
      http.post("*/api/v1/appraisal-cases/:caseId/follow-up", async ({ request }) => {
        expect(await request.json()).toEqual({ decisionId: OFFER_ID });
        return HttpResponse.json({ followUp });
      }),
    );
    await expect(getTotalLossFollowUp(CASE_ID, "owner-token")).resolves.toEqual(followUp);
    await expect(generateTotalLossFollowUp(CASE_ID, "owner-token", OFFER_ID)).resolves.toEqual(followUp);
    await expect(getTotalLossMessageDraft(CASE_ID, "owner-token", undefined, RECOMMENDATION_ID)).resolves.toEqual(followUp.draft);
    await expect(getTotalLossMessageDraft(CASE_ID, "owner-token", undefined, CLAIM_ID)).rejects.toThrow("no longer current");
  });

  it.each([
    { state: "sent" },
    { draft: { ...savedFollowUpProjection().draft, purpose: "initial_reconsideration" } },
    { draft: { ...savedFollowUpProjection().draft, reportVersionId: CASE_ID } },
  ])("rejects an inconsistent or original-request follow-up projection %o", async (patch) => {
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/follow-up", () => HttpResponse.json({ ...savedFollowUpProjection(), ...patch })));
    await expect(getTotalLossFollowUp(CASE_ID, "owner-token")).rejects.toThrow();
  });

  it("rejects a generated draft for another decision", async () => {
    server.use(http.post("*/api/v1/appraisal-cases/:caseId/follow-up", () => HttpResponse.json(savedFollowUpProjection())));
    await expect(generateTotalLossFollowUp(CASE_ID, "owner-token", CLAIM_ID)).rejects.toThrow("could not be verified");
  });
});

function recommendedResponseProjection() {
  return {
    responseId: CLAIM_ID, clientRequestId: OTHER_CASE_ID,
    receivedAt: "2026-09-01T12:00:00.000Z", sourceType: "pasted_message", text: "The insurer revised the offer.",
    document: null, revisedOffer: { amountMinorUnits: 2_010_000, currency: "USD" },
    processingState: "completed", failureReason: null, supersedesResponseId: null,
    analysis: responseAnalysis(), analysisEvidence: responseAnalysisEvidence(),
    recommendation: {
      recommendationId: RECOMMENDATION_ID, versionNumber: 1, analysisResultId: ANALYSIS_RESULT_ID,
      schemaVersion: "1", policyVersion: "2", state: "CONTINUE_CHALLENGING",
      summary: "The evidence supports continuing to challenge.", reasons: ["The offer remains below the saved evidence range."],
      reasonCodes: ["OFFER_BELOW_SUPPORTED_RANGE"], limitations: ["Advertised prices are not guaranteed settlement values."],
      responseEvidenceRefs: [RESPONSE_REF], caseEvidenceRefs: [CASE_REF],
    },
    usableOffer: { offerId: OFFER_ID, amountMinorUnits: 2_010_000, currency: "USD", source: "CUSTOMER_RECORDED" },
    decision: null as Record<string, unknown> | null,
  };
}

function recommendationResolver(response: unknown) {
  return {
    state: "secured", caseId: CASE_ID, commerce: null, contactEmail: "owner@example.com", insurerResponse: response,
    journey: { fulfillmentState: "insurer_response_reviewed", nextState: "insurer_response_reviewed", retryable: false },
    workflow: { phase: "negotiation", currentTask: "insurer_response_reviewed", revision: 15 },
  };
}

function acceptedDecision() {
  return {
    decisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", clientRequestId: OTHER_CASE_ID,
    recommendationId: RECOMMENDATION_ID, analysisResultId: ANALYSIS_RESULT_ID,
    choice: "ACCEPT_OFFER", offerId: OFFER_ID, amountMinorUnits: 2_010_000, currency: "USD", recordedAt: "2026-09-02T12:00:00Z",
  };
}

describe("persisted response recommendations and decisions", () => {
  it.each(["CONTINUE_CHALLENGING", "NO_CLEAR_RECOMMENDATION"])("maps authoritative %s independently of the response-analysis suggestion", async (state) => {
    const response = recommendedResponseProjection();
    response.recommendation.state = state;
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver(response))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).resolves.toMatchObject({ insurerResponse: {
      recommendation: response.recommendation, usableOffer: response.usableOffer, decision: null,
    } });
  });

  it("preserves a recorded choice and exact offer when prior policy advice is withheld", async () => {
    const response = recommendedResponseProjection();
    response.recommendation.policyVersion = "1";
    response.recommendation.state = "NO_CLEAR_RECOMMENDATION";
    response.recommendation.reasonCodes = ["SAVED_RECOMMENDATION_POLICY_SUPERSEDED"];
    response.recommendation.reasons = ["The saved advice predates the corrected assessment policy."];
    response.decision = acceptedDecision();
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver(response))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).resolves.toMatchObject({ insurerResponse: {
      recommendation: response.recommendation, usableOffer: response.usableOffer, decision: response.decision,
    } });
  });

  it.each([
    { policyVersion: "3" }, { schemaVersion: "2" }, { state: "GUARANTEED_WIN" },
    { policyVersion: "1", state: "ACCEPT_OFFER" }, { policyVersion: "1", state: "CONTINUE_CHALLENGING" },
    { policyVersion: "2", state: "ACCEPT_OFFER" },
    { policyInput: { internal: true } }, { responseEvidenceRefs: [`response_${"c".repeat(64)}`] },
    { responseEvidenceRefs: [RESPONSE_REF, RESPONSE_REF] }, { reasons: Array.from({ length: 11 }, () => "A reason.") },
  ])("rejects unknown, internal or ungrounded recommendation fields: %o", async (patch) => {
    const response = recommendedResponseProjection();
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver({ ...response, recommendation: { ...response.recommendation, ...patch } }))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow();
  });

  it.each([
    { offerId: OTHER_CASE_ID }, { amountMinorUnits: 3_000_000 }, { currency: "CAD" },
    { recommendationId: OTHER_CASE_ID }, { analysisResultId: OTHER_CASE_ID },
    { choice: "CONTINUE_CHALLENGING" },
  ])("rejects a decision with mismatched immutable source or offer binding: %o", async (patch) => {
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver({
      ...recommendedResponseProjection(), decision: { ...acceptedDecision(), ...patch },
    }))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow("inconsistent response recommendation or decision lineage");
  });

  it("keeps a usable exact offer independent from the model offer source", async () => {
    const response = recommendedResponseProjection();
    response.analysis.revisedOffer.source = "INSURER_RESPONSE";
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver(response))));
    expect((await getTotalLossClaim(CASE_ID, "owner-token")).insurerResponse?.usableOffer?.offerId).toBe(OFFER_ID);
  });

  it.each([
    { revisedOffer: null },
    { revisedOffer: { amountMinorUnits: 1_900_000, currency: "USD" } },
    { revisedOffer: { amountMinorUnits: 2_010_000, currency: "CAD" } },
  ])("rejects a customer-recorded usable offer inconsistent with its original record: %o", async (patch) => {
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver({ ...recommendedResponseProjection(), ...patch }))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow("inconsistent usable insurer offer");
  });

  it("rejects a usable offer that differs from the analyzed amount", async () => {
    const response = recommendedResponseProjection();
    response.usableOffer.amountMinorUnits = 2_100_000;
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver(response))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow("inconsistent usable insurer offer");
  });

  it("does not treat a visual transcription as a usable response-text offer", async () => {
    const response = recommendedResponseProjection();
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver({
      ...response,
      usableOffer: { ...response.usableOffer, source: "RESPONSE_TEXT" },
      analysis: { ...response.analysis, revisedOffer: { ...response.analysis.revisedOffer, visualSourceInterpretation: {
        derivation: "MODEL_VISUAL_TRANSCRIPTION", derivedText: "Revised offer: $20,100", responseEvidenceRef: RESPONSE_REF,
        confidence: "HIGH", originalSourceAuthoritative: true, verificationRequired: true,
      } } },
    }))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow("inconsistent usable insurer offer");
  });

  it("supports the complete 250-item recommendation reference boundary", async () => {
    const response = recommendedResponseProjection();
    const additional = Array.from({ length: 249 }, (_, index) => ({
      ...response.analysisEvidence.responseEvidence[0], evidenceRef: `response_${index.toString(16).padStart(64, "0")}`,
    }));
    response.analysisEvidence.responseEvidence.push(...additional);
    response.recommendation.responseEvidenceRefs = response.analysisEvidence.responseEvidence.map((item) => item.evidenceRef);
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver(response))));
    expect((await getTotalLossClaim(CASE_ID, "owner-token")).insurerResponse?.recommendation?.responseEvidenceRefs).toHaveLength(250);
  });

  it("does not allow an Accept recommendation without a usable stored offer", async () => {
    const response = recommendedResponseProjection();
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(recommendationResolver({
      ...response, recommendation: { ...response.recommendation, state: "ACCEPT_OFFER" }, usableOffer: null,
    }))));
    await expect(getTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow("unsupported recommendation advice");
  });

  it.each(["ACCEPT_OFFER", "CONTINUE_CHALLENGING"] as const)("posts an explicit %s bound to the exact recommendation and validates the acknowledgement", async (choice) => {
    const input = { clientRequestId: OTHER_CASE_ID, recommendationId: RECOMMENDATION_ID, choice, offerId: choice === "ACCEPT_OFFER" ? OFFER_ID : null, workflowRevision: 15 };
    const response = { ...recommendedResponseProjection(), decision: { ...acceptedDecision(), choice, offerId: input.offerId,
      amountMinorUnits: choice === "ACCEPT_OFFER" ? 2_010_000 : null, currency: choice === "ACCEPT_OFFER" ? "USD" : null } };
    server.use(http.post(`*/api/v1/appraisal-cases/:caseId/claim/insurer-responses/:responseId/decision`, async ({ request, params }) => {
      expect(params).toMatchObject({ caseId: CASE_ID, responseId: CLAIM_ID });
      expect(request.headers.get("Authorization")).toBe("Bearer owner-token");
      expect(await request.json()).toEqual(input);
      return HttpResponse.json({ state: "insurer_response_reviewed", response, workflowRevision: 16 });
    }));
    await expect(recordTotalLossInsurerResponseDecision(CASE_ID, CLAIM_ID, "owner-token", input)).resolves.toMatchObject({ response: { decision: response.decision }, workflowRevision: 16 });
  });

  it("rejects a successful-looking acknowledgement for another request", async () => {
    server.use(http.post(`*/api/v1/appraisal-cases/:caseId/claim/insurer-responses/:responseId/decision`, () => HttpResponse.json({
      state: "insurer_response_reviewed", response: { ...recommendedResponseProjection(), decision: { ...acceptedDecision(), clientRequestId: CASE_ID } }, workflowRevision: 16,
    })));
    await expect(recordTotalLossInsurerResponseDecision(CASE_ID, CLAIM_ID, "owner-token", { clientRequestId: OTHER_CASE_ID, recommendationId: RECOMMENDATION_ID, choice: "ACCEPT_OFFER", offerId: OFFER_ID, workflowRevision: 15 })).rejects.toThrow("inconsistent response decision confirmation");
  });
});

describe("submitted insurer response original access", () => {
  const path = `/api/v1/appraisal-cases/${CASE_ID}/claim/insurer-responses/${OTHER_CASE_ID}/original/download`;

  it.each(["pdf", "jpg", "png", "heic", "heif"])("requests a private authorized %s original without a raw locator", async (extension) => {
    const projection = {
      downloadUrl: "https://storage.example.test/original?token=signed",
      suggestedFilename: `Insurer_Response_Original.${extension}`,
      expiresAt: "2026-09-02T13:02:00Z",
    };
    server.use(http.post(path, ({ request }) => {
      expect(request.headers.get("Authorization")).toBe("Bearer browser-token");
      expect(request.cache).toBe("no-store");
      return HttpResponse.json(projection);
    }));
    await expect(getTotalLossInsurerResponseDownload(CASE_ID, OTHER_CASE_ID, "browser-token")).resolves.toEqual(projection);
  });

  it.each([
    { suggestedFilename: "../../unsafe.pdf" },
    { suggestedFilename: "Insurer_Response_Original.html" },
    { downloadUrl: "javascript:alert(1)" },
    { downloadUrl: "http://storage.example.test/file" },
    { downloadUrl: "https://user:secret@storage.example.test/file" },
    { storage_object_name: "private/path" },
  ])("rejects unsafe or overexposed download projections: %o", async (mutation) => {
    server.use(http.post(path, () => HttpResponse.json({
      downloadUrl: "https://storage.example.test/original?token=signed",
      suggestedFilename: "Insurer_Response_Original.pdf",
      expiresAt: "2026-09-02T13:02:00Z",
      ...mutation,
    })));
    await expect(getTotalLossInsurerResponseDownload(CASE_ID, OTHER_CASE_ID, "browser-token")).rejects.toThrow();
  });

  it("does not turn a denied original into a download", async () => {
    server.use(http.post(path, () => HttpResponse.json({ error: { code: "CUSTOMER_DELIVERY_NOT_FOUND", message: "Original unavailable." } }, { status: 404 })));
    await expect(getTotalLossInsurerResponseDownload(CASE_ID, OTHER_CASE_ID, "browser-token")).rejects.toMatchObject({ status: 404 });
  });
});

function responseAnalysis() {
  return {
    schemaVersion: "1",
    analysisSummary: {
      whatInsurerSaid: "The insurer revised the offer.",
      whatThisMeans: "The amount changed, while one issue remains unresolved.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    },
    insurerPosition: {
      category: "REVISED_OFFER",
      summary: "The insurer made a revised offer.",
      responseEvidenceRefs: [RESPONSE_REF],
    },
    revisedOffer: {
      status: "PRESENT",
      amountMinorUnits: 2_010_000,
      currency: "USD",
      source: "INSURER_RESPONSE",
      responseEvidenceRefs: [RESPONSE_REF],
      visualSourceInterpretation: null,
    },
    requestDisposition: {
      category: "PARTIALLY_ACCEPTED",
      summary: "The insurer changed the amount but did not address every point.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    },
    responsePoints: [{
      topic: "Offer amount",
      disposition: "ACCEPTED",
      whatInsurerSaid: "The offer is now $20,100.",
      whatThisMeans: "The insurer increased its offer.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
      confidence: "HIGH",
    }],
    insurerArguments: [{
      argument: "The prior comparable method still applies.",
      whatItReliesOn: "The insurer repeated its prior explanation.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    }],
    importantChanges: [{
      description: "The offer increased.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    }],
    unresolvedIssues: [{
      description: "The market listings were not addressed.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    }],
    recommendedNextStep: {
      category: "REVIEW_REVISED_OFFER",
      explanation: "Review the revised amount and remaining issue.",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    },
    confidence: "HIGH",
    uncertainties: [],
    inputCoverage: {
      pastedText: "AVAILABLE",
      document: "NOT_PROVIDED",
      limitations: [],
    },
    untrustedInstructionDetected: true,
    untrustedInstructionFollowed: false,
  };
}

function responseAnalysisEvidence() {
  return {
    responseEvidence: [{
      evidenceRef: RESPONSE_REF,
      sourceType: "PASTED_TEXT",
      content: "The insurer revised the offer to $20,100.",
      pageNumber: null,
    }],
    caseEvidence: [{
      evidenceRef: CASE_REF,
      evidenceType: "CUSTOMER_REQUEST",
      summary: "Please review the valuation and comparable evidence.",
      amountMinorUnits: null,
      currency: null,
    }],
  };
}

describe("total-loss claim API", () => {
  it.each([
    { state: "payment_pending" },
    { checkoutSessionId: "cs_test_different_case" },
    { publishableKey: "pk_live_" + "fixture" },
    { uiMode: "hosted" },
  ])("rejects unsafe Payment Element initialization %o", async (override) => {
    server.use(http.post("*/api/v1/appraisal-cases/:caseId/checkout-sessions", () => HttpResponse.json({
      state: "checkout_ready", checkoutStatus: "open", checkoutUrl: null,
      checkoutSessionId: "cs_test_owned_session", clientSecret: "cs_test_owned_session" + "_secret_fixture",
      publishableKey: "pk_test_" + "fixture", uiMode: "elements", entitlementStatus: null, orderStatus: "pending", ...override,
    })));
    await expect(createTotalLossCheckout(CASE_ID, "owner-token", "request-id")).rejects.toThrow("invalid payment initialization");
  });

  it("does not issue an initialization request when the flag is off", async () => {
    let requests = 0;
    server.use(http.post("*/api/v1/appraisal-cases/:caseId/post-continue", () => {
      requests += 1;
      return HttpResponse.json({});
    }));
    await expect(initializeTotalLossClaim(CASE_ID, "owner-token")).rejects.toThrow("unavailable");
    expect(requests).toBe(0);
  });
  it("accepts the authoritative empty price before the first order exists", async () => {
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json({
      caseId: CASE_ID, state: "secured", contactEmail: "owner@example.test",
      workflow: { phase: "review", currentTask: "secure_claim", revision: 1 },
      commerce: { checkoutAvailable: true, orderStatus: null, paymentStatus: null,
        entitlementStatus: null, nextTask: "checkout", amountMinorUnits: null, currency: null },
    })));
    expect((await getTotalLossClaim(CASE_ID, "owner-token")).commerce).toMatchObject({
      checkoutAvailable: true, amountMinorUnits: null, currency: null,
    });
  });

  it("loads an authenticated read-only checkout quote without creating a session", async () => {
    let authorization: string | null = null;
    let checkoutCreationCalls = 0;
    server.use(
      http.get(
        "*/api/v1/appraisal-cases/:caseId/checkout-quote",
        ({ request }) => {
          authorization = request.headers.get("Authorization");
          return HttpResponse.json({
            amountMinorUnits: 12900,
            availability: "available",
            currency: "USD",
          });
        },
      ),
      http.post("*/api/v1/appraisal-cases/:caseId/checkout-sessions", () => {
        checkoutCreationCalls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    await expect(
      getTotalLossCheckoutQuote(CASE_ID, "access-token"),
    ).resolves.toEqual({
      amountMinorUnits: 12900,
      availability: "available",
      currency: "USD",
    });
    expect(authorization).toBe("Bearer access-token");
    expect(checkoutCreationCalls).toBe(0);
  });

  it("maps an owner-authorized resolver and sends its bearer token", async () => {
    let authorization: string | null = null;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
        authorization = request.headers.get("Authorization");
        return HttpResponse.json({
          state: "secure_required",
          caseId: CASE_ID,
          commerce: null,
          contactEmail: "owner@example.com",
          workflow: {
            phase: "review",
            currentTask: "secure_claim",
            revision: 2,
          },
        });
      }),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).resolves.toEqual({
      state: "secure_required",
      caseId: CASE_ID,
      commerce: null,
      contactEmail: "owner@example.com",
      workflow: {
        phase: "review",
        currentTask: "secure_claim",
        revision: 2,
      },
    });
    expect(authorization).toBe("Bearer access-token");
  });

  it("maps only the customer-safe secured commerce projection", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "secured",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            orderStatus: "paid",
            paymentStatus: "succeeded",
            entitlementStatus: "active",
            nextTask: "purchase_complete",
          },
          contactEmail: "owner@example.com",
          workflow: {
            phase: "review",
            currentTask: "purchase_complete",
            revision: 3,
          },
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).resolves.toEqual({
      state: "secured",
      caseId: CASE_ID,
      commerce: {
        checkoutAvailable: false,
        orderStatus: "paid",
        paymentStatus: "succeeded",
        entitlementStatus: "active",
        nextTask: "purchase_complete",
      },
      contactEmail: "owner@example.com",
      workflow: {
        phase: "review",
        currentTask: "purchase_complete",
        revision: 3,
      },
    });
  });

  it("maps an owner-only received response without exposing a storage path", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json({
        state: "secured",
        caseId: CASE_ID,
        commerce: null,
        contactEmail: "owner@example.com",
        insurerResponse: {
          responseId: CLAIM_ID,
          clientRequestId: OTHER_CASE_ID,
          receivedAt: "2026-09-01T12:00:00.000Z",
          sourceType: "uploaded_document",
          text: "The valuation was revised.",
          document: {
            documentId: OTHER_CASE_ID,
            originalFilename: "insurer-response.png",
            mediaType: "image/png",
            byteSize: 512,
            uploadPath: "must/not/be/projected",
          },
          revisedOffer: { amountMinorUnits: 2_050_000, currency: "USD" },
          processingState: "pending",
          failureReason: null,
          recommendation: null,
          usableOffer: null,
          decision: null,
          supersedesResponseId: null,
        },
        journey: {
          fulfillmentState: "insurer_response_received",
          nextState: "insurer_response_received",
          retryable: false,
        },
        workflow: {
          phase: "negotiation",
          currentTask: "insurer_response_received",
          revision: 9,
        },
      })),
    );

    const claim = await getTotalLossClaim(CASE_ID, "owner-token");
    expect(claim.insurerResponse).toMatchObject({
      responseId: CLAIM_ID,
      text: "The valuation was revised.",
      document: { originalFilename: "insurer-response.png" },
    });
    expect(claim.insurerResponse?.document).not.toHaveProperty("uploadPath");
  });

  it("strictly maps a completed grounded response analysis and rejects arbitrary result fields", async () => {
    const resolver = (analysis: Record<string, unknown>) => ({
      state: "secured",
      caseId: CASE_ID,
      commerce: null,
      contactEmail: "owner@example.com",
      insurerResponse: {
        responseId: CLAIM_ID,
        clientRequestId: OTHER_CASE_ID,
        receivedAt: "2026-09-01T12:00:00.000Z",
        sourceType: "pasted_message",
        text: "The insurer revised the offer.",
        document: null,
        revisedOffer: { amountMinorUnits: 2_010_000, currency: "USD" },
        processingState: "completed",
        failureReason: null,
        recommendation: null,
        usableOffer: null,
        decision: null,
        supersedesResponseId: null,
        analysis,
        analysisEvidence: responseAnalysisEvidence(),
      },
      journey: {
        fulfillmentState: "insurer_response_reviewed",
        nextState: "insurer_response_reviewed",
        retryable: false,
      },
      workflow: {
        phase: "negotiation",
        currentTask: "insurer_response_reviewed",
        revision: 11,
      },
    });
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(resolver(responseAnalysis()))),
    );

    const claim = await getTotalLossClaim(CASE_ID, "owner-token");
    expect(claim.insurerResponse?.analysis).toMatchObject({
      schemaVersion: "1",
      confidence: "HIGH",
      untrustedInstructionDetected: true,
      untrustedInstructionFollowed: false,
      revisedOffer: {
        amountMinorUnits: 2_010_000,
        source: "INSURER_RESPONSE",
      },
    });
    expect(claim.insurerResponse?.analysis?.responsePoints[0]).toMatchObject({
      topic: "Offer amount",
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    });
    expect(claim.insurerResponse?.analysis?.analysisSummary).toMatchObject({
      responseEvidenceRefs: [RESPONSE_REF],
      caseEvidenceRefs: [CASE_REF],
    });
    expect(claim.insurerResponse?.analysisEvidence?.responseEvidence[0]).toMatchObject({
      content: "The insurer revised the offer to $20,100.",
      evidenceRef: RESPONSE_REF,
    });

    const visualAnalysis = {
      ...responseAnalysis(),
      revisedOffer: {
        ...responseAnalysis().revisedOffer,
        visualSourceInterpretation: {
          derivation: "MODEL_VISUAL_TRANSCRIPTION",
          derivedText: "Revised settlement offer: $20,100.00",
          responseEvidenceRef: RESPONSE_REF,
          confidence: "HIGH",
          originalSourceAuthoritative: true,
          verificationRequired: true,
        },
      },
    };
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(resolver(visualAnalysis))),
    );
    const visualClaim = await getTotalLossClaim(CASE_ID, "owner-token");
    expect(
      visualClaim.insurerResponse?.analysis?.revisedOffer
        .visualSourceInterpretation,
    ).toEqual(visualAnalysis.revisedOffer.visualSourceInterpretation);

    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(
          resolver({
            ...visualAnalysis,
            revisedOffer: {
              ...visualAnalysis.revisedOffer,
              visualSourceInterpretation: {
                ...visualAnalysis.revisedOffer.visualSourceInterpretation,
                originalSourceAuthoritative: false,
              },
            },
          }),
        )),
    );
    await expect(
      getTotalLossClaim(CASE_ID, "owner-token"),
    ).rejects.toThrow("invalid visual revised-offer interpretation");

    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(
          resolver({ ...responseAnalysis(), arbitraryWorkflowAction: "SEND_REPLY" }),
        )),
    );
    await expect(
      getTotalLossClaim(CASE_ID, "owner-token"),
    ).rejects.toThrow("invalid insurer-response analysis");
  });

  it("maps only customer-safe response failure reasons that match the processing state", async () => {
    const resolver = (failureReason: unknown) => ({
      state: "secured",
      caseId: CASE_ID,
      commerce: null,
      contactEmail: "owner@example.com",
      insurerResponse: {
        responseId: CLAIM_ID,
        clientRequestId: OTHER_CASE_ID,
        receivedAt: "2026-09-01T12:00:00.000Z",
        sourceType: "uploaded_document",
        text: null,
        document: {
          documentId: OTHER_CASE_ID,
          originalFilename: "insurer-response.pdf",
          mediaType: "application/pdf",
          byteSize: 512,
        },
        revisedOffer: null,
        processingState: "terminal_failed",
        failureReason,
        recommendation: null,
        usableOffer: null,
        decision: null,
        supersedesResponseId: null,
      },
      journey: {
        fulfillmentState: "insurer_response_review_unavailable",
        nextState: "insurer_response_review_unavailable",
        retryable: false,
      },
      workflow: {
        phase: "negotiation",
        currentTask: "insurer_response_review_unavailable",
        revision: 11,
      },
    });
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(resolver("unreadable_document"))),
    );

    await expect(
      getTotalLossClaim(CASE_ID, "owner-token"),
    ).resolves.toMatchObject({
      insurerResponse: {
        failureReason: "unreadable_document",
        processingState: "terminal_failed",
      },
    });

    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(resolver("INSURER_RESPONSE_MATERIAL_UNREADABLE"))),
    );
    await expect(
      getTotalLossClaim(CASE_ID, "owner-token"),
    ).rejects.toThrow("invalid insurer-response failure reason");

    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          ...resolver("generic"),
          insurerResponse: {
            ...resolver("generic").insurerResponse,
            processingState: "pending",
          },
        })),
    );
    await expect(
      getTotalLossClaim(CASE_ID, "owner-token"),
    ).rejects.toThrow("inconsistent insurer-response analysis state");
  });

  it("prepares and records an idempotent insurer response using the exact request bodies", async () => {
    const requestId = OTHER_CASE_ID;
    const digest = "a".repeat(64);
    const bodies: unknown[] = [];
    server.use(
      http.post("*/api/v1/appraisal-cases/:caseId/insurer-response/upload", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          documentId: requestId,
          uploadPath: `11111111-1111-4111-8111-111111111111/${CASE_ID}/insurer-responses/${requestId}.png`,
          originalFilename: "reply.png",
          mediaType: "image/png",
          byteSize: 512,
          contentDigest: digest,
        });
      }),
      http.post("*/api/v1/appraisal-cases/:caseId/insurer-response", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({
          state: "insurer_response_received",
          workflowRevision: 10,
          response: {
            responseId: CLAIM_ID,
            clientRequestId: requestId,
            receivedAt: "2026-09-01T12:00:00.000Z",
            sourceType: "uploaded_document",
            text: body.responseText,
            document: {
              documentId: requestId,
              originalFilename: "reply.png",
              mediaType: "image/png",
              byteSize: 512,
            },
            revisedOffer: null,
            processingState: "pending",
            failureReason: null,
            recommendation: null,
            usableOffer: null,
            decision: null,
            supersedesResponseId: null,
          },
        });
      }),
    );

    await expect(prepareTotalLossInsurerResponseUpload(CASE_ID, "owner-token", {
      byteSize: 512,
      clientRequestId: requestId,
      contentDigest: digest,
      expectedWorkflowRevision: 9,
      mediaType: "image/png",
      originalFilename: "reply.png",
    })).resolves.toMatchObject({ documentId: requestId, contentDigest: digest });
    await expect(recordTotalLossInsurerResponse(CASE_ID, "owner-token", {
      clientRequestId: requestId,
      documentId: requestId,
      expectedWorkflowRevision: 9,
      responseText: "  Preserve this text exactly.\n",
      retainedDocumentId: null,
      revisedOfferMinorUnits: null,
      supersedesResponseId: null,
    })).resolves.toMatchObject({ state: "insurer_response_received", workflowRevision: 10 });
    expect(bodies).toEqual([
      {
        byteSize: 512,
        clientRequestId: requestId,
        contentDigest: digest,
        expectedWorkflowRevision: 9,
        mediaType: "image/png",
        originalFilename: "reply.png",
      },
      {
        clientRequestId: requestId,
        documentId: requestId,
        expectedWorkflowRevision: 9,
        responseText: "  Preserve this text exactly.\n",
        retainedDocumentId: null,
        revisedOfferMinorUnits: null,
        supersedesResponseId: null,
      },
    ]);
  });

  it("retries a response review with the exact revision-fenced body and maps the returned resolver", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/insurer-response-analysis/retry",
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({
            state: "secured",
            caseId: CASE_ID,
            commerce: null,
            contactEmail: "owner@example.com",
            insurerResponse: {
              responseId: CLAIM_ID,
              clientRequestId: OTHER_CASE_ID,
              receivedAt: "2026-09-01T12:00:00.000Z",
              sourceType: "pasted_message",
              text: "The insurer maintained its position.",
              document: null,
              revisedOffer: null,
              processingState: "pending",
              failureReason: null,
              recommendation: null,
              usableOffer: null,
              decision: null,
              supersedesResponseId: null,
            },
            journey: {
              fulfillmentState: "insurer_response_reviewing",
              nextState: "insurer_response_reviewing",
              retryable: false,
            },
            workflow: {
              phase: "negotiation",
              currentTask: "insurer_response_reviewing",
              revision: 12,
            },
          });
        },
      ),
    );

    await expect(
      retryTotalLossInsurerResponseAnalysis(CASE_ID, "owner-token", {
        clientRequestId: OTHER_CASE_ID,
        expectedWorkflowRevision: 11,
      }),
    ).resolves.toMatchObject({
      caseId: CASE_ID,
      insurerResponse: { processingState: "pending", analysis: null },
      journey: { nextState: "insurer_response_reviewing" },
      workflow: { revision: 12 },
    });
    expect(bodies).toEqual([
      {
        clientRequestId: OTHER_CASE_ID,
        expectedWorkflowRevision: 11,
      },
    ]);
  });

  it("counts insurer-response filenames by Unicode code point at the 255-character boundary", async () => {
    const acceptedFilename = `${"🚗".repeat(251)}.png`;
    const rejectedFilename = `${"🚗".repeat(252)}.png`;
    const digest = "b".repeat(64);
    const request = {
      byteSize: 512,
      clientRequestId: OTHER_CASE_ID,
      contentDigest: digest,
      expectedWorkflowRevision: 9,
      mediaType: "image/png" as const,
      originalFilename: acceptedFilename,
    };
    const response = (originalFilename: string) => ({
      byteSize: 512,
      contentDigest: digest,
      documentId: OTHER_CASE_ID,
      mediaType: "image/png",
      originalFilename,
      uploadPath: `11111111-1111-4111-8111-111111111111/${CASE_ID}/insurer-responses/${OTHER_CASE_ID}.png`,
    });
    server.use(
      http.post("*/api/v1/appraisal-cases/:caseId/insurer-response/upload", () =>
        HttpResponse.json(response(acceptedFilename))),
    );

    await expect(
      prepareTotalLossInsurerResponseUpload(CASE_ID, "owner-token", request),
    ).resolves.toMatchObject({ originalFilename: acceptedFilename });

    server.use(
      http.post("*/api/v1/appraisal-cases/:caseId/insurer-response/upload", () =>
        HttpResponse.json(response(rejectedFilename))),
    );
    await expect(
      prepareTotalLossInsurerResponseUpload(CASE_ID, "owner-token", request),
    ).rejects.toThrow("invalid insurer-response upload filename");
  });

  it("maps the allowlisted published-report evidence without provider identifiers", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            entitlementStatus: "active",
            nextTask: "report_ready",
            orderStatus: "paid",
            paymentStatus: "succeeded",
          },
          contactEmail: "owner@example.com",
          report: {
            conclusion: {
              classificationLabel: "Material undervalue signal",
              continuingSupported: true,
              indicatedDifference: {
                amountMinorUnits: 300000,
                currency: "USD",
                formatted: "$3,000.00",
              },
              insurerValuation: {
                amountMinorUnits: 1800000,
                currency: "USD",
                formatted: "$18,000.00",
              },
              limitations: ["Advertised prices are not transaction prices."],
              preliminaryComparison: {
                materialChange: false,
                status: "CONFIRMED",
                summary: "The final review confirmed the preliminary range.",
              },
              summary: "The evidence supports a written reconsideration request.",
              supportedRange: {
                evidenceBasis: "Current advertised-price evidence",
                high: {
                  amountMinorUnits: 2200000,
                  currency: "USD",
                  formatted: "$22,000.00",
                },
                low: {
                  amountMinorUnits: 2000000,
                  currency: "USD",
                  formatted: "$20,000.00",
                },
                median: {
                  amountMinorUnits: 2100000,
                  currency: "USD",
                  formatted: "$21,000.00",
                },
              },
            },
            insurerEvidence: {
              adjustmentContext:
                "Insurer adjustments are shown as disclosed; missing details are not invented.",
              comparableCount: 3,
              comparables: [
                {
                  adjustedValue: "$20,000.00",
                  adjustmentDisclosure: "Fully disclosed",
                  adjustments: {
                    condition: "$0.00",
                    mileage: "$200.00",
                    options: "$0.00",
                    package: "$0.00",
                  },
                  advertisedPrice: "$19,800.00",
                  contributionPercent: 33.33,
                  mileage: 32000,
                  netAdjustment: "$200.00",
                  vehicle: "2022 Example Sedan",
                },
              ],
              insurerName: "Example Insurance",
              methodologyStatement: "Insurer comparables are shown descriptively.",
              summary: {
                adjustedValueMissingCount: 0,
                adjustedValues: null,
                advertisedPriceMissingCount: 0,
                advertisedPrices: null,
                fullyDisclosedAdjustmentCount: 2,
                partiallyDisclosedAdjustmentCount: 1,
                totalCount: 3,
                undisclosedAdjustmentCount: 0,
                unavailableAdjustmentCount: 0,
              },
            },
            issueDate: "2026-08-29",
            marketEvidence: {
              comparables: [
                {
                  advertisedPrice: "$21,000.00",
                  dealer: "Example Motors",
                  distanceMiles: 12.5,
                  evidenceDate: "2026-08-28",
                  location: "Chicago, IL",
                  mileage: 31500,
                  provider: "must-not-pass-through",
                  role: "PRIMARY",
                  sourceListingId: "must-not-pass-through",
                  temporalBasis: "Current listing",
                  vehicle: "2022 Example Sedan",
                  vin: "must-not-pass-through",
                },
              ],
              evidenceDateContext: {
                currentObservedDate: "2026-08-28",
                historicalEvidenceDate: null,
                lossDate: "2026-08-01",
              },
              methodologyStatement: "Only frozen selected evidence is shown.",
              primary: {
                description: "Selected current advertised listings.",
                evidenceDate: "2026-08-28",
                label: "Current market evidence",
                prices: null,
                selectedCount: 1,
              },
              secondary: null,
            },
            reportId: CLAIM_ID,
            status: "published",
            subjectVehicle: { description: "2022 Example Sedan" },
            suggestedFilename: "Venfour_Valuation_Evidence_CASE_v1.pdf",
            versionLabel: "v1",
            versionNumber: 1,
          },
          state: "secured",
          workflow: {
            currentTask: "report_ready",
            phase: "review",
            revision: 4,
          },
        }),
      ),
    );

    const result = await getTotalLossClaim(CASE_ID, "access-token");

    expect(result.state).toBe("secured");
    expect(result.report).toMatchObject({
      conclusion: {
        classificationLabel: "Material undervalue signal",
        preliminaryComparison: {
          status: "CONFIRMED",
          summary: "The final review confirmed the preliminary range.",
        },
      },
      insurerEvidence: {
        comparableCount: 3,
        summary: { fullyDisclosedAdjustmentCount: 2 },
      },
      marketEvidence: {
        comparables: [
          {
            advertisedPrice: "$21,000.00",
            location: "Chicago, IL",
            vehicle: "2022 Example Sedan",
          },
        ],
      },
    });
    expect(result.report?.marketEvidence.comparables[0]).not.toHaveProperty(
      "vin",
    );
    expect(result.report?.marketEvidence.comparables[0]).not.toHaveProperty(
      "provider",
    );
    expect(result.report?.marketEvidence.comparables[0]).not.toHaveProperty(
      "sourceListingId",
    );
  });

  it("rejects unsupported commerce statuses and commerce disclosure before permanent ownership", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "secured",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            orderStatus: "paid",
            paymentStatus: "requires_action",
            entitlementStatus: "active",
            nextTask: "purchase_complete",
          },
          contactEmail: null,
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /invalid payment status/u,
    );

    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "account_switch_required",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            orderStatus: "paid",
            paymentStatus: "succeeded",
            entitlementStatus: "active",
            nextTask: "purchase_complete",
          },
          contactEmail: null,
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /invalid commerce state/u,
    );
  });

  it("rejects case identity drift and contact disclosure in mismatch state", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "account_switch_required",
          caseId: OTHER_CASE_ID,
          commerce: null,
          contactEmail: "must-not-be-returned@example.com",
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /exposed contact details|different case/u,
    );
  });

  it("validates a renewed access link before returning it", async () => {
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        () =>
          HttpResponse.json(
            {
              state: "secure_required",
              caseId: CASE_ID,
              contactEmail: "owner@example.com",
              claimId: CLAIM_ID,
              expiresAt: "2026-08-26T13:00:00.000Z",
            },
            { status: 202 },
          ),
      ),
    );

    await expect(
      renewTotalLossClaimAccessLink(CASE_ID, "access-token"),
    ).resolves.toMatchObject({ caseId: CASE_ID, claimId: CLAIM_ID });
  });

  it("allows an access-link request to report a concurrent secured state without exposing link details", async () => {
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        () =>
          HttpResponse.json({
            state: "secured",
            caseId: CASE_ID,
            contactEmail: null,
            claimId: null,
            expiresAt: null,
          }),
      ),
    );

    await expect(
      renewTotalLossClaimAccessLink(CASE_ID, "access-token"),
    ).resolves.toEqual({
      state: "secured",
      caseId: CASE_ID,
      contactEmail: null,
      claimId: null,
      expiresAt: null,
    });
  });

  it("sends the public recovery body without returning match details", async () => {
    let body: unknown;
    let authorization: string | null = "unexpected";
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-recovery",
        async ({ request }) => {
          authorization = request.headers.get("Authorization");
          body = await request.json();
          return HttpResponse.json({ status: "accepted" }, { status: 202 });
        },
      ),
    );

    await expect(
      requestTotalLossClaimRecovery(CASE_ID, {
        email: "owner@example.com",
        turnstileToken: "fresh-token",
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(body).toEqual({
      email: "owner@example.com",
      turnstileToken: "fresh-token",
    });
    expect(authorization).toBeNull();
  });
});
