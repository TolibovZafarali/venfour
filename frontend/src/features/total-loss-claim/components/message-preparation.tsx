import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Mail,
  Send,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  buildTotalLossMailto,
  copyPreparedEmail,
  openDefaultEmailApp,
} from "@/features/total-loss-claim/browser-actions";
import {
  GuidedClaimShell,
  WorkflowError,
} from "@/features/total-loss-claim/components/claim-workflow-shell";
import { PublishedReportActions } from "@/features/total-loss-claim/components/published-report-actions";
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
import { totalLossClaimViewPath } from "@/features/total-loss-claim/workflow-route";

function requestId() {
  return globalThis.crypto.randomUUID();
}

function SendingDetailsForm({
  accessToken,
  caseId,
  claim,
  details,
  onRefresh,
  userId,
}: MessagePreparationProps & {
  readonly details: TotalLossSendingDetails;
}) {
  const save = useTotalLossSendingDetailsMutation({ accessToken, caseId, userId });
  const [adjusterEmail, setAdjusterEmail] = useState(details.adjusterEmail ?? "");
  const [claimReference, setClaimReference] = useState(
    details.claimReference ?? "",
  );
  const [confirmEmail, setConfirmEmail] = useState(
    details.adjusterEmailConfirmed,
  );
  const [confirmReference, setConfirmReference] = useState(
    details.claimReferenceConfirmed,
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!claim.workflow) return;
    if (!adjusterEmail.trim() || !/^\S+@\S+\.\S+$/u.test(adjusterEmail.trim())) {
      setError("Enter the adjuster’s valid email address.");
      return;
    }
    if (!claimReference.trim()) {
      setError("Enter the claim or reference number.");
      return;
    }
    if (!confirmEmail || !confirmReference) {
      setError("Confirm both sending details before preparing the request.");
      return;
    }
    try {
      await save.mutateAsync({
        adjusterName: details.adjusterName,
        adjusterEmail: adjusterEmail.trim(),
        adjusterEmailConfirmed: true,
        claimReference: claimReference.trim(),
        claimReferenceConfirmed: true,
        expectedRevision: details.revision,
        expectedWorkflowRevision: claim.workflow.revision,
      });
      await onRefresh();
    } catch {
      setError(
        "We couldn’t save these details. The case may have changed in another tab; refresh and try again.",
      );
    }
  };

  return (
    <form className="max-w-2xl" onSubmit={(event) => void submit(event)}>
      <div className="rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Confirm sending details</h2>
        <p className="mt-2 text-sm leading-6 text-copy">
          Venfour uses already-confirmed case facts. Only the missing or
          unconfirmed sending details below can be changed here.
        </p>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-copy">Customer</dt>
            <dd className="mt-1 text-ink">{details.customerName ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-copy">Insurer</dt>
            <dd className="mt-1 text-ink">{details.insurerName ?? "Not available"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-medium text-copy">Subject vehicle</dt>
            <dd className="mt-1 text-ink">{details.vehicleDescription ?? "Not available"}</dd>
          </div>
        </dl>
        <div className="mt-6 grid gap-5">
          <label className="grid gap-2 text-sm font-medium text-ink">
            Adjuster email
            <input
              autoComplete="email"
              className="min-h-12 w-full rounded-xl border border-line bg-white px-4 py-3 text-base font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              onChange={(event) => {
                setAdjusterEmail(event.target.value);
                setConfirmEmail(false);
              }}
              type="email"
              value={adjusterEmail}
            />
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-copy">
            <input
              checked={confirmEmail}
              className="mt-1 size-5 shrink-0 accent-brand"
              onChange={(event) => setConfirmEmail(event.target.checked)}
              type="checkbox"
            />
            I confirmed this is the adjuster email that should receive the request.
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">
            Claim or reference number
            <input
              className="min-h-12 w-full rounded-xl border border-line bg-white px-4 py-3 text-base font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              onChange={(event) => {
                setClaimReference(event.target.value);
                setConfirmReference(false);
              }}
              value={claimReference}
            />
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-copy">
            <input
              checked={confirmReference}
              className="mt-1 size-5 shrink-0 accent-brand"
              onChange={(event) => setConfirmReference(event.target.checked)}
              type="checkbox"
            />
            I confirmed this claim or reference number is correct.
          </label>
        </div>
      </div>
      {error ? <WorkflowError>{error}</WorkflowError> : null}
      <Button className="mt-6 min-h-12" disabled={save.isPending} type="submit">
        {save.isPending ? "Saving details…" : "Save and prepare request"}
      </Button>
    </form>
  );
}

