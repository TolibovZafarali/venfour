import type {
  TotalLossClaimSecured, TotalLossInsurerResponse, TotalLossInsurerResponseAnalysis,
  TotalLossInsurerResponseAnalysisEvidence, TotalLossResponseDecisionInput,
  TotalLossCaseResolutionInput, TotalLossClaimJourneyState, TotalLossClaimFulfillmentState, TotalLossClaimPhase,
} from '@/features/total-loss-claim/contracts';

type PreviewClaim = { -readonly [K in keyof TotalLossClaimSecured]: TotalLossClaimSecured[K] };
type Reply = { status: number; data: unknown };
type Payload = Record<string, unknown>;
const TEXT_REF = `response_${'a'.repeat(64)}`;
const OFFER_REF = `response_${'c'.repeat(64)}`;
const CASE_REF = `case_${'b'.repeat(64)}`;
const limitation = 'Simulated review for local testing. This is not a provider analysis or a real recommendation.';
const id = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const ok = (data: unknown): Reply => ({ status: 200, data });
const conflict = (message: string): Reply => ({ status: 409, data: { error: { code: 'CONFLICT', message } } });

export function replacePreviewResponse(claim: PreviewClaim, response: TotalLossInsurerResponse) {
  claim.insurerResponse = response;
  claim.negotiationHistory = claim.negotiationHistory?.map(round => ({
    ...round, responses: round.responses.map(saved => saved.responseId === response.responseId ? response : saved),
  }));
}

function reviewedResponse(claim: PreviewClaim, response: TotalLossInsurerResponse): TotalLossInsurerResponse {
  const offer = response.revisedOffer;
  const amountLabel = offer ? new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency }).format(offer.amountMinorUnits / 100) : null;
  const responseEvidenceRefs = [...(response.text ? [TEXT_REF] : []), ...(offer ? [OFFER_REF] : [])];
  const refs = { responseEvidenceRefs, caseEvidenceRefs: [CASE_REF] };
  const summary = amountLabel ? `You recorded a revised offer of ${amountLabel}.` : 'The written response is saved with the original request.';
  const meaning = 'Review the saved response and decide whether to accept the recorded offer or ask the insurer for further explanation.';
  const analysis: TotalLossInsurerResponseAnalysis = {
    schemaVersion: '1',
    analysisSummary: { whatInsurerSaid: summary, whatThisMeans: meaning, ...refs },
    insurerPosition: { category: offer ? 'REVISED_OFFER' : 'UNCLEAR', summary, responseEvidenceRefs },
    revisedOffer: { status: offer ? 'PRESENT' : 'ABSENT', amountMinorUnits: offer?.amountMinorUnits ?? null,
      currency: offer?.currency ?? null, source: offer ? 'CUSTOMER_SUPPLIED' : null,
      responseEvidenceRefs: offer ? [OFFER_REF] : [], visualSourceInterpretation: null },
    requestDisposition: { category: 'UNCLEAR', summary: 'Your request and the insurer response remain available for comparison.', ...refs },
    responsePoints: [{ topic: 'Your saved response', disposition: 'UNRESOLVED', whatInsurerSaid: summary, whatThisMeans: meaning, confidence: 'LOW', ...refs }],
    insurerArguments: [], importantChanges: offer ? [{ description: summary, ...refs }] : [],
    unresolvedIssues: [{ description: 'A follow-up can ask the insurer to explain how it considered the valuation evidence.', ...refs }],
    recommendedNextStep: { category: 'REVIEW_RESPONSE', explanation: meaning, ...refs },
    confidence: 'LOW', uncertainties: [{ description: limitation, ...refs }],
    inputCoverage: { pastedText: response.text ? 'AVAILABLE' : 'NOT_PROVIDED', document: 'NOT_PROVIDED', limitations: [limitation] },
    untrustedInstructionDetected: false, untrustedInstructionFollowed: false,
  };
  const analysisEvidence: TotalLossInsurerResponseAnalysisEvidence = {
    responseEvidence: [
      ...(response.text ? [{ evidenceRef: TEXT_REF, sourceType: 'PASTED_TEXT' as const, content: response.text, pageNumber: null }] : []),
      ...(offer ? [{ evidenceRef: OFFER_REF, sourceType: 'CUSTOMER_SUPPLIED_OFFER' as const, content: null, pageNumber: null }] : []),
    ],
    caseEvidence: [{ evidenceRef: CASE_REF, evidenceType: 'CUSTOMER_REQUEST',
      summary: claim.negotiationHistory?.find(round => round.negotiationRoundId === response.negotiationRoundId)?.outbound.body ?? 'Review the saved valuation evidence.',
      amountMinorUnits: null, currency: null }],
  };
  return {
    ...response, processingState: 'completed', failureReason: null, analysis, analysisEvidence,
    recommendation: { recommendationId: id(), analysisResultId: id(), versionNumber: 1, schemaVersion: '1', policyVersion: '2',
      state: 'CONTINUE_CHALLENGING', summary: 'You can request a written explanation of how the insurer considered your evidence.',
      reasons: ['Review the saved response and the original valuation evidence before choosing your next step.'],
      reasonCodes: ['SYNTHETIC_CONTINUATION'], limitations: [limitation], ...refs },
    usableOffer: offer ? { ...offer, offerId: id(), source: 'CUSTOMER_RECORDED' } : null,
    decision: null,
  };
}

