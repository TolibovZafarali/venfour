import { Check, ChevronDown, Copy, LoaderCircle, Mail, SquarePen } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { ReportFileRow } from "@/features/total-loss-claim/components/published-report-actions";
import type {
  TotalLossMessageDraft,
  TotalLossPreparedMessageVersion,
  TotalLossSendingDetails,
} from "@/features/total-loss-claim/contracts";
import {
  EMAIL_PATTERN,
  requestIsSent,
} from "@/features/total-loss-claim/request-state";
import { useRequestDraft } from "@/features/total-loss-claim/use-request-draft";
import { useRequestPreparation } from "@/features/total-loss-claim/use-request-preparation";
import type { RequestPreparationOptions } from "@/features/total-loss-claim/use-request-preparation";
import { MessageStepHeading } from "./message-step-heading";
import { StableActionLabel } from "./stable-action-label";
import { FollowUpHeading, SentFollowUp } from "./follow-up-message";

interface MessagePreparationProps extends RequestPreparationOptions {
  readonly actionContainer?: HTMLElement | null;
  readonly intakeMode?: TotalLossIntakeMode;
  readonly onDraftStateChange?: (hasDraft: boolean) => void;
  readonly onSent?: () => void;
  readonly onSentAttempt?: (messageVersionId: string) => void;
}

function RequestError({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="request-error" role="alert">{children}</p>
  );
}


function UpcomingMessageStep({ number, title, description }: { readonly number: number; readonly title: string; readonly description: string }) {
  return <section className="message-flow-step" role="listitem" data-state="upcoming"><MessageStepHeading number={number} title={title} state="upcoming" description={description} /></section>;
}

function RequestRecorded(props: RequestPreparationOptions) {
  return (
    <section className="request-recorded" aria-label="Request status">
      <span className="request-recorded-icon" aria-hidden="true">
        <Check />
      </span>
      <h2>Message marked as sent</h2>
      <p role="status">
        You reported sending the message. Venfour cannot verify email delivery
        or receipt.
      </p>
      <p>Keep a copy of the email, the report, and any response from your insurer.</p>
      <ReportFileRow {...props} />
    </section>
  );
}

