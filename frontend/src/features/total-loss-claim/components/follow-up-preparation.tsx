import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { TotalLossFollowUp } from "../contracts";
import { useTotalLossFollowUpGenerationMutation } from "../queries";
import type { RequestPreparationOptions } from "../use-request-preparation";
import { totalLossClaimViewPath } from "../workflow-route";
import { FollowUpHeading, SentFollowUp } from "./follow-up-message";
import { DraftEditor } from "./message-preparation";
import { StableActionLabel } from "./stable-action-label";
import { MessageStepHeading } from "./message-step-heading";

function unavailableExplanation(reasonCode: string | null) {
  switch (reasonCode) {
    case "NO_SUPPORTED_UNRESOLVED_ISSUE":
    case "NO_GROUNDED_CONTINUATION":
    case "NO_SUPPORTED_FOLLOWUP":
      return "The saved review does not identify a remaining issue that Venfour can support in a follow-up. Your decision to continue is saved. Review the response analysis and its limitations before deciding how to contact your insurer.";
    case "SOURCE_LINEAGE_CONFLICT":
    case "STALE_SOURCE":
      return "The saved report, response, or analysis has changed. Refresh your case so Venfour can verify the evidence before preparing a follow-up.";
    case "SOURCE_INFORMATION_UNAVAILABLE":
      return "The saved report, original sent request, response, or review is incomplete. Your decision to continue is saved. Return to the response review to check the available information before retrying.";
    case "SOURCE_EVIDENCE_UNAVAILABLE":
      return "The response analysis cannot be matched to its saved supporting evidence. Your decision to continue is saved. Review the response analysis and refresh your case before retrying.";
    case "RECOMMENDATION_REQUIRES_REFRESH":
      return "The saved recommendation needs to be refreshed before Venfour can safely prepare a follow-up. Your decision to continue and original records are preserved. Return to the response review, refresh your case, and try again.";
    case "RESPONSE_REQUIRES_CLARIFICATION":
      return "The saved response is too unclear to support a focused follow-up. Your decision to continue is saved. Review the original response and analysis, and correct the saved response if information is missing or unreadable.";
    default:
      return "Venfour could not verify all the saved evidence needed to prepare a supported follow-up. Your decision to continue is saved. Refresh your case and retry preparation; your original request and saved response remain available.";
  }
}

export function FollowUpPreparation({ onSent, onSentAttempt, ...props }: RequestPreparationOptions & {
  readonly onSent?: () => void;
  readonly onSentAttempt?: (messageVersionId: string) => void;
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
      onSent?.();
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
      setError("We couldn’t prepare your follow-up. Your decision to continue is saved. Refresh your case and retry; an existing draft will be resumed without replacing your edits.");
    } finally {
      locked.current = false;
    }
  };
  if (followUp?.sentMessage) return <SentFollowUp followUp={followUp} />;
  if (followUp?.state === "draft" && followUp.draft) return <DraftEditor {...props} draft={followUp.draft} followUpDraftId={followUp.draft.draftId} initialPreparedMessage={followUp.preparedMessage} key={followUp.draft.draftId} onSent={onSent} onSentAttempt={(messageVersionId) => { sentConfirmationRequested.current = true; onSentAttempt?.(messageVersionId); }} workflowRevision={claim.workflow?.revision ?? 1} />;

  const createAction = <button className="request-button request-button-primary" disabled={mutation.isPending} type="button" onClick={() => void create()}>
    <StableActionLabel reserve="Create my follow-up">{mutation.isPending ? "Creating follow-up…" : followUp?.state === "unavailable" || error ? "Retry preparation" : "Create my follow-up"}</StableActionLabel>
    {mutation.isPending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
  </button>;
  return <section className="request-prepare" aria-label="Follow-up preparation">
    <FollowUpHeading />
    <div className="message-flow" role="list" aria-label="Follow-up steps">
      <section className="message-flow-step" role="listitem" data-state="active" aria-current="step">
        <MessageStepHeading number={1} title="Create your follow-up" state="active" description="Start with a draft based on your case and the insurer’s reply." />
        <div className="message-flow-content">
          <p className="message-send-instructions">We’ll focus on the remaining points supported by your case evidence. You can edit the message before sending it.</p>
          {followUp?.state === "unavailable" ? <p className="request-error" role="status">{unavailableExplanation(followUp.reasonCode)}</p> : null}
          {error ? <p className="request-error" role="alert">{error}</p> : null}
          <p className="review-note"><Link to={totalLossClaimViewPath(caseId, "review_response_reviewed")}>Revisit your response review</Link></p>
          <div className="message-local-actions">{createAction}</div>
        </div>
      </section>
      <section className="message-flow-step" role="listitem" data-state="upcoming"><MessageStepHeading number={2} title="Review and send your message" state="upcoming" description="Check your draft, attach the report, and open your email app." /></section>
      <section className="message-flow-step" role="listitem" data-state="upcoming"><MessageStepHeading number={3} title="Mark as sent" state="upcoming" description="Confirm once you’ve sent the email with your report." /></section>
    </div>
  </section>;
}
