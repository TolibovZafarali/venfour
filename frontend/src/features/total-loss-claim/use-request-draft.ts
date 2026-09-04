import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

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
import {
  acknowledgeRequestDraftProjection,
  clearRequestDraftRecovery,
  preserveRequestDraft,
  reconcileRequestDraft,
  recordRequestDraftFailure,
  requestDraftRecoveryKey,
  restoreRequestDraft,
} from "./request-draft-recovery";

const pendingDraftSaves = new Map<string, Promise<TotalLossMessageDraft>>();
const SAVE_ERROR = "We couldn’t save your changes. Your last saved draft is unchanged. Retry saving before sending.";
const CONFLICT_ERROR = "This draft changed in another tab. Load the saved draft to review those changes before editing again.";

interface RequestDraftOptions {
  readonly accessToken: string;
  readonly caseId: string;
  readonly draft: TotalLossMessageDraft;
  readonly initialPreparedMessage: TotalLossPreparedMessageVersion | null;
  readonly onRefresh: () => Promise<unknown>;
  readonly onSent?: () => void;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly workflowRevision: number;
  readonly followUpDraftId?: string;
}

export function useRequestDraft({
  accessToken,
  caseId,
  draft: initialDraft,
  onRefresh,
  onSent,
  report,
  userId,
  workflowRevision,
  followUpDraftId,
}: RequestDraftOptions) {
  const { mutateAsync: saveDraft } = useTotalLossMessageDraftMutation({
    accessToken,
    caseId,
    userId,
    followUpDraftId,
  });
  const { mutateAsync: prepare } = useTotalLossPrepareMessageMutation({
    accessToken,
    caseId,
    userId,
    followUpDraftId,
  });
  const { mutateAsync: recordOpened } = useTotalLossMessageOpenedMutation({
    accessToken,
    caseId,
    userId,
    followUpDraftId,
  });
  const { mutateAsync: recordSent } = useTotalLossMessageSentMutation({
    accessToken,
    caseId,
    userId,
    followUpDraftId,
  });
  const recoveryKey = requestDraftRecoveryKey({ userId, caseId, draft: initialDraft, followUpDraftId });
  const [recovery] = useState(() => restoreRequestDraft(recoveryKey, initialDraft, {
    ...contentOf(initialDraft),
    body: followUpDraftId ? initialDraft.body : normalizeCustomerRequestBody(initialDraft.body, report),
  }));
  const [content, setContent] = useState(recovery.content);
  const [savedContent, setSavedContent] = useState(() =>
    contentOf(recovery.baseline),
  );
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<"copy" | "open" | "sent" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(recovery.conflict ? CONFLICT_ERROR : recovery.failed ? SAVE_ERROR : null);
  const [conflict, setConflict] = useState(recovery.conflict);
  const [storageError, setStorageError] = useState(recovery.storageError);
  const [pendingRecovery, setPendingRecovery] = useState(Boolean(recovery.pendingContent));
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sharedMessage, setSharedMessage] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const contentRef = useRef(content);
  const savedRef = useRef(recovery.baseline);
  const projectedRevisionRef = useRef(initialDraft.revision);
  const pendingContentRef = useRef(recovery.pendingContent);
  const inFlightSave = useRef<Promise<TotalLossMessageDraft> | null>(null);
  const revisionRef = useRef(workflowRevision);
  const prepareRequestId = useRef(globalThis.crypto.randomUUID());
  const sentRequestId = useRef(globalThis.crypto.randomUUID());
  const actionRef = useRef(false);
  const mountedRef = useRef(true);
  const sentRef = useRef(false);
  const preservedRef = useRef(!recovery.storageError);
  const dirty = pendingRecovery || !sameContent(normalizedContent(content), savedContent);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !sentRef.current && !preservedRef.current &&
    (pendingContentRef.current !== null || !sameContent(normalizedContent(contentRef.current), contentOf(savedRef.current))) &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  const fieldErrors = {
    recipient:
      dirty && !EMAIL_PATTERN.test(content.recipient.trim())
        ? "Enter a valid recipient email address."
        : null,
    subject: dirty && !content.subject.trim() ? "Add an email subject." : null,
    body: dirty && !content.body.trim() ? "Add an email message." : null,
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    revisionRef.current = Math.max(revisionRef.current, workflowRevision);
  }, [workflowRevision]);

  const preserve = useCallback((failed: boolean) => {
    const stored = preserveRequestDraft(
      recoveryKey,
      contentRef.current,
      savedRef.current,
      failed,
      pendingContentRef.current,
      savedRef.current.revision > projectedRevisionRef.current,
    );
    preservedRef.current = stored;
    if (mountedRef.current) setStorageError(!stored);
  }, [recoveryKey]);

  const receiveSaved = useCallback((saved: TotalLossMessageDraft) => {
    if (saved.revision < savedRef.current.revision) return;
    savedRef.current = saved;
    pendingContentRef.current = null;
    if (mountedRef.current) {
      // An interrupted storage write may have left a snapshot behind the editor.
      preserve(false);
      setSavedContent(contentOf(saved));
      setSaveError(null);
      setConflict(false);
      setPendingRecovery(false);
    }
  }, [preserve]);

  useEffect(() => {
    const pending = pendingDraftSaves.get(recoveryKey);
    if (!pending) return;
    let active = true;
    void pending.then((saved) => {
      if (active) receiveSaved(saved);
    }, () => {
      if (active) setSaveError(SAVE_ERROR);
    });
    return () => { active = false; };
  }, [receiveSaved, recoveryKey]);

  useEffect(() => {
    projectedRevisionRef.current = Math.max(projectedRevisionRef.current, initialDraft.revision);
    acknowledgeRequestDraftProjection(recoveryKey, initialDraft);
    if (
      initialDraft.revision <= savedRef.current.revision ||
      inFlightSave.current || pendingDraftSaves.has(recoveryKey)
    )
      return;
    const incoming = contentOf(initialDraft);
    const local = normalizedContent(contentRef.current);
    const completesPending = pendingContentRef.current && sameContent(incoming, pendingContentRef.current);
    const hasLocalWork = pendingContentRef.current !== null || !sameContent(local, contentOf(savedRef.current));
    if (
      hasLocalWork && !sameContent(local, incoming) && !completesPending
    ) {
      setConflict(true);
      setSaveError(CONFLICT_ERROR);
      return;
    }
    const nextContent = completesPending && hasLocalWork ? contentRef.current : {
      ...incoming,
      body: followUpDraftId ? initialDraft.body : normalizeCustomerRequestBody(initialDraft.body, report),
    };
    reconcileRequestDraft(recoveryKey, savedRef.current, initialDraft);
    savedRef.current = initialDraft;
    pendingContentRef.current = null;
    contentRef.current = nextContent;
    prepareRequestId.current = globalThis.crypto.randomUUID();
    sentRequestId.current = globalThis.crypto.randomUUID();
    setSaveError(null);
    setConflict(false);
    setSavedContent(incoming);
    setPendingRecovery(false);
    setContent(nextContent);
    setSharedMessage(null);
    setNotice(null);
  }, [followUpDraftId, initialDraft, recoveryKey, report]);

  const persist = useCallback(async (): Promise<TotalLossMessageDraft> => {
    if (inFlightSave.current) return inFlightSave.current;
    const saveLatest = async () => {
      try {
        while (true) {
          const previousPending = pendingDraftSaves.get(recoveryKey);
          if (previousPending) receiveSaved(await previousPending);
          if (!mountedRef.current) return savedRef.current;
          const snapshot = contentRef.current;
          const normalized = normalizedContent(snapshot);
          const invalid = validationError(normalized);
          if (invalid) throw new Error(invalid);
          if (!pendingContentRef.current && sameContent(normalized, contentOf(savedRef.current))) {
            setSaveError(null);
            reconcileRequestDraft(recoveryKey, savedRef.current, savedRef.current);
            return savedRef.current;
          }
          setSaving(true);
          const previous = savedRef.current;
          pendingContentRef.current = normalized;
          setPendingRecovery(true);
          preserve(false);
          const pending = saveDraft({
            ...normalized,
            expectedRevision: previous.revision,
          });
          pendingDraftSaves.set(recoveryKey, pending);
          let saved: TotalLossMessageDraft;
          try {
            saved = await pending;
          } finally {
            if (pendingDraftSaves.get(recoveryKey) === pending) pendingDraftSaves.delete(recoveryKey);
          }
          const stored = reconcileRequestDraft(recoveryKey, previous, saved);
          preservedRef.current = stored;
          if (mountedRef.current) setStorageError(!stored);
          receiveSaved(saved);
          if (!mountedRef.current) return saved;
          if (sameContent(contentRef.current, snapshot)) {
            contentRef.current = contentOf(saved);
            setContent(contentOf(saved));
          }
        }
      } catch {
        const message =
          validationError(contentRef.current) ??
          SAVE_ERROR;
        recordRequestDraftFailure(recoveryKey, savedRef.current);
        if (mountedRef.current) setSaveError(message);
        throw new Error(message);
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    };
    const pending = saveLatest();
    inFlightSave.current = pending;
    try {
      return await pending;
    } finally {
      inFlightSave.current = null;
    }
  }, [preserve, receiveSaved, recoveryKey, saveDraft]);

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
        sentRef.current ||
        (!pendingContentRef.current && sameContent(
          normalizedContent(contentRef.current),
          contentOf(savedRef.current),
        ))
      )
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => {
      window.removeEventListener("beforeunload", warnUnsaved);
    };
  }, []);

  const edit = (field: keyof DraftContent, value: string) => {
    const next = { ...contentRef.current, [field]: value };
    contentRef.current = next;
    preserve(Boolean(saveError));
    setContent(next);
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
      const current = followUpDraftId
        ? await getTotalLossMessageDraft(caseId, accessToken, undefined, followUpDraftId)
        : await getTotalLossMessageDraft(caseId, accessToken);
      const currentContent = contentOf(current);
      const matchesLocal = sameContent(
        currentContent,
        normalizedContent(contentRef.current),
      );
      const matchesBaseline = sameContent(
        currentContent,
        contentOf(savedRef.current),
      );
      const matchesPending = pendingContentRef.current && sameContent(currentContent, pendingContentRef.current);
      if (!loadSaved && !matchesLocal && !matchesBaseline && !matchesPending) {
        setConflict(true);
        setSaveError(CONFLICT_ERROR);
        return;
      }
      const needsFence = pendingContentRef.current !== null && current.revision <= savedRef.current.revision;
      if (!needsFence) pendingContentRef.current = null;
      setPendingRecovery(needsFence);
      savedRef.current = current;
      setSavedContent(currentContent);
      setSaveError(null);
      setConflict(false);
      if (loadSaved || matchesLocal) {
        const displayContent = {
          ...currentContent,
          body: followUpDraftId ? current.body : normalizeCustomerRequestBody(current.body, report),
        };
        contentRef.current = displayContent;
        setContent(displayContent);
        prepareRequestId.current = globalThis.crypto.randomUUID();
        sentRequestId.current = globalThis.crypto.randomUUID();
        setSharedMessage(null);
        preserve(false);
        if (needsFence) await persist();
      } else {
        preserve(false);
        await persist();
      }
    } catch {
      setSaveError("We couldn’t save your changes. Try again before sending.");
      recordRequestDraftFailure(recoveryKey, savedRef.current);
    } finally {
      setSaving(false);
    }
  };

  const prepareExact = async () => {
    const saved = await persist();
    const prepared = await prepare({
      clientRequestId: prepareRequestId.current,
      expectedWorkflowRevision: revisionRef.current,
      ...(followUpDraftId ? { expectedDraftRevision: saved.revision } : {}),
    });
    revisionRef.current = Math.max(
      revisionRef.current,
      prepared.workflowRevision,
    );
    if (
      prepared.draft.draftId !== saved.draftId ||
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
    return prepared.messageVersion;
  };

  const shareEmail = async (kind: "copy" | "open") => {
    if (actionRef.current || conflict) return;
    actionRef.current = true;
    setAction(kind);
    setError(null);
    setNotice(null);
    setSharedMessage(null);
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
      sentRef.current = true;
      clearRequestDraftRecovery(recoveryKey);
      setSent(true);
      await onRefresh().catch(() => undefined);
      if (mountedRef.current) onSent?.();
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
    blocker,
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
    restored: recovery.restored,
    saveError,
    saving,
    sent,
    shareEmail,
    sharedMessage,
    storageError,
  };
}
