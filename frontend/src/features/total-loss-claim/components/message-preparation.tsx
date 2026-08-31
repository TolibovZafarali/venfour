import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";

import { normalizeCustomerRequestBody } from "@/features/total-loss-claim/customer-message-copy";
import { totalLossClaimViewPath } from "@/features/total-loss-claim/workflow-route";
import { getTotalLossMessageDraft } from "@/features/total-loss-claim/api";
import {
  buildTotalLossMailto,
  copyPreparedEmail,
  openDefaultEmailApp,
} from "@/features/total-loss-claim/browser-actions";
import { ReportFileRow } from "@/features/total-loss-claim/components/published-report-actions";
import type {
  TotalLossClaimSecured,
  TotalLossMessageDraft,
  TotalLossPreparedMessageVersion,
  TotalLossPublishedReport,
  TotalLossSendingDetails,
} from "@/features/total-loss-claim/contracts";
import {
  useTotalLossEducationProgressMutation,
  useTotalLossMessageDraftMutation,
  useTotalLossMessageOpenedMutation,
  useTotalLossMessageSentMutation,
  useTotalLossPrepareMessageMutation,
  useTotalLossSendingDetailsMutation,
} from "@/features/total-loss-claim/queries";

function requestId() {
  return globalThis.crypto.randomUUID();
}

const OPTIONAL_REVIEW = [
  "insurer_review",
  "valuation",
  "report",
  "what_next",
] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

interface MessagePreparationProps {
  readonly accessToken: string;
  readonly backTo?: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
}

function RequestError({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="case-error" role="alert">
      {children}
    </p>
  );
}

function RequestRecorded({
  accessToken,
  backTo,
  caseId,
  report,
  userId,
}: Omit<MessagePreparationProps, "claim" | "onRefresh">) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="review-request">
      <div className="review-request-form review-request-receipt">
        <p className="review-eyebrow">You’ve taken the next step</p>
        <h1 className="review-heading" ref={heading} tabIndex={-1}>
          Request marked as sent
        </h1>
        <p className="review-lead">
          Now give your insurer time to review the evidence and respond in
          writing.
        </p>
        <p className="review-copy">
          Keep a copy of the email and any response, requested documents, or
          revised valuation. You reported sending the request; Venfour cannot
          verify email delivery or receipt.
        </p>
        <details className="review-disclosure">
          <summary>Keep your evidence report</summary>
          <ReportFileRow
            accessToken={accessToken}
            caseId={caseId}
            report={report}
            userId={userId}
          />
        </details>
      </div>
      <footer
        className="review-actions review-request-actions"
        aria-label="Request actions"
      >
        <div className="review-action-buttons">
          {backTo ? (
            <Link className="case-button" data-variant="text" to={backTo}>
              Back
            </Link>
          ) : null}
          <Link
            className="case-button"
            data-variant="primary"
            to={totalLossClaimViewPath(caseId, "activity")}
          >
            Continue
          </Link>
        </div>
      </footer>
    </div>
  );
}

type DraftContent = Pick<TotalLossMessageDraft, "body" | "subject"> & {
  readonly recipient: string;
};

function contentOf(draft: TotalLossMessageDraft): DraftContent {
  return {
    recipient: draft.recipient ?? "",
    subject: draft.subject,
    body: draft.body,
  };
}

function normalizedContent(content: DraftContent): DraftContent {
  return {
    recipient: content.recipient.trim().toLowerCase(),
    subject: content.subject.trim(),
    body: content.body,
  };
}

function sameContent(left: DraftContent, right: DraftContent) {
  return (
    left.recipient === right.recipient &&
    left.subject === right.subject &&
    left.body === right.body
  );
}

function validationError(content: DraftContent) {
  if (!EMAIL_PATTERN.test(content.recipient.trim()))
    return "Enter a valid recipient email address.";
  if (!content.subject.trim()) return "Add an email subject.";
  if (!content.body.trim()) return "Add an email message.";
  return null;
}

