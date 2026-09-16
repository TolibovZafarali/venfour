import type { TotalLossClaimSecured, TotalLossInsurerResponse, TotalLossMessageDraft, TotalLossPreparedMessageVersion, TotalLossSentMessage } from "@/features/total-loss-claim/contracts";
import { EMAIL_PATTERN, validationError } from "@/features/total-loss-claim/request-state";
import { CASE_ID, REPORT_ID, claimProjection, completedEducationSteps } from "./claim-fixtures";
import { responsePayload } from "./response-fixtures";
import { renderReconsiderationPreview } from "./reconsideration-message";

type MutableClaim = { -readonly [K in keyof TotalLossClaimSecured]: TotalLossClaimSecured[K] };
type Reply = { status: number; data: unknown };
type Payload = Record<string, unknown>;
export type MessageScenario = "message" | "message-details" | "send" | "waiting";
export const isMessageScenario = (phase: string): phase is MessageScenario => ["message", "message-details", "send", "waiting"].includes(phase);
const key = "venfour-workspace-message-preview-v1";
const now = () => new Date().toISOString();
const ok = (data: unknown): Reply => ({ status: 200, data });
const conflict = (message: string): Reply => ({ status: 409, data: { error: { code: "CONFLICT", message } } });
interface MessageSnapshot {
  claim: MutableClaim;
  prepared: TotalLossPreparedMessageVersion[];
  receipts: Record<string, { signature: string; reply: Reply }>;
}

function newDraft(claim: MutableClaim): TotalLossMessageDraft {
  return {
    draftId: crypto.randomUUID(), reportVersionId: REPORT_ID, purpose: "initial_reconsideration", revision: 1,
    recipient: claim.sendingDetails!.adjusterEmail,
    ...renderReconsiderationPreview({
      claimNumber: claim.sendingDetails!.claimReference,
      adjusterName: claim.sendingDetails!.adjusterName,
      yearMakeModel: "2026 Hyundai Kona", trim: "SE",
      insurerAmountMinorUnits: claim.report!.conclusion.insurerValuation.amountMinorUnits,
      customerName: claim.sendingDetails!.customerName, customerPhone: null,
      findingCode: "CCC_BELOW_EXTERNAL_RANGE",
    }),
    updatedAt: now(),
  };
}

export function resetMessagePreview(phase: MessageScenario, storage: Storage = sessionStorage) {
  const claim = claimProjection({ journey: "prepare_request", progress: completedEducationSteps() }) as unknown as MutableClaim;
  claim.sendingDetails = { ...claim.sendingDetails!, customerName: "Jordan Rivera",
    ...(phase === "message-details" ? { adjusterEmail: null, adjusterEmailConfirmed: false, claimReference: null, claimReferenceConfirmed: false } : {}) };
  if (phase === "send") claim.messageDraft = newDraft(claim);
  storage.setItem(key, JSON.stringify({ claim, prepared: [], receipts: {} } satisfies MessageSnapshot));
  if (phase === "waiting") {
    const prepared = messagePreview(phase, storage).handle("/message/prepare", "POST", {
      clientRequestId: crypto.randomUUID(), expectedWorkflowRevision: claim.workflow!.revision,
    })!.data as { messageVersion: TotalLossPreparedMessageVersion; workflowRevision: number };
    messagePreview(phase, storage).handle("/message/sent", "POST", {
      clientRequestId: crypto.randomUUID(), expectedWorkflowRevision: prepared.workflowRevision,
      messageVersionId: prepared.messageVersion.messageVersionId, confirmedReportAttached: true,
    });
  }
}

