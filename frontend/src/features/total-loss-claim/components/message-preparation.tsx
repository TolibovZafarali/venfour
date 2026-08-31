import { ArrowRight, Check, Copy, LoaderCircle, Mail } from "lucide-react";
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
import { StableActionLabel } from "./stable-action-label";

interface MessagePreparationProps extends RequestPreparationOptions {
  readonly actionContainer?: HTMLElement | null;
  readonly intakeMode?: TotalLossIntakeMode;
  readonly onDraftStateChange?: (hasDraft: boolean) => void;
  readonly onSent?: () => void;
}

function RequestError({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="request-error" role="alert">{children}</p>
  );
}

function RequestRecorded(props: RequestPreparationOptions) {
  return (
    <section className="request-recorded" aria-label="Request status">
      <span className="request-recorded-icon" aria-hidden="true">
        <Check />
      </span>
      <h2>Request marked as sent</h2>
      <p role="status">
        You reported sending the request. Venfour cannot verify email delivery
        or receipt.
      </p>
      <p>Keep a copy of the email, the report, and any response from your insurer.</p>
      <ReportFileRow {...props} />
    </section>
  );
}

function DraftEditor({
  actionContainer,
  draft,
  initialPreparedMessage,
  workflowRevision,
  onSent,
  ...props
}: RequestPreparationOptions & {
  readonly actionContainer?: HTMLElement | null;
  readonly draft: TotalLossMessageDraft;
  readonly initialPreparedMessage: TotalLossPreparedMessageVersion | null;
  readonly workflowRevision: number;
  readonly onSent?: () => void;
}) {
  const editor = useRequestDraft({
    ...props,
    draft,
    initialPreparedMessage,
    workflowRevision,
    onSent,
  });
  const fieldId = useId();
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const confirmationPanel = useRef<HTMLElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const restoreOpenFocus = useRef(false);
  const [acknowledgedMessage, setAcknowledgedMessage] = useState<TotalLossPreparedMessageVersion | null>(null);
  const hasSharedMessage = Boolean(editor.sharedMessage);
  const sentAcknowledged = hasSharedMessage && acknowledgedMessage === editor.sharedMessage;
  const shareEmail = (kind: "open" | "copy") => {
    setAcknowledgedMessage(null);
    void editor.shareEmail(kind);
  };
  useLayoutEffect(() => {
    if (hasSharedMessage) {
      confirmationHeading.current?.focus({ preventScroll: true });
      confirmationPanel.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    } else if (restoreOpenFocus.current) {
      restoreOpenFocus.current = false;
      openButton.current?.focus({ preventScroll: true });
    }
  }, [hasSharedMessage]);
  if (editor.sent) return <RequestRecorded {...props} />;

  const primaryAction = editor.sharedMessage ? (
    <button
      key="confirm-sent"
      className={actionContainer === undefined ? "request-button request-button-primary" : "review-primary"}
      aria-describedby={`${fieldId}-sent-confirmation`}
      disabled={!sentAcknowledged || editor.action !== null || editor.conflict}
      onClick={() => {
        if (sentAcknowledged) void editor.confirmSent();
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
      <StableActionLabel reserve="Preparing email…">{editor.action === "open" ? "Preparing email…" : "Open email app"}</StableActionLabel>
      {editor.action === "open" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
    </button>
  );

  return (
    <section className="request-review" aria-label="Request draft">
      <header className="request-heading" data-review-entrance="primary">
        <h1>Review and send your request</h1>
        <p>Your message and supporting evidence, ready to review.</p>
      </header>
      <div className="request-send-layout" data-confirming={hasSharedMessage || undefined}>
        <aside className="request-evidence-panel" data-review-entrance="secondary" aria-labelledby={`${fieldId}-evidence`}>
          <h2 id={`${fieldId}-evidence`}>Evidence to attach</h2>
          <ReportFileRow {...props} variant="attachment" />
          <p className="request-attachment-note">Attach this PDF in your email app before sending.</p>
        </aside>
        <div className="request-draft-column" data-review-entrance="supporting">
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
            <div className="request-composer-actions">
              <button
                className="request-button request-button-text"
                disabled={editor.action !== null || editor.conflict}
                onClick={() => shareEmail("copy")}
                type="button"
              >
                {editor.action === "copy" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Copy aria-hidden="true" />}
                <StableActionLabel reserve="Copy email">{editor.action === "copy" ? "Copying…" : "Copy email"}</StableActionLabel>
              </button>
            </div>
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
          {editor.notice ? <p className="request-notice" role="status">{editor.notice}</p> : null}
          {editor.error ? <RequestError>{editor.error}</RequestError> : null}
        </div>
        {editor.sharedMessage ? (
          <section className="request-sent-confirmation" aria-labelledby={`${fieldId}-sent-confirmation`} ref={confirmationPanel}>
            <h3 id={`${fieldId}-sent-confirmation`} ref={confirmationHeading} tabIndex={-1}>
              Sent the email with the report attached?
            </h3>
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
              <span>I sent the email with this PDF attached.</span>
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
            </div>
          </section>
        ) : null}
      </div>
      {actionContainer ? createPortal(primaryAction, actionContainer) : actionContainer === undefined ? (
        <div className="request-editor-actions" aria-label="Request actions">{primaryAction}</div>
      ) : null}
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
            Adjuster or claims email
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
              : "Required so the request is addressed to your insurer."}
          </span>
        </div>
      ) : (
        <p className="request-confirmed-fact">
          Recipient: <strong>{details.adjusterEmail}</strong>
        </p>
      )}
      {!referenceConfirmed ? (
        <div className="request-field">
          <label htmlFor="request-claim-reference">
            Claim or reference number
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
              ? "Enter the claim or reference number."
              : "Required so the insurer can identify your claim."}
          </span>
        </div>
      ) : (
        <p className="request-confirmed-fact">
          Claim reference: <strong>{details.claimReference}</strong>
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
      <StableActionLabel reserve="Create my request">{preparation.creating ? "Creating draft…" : "Create my request"}</StableActionLabel>
      {preparation.creating ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
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
      <header className="request-heading" data-review-entrance="primary">
        <h1>Prepare your request</h1>
        <p>
          {intakeMode === "manual"
            ? "Ask the insurer to review the offer using the attached market evidence and provide a written response. Also ask for the full valuation report, including the comparable vehicles and adjustments used. You can add or edit this request in the email before sending."
            : "You’re going to ask the insurer to review its valuation using the market evidence and provide a written response."}
        </p>
      </header>
      <div data-review-entrance="secondary">
        <p className="request-package-intro">
          Your evidence package contains the supporting valuation information and
          comparable-vehicle evidence. You’ll attach it to your email.
        </p>
        <ReportFileRow {...props} />
      </div>
      <div data-review-entrance="supporting">
        {details ? (
          <>
            <dl className="request-known-details">
              {availableFact(details.insurerName) ? (
                <>
                  <dt>Insurance company</dt>
                  <dd>{details.insurerName}</dd>
                </>
              ) : null}
              {availableFact(details.customerName) ? (
                <>
                  <dt>Vehicle owner</dt>
                  <dd>{details.customerName}</dd>
                </>
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
          </>
        ) : (
          <RequestError>
            Sending details are temporarily unavailable. Refresh this case before
            preparing a request.
          </RequestError>
        )}
        <div className="request-action-bar request-prepare-actions" data-footer-action={actionContainer !== undefined || undefined}>
          {!preparation.reviewCompleted ? (
            <p>Complete the review before preparing your request.</p>
          ) : null}
          {preparation.error ? <RequestError>{preparation.error}</RequestError> : null}
          {actionContainer === undefined ? createAction : null}
        </div>
      </div>
      {actionContainer ? createPortal(createAction, actionContainer) : null}
    </form>
  );
}