export function DraftEditor({
  actionContainer,
  draft,
  initialPreparedMessage,
  workflowRevision,
  onSent,
  onSentAttempt,
  followUpDraftId,
  ...props
}: RequestPreparationOptions & {
  readonly actionContainer?: HTMLElement | null;
  readonly draft: TotalLossMessageDraft;
  readonly initialPreparedMessage: TotalLossPreparedMessageVersion | null;
  readonly workflowRevision: number;
  readonly onSent?: () => void;
  readonly onSentAttempt?: (messageVersionId: string) => void;
  readonly followUpDraftId?: string;
}) {
  const editor = useRequestDraft({
    ...props,
    draft,
    initialPreparedMessage,
    workflowRevision,
    onSent,
    followUpDraftId,
  });
  const fieldId = useId();
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const confirmationPanel = useRef<HTMLElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const restoreOpenFocus = useRef(false);
  const [acknowledgedMessage, setAcknowledgedMessage] = useState<TotalLossPreparedMessageVersion | null>(null);
  const hasSharedMessage = Boolean(editor.sharedMessage);
  const reviewComplete = hasSharedMessage;
  const sentAcknowledged = hasSharedMessage && acknowledgedMessage === editor.sharedMessage;
  const shareEmail = (kind: "open" | "copy") => {
    setAcknowledgedMessage(null);
    void editor.shareEmail(kind);
  };
  useLayoutEffect(() => {
    draftHeading.current?.focus({ preventScroll: true });
    draftHeading.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [followUpDraftId]);
  useLayoutEffect(() => {
    if (!hasSharedMessage && restoreOpenFocus.current) {
      restoreOpenFocus.current = false;
      openButton.current?.focus({ preventScroll: true });
    } else if (hasSharedMessage) {
      confirmationHeading.current?.focus({ preventScroll: true });
      confirmationPanel.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    }
  }, [hasSharedMessage]);
  if (editor.sent && followUpDraftId && props.claim.followUp && editor.confirmedMessage) return <SentFollowUp followUp={{ ...props.claim.followUp, sentMessage: editor.confirmedMessage }} />;
  if (editor.sent) return <RequestRecorded {...props} />;

  const primaryAction = editor.sharedMessage ? (
    <button
      key="confirm-sent"
      className={actionContainer === undefined ? "request-button request-button-primary" : "review-primary"}
      aria-describedby={`${fieldId}-sent-confirmation`}
      disabled={!sentAcknowledged || editor.action !== null || editor.conflict}
      onClick={() => {
        if (sentAcknowledged) {
          onSentAttempt?.(editor.sharedMessage!.messageVersionId);
          void editor.confirmSent();
        }
      }}
      type="button"
    >
      <StableActionLabel reserve="Mark as sent">{editor.action === "sent" ? "Recording…" : "Mark as sent"}</StableActionLabel>
      {editor.action === "sent" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}
    </button>
  ) : (
    <button
      key="open-email"
      className={actionContainer === undefined ? "request-button request-button-primary" : "review-primary"}
      disabled={editor.action !== null || editor.conflict}
      onClick={() => shareEmail("open")}
      ref={openButton}
      type="button"
    >
      <StableActionLabel reserve="Preparing email…">{editor.action === "open" ? "Preparing email…" : "Open my email app"}</StableActionLabel>
      {editor.action === "open" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Mail aria-hidden="true" />}
    </button>
  );

  return (
    <section className="request-review" data-message-substep aria-label={followUpDraftId ? "Follow-up draft" : "Request draft"}>
      {followUpDraftId ? <FollowUpHeading /> : <header className="request-heading" data-review-entrance="primary" data-review-order="0">
        <h1>Prepare your message</h1>
        <p>Review the details and message here, then send it from your email app.</p>
      </header>}
      {editor.blocker.state === "blocked" ? (
        <div className="request-save-recovery" role="alertdialog" aria-labelledby={`${fieldId}-leave-heading`} aria-describedby={`${fieldId}-leave-description`}>
          <h2 id={`${fieldId}-leave-heading`}>Leave your unsaved changes?</h2>
          <p id={`${fieldId}-leave-description`}>This browser couldn’t preserve your latest edits. Leaving this page may discard them. Keep editing until your changes are saved, or leave without them.</p>
          <button autoFocus className="request-button request-button-secondary" onClick={() => editor.blocker.state === "blocked" && editor.blocker.reset()} type="button">Keep editing</button>
          <button className="request-button request-button-text" onClick={() => editor.blocker.state === "blocked" && editor.blocker.proceed()} type="button">Leave page</button>
        </div>
      ) : null}
      {editor.dirty && editor.storageError ? (
        <RequestError>This browser couldn’t preserve your latest edits. Keep this page open until your changes are saved.</RequestError>
      ) : editor.dirty ? (
        <p className="request-notice" role="status">{editor.restored ? "Your unfinished edits were restored. " : ""}Your edits are preserved in this tab until they can be saved.</p>
      ) : null}
      <div className="message-flow" role="list" aria-label={followUpDraftId ? "Follow-up steps" : "Message steps"}>
        <section className="message-flow-step" role="listitem" data-state="complete"><MessageStepHeading number={1} title={followUpDraftId ? "Create your follow-up" : "Check your details"} state="complete" description={followUpDraftId ? "Your draft is ready to review." : editor.content.recipient} /></section>
        <section className="message-flow-step" role="listitem" data-state={reviewComplete ? "complete" : "active"} aria-current={!reviewComplete ? "step" : undefined}>
          <MessageStepHeading number={2} title={followUpDraftId ? "Review and send your message" : "Review your message"} state={reviewComplete ? "complete" : "active"} description={reviewComplete ? editor.content.subject : "Make any changes before opening your email app."} headingRef={draftHeading} />
          <div className="message-flow-content" hidden={reviewComplete}>
          <div className="request-composer">
            <div className="request-composer-header">
              <span className="request-composer-title" aria-hidden="true">
                <Mail />Email draft
              </span>
              <p
                className="request-save-status"
                data-state={editor.saving ? "saving" : editor.saveError ? "error" : editor.dirty ? "unsaved" : "saved"}
                role="status"
              >
                <StableActionLabel reserve="Changes not saved">
                  <span className="request-save-icon" aria-hidden="true">
                    {editor.saving ? <LoaderCircle className="request-spinner" /> : !editor.saveError && !editor.dirty ? <Check /> : null}
                  </span>
                  {editor.saving
                    ? "Saving…"
                    : editor.saveError
                      ? "Changes not saved"
                      : editor.dirty
                        ? "Unsaved changes"
                        : "Saved"}
                </StableActionLabel>
              </p>
            </div>
            {editor.dirty && editor.invalid ? (
              <p className="request-validation-note">
                Invalid changes won’t be saved until corrected. Your last saved draft
                is unchanged.
              </p>
            ) : null}
            <fieldset className="request-composer-fields" disabled={editor.action !== null || editor.conflict}>
              <legend className="sr-only">Email draft</legend>
              <div className="request-composer-row">
                <label htmlFor={`${fieldId}-recipient`}>Recipient</label>
                <input
                  aria-describedby={
                    editor.fieldErrors.recipient
                      ? `${fieldId}-recipient-error`
                      : undefined
                  }
                  aria-invalid={Boolean(editor.fieldErrors.recipient) || undefined}
                  autoComplete="email"
                  id={`${fieldId}-recipient`}
                  maxLength={320}
                  onChange={(event) => editor.edit("recipient", event.target.value)}
                  required
                  type="email"
                  value={editor.content.recipient}
                />
                {editor.fieldErrors.recipient ? (
                  <p className="request-field-error" id={`${fieldId}-recipient-error`}>{editor.fieldErrors.recipient}</p>
                ) : null}
              </div>
              <div className="request-composer-row">
                <label htmlFor={`${fieldId}-subject`}>Subject</label>
                <input
                  aria-describedby={
                    editor.fieldErrors.subject
                      ? `${fieldId}-subject-error`
                      : undefined
                  }
                  aria-invalid={Boolean(editor.fieldErrors.subject) || undefined}
                  id={`${fieldId}-subject`}
                  maxLength={998}
                  onChange={(event) => editor.edit("subject", event.target.value)}
                  required
                  value={editor.content.subject}
                />
                {editor.fieldErrors.subject ? (
                  <p className="request-field-error" id={`${fieldId}-subject-error`}>{editor.fieldErrors.subject}</p>
                ) : null}
              </div>
              <div className="request-composer-message">
                <label className="sr-only" htmlFor={`${fieldId}-message`}>Message</label>
                <div className="request-composer-message-input">
                  <div className="request-composer-message-size" aria-hidden="true">
                    {editor.content.body}{" "}
                  </div>
                  <textarea
                    aria-describedby={
                      editor.fieldErrors.body ? `${fieldId}-message-error` : undefined
                    }
                    aria-invalid={Boolean(editor.fieldErrors.body) || undefined}
                    id={`${fieldId}-message`}
                    maxLength={50000}
                    onChange={(event) => editor.edit("body", event.target.value)}
                    required
                    rows={1}
                    value={editor.content.body}
                  />
                </div>
                {editor.fieldErrors.body ? (
                  <p className="request-field-error" id={`${fieldId}-message-error`}>{editor.fieldErrors.body}</p>
                ) : null}
              </div>
            </fieldset>
            {!followUpDraftId ? <div className="request-composer-actions">
              <button
                className="request-button request-button-text"
                disabled={editor.action !== null || editor.conflict}
                onClick={() => shareEmail("copy")}
                type="button"
              >
                {editor.action === "copy" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Copy aria-hidden="true" />}
                <StableActionLabel reserve="Copy email">{editor.action === "copy" ? "Copying…" : "Copy email"}</StableActionLabel>
              </button>
            </div> : null}
          </div>
          {editor.saveError ? (
            <div className="request-save-recovery">
              <RequestError>{editor.saveError}</RequestError>
              <button
                className="request-button request-button-secondary"
                disabled={editor.saving || editor.action !== null}
                onClick={() => void editor.retrySave(editor.conflict)}
                type="button"
              >
                <StableActionLabel reserve="Load saved draft">{editor.conflict ? "Load saved draft" : "Retry save"}</StableActionLabel>
              </button>
            </div>
          ) : null}
          {!hasSharedMessage && editor.notice ? <p className="request-notice" role="status">{editor.notice}</p> : null}
          {!hasSharedMessage && editor.error ? <RequestError>{editor.error}</RequestError> : null}
        <aside className="request-evidence-panel" data-review-entrance="secondary" data-review-order="3" aria-labelledby={`${fieldId}-evidence`}>
          <h2 id={`${fieldId}-evidence`}>Your report to attach</h2>
          <ReportFileRow {...props} variant="attachment" />
          <p className="request-attachment-note">Download this report and attach it when you send your email.</p>
          {actionContainer === undefined && !editor.sharedMessage ? <div className="message-local-actions">
            {followUpDraftId ? <button className="request-button request-button-text" type="button" disabled={editor.action !== null || editor.conflict} onClick={() => shareEmail("copy")}><Copy aria-hidden="true" />{editor.action === "copy" ? "Copying…" : "Copy message"}</button> : null}
            {primaryAction}
          </div> : null}
        </aside>
          </div>
        </section>
        {editor.sharedMessage ? (
          <section className="message-flow-step request-sent-confirmation" role="listitem" data-state="active" aria-current="step" aria-labelledby={`${fieldId}-sent-confirmation`} ref={confirmationPanel}>
            <MessageStepHeading number={3} title={followUpDraftId ? "Mark as sent" : "Sent the email with the report attached?"} state="active" headingRef={confirmationHeading} id={`${fieldId}-sent-confirmation`} />
            <div className="message-flow-content">
            <p className="message-send-instructions">Attach your report and send the email from your email app. Then confirm below so we can track your next step.</p>
            {editor.notice ? <p className="request-notice" role="status">{editor.notice}</p> : null}
            {!followUpDraftId ? <ReportFileRow {...props} variant="attachment" /> : null}
            <dl className="request-confirmation-details">
              <dt>To</dt>
              <dd>{editor.sharedMessage.recipient}</dd>
              <dt>Subject</dt>
              <dd>{editor.sharedMessage.subject}</dd>
            </dl>
            <label className="request-sent-acknowledgment">
              <input
                checked={sentAcknowledged}
                disabled={editor.action !== null || editor.conflict}
                onChange={(event) => setAcknowledgedMessage(event.target.checked ? editor.sharedMessage : null)}
                type="checkbox"
              />
              <span>I sent the email with the report attached.</span>
            </label>
            <div className="request-confirmation-actions">
              <button
                className="request-button request-button-text"
                disabled={editor.action !== null}
                onClick={() => {
                  restoreOpenFocus.current = true;
                  setAcknowledgedMessage(null);
                  editor.dismissSentConfirmation();
                }}
                type="button"
              >
                Not yet
              </button>
              {actionContainer === undefined ? primaryAction : null}
            </div>
            {editor.error ? <RequestError>{editor.error}</RequestError> : null}
            </div>
          </section>
        ) : <UpcomingMessageStep number={3} title={followUpDraftId ? "Mark as sent" : "Send with your report"} description="Use your email app, then confirm you’ve sent it." />}
      </div>
      {actionContainer ? createPortal(primaryAction, actionContainer) : null}
    </section>
  );
}

function availableFact(value: string | null | undefined) {
  return value &&
    !/^(?:unavailable|not available|not disclosed)$/iu.test(value.trim())
    ? value
    : null;
}

function SendingDetails({
  details,
  email,
  reference,
  onEmail,
  onReference,
  pending,
  attempted,
}: {
  readonly details: TotalLossSendingDetails;
  readonly email: string;
  readonly reference: string;
  readonly onEmail: (value: string) => void;
  readonly onReference: (value: string) => void;
  readonly pending: boolean;
  readonly attempted: boolean;
}) {
  const emailError = attempted && !EMAIL_PATTERN.test(email.trim());
  const referenceError = attempted && !reference.trim();
  const emailConfirmed = Boolean(
    details.adjusterEmail && details.adjusterEmailConfirmed,
  );
  const referenceConfirmed = Boolean(
    details.claimReference && details.claimReferenceConfirmed,
  );
  return (
    <div className="request-fields">
      {!emailConfirmed ? (
        <div className="request-field">
          <label htmlFor="request-adjuster-email">
            Your adjuster’s email
          </label>
          <input
            aria-describedby="request-email-help"
            aria-invalid={emailError || undefined}
            autoComplete="email"
            disabled={pending}
            id="request-adjuster-email"
            maxLength={320}
            onChange={(event) => onEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <span className={emailError ? "request-field-error" : "request-field-help"} id="request-email-help">
            {emailError
              ? "Enter the adjuster’s valid email address."
              : "Use your adjuster’s email or the claims email provided by your insurer."}
          </span>
        </div>
      ) : (
        <p className="request-confirmed-fact">
          <span>Your adjuster’s email</span><strong>{details.adjusterEmail}</strong>
        </p>
      )}
      {!referenceConfirmed ? (
        <div className="request-field">
          <label htmlFor="request-claim-reference">
            Claim number
          </label>
          <input
            aria-describedby="request-reference-help"
            aria-invalid={Boolean(referenceError) || undefined}
            disabled={pending}
            id="request-claim-reference"
            maxLength={200}
            onChange={(event) => onReference(event.target.value)}
            required
            value={reference}
          />
          <span className={referenceError ? "request-field-error" : "request-field-help"} id="request-reference-help">
            {referenceError
              ? "Enter your claim number."
              : "You can find this on your insurer’s letters or emails."}
          </span>
        </div>
      ) : (
        <p className="request-confirmed-fact">
          <span>Claim number</span><strong>{details.claimReference}</strong>
        </p>
      )}
    </div>
  );
}

export function MessagePreparation({
  actionContainer,
  intakeMode = "report",
  onDraftStateChange,
  onSent,
  onSentAttempt,
  ...props
}: MessagePreparationProps) {
  const formId = useId();
  const preparation = useRequestPreparation(props);
  const { details, draft } = preparation;
  const hasDraft = Boolean(draft);
  useLayoutEffect(() => {
    onDraftStateChange?.(hasDraft);
  }, [hasDraft, onDraftStateChange]);
  if (requestIsSent(props.claim)) return <RequestRecorded {...props} />;
  if (draft) {
    return (
      <DraftEditor
        {...props}
        actionContainer={actionContainer}
        draft={draft}
        initialPreparedMessage={preparation.preparedVersion}
        key={draft.draftId}
        onSent={onSent}
        onSentAttempt={onSentAttempt}
        workflowRevision={preparation.workflowRevision}
      />
    );
  }

  const createAction = (
    <button
      className={actionContainer === undefined ? "request-button request-button-primary" : "review-primary"}
      disabled={
        preparation.creating ||
        !details ||
        !props.claim.workflow ||
        !preparation.reviewCompleted
      }
      form={formId}
      type="submit"
    >
      <StableActionLabel reserve="Create my message">{preparation.creating ? "Creating draft…" : "Create my message"}</StableActionLabel>
      {preparation.creating ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <SquarePen aria-hidden="true" />}
    </button>
  );

  return (
    <form
      className="request-prepare"
      id={formId}
      onInvalid={preparation.markAttempted}
      onSubmit={(event) => {
        event.preventDefault();
        void preparation.createDraft();
      }}
    >
      <header className="request-heading" data-review-entrance="primary" data-review-order="0">
        <h1>Prepare your message</h1>
        <p>
          Review the details and message here, then send it from your email app.
        </p>
      </header>
      <div className="message-flow" role="list" aria-label="Message steps" data-review-entrance="supporting">
        <section className="message-flow-step" role="listitem" data-state="active" aria-current="step">
          <MessageStepHeading number={1} title="Check your details" state="active" description="We’ll use these details to address your message." id={`${formId}-details-heading`} />
          <div className="message-flow-content">
        {details ? (
          <div className="message-details">
            <dl className="request-known-details">
              {availableFact(details.insurerName) ? (
                <div>
                  <dt>Insurance company</dt>
                  <dd>{details.insurerName}</dd>
                </div>
              ) : null}
              {availableFact(details.customerName) ? (
                <div>
                  <dt>Vehicle owner</dt>
                  <dd>{details.customerName}</dd>
                </div>
              ) : null}
            </dl>
            <SendingDetails
              attempted={preparation.attempted}
              details={details}
              email={preparation.email}
              reference={preparation.reference}
              onEmail={preparation.setEmail}
              onReference={preparation.setReference}
              pending={preparation.creating}
            />
          </div>
        ) : (
          <div className="request-save-recovery">
            <RequestError>
              We couldn’t load your sending details. Try again to continue.
            </RequestError>
            <button className="request-button request-button-secondary" onClick={() => void props.onRefresh()} type="button">
              Try again
            </button>
            {actionContainer === undefined ? <div className="message-local-actions">{createAction}</div> : null}
          </div>
        )}
        <details className="message-report">
          <summary>Your report is ready <ChevronDown size={16} aria-hidden="true" /></summary>
          <p>Download this report and attach it when you send your email.</p>
          <ReportFileRow {...props} variant="attachment" />
        </details>
        {intakeMode === "manual" ? <p className="message-manual-note">You can also ask for your insurer’s full valuation report by adding that request to your message.</p> : null}
        <div className="message-local-actions"><p>This creates a draft. Nothing is sent yet.</p>{actionContainer === undefined && details ? createAction : null}</div>
        <div className="request-action-bar request-prepare-actions" data-navigation-action={actionContainer !== undefined || undefined}>
          {!preparation.reviewCompleted ? (
            <p>Complete the review before creating your message.</p>
          ) : null}
          {preparation.error ? <RequestError>{preparation.error}</RequestError> : null}
        </div>
          </div>
        </section>
        <UpcomingMessageStep number={2} title="Review your message" description="Read and edit the email we prepare for you." />
        <UpcomingMessageStep number={3} title="Send with your report" description="Use your email app, then confirm you’ve sent it." />
      </div>
      {actionContainer ? createPortal(createAction, actionContainer) : null}
    </form>
  );
}
