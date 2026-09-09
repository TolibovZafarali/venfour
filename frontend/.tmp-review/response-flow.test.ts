import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTotalLossClaim, recordTotalLossInsurerResponseDecision, generateTotalLossFollowUp,
  updateTotalLossMessageDraft, prepareTotalLossMessage, confirmTotalLossMessageSent, resolveTotalLossCase,
} from '@/features/total-loss-claim/api';
import type { TotalLossClaimSecured, TotalLossInsurerResponse, TotalLossCaseResolutionInput } from '@/features/total-loss-claim/contracts';
import { claimProjection, CASE_ID, NOW } from './fixtures';
import { createSyntheticResponseFlow } from './response-flow';

const uuid = () => crypto.randomUUID();
type Claim = { -readonly [K in keyof TotalLossClaimSecured]: TotalLossClaimSecured[K] };
function fixture(): Claim {
  const base = claimProjection(['result', 'insurer_review', 'valuation', 'report', 'what_next', 'send']);
  const roundId = uuid();
  const outboundId = uuid();
  const response: TotalLossInsurerResponse = {
    responseId: uuid(), clientRequestId: uuid(), receivedAt: new Date().toISOString(), sourceType: 'pasted_message',
    text: 'We revised your offer to $20,150.', revisedOffer: { amountMinorUnits: 2015000, currency: 'USD' },
    negotiationRoundId: roundId, outboundCommunicationId: outboundId, canCorrect: true,
    processingState: 'pending', failureReason: null, supersedesResponseId: null,
    document: null, analysis: null, analysisEvidence: null, recommendation: null, usableOffer: null, decision: null,
  };
  return { ...base, insurerResponse: response, responseIntake: null,
    journey: { fulfillmentState: 'insurer_response_received', nextState: 'insurer_response_received', retryable: false },
    workflow: { phase: 'negotiation', currentTask: 'insurer_response_received', revision: 8 },
    sendingDetails: { adjusterEmail: 'adjuster@example.com', adjusterEmailConfirmed: true, adjusterName: null,
      claimReference: 'CLM-42', claimReferenceConfirmed: true, customerName: 'Case Owner', insurerName: 'Example Insurance', revision: 1, vehicleDescription: '2022 Toyota Camry SE' },
    negotiationHistory: [{ negotiationRoundId: roundId, roundNumber: 1, outbound: {
      body: 'Please review the valuation evidence.', subject: 'Claim CLM-42', recipient: 'adjuster@example.com',
      reportVersionId: base.report!.reportId, messageVersionId: uuid(), versionNumber: 1, state: 'sent',
      createdAt: NOW, customerReportedSentAt: NOW, communicationId: outboundId, negotiationRoundId: roundId,
    }, responses: [response], followUp: null, supersededFollowUpDrafts: [] }],
  };
}

function publicValue(value: unknown) {
  return JSON.parse(JSON.stringify(value, (key, value) =>
    (key === 'analysis' || key === 'analysisEvidence') && value === null ? undefined : value));
}
function install(claim = fixture()) {
  const persist = () => localStorage.setItem('claim', JSON.stringify(claim));
  const flow = createSyntheticResponseFlow(claim, persist, localStorage, 'operations');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(`/api/v1/appraisal-cases/${CASE_ID}`, '');
    const result = path === '/claim' && (!init?.method || init.method === 'GET')
      ? { status: 200, data: claim }
      : flow.handle(path, init?.method ?? 'GET', init?.body ? JSON.parse(String(init.body)) : {});
    if (!result) throw new Error(`Unmocked operation: ${path}`);
    return new Response(JSON.stringify(publicValue(result.data)), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  });
  const validate = () => getTotalLossClaim(CASE_ID, 'synthetic-token');
  return { claim, flow, validate };
}

