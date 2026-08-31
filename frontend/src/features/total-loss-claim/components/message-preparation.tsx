import { useEffect, useId } from "react";

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

interface MessagePreparationProps extends RequestPreparationOptions {
  readonly onDraftStateChange?: (hasDraft: boolean) => void;
  readonly onSent?: () => void;
}

function RequestError({ children }: { readonly children: React.ReactNode }) {
  return <p role="alert">{children}</p>;
}

function RequestRecorded(props: RequestPreparationOptions) {
  return (
    <section aria-label="Request status">
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
  draft,
  initialPreparedMessage,
  workflowRevision,
  onSent,
  ...props
}: RequestPreparationOptions & {
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
  if (editor.sent) return <RequestRecorded {...props} />;

  return (
    <section aria-label="Request draft">
      <h1>Review and send</h1>
      <p>Review the message, then send it from your own email account.</p>
      <p role="status">
        {editor.saving
          ? "Saving…"
          : editor.saveError
            ? "Changes not saved"
            : editor.dirty
              ? "Unsaved changes"
              : "Saved"}
      </p>
      {editor.dirty && editor.invalid ? (
        <p>
          Invalid changes won’t be saved until corrected. Your last saved draft
          is unchanged.
        </p>
      ) : null}
      <fieldset disabled={editor.action !== null || editor.conflict}>
        <legend>Email draft</legend>
        <div>
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
            <p id={`${fieldId}-recipient-error`}>{editor.fieldErrors.recipient}</p>
          ) : null}
        </div>
        <div>
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
            <p id={`${fieldId}-subject-error`}>{editor.fieldErrors.subject}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${fieldId}-message`}>Message</label>
          <textarea
            aria-describedby={
              editor.fieldErrors.body ? `${fieldId}-message-error` : undefined
            }
            aria-invalid={Boolean(editor.fieldErrors.body) || undefined}
            id={`${fieldId}-message`}
            maxLength={50000}
            onChange={(event) => editor.edit("body", event.target.value)}
            required
            rows={15}
            value={editor.content.body}
          />
          {editor.fieldErrors.body ? (
            <p id={`${fieldId}-message-error`}>{editor.fieldErrors.body}</p>
          ) : null}
        </div>
      </fieldset>
      {editor.saveError ? (
        <div>
          <RequestError>{editor.saveError}</RequestError>
          <button
            disabled={editor.saving || editor.action !== null}
            onClick={() => void editor.retrySave(editor.conflict)}
            type="button"
          >
            {editor.conflict ? "Load saved draft" : "Retry save"}
          </button>
        </div>
      ) : null}
      <ol>
        <li>Review the recipient, subject, and message above.</li>
        <li>Download your evidence package.</li>
        <li>Open your email application or copy the email.</li>
        <li>Attach the PDF yourself, then send the email.</li>
        <li>Return here and mark the request as sent.</li>
      </ol>
      <ReportFileRow {...props} />
      <div aria-label="Request actions">
        <button
          disabled={editor.action !== null || editor.conflict}
          onClick={() => void editor.shareEmail("open")}
          type="button"
        >
          {editor.action === "open" ? "Preparing email…" : "Open email"}
        </button>
        <button
          disabled={editor.action !== null || editor.conflict}
          onClick={() => void editor.shareEmail("copy")}
          type="button"
        >
          {editor.action === "copy" ? "Copying…" : "Copy email"}
        </button>
      </div>
      {editor.notice ? <p role="status">{editor.notice}</p> : null}
      {editor.error ? <RequestError>{editor.error}</RequestError> : null}
      {editor.sharedMessage ? (
        <section aria-labelledby={`${fieldId}-sent-confirmation`}>
          <h3 id={`${fieldId}-sent-confirmation`}>
            Sent the email with the report attached?
          </h3>
          <dl>
            <dt>To</dt>
            <dd>{editor.sharedMessage.recipient}</dd>
            <dt>Subject</dt>
            <dd>{editor.sharedMessage.subject}</dd>
          </dl>
          <p>
            Opening or copying the email does not send it. “Mark as sent”
            confirms that you sent this email with the report.
          </p>
          <button
            disabled={editor.action !== null}
            onClick={editor.dismissSentConfirmation}
            type="button"
          >
            Not yet
          </button>
          <button
            aria-describedby={`${fieldId}-sent-confirmation`}
            disabled={editor.action !== null}
            onClick={() => void editor.confirmSent()}
            type="button"
          >
            {editor.action === "sent" ? "Recording…" : "Mark as sent"}
          </button>
        </section>
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
    <div>
      {!emailConfirmed ? (
        <div>
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
          <span id="request-email-help">
            {emailError
              ? "Enter the adjuster’s valid email address."
              : "Required so the request is addressed to your insurer."}
          </span>
        </div>
      ) : (
        <p>
          Recipient: <strong>{details.adjusterEmail}</strong>
        </p>
      )}
      {!referenceConfirmed ? (
        <div>
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
          <span id="request-reference-help">
            {referenceError
              ? "Enter the claim or reference number."
              : "Required so the insurer can identify your claim."}
          </span>
        </div>
      ) : (
        <p>
          Claim reference: <strong>{details.claimReference}</strong>
        </p>
      )}
    </div>
  );
}

export function MessagePreparation({
  onDraftStateChange,
  onSent,
  ...props
}: MessagePreparationProps) {
  const preparation = useRequestPreparation(props);
  const { details, draft } = preparation;
  const hasDraft = Boolean(draft);
  useEffect(() => {
    onDraftStateChange?.(hasDraft);
  }, [hasDraft, onDraftStateChange]);
  if (requestIsSent(props.claim)) return <RequestRecorded {...props} />;
  if (draft) {
    return (
      <DraftEditor
        {...props}
        draft={draft}
        initialPreparedMessage={preparation.preparedVersion}
        key={draft.draftId}
        onSent={onSent}
        workflowRevision={preparation.workflowRevision}
      />
    );
  }

  return (
    <form
      onInvalid={preparation.markAttempted}
      onSubmit={(event) => {
        event.preventDefault();
        void preparation.createDraft();
      }}
    >
      <h1>Prepare your request</h1>
      <p>
        You’re asking the insurer to review its valuation using the supporting
        comparable-vehicle evidence and provide a written response.
      </p>
      <p>
        Your evidence package organizes the supporting valuation information and
        market evidence. You’ll attach it to your email.
      </p>
      <ReportFileRow {...props} />
      {details ? (
        <>
          <dl>
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
      <p>
        You can edit the entire email. Nothing is sent until you send it from
        your own email account.
      </p>
      {!preparation.reviewCompleted ? (
        <p>Complete the review before preparing your request.</p>
      ) : null}
      {preparation.error ? <RequestError>{preparation.error}</RequestError> : null}
      <button
        disabled={
          preparation.creating ||
          !details ||
          !props.claim.workflow ||
          !preparation.reviewCompleted
        }
        type="submit"
      >
        {preparation.creating ? "Creating draft…" : "Create my request"}
      </button>
    </form>
  );
}
