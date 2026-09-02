import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import type { TotalLossFollowUp } from "../contracts";
import { useTotalLossFollowUpGenerationMutation } from "../queries";
import type { RequestPreparationOptions } from "../use-request-preparation";
import { totalLossClaimViewPath } from "../workflow-route";
import { RecordedTime } from "./completed-analysis-visuals";
import { DraftEditor } from "./message-preparation";
import { ReportFileRow } from "./published-report-actions";
import { StableActionLabel } from "./stable-action-label";

function unavailableExplanation(reasonCode: string | null) {
  switch (reasonCode) {
    case "NO_SUPPORTED_UNRESOLVED_ISSUE":
    case "NO_GROUNDED_CONTINUATION":
    case "NO_SUPPORTED_FOLLOWUP":
      return "The saved review does not identify a remaining issue that Venfour can support in a follow-up. Your Continue decision is saved. Review the response analysis and its limitations before deciding how to contact your insurer.";
    case "SOURCE_LINEAGE_CONFLICT":
    case "STALE_SOURCE":
      return "The saved report, response, or analysis has changed. Refresh your case so Venfour can verify the evidence before preparing a follow-up.";
    case "SOURCE_INFORMATION_UNAVAILABLE":
      return "The saved report, original sent request, response, or validated analysis is incomplete. Your Continue decision is saved. Return to the response review to check the available information before retrying.";
    case "SOURCE_EVIDENCE_UNAVAILABLE":
      return "The response analysis cannot be matched to its saved supporting evidence. Your Continue decision is saved. Review the response analysis and refresh your case before retrying.";
    case "RECOMMENDATION_REQUIRES_REFRESH":
      return "The saved recommendation does not match the current evidence policy. Venfour cannot safely prepare a follow-up from it. Your Continue decision and original records are preserved.";
    case "RESPONSE_REQUIRES_CLARIFICATION":
      return "The saved response is too unclear to support a focused follow-up. Your Continue decision is saved. Review the original response and analysis, and correct the saved response if information is missing or unreadable.";
    default:
      return "Venfour could not verify all the saved evidence needed to prepare a supported follow-up. Your Continue decision is saved. Refresh your case and retry preparation; your original request and saved response remain available.";
  }
}

export function SentFollowUp({ followUp }: { readonly followUp: TotalLossFollowUp }) {
  const message = followUp.sentMessage;
  if (!message) return null;
  return (
    <section className="sent-request" aria-labelledby="sent-follow-up-heading">
      <header className="request-heading" data-review-entrance="primary">
        <h1 id="sent-follow-up-heading">Your sent follow-up</h1>
        <p>The follow-up you confirmed sending in response to the saved insurer reply.</p>
      </header>
      <p className="sent-request-recorded" data-review-entrance="supporting">You confirmed sending this message on <RecordedTime value={message.customerReportedSentAt} />.</p>
      <div className="sent-request-content" data-review-entrance="secondary">
        <dl className="sent-request-details">
          <div><dt>To</dt><dd>{message.recipient}</dd></div>
          <div><dt>Subject</dt><dd>{message.subject}</dd></div>
        </dl>
        <p className="sent-request-body" aria-label="Follow-up message">{message.body}</p>
      </div>
    </section>
  );
}

export function FollowUpPreparation({ actionContainer, onSent, ...props }: RequestPreparationOptions & {
  readonly actionContainer?: HTMLElement | null;
  readonly onSent: () => void;
}) {
  const { claim, caseId, report } = props;
  const mutation = useTotalLossFollowUpGenerationMutation(props);
  const [generated, setGenerated] = useState<TotalLossFollowUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const sentConfirmationRequested = useRef(false);
  const decision = claim.insurerResponse?.decision;
  const incoming = claim.followUp;
  const followUp = incoming?.state === "sent" || incoming?.state === "unavailable" || (incoming?.draft && incoming.draft.revision >= (generated?.draft?.revision ?? 0))
    ? incoming : generated ?? incoming;

  useEffect(() => {
    if (sentConfirmationRequested.current && incoming?.state === "sent") {
      sentConfirmationRequested.current = false;
      onSent();
    }
  }, [incoming?.state, onSent]);

  if (decision?.choice !== "CONTINUE_CHALLENGING") return null;
  const create = async () => {
    if (locked.current) return;
    locked.current = true;
    setError(null);
    try {
      const result = await mutation.mutateAsync(decision.decisionId);
      if ((result.reportVersionId !== report.reportId && result.state !== "unavailable") || result.responseId !== claim.insurerResponse?.responseId || result.analysisResultId !== decision.analysisResultId) {
        throw new Error("The source evidence changed.");
      }
      setGenerated(result);
      await props.onRefresh().catch(() => undefined);
    } catch {
      await props.onRefresh().catch(() => undefined);
      setError("We couldn’t prepare your follow-up. Your Continue decision is saved. Refresh your case and retry; an existing draft will be resumed without replacing your edits.");
    } finally {
      locked.current = false;
    }
  };
  if (followUp?.sentMessage) return <><SentFollowUp followUp={followUp} /><ReportFileRow {...props} /></>;
  if (followUp?.state === "draft" && followUp.draft) return <DraftEditor {...props} actionContainer={actionContainer} draft={followUp.draft} followUpDraftId={followUp.draft.draftId} initialPreparedMessage={followUp.preparedMessage} key={followUp.draft.draftId} onSent={onSent} onSentAttempt={() => { sentConfirmationRequested.current = true; }} workflowRevision={claim.workflow?.revision ?? 1} />;

  const createAction = <button className={actionContainer === undefined ? "request-button request-button-primary" : "review-primary"} disabled={mutation.isPending} type="button" onClick={() => void create()}>
    <StableActionLabel reserve="Prepare my follow-up">{mutation.isPending ? "Preparing follow-up…" : followUp?.state === "unavailable" || error ? "Retry preparation" : "Prepare my follow-up"}</StableActionLabel>
    {mutation.isPending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
  </button>;
  return <section className="request-prepare" aria-label="Follow-up preparation">
    <header className="request-heading" data-review-entrance="primary">
      <h1>Prepare your follow-up</h1>
      <p>You chose to continue challenging. Venfour will prepare an editable response focused on the remaining issues supported by your saved case evidence.</p>
    </header>
    <p className="request-package-intro" data-review-entrance="secondary">Your follow-up uses the saved report, the request being answered, the latest insurer response, and its response analysis. You control the final wording and send it from your email app.</p>
    {followUp?.state === "unavailable" ? <p className="request-error" role="status">{unavailableExplanation(followUp.reasonCode)}</p> : null}
    {error ? <p className="request-error" role="alert">{error}</p> : null}
    <p className="review-note"><Link to={totalLossClaimViewPath(caseId, "review_response_reviewed")}>Review the response analysis and your decision</Link></p>
    <ReportFileRow {...props} />
    {actionContainer ? createPortal(createAction, actionContainer) : actionContainer === undefined ? <div className="request-editor-actions">{createAction}</div> : null}
  </section>;
}
