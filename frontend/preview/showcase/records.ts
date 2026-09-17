import type { TotalLossClaimSecured, TotalLossEducationStep, TotalLossInsurerResponse, TotalLossPreparedMessageVersion, TotalLossClaimJourneyState, TotalLossClaimFulfillmentState, TotalLossCaseResolutionInput, TotalLossResponseDecisionInput } from "@/features/total-loss-claim/contracts";
import { EMAIL_PATTERN, validationError } from "@/features/total-loss-claim/request-state";
import data from "./generated/case.json";

export const CASE_ID = "33333333-3333-4333-8333-333333333333";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const INPUT_ID = "11111111-1111-4111-8111-111111111111";
export const REPORT_ID = "44444444-4444-4444-8444-444444444444";
export type Claim = { -readonly [K in keyof TotalLossClaimSecured]: TotalLossClaimSecured[K] };
type Payload = Record<string, unknown>;
export interface Records { responseUploadVerified?: boolean; claim: Claim; prepared: TotalLossPreparedMessageVersion[]; receipts: Record<string, { signature: string; reply: Reply }> }
interface Reply { status: number; data: unknown }
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const ok = (value: unknown): Reply => ({ status: 200, data: value });
const conflict = (message: string): Reply => ({ status: 409, data: { error: { code: "CONFLICT", message } } });
export function educationSteps() {
  return Object.fromEntries(["result", "insurer_review", "valuation", "report", "what_next", "send"].map(step => [step, { viewedAt: null, completedAt: null, skippedAt: null }])) as Record<TotalLossEducationStep, { viewedAt: string | null; completedAt: string | null; skippedAt: string | null }>;
}
export function initialRecords(): Records {
  return { prepared: [], receipts: {}, claim: {
    caseId: CASE_ID, state: "secured", contactEmail: "jordan@example.test",
    commerce: { amountMinorUnits: 19900, currency: "USD", checkoutAvailable: true, entitlementStatus: null, orderStatus: null, paymentStatus: null, nextTask: "checkout" },
    journey: { nextState: "checkout", fulfillmentState: "not_started", retryable: false },
    workflow: { phase: "initial_request", currentTask: "checkout", revision: 1 },
    education: null, report: null, sendingDetails: null, messageDraft: null, responseIntake: null, insurerResponse: null, negotiationHistory: [], resolution: null, followUp: null,
  } };
}
export function transition(claim: Claim, nextState: Extract<TotalLossClaimJourneyState, TotalLossClaimFulfillmentState>, phase: "initial_request" | "negotiation" | "resolution" = "negotiation") {
  claim.journey = { nextState, fulfillmentState: nextState, retryable: false };
  claim.workflow = { currentTask: nextState, phase, revision: claim.workflow!.revision + 1 };
  claim.commerce = { ...claim.commerce!, nextTask: nextState };
}
export function publish(records: Records) {
  const claim = records.claim;
  claim.report = data.report as Claim["report"];
  claim.education = { reportVersionId: REPORT_ID, steps: educationSteps() };
  claim.sendingDetails = { adjusterEmail: "taylor.morgan@example.test", adjusterName: "Taylor Morgan", adjusterEmailConfirmed: false, claimReference: "DEMO-2026-0142", claimReferenceConfirmed: false, customerName: "Jordan Example", insurerName: data.facts.insurerName, vehicleDescription: data.manifest.title, revision: 1 };
  claim.journey = { nextState: "guide_result", fulfillmentState: "report_ready", retryable: false };
  claim.workflow = { phase: "initial_request", currentTask: "guide_result", revision: claim.workflow!.revision + 1 };
  claim.commerce = { ...claim.commerce!, nextTask: "guide_result" };
}
function replaceResponse(claim: Claim, response: TotalLossInsurerResponse) {
  claim.insurerResponse = response;
  claim.negotiationHistory = claim.negotiationHistory?.map(round => ({ ...round, responses: round.responses.map(item => item.responseId === response.responseId ? response : item) }));
}
export function advanceResponse(records: Records) {
  const claim = records.claim, response = claim.insurerResponse;
  if (!response || claim.resolution || !["pending", "processing"].includes(response.processingState)) return;
  if (Date.now() - Date.parse(response.receivedAt) < 800) return;
  const responseData = response.document ? data.responseWithDocument : data.response;
  const { policyInput: _policyInput, offer, ...recommendation } = responseData.recommendation;
  replaceResponse(claim, { ...response, processingState: "completed", analysis: responseData.analysis as TotalLossInsurerResponse["analysis"], analysisEvidence: responseData.analysisEvidence as TotalLossInsurerResponse["analysisEvidence"],
    recommendation: { ...recommendation, recommendationId: id(), analysisResultId: id(), versionNumber: 1 } as TotalLossInsurerResponse["recommendation"],
    usableOffer: offer ? { ...offer, offerId: id() } as TotalLossInsurerResponse["usableOffer"] : null });
  transition(claim, "insurer_response_reviewed");
}