function SentConfirmationDialog({
  onConfirm,
  onOpenChange,
  open,
  pending,
}: {
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly pending: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setConfirmed(false);
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/35 backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[71] max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/80 bg-white p-6 shadow-[0_28px_80px_-28px_rgba(11,31,51,0.58)] focus:outline-none">
          <div className="pr-10">
            <Dialog.Title className="text-xl font-semibold tracking-[-0.025em] text-ink">
              Confirm that you sent the request
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-copy">
              Opening an email app does not tell Venfour whether an email was sent.
              Confirm only after sending it yourself.
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button
              aria-label="Close sent confirmation"
              className="absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-lg text-copy outline-none transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none"
              type="button"
            >
              <X className="size-4" aria-hidden />
            </button>
          </Dialog.Close>
          <label className="mt-6 flex min-h-12 items-start gap-3 rounded-xl border border-line bg-surface/60 p-4 text-sm leading-6 text-ink">
            <input
              checked={confirmed}
              className="mt-1 size-5 shrink-0 accent-brand"
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            I sent the email to my insurer and attached the Venfour report.
          </label>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              disabled={!confirmed || pending}
              onClick={onConfirm}
              type="button"
            >
              {pending ? "Recording…" : "Confirm I sent it"}
            </Button>
            <Dialog.Close asChild>
              <Button type="button" variant="outline">
                Not yet
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RequestRecorded({
  accessToken,
  caseId,
  report,
  userId,
}: Omit<MessagePreparationProps, "claim" | "onRefresh">) {
  return (
    <div>
      <div className="flex gap-3 rounded-2xl border border-green-200 bg-green-50 p-5 text-green-950">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold">Your request is recorded</h2>
          <p className="mt-2 text-sm leading-6">
            Venfour recorded that you reported sending the request. Venfour
            cannot verify email delivery or receipt by the insurer.
          </p>
        </div>
      </div>
      <p className="mt-6 max-w-3xl text-sm leading-6 text-copy">
        Save any insurer response, requested document list, or revised valuation.
        A later milestone will let you provide that response for analysis.
      </p>
      <div className="mt-6">
        <PublishedReportActions
          accessToken={accessToken}
          caseId={caseId}
          report={report}
          userId={userId}
        />
      </div>
    </div>
  );
}

function DraftEditor({
  accessToken,
  caseId,
  draft: initialDraft,
  initialPreparedMessage,
  onRefresh,
  report,
  userId,
  workflowRevision,
}: MessagePreparationProps & {
  readonly draft: TotalLossMessageDraft;
  readonly initialPreparedMessage?: TotalLossPreparedMessageVersion | null;
  readonly workflowRevision: number;
}) {
  const saveDraft = useTotalLossMessageDraftMutation({
    accessToken,
    caseId,
    userId,
  });
  const prepare = useTotalLossPrepareMessageMutation({
    accessToken,
    caseId,
    userId,
  });
  const opened = useTotalLossMessageOpenedMutation({
    accessToken,
    caseId,
    userId,
  });
  const sent = useTotalLossMessageSentMutation({ accessToken, caseId, userId });
  const [draft, setDraft] = useState(initialDraft);
  const [recipient, setRecipient] = useState(initialDraft.recipient ?? "");
  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [preparedMessage, setPreparedMessage] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmedPrepared, setConfirmedPrepared] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const preparedWorkflowRevision = useRef<number | null>(null);
  const prepareRequestId = useRef(requestId());
  const sentRequestId = useRef(requestId());
  const dirty =
    recipient !== (draft.recipient ?? "") ||
    subject !== draft.subject ||
    body !== draft.body;
  const matchesDraft = (candidate: TotalLossPreparedMessageVersion | null) =>
    Boolean(
      candidate &&
        candidate.reportVersionId === draft.reportVersionId &&
        candidate.recipient === (draft.recipient ?? "") &&
        candidate.subject === draft.subject &&
        candidate.body === draft.body,
    );
  const exactPreparedMessage = matchesDraft(preparedMessage)
    ? preparedMessage
    : matchesDraft(initialPreparedMessage ?? null)
      ? (initialPreparedMessage ?? null)
      : null;
  const latestWorkflowRevision = () =>
    Math.max(workflowRevision, preparedWorkflowRevision.current ?? 0);

  const edited = () => {
    setPreparedMessage(null);
    prepareRequestId.current = requestId();
    setNotice(null);
  };

  const validate = () => {
    if (!/^\S+@\S+\.\S+$/u.test(recipient.trim())) {
      throw new Error("Enter a valid recipient email address.");
    }
    if (!subject.trim()) throw new Error("Add an email subject.");
    if (!body.trim()) throw new Error("Add an email message.");
  };

  const persist = async () => {
    validate();
    if (!dirty) return draft;
    const saved = await saveDraft.mutateAsync({
      body: body.trim(),
      expectedRevision: draft.revision,
      recipient: recipient.trim(),
      subject: subject.trim(),
    });
    setDraft(saved);
    setRecipient(saved.recipient ?? "");
    setSubject(saved.subject);
    setBody(saved.body);
    return saved;
  };

  const prepareExact = async () => {
    if (exactPreparedMessage && !dirty) return exactPreparedMessage;
    await persist();
    const prepared = await prepare.mutateAsync({
      clientRequestId: prepareRequestId.current,
      expectedWorkflowRevision: latestWorkflowRevision(),
    });
    setDraft(prepared.draft);
    setPreparedMessage(prepared.messageVersion);
    preparedWorkflowRevision.current = prepared.workflowRevision;
    return prepared.messageVersion;
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    try {
      await persist();
      setNotice("Draft saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "We couldn’t save this draft.",
      );
    }
  };

  const copyEmail = async () => {
    setError(null);
    setNotice(null);
    try {
      const exact = await prepareExact();
      await copyPreparedEmail(exact);
      setNotice(
        "Email copied. Attach the Venfour report yourself before sending.",
      );
    } catch (copyError) {
      setError(
        copyError instanceof Error
          ? copyError.message
          : "We couldn’t copy the email.",
      );
    }
  };

  const openEmail = async () => {
    setError(null);
    setNotice(null);
    try {
      const exact = await prepareExact();
      openDefaultEmailApp(buildTotalLossMailto(exact));
      void opened
        .mutateAsync({
          clientRequestId: requestId(),
          messageVersionId: exact.messageVersionId,
        })
        .catch(() => undefined);
      setNotice(
        "Email app opened. Venfour has not marked the request sent. Attach the report before sending.",
      );
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "We couldn’t open the default email app. You can copy the email instead.",
      );
    }
  };

  const askToConfirm = async () => {
    setError(null);
    try {
      const exact = await prepareExact();
      setConfirmedPrepared(exact);
      setDialogOpen(true);
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "We couldn’t prepare the exact message for confirmation.",
      );
    }
  };

  const confirmSent = async () => {
    if (!confirmedPrepared || sent.isPending) return;
    setError(null);
    try {
      await sent.mutateAsync({
        clientRequestId: sentRequestId.current,
        expectedWorkflowRevision: latestWorkflowRevision(),
        messageVersionId: confirmedPrepared.messageVersionId,
      });
      setDialogOpen(false);
      await onRefresh();
    } catch {
      await onRefresh().catch(() => undefined);
      setError(
        "We couldn’t record the confirmation. Your exact prepared message remains saved; try again without creating a duplicate.",
      );
    }
  };

  if (sent.data?.state === "awaiting_insurer_response") {
    return (
      <RequestRecorded
        accessToken={accessToken}
        caseId={caseId}
        report={report}
        userId={userId}
      />
    );
  }

  return (
    <div>
      <div className="grid gap-5">
        <label className="grid gap-2 text-sm font-medium text-ink">
          Recipient
          <input
            className="min-h-12 w-full rounded-xl border border-line bg-white px-4 py-3 text-base font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            onChange={(event) => {
              setRecipient(event.target.value);
              edited();
            }}
            type="email"
            value={recipient}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-ink">
          Subject
          <input
            className="min-h-12 w-full rounded-xl border border-line bg-white px-4 py-3 text-base font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            onChange={(event) => {
              setSubject(event.target.value);
              edited();
            }}
            value={subject}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-ink">
          Message
          <textarea
            className="min-h-64 w-full resize-y rounded-xl border border-line bg-white px-4 py-3 text-base leading-7 font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            onChange={(event) => {
              setBody(event.target.value);
              edited();
            }}
            value={body}
          />
        </label>
      </div>

      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <Download className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden />
          <div>
            <h2 className="font-semibold text-amber-950">Attach the report yourself</h2>
            <p className="mt-2 break-words text-sm leading-6 text-amber-900">
              Attach <strong>{report.suggestedFilename}</strong> before sending.
              The email app link cannot attach the PDF automatically.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <PublishedReportActions
            accessToken={accessToken}
            caseId={caseId}
            report={report}
            userId={userId}
          />
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button
          className="min-h-12"
          disabled={saveDraft.isPending || prepare.isPending}
          onClick={() => void save()}
          type="button"
          variant="outline"
        >
          Save changes
        </Button>
        <Button
          className="min-h-12"
          disabled={saveDraft.isPending || prepare.isPending}
          onClick={() => void copyEmail()}
          type="button"
          variant="outline"
        >
          <Copy className="size-4" aria-hidden />
          Copy email
        </Button>
        <Button
          className="min-h-12"
          disabled={saveDraft.isPending || prepare.isPending}
          onClick={() => void openEmail()}
          type="button"
        >
          <Mail className="size-4" aria-hidden />
          Open default email app
        </Button>
        <Button
          className="min-h-12"
          disabled={saveDraft.isPending || prepare.isPending || sent.isPending}
          onClick={() => void askToConfirm()}
          type="button"
          variant="secondary"
        >
          <Send className="size-4" aria-hidden />
          I sent it
        </Button>
      </div>
      <p className="mt-4 text-sm leading-6 text-copy">
        Copying or opening the email does not mark it sent, delivered, or
        received. Use “I sent it” only after sending the email and attaching the
        report.
      </p>
      {notice ? (
        <p className="mt-4 rounded-xl border border-brand/15 bg-brand-soft/55 px-4 py-3 text-sm leading-6 text-ink" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <WorkflowError>{error}</WorkflowError> : null}
      <SentConfirmationDialog
        onConfirm={() => void confirmSent()}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        pending={sent.isPending}
      />
    </div>
  );
}

