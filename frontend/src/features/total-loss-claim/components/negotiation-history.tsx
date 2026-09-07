import { ArrowUpRight, Check, ChevronDown, FileText, History, LockKeyhole, Mail, MessageSquare, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { useCompletedReviewActionsHost } from "@/components/completed-review-progress-host";
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
  return <details className="case-history-message case-history-event" data-kind="sent">
    <summary>
      <span className="case-history-marker" aria-hidden="true"><Mail /></span>
      <span className="case-history-entry-heading"><span className="case-history-entry-title">{label}</span><span className="case-history-badge" aria-hidden="true"><Check />Sent</span></span>
      <span className="case-history-entry-meta">Sent <RecordedTime value={message.customerReportedSentAt} /> · Version {message.versionNumber}</span>
      <span className="case-history-subject">{message.subject}</span>
      <span className="case-history-disclosure"><span className="case-history-show">View message</span><span className="case-history-hide">Hide message</span><ChevronDown aria-hidden="true" /></span>
    </summary>
    <div className="case-history-message-content">
    <p className="case-history-confirmation">You confirmed sending this message.</p>
    <dl className="sent-request-details case-history-draft-details">
      <div><dt>To</dt><dd>{message.recipient}</dd></div>
      <div><dt>Subject</dt><dd>{message.subject}</dd></div>
    </dl>
    <p className="sent-request-body case-history-draft-body">{message.body}</p>
    </div>
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
  return <details className="case-history-message case-history-superseded-draft case-history-event" data-kind="draft">
    <summary>
      <span className="case-history-marker" aria-hidden="true"><FileText /></span>
      <span className="case-history-entry-title">Earlier follow-up draft — kept for reference</span>
      <span className="case-history-entry-meta">Read-only · Saved <RecordedTime value={draft.updatedAt} /></span>
      <span className="case-history-disclosure"><span className="case-history-show">View earlier draft</span><span className="case-history-hide">Hide earlier draft</span><ChevronDown aria-hidden="true" /></span>
    </summary>
    <div className="case-history-message-content">
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
    </div>
  </details>;
}

interface NegotiationHistoryProps {
  readonly caseId: string;
  readonly history: readonly TotalLossNegotiationHistoryRound[];
  readonly userId: string;
  readonly vehicleDescription?: string;
  readonly onNavigate?: () => void;
}

export function NegotiationHistoryDialog(props: NegotiationHistoryProps) {
  const host = useCompletedReviewActionsHost();
  const [open, setOpen] = useState(false);
  if (!props.history.length) return null;
  const messageCount = new Set(props.history.flatMap((round) => [round.outbound.communicationId, ...(round.followUp ? [round.followUp.communicationId] : [])])).size;
  const responseCount = props.history.reduce((count, round) => count + round.responses.length, 0);
  const trigger = <Dialog.Trigger asChild>
    <button className="case-history-trigger" type="button"><History aria-hidden="true" />Case history</button>
  </Dialog.Trigger>;
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    {host ? createPortal(trigger, host) : trigger}
    <Dialog.Portal>
      <Dialog.Overlay className="case-history-overlay" />
      <Dialog.Content className="case-history-dialog">
        <div className="case-history-dialog-header">
          <div>
            <span className="case-history-eyebrow">Your case record</span>
            <Dialog.Title>Case history</Dialog.Title>
            {props.vehicleDescription ? <p className="case-history-vehicle">{props.vehicleDescription}</p> : null}
            <Dialog.Description>Your saved requests, responses, reviews, and decisions.</Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button className="case-history-close" type="button" aria-label="Close case history"><X aria-hidden="true" /></button>
          </Dialog.Close>
        </div>
        <div className="case-history-dialog-body">
          <div className="case-history-timeline-heading"><span>Activity timeline</span><p>{messageCount} {messageCount === 1 ? "message" : "messages"}<span aria-hidden="true"> · </span>{responseCount} {responseCount === 1 ? "response" : "responses"}</p></div>
          <NegotiationHistory {...props} onNavigate={() => setOpen(false)} />
        </div>
        <div className="case-history-dialog-footer"><LockKeyhole aria-hidden="true" /><p>Saved for your reference. Sent records are based on your confirmation.</p></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function NegotiationHistory({ caseId, history, userId, onNavigate }: NegotiationHistoryProps) {
  if (!history.length) return null;
  const sentIds = new Set<string>();
  return <div className="case-history">
    <ol>
      {history.map((round) => {
        const showOutbound = !sentIds.has(round.outbound.communicationId);
        sentIds.add(round.outbound.communicationId);
        if (round.followUp) sentIds.add(round.followUp.communicationId);
        return <li className="case-history-round" key={round.negotiationRoundId}>
          {history.length > 1 ? <div className="case-history-round-label">Exchange {String(round.roundNumber).padStart(2, "0")}</div> : null}
          {showOutbound ? <SentHistoryMessage message={round.outbound} label={round.roundNumber === 1 ? "Initial request" : "Follow-up"} /> : null}
          {round.responses.map((response) => <Fragment key={response.responseId}>
            <article className="case-history-response case-history-event" data-kind="response">
              <span className="case-history-marker" aria-hidden="true"><MessageSquare /></span>
              <h3>{response.supersedesResponseId ? "Corrected insurer response" : "Insurer response"}</h3>
              <p className="case-history-entry-meta">Recorded <RecordedTime value={response.receivedAt} /></p>
              {response.text ? <blockquote className="case-history-response-preview">{response.text}</blockquote> : null}
              {response.document ? <p className="case-history-attachment"><FileText aria-hidden="true" />{response.document.originalFilename}</p> : null}
              <div className="case-history-links">
                <Link onClick={onNavigate} to={`${totalLossClaimViewPath(caseId, "review_response_received")}?view=saved&response=${encodeURIComponent(response.responseId)}`}>View response<ArrowUpRight aria-hidden="true" /></Link>
                {response.analysis && response.analysisEvidence ? <Link onClick={onNavigate} to={`${totalLossClaimViewPath(caseId, "review_response_reviewed")}?response=${encodeURIComponent(response.responseId)}`}>Venfour review{response.decision ? " and decision" : ""}<ArrowUpRight aria-hidden="true" /></Link> : <span className="case-history-review-status">{response.processingState === "pending" || response.processingState === "processing" ? "Review in progress" : "Review unavailable"}</span>}
              </div>
              {response.decision ? <div className="case-history-decision"><Check aria-hidden="true" /><div><p><span>Your decision</span>{response.decision.choice === "ACCEPT_OFFER" ? "Accept offer" : "Continue challenging"}</p><RecordedTime value={response.decision.recordedAt} /></div></div> : null}
            </article>
            {round.supersededFollowUpDrafts
              .filter((draft) => draft.sourceResponseId === response.responseId)
              .map((draft) => <SupersededDraftHistory caseId={caseId} draftRecord={draft} key={draft.draft.draftId} userId={userId} />)}
          </Fragment>)}
          {round.followUp ? <SentHistoryMessage message={round.followUp} label="Follow-up" /> : null}
        </li>;
      })}
    </ol>
  </div>;
}
