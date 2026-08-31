import { useCallback, useEffect, useRef, useState } from "react";

import { getTotalLossMessageDraft } from "@/features/total-loss-claim/api";
import {
  buildTotalLossMailto,
  copyPreparedEmail,
  openDefaultEmailApp,
} from "@/features/total-loss-claim/browser-actions";
import type {
  TotalLossMessageDraft,
  TotalLossPreparedMessageVersion,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import { normalizeCustomerRequestBody } from "@/features/total-loss-claim/customer-message-copy";
import {
  useTotalLossMessageDraftMutation,
  useTotalLossMessageOpenedMutation,
  useTotalLossMessageSentMutation,
  useTotalLossPrepareMessageMutation,
} from "@/features/total-loss-claim/queries";
import {
  contentOf,
  EMAIL_PATTERN,
  normalizedContent,
  sameContent,
  validationError,
} from "@/features/total-loss-claim/request-state";
import type { DraftContent } from "@/features/total-loss-claim/request-state";

interface RequestDraftOptions {
  readonly accessToken: string;
  readonly caseId: string;
  readonly draft: TotalLossMessageDraft;
  readonly initialPreparedMessage: TotalLossPreparedMessageVersion | null;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly workflowRevision: number;
}

export function useRequestDraft({
  accessToken,
  caseId,
  draft: initialDraft,
  initialPreparedMessage,
  onRefresh,
  report,
  userId,
  workflowRevision,
}: RequestDraftOptions) {
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
  const prepareRequestId = useRef(globalThis.crypto.randomUUID());
  const sentRequestId = useRef(globalThis.crypto.randomUUID());
  const actionRef = useRef(false);
  const dirty = !sameContent(normalizedContent(content), savedContent);
  const fieldErrors = {
    recipient:
      dirty && !EMAIL_PATTERN.test(content.recipient.trim())
        ? "Enter a valid recipient email address."
        : null,
    subject: dirty && !content.subject.trim() ? "Add an email subject." : null,
    body: dirty && !content.body.trim() ? "Add an email message." : null,
  };

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
    prepareRequestId.current = globalThis.crypto.randomUUID();
    sentRequestId.current = globalThis.crypto.randomUUID();
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
    prepareRequestId.current = globalThis.crypto.randomUUID();
    sentRequestId.current = globalThis.crypto.randomUUID();
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
        prepareRequestId.current = globalThis.crypto.randomUUID();
        sentRequestId.current = globalThis.crypto.randomUUID();
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
          clientRequestId: globalThis.crypto.randomUUID(),
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

  return {
    action,
    confirmSent,
    conflict,
    content,
    dirty,
    dismissSentConfirmation: () => setSharedMessage(null),
    edit,
    error,
    fieldErrors,
    invalid: validationError(content),
    notice,
    retrySave,
    saveError,
    saving,
    sent,
    shareEmail,
    sharedMessage,
  };
}
