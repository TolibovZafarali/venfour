import { Fragment } from "react";
import { Link } from "react-router";

import type {
  TotalLossNegotiationHistoryRound,
  TotalLossSentCommunication,
  TotalLossSupersededFollowUpDraft,
} from "../contracts";
import {
  readRequestDraftRecoveryForHistory,
  requestDraftRecoveryKey,
} from "../request-draft-recovery";
import type { DraftContent } from "../request-state";
import { totalLossClaimViewPath } from "../workflow-route";
import { RecordedTime } from "./completed-analysis-visuals";
import "./negotiation-history.css";

function SentHistoryMessage({ message, label }: {
  readonly message: TotalLossSentCommunication;
  readonly label: string;
}) {
  return <details className="case-history-message">
    <summary>{label} <span>Sent <RecordedTime value={message.customerReportedSentAt} /> · Version {message.versionNumber}</span></summary>
    <dl className="sent-request-details">
      <div><dt>To</dt><dd>{message.recipient}</dd></div>
      <div><dt>Subject</dt><dd>{message.subject}</dd></div>
    </dl>
    <p className="sent-request-body">{message.body}</p>
  </details>;
}

function DraftContentRecord({ content, label }: {
  readonly content: Pick<DraftContent, "body" | "subject"> & { readonly recipient: string | null };
  readonly label: string;
}) {
  return <section className="case-history-draft-version" aria-label={label}>
    <h4>{label}</h4>
    <dl className="case-history-draft-details">
      <div><dt>To</dt><dd>{content.recipient || <span className="case-history-empty-value">Blank</span>}</dd></div>
      <div><dt>Subject</dt><dd>{content.subject || <span className="case-history-empty-value">Blank</span>}</dd></div>
    </dl>
    <p className="case-history-draft-body">{content.body || <span className="case-history-empty-value">Blank</span>}</p>
  </section>;
}

function SupersededDraftHistory({ caseId, draftRecord, userId }: {
  readonly caseId: string;
  readonly draftRecord: TotalLossSupersededFollowUpDraft;
  readonly userId: string;
}) {
  const { draft } = draftRecord;
  const recoveryKey = requestDraftRecoveryKey({
    userId,
    caseId,
    draft,
    followUpDraftId: draft.draftId,
  });
  const recovered = readRequestDraftRecoveryForHistory(recoveryKey, draft);
  return <details className="case-history-message case-history-superseded-draft">
    <summary>Earlier follow-up draft — kept for reference <span>Read-only · Saved <RecordedTime value={draft.updatedAt} /></span></summary>
    <p className="case-history-superseded-explanation">The insurer response this draft was based on was corrected. We kept the draft for reference, but it can’t be sent or used as your current follow-up.</p>
    <DraftContentRecord content={draft} label="Last saved draft" />
    {recovered?.status === "storage_unavailable" ? (
      <p className="case-history-recovery-note" role="note">This browser’s draft recovery could not be checked. The last saved draft above is still available.</p>
    ) : recovered ? <>
      <p className="case-history-recovery-note" role="note">{recovered.status === "same_baseline"
        ? "These edits were recovered from this browser and may not have finished saving to Venfour."
        : "This browser retained a different version, but it can’t be safely matched to the last saved draft shown above. It may include edits that did not finish saving."}</p>
      <DraftContentRecord
        content={recovered.content}
        label={recovered.status === "same_baseline"
          ? "Browser-recovered edits — not confirmed saved"
          : "Browser-recovered version — saved status uncertain"}
      />
    </> : null}
  </details>;
}

export function NegotiationHistory({ caseId, history, userId }: {
  readonly caseId: string;
  readonly history: readonly TotalLossNegotiationHistoryRound[];
  readonly userId: string;
}) {
  if (!history.length) return null;
  const sentIds = new Set<string>();
  return <details className="case-history">
    <summary>Case history <span>Your saved requests, responses, reviews, and decisions</span></summary>
    <ol>
      {history.map((round) => {
        const showOutbound = !sentIds.has(round.outbound.communicationId);
        sentIds.add(round.outbound.communicationId);
        if (round.followUp) sentIds.add(round.followUp.communicationId);
        return <li key={round.negotiationRoundId}>
          {showOutbound ? <SentHistoryMessage message={round.outbound} label={round.roundNumber === 1 ? "Initial request" : "Follow-up"} /> : null}
          {round.responses.map((response) => <Fragment key={response.responseId}>
            <article className="case-history-response">
              <h3>{response.supersedesResponseId ? "Corrected insurer response" : "Insurer response"}</h3>
              <p>Recorded <RecordedTime value={response.receivedAt} /></p>
              <div className="case-history-links">
                <Link to={`${totalLossClaimViewPath(caseId, "review_response_received")}?view=saved&response=${encodeURIComponent(response.responseId)}`}>View response</Link>
                {response.analysis && response.analysisEvidence ? <Link to={`${totalLossClaimViewPath(caseId, "review_response_reviewed")}?response=${encodeURIComponent(response.responseId)}`}>Venfour review{response.decision ? " and decision" : ""}</Link> : <span>{response.processingState === "pending" || response.processingState === "processing" ? "Review in progress" : "Review unavailable"}</span>}
              </div>
              {response.decision ? <p className="case-history-decision">Your decision: {response.decision.choice === "ACCEPT_OFFER" ? "Accept offer" : "Continue challenging"} · <RecordedTime value={response.decision.recordedAt} /></p> : null}
            </article>
            {round.supersededFollowUpDrafts
              .filter((draft) => draft.sourceResponseId === response.responseId)
              .map((draft) => <SupersededDraftHistory caseId={caseId} draftRecord={draft} key={draft.draft.draftId} userId={userId} />)}
          </Fragment>)}
          {round.followUp ? <SentHistoryMessage message={round.followUp} label="Follow-up" /> : null}
        </li>;
      })}
    </ol>
  </details>;
}