export function createSyntheticResponseFlow(claim: PreviewClaim, persist: () => void, storage: Storage, key: string) {
  const receipts: Record<string, { signature: string; reply: Reply }> = JSON.parse(storage.getItem(key) ?? '{}');
  const transition = (nextState: Extract<TotalLossClaimJourneyState, TotalLossClaimFulfillmentState>, phase: TotalLossClaimPhase = 'negotiation') => {
    claim.journey = { nextState, fulfillmentState: nextState, retryable: false };
    claim.workflow = { ...claim.workflow, currentTask: nextState, phase, revision: (claim.workflow?.revision ?? 0) + 1 };
  };
  const save = (reply: Reply) => { persist(); return reply; };
  const record = (path: string, body: Payload, run: () => Reply) => {
    const request = typeof body.clientRequestId === 'string' ? body.clientRequestId : null;
    const signature = JSON.stringify({ path, ...body, workflowRevision: undefined, expectedWorkflowRevision: undefined });
    if (request && receipts[request]) return receipts[request].signature === signature ? receipts[request].reply : conflict('This request was already used for another action.');
    if (claim.resolution) return conflict('This case is already resolved.');
    const reply = run();
    if (request && reply.status === 200) {
      receipts[request] = { signature, reply: structuredClone(reply) };
      storage.setItem(key, JSON.stringify(receipts));
    }
    return save(reply);
  };

  return {
    advanceReview(now = Date.now()) {
      const response = claim.insurerResponse;
      if (claim.resolution || !response || !['pending', 'processing'].includes(response.processingState)) return;
      const age = now - Date.parse(response.receivedAt);
      if (age < 2_000) return;
      if (age < 4_000) {
        if (response.processingState === 'pending') {
          replacePreviewResponse(claim, { ...response, processingState: 'processing' });
          transition('insurer_response_reviewing');
          persist();
        }
        return;
      }
      replacePreviewResponse(claim, reviewedResponse(claim, response));
      transition('insurer_response_reviewed');
      persist();
    },
    handle(path: string, method: string, body: Payload): Reply | undefined {
      if (/^\/claim\/insurer-responses\/[^/]+\/decision$/.test(path) && method === 'POST') {
        return record(path, body, () => {
          const input = body as unknown as TotalLossResponseDecisionInput;
          const response = claim.insurerResponse;
          if (!response?.recommendation || path.split('/')[3] !== response.responseId || response.canCorrect === false || response.decision ||
            input.recommendationId !== response.recommendation.recommendationId || input.workflowRevision !== claim.workflow?.revision) return conflict('The response changed. Refresh before deciding.');
          if (!['ACCEPT_OFFER', 'CONTINUE_CHALLENGING'].includes(input.choice) ||
            (input.choice === 'ACCEPT_OFFER' ? !response.usableOffer || input.offerId !== response.usableOffer.offerId : input.offerId !== null)) return conflict('Choose an available response action.');
          const offer = input.choice === 'ACCEPT_OFFER' ? response.usableOffer : null;
          const decided = { ...response, decision: { decisionId: id(), clientRequestId: input.clientRequestId,
            recommendationId: input.recommendationId, analysisResultId: response.recommendation.analysisResultId,
            choice: input.choice, offerId: offer?.offerId ?? null, amountMinorUnits: offer?.amountMinorUnits ?? null,
            currency: offer?.currency ?? null, recordedAt: timestamp() } };
          replacePreviewResponse(claim, decided);
          transition(input.choice === 'CONTINUE_CHALLENGING' ? 'follow_up_preparation' : 'insurer_response_reviewed');
          if (input.choice === 'CONTINUE_CHALLENGING') claim.followUp = {
            state: 'available', responseId: response.responseId, decisionId: decided.decision.decisionId,
            analysisResultId: response.recommendation.analysisResultId, reportVersionId: claim.report!.reportId,
            draft: null, preparedMessage: null, sentMessage: null, reasonCode: null,
          };
          return ok({ state: 'insurer_response_reviewed', response: decided, workflowRevision: claim.workflow!.revision });
        });
      }
      if (path === '/follow-up' && method === 'GET') return ok({ followUp: claim.followUp ?? null });
      if (path === '/follow-up' && method === 'POST') return record(path, body, () => {
        const followUp = claim.followUp;
        if (!followUp || followUp.decisionId !== body.decisionId || claim.insurerResponse?.decision?.choice !== 'CONTINUE_CHALLENGING') return conflict('The follow-up is no longer current.');
        if (!followUp.draft) {
          const response = claim.insurerResponse;
          const amount = response.revisedOffer ? new Intl.NumberFormat('en-US', { style: 'currency', currency: response.revisedOffer.currency }).format(response.revisedOffer.amountMinorUnits / 100) : null;
          claim.followUp = { ...followUp, state: 'draft', draft: {
            draftId: id(), purpose: 'follow_up_reconsideration', reportVersionId: followUp.reportVersionId, revision: 1,
            recipient: claim.sendingDetails?.adjusterEmail ?? null, subject: `Follow-up on valuation - Claim ${claim.sendingDetails?.claimReference ?? 'CLM-42'}`,
            body: `Hello,\n\nThank you for your response${amount ? ` and the revised offer of ${amount}` : ''}.\n\nPlease explain how you considered the comparable vehicles and adjustments in the attached valuation evidence for my ${claim.report!.subjectVehicle.description}. Please identify any evidence you disagree with and the reason for each difference.\n\nI understand that advertised prices are not guaranteed settlement amounts. Please provide your explanation and any revised valuation in writing.\n\nThank you,\n${claim.sendingDetails?.customerName ?? 'Case Owner'}`,
            updatedAt: timestamp(),
          } };
          transition('follow_up_preparation');
        }
        return ok({ followUp: claim.followUp });
      });
      if (path === '/follow-up/draft' && method === 'PATCH') return record(path, body, () => {
        const followUp = claim.followUp;
        const draft = followUp?.draft;
        if (!followUp || followUp.state !== 'draft' || !draft || draft.draftId !== body.draftId || draft.revision !== body.expectedRevision) return conflict('The follow-up draft changed.');
        if (typeof body.body !== 'string' || typeof body.subject !== 'string' || typeof body.recipient !== 'string') return conflict('Enter a recipient, subject, and message.');
        claim.followUp = { ...followUp, preparedMessage: null, draft: { ...draft, body: body.body, subject: body.subject, recipient: body.recipient, revision: draft.revision + 1, updatedAt: timestamp() } };
        return ok(claim.followUp.draft);
      });
      if (path === '/follow-up/prepare' && method === 'POST') return record(path, body, () => {
        const followUp = claim.followUp;
        const draft = followUp?.draft;
        if (!followUp || followUp.state !== 'draft' || !draft?.recipient || draft.draftId !== body.draftId || draft.revision !== body.expectedDraftRevision || body.expectedWorkflowRevision !== claim.workflow?.revision) return conflict('The saved follow-up changed.');
        const message = { body: draft.body, subject: draft.subject, recipient: draft.recipient, reportVersionId: draft.reportVersionId,
          messageVersionId: id(), versionNumber: draft.revision, state: 'prepared' as const, createdAt: timestamp() };
        claim.followUp = { ...followUp, preparedMessage: message };
        transition('follow_up_preparation');
        return ok({ draft, messageVersion: message, workflowRevision: claim.workflow!.revision });
      });
      if (path === '/follow-up/opened' && method === 'POST') return ok({ recorded: true });
      if (path === '/follow-up/sent' && method === 'POST') return record(path, body, () => {
        const followUp = claim.followUp;
        const message = followUp?.preparedMessage;
        const response = claim.insurerResponse;
        const round = claim.negotiationHistory?.find(item => item.negotiationRoundId === response?.negotiationRoundId);
        if (!followUp || followUp.state !== 'draft' || !message || !response || !round ||
          message.messageVersionId !== body.messageVersionId || message.versionNumber !== followUp.draft?.revision ||
          body.expectedWorkflowRevision !== claim.workflow?.revision || body.confirmedReportAttached !== true) return conflict('Confirm the current message and attached report before marking it sent.');
        const sent = { ...message, state: 'sent' as const, customerReportedSentAt: timestamp(), communicationId: id(), negotiationRoundId: round.negotiationRoundId };
        const nextRoundId = id();
        replacePreviewResponse(claim, { ...response, canCorrect: false });
        claim.negotiationHistory = [
          ...claim.negotiationHistory!.map(item => item.negotiationRoundId === round.negotiationRoundId ? { ...item, followUp: sent } : item),
          { negotiationRoundId: nextRoundId, roundNumber: Math.max(...claim.negotiationHistory!.map(item => item.roundNumber)) + 1,
            outbound: { ...sent, negotiationRoundId: nextRoundId }, responses: [], followUp: null, supersededFollowUpDrafts: [] },
        ];
        claim.followUp = { ...followUp, state: 'sent', sentMessage: sent };
        claim.responseIntake = { negotiationRoundId: nextRoundId, outboundCommunicationId: sent.communicationId };
        transition('awaiting_insurer_response');
        return ok({ ...sent, state: 'awaiting_insurer_response', workflowRevision: claim.workflow!.revision });
      });
      if (path === '/claim/resolution' && method === 'POST') return record(path, body, () => {
        const input = body as unknown as TotalLossCaseResolutionInput;
        if (input.workflowRevision !== claim.workflow?.revision) return conflict('The case changed. Refresh before confirming.');
        const response = claim.insurerResponse;
        const accepted = input.resolutionCode === 'ACCEPTED_VERIFIED_OFFER';
        if (!['ACCEPTED_VERIFIED_OFFER', 'RESOLVED_WITH_INSURER', 'CUSTOMER_STOPPED_PURSUING'].includes(input.resolutionCode)) return conflict('Choose a supported case outcome.');
        if (accepted && (!response?.usableOffer || response.decision?.choice !== 'ACCEPT_OFFER' || response.decision.decisionId !== input.decisionId || response.usableOffer.offerId !== input.offerId)) return conflict('Confirm the exact offer you chose to accept.');
        if (!accepted && (input.offerId !== null || input.decisionId !== null)) return conflict('This outcome does not accept a saved offer.');
        const amount = accepted ? response!.usableOffer!.amountMinorUnits : input.amountMinorUnits;
        claim.resolution = {
          code: input.resolutionCode, resolvedAt: timestamp(), customerConfirmed: true, clientRequestId: input.clientRequestId,
          amountMinorUnits: amount, currency: accepted ? response!.usableOffer!.currency : input.currency,
          amountSource: accepted ? response!.usableOffer!.source : amount !== null ? 'CUSTOMER_REPORTED' : null,
          offerId: input.offerId, decisionId: input.decisionId,
          recommendationId: accepted ? response!.recommendation!.recommendationId : null,
          responseId: accepted ? response!.responseId : null,
        };
        claim.responseIntake = null;
        transition('resolved', 'resolution');
        return ok({ state: 'resolved', resolution: claim.resolution, workflowRevision: claim.workflow!.revision });
      });
      return undefined;
    },
  };
}