interface MessagePreparationProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
}

export function MessagePreparation(props: MessagePreparationProps) {
  const { accessToken, caseId, claim, report, userId } = props;
  const navigate = useNavigate();
  const education = useTotalLossEducationProgressMutation({
    accessToken,
    caseId,
    userId,
  });
  const viewed = useRef(false);
  const prepare = useTotalLossPrepareMessageMutation({
    accessToken,
    caseId,
    userId,
  });
  const createDraftRequestId = useRef(requestId());
  const [preparedDraft, setPreparedDraft] = useState<TotalLossMessageDraft | null>(
    claim.messageDraft ?? null,
  );
  const [preparedWorkflowRevision, setPreparedWorkflowRevision] = useState<
    number | null
  >(null);
  const [preparedVersion, setPreparedVersion] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (viewed.current || claim.education?.steps.send.viewedAt || !claim.workflow) {
      return;
    }
    viewed.current = true;
    void education
      .mutateAsync({
        expectedWorkflowRevision: claim.workflow.revision,
        state: "viewed",
        step: "send",
      })
      .catch(() => undefined);
  }, [claim.education, claim.workflow, education]);

  const details = claim.sendingDetails;
  const detailsReady = Boolean(
    details?.adjusterEmail &&
      details.adjusterEmailConfirmed &&
      details.claimReference &&
      details.claimReferenceConfirmed,
  );
  const awaiting = claim.journey?.nextState === "awaiting_insurer_response";

  const createDraft = async () => {
    if (!claim.workflow) return;
    setError(null);
    try {
      const result = await prepare.mutateAsync({
        clientRequestId: createDraftRequestId.current,
        expectedWorkflowRevision: claim.workflow.revision,
      });
      setPreparedDraft(result.draft);
      setPreparedVersion(result.messageVersion);
      setPreparedWorkflowRevision(result.workflowRevision);
    } catch {
      setError(
        "We couldn’t prepare the deterministic request draft. Refresh the authoritative case state and try again.",
      );
    }
  };

  const selectedDraft = preparedDraft ?? claim.messageDraft;
  const selectedWorkflowRevision =
    preparedWorkflowRevision ?? claim.workflow?.revision ?? null;

  return (
    <GuidedClaimShell
      caseId={caseId}
      description="Review and edit the deterministic, evidence-focused request before using your own email app. Venfour does not send the email for you."
      education={claim.education ?? null}
      eyebrow="Step 6 of 6 · Required"
      heading="Review your valuation reconsideration request"
      view="send"
    >
      {awaiting ? (
        <RequestRecorded
          accessToken={accessToken}
          caseId={caseId}
          report={report}
          userId={userId}
        />
      ) : !details ? (
        <WorkflowError>
          Sending details are temporarily unavailable. Refresh this case before
          preparing a request.
        </WorkflowError>
      ) : !detailsReady ? (
        <SendingDetailsForm {...props} details={details} />
      ) : selectedDraft && selectedWorkflowRevision !== null ? (
        <DraftEditor
          {...props}
          draft={selectedDraft}
          initialPreparedMessage={preparedVersion}
          key={selectedDraft.draftId}
          workflowRevision={selectedWorkflowRevision}
        />
      ) : (
        <div>
          <div className="rounded-2xl border border-line bg-surface/60 p-5 text-sm leading-6 text-copy">
            Venfour will generate a concise neutral baseline from the confirmed
            case facts and published report. The template is deterministic and
            does not use a provider-backed writing service.
          </div>
          <Button
            className="mt-6 min-h-12"
            disabled={prepare.isPending}
            onClick={() => void createDraft()}
            type="button"
          >
            {prepare.isPending ? "Preparing request…" : "Prepare request draft"}
          </Button>
          {error ? <WorkflowError>{error}</WorkflowError> : null}
        </div>
      )}
      {!awaiting ? (
        <Button
          className="mt-7"
          onClick={() => void navigate(totalLossClaimViewPath(caseId, "what_next"))}
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
      ) : null}
    </GuidedClaimShell>
  );
}
