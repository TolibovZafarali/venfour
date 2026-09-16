import type { TotalLossClaimSecured, TotalLossInsurerResponse } from "@/features/total-loss-claim/contracts";
import { claimProjection, completedEducationSteps, NOW } from "./claim-fixtures";
import { createSyntheticResponseFlow } from "./response-flow";

export const responseScenarios = [
  ["response", "Add insurer response", "The response form for a sent request."],
  ["response-received", "Response received", "A saved written response and revised offer."],
  ["response-reviewing", "Reviewing response", "The response review in progress."],
  ["response-reviewed", "Response reviewed · Interactive", "Review a fictional reply, save your choice, and continue when ready."],
  ["follow-up", "Prepare your follow-up · Interactive", "Create, edit, and simulate sending a follow-up. Continue when ready."],
  ["acceptance", "Confirm acceptance · Interactive", "Review an offer, confirm acceptance, and close a fictional case."],
  ["resolution", "Your case record", "A saved outcome, report, and expandable case history."],
] as const;
export type ResponseScenario = typeof responseScenarios[number][0];
export function isResponseScenario(phase: string): phase is ResponseScenario {
  return responseScenarios.some(item => item[0] === phase);
}
export function responseClaim(phase: ResponseScenario): TotalLossClaimSecured {
  const progress = completedEducationSteps();
  progress.send = { completedAt: NOW, viewedAt: NOW, skippedAt: null };
  const claim = claimProjection({ journey: "awaiting_insurer_response", progress, withDraft: true }) as unknown as { -readonly [K in keyof TotalLossClaimSecured]: TotalLossClaimSecured[K] };
  if (phase === "response") return claim;
  const round = claim.negotiationHistory![0];
  const response: TotalLossInsurerResponse = {
    responseId: "88888888-8888-4888-8888-888888888888", clientRequestId: "99999999-9999-4999-8999-999999999999",
    negotiationRoundId: round.negotiationRoundId, outboundCommunicationId: round.outbound.communicationId,
    receivedAt: NOW, sourceType: "pasted_message", text: "We reviewed your request and revised our vehicle valuation to $19,500. Please let us know if you have additional evidence.",
    document: null, revisedOffer: { amountMinorUnits: 1950000, currency: "USD" },
    processingState: phase === "response-reviewing" ? "processing" : "pending", failureReason: null,
    supersedesResponseId: null, canCorrect: true, recommendation: null, usableOffer: null, decision: null,
    analysis: null, analysisEvidence: null,
  };
  claim.insurerResponse = response;
  claim.responseIntake = null;
  claim.negotiationHistory = [{ ...round, responses: [response] }];
  const next = phase === "response-reviewing" ? "insurer_response_reviewing" : "insurer_response_received";
  claim.journey = { nextState: next, fulfillmentState: next, retryable: false };
  claim.workflow = { currentTask: next, phase: "negotiation", revision: 8 };
  if (phase === "response-received" || phase === "response-reviewing") return claim;
  const receipts = new Map<string, string>();
  const memory = { getItem: (key: string) => receipts.get(key) ?? null, setItem: (key: string, value: string) => { receipts.set(key, value); } } as Storage;
  const flow = createSyntheticResponseFlow(claim, () => {}, memory, "screen-preview");
  flow.advanceReview(Date.parse(NOW) + 5000);
  if (phase === "follow-up") {
    flow.handle(`/claim/insurer-responses/${response.responseId}/decision`, "POST", {
      clientRequestId: crypto.randomUUID(), recommendationId: claim.insurerResponse!.recommendation!.recommendationId,
      workflowRevision: claim.workflow!.revision, choice: "CONTINUE_CHALLENGING", offerId: null,
    });
  }
  if (phase === "acceptance") flow.handle(`/claim/insurer-responses/${response.responseId}/decision`, "POST", {
    clientRequestId: crypto.randomUUID(), recommendationId: claim.insurerResponse!.recommendation!.recommendationId,
    workflowRevision: claim.workflow!.revision, choice: "ACCEPT_OFFER", offerId: claim.insurerResponse!.usableOffer!.offerId,
  });
  if (phase === "resolution") flow.handle("/claim/resolution", "POST", {
    clientRequestId: crypto.randomUUID(), workflowRevision: claim.workflow!.revision,
    resolutionCode: "RESOLVED_WITH_INSURER", decisionId: null, offerId: null, amountMinorUnits: 1950000, currency: "USD",
  });
  return claim;
}

export function responsePayload(claim: TotalLossClaimSecured) {
  const wireResponse = (response: TotalLossInsurerResponse) => {
    if (response.processingState === "completed") return response;
    return Object.fromEntries(Object.entries(response).filter(([key]) => key !== "analysis" && key !== "analysisEvidence"));
  };
  return { ...claim, insurerResponse: claim.insurerResponse ? wireResponse(claim.insurerResponse) : null,
    negotiationHistory: claim.negotiationHistory?.map(round => ({ ...round, responses: round.responses.map(wireResponse) })),
  };
}