function DraftEditor({
  accessToken,
  backTo,
  caseId,
  draft: initialDraft,
  initialPreparedMessage,
  onRefresh,
  report,
  userId,
  workflowRevision,
}: MessagePreparationProps & {
  readonly draft: TotalLossMessageDraft;
  readonly initialPreparedMessage: TotalLossPreparedMessageVersion | null;
  readonly workflowRevision: number;
}) {
  const { mutateAsync: saveDraft } = useTotalLossMessageDraftMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: prepare } = useTotalLossPrepareMessageMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: recordOpened } = useTotalLossMessageOpenedMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: recordSent } = useTotalLossMessageSentMutation({
    accessToken,
    caseId,
    userId,
  });
  const [content, setContent] = useState(() => ({
    ...contentOf(initialDraft),
    body: normalizeCustomerRequestBody(initialDraft.body, report),
  }));
  const [savedContent, setSavedContent] = useState(() =>
    contentOf(initialDraft),
  );
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<"copy" | "open" | "sent" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sharedMessage, setSharedMessage] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const contentRef = useRef(content);
  const savedRef = useRef(initialDraft);
  const inFlightSave = useRef<Promise<TotalLossMessageDraft> | null>(null);
  const preparedRef = useRef(initialPreparedMessage);
  const revisionRef = useRef(workflowRevision);
  const prepareRequestId = useRef(requestId());
  const sentRequestId = useRef(requestId());
  const actionRef = useRef(false);
  const dirty = !sameContent(normalizedContent(content), savedContent);
  const fieldId = useId();
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const confirmingSent = Boolean(sharedMessage);
  const fieldErrors = {
    recipient:
      dirty && !EMAIL_PATTERN.test(content.recipient.trim())
        ? "Enter a valid recipient email address."
        : null,
    subject: dirty && !content.subject.trim() ? "Add an email subject." : null,
    body: dirty && !content.body.trim() ? "Add an email message." : null,
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    stageHeading.current?.focus({ preventScroll: true });
  }, [confirmingSent]);

  useEffect(() => {
    revisionRef.current = Math.max(revisionRef.current, workflowRevision);
  }, [workflowRevision]);

  useEffect(() => {
    if (
      initialDraft.revision <= savedRef.current.revision ||
      inFlightSave.current
    )
      return;
    const incoming = contentOf(initialDraft);
    const local = normalizedContent(contentRef.current);
    if (
      !sameContent(local, contentOf(savedRef.current)) &&
      !sameContent(local, incoming)
    ) {
      setConflict(true);
      setSaveError(
        "This draft changed in another tab. Load the saved draft to review those changes before editing again.",
      );
      return;
    }
    const nextContent = {
      ...incoming,
      body: normalizeCustomerRequestBody(initialDraft.body, report),
    };
    savedRef.current = initialDraft;
    contentRef.current = nextContent;
    preparedRef.current = null;
    prepareRequestId.current = requestId();
    sentRequestId.current = requestId();
    setSaveError(null);
    setConflict(false);
    setSavedContent(incoming);
    setContent(nextContent);
    setSharedMessage(null);
    setNotice(null);
  }, [initialDraft, report]);

  const persist = useCallback(async (): Promise<TotalLossMessageDraft> => {
    if (inFlightSave.current) return inFlightSave.current;
    const saveLatest = async () => {
      try {
        while (true) {
          const snapshot = contentRef.current;
          const normalized = normalizedContent(snapshot);
          const invalid = validationError(normalized);
          if (invalid) throw new Error(invalid);
          if (sameContent(normalized, contentOf(savedRef.current))) {
            setSaveError(null);
            return savedRef.current;
          }
          setSaving(true);
          const saved = await saveDraft({
            ...normalized,
            expectedRevision: savedRef.current.revision,
          });
          savedRef.current = saved;
          setSavedContent(contentOf(saved));
          if (sameContent(contentRef.current, snapshot)) {
            contentRef.current = contentOf(saved);
            setContent(contentOf(saved));
          }
        }
      } catch {
        const message =
          validationError(contentRef.current) ??
          "We couldn’t save your changes. Your last saved draft is unchanged. Retry saving before sending.";
        setSaveError(message);
        throw new Error(message);
      } finally {
        setSaving(false);
      }
    };
    const pending = saveLatest();
    inFlightSave.current = pending;
    try {
      return await pending;
    } finally {
      inFlightSave.current = null;
    }
  }, [saveDraft]);

  useEffect(() => {
    if (!dirty || validationError(content) || saveError || conflict) return;
    const timeout = window.setTimeout(() => {
      void persist().catch(() => undefined);
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [content, conflict, dirty, persist, saveError]);

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (
        sameContent(
          normalizedContent(contentRef.current),
          contentOf(savedRef.current),
        )
      )
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => {
      window.removeEventListener("beforeunload", warnUnsaved);
      if (!validationError(contentRef.current))
        void persist().catch(() => undefined);
    };
  }, [persist]);

  const edit = (field: keyof DraftContent, value: string) => {
    const next = { ...contentRef.current, [field]: value };
    contentRef.current = next;
    setContent(next);
    preparedRef.current = null;
    prepareRequestId.current = requestId();
    sentRequestId.current = requestId();
    setSharedMessage(null);
    setNotice(null);
    setError(null);
  };

  const retrySave = async (loadSaved = false) => {
    setSaving(true);
    setError(null);
    try {
      if (inFlightSave.current)
        await inFlightSave.current.catch(() => undefined);
      const current = await getTotalLossMessageDraft(caseId, accessToken);
      const currentContent = contentOf(current);
      const matchesLocal = sameContent(
        currentContent,
        normalizedContent(contentRef.current),
      );
      const matchesBaseline = sameContent(
        currentContent,
        contentOf(savedRef.current),
      );
      if (!loadSaved && !matchesLocal && !matchesBaseline) {
        setConflict(true);
        setSaveError(
          "This draft changed in another tab. Load the saved draft to review those changes before editing again.",
        );
        return;
      }
      savedRef.current = current;
      setSavedContent(currentContent);
      setSaveError(null);
      setConflict(false);
      if (loadSaved || matchesLocal) {
        const displayContent = {
          ...currentContent,
          body: normalizeCustomerRequestBody(current.body, report),
        };
        contentRef.current = displayContent;
        setContent(displayContent);
        preparedRef.current = null;
        prepareRequestId.current = requestId();
        sentRequestId.current = requestId();
        setSharedMessage(null);
      } else {
        await persist();
      }
    } catch {
      setSaveError("We couldn’t save your changes. Try again before sending.");
    } finally {
      setSaving(false);
    }
  };

  const prepareExact = async () => {
    const saved = await persist();
    if (
      preparedRef.current &&
      preparedRef.current.reportVersionId === saved.reportVersionId &&
      sameContent(preparedRef.current, contentOf(saved))
    )
      return preparedRef.current;
    const prepared = await prepare({
      clientRequestId: prepareRequestId.current,
      expectedWorkflowRevision: revisionRef.current,
    });
    revisionRef.current = Math.max(
      revisionRef.current,
      prepared.workflowRevision,
    );
    if (
      prepared.draft.reportVersionId !== saved.reportVersionId ||
      !sameContent(contentOf(prepared.draft), contentOf(saved)) ||
      !sameContent(prepared.messageVersion, contentOf(saved))
    ) {
      setConflict(true);
      setSaveError(
        "This draft changed in another tab. Load the saved draft to review those changes before sending.",
      );
      throw new Error(
        "The saved request changed. Review it before continuing.",
      );
    }
    preparedRef.current = prepared.messageVersion;
    return prepared.messageVersion;
  };

  const shareEmail = async (kind: "copy" | "open") => {
    if (actionRef.current || conflict) return;
    actionRef.current = true;
    setAction(kind);
    setError(null);
    setNotice(null);
    try {
      const exact = await prepareExact();
      if (kind === "copy") {
        await copyPreparedEmail(exact);
        setNotice("Email copied. Attach the PDF before sending.");
      } else {
        openDefaultEmailApp(buildTotalLossMailto(exact));
        void recordOpened({
          clientRequestId: requestId(),
          messageVersionId: exact.messageVersionId,
        }).catch(() => undefined);
        setNotice("Email app opened. Attach the PDF before sending.");
      }
      if (!sameContent(normalizedContent(contentRef.current), exact)) {
        setNotice(
          "The draft changed while you were opening or copying it. Review the current draft before continuing.",
        );
        setSharedMessage(null);
      } else {
        setSharedMessage(exact);
      }
    } catch {
      setError(
        validationError(contentRef.current) ??
          (kind === "copy"
            ? "We couldn’t copy the email. Try again after saving your draft, or open your email app."
            : "We couldn’t open your email app. Try again after saving your draft, or copy the email instead."),
      );
    } finally {
      actionRef.current = false;
      setAction(null);
    }
  };

  const confirmSent = async () => {
    if (!sharedMessage || actionRef.current) return;
    actionRef.current = true;
    setAction("sent");
    setError(null);
    try {
      await recordSent({
        clientRequestId: sentRequestId.current,
        expectedWorkflowRevision: revisionRef.current,
        messageVersionId: sharedMessage.messageVersionId,
      });
      setSent(true);
      await onRefresh();
    } catch {
      await onRefresh().catch(() => undefined);
      setError(
        "We couldn’t record that the request was sent. Your exact prepared message is saved; try again.",
      );
    } finally {
      actionRef.current = false;
      setAction(null);
    }
  };

  if (sent)
    return (
      <RequestRecorded
        accessToken={accessToken}
        backTo={backTo}
        caseId={caseId}
        report={report}
        userId={userId}
      />
    );

  return (
    <div className="review-request">
      <div className="review-request-form">
        {sharedMessage ? (
          <section
            className="review-request-confirmation"
            aria-labelledby="sent-confirmation-heading"
          >
            <p className="review-eyebrow">One last check</p>
            <h1
              className="review-heading"
              id="sent-confirmation-heading"
              ref={stageHeading}
              tabIndex={-1}
            >
              Sent the email with the report attached?
            </h1>
            <p className="review-lead">
              Send the email from your account, with the market evidence report
              attached. Then mark it as sent here.
            </p>
            <dl className="review-message-summary">
              <div>
                <dt>To</dt>
                <dd>{sharedMessage.recipient}</dd>
              </div>
              <div>
                <dt>Subject</dt>
                <dd>{sharedMessage.subject}</dd>
              </div>
            </dl>
            <p className="review-copy">
              Opening or copying the email does not send it. “Mark as sent”
              confirms that you sent this email with the report.
            </p>
            <ReportFileRow
              accessToken={accessToken}
              caseId={caseId}
              report={report}
              userId={userId}
            />
          </section>
        ) : (
          <>
            <header className="review-request-heading">
              <div>
                <p className="review-eyebrow">Your email, in your words</p>
                <h1 className="review-heading" ref={stageHeading} tabIndex={-1}>
                  Review your request
                </h1>
              </div>
              <span className="case-status" role="status">
                {saving
                  ? "Saving…"
                  : saveError
                    ? "Changes not saved"
                    : dirty
                      ? "Unsaved changes"
                      : "Saved"}
              </span>
            </header>
            <p className="review-lead">
              Here’s a starting point for your email. Make any changes you’d
              like before sending it to your insurer.
            </p>
            {dirty && validationError(content) ? (
              <p className="review-copy">
                Invalid changes won’t be saved until corrected. Your last saved
                draft is unchanged.
              </p>
            ) : null}
            <div className="review-letter">
              <div className="case-label">
                <label htmlFor={`${fieldId}-recipient`}>Recipient</label>
                <input
                  aria-describedby={
                    fieldErrors.recipient
                      ? `${fieldId}-recipient-error`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.recipient) || undefined}
                  autoComplete="email"
                  className="case-field"
                  disabled={action !== null || conflict}
                  id={`${fieldId}-recipient`}
                  maxLength={320}
                  onChange={(event) => edit("recipient", event.target.value)}
                  required
                  type="email"
                  value={content.recipient}
                />
                {fieldErrors.recipient ? (
                  <p className="case-error" id={`${fieldId}-recipient-error`}>
                    {fieldErrors.recipient}
                  </p>
                ) : null}
              </div>
              <div className="case-label">
                <label htmlFor={`${fieldId}-subject`}>Subject</label>
                <input
                  aria-describedby={
                    fieldErrors.subject ? `${fieldId}-subject-error` : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.subject) || undefined}
                  className="case-field"
                  disabled={action !== null || conflict}
                  id={`${fieldId}-subject`}
                  maxLength={998}
                  onChange={(event) => edit("subject", event.target.value)}
                  required
                  value={content.subject}
                />
                {fieldErrors.subject ? (
                  <p className="case-error" id={`${fieldId}-subject-error`}>
                    {fieldErrors.subject}
                  </p>
                ) : null}
              </div>
              <div className="case-label">
                <label htmlFor={`${fieldId}-message`}>Message</label>
                <textarea
                  aria-describedby={
                    fieldErrors.body ? `${fieldId}-message-error` : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.body) || undefined}
                  className="case-field case-message-field"
                  disabled={action !== null || conflict}
                  id={`${fieldId}-message`}
                  maxLength={50000}
                  onChange={(event) => edit("body", event.target.value)}
                  required
                  rows={15}
                  value={content.body}
                />
                {fieldErrors.body ? (
                  <p className="case-error" id={`${fieldId}-message-error`}>
                    {fieldErrors.body}
                  </p>
                ) : null}
              </div>
            </div>
            {saveError ? (
              <div>
                <RequestError>{saveError}</RequestError>
                <button
                  className="case-button"
                  data-variant="text"
                  disabled={saving || action !== null}
                  onClick={() => void retrySave(conflict)}
                  type="button"
                >
                  {conflict ? "Load saved draft" : "Retry save"}
                </button>
              </div>
            ) : null}
            <section
              className="review-request-attachment"
              aria-labelledby="request-attachment-heading"
            >
              <h2 id="request-attachment-heading">Attach the evidence</h2>
              <p className="review-copy">
                Download this PDF and attach it before you send your email.
              </p>
              <ReportFileRow
                accessToken={accessToken}
                caseId={caseId}
                report={report}
                userId={userId}
              />
            </section>
          </>
        )}
      </div>
      <footer
        className="review-actions review-request-actions"
        aria-label="Request actions"
      >
        <div className="review-action-feedback" aria-live="polite">
          {notice ? (
            <p className="case-status" role="status">
              {notice}
            </p>
          ) : null}
          {error ? <RequestError>{error}</RequestError> : null}
        </div>
        <div className="review-action-buttons">
          {sharedMessage ? (
            <>
              <button
                className="case-button"
                data-variant="secondary"
                disabled={action !== null}
                onClick={() => setSharedMessage(null)}
                type="button"
              >
                Not yet
              </button>
              <button
                aria-describedby="sent-confirmation-heading"
                className="case-button"
                data-variant="primary"
                disabled={action !== null}
                onClick={() => void confirmSent()}
                type="button"
              >
                {action === "sent" ? "Recording…" : "Mark as sent"}
              </button>
            </>
          ) : (
            <>
              {backTo ? (
                <Link className="case-button" data-variant="text" to={backTo}>
                  Back
                </Link>
              ) : null}
              <button
                className="case-button"
                data-variant="secondary"
                disabled={action !== null || conflict}
                onClick={() => void shareEmail("copy")}
                type="button"
              >
                {action === "copy" ? "Copying…" : "Copy email"}
              </button>
              <button
                className="case-button"
                data-variant="primary"
                disabled={action !== null || conflict}
                onClick={() => void shareEmail("open")}
                type="button"
              >
                {action === "open" ? "Preparing email…" : "Open email app"}
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
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
    <div className="case-request-fields">
      {!emailConfirmed ? (
        <div className="case-label">
          <label htmlFor="request-adjuster-email">
            Adjuster or claims email
          </label>
          <input
            aria-describedby="request-email-help"
            aria-invalid={emailError || undefined}
            autoComplete="email"
            className="case-field"
            disabled={pending}
            id="request-adjuster-email"
            maxLength={320}
            onChange={(event) => onEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <span
            className={emailError ? "case-error" : "case-copy"}
            id="request-email-help"
          >
            {emailError
              ? "Enter the adjuster’s valid email address."
              : "Required so the request is addressed to your insurer."}
          </span>
        </div>
      ) : (
        <p className="case-copy">
          Recipient: <strong>{details.adjusterEmail}</strong>
        </p>
      )}
      {!referenceConfirmed ? (
        <div className="case-label">
          <label htmlFor="request-claim-reference">
            Claim or reference number
          </label>
          <input
            aria-describedby="request-reference-help"
            aria-invalid={Boolean(referenceError) || undefined}
            className="case-field"
            disabled={pending}
            id="request-claim-reference"
            maxLength={200}
            onChange={(event) => onReference(event.target.value)}
            required
            value={reference}
          />
          <span
            className={referenceError ? "case-error" : "case-copy"}
            id="request-reference-help"
          >
            {referenceError
              ? "Enter the claim or reference number."
              : "Required so the insurer can identify your claim."}
          </span>
        </div>
      ) : (
        <p className="case-copy">
          Claim reference: <strong>{details.claimReference}</strong>
        </p>
      )}
    </div>
  );
}

export function MessagePreparation(props: MessagePreparationProps) {
  const { accessToken, caseId, claim, report, userId } = props;
  const { mutateAsync: recordEducation } =
    useTotalLossEducationProgressMutation({ accessToken, caseId, userId });
  const { mutateAsync: saveDetails } = useTotalLossSendingDetailsMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: prepare } = useTotalLossPrepareMessageMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: saveDraft } = useTotalLossMessageDraftMutation({
    accessToken,
    caseId,
    userId,
  });
  const [draft, setDraft] = useState<TotalLossMessageDraft | null>(
    claim.messageDraft ?? null,
  );
  const [preparedVersion, setPreparedVersion] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const [preparedRevision, setPreparedRevision] = useState<number | null>(null);
  const [email, setEmail] = useState(claim.sendingDetails?.adjusterEmail ?? "");
  const [reference, setReference] = useState(
    claim.sendingDetails?.claimReference ?? "",
  );
  const [creating, setCreating] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(requestId());
  const creatingRef = useRef(false);
  const pendingGenerated = useRef<Awaited<ReturnType<typeof prepare>> | null>(
    null,
  );
  const details = claim.sendingDetails;

  const createDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingRef.current || !claim.workflow || !details) return;
    setAttempted(true);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter the adjuster’s valid email address.");
      return;
    }
    if (!reference.trim()) {
      setError("Enter the claim or reference number.");
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      let revision = claim.workflow.revision;
      if (!pendingGenerated.current) {
        if (!claim.education?.steps.result.completedAt) {
          const result = await recordEducation({
            expectedWorkflowRevision: revision,
            state: "completed",
            step: "result",
          });
          revision = result.workflowRevision;
        }
        const progress = claim.education?.steps;
        if (
          !OPTIONAL_REVIEW.some((step) => progress?.[step].skippedAt) &&
          !OPTIONAL_REVIEW.every((step) => progress?.[step].completedAt)
        ) {
          const skip = !progress?.what_next.completedAt
            ? "what_next"
            : (OPTIONAL_REVIEW.find((step) => !progress?.[step].completedAt) ??
              "what_next");
          const result = await recordEducation({
            expectedWorkflowRevision: revision,
            state: "skipped",
            step: skip,
          });
          revision = result.workflowRevision;
        }
        if (
          !details.adjusterEmailConfirmed ||
          !details.claimReferenceConfirmed ||
          email.trim() !== details.adjusterEmail ||
          reference.trim() !== details.claimReference
        ) {
          const result = await saveDetails({
            adjusterName: details.adjusterName,
            adjusterEmail: email.trim(),
            adjusterEmailConfirmed: true,
            claimReference: reference.trim(),
            claimReferenceConfirmed: true,
            expectedRevision: details.revision,
            expectedWorkflowRevision: revision,
          });
          revision = result.workflowRevision;
        }
        pendingGenerated.current = await prepare({
          clientRequestId: request.current,
          expectedWorkflowRevision: revision,
        });
      }
      const generated = pendingGenerated.current;
      const repairedBody = normalizeCustomerRequestBody(
        generated.draft.body,
        report,
      );
      let nextDraft = generated.draft;
      let nextVersion: TotalLossPreparedMessageVersion | null =
        generated.messageVersion;
      if (repairedBody !== generated.draft.body) {
        const corrected = normalizedContent({
          body: repairedBody,
          recipient: generated.draft.recipient ?? email.trim(),
          subject: generated.draft.subject,
        });
        try {
          nextDraft = await saveDraft({
            ...corrected,
            expectedRevision: generated.draft.revision,
          });
        } catch {
          const current = await getTotalLossMessageDraft(caseId, accessToken);
          if (
            current.reportVersionId !== generated.draft.reportVersionId ||
            !sameContent(contentOf(current), corrected)
          )
            throw new Error("The draft could not be saved.");
          nextDraft = current;
        }
        nextVersion = null;
      }
      setPreparedRevision(generated.workflowRevision);
      setPreparedVersion(nextVersion);
      setDraft(nextDraft);
    } catch {
      await props.onRefresh().catch(() => undefined);
      setError(
        "We couldn’t create your request draft. Your case is saved; try again.",
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  if (
    claim.journey?.nextState === "awaiting_insurer_response" ||
    claim.journey?.fulfillmentState === "awaiting_insurer_response" ||
    claim.workflow?.currentTask === "awaiting_insurer_response"
  )
    return <RequestRecorded {...props} />;
  const incomingDraft = creating ? null : claim.messageDraft;
  const selectedDraft =
    incomingDraft && (!draft || incomingDraft.revision > draft.revision)
      ? incomingDraft
      : draft;
  if (selectedDraft)
    return (
      <DraftEditor
        {...props}
        draft={selectedDraft}
        initialPreparedMessage={preparedVersion}
        key={selectedDraft.draftId}
        workflowRevision={Math.max(
          preparedRevision ?? 0,
          claim.workflow?.revision ?? 1,
        )}
      />
    );

  return (
    <form
      className="review-request"
      onInvalid={() => setAttempted(true)}
      onSubmit={(event) => void createDraft(event)}
    >
      <div className="review-request-form">
        <p className="review-eyebrow">Let’s put the evidence to work</p>
        <h1 className="review-heading">Prepare your request</h1>
        <p className="review-lead">
          We’ll help you ask your insurer to review the valuation in writing.
          First, check where the email should go.
        </p>
        {details ? (
          <>
            <dl className="review-request-facts">
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
              attempted={attempted}
              details={details}
              email={email}
              reference={reference}
              onEmail={setEmail}
              onReference={setReference}
              pending={creating}
            />
          </>
        ) : (
          <RequestError>
            Sending details are temporarily unavailable. Refresh this case
            before preparing a request.
          </RequestError>
        )}
        <p className="review-copy">
          You’ll be able to edit the entire email. Nothing is sent until you
          send it from your own email account.
        </p>
        <details className="review-disclosure">
          <summary>The evidence you’ll attach</summary>
          <p className="review-copy">
            The PDF includes the valuation comparison, selected listings, and
            the review’s limitations.
          </p>
          <ReportFileRow
            accessToken={accessToken}
            caseId={caseId}
            report={report}
            userId={userId}
          />
        </details>
      </div>
      <footer
        className="review-actions review-request-actions"
        aria-label="Request actions"
      >
        <div className="review-action-feedback">
          <p className="case-status" id="request-creation-acknowledgement">
            Creating a draft confirms you’ve reviewed the completed result and
            are ready to prepare your request.
          </p>
          {error ? <RequestError>{error}</RequestError> : null}
        </div>
        <div className="review-action-buttons">
          {props.backTo ? (
            <Link className="case-button" data-variant="text" to={props.backTo}>
              Back
            </Link>
          ) : null}
          <button
            aria-describedby="request-creation-acknowledgement"
            className="case-button"
            data-variant="primary"
            disabled={creating || !details || !claim.workflow}
            type="submit"
          >
            {creating ? "Creating draft…" : "Create request draft"}
          </button>
        </div>
      </footer>
    </form>
  );
}
