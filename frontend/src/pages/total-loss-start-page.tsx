import { AlertCircle, CloudOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";

import {
  isPermanentAuthState,
  useAuth,
} from "@/features/auth";
import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { getUserFullName } from "@/features/auth/user-display";
import {
  CURRENT_PRIVACY_NOTICE_VERSION,
  CURRENT_SERVICE_TERMS_VERSION,
} from "@/features/customer-profile/types";
import { useCreateOrGetAppraisalCaseMutation } from "@/features/cases/mutations";
import {
  ingestTotalLossReport,
  type TotalLossReportIngestion,
} from "@/features/analyses/api/report-ingestion";
import {
  appraisalCaseQueryKeys,
  useAppraisalCaseQuery,
  useRecentDraftAppraisalCaseQuery,
  useTotalLossDraftQuery,
} from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import {
  IntakeStepTransition,
  useVehicleLookupController,
} from "@/features/intake";
import type {
  CreateTotalLossDetailsValues,
  TotalLossCaseDetails,
} from "@/features/total-loss/data-types";
import {
  hasUnpersistedTotalLossManualValues,
  totalLossDetailsToManualForm,
  totalLossManualFormToDetailsValues,
  totalLossReportFormToDetailsValues,
} from "@/features/total-loss/data-mappers";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import {
  createEmptyTotalLossDraft,
  readTotalLossDraft,
  writeTotalLossDraft,
} from "@/features/total-loss/draft";
import {
  FlowCard,
  primaryFlowButtonClassName,
} from "@/features/total-loss/intake-fields";
import {
  ChoiceStep,
  ClaimStep,
  ContactStep,
  ReadyStep,
  ReportStep,
  ReviewStep,
  ResumeStep,
  VehicleStep,
  type VehicleEntryMethod,
} from "@/features/total-loss/intake-steps";
import {
  useSaveTotalLossDetailsMutation,
  useUploadTotalLossReportMutation,
} from "@/features/total-loss/mutations";
import {
  totalLossQueryKeys,
  useTotalLossDetailsQuery,
} from "@/features/total-loss/queries";
import { TotalLossDetailsConflictError } from "@/features/total-loss/service";
import { createNhtsaVpicVehicleLookupService } from "@/features/total-loss/nhtsa-vpic-vehicle-lookup";
import {
  createEmptyTotalLossManualForm,
  type TotalLossContactFormErrors,
  type TotalLossDraft,
  type TotalLossIntakeMode,
  type TotalLossManualFormErrors,
  type TotalLossManualFormValues,
  type TotalLossReportExtractionStatus,
} from "@/features/total-loss/types";
import {
  hasTotalLossManualFormErrors,
  normalizeTotalLossManualForm,
  validateTotalLossManualForm,
  normalizeTotalLossContactForm,
  validateTotalLossContactForm,
  validateVin,
} from "@/features/total-loss/validation";
import {
  normalizeTotalLossReportFiles,
  TotalLossReportNormalizationError,
} from "@/features/total-loss/report-normalization";

const AUTOSAVE_DELAY_MS = 600;
const REPORT_EXTRACTION_FAILURE_WARNING =
  "Automatic extraction could not finish. Complete the vehicle and claim details manually.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultVehicleLookupService = createNhtsaVpicVehicleLookupService();

const unavailableCaseService: AppraisalCaseService = {
  createAppraisalCase: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
  createOrGetAppraisalCase: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
  listAppraisalCases: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
  getRecentDraftAppraisalCase: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
  getOrCreateTotalLossDraft: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
  getAppraisalCase: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
  touchAppraisalCase: () =>
    Promise.reject(new Error("Case storage is unavailable.")),
};

interface SaveSnapshot {
  readonly caseId: string;
  readonly identityGeneration: number;
  readonly revision: number;
  readonly retainLocalDirty: boolean;
  readonly userId: string;
  readonly values: CreateTotalLossDetailsValues;
}

interface InitialDraftState {
  readonly draft: TotalLossDraft;
  readonly storageError: boolean;
}

interface TotalLossIntakeFlowProps {
  onBusyChange?: (busy: boolean) => void;
}

export function TotalLossIntakeFlow({
  onBusyChange,
}: TotalLossIntakeFlowProps) {
  return <TotalLossDraftBootstrapGate onBusyChange={onBusyChange} />;
}

function TotalLossDraftBootstrapGate({
  onBusyChange,
}: TotalLossIntakeFlowProps) {
  const { auth, ensureGuestSession } = useAuth();
  const location = useLocation();
  const dependencies = useTotalLossDependencies();
  const [guestBootstrapError, setGuestBootstrapError] = useState<string | null>(
    null,
  );
  const guestBootstrapAbortRef = useRef<AbortController | null>(null);
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const explicitCaseId = useMemo(
    () => new URLSearchParams(location.search).get("caseId"),
    [location.search],
  );
  const invalidExplicitCaseId = Boolean(
    explicitCaseId && !UUID_PATTERN.test(explicitCaseId),
  );
  const caseService =
    dependencies?.appraisalCaseService ?? unavailableCaseService;
  const explicitCaseQuery = useAppraisalCaseQuery({
    caseId: explicitCaseId ?? "",
    service: caseService,
    userId:
      dependencies && explicitCaseId && !invalidExplicitCaseId ? userId : null,
  });
  const bootstrapQuery = useTotalLossDraftQuery({
    service: caseService,
    userId: dependencies && !explicitCaseId ? userId : null,
  });
  const explicitAppraisalCase = explicitCaseQuery.data;
  const canonicalAppraisalCase = bootstrapQuery.data;
  const explicitCaseIsOwnedTotalLossDraft = Boolean(
    auth.status === "signedIn" &&
    explicitAppraisalCase &&
    explicitAppraisalCase.userId === auth.user.id &&
    explicitAppraisalCase.serviceType === "total_loss" &&
    explicitAppraisalCase.status === "draft",
  );

  const startGuestBootstrap = useCallback(() => {
    guestBootstrapAbortRef.current?.abort();
    const controller = new AbortController();
    guestBootstrapAbortRef.current = controller;
    const promise = ensureGuestSession({ signal: controller.signal }).finally(
      () => {
        if (guestBootstrapAbortRef.current === controller) {
          guestBootstrapAbortRef.current = null;
        }
      },
    );
    return { controller, promise };
  }, [ensureGuestSession]);

  useEffect(() => {
    if (auth.status !== "signedOut") return;
    let active = true;
    const { controller, promise } = startGuestBootstrap();
    void promise.catch((error: unknown) => {
      if (active && !controller.signal.aborted) {
        setGuestBootstrapError(
          getFriendlyAuthError(error, "guest"),
        );
      }
    });
    return () => {
      active = false;
      guestBootstrapAbortRef.current?.abort();
    };
  }, [auth.status, startGuestBootstrap]);

  if (guestBootstrapError) {
    return (
      <DraftBootstrapErrorCard
        message={guestBootstrapError}
        onRetry={() => {
          setGuestBootstrapError(null);
          const { controller, promise } = startGuestBootstrap();
          void promise.catch((error: unknown) => {
            if (!controller.signal.aborted) {
              setGuestBootstrapError(
                getFriendlyAuthError(error, "guest"),
              );
            }
          });
        }}
      />
    );
  }
  if (auth.status === "unavailable") {
    return (
      <DraftBootstrapErrorCard message="Secure guest storage is temporarily unavailable." />
    );
  }
  if (auth.status !== "signedIn") {
    return <LoadingCard />;
  }
  if (!dependencies) {
    return (
      <DraftBootstrapErrorCard message="Venfour could not connect to secure case storage." />
    );
  }
  if (invalidExplicitCaseId) return <UnavailableCaseCard />;

  if (
    (!explicitCaseId && bootstrapQuery.isPending) ||
    (explicitCaseId && explicitCaseQuery.isPending)
  ) {
    return <LoadingCard />;
  }
  if (
    (!explicitCaseId && bootstrapQuery.isError) ||
    (explicitCaseId && explicitCaseQuery.isError)
  ) {
    return (
      <DraftBootstrapErrorCard
        message="Your durable Total Loss draft could not be prepared. No report has been requested or uploaded."
        onRetry={() => {
          if (explicitCaseId) {
            void explicitCaseQuery.refetch();
          } else {
            void bootstrapQuery.refetch();
          }
        }}
      />
    );
  }

  if (explicitCaseId && !explicitCaseIsOwnedTotalLossDraft) {
    return <UnavailableCaseCard />;
  }

  const appraisalCase = explicitCaseId
    ? explicitAppraisalCase
    : canonicalAppraisalCase;
  if (
    !appraisalCase ||
    appraisalCase.userId !== auth.user.id ||
    appraisalCase.serviceType !== "total_loss" ||
    appraisalCase.status !== "draft"
  ) {
    return <UnavailableCaseCard />;
  }

  return (
    <TotalLossIntakeFlowContent
      bootstrapCase={appraisalCase}
      onBusyChange={onBusyChange}
    />
  );
}

interface TotalLossIntakeFlowContentProps extends TotalLossIntakeFlowProps {
  readonly bootstrapCase: AppraisalCase;
}

function TotalLossIntakeFlowContent({
  bootstrapCase,
  onBusyChange,
}: TotalLossIntakeFlowContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { auth, sendMagicLink } = useAuth();
  const queryClient = useQueryClient();
  const dependencies = useTotalLossDependencies();
  const [initialDraft] = useState(() =>
    loadInitialDraft(bootstrapCase, bootstrapCase.userId),
  );
  const [draft, setDraft] = useState(initialDraft.draft);
  const [stepTransitionDirection, setStepTransitionDirection] = useState<
    "forward" | "backward"
  >("forward");
  const draftRef = useRef(draft);
  const [vehicleEntryMethod, setVehicleEntryMethod] =
    useState<VehicleEntryMethod>(() =>
      vehicleEntryMethodForValues(initialDraft.draft.manual),
    );
  const activeVehicleEntryMethod = vehicleEntryMethodForValues(
    draft.manual,
    vehicleEntryMethod,
  );
  const [storageError, setStorageError] = useState(initialDraft.storageError);
  const [manualErrors, setManualErrors] = useState<TotalLossManualFormErrors>(
    {},
  );
  const [contactErrors, setContactErrors] =
    useState<TotalLossContactFormErrors>({});
  const [flowError, setFlowError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [conflict, setConflict] = useState<TotalLossCaseDetails | null>(null);
  const [conflictWithoutRow, setConflictWithoutRow] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [completionBusy, setCompletionBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [retryFiles, setRetryFiles] = useState<readonly File[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [accessLinkError, setAccessLinkError] = useState<string | null>(null);
  const [extractionState, setExtractionState] =
    useState<TotalLossReportExtractionStatus>(
      initialDraft.draft.reportExtractionStatus,
    );
  const [explicitCaseError, setExplicitCaseError] = useState<string | null>(
    null,
  );

  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const identityRef = useRef({ generation: 0, userId });
  const caseService =
    dependencies?.appraisalCaseService ?? unavailableCaseService;
  const detailsService = dependencies?.totalLossDetailsService ?? null;
  const storageService = dependencies?.totalLossReportStorageService ?? null;
  const identityService = dependencies?.totalLossIdentityService ?? null;
  const vehicleLookupService =
    dependencies?.vehicleLookupService ?? defaultVehicleLookupService;
  const {
    makeOptions,
    modelOptions,
    makesState,
    modelsState,
    vinLookupState,
    vinLookupMessage,
    decodeVin,
    resetVinLookup,
    retryMakes,
    retryModels,
  } = useVehicleLookupController({
    service: vehicleLookupService,
    catalogEnabled:
      draft.step === "vehicle" && activeVehicleEntryMethod === "details",
    vehicleYear: draft.manual.vehicleYear,
    make: draft.manual.make,
    currentVin: normalizeTotalLossManualForm(draft.manual).vin,
    unknownVinErrorMessage:
      "We couldn’t identify that VIN right now. Try again or select your vehicle details.",
  });
  const dataUserId = dependencies ? userId : null;
  const explicitCaseId = useMemo(
    () => new URLSearchParams(location.search).get("caseId"),
    [location.search],
  );
  const invalidExplicitCaseId = Boolean(
    explicitCaseId && !UUID_PATTERN.test(explicitCaseId),
  );

  const clearStaleUserCache = useCallback(
    (staleUserId: string) => {
      queryClient.removeQueries({
        queryKey: appraisalCaseQueryKeys.user(staleUserId),
      });
    },
    [queryClient],
  );

  const applyDraft = useCallback(
    (
      update: (current: TotalLossDraft) => TotalLossDraft,
      options: { bumpRevision?: boolean } = {},
    ) => {
      const current = draftRef.current;
      const candidate = update(current);
      const next: TotalLossDraft = {
        ...candidate,
        revision:
          options.bumpRevision === false
            ? candidate.revision
            : current.revision + 1,
        lastUpdatedAt: new Date().toISOString(),
      };
      if (next.step !== current.step) {
        setStepTransitionDirection(
          intakeStepPosition(next.step) < intakeStepPosition(current.step)
            ? "backward"
            : "forward",
        );
      }
      draftRef.current = next;
      setDraft(next);
      const result = writeTotalLossDraft(next);
      setStorageError(!result.ok);
      return { draft: next, persisted: result.ok };
    },
    [],
  );

  const createCaseMutation = useCreateOrGetAppraisalCaseMutation({
    service: caseService,
    userId,
  });
  const createOrGetCase = createCaseMutation.mutateAsync;
  const recentCaseQuery = useRecentDraftAppraisalCaseQuery({
    service: caseService,
    serviceType: "total_loss",
    userId: dataUserId,
  });
  const confirmedCaseId =
    userId && draft.ownerUserId === userId ? draft.confirmedCaseId : null;
  const detailsQuery = useTotalLossDetailsQuery({
    service: detailsService,
    userId: dataUserId,
    caseId: confirmedCaseId,
  });
  const resolvedSavedFilename =
    savedFilename ??
    (detailsQuery.data?.caseId === confirmedCaseId
      ? detailsQuery.data.reportOriginalFilename
      : null);
  const recentDetailsQuery = useTotalLossDetailsQuery({
    service: detailsService,
    userId: dataUserId,
    caseId: recentCaseQuery.data?.id ?? null,
  });
  const saveDetailsMutation = useSaveTotalLossDetailsMutation({
    detailsService,
    userId,
  });
  const saveDetails = saveDetailsMutation.mutateAsync;
  const uploadReportMutation = useUploadTotalLossReportMutation({
    detailsService,
    storageService,
    userId,
  });
  const uploadReport = uploadReportMutation.mutateAsync;

  const caseCreationPromiseRef = useRef<Promise<AppraisalCase> | null>(null);
  const serverUpdatedAtRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<SaveSnapshot | null>(null);
  const saveLoopRef = useRef<Promise<void> | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const hydratedDetailsRef = useRef<string | null>(null);
  const explicitCaseRef = useRef<string | null>(null);
  const pendingExtractionResumeKeyRef = useRef<string | null>(null);
  const reportIngestionPromiseRef = useRef<{
    caseId: string;
    promise: Promise<TotalLossReportIngestion>;
  } | null>(null);
  const ensureCase = useCallback(async () => {
    if (!userId || !dependencies) {
      throw new Error("Sign in before saving this appraisal.");
    }

    const current = draftRef.current;
    if (current.confirmedCaseId && current.ownerUserId === userId) {
      return current.confirmedCaseId;
    }

    if (caseCreationPromiseRef.current) {
      return (await caseCreationPromiseRef.current).id;
    }

    const identityGeneration = identityRef.current.generation;
    if (identityRef.current.userId !== userId) {
      throw new StaleIdentityOperationError();
    }

    let reservedCaseId = current.reservedCaseId;
    if (!reservedCaseId) {
      reservedCaseId = crypto.randomUUID();
      const reservation = applyDraft((value) => ({
        ...value,
        reservedCaseId,
        ownerUserId: userId,
      }));
      if (!reservation.persisted) {
        throw new Error(
          "This browser could not save a durable case identifier. Check browser storage and try again.",
        );
      }
    }

    const operation = createOrGetCase({
      caseId: reservedCaseId,
      serviceType: "total_loss",
    })
      .then((appraisalCase) => {
        if (
          identityRef.current.generation !== identityGeneration ||
          identityRef.current.userId !== userId
        ) {
          clearStaleUserCache(userId);
          throw new StaleIdentityOperationError();
        }
        const confirmation = applyDraft((value) => ({
          ...value,
          confirmedCaseId: appraisalCase.id,
          reservedCaseId: appraisalCase.id,
          ownerUserId: userId,
        }));
        if (!confirmation.persisted) {
          throw new Error(
            "The appraisal was created, but this browser could not retain its identifier. Try again to recover it safely.",
          );
        }
        return appraisalCase;
      })
      .catch((error: unknown) => {
        if (
          identityRef.current.generation !== identityGeneration ||
          identityRef.current.userId !== userId
        ) {
          clearStaleUserCache(userId);
          throw new StaleIdentityOperationError();
        }
        throw error;
      });

    caseCreationPromiseRef.current = operation;
    try {
      return (await operation).id;
    } finally {
      if (caseCreationPromiseRef.current === operation) {
        caseCreationPromiseRef.current = null;
      }
    }
  }, [applyDraft, clearStaleUserCache, createOrGetCase, dependencies, userId]);

  const persistSnapshot = useCallback(
    async (snapshot: SaveSnapshot) => {
      if (
        identityRef.current.generation !== snapshot.identityGeneration ||
        identityRef.current.userId !== snapshot.userId
      ) {
        throw new StaleIdentityOperationError();
      }
      const expectedUpdatedAt = serverUpdatedAtRef.current;
      setSaveState("saving");
      try {
        const details =
          expectedUpdatedAt === null
            ? await saveDetails({
                caseId: snapshot.caseId,
                expectedUpdatedAt: null,
                values: snapshot.values,
              })
            : await saveDetails({
                caseId: snapshot.caseId,
                expectedUpdatedAt,
                values: snapshot.values,
              });

        if (
          identityRef.current.generation !== snapshot.identityGeneration ||
          identityRef.current.userId !== snapshot.userId
        ) {
          clearStaleUserCache(snapshot.userId);
          throw new StaleIdentityOperationError();
        }
        serverUpdatedAtRef.current = details.updatedAt;
        hydratedDetailsRef.current = `${details.caseId}:${details.updatedAt}`;
        setConflict(null);
        setConflictWithoutRow(false);
        setFlowError(null);
        setSaveState("saved");

        if (draftRef.current.revision === snapshot.revision) {
          applyDraft(
            (current) => ({
              ...current,
              dirty: snapshot.retainLocalDirty,
            }),
            { bumpRevision: false },
          );
        }
      } catch (error) {
        if (
          error instanceof StaleIdentityOperationError ||
          identityRef.current.generation !== snapshot.identityGeneration ||
          identityRef.current.userId !== snapshot.userId
        ) {
          clearStaleUserCache(snapshot.userId);
          throw new StaleIdentityOperationError();
        }
        setSaveState("error");
        if (error instanceof TotalLossDetailsConflictError) {
          setConflict(error.currentDetails);
          setConflictWithoutRow(error.currentDetails === null);
        } else {
          setFlowError(
            errorMessage(error, "We couldn’t save your information."),
          );
        }
        throw error;
      }
    },
    [applyDraft, clearStaleUserCache, saveDetails],
  );

  const enqueueSnapshot = useCallback(
    (snapshot: SaveSnapshot) => {
      pendingSaveRef.current = snapshot;
      if (saveLoopRef.current) {
        return saveLoopRef.current;
      }

      const run = async () => {
        while (pendingSaveRef.current) {
          const next = pendingSaveRef.current;
          pendingSaveRef.current = null;
          await persistSnapshot(next);
        }
      };
      const loop = run();
      saveLoopRef.current = loop;
      void loop
        .finally(() => {
          if (saveLoopRef.current === loop) {
            saveLoopRef.current = null;
          }
        })
        .catch(() => undefined);
      return loop;
    },
    [persistSnapshot],
  );

  const flushDraft = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const current = draftRef.current;
      const caseId = current.confirmedCaseId;
      if (!userId || !caseId || !current.mode) {
        if (force) {
          throw new Error("The appraisal case is not ready to save.");
        }
        return;
      }
      if (!force && !current.dirty) {
        if (saveLoopRef.current) await saveLoopRef.current;
        return;
      }

      const values = detailsValuesForDraft(current);
      await enqueueSnapshot({
        caseId,
        identityGeneration: identityRef.current.generation,
        revision: current.revision,
        retainLocalDirty: hasUnpersistedTotalLossManualValues(current.manual),
        userId,
        values,
      });
    },
    [enqueueSnapshot, userId],
  );

  useEffect(() => {
    if (auth.status === "loading") return;
    const previousUserId = identityRef.current.userId;
    const identityChanged = previousUserId !== userId;
    if (identityChanged) {
      if (previousUserId) {
        clearStaleUserCache(previousUserId);
      }
      identityRef.current = {
        generation: identityRef.current.generation + 1,
        userId,
      };
      caseCreationPromiseRef.current = null;
      pendingSaveRef.current = null;
      saveLoopRef.current = null;
      explicitCaseRef.current = null;
      setRetryFiles([]);
      setSelectedFilename(null);
      setSavedFilename(null);
      setUploadState("idle");
      setExtractionState("idle");
      setUploadError(null);
      setConflict(null);
      setConflictWithoutRow(false);
      setSaveState("idle");
      setExplicitCaseError(null);
    }
    const current = draftRef.current;
    if (
      (auth.status === "signedOut" || auth.status === "unavailable") &&
      current.ownerUserId
    ) {
      const fresh = createEmptyTotalLossDraft();
      draftRef.current = fresh;
      setDraft(fresh);
      writeTotalLossDraft(fresh);
      serverUpdatedAtRef.current = null;
      hydratedDetailsRef.current = null;
      return;
    }
    if (userId && current.ownerUserId && current.ownerUserId !== userId) {
      const fresh = createEmptyTotalLossDraft();
      draftRef.current = fresh;
      setDraft(fresh);
      writeTotalLossDraft(fresh);
      serverUpdatedAtRef.current = null;
      hydratedDetailsRef.current = null;
    }
  }, [auth.status, clearStaleUserCache, userId]);

  useEffect(() => {
    if (!isPermanentAuthState(auth) || !auth.user.email) return;
    const current = draftRef.current;
    if (current.contact.email && current.contact.fullName) return;
    applyDraft(
      (value) => ({
        ...value,
        contact: {
          ...value.contact,
          email: value.contact.email || auth.user.email || "",
          fullName:
            value.contact.fullName || getUserFullName(auth.user) || "",
        },
      }),
      { bumpRevision: false },
    );
  }, [applyDraft, auth]);

  useEffect(() => {
    if (!detailsQuery.data || draftRef.current.dirty) return;
    const details = detailsQuery.data;
    const hydrationKey = `${details.caseId}:${details.updatedAt}`;
    if (hydratedDetailsRef.current === hydrationKey) return;
    hydratedDetailsRef.current = hydrationKey;
    serverUpdatedAtRef.current = details.updatedAt;
    setSavedFilename(details.reportOriginalFilename);
    const hydratedExtractionState = extractionStateForDetails(details);
    setExtractionState(hydratedExtractionState);
    applyDraft(
      (current) => ({
        ...current,
        mode: details.intakeMode,
        manual: manualValuesForDetails(details),
        reportProvider: details.reportProvider ?? current.reportProvider,
        reportExtractionStatus: hydratedExtractionState,
        reportExtractionWarnings: extractionWarningsForDetails(
          details,
          current,
        ),
        step: stepForDetails(details, current.step),
        dirty: false,
        pendingAuthAction: null,
      }),
      { bumpRevision: false },
    );
  }, [applyDraft, detailsQuery.data]);

  useEffect(() => {
    const current = draftRef.current;
    if (
      !userId ||
      !confirmedCaseId ||
      current.step !== "ready" ||
      current.dirty ||
      !detailsQuery.isSuccess ||
      detailsQuery.data !== null
    ) {
      return;
    }

    serverUpdatedAtRef.current = null;
    hydratedDetailsRef.current = null;
    setSavedFilename(null);
    setFlowError(
      "We couldn’t confirm that this intake was completed. Review and save it again.",
    );
    applyDraft((value) => ({
      ...value,
      step:
        value.mode === "report"
          ? "report"
          : value.mode === "manual"
            ? "vehicle"
            : "choice",
      pendingAuthAction: null,
      dirty: value.mode !== null,
    }));
  }, [
    applyDraft,
    confirmedCaseId,
    detailsQuery.data,
    detailsQuery.isSuccess,
    userId,
  ]);

  useEffect(() => {
    if (!userId || !dependencies || !explicitCaseId) {
      return;
    }

    const explicitCaseKey = `${userId}:${explicitCaseId}`;
    if (explicitCaseRef.current === explicitCaseKey) return;

    const current = draftRef.current;
    if (
      current.ownerUserId === userId &&
      current.confirmedCaseId === explicitCaseId
    ) {
      explicitCaseRef.current = explicitCaseKey;
      setExplicitCaseError(null);
      return;
    }

    explicitCaseRef.current = explicitCaseKey;
    if (!UUID_PATTERN.test(explicitCaseId)) return;

    let active = true;
    void dependencies.appraisalCaseService
      .getAppraisalCase({ caseId: explicitCaseId, userId })
      .then((appraisalCase) => {
        if (!active) return;
        if (
          !appraisalCase ||
          appraisalCase.serviceType !== "total_loss" ||
          appraisalCase.status !== "draft"
        ) {
          setExplicitCaseError(
            "We couldn’t open that total-loss draft for this account.",
          );
          return;
        }
        setExplicitCaseError(null);
        serverUpdatedAtRef.current = null;
        hydratedDetailsRef.current = null;
        setSavedFilename(null);
        applyDraft((current) => ({
          ...current,
          confirmedCaseId: appraisalCase.id,
          reservedCaseId: appraisalCase.id,
          ownerUserId: userId,
          mode: null,
          manual: createEmptyTotalLossManualForm(),
          step: "choice",
          pendingAuthAction: null,
          dirty: false,
        }));
      })
      .catch(() => {
        if (active) {
          setExplicitCaseError(
            "We couldn’t open that total-loss draft for this account.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [applyDraft, dependencies, explicitCaseId, userId]);

  useEffect(() => {
    const current = draftRef.current;
    if (
      !userId ||
      !dependencies ||
      Boolean(explicitCaseId) ||
      current.confirmedCaseId ||
      !current.mode ||
      recentCandidateVisible(current, recentCaseQuery.data?.id, explicitCaseId)
    ) {
      return;
    }

    const shouldCreate =
      hasMeaningfulManualDraft(current) || current.step === "report";
    if (!shouldCreate) return;

    void ensureCase().catch((error: unknown) => {
      if (error instanceof StaleIdentityOperationError) return;
      setFlowError(errorMessage(error, "We couldn’t prepare your appraisal."));
    });
  }, [
    dependencies,
    draft.revision,
    ensureCase,
    explicitCaseId,
    recentCaseQuery.data?.id,
    userId,
  ]);

  useEffect(() => {
    const current = draftRef.current;
    if (
      !userId ||
      !current.confirmedCaseId ||
      !current.dirty ||
      Boolean(explicitCaseId && current.confirmedCaseId !== explicitCaseId) ||
      conflict ||
      conflictWithoutRow ||
      current.step === "ready"
    ) {
      return;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void flushDraft().catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    conflict,
    conflictWithoutRow,
    draft.revision,
    explicitCaseId,
    flushDraft,
    userId,
  ]);

  const candidate = recentCandidateVisible(
    draft,
    recentCaseQuery.data?.id,
    explicitCaseId,
  )
    ? (recentCaseQuery.data ?? null)
    : null;
  const candidateDetails =
    candidate?.id === recentDetailsQuery.data?.caseId
      ? (recentDetailsQuery.data ?? null)
      : null;
  const renderedStepKey: TotalLossDraft["step"] | "resume" = candidate
    ? "resume"
    : draft.step;
  const explicitCasePending = Boolean(
    explicitCaseId &&
    !invalidExplicitCaseId &&
    userId &&
    dependencies &&
    confirmedCaseId !== explicitCaseId &&
    !explicitCaseError,
  );
  const explicitCaseBlocked = Boolean(
    explicitCaseId && (invalidExplicitCaseId || explicitCaseError),
  );
  const readyStateVerified = Boolean(
    draft.step === "ready" &&
    confirmedCaseId &&
    detailsQuery.data?.caseId === confirmedCaseId &&
    detailsQuery.data.intakeCompletedAt,
  );
  const readyStateLoadError = Boolean(
    draft.step === "ready" &&
    !readyStateVerified &&
    auth.status !== "loading" &&
    (!userId || !confirmedCaseId || !detailsService || detailsQuery.isError),
  );
  const readyStateVerificationPending = Boolean(
    draft.step === "ready" && !readyStateVerified && !readyStateLoadError,
  );
  const draftIdentityUnverified = Boolean(
    draft.ownerUserId &&
    (auth.status === "loading" || draft.ownerUserId !== userId),
  );
  const busy =
    modeBusy ||
    completionBusy ||
    resumeBusy ||
    saveState === "saving" ||
    uploadState === "uploading";
  const serviceSwitchDisabled = busy || vinLookupState === "loading";

  useEffect(() => {
    onBusyChange?.(serviceSwitchDisabled);
  }, [onBusyChange, serviceSwitchDisabled]);

  const handleModeContinue = async () => {
    if (!draft.mode) return;
    setModeBusy(true);
    setFlowError(null);
    try {
      if (
        userId &&
        !draft.confirmedCaseId &&
        !draft.dismissedResumeCaseId &&
        !explicitCaseId
      ) {
        const recentLookup = await recentCaseQuery.refetch();
        if (recentLookup.data) {
          applyDraft((current) => ({
            ...current,
            mode: null,
            step: "choice",
            dirty: false,
          }));
          return;
        }
      }

      const nextStep = draft.mode === "manual" ? "vehicle" : "report";
      applyDraft((current) => ({
        ...current,
        step: nextStep,
        dirty: Boolean(userId),
        pendingAuthAction: null,
      }));
      if (userId) {
        await ensureCase();
        await flushDraft({ force: true });
      }
    } catch (error) {
      if (error instanceof StaleIdentityOperationError) return;
      setFlowError(errorMessage(error, "We couldn’t prepare your appraisal."));
    } finally {
      setModeBusy(false);
    }
  };

  const handleManualChange = (
    field: keyof TotalLossManualFormValues,
    value: string,
  ) => {
    setManualErrors((current) => ({ ...current, [field]: undefined }));
    setFlowError(null);
    if (field === "vin") {
      resetVinLookup();
    }
    applyDraft((current) => {
      const manual = { ...current.manual, [field]: value };
      if (field === "vin") {
        manual.vehicleYear = "";
        manual.make = "";
        manual.model = "";
        manual.trim = "";
      } else if (field === "vehicleYear" || field === "make") {
        manual.model = "";
        manual.trim = "";
      }
      return { ...current, manual, dirty: true };
    });
  };

  const handleVehicleEntryMethodChange = (method: VehicleEntryMethod) => {
    setVehicleEntryMethod(method);
    setFlowError(null);
    setManualErrors((current) => ({
      ...current,
      vin: undefined,
      vehicleYear: undefined,
      make: undefined,
      model: undefined,
      trim: undefined,
    }));
    resetVinLookup();
    applyDraft((current) => ({
      ...current,
      manual:
        method === "details"
          ? { ...current.manual, vin: "" }
          : {
              ...current.manual,
              vehicleYear: "",
              make: "",
              model: "",
              trim: "",
            },
      dirty: true,
    }));
  };

  const handleManualBlur = (field: keyof TotalLossManualFormValues) => {
    const normalized = normalizeTotalLossManualForm(draftRef.current.manual);
    const errors = validateTotalLossManualForm(normalized);
    applyDraft((current) => ({
      ...current,
      manual: normalized,
      dirty: current.dirty,
    }));
    setManualErrors((current) => ({ ...current, [field]: errors[field] }));
  };

  const handleVehicleContinue = async () => {
    const normalized = normalizeTotalLossManualForm(draftRef.current.manual);
    if (
      activeVehicleEntryMethod === "vin" &&
      (!normalized.vehicleYear || !normalized.make || !normalized.model)
    ) {
      const vinError = validateVin(normalized.vin);
      if (vinError) {
        setManualErrors((current) => ({ ...current, vin: vinError }));
        setFlowError("Enter a valid VIN before looking up the vehicle.");
        focusFirstManualError({ vin: vinError });
        return;
      }
      const decoded = await decodeVin(normalized.vin);
      if (!decoded) return;
      applyDraft((current) => ({
        ...current,
        manual: {
          ...current.manual,
          vin: decoded.vin,
          vehicleYear: String(decoded.year),
          make: decoded.make,
          model: decoded.model,
          trim: decoded.trim ?? "",
          mileageAtLoss: normalized.mileageAtLoss,
        },
        step: "vehicle",
        dirty: true,
      }));
      setFlowError(
        decoded.trim
          ? "Confirm the decoded year, make, model, and trim before continuing."
          : "Choose or enter the exact trim before continuing.",
      );
      return;
    }

    const errors = vehicleErrors(validateTotalLossManualForm(normalized));
    setManualErrors((current) => ({ ...current, ...errors }));
    if (hasTotalLossManualFormErrors(errors)) {
      setFlowError("Review the highlighted vehicle fields before continuing.");
      focusFirstManualError(errors);
      return;
    }
    setFlowError(null);
    applyDraft((current) => ({
      ...current,
      manual: normalized,
      step: "claim",
      dirty: true,
    }));
  };

  const handleManualContinue = () => {
    const normalized = normalizeTotalLossManualForm(draftRef.current.manual);
    const errors = validateTotalLossManualForm(normalized);
    setManualErrors(errors);
    if (hasTotalLossManualFormErrors(errors)) {
      setFlowError("Review the highlighted fields before continuing.");
      focusFirstManualError(errors);
      return;
    }
    setFlowError(null);
    applyDraft((current) => ({
      ...current,
      manual: normalized,
      step: "contact",
      dirty: true,
    }));
  };

  const handleContactChange = <K extends keyof TotalLossDraft["contact"]>(
    field: K,
    value: TotalLossDraft["contact"][K],
  ) => {
    setContactErrors((current) => ({ ...current, [field]: undefined }));
    setFlowError(null);
    setAccessLinkError(null);
    applyDraft((current) => ({
      ...current,
      contact: { ...current.contact, [field]: value },
    }));
  };

  const handleContactContinue = async () => {
    const normalized = normalizeTotalLossContactForm(draftRef.current.contact);
    const errors = validateTotalLossContactForm(normalized);
    setContactErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFlowError("Review the highlighted contact and acknowledgement fields.");
      window.setTimeout(() => {
        const target = errors.fullName
          ? "total-loss-contact-name"
          : errors.email
            ? "total-loss-contact-email"
            : null;
        if (target) document.getElementById(target)?.focus();
      }, 0);
      return;
    }
    if (!identityService || !userId) {
      setFlowError("Secure results access is temporarily unavailable.");
      return;
    }

    setCompletionBusy(true);
    setFlowError(null);
    setAccessLinkError(null);
    try {
      const caseId = await ensureCase();
      await flushDraft({ force: true });
      const claim = await identityService.saveContactAndBeginClaim({
        caseId,
        userId,
        fullName: normalized.fullName,
        email: normalized.email,
        serviceTermsVersion: CURRENT_SERVICE_TERMS_VERSION,
        privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
        operationalFollowUpAllowed: normalized.operationalFollowUpAllowed,
      });
      let accessClaimId = claim.claimId;
      let accessClaimExpiresAt = claim.expiresAt;
      if (
        accessClaimId &&
        isPermanentAuthState(auth) &&
        auth.user.email_confirmed_at &&
        auth.user.email?.trim().toLowerCase() === normalized.email
      ) {
        try {
          await identityService.completeIdentityClaim(accessClaimId);
          accessClaimId = null;
          accessClaimExpiresAt = null;
        } catch {
          // A same-account claim can still use the ordinary expiring access
          // link if the immediate idempotent completion response is lost.
        }
      }
      applyDraft((current) => ({
        ...current,
        contact: normalized,
        identityClaimId: accessClaimId,
        identityClaimExpiresAt: accessClaimExpiresAt,
        accessLinkSentAt: accessClaimId ? null : current.accessLinkSentAt,
        step: "review",
      }));

      if (accessClaimId) {
        try {
          await sendMagicLink(normalized.email, {
            returnTo: "/appraisals",
            callbackParameters: { case_claim: accessClaimId },
          });
          const sentAt = new Date().toISOString();
          applyDraft((current) => ({
            ...current,
            accessLinkSentAt: sentAt,
          }));
        } catch (error) {
          setAccessLinkError(
            `Your intake is saved. ${getFriendlyAuthError(error, "email")} You can still analyze in this browser.`,
          );
        }
      }
    } catch (error) {
      setFlowError(
        errorMessage(
          error,
          "We couldn’t save where to send your results. Try again.",
        ),
      );
    } finally {
      setCompletionBusy(false);
    }
  };

  const handleStartAnalysis = async () => {
    if (!draftRef.current.mode) return;
    setCompletionBusy(true);
    setFlowError(null);
    try {
      const caseId = await ensureCase();
      await flushDraft({ force: true });
      if (draftRef.current.mode === "report" && auth.status === "signedIn") {
        try {
          await ingestTotalLossReport(caseId, auth.session.access_token);
        } catch {
          // Confirmation can still use the complete customer-confirmed facts
          // when refreshing the current report extraction is unavailable.
        }
      }
      if (
        !detailsService?.confirmIntake ||
        !userId ||
        !serverUpdatedAtRef.current
      ) {
        throw new Error("The securely saved intake is not ready to confirm.");
      }
      const confirmed = await detailsService.confirmIntake({
        caseId,
        userId,
        expectedUpdatedAt: serverUpdatedAtRef.current,
      });
      serverUpdatedAtRef.current = confirmed.updatedAt;
      queryClient.setQueryData(
        totalLossQueryKeys.details(userId, caseId),
        confirmed,
      );
      applyDraft(
        (current) => ({
          ...current,
          step: "ready",
          dirty: false,
        }),
        { bumpRevision: false },
      );
      void navigate(`/total-loss/cases/${caseId}/analysis`, { replace: true });
    } catch (error) {
      setFlowError(
        errorMessage(error, "We couldn’t start the analysis. Try again."),
      );
    } finally {
      setCompletionBusy(false);
    }
  };

  const runReportIngestion = useCallback(
    (caseId: string) => {
      if (reportIngestionPromiseRef.current?.caseId === caseId) {
        return reportIngestionPromiseRef.current.promise;
      }

      const operation = (async () => {
        if (auth.status !== "signedIn") {
          throw new Error("Secure guest storage is not ready.");
        }
        setExtractionState("processing");
        applyDraft((current) => ({
          ...current,
          reportExtractionStatus: "processing",
          reportExtractionWarnings: [],
          reportProvider: null,
        }));
        try {
          const ingestion = await ingestTotalLossReport(
            caseId,
            auth.session.access_token,
          );
          const nextManual = manualValuesForReportIngestion(
            ingestion,
            draftRef.current.manual,
          );
          setExtractionState(ingestion.status);
          applyDraft((current) => ({
            ...current,
            manual: nextManual,
            mode: "report",
            reportProvider: ingestion.provider,
            reportExtractionStatus: ingestion.status,
            reportExtractionWarnings: [...ingestion.warnings],
            dirty: true,
          }));
          await flushDraft({ force: true });
          return ingestion;
        } catch (error) {
          setExtractionState("error");
          applyDraft((current) => ({
            ...current,
            reportExtractionStatus: "error",
            reportExtractionWarnings: [REPORT_EXTRACTION_FAILURE_WARNING],
          }));
          throw error;
        }
      })();

      reportIngestionPromiseRef.current = { caseId, promise: operation };
      void operation
        .finally(() => {
          if (reportIngestionPromiseRef.current?.promise === operation) {
            reportIngestionPromiseRef.current = null;
          }
        })
        .catch(() => undefined);
      return operation;
    },
    [applyDraft, auth, flushDraft],
  );

  useEffect(() => {
    const details = detailsQuery.data;
    if (
      auth.status !== "signedIn" ||
      !details ||
      details.intakeMode !== "report" ||
      !details.reportOriginalFilename ||
      details.reportExtractionStatus !== "pending" ||
      extractionState !== "processing"
    ) {
      return;
    }

    const resumeKey = `${details.caseId}:${details.updatedAt}`;
    if (pendingExtractionResumeKeyRef.current === resumeKey) return;
    pendingExtractionResumeKeyRef.current = resumeKey;
    void runReportIngestion(details.caseId).catch(() => undefined);
  }, [auth.status, detailsQuery.data, extractionState, runReportIngestion]);

  const uploadSelectedReport = async (files: readonly File[]) => {
    setRetryFiles(files);
    setSelectedFilename(
      files.length === 1 ? files[0]?.name ?? null : `${files.length} image pages`,
    );
    setUploadState("uploading");
    setExtractionState("idle");
    setUploadError(null);
    setFlowError(null);
    const identityGeneration = identityRef.current.generation;
    const uploadUserId = identityRef.current.userId;
    try {
      const normalized = await normalizeTotalLossReportFiles(files);
      setSelectedFilename(normalized.displayFilename);
      const caseId = await ensureCase();
      await flushDraft({ force: true });
      const result = await uploadReport({
        caseId,
        expectedUpdatedAt: serverUpdatedAtRef.current,
        file: normalized.file,
        preserveExistingReport: Boolean(resolvedSavedFilename),
      });
      if (
        identityRef.current.generation !== identityGeneration ||
        identityRef.current.userId !== uploadUserId
      ) {
        if (uploadUserId) clearStaleUserCache(uploadUserId);
        throw new StaleIdentityOperationError();
      }
      serverUpdatedAtRef.current = result.details.updatedAt;
      hydratedDetailsRef.current = `${result.details.caseId}:${result.details.updatedAt}`;
      setSavedFilename(result.details.reportOriginalFilename);
      setUploadState("success");
      applyDraft(
        (current) => ({
          ...current,
          mode: "report",
          reportProvider: null,
          reportExtractionStatus: "processing",
          reportExtractionWarnings: [],
          dirty: true,
        }),
        { bumpRevision: false },
      );
      try {
        await runReportIngestion(caseId);
      } catch {
        setExtractionState("error");
      }
      setRetryFiles([]);
      setSelectedFilename(null);
    } catch (error) {
      if (
        error instanceof StaleIdentityOperationError ||
        identityRef.current.generation !== identityGeneration ||
        identityRef.current.userId !== uploadUserId
      ) {
        if (uploadUserId) clearStaleUserCache(uploadUserId);
        return;
      }
      setUploadState("error");
      setExtractionState("error");
      if (error instanceof TotalLossDetailsConflictError) {
        setConflict(error.currentDetails);
        setConflictWithoutRow(error.currentDetails === null);
      }
      setUploadError(
        error instanceof TotalLossReportNormalizationError
          ? error.message
          : errorMessage(
              error,
              "The report could not be read or saved. Replace it or try again.",
            ),
      );
    }
  };

  const handleReportContinue = async () => {
    setFlowError(null);
    if (!resolvedSavedFilename) {
      setFlowError("Upload your insurance valuation report before continuing.");
      return;
    }
    if (
      extractionState !== "complete" &&
      extractionState !== "partial" &&
      extractionState !== "error"
    ) {
      try {
        const caseId = await ensureCase();
        await runReportIngestion(caseId);
      } catch (error) {
        setExtractionState("error");
        applyDraft((current) => ({
          ...current,
          reportExtractionStatus: "error",
          reportExtractionWarnings: [
            errorMessage(
              error,
              "Automatic extraction could not finish. Complete the details manually.",
            ),
          ],
        }));
      }
    }
    setVehicleEntryMethod(
      draftRef.current.manual.vin ? "vin" : "details",
    );
    applyDraft((current) => ({ ...current, step: "vehicle", dirty: true }));
  };

  const handleRetryUpload = () => {
    if (retryFiles.length > 0) void uploadSelectedReport(retryFiles);
  };

  const handleResume = async () => {
    if (!candidate || !userId) return;
    const identityGeneration = identityRef.current.generation;
    const resumeUserId = userId;
    setResumeBusy(true);
    setFlowError(null);
    try {
      const [details, contact] = await Promise.all([
        dependencies?.totalLossDetailsService.getDetails({
          caseId: candidate.id,
          userId,
        }),
        dependencies?.totalLossIdentityService?.getContact(candidate.id) ??
          Promise.resolve(null),
      ]);
      if (
        identityRef.current.generation !== identityGeneration ||
        identityRef.current.userId !== resumeUserId
      ) {
        throw new StaleIdentityOperationError();
      }
      serverUpdatedAtRef.current = details?.updatedAt ?? null;
      hydratedDetailsRef.current = details
        ? `${details.caseId}:${details.updatedAt}`
        : null;
      setSavedFilename(details?.reportOriginalFilename ?? null);
      const resumedExtractionState = details
        ? extractionStateForDetails(details)
        : "idle";
      setExtractionState(resumedExtractionState);
      applyDraft((current) => ({
        ...current,
        confirmedCaseId: candidate.id,
        reservedCaseId: candidate.id,
        ownerUserId: userId,
        mode: details?.intakeMode ?? null,
        manual: details ? manualValuesForDetails(details) : current.manual,
        contact: contact
          ? {
              fullName: contact.fullName,
              email: contact.email,
              termsAccepted: true,
              privacyAccepted: true,
              operationalFollowUpAllowed:
                contact.operationalFollowUpAllowed,
            }
          : current.contact,
        reportProvider: details?.reportProvider ?? null,
        reportExtractionStatus: resumedExtractionState,
        reportExtractionWarnings: details
          ? extractionWarningsForDetails(details, current)
          : [],
        step: details
          ? details.intakeCompletedAt
            ? "ready"
            : contact
              ? "review"
              : stepForDetails(details, "choice")
          : "choice",
        pendingAuthAction: null,
        dirty: false,
      }));
    } catch (error) {
      if (
        error instanceof StaleIdentityOperationError ||
        identityRef.current.generation !== identityGeneration ||
        identityRef.current.userId !== resumeUserId
      ) {
        return;
      }
      setFlowError(
        errorMessage(error, "We couldn’t open the saved appraisal."),
      );
    } finally {
      if (
        identityRef.current.generation === identityGeneration &&
        identityRef.current.userId === resumeUserId
      ) {
        setResumeBusy(false);
      }
    }
  };

  const handleStartNew = () => {
    if (!candidate || !userId) return;
    const next: TotalLossDraft = {
      ...createEmptyTotalLossDraft(),
      ownerUserId: userId,
      dismissedResumeCaseId: candidate.id,
    };
    draftRef.current = next;
    setDraft(next);
    const result = writeTotalLossDraft(next);
    setStorageError(!result.ok);
    serverUpdatedAtRef.current = null;
    hydratedDetailsRef.current = null;
    setSavedFilename(null);
    setFlowError(null);
  };

  const handleUseSavedConflict = () => {
    if (!conflict) return;
    const savedExtractionState = extractionStateForDetails(conflict);
    serverUpdatedAtRef.current = conflict.updatedAt;
    hydratedDetailsRef.current = `${conflict.caseId}:${conflict.updatedAt}`;
    setSavedFilename(conflict.reportOriginalFilename);
    setExtractionState(savedExtractionState);
    applyDraft((current) => ({
      ...current,
      mode: conflict.intakeMode,
      manual: manualValuesForDetails(conflict),
      reportExtractionStatus: savedExtractionState,
      reportExtractionWarnings: extractionWarningsForDetails(
        conflict,
        current,
      ),
      step: stepForDetails(conflict, current.step),
      dirty: false,
    }));
    setConflict(null);
    setConflictWithoutRow(false);
    setSaveState("saved");
  };

  const handleKeepLocalConflict = () => {
    serverUpdatedAtRef.current = conflict?.updatedAt ?? null;
    setConflict(null);
    setConflictWithoutRow(false);
    setSaveState("idle");
    applyDraft((current) => ({ ...current, dirty: true }));
    void flushDraft({ force: true }).catch(() => undefined);
  };

  const renderStep = () => {
    if (candidate) {
      return (
        <ResumeStep
          summary={resumeSummary(candidateDetails)}
          savedAt={formatSavedDate(candidate.lastActivityAt)}
          busy={resumeBusy}
          error={flowError}
          onContinue={() => void handleResume()}
          onStartNew={handleStartNew}
        />
      );
    }

    switch (draft.step) {
      case "vehicle":
        return (
          <VehicleStep
            values={draft.manual}
            errors={manualErrors}
            entryMethod={activeVehicleEntryMethod}
            makeOptions={makeOptions}
            modelOptions={modelOptions}
            makesState={makesState}
            modelsState={modelsState}
            vinLookupState={vinLookupState}
            vinLookupMessage={vinLookupMessage}
            busy={busy}
            fieldsDisabled={completionBusy}
            error={flowError}
            onEntryMethodChange={handleVehicleEntryMethodChange}
            onRetryMakes={retryMakes}
            onRetryModels={retryModels}
            onChange={handleManualChange}
            onBlur={handleManualBlur}
            onBack={() => {
              setFlowError(null);
              applyDraft((current) => ({
                ...current,
                step: current.mode === "report" ? "report" : "choice",
                pendingAuthAction: null,
              }));
            }}
            onContinue={() => void handleVehicleContinue()}
          />
        );
      case "claim":
        return (
          <ClaimStep
            values={draft.manual}
            errors={manualErrors}
            busy={busy}
            fieldsDisabled={completionBusy}
            error={flowError}
            onChange={handleManualChange}
            onBlur={handleManualBlur}
            onBack={() => {
              setFlowError(null);
              applyDraft((current) => ({
                ...current,
                step: "vehicle",
                pendingAuthAction: null,
              }));
            }}
            onContinue={() => void handleManualContinue()}
          />
        );
      case "report":
        return (
          <ReportStep
            storageAvailable={Boolean(storageService)}
            selectedFilename={selectedFilename}
            savedFilename={resolvedSavedFilename}
            uploadState={uploadState}
            extractionState={extractionState}
            reportProvider={draft.reportProvider}
            extractionWarnings={draft.reportExtractionWarnings}
            uploadError={uploadError}
            error={flowError}
            completing={completionBusy || saveState === "saving"}
            onBack={() => {
              setFlowError(null);
              setUploadError(null);
              applyDraft((current) => ({
                ...current,
                step: "choice",
                pendingAuthAction: null,
              }));
            }}
            onFilesSelected={uploadSelectedReport}
            onRetryUpload={handleRetryUpload}
            onContinue={() => void handleReportContinue()}
          />
        );
      case "contact":
        return (
          <ContactStep
            values={draft.contact}
            errors={contactErrors}
            emailLocked={Boolean(
              isPermanentAuthState(auth) &&
                auth.user.email &&
                auth.user.email_confirmed_at,
            )}
            busy={completionBusy}
            error={flowError}
            accessLinkSent={Boolean(draft.accessLinkSentAt)}
            onChange={handleContactChange}
            onBack={() => {
              setFlowError(null);
              applyDraft((current) => ({ ...current, step: "claim" }));
            }}
            onContinue={() => void handleContactContinue()}
          />
        );
      case "review":
        return draft.mode ? (
          <ReviewStep
            mode={draft.mode}
            values={draft.manual}
            contact={draft.contact}
            reportFilename={resolvedSavedFilename}
            reportProvider={draft.reportProvider}
            busy={completionBusy}
            error={flowError}
            onBack={() => {
              setFlowError(null);
              applyDraft((current) => ({ ...current, step: "contact" }));
            }}
            onEditVehicle={() =>
              applyDraft((current) => ({ ...current, step: "vehicle" }))
            }
            onEditClaim={() =>
              applyDraft((current) => ({ ...current, step: "claim" }))
            }
            onStartAnalysis={() => void handleStartAnalysis()}
          />
        ) : null;
      case "ready":
        return (
          <ReadyStep
            mode={draft.mode}
            busy={completionBusy}
            onReplaceReport={
              draft.mode === "report"
                ? () => {
                    setFlowError(null);
                    applyDraft((current) => ({
                      ...current,
                      step: "report",
                      pendingAuthAction: null,
                    }));
                  }
                : undefined
            }
            onStartValueCheck={
              confirmedCaseId
                ? () =>
                    void navigate(
                      `/total-loss/cases/${confirmedCaseId}/analysis`,
                    )
                : undefined
            }
          />
        );
      case "choice":
      default:
        return (
          <ChoiceStep
            selectedMode={draft.mode}
            busy={modeBusy || createCaseMutation.isPending}
            error={flowError}
            onSelect={(mode: TotalLossIntakeMode) => {
              setFlowError(null);
              applyDraft((current) => ({
                ...current,
                manual: current.manual,
                mode,
                step: "choice",
                pendingAuthAction: null,
                dirty: current.confirmedCaseId ? true : current.dirty,
              }));
            }}
            onContinue={() => void handleModeContinue()}
          />
        );
    }
  };

  return (
    <>
      {storageError ? (
        <Notice
          icon={<CloudOff className="size-5" aria-hidden />}
          title="Browser draft storage is unavailable"
          message="Keep this page open while Venfour saves your secure draft."
        />
      ) : null}
      {accessLinkError ? (
        <Notice
          title="Results access email not sent"
          message={accessLinkError}
        />
      ) : null}
      {invalidExplicitCaseId || explicitCaseError ? (
        <Notice
          title="Saved appraisal unavailable"
          message={
            invalidExplicitCaseId
              ? "This saved-appraisal link is not valid."
              : (explicitCaseError ?? "The saved appraisal is unavailable.")
          }
        />
      ) : null}
      {recentCaseQuery.isError && !hasMeaningfulLocalDraft(draft) ? (
        <Notice
          title="Saved appraisal lookup unavailable"
          message="You can still start here. We’ll try the saved-appraisal lookup again later."
        />
      ) : null}
      {conflict || conflictWithoutRow ? (
        <ConflictNotice
          hasServerVersion={Boolean(conflict)}
          onUseSaved={handleUseSavedConflict}
          onKeepLocal={handleKeepLocalConflict}
        />
      ) : null}

      {explicitCaseBlocked ? (
        <UnavailableCaseCard />
      ) : explicitCasePending ||
        draftIdentityUnverified ||
        readyStateVerificationPending ||
        (detailsQuery.isLoading && confirmedCaseId && !draft.dirty) ? (
        <LoadingCard />
      ) : readyStateLoadError ? (
        <SavedDetailsLoadErrorCard
          onRetry={() => void detailsQuery.refetch()}
        />
      ) : (
        <IntakeStepTransition
          transitionKey={renderedStepKey}
          direction={stepTransitionDirection}
        >
          {renderStep()}
        </IntakeStepTransition>
      )}
    </>
  );
}

class StaleIdentityOperationError extends Error {
  constructor() {
    super("The signed-in account changed while this operation was running.");
    this.name = "StaleIdentityOperationError";
  }
}

function loadInitialDraft(
  bootstrapCase: AppraisalCase,
  userId: string,
): InitialDraftState {
  const stored = readTotalLossDraft();
  if (stored.ok) {
    const storedDraft = stored.draft ?? createEmptyTotalLossDraft();
    const belongsToBootstrapCase =
      (!storedDraft.ownerUserId || storedDraft.ownerUserId === userId) &&
      (!storedDraft.confirmedCaseId ||
        storedDraft.confirmedCaseId === bootstrapCase.id);
    const draft = {
      ...(belongsToBootstrapCase ? storedDraft : createEmptyTotalLossDraft()),
      confirmedCaseId: bootstrapCase.id,
      reservedCaseId: bootstrapCase.id,
      ownerUserId: userId,
      dismissedResumeCaseId: null,
    };
    return {
      draft,
      storageError: !writeTotalLossDraft(draft).ok,
    };
  }
  const draft = {
    ...createEmptyTotalLossDraft(),
    confirmedCaseId: bootstrapCase.id,
    reservedCaseId: bootstrapCase.id,
    ownerUserId: userId,
  };
  return { draft, storageError: !writeTotalLossDraft(draft).ok };
}

function detailsValuesForDraft(
  draft: TotalLossDraft,
): CreateTotalLossDetailsValues {
  if (draft.mode === "manual") {
    return totalLossManualFormToDetailsValues(draft.manual);
  }
  return totalLossReportFormToDetailsValues(draft.manual);
}

function manualValuesForReportIngestion(
  ingestion: TotalLossReportIngestion,
  current: TotalLossManualFormValues,
): TotalLossManualFormValues {
  const facts = ingestion.facts;
  return {
    ...current,
    vin: facts.vin ?? current.vin,
    vehicleYear:
      facts.vehicleYear === null
        ? current.vehicleYear
        : String(facts.vehicleYear),
    make: facts.make ?? current.make,
    model: facts.model ?? current.model,
    trim: facts.trim ?? current.trim,
    mileageAtLoss:
      facts.mileageAtLoss === null
        ? current.mileageAtLoss
        : String(facts.mileageAtLoss),
    zipCode: facts.zipCode ?? current.zipCode,
    dateOfLoss: facts.dateOfLoss ?? current.dateOfLoss,
    insurerName: facts.insurerName ?? current.insurerName,
    insurerVehicleValuation:
      facts.insurerVehicleValuation === null
        ? current.insurerVehicleValuation
        : facts.insurerVehicleValuation.toFixed(2),
    vehicleCondition: facts.vehicleCondition ?? current.vehicleCondition,
    optionsPackages: facts.optionsPackages ?? current.optionsPackages,
  };
}

function manualValuesForDetails(
  details: TotalLossCaseDetails,
): TotalLossManualFormValues {
  return totalLossDetailsToManualForm(details);
}

function extractionStateForDetails(
  details: TotalLossCaseDetails,
): TotalLossReportExtractionStatus {
  if (details.intakeMode !== "report" || !details.reportOriginalFilename) {
    return "idle";
  }

  switch (details.reportExtractionStatus) {
    case "pending":
      return "processing";
    case "needs_confirmation":
      return "partial";
    case "confirmed":
      return "complete";
    case "failed":
      return "error";
    case "not_requested":
    case null:
    case undefined:
      return "idle";
  }
}

function extractionWarningsForDetails(
  details: TotalLossCaseDetails,
  current: TotalLossDraft,
) {
  const state = extractionStateForDetails(details);
  if (state === "error") return [REPORT_EXTRACTION_FAILURE_WARNING];
  if (
    state === "partial" &&
    current.confirmedCaseId === details.caseId &&
    current.reportExtractionStatus === "partial"
  ) {
    return current.reportExtractionWarnings;
  }
  return [];
}

function stepForDetails(
  details: TotalLossCaseDetails,
  currentStep: TotalLossDraft["step"],
): TotalLossDraft["step"] {
  if (details.intakeCompletedAt) return "ready";
  const serverMinimumStep =
    details.intakeMode === "report" ? "report" : "vehicle";
  return intakeStepPosition(currentStep) >= intakeStepPosition(serverMinimumStep)
    ? currentStep
    : serverMinimumStep;
}

function hasMeaningfulManualDraft(draft: TotalLossDraft) {
  return Object.values(draft.manual).some((value) => value.trim().length > 0);
}

function hasMeaningfulLocalDraft(draft: TotalLossDraft) {
  return Boolean(
    draft.mode ||
    draft.confirmedCaseId ||
    draft.reservedCaseId ||
    draft.pendingAuthAction ||
    hasMeaningfulManualDraft(draft),
  );
}

function recentCandidateVisible(
  draft: TotalLossDraft,
  candidateId: string | undefined,
  explicitCaseId: string | null,
) {
  return Boolean(
    candidateId &&
    !explicitCaseId &&
    !hasMeaningfulLocalDraft(draft) &&
    draft.dismissedResumeCaseId !== candidateId,
  );
}

function vehicleErrors(errors: TotalLossManualFormErrors) {
  const vehicleFields: (keyof TotalLossManualFormValues)[] = [
    "vin",
    "vehicleYear",
    "make",
    "model",
    "trim",
    "mileageAtLoss",
  ];
  return Object.fromEntries(
    vehicleFields.flatMap((field) =>
      errors[field] ? [[field, errors[field]]] : [],
    ),
  ) as TotalLossManualFormErrors;
}

const fieldIds: Record<keyof TotalLossManualFormValues, string> = {
  vin: "total-loss-vin",
  vehicleYear: "total-loss-year",
  make: "total-loss-make",
  model: "total-loss-model",
  trim: "total-loss-trim",
  mileageAtLoss: "total-loss-mileage",
  zipCode: "total-loss-zip",
  dateOfLoss: "total-loss-date",
  insurerName: "total-loss-insurer",
  insurerVehicleValuation: "total-loss-valuation",
  vehicleCondition: "total-loss-condition",
  optionsPackages: "total-loss-options",
};

function focusFirstManualError(errors: TotalLossManualFormErrors) {
  const firstField = Object.keys(fieldIds).find(
    (field) => errors[field as keyof TotalLossManualFormValues],
  ) as keyof TotalLossManualFormValues | undefined;
  if (!firstField) return;
  window.setTimeout(
    () => document.getElementById(fieldIds[firstField])?.focus(),
    0,
  );
}

function resumeSummary(details: TotalLossCaseDetails | null) {
  if (!details) return "Total-loss intake";
  const vehicle = [
    details.vehicleYear === null ? null : String(details.vehicleYear),
    details.vehicleMake,
    details.vehicleModel,
  ].filter(Boolean);
  if (vehicle.length) return vehicle.join(" ");
  return details.intakeMode === "report" ? "Report intake" : "Manual intake";
}

function formatSavedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function vehicleEntryMethodForValues(
  values: TotalLossManualFormValues,
  fallback: VehicleEntryMethod = "vin",
): VehicleEntryMethod {
  return values.vin
    ? "vin"
    : values.vehicleYear || values.make || values.model
      ? "details"
      : fallback;
}

function intakeStepPosition(step: TotalLossDraft["step"] | "resume") {
  switch (step) {
    case "vehicle":
    case "report":
      return 1;
    case "claim":
      return 2;
    case "contact":
      return 3;
    case "review":
      return 4;
    case "ready":
      return 5;
    case "resume":
    case "choice":
    default:
      return 0;
  }
}

function Notice({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: React.ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
      role="status"
    >
      <span className="mt-0.5 shrink-0">
        {icon ?? <AlertCircle className="size-5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-6 text-amber-900">{message}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ConflictNotice({
  hasServerVersion,
  onUseSaved,
  onKeepLocal,
}: {
  hasServerVersion: boolean;
  onUseSaved: () => void;
  onKeepLocal: () => void;
}) {
  return (
    <div
      className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 size-5 shrink-0 text-red-700"
          aria-hidden
        />
        <div>
          <p className="text-sm font-semibold text-red-950">
            This appraisal changed in another session
          </p>
          <p className="mt-1 text-sm leading-6 text-red-900">
            Your browser draft is still here. Choose which version to continue
            before Venfour saves again.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hasServerVersion ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                onClick={onUseSaved}
              >
                Use saved version
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-red-950 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
              onClick={onKeepLocal}
            >
              <RefreshCw className="size-4" aria-hidden />
              Save this device’s version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingCard() {
  return (
    <section
      className="rounded-2xl border border-line bg-white p-8 text-center shadow-[0_22px_64px_-48px_rgba(11,31,51,0.42)]"
      aria-busy="true"
    >
      <RefreshCw
        className="mx-auto size-6 animate-spin text-brand motion-reduce:animate-none"
        aria-hidden
      />
      <p className="mt-3 text-sm font-semibold text-ink" role="status">
        Loading your saved appraisal…
      </p>
    </section>
  );
}

function UnavailableCaseCard() {
  return (
    <section className="rounded-2xl border border-line bg-white p-8 text-center shadow-[0_22px_64px_-48px_rgba(11,31,51,0.42)]">
      <p className="text-sm font-semibold text-ink">
        This saved appraisal cannot be opened from this link.
      </p>
      <p className="mt-2 text-sm leading-6 text-copy">
        Open your appraisals to continue from the case’s current stage.
      </p>
      <Link
        className={`${primaryFlowButtonClassName} mt-6`}
        to="/appraisals"
      >
        View my appraisals
      </Link>
    </section>
  );
}

function DraftBootstrapErrorCard({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <FlowCard className="text-center">
      <AlertCircle className="mx-auto size-7 text-red-700" aria-hidden />
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink">
        We couldn’t prepare your Total Loss draft
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-copy">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          className={`${primaryFlowButtonClassName} mt-6`}
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}
    </FlowCard>
  );
}

function SavedDetailsLoadErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <FlowCard className="text-center">
      <h2 className="text-2xl font-semibold tracking-[-0.03em] text-ink">
        We couldn’t load this saved appraisal
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-copy">
        Your browser draft is still here, but Venfour must confirm the saved
        case before showing a completed intake.
      </p>
      <button
        type="button"
        className={`${primaryFlowButtonClassName} mt-6`}
        onClick={onRetry}
      >
        Try again
      </button>
    </FlowCard>
  );
}