describe('synthetic response continuation', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('completes an already saved response without replacing text, offer, or history', async () => {
    const { claim, flow, validate } = install();
    const original = structuredClone(claim.insurerResponse!);
    flow.advanceReview(Date.parse(original.receivedAt) + 2500);
    expect((await validate()).insurerResponse?.processingState).toBe('processing');
    flow.advanceReview(Date.parse(original.receivedAt) + 4500);
    const reviewed = await validate();
    expect(reviewed.insurerResponse).toMatchObject({ responseId: original.responseId, text: original.text, revisedOffer: original.revisedOffer,
      processingState: 'completed', usableOffer: { amountMinorUnits: 2015000, source: 'CUSTOMER_RECORDED' } });
    expect(reviewed.negotiationHistory?.[0]?.responses[0]).toEqual(reviewed.insurerResponse);
    const identity = claim.insurerResponse!.recommendation!.recommendationId;
    flow.advanceReview(Date.now() + 10000);
    expect(claim.insurerResponse!.recommendation!.recommendationId).toBe(identity);
    expect(JSON.parse(localStorage.getItem('claim')!).insurerResponse.text).toBe(original.text);
  });

  it('keeps a text-only response usable without inventing an offer', async () => {
    const claim = fixture();
    claim.insurerResponse = { ...claim.insurerResponse!, revisedOffer: null };
    const { flow, validate } = install(claim);
    flow.advanceReview(Date.now() + 5000);
    const response = (await validate()).insurerResponse!;
    expect(response.analysis?.revisedOffer.status).toBe('ABSENT');
    expect(response.usableOffer).toBeNull();
    expect(response.recommendation?.state).toBe('CONTINUE_CHALLENGING');
  });

  it('accepts the recorded offer but closes only after explicit confirmation, with replay after reload', async () => {
    const { claim, flow, validate } = install();
    flow.advanceReview(Date.now() + 5000);
    const response = claim.insurerResponse!;
    const decisionInput = { clientRequestId: uuid(), recommendationId: response.recommendation!.recommendationId,
      choice: 'ACCEPT_OFFER' as const, offerId: response.usableOffer!.offerId, workflowRevision: claim.workflow!.revision };
    const decided = await recordTotalLossInsurerResponseDecision(CASE_ID, response.responseId, 'synthetic-token', decisionInput);
    expect((await validate()).resolution).toBeUndefined();
    const input: TotalLossCaseResolutionInput = { clientRequestId: uuid(), workflowRevision: claim.workflow!.revision,
      resolutionCode: 'ACCEPTED_VERIFIED_OFFER', decisionId: decided.response.decision!.decisionId,
      offerId: decided.response.usableOffer!.offerId, amountMinorUnits: null, currency: null };
    const closed = await resolveTotalLossCase(CASE_ID, 'synthetic-token', input);
    expect((await validate()).resolution).toMatchObject({ amountMinorUnits: 2015000, amountSource: 'CUSTOMER_RECORDED', code: 'ACCEPTED_VERIFIED_OFFER' });
    const restored = JSON.parse(localStorage.getItem('claim')!) as Claim;
    const resumed = createSyntheticResponseFlow(restored, () => {}, localStorage, 'operations');
    expect(resumed.handle('/claim/resolution', 'POST', { ...input })?.data).toEqual(closed);
    expect(resumed.handle('/claim/resolution', 'POST', { ...input, clientRequestId: uuid() })?.status).toBe(409);
  });

  it('preserves an edited follow-up and the previous round when sending and receiving another response', async () => {
    const { claim, flow, validate } = install();
    flow.advanceReview(Date.now() + 5000);
    const response = claim.insurerResponse!;
    const input = { clientRequestId: uuid(), recommendationId: response.recommendation!.recommendationId,
      choice: 'CONTINUE_CHALLENGING' as const, offerId: null, workflowRevision: claim.workflow!.revision };
    const decided = await recordTotalLossInsurerResponseDecision(CASE_ID, response.responseId, 'synthetic-token', input);
    const followUp = await generateTotalLossFollowUp(CASE_ID, 'synthetic-token', decided.response.decision!.decisionId);
    const draft = await updateTotalLossMessageDraft(CASE_ID, 'synthetic-token', { body: 'My exact edited follow-up.',
      subject: 'Please explain the adjustments', recipient: 'adjuster@example.com', expectedRevision: followUp.draft!.revision }, undefined, followUp.draft!.draftId);
    const prepared = await prepareTotalLossMessage(CASE_ID, 'synthetic-token', uuid(), claim.workflow!.revision, undefined, { draftId: draft.draftId, expectedDraftRevision: draft.revision });
    const sentRequest = { clientRequestId: uuid(), expectedWorkflowRevision: claim.workflow!.revision, messageVersionId: prepared.messageVersion.messageVersionId };
    await confirmTotalLossMessageSent(CASE_ID, 'synthetic-token', sentRequest, undefined, draft.draftId);
    await confirmTotalLossMessageSent(CASE_ID, 'synthetic-token', sentRequest, undefined, draft.draftId);
    const waiting = await validate();
    expect(waiting.negotiationHistory).toHaveLength(2);
    expect(waiting.negotiationHistory?.[0]?.followUp?.body).toBe(draft.body);
    expect(waiting.negotiationHistory?.[1]?.outbound.body).toBe(draft.body);
    expect(waiting.insurerResponse?.canCorrect).toBe(false);
    expect(waiting.responseIntake?.negotiationRoundId).toBe(waiting.negotiationHistory?.[1]?.negotiationRoundId);
    const next: TotalLossInsurerResponse = { ...response, responseId: uuid(), clientRequestId: uuid(),
      negotiationRoundId: waiting.responseIntake!.negotiationRoundId, outboundCommunicationId: waiting.responseIntake!.outboundCommunicationId,
      canCorrect: true, receivedAt: new Date().toISOString(), text: 'Our revised offer is now $20,500.', revisedOffer: { amountMinorUnits: 2050000, currency: 'USD' },
      processingState: 'pending', analysis: null, analysisEvidence: null, recommendation: null, usableOffer: null, decision: null };
    claim.insurerResponse = next;
    claim.followUp = null;
    claim.responseIntake = null;
    claim.negotiationHistory = claim.negotiationHistory!.map(round => round.negotiationRoundId === next.negotiationRoundId ? { ...round, responses: [next] } : round);
    flow.advanceReview(Date.now() + 5000);
    const second = await validate();
    expect(second.insurerResponse?.usableOffer?.amountMinorUnits).toBe(2050000);
    expect(second.negotiationHistory?.[0]?.responses[0]?.decision?.choice).toBe('CONTINUE_CHALLENGING');
    expect(second.negotiationHistory?.[1]?.responses[0]).toEqual(second.insurerResponse);
  });
});