export function messagePreview(phase: MessageScenario, storage: Storage = sessionStorage) {
  if (!storage.getItem(key)) resetMessagePreview(phase, storage);
  const state = JSON.parse(storage.getItem(key)!) as MessageSnapshot;
  const { claim } = state;
  const persist = () => storage.setItem(key, JSON.stringify(state));
  const revision = () => claim.workflow!.revision;
  const bump = () => { claim.workflow = { ...claim.workflow!, revision: revision() + 1 }; };
  const active = () => !claim.education?.steps.send.completedAt;
  const record = (path: string, body: Payload, run: () => Reply) => {
    if (typeof body.clientRequestId !== "string") return conflict("A preview request ID is required.");
    const signature = JSON.stringify({ path, ...body, expectedWorkflowRevision: undefined });
    const receipt = state.receipts[body.clientRequestId];
    if (receipt) return receipt.signature === signature ? receipt.reply : conflict("This request ID has already been used.");
    const reply = run();
    if (reply.status === 200) state.receipts[body.clientRequestId] = { signature, reply: structuredClone(reply) };
    persist();
    return reply;
  };
  return {
    claim,
    handle(path: string, method: string, body: Payload): Reply | undefined {
      if (path === "/claim" && method === "GET") return ok(responsePayload(claim));
      if (path === "/insurer-response" && method === "POST") return record(path, body, () => {
        const previous = body.supersedesResponseId ? claim.insurerResponse : null;
        const intake = previous ?? claim.responseIntake;
        if (!intake || body.expectedWorkflowRevision !== revision() || body.outboundCommunicationId !== intake.outboundCommunicationId ||
          (body.supersedesResponseId && (previous?.responseId !== body.supersedesResponseId || !previous.canCorrect))) return conflict("This response changed. Refresh the preview and try again.");
        if (body.documentId || body.retainedDocumentId) return conflict("This preview supports pasted text and revised offers only.");
        const text = typeof body.responseText === "string" ? body.responseText : null;
        const amount = typeof body.revisedOfferMinorUnits === "number" ? body.revisedOfferMinorUnits : null;
        if ((!text?.trim() && amount === null) || (text !== null && (!text.trim() || text.length > 100000)) ||
          (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0))) return conflict("Add the insurer’s response or revised offer.");
        const response: TotalLossInsurerResponse = {
          responseId: crypto.randomUUID(), clientRequestId: body.clientRequestId as string,
          negotiationRoundId: intake.negotiationRoundId, outboundCommunicationId: intake.outboundCommunicationId,
          receivedAt: now(), sourceType: "pasted_message", text, document: null,
          revisedOffer: amount === null ? null : { amountMinorUnits: amount, currency: "USD" },
          processingState: "pending", failureReason: null, supersedesResponseId: previous?.responseId ?? null,
          canCorrect: true, recommendation: null, usableOffer: null, decision: null, analysis: null, analysisEvidence: null,
        };
        claim.insurerResponse = response;
        claim.responseIntake = null;
        claim.negotiationHistory = claim.negotiationHistory?.map(round => round.negotiationRoundId === intake.negotiationRoundId ? {
          ...round, responses: [...round.responses.map(saved => saved.responseId === previous?.responseId ? { ...saved, canCorrect: false } : saved), response],
        } : round);
        claim.journey = { nextState: "insurer_response_received", fulfillmentState: "insurer_response_received", retryable: false };
        claim.workflow = { phase: "negotiation", currentTask: "insurer_response_received", revision: revision() + 1 };
        claim.commerce = { ...claim.commerce!, nextTask: "insurer_response_received" };
        return ok({ state: "insurer_response_received", response: responsePayload(claim).insurerResponse, workflowRevision: revision() });
      });
      if (path === "/message-draft" && method === "GET") return ok({ messageDraft: claim.messageDraft });
      if (path === "/sending-details" && method === "PUT") {
        if (!active() || body.expectedRevision !== claim.sendingDetails!.revision || body.expectedWorkflowRevision !== revision()) return conflict("The sending details changed. Refresh and try again.");
        if (typeof body.adjusterEmail !== "string" || !EMAIL_PATTERN.test(body.adjusterEmail) || (body.claimReference !== null && (typeof body.claimReference !== "string" || !body.claimReference.trim() || !body.claimReferenceConfirmed)) || !body.adjusterEmailConfirmed) return conflict("Check the adjuster’s email and any claim number you entered.");
        claim.sendingDetails = { ...claim.sendingDetails!, adjusterEmail: body.adjusterEmail, claimReference: body.claimReference as string | null,
          adjusterEmailConfirmed: true, claimReferenceConfirmed: body.claimReferenceConfirmed === true, revision: claim.sendingDetails!.revision + 1 };
        bump(); persist();
        return ok({ sendingDetails: claim.sendingDetails, workflowRevision: revision() });
      }
      if (path === "/message-draft" && method === "PATCH") {
        const draft = claim.messageDraft;
        if (!active() || !draft || body.expectedRevision !== draft.revision) return conflict("This draft changed. Load the saved draft.");
        if (typeof body.recipient !== "string" || typeof body.subject !== "string" || typeof body.body !== "string") return conflict("Check the message fields.");
        const content = { recipient: body.recipient, subject: body.subject, body: body.body };
        if (validationError(content)) return conflict("Check the message fields.");
        claim.messageDraft = { ...draft, ...content, revision: draft.revision + 1, updatedAt: now() };
        persist(); return ok(claim.messageDraft);
      }
      if (path === "/message/prepare" && method === "POST") return record(path, body, () => {
        if (!active() || body.expectedWorkflowRevision !== revision() || !claim.sendingDetails?.adjusterEmailConfirmed || (claim.sendingDetails.claimReference && !claim.sendingDetails.claimReferenceConfirmed)) return conflict("Check your sending details and refresh the preview.");
        claim.messageDraft ??= newDraft(claim);
        const draft = claim.messageDraft;
        const message: TotalLossPreparedMessageVersion = {
          body: draft.body, recipient: draft.recipient!, subject: draft.subject, reportVersionId: REPORT_ID,
          messageVersionId: crypto.randomUUID(), versionNumber: state.prepared.length + 1, state: "prepared", createdAt: now(),
        };
        state.prepared.push(message); bump();
        return ok({ draft, messageVersion: message, workflowRevision: revision() });
      });
      if (path === "/message/opened" && method === "POST") return record(path, body, () => state.prepared.some(item => item.messageVersionId === body.messageVersionId) ? ok({ recorded: true }) : conflict("Prepare the message first."));
      if (path === "/message/sent" && method === "POST") return record(path, body, () => {
        const message = state.prepared.find(item => item.messageVersionId === body.messageVersionId);
        const draft = claim.messageDraft;
        if (!active() || body.expectedWorkflowRevision !== revision() || body.confirmedReportAttached !== true || !message || !draft || message.body !== draft.body || message.subject !== draft.subject || message.recipient !== draft.recipient) return conflict("Review the current message and confirm the attachment first.");
        const sentAt = now();
        const roundId = crypto.randomUUID();
        const communicationId = crypto.randomUUID();
        claim.education = { ...claim.education!, steps: { ...claim.education!.steps, send: { completedAt: sentAt, viewedAt: sentAt, skippedAt: null } } };
        claim.journey = { nextState: "awaiting_insurer_response", fulfillmentState: "awaiting_insurer_response", retryable: false };
        claim.workflow = { phase: "negotiation", currentTask: "awaiting_insurer_response", revision: revision() + 1 };
        claim.commerce = { ...claim.commerce!, nextTask: "awaiting_insurer_response" };
        claim.responseIntake = { negotiationRoundId: roundId, outboundCommunicationId: communicationId };
        claim.negotiationHistory = [{ negotiationRoundId: roundId, roundNumber: 1, responses: [], followUp: null, supersededFollowUpDrafts: [],
          outbound: { ...message, state: "sent", customerReportedSentAt: sentAt, communicationId, negotiationRoundId: roundId } }];
        return ok({ state: "awaiting_insurer_response", customerReportedSentAt: sentAt, messageVersionId: message.messageVersionId, communicationId, negotiationRoundId: roundId, workflowRevision: revision() } satisfies TotalLossSentMessage);
      });
      if (path === `/reports/${REPORT_ID}/download` && method === "GET") return ok({
        downloadUrl: new URL("/fixtures/message-preview-report.pdf", location.origin).href,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), suggestedFilename: "Sample_Valuation_Report.pdf",
      });
      return undefined;
    },
  };
}
export const messageCasePath = `/api/v1/appraisal-cases/${CASE_ID}`;