// This adapter persists API records; routing, prerequisites, forms and progress
// remain owned by the current customer application.
export function recordRequest(records: Records, path: string, method: string, body: Payload): Reply | undefined {
  const { claim } = records;
  const revision = () => claim.workflow!.revision;
  const active = () => !claim.education?.steps.send.completedAt && !claim.resolution;
  const bump = () => { claim.workflow = { ...claim.workflow!, revision: revision() + 1 }; };
  const record = (run: () => Reply) => {
    if (claim.resolution) return conflict("This case is already resolved.");
    const request = typeof body.clientRequestId === "string" ? body.clientRequestId : null;
    const signature = JSON.stringify({ path, ...body, workflowRevision: undefined, expectedWorkflowRevision: undefined });
    const receipt = request ? records.receipts[request] : null;
    if (receipt) return signature === receipt.signature ? receipt.reply : conflict("This request was already used for another action.");
    const reply = run();
    if (request && reply.status === 200) records.receipts[request] = { signature, reply: structuredClone(reply) };
    return reply;
  };
  if (path === "/follow-up" && method === "GET") return ok({ followUp: claim.followUp });
  if (path === "/message-draft" && method === "GET") return ok({ messageDraft: claim.messageDraft });
  if (!claim.report || claim.commerce?.entitlementStatus !== "active") return undefined;
  if (path === "/sending-details" && method === "PUT") return record(() => {
    if (!active() || body.expectedWorkflowRevision !== revision() || body.expectedRevision !== claim.sendingDetails!.revision) return conflict("The sending details changed. Refresh and try again.");
    if (typeof body.adjusterEmail !== "string" || !EMAIL_PATTERN.test(body.adjusterEmail) || !body.adjusterEmailConfirmed || (body.claimReference && !body.claimReferenceConfirmed)) return conflict("Confirm the adjuster’s email and claim number.");
    claim.sendingDetails = { ...claim.sendingDetails!, adjusterEmail: body.adjusterEmail, adjusterEmailConfirmed: true, claimReference: body.claimReference as string | null, claimReferenceConfirmed: body.claimReferenceConfirmed === true, revision: claim.sendingDetails!.revision + 1 };
    bump(); return ok({ sendingDetails: claim.sendingDetails, workflowRevision: revision() });
  });
  if (path === "/message-draft" && method === "PATCH") return record(() => {
    const draft = claim.messageDraft;
    if (!active() || !draft || body.expectedRevision !== draft.revision) return conflict("The saved draft changed.");
    if (typeof body.recipient !== "string" || typeof body.subject !== "string" || typeof body.body !== "string") return conflict("Check the message fields.");
    const content = { recipient: body.recipient, subject: body.subject, body: body.body };
    if (validationError(content)) return conflict("Check the message fields.");
    claim.messageDraft = { ...draft, ...content, revision: draft.revision + 1, updatedAt: now() }; return ok(claim.messageDraft);
  });
  if (path === "/message/prepare" && method === "POST") return record(() => {
    if (!active() || body.expectedWorkflowRevision !== revision() || !claim.sendingDetails?.adjusterEmailConfirmed || !claim.sendingDetails.claimReferenceConfirmed) return conflict("Confirm your sending details first.");
    claim.messageDraft ??= { ...data.requestMessage, draftId: id(), reportVersionId: REPORT_ID, purpose: "initial_reconsideration", revision: 1, recipient: claim.sendingDetails.adjusterEmail, updatedAt: now() };
    const draft = claim.messageDraft;
    const message = { body: draft.body, recipient: draft.recipient!, subject: draft.subject, reportVersionId: REPORT_ID, messageVersionId: id(), versionNumber: records.prepared.length + 1, state: "prepared" as const, createdAt: now() };
    records.prepared.push(message); bump(); return ok({ draft, messageVersion: message, workflowRevision: revision() });
  });
  if (path === "/message/opened" && method === "POST") return record(() => records.prepared.some(item => item.messageVersionId === body.messageVersionId) ? ok({ recorded: true }) : conflict("Prepare the message first."));
  if (path === "/message/sent" && method === "POST") return record(() => {
    const message = records.prepared.find(item => item.messageVersionId === body.messageVersionId), draft = claim.messageDraft;
    if (!active() || body.expectedWorkflowRevision !== revision() || body.confirmedReportAttached !== true || !message || !draft || message.body !== draft.body || message.subject !== draft.subject || message.recipient !== draft.recipient) return conflict("Confirm the current prepared message and report attachment.");
    const sentAt = now(), roundId = id(), communicationId = id();
    claim.education = { ...claim.education!, steps: { ...claim.education!.steps, send: { completedAt: sentAt, viewedAt: sentAt, skippedAt: null } } };
    transition(claim, "awaiting_insurer_response");
    claim.responseIntake = { negotiationRoundId: roundId, outboundCommunicationId: communicationId };
    claim.negotiationHistory = [{ negotiationRoundId: roundId, roundNumber: 1, responses: [], followUp: null, supersededFollowUpDrafts: [], outbound: { ...message, state: "sent", customerReportedSentAt: sentAt, communicationId, negotiationRoundId: roundId } }];
    const key = `venfour:insurer-response-draft:v2:${[USER_ID, CASE_ID, roundId, communicationId, "new"].map(encodeURIComponent).join(":")}`;
    sessionStorage.setItem(key, JSON.stringify({ version: 1, clientRequestId: id(), responseText: data.response.text, offer: String(data.response.offer / 100), retainDocument: false, attachment: null }));
    return ok({ state: "awaiting_insurer_response", customerReportedSentAt: sentAt, messageVersionId: message.messageVersionId, communicationId, negotiationRoundId: roundId, workflowRevision: revision() });
  });
  if (path === "/insurer-response/upload" && method === "POST") {
    if (!claim.responseIntake || body.expectedWorkflowRevision !== revision() || body.outboundCommunicationId !== claim.responseIntake.outboundCommunicationId) return conflict("The response context changed.");
    if (body.contentDigest !== data.responseDocumentDigest || body.byteSize !== data.responseDocument.byteSize) return conflict("Use the synthetic insurer response from this local case. Other files have no precomputed review.");
    return ok({ ...data.responseDocument, contentDigest: data.responseDocumentDigest, uploadPath: `${USER_ID}/${CASE_ID}/${data.responseDocument.originalFilename}` });
  }
  if (path === `/claim/insurer-responses/${claim.insurerResponse?.responseId}/original/download` && method === "POST" && claim.insurerResponse?.document) return ok({ downloadUrl: new URL(`/generated/${data.responseDocument.originalFilename}`, location.origin).href, expiresAt: new Date(Date.now() + 3600000).toISOString(), suggestedFilename: "Insurer_Response_Original.pdf" });
  if (path === "/insurer-response" && method === "POST") return record(() => {
    const intake = claim.responseIntake;
    if (!intake || body.expectedWorkflowRevision !== revision() || body.outboundCommunicationId !== intake.outboundCommunicationId) return conflict("The response context changed.");
    // Saved analysis belongs to this exact fictional response, never to edited evidence.
    if (body.responseText !== data.response.text || body.revisedOfferMinorUnits !== data.response.offer || (body.documentId && (body.documentId !== data.responseDocument.documentId || !records.responseUploadVerified)) || body.retainedDocumentId) return conflict("This offline case has precomputed evidence for the prefilled response. Restore that response or reset the walkthrough.");
    const response: TotalLossInsurerResponse = { responseId: id(), clientRequestId: String(body.clientRequestId), ...intake, receivedAt: now(), sourceType: body.documentId ? "uploaded_document" : "pasted_message", text: data.response.text, document: body.documentId ? data.responseDocument as TotalLossInsurerResponse["document"] : null, revisedOffer: { amountMinorUnits: data.response.offer, currency: "USD" }, processingState: "pending", failureReason: null, supersedesResponseId: null, canCorrect: true, recommendation: null, usableOffer: null, decision: null, analysis: null, analysisEvidence: null };
    claim.insurerResponse = response; claim.responseIntake = null;
    claim.negotiationHistory = claim.negotiationHistory!.map(round => round.negotiationRoundId === intake.negotiationRoundId ? { ...round, responses: [...round.responses, response] } : round);
    transition(claim, "insurer_response_received"); return ok({ state: "insurer_response_received", response, workflowRevision: revision() });
  });
  if (/^\/claim\/insurer-responses\/[^/]+\/decision$/.test(path) && method === "POST") return record(() => {
    const input = body as unknown as TotalLossResponseDecisionInput, response = claim.insurerResponse;
    if (!response?.recommendation || path.split("/")[3] !== response.responseId || response.decision || input.recommendationId !== response.recommendation.recommendationId || input.workflowRevision !== revision()) return conflict("The response changed. Refresh before deciding.");
    if (input.choice !== "ACCEPT_OFFER" || !response.usableOffer || input.offerId !== response.usableOffer.offerId) return conflict("This fixture provides the acceptance and closure branch for the saved revised offer.");
    const decided = { ...response, decision: { decisionId: id(), clientRequestId: input.clientRequestId, recommendationId: input.recommendationId, analysisResultId: response.recommendation.analysisResultId, choice: input.choice, offerId: response.usableOffer.offerId, amountMinorUnits: response.usableOffer.amountMinorUnits, currency: response.usableOffer.currency, recordedAt: now() } };
    replaceResponse(claim, decided); transition(claim, "insurer_response_reviewed"); return ok({ state: "insurer_response_reviewed", response: decided, workflowRevision: revision() });
  });
  if (path === "/claim/resolution" && method === "POST") return record(() => {
    const input = body as unknown as TotalLossCaseResolutionInput, response = claim.insurerResponse;
    if (input.workflowRevision !== revision()) return conflict("The case changed. Refresh before confirming.");
    const accepted = input.resolutionCode === "ACCEPTED_VERIFIED_OFFER";
    if (!["ACCEPTED_VERIFIED_OFFER", "RESOLVED_WITH_INSURER", "CUSTOMER_STOPPED_PURSUING"].includes(input.resolutionCode)) return conflict("Choose a supported case outcome.");
    if (accepted && (!response?.usableOffer || response.decision?.choice !== "ACCEPT_OFFER" || response.decision.decisionId !== input.decisionId || response.usableOffer.offerId !== input.offerId)) return conflict("Confirm the exact offer you chose to accept.");
    if (!accepted && (input.offerId !== null || input.decisionId !== null)) return conflict("This outcome does not accept a saved offer.");
    const amount = accepted ? response!.usableOffer!.amountMinorUnits : input.amountMinorUnits;
    claim.resolution = { code: input.resolutionCode, resolvedAt: now(), customerConfirmed: true, clientRequestId: input.clientRequestId, amountMinorUnits: amount, currency: accepted ? response!.usableOffer!.currency : input.currency, amountSource: accepted ? response!.usableOffer!.source : amount !== null ? "CUSTOMER_REPORTED" : null, offerId: input.offerId, decisionId: input.decisionId, recommendationId: accepted ? response!.recommendation!.recommendationId : null, responseId: accepted ? response!.responseId : null };
    claim.responseIntake = null; transition(claim, "resolved", "resolution"); return ok({ state: "resolved", resolution: claim.resolution, workflowRevision: revision() });
  });
  return undefined;
}
