import { AlertCircle, Cloud, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";

import { useAuth, useSignInDialog } from "@/features/auth";
import type { AppraisalCase } from "@/features/cases/types";
import {
  FlowCard,
  primaryFlowButtonClassName,
} from "@/features/total-loss/intake-fields";

import {
  diminishedValueDetailsToDraft,
  diminishedValueDraftToDetailsValues,
} from "./data-mappers";
import type { DiminishedValueCaseDetails } from "./data-types";
import { useDiminishedValueDependencies } from "./dependencies";
import { DiminishedValueIntakeFlow } from "./diminished-value-intake-flow";
import {
  clearDiminishedValueDraftEnvelope,
  createEmptyDiminishedValueDraftEnvelope,
  readDiminishedValueDraftEnvelope,
  writeDiminishedValueDraftEnvelope,
  type DiminishedValueDraftEnvelope,
  type DiminishedValuePendingAuthAction,
} from "./draft";
import { fileIdentity } from "./local-document-files";
import type { DiminishedValueStoredDocument } from "./storage-service";
import type { DiminishedValueDraft } from "./types";

const AUTOSAVE_DELAY_MS = 600;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface PendingDocument {
  readonly id: string;
  readonly file: File;
  readonly state: "queued" | "uploading" | "error";
  readonly error?: string;
}

interface InitialState {
  readonly envelope: DiminishedValueDraftEnvelope;
  readonly storageError: boolean;
}

interface DiminishedValueStartFlowProps {
  readonly onBusyChange?: (busy: boolean) => void;
}

export function DiminishedValueStartFlow({
  onBusyChange,
}: DiminishedValueStartFlowProps) {
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const dependencies = useDiminishedValueDependencies();
  const location = useLocation();
  const navigate = useNavigate();
  const [initialState] = useState(loadInitialState);
  const [envelope, setEnvelope] = useState(initialState.envelope);
  const envelopeRef = useRef(envelope);
  const [storageError, setStorageError] = useState(initialState.storageError);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [caseState, setCaseState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [caseStatus, setCaseStatus] = useState<
    AppraisalCase["status"] | null
  >(null);
  const [serverDetails, setServerDetails] =
    useState<DiminishedValueCaseDetails | null>(null);
  const [documents, setDocuments] = useState<
    readonly DiminishedValueStoredDocument[]
  >([]);
  const [pendingDocuments, setPendingDocuments] = useState<
    readonly PendingDocument[]
  >([]);
  const pendingDocumentsRef = useRef<readonly PendingDocument[]>(
    pendingDocuments,
  );
  const [flowError, setFlowError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingDocumentId, setRemovingDocumentId] = useState<string | null>(
    null,
  );

  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const identityRef = useRef({ generation: 0, userId });
  const explicitCaseId = useMemo(
    () => new URLSearchParams(location.search).get("caseId"),
    [location.search],
  );
  const invalidExplicitCaseId = Boolean(
    explicitCaseId && !UUID_PATTERN.test(explicitCaseId),
  );
  const returnTo = `${location.pathname}${location.search}`;
  const ownerDraftIdentityUnverified = Boolean(
    envelope.ownerUserId &&
      (auth.status === "loading" || envelope.ownerUserId !== userId),
  );
  const renderedDraft: DiminishedValueDraft = serverDetails?.submittedAt
    ? { ...envelope.intake, step: "complete" }
    : envelope.intake;

  const caseCreationRef = useRef<Promise<AppraisalCase> | null>(null);
  const saveChainRef = useRef<Promise<DiminishedValueCaseDetails> | null>(null);
  const uploadLoopRef = useRef<Promise<void> | null>(null);
  const loadedCaseRef = useRef<string | null>(null);
  const recentLookupRef = useRef<string | null>(null);
  const pendingAuthHandledRef = useRef<string | null>(null);
  const submissionAttemptCaseRef = useRef<string | null>(null);

  const applyEnvelope = useCallback(
    (
      update: (
        current: DiminishedValueDraftEnvelope,
      ) => DiminishedValueDraftEnvelope,
      options: { persist?: boolean } = {},
    ) => {
      const next = update(envelopeRef.current);
      envelopeRef.current = next;
      setEnvelope(next);
      if (options.persist === false) return true;
      const result = writeDiminishedValueDraftEnvelope(next);
      setStorageError(!result.ok);
      return result.ok;
    },
    [],
  );

  const updatePendingDocuments = useCallback(
    (
      update: (
        current: readonly PendingDocument[],
      ) => readonly PendingDocument[],
    ) => {
      const next = update(pendingDocumentsRef.current);
      pendingDocumentsRef.current = next;
      setPendingDocuments(next);
      return next;
    },
    [],
  );

  const navigateToCase = useCallback(
    (caseId: string) => {
      const params = new URLSearchParams(location.search);
      if (params.get("caseId") === caseId) return;
      params.set("service", "diminished-value");
      params.set("caseId", caseId);
      void navigate(
        { pathname: location.pathname, search: `?${params.toString()}` },
        { replace: true, preventScrollReset: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const ensureCase = useCallback(async () => {
    if (!userId || !dependencies) {
      throw new Error("Sign in before securely saving this review request.");
    }
    const current = envelopeRef.current;
    if (current.confirmedCaseId && current.ownerUserId === userId) {
      return current.confirmedCaseId;
    }
    if (caseCreationRef.current) {
      return (await caseCreationRef.current).id;
    }

    const generation = identityRef.current.generation;
    let reservedCaseId = current.reservedCaseId;
    if (!reservedCaseId) {
      reservedCaseId = crypto.randomUUID();
    }
    const reservationPersisted = applyEnvelope((value) => ({
      ...value,
      reservedCaseId,
      ownerUserId: userId,
      lastUpdatedAt: new Date().toISOString(),
    }));
    if (!reservationPersisted) {
      throw new Error(
        "This browser could not retain the secure case identifier. Check browser storage and try again.",
      );
    }

    const operation = dependencies.appraisalCaseService
      .createOrGetAppraisalCase({
        caseId: reservedCaseId,
        serviceType: "diminished_value",
        userId,
      })
      .then((appraisalCase) => {
        if (
          identityRef.current.generation !== generation ||
          userIdRef.current !== userId
        ) {
          throw new StaleDiminishedValueIdentityError();
        }
        applyEnvelope((value) => ({
          ...value,
          confirmedCaseId: appraisalCase.id,
          reservedCaseId: appraisalCase.id,
          ownerUserId: userId,
          lastUpdatedAt: new Date().toISOString(),
        }));
        setCaseStatus(appraisalCase.status);
        navigateToCase(appraisalCase.id);
        return appraisalCase;
      });

    caseCreationRef.current = operation;
    try {
      return (await operation).id;
    } finally {
      if (caseCreationRef.current === operation) {
        caseCreationRef.current = null;
      }
    }
  }, [applyEnvelope, dependencies, navigateToCase, userId]);

  const loadCase = useCallback(
    async (caseId: string, replaceLocal: boolean) => {
      if (!userId || !dependencies) return;
      const loadKey = `${identityRef.current.generation}:${userId}:${caseId}`;
      if (loadedCaseRef.current === loadKey) return;
      loadedCaseRef.current = loadKey;
      setCaseState("loading");
      setFlowError(null);

      try {
        const appraisalCase =
          await dependencies.appraisalCaseService.getAppraisalCase({
            caseId,
            userId,
          });
        if (
          !appraisalCase ||
          appraisalCase.serviceType !== "diminished_value" ||
          (appraisalCase.status !== "draft" &&
            appraisalCase.status !== "submitted")
        ) {
          throw new Error(
            "We couldn’t open that diminished-value case for this account.",
          );
        }

        const [details, storedDocuments] = await Promise.all([
          dependencies.diminishedValueDetailsService.getDetails({
            caseId,
            userId,
          }),
          dependencies.diminishedValueDocumentStorageService.listDocuments({
            caseId,
            userId,
          }),
        ]);
        if (appraisalCase.status === "submitted" && !details?.submittedAt) {
          throw new Error(
            "Venfour could not verify the submitted state for this request.",
          );
        }

        if (
          loadedCaseRef.current !== loadKey ||
          userIdRef.current !== userId
        ) {
          return;
        }

        const current = envelopeRef.current;
        if (
          current.confirmedCaseId &&
          current.confirmedCaseId !== caseId
        ) {
          submissionAttemptCaseRef.current = null;
          updatePendingDocuments(() => []);
          setDocuments([]);
          setServerDetails(null);
        }
        const preserveDirtyLocal = Boolean(
          details &&
            !replaceLocal &&
            current.dirty &&
            current.confirmedCaseId === caseId,
        );
        const baseServerRevision = preserveDirtyLocal
          ? current.serverRevision
          : (details?.revision ?? null);
        applyEnvelope(
          (value) => ({
            ...value,
            intake:
              details &&
              !preserveDirtyLocal
                ? editableDraftFromDetails(details)
                : value.intake,
            confirmedCaseId: caseId,
            reservedCaseId: caseId,
            ownerUserId: userId,
            pendingAuthAction:
              appraisalCase.status === "submitted"
                ? null
                : value.pendingAuthAction,
            dirty:
              details && !preserveDirtyLocal
                ? false
                : value.dirty,
            serverRevision: baseServerRevision,
            lastUpdatedAt: new Date().toISOString(),
          }),
          { persist: appraisalCase.status !== "submitted" },
        );
        setServerDetails(details);
        setDocuments(storedDocuments);
        setCaseStatus(appraisalCase.status);
        setCaseState("ready");
        if (appraisalCase.status === "submitted") {
          clearDiminishedValueDraftEnvelope();
        }
        navigateToCase(caseId);
      } catch (error) {
        loadedCaseRef.current = null;
        setCaseState("error");
        setFlowError(
          errorMessage(
            error,
            "We couldn’t load this diminished-value case. Try again.",
          ),
        );
      }
    },
    [
      applyEnvelope,
      dependencies,
      navigateToCase,
      updatePendingDocuments,
      userId,
    ],
  );

  const persistCurrentDraft = useCallback(
    async (force = false) => {
      if (!dependencies || !userId) {
        throw new Error("Sign in before securely saving this review request.");
      }
      const current = envelopeRef.current;
      if (!force && !current.dirty) {
        if (saveChainRef.current) return saveChainRef.current;
        if (serverDetails) return serverDetails;
      }
      if (!force && !hasMeaningfulDiminishedValueDraft(current.intake)) {
        return serverDetails;
      }

      const run = async () => {
        const snapshot = envelopeRef.current;
        const caseId = await ensureCase();
        const generation = identityRef.current.generation;
        setSaveState("saving");
        const details = await dependencies.diminishedValueDetailsService.saveDetails({
          caseId,
          userId,
          expectedRevision: snapshot.serverRevision,
          values: diminishedValueDraftToDetailsValues(snapshot.intake),
        });
        if (
          identityRef.current.generation !== generation ||
          userIdRef.current !== userId ||
          envelopeRef.current.confirmedCaseId !== caseId
        ) {
          throw new StaleDiminishedValueIdentityError();
        }
        setServerDetails(details);
        setSaveState("saved");
        setFlowError(null);
        applyEnvelope((value) => ({
          ...value,
          dirty:
            value.revision === snapshot.revision ? false : value.dirty,
          serverRevision: details.revision,
          lastUpdatedAt: new Date().toISOString(),
        }));
        return details;
      };

      const operation = (saveChainRef.current ?? Promise.resolve(null))
        .catch(() => null)
        .then(run);
      saveChainRef.current = operation;
      try {
        return await operation;
      } catch (error) {
        if (!(error instanceof StaleDiminishedValueIdentityError)) {
          setSaveState("error");
          setFlowError(
            errorMessage(
              error,
              "We couldn’t save your diminished-value information.",
            ),
          );
        }
        throw error;
      } finally {
        if (saveChainRef.current === operation) saveChainRef.current = null;
      }
    }, [
      applyEnvelope,
      dependencies,
      ensureCase,
      serverDetails,
      userId,
    ],
  );

  const refreshDocuments = useCallback(
    async (caseId: string) => {
      if (!dependencies || !userId) return;
      const stored =
        await dependencies.diminishedValueDocumentStorageService.listDocuments({
          caseId,
          userId,
        });
      if (envelopeRef.current.confirmedCaseId === caseId) {
        setDocuments(stored);
      }
    },
    [dependencies, userId],
  );

  const processPendingDocuments = useCallback(async () => {
    if (!dependencies || !userId) return;
    if (uploadLoopRef.current) return uploadLoopRef.current;
    if (
      !pendingDocumentsRef.current.some(
        (document) => document.state === "queued",
      )
    ) {
      if (
        pendingDocumentsRef.current.some(
          (document) => document.state === "error",
        )
      ) {
        throw new Error(
          "Retry or remove documents that did not finish uploading.",
        );
      }
      return;
    }

    const generation = identityRef.current.generation;
    const loop = (async () => {
      const caseId = await ensureCase();
      while (true) {
        const queued = pendingDocumentsRef.current.filter(
          (document) => document.state === "queued",
        );
        if (queued.length === 0) {
          await refreshDocuments(caseId);
          if (
            pendingDocumentsRef.current.some(
              (document) => document.state === "error",
            )
          ) {
            throw new Error(
              "Retry or remove documents that did not finish uploading.",
            );
          }
          return;
        }

        for (const pending of queued) {
          const current = pendingDocumentsRef.current.find(
            (document) => document.id === pending.id,
          );
          if (current?.state !== "queued") continue;

          updatePendingDocuments((documents) =>
            documents.map((document) =>
              document.id === pending.id
                ? { ...document, state: "uploading", error: undefined }
                : document,
            ),
          );
          try {
            const stored =
              await dependencies.diminishedValueDocumentStorageService.uploadDocument(
                {
                  userId,
                  caseId,
                  documentId: pending.id,
                  file: pending.file,
                },
              );
            if (
              identityRef.current.generation !== generation ||
              userIdRef.current !== userId
            ) {
              throw new StaleDiminishedValueIdentityError();
            }
            if (envelopeRef.current.confirmedCaseId === caseId) {
              setDocuments((documents) => [
                ...documents.filter((document) => document.id !== stored.id),
                stored,
              ]);
            }
            updatePendingDocuments((documents) =>
              documents.filter((document) => document.id !== pending.id),
            );
            setFlowError(null);
          } catch (error) {
            if (
              error instanceof StaleDiminishedValueIdentityError ||
              identityRef.current.generation !== generation ||
              userIdRef.current !== userId
            ) {
              throw new StaleDiminishedValueIdentityError();
            }
            updatePendingDocuments((documents) =>
              documents.map((document) =>
                document.id === pending.id
                  ? {
                      ...document,
                      state: "error",
                      error: errorMessage(
                        error,
                        "This document could not be uploaded.",
                      ),
                    }
                  : document,
              ),
            );
          }
        }
      }
    })();
    uploadLoopRef.current = loop;
    try {
      await loop;
    } finally {
      if (uploadLoopRef.current === loop) uploadLoopRef.current = null;
    }
  }, [
    dependencies,
    ensureCase,
    refreshDocuments,
    updatePendingDocuments,
    userId,
  ]);

  const prepareAuthentication = useCallback(
    (pendingAction: DiminishedValuePendingAuthAction) => {
      const persisted = applyEnvelope((current) => {
        const reservedCaseId =
          current.reservedCaseId ?? crypto.randomUUID();
        const next = {
          ...current,
          reservedCaseId,
          pendingAuthAction: pendingAction,
          lastUpdatedAt: new Date().toISOString(),
        };
        return next;
      });
      if (!persisted) {
        setFlowError(
          "This browser could not retain your intake for sign-in. Check browser storage and try again.",
        );
        return;
      }
      openSignIn({
        returnTo,
        intent: "continue-diminished-value",
      });
    },
    [applyEnvelope, openSignIn, returnTo],
  );

  const submitAuthenticated = useCallback(async () => {
    if (!dependencies || !userId) return;
    setSubmitting(true);
    setSubmissionError(null);
    const generation = identityRef.current.generation;
    try {
      const retryCaseId = submissionAttemptCaseRef.current;
      let details: DiminishedValueCaseDetails | null = null;
      if (retryCaseId) {
        details = serverDetails;
        if (!details || details.caseId !== retryCaseId) {
          details =
            await dependencies.diminishedValueDetailsService.getDetails({
              caseId: retryCaseId,
              userId,
            });
        }
      } else {
        await processPendingDocuments();
        if (pendingDocumentsRef.current.length !== 0) {
          throw new Error(
            "Wait for every document to finish uploading, or retry or remove it, before submitting.",
          );
        }
        details = await persistCurrentDraft(true);
        await processPendingDocuments();
        if (pendingDocumentsRef.current.length !== 0) {
          throw new Error(
            "Wait for every document to finish uploading, or retry or remove it, before submitting.",
          );
        }
      }
      if (!details) {
        throw new Error("The diminished-value intake could not be saved.");
      }
      submissionAttemptCaseRef.current = details.caseId;
      const result =
        await dependencies.diminishedValueDetailsService.submitCase({
          caseId: details.caseId,
          userId,
        });
      const submittedDetails =
        await dependencies.diminishedValueDetailsService.getDetails({
          caseId: details.caseId,
          userId,
        });
      if (
        identityRef.current.generation !== generation ||
        userIdRef.current !== userId
      ) {
        throw new StaleDiminishedValueIdentityError();
      }
      if (
        !submittedDetails?.submittedAt ||
        submittedDetails.submittedAt !== result.submittedAt
      ) {
        throw new Error(
          "Venfour could not verify the submitted review request.",
        );
      }
      setServerDetails(submittedDetails);
      setCaseStatus("submitted");
      setSaveState("saved");
      applyEnvelope(
        (current) => ({
          ...current,
          pendingAuthAction: null,
          dirty: false,
          serverRevision: submittedDetails.revision,
        }),
        { persist: false },
      );
      await refreshDocuments(details.caseId);
      clearDiminishedValueDraftEnvelope();
    } catch (error) {
      setSubmissionError(
        errorMessage(
          error,
          "Venfour could not confirm your review request. Try again.",
        ),
      );
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, [
    applyEnvelope,
    dependencies,
    persistCurrentDraft,
    processPendingDocuments,
    refreshDocuments,
    serverDetails,
    userId,
  ]);

  const handleSubmit = useCallback(() => {
    if (!userId) {
      prepareAuthentication("submit-review");
      return;
    }
    void submitAuthenticated().catch(() => undefined);
  }, [prepareAuthentication, submitAuthenticated, userId]);

  const handleDraftChange = useCallback(
    (draft: DiminishedValueDraft) => {
      setSubmissionError(null);
      submissionAttemptCaseRef.current = null;
      applyEnvelope((current) => ({
        ...current,
        intake: draft.step === "complete" ? { ...draft, step: "consultation" } : draft,
        dirty: true,
        revision: current.revision + 1,
        lastUpdatedAt: new Date().toISOString(),
      }));
    },
    [applyEnvelope],
  );

  const handlePendingFilesChange = useCallback(
    (files: File[]) => {
      submissionAttemptCaseRef.current = null;
      updatePendingDocuments((current) => {
        const retained = current.filter((pending) =>
          files.includes(pending.file),
        );
        const additions = files
          .filter(
            (file) =>
              !retained.some((pending) => pending.file === file),
          )
          .map((file) => ({
            id: crypto.randomUUID(),
            file,
            state: "queued" as const,
          }));
        return [...retained, ...additions];
      });
    },
    [updatePendingDocuments],
  );

  const removeStoredDocument = useCallback(
    async (document: DiminishedValueStoredDocument) => {
      if (!dependencies || !userId || !envelope.confirmedCaseId) return;
      setRemovingDocumentId(document.id);
      setFlowError(null);
      try {
        submissionAttemptCaseRef.current = null;
        await dependencies.diminishedValueDocumentStorageService.removeDocument({
          userId,
          caseId: envelope.confirmedCaseId,
          document,
        });
        setDocuments((current) =>
          current.filter((candidate) => candidate.id !== document.id),
        );
      } catch (error) {
        setFlowError(
          errorMessage(error, "This document could not be removed. Try again."),
        );
      } finally {
        setRemovingDocumentId(null);
      }
    },
    [dependencies, envelope.confirmedCaseId, userId],
  );

  const retryDocumentUploads = useCallback(() => {
    updatePendingDocuments((current) =>
      current.map((document) =>
        document.state === "error"
          ? { ...document, state: "queued", error: undefined }
          : document,
      ),
    );
  }, [updatePendingDocuments]);

  useEffect(() => {
    if (auth.status === "loading") return;
    const previousUserId = identityRef.current.userId;
    if (previousUserId !== userId) {
      identityRef.current = {
        generation: identityRef.current.generation + 1,
        userId,
      };
      caseCreationRef.current = null;
      saveChainRef.current = null;
      uploadLoopRef.current = null;
      loadedCaseRef.current = null;
      recentLookupRef.current = null;
      pendingAuthHandledRef.current = null;
      submissionAttemptCaseRef.current = null;
      setServerDetails(null);
      setDocuments([]);
      updatePendingDocuments(() => []);
      setCaseStatus(null);
      setCaseState("idle");
    }

    const current = envelopeRef.current;
    if (
      current.ownerUserId &&
      (!userId || current.ownerUserId !== userId)
    ) {
      const fresh = createEmptyDiminishedValueDraftEnvelope();
      envelopeRef.current = fresh;
      setEnvelope(fresh);
      setStorageError(!writeDiminishedValueDraftEnvelope(fresh).ok);
    }
  }, [auth.status, updatePendingDocuments, userId]);

  useEffect(() => {
    if (!userId || !dependencies || invalidExplicitCaseId) return;
    if (explicitCaseId) {
      void loadCase(explicitCaseId, true);
      return;
    }

    const current = envelopeRef.current;
    if (current.confirmedCaseId && current.ownerUserId === userId) {
      void loadCase(current.confirmedCaseId, false);
      return;
    }
    if (hasMeaningfulDiminishedValueDraft(current.intake)) {
      void ensureCase()
        .then((caseId) => loadCase(caseId, false))
        .catch((error: unknown) => {
          if (!(error instanceof StaleDiminishedValueIdentityError)) {
            setFlowError(
              errorMessage(error, "We couldn’t prepare your secure case."),
            );
          }
        });
      return;
    }

    const recentKey = `${identityRef.current.generation}:${userId}`;
    if (recentLookupRef.current === recentKey) return;
    recentLookupRef.current = recentKey;
    void dependencies.appraisalCaseService
      .getRecentDraftAppraisalCase({
        userId,
        serviceType: "diminished_value",
      })
      .then((recentCase) => {
        if (recentCase) return loadCase(recentCase.id, true);
      })
      .catch(() => {
        recentLookupRef.current = null;
        setFlowError("We couldn’t check for a saved diminished-value draft.");
      });
  }, [
    dependencies,
    ensureCase,
    explicitCaseId,
    invalidExplicitCaseId,
    loadCase,
    userId,
  ]);

  useEffect(() => {
    if (
      !userId ||
      !dependencies ||
      !envelope.dirty ||
      !hasMeaningfulDiminishedValueDraft(envelope.intake) ||
      caseStatus === "submitted" ||
      serverDetails?.submittedAt
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistCurrentDraft().catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    caseStatus,
    dependencies,
    envelope.dirty,
    envelope.intake,
    envelope.revision,
    persistCurrentDraft,
    serverDetails?.submittedAt,
    userId,
  ]);

  useEffect(() => {
    if (!userId || !dependencies || !envelope.pendingAuthAction) return;
    const key = `${identityRef.current.generation}:${userId}:${envelope.pendingAuthAction}`;
    if (pendingAuthHandledRef.current === key) return;
    pendingAuthHandledRef.current = key;

    if (envelope.pendingAuthAction === "submit-review") {
      void submitAuthenticated().catch(() => {
        pendingAuthHandledRef.current = null;
      });
      return;
    }
    void ensureCase()
      .then(() => {
        applyEnvelope((current) => ({
          ...current,
          pendingAuthAction: null,
          lastUpdatedAt: new Date().toISOString(),
        }));
      })
      .catch((error: unknown) => {
        pendingAuthHandledRef.current = null;
        setFlowError(
          errorMessage(error, "We couldn’t continue after sign-in."),
        );
      });
  }, [
    applyEnvelope,
    dependencies,
    ensureCase,
    envelope.pendingAuthAction,
    submitAuthenticated,
    userId,
  ]);

  useEffect(() => {
    void processPendingDocuments().catch(() => undefined);
  }, [pendingDocuments, processPendingDocuments]);

  const busy =
    submitting ||
    saveState === "saving" ||
    caseState === "loading" ||
    pendingDocuments.some((document) => document.state === "uploading") ||
    removingDocumentId !== null;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  if (invalidExplicitCaseId) {
    return (
      <DiminishedValueGate
        message="That diminished-value case link is invalid."
        onRetry={null}
      />
    );
  }

  if (ownerDraftIdentityUnverified) {
    return (
      <FlowCard>
        <p className="text-sm leading-6 text-copy" role="status">
          Checking your saved request…
        </p>
      </FlowCard>
    );
  }

  if (explicitCaseId && !userId && auth.status !== "loading") {
    return (
      <FlowCard>
        <h2 className="text-2xl font-semibold tracking-[-0.03em] text-ink">
          Sign in to continue this request
        </h2>
        <p className="mt-3 text-sm leading-6 text-copy">
          This case is private. Sign in with the account that owns it to resume.
        </p>
        <button
          type="button"
          className={`${primaryFlowButtonClassName} mt-6`}
          onClick={() =>
            openSignIn({
              returnTo,
              intent: "continue-diminished-value",
            })
          }
        >
          Sign in to continue
        </button>
      </FlowCard>
    );
  }

  if (caseState === "error" && explicitCaseId) {
    return (
      <DiminishedValueGate
        message={
          flowError ??
          "We couldn’t open that diminished-value case for this account."
        }
        onRetry={() => {
          loadedCaseRef.current = null;
          void loadCase(explicitCaseId, true);
        }}
      />
    );
  }

  return (
    <DiminishedValueIntakeFlow
      status={
        flowError ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-800"
            role="alert"
          >
            <AlertCircle className="mt-1 size-4 shrink-0" aria-hidden />
            <span>{flowError}</span>
          </div>
        ) : storageError ? (
          <p className="text-sm text-amber-800" role="status">
            This browser could not save a local backup of your draft.
          </p>
        ) : saveState === "saving" ? (
          <p className="flex items-center gap-2 text-sm text-copy" role="status">
            <Cloud className="size-4" aria-hidden /> Saving securely…
          </p>
        ) : saveState === "saved" && userId ? (
          <p className="flex items-center gap-2 text-sm text-copy" role="status">
            <Cloud className="size-4" aria-hidden /> Saved securely
          </p>
        ) : null}
      draft={renderedDraft}
      onDraftChange={handleDraftChange}
      selectedFiles={pendingDocuments.map((document) => document.file)}
      onSelectedFilesChange={handlePendingFilesChange}
      onSubmit={handleSubmit}
      submitting={submitting}
      submissionError={submissionError}
      submittedAt={serverDetails?.submittedAt ?? null}
      submittedFileCount={documents.length}
      storedDocuments={documents}
      pendingDocumentStates={pendingDocuments.map((document) => ({
        identity: fileIdentity(document.file),
        state: document.state,
        error: document.error,
      }))}
      documentsRequireAuthentication={!userId}
      onDocumentAuthenticationRequired={() =>
        prepareAuthentication("upload-documents")
      }
      onRetryDocumentUploads={retryDocumentUploads}
      onRemoveStoredDocument={(document) =>
        void removeStoredDocument(document)
      }
      removingDocumentId={removingDocumentId}
      documentsDisabled={
        submitting ||
        removingDocumentId !== null ||
        pendingDocuments.some((document) => document.state === "uploading")
      }
      vehicleLookupService={dependencies?.vehicleLookupService}
    />
  );
}

function DiminishedValueGate({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: (() => void) | null;
}) {
  return (
    <FlowCard>
      <div className="flex items-start gap-3" role="alert">
        <AlertCircle className="mt-1 size-5 shrink-0 text-red-700" aria-hidden />
        <p className="text-sm leading-6 text-red-800">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          className={`${primaryFlowButtonClassName} mt-5`}
          onClick={onRetry}
        >
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </button>
      ) : null}
    </FlowCard>
  );
}

function editableDraftFromDetails(details: DiminishedValueCaseDetails) {
  const draft = diminishedValueDetailsToDraft(details);
  return draft.step === "complete" ? { ...draft, step: "consultation" as const } : draft;
}

function hasMeaningfulDiminishedValueDraft(draft: DiminishedValueDraft) {
  return (
    draft.step !== "start" ||
    draft.accidentState.trim() !== "" ||
    draft.accidentDate.trim() !== "" ||
    draft.repairStatus !== "" ||
    draft.vin.trim() !== "" ||
    draft.vehicleYear.trim() !== "" ||
    draft.make.trim() !== "" ||
    draft.model.trim() !== "" ||
    draft.mileageAtAccident.trim() !== "" ||
    draft.otherPartyAtFault !== "" ||
    draft.fullName.trim() !== "" ||
    draft.email.trim() !== ""
  );
}

function loadInitialState(): InitialState {
  const stored = readDiminishedValueDraftEnvelope();
  if (stored.ok) {
    return {
      envelope:
        stored.envelope ?? createEmptyDiminishedValueDraftEnvelope(),
      storageError: false,
    };
  }
  return {
    envelope: createEmptyDiminishedValueDraftEnvelope(),
    storageError: true,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

class StaleDiminishedValueIdentityError extends Error {}
