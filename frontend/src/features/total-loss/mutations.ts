import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import type {
  CreateTotalLossDetailsValues,
  TotalLossReportUploadLease,
  TotalLossDetailsChanges,
} from "@/features/total-loss/data-types";
import { totalLossQueryKeys } from "@/features/total-loss/queries";
import {
  TotalLossDetailsConflictError,
  type TotalLossDetailsService,
  TotalLossReportUploadBusyError,
  TotalLossReportUploadLeaseLostError,
} from "@/features/total-loss/service";
import type {
  TotalLossReportStorageService,
  TotalLossReportUpload,
} from "@/features/total-loss/storage-service";

interface TotalLossMutationOptions {
  readonly detailsService: TotalLossDetailsService | null;
  readonly userId: string | null;
}

export type SaveTotalLossDetailsMutationInput =
  | {
      readonly caseId: string;
      readonly expectedUpdatedAt: null;
      readonly values: CreateTotalLossDetailsValues;
    }
  | {
      readonly caseId: string;
      readonly expectedUpdatedAt: string;
      readonly values: TotalLossDetailsChanges;
    };

interface UploadTotalLossReportMutationOptions extends TotalLossMutationOptions {
  readonly storageService: TotalLossReportStorageService | null;
  readonly createUploadId?: () => string;
  readonly now?: () => Date;
}

export interface UploadTotalLossReportMutationInput {
  readonly caseId: string;
  readonly expectedUpdatedAt: string | null;
  readonly file: File;
  readonly preserveExistingReport?: boolean;
}

export interface UploadTotalLossReportMutationResult {
  readonly upload: TotalLossReportUpload;
  readonly details: Awaited<
    ReturnType<TotalLossDetailsService["finalizeReportUpload"]>
  >;
}

export class TotalLossDataAuthenticationError extends Error {
  constructor() {
    super("Sign in before saving total-loss information.");
    this.name = "TotalLossDataAuthenticationError";
  }
}

export class TotalLossDataUnavailableError extends Error {
  constructor() {
    super("Secure total-loss storage is not configured.");
    this.name = "TotalLossDataUnavailableError";
  }
}

export class TotalLossReportRestoreError extends Error {
  constructor() {
    super(
      "The replacement metadata could not be saved, and the previous report could not be restored. Try the upload again before continuing.",
    );
    this.name = "TotalLossReportRestoreError";
  }
}

type RetainedReportUploadStage =
  | "preparing"
  | "backup-stored"
  | "ready"
  | "needs-recovery"
  | "recovery-completing"
  | "cancelling";

interface RetainedReportUpload {
  readonly caseId: string;
  readonly userId: string;
  lease: TotalLossReportUploadLease;
  stage: RetainedReportUploadStage;
  hasBackup: boolean;
}

interface PendingReportUploadAcquire {
  readonly caseId: string;
  readonly expectedUpdatedAt: string | null;
  readonly uploadId: string;
  readonly userId: string;
}

function requireUserId(userId: string | null) {
  if (!userId) throw new TotalLossDataAuthenticationError();
  return userId;
}

function requireService<T>(service: T | null): T {
  if (!service) throw new TotalLossDataUnavailableError();
  return service;
}

function useActiveMutationUserId(userId: string | null) {
  const activeUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    activeUserIdRef.current = userId;
    return () => {
      activeUserIdRef.current = null;
    };
  }, [userId]);
  return activeUserIdRef;
}

async function refreshTotalLossCaseQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: appraisalCaseQueryKeys.list(userId),
    }),
    queryClient.invalidateQueries({
      queryKey: appraisalCaseQueryKeys.recentDraft(userId, "total_loss"),
    }),
  ]);
}

export function useSaveTotalLossDetailsMutation({
  detailsService,
  userId,
}: TotalLossMutationOptions) {
  const queryClient = useQueryClient();
  const activeUserIdRef = useActiveMutationUserId(userId);

  return useMutation({
    mutationFn: (input: SaveTotalLossDetailsMutationInput) =>
      requireService(detailsService).saveDetails({
        ...input,
        userId: requireUserId(userId),
      }),
    onSuccess: async (details) => {
      if (activeUserIdRef.current !== userId) return;
      queryClient.setQueryData(
        totalLossQueryKeys.details(userId, details.caseId),
        details,
      );
      await refreshTotalLossCaseQueries(queryClient, userId);
    },
    retry: false,
  });
}

export function useUploadTotalLossReportMutation({
  createUploadId = () => crypto.randomUUID(),
  detailsService,
  storageService,
  userId,
  now = () => new Date(),
}: UploadTotalLossReportMutationOptions) {
  const queryClient = useQueryClient();
  const activeUserIdRef = useActiveMutationUserId(userId);
  const pendingAcquireRef = useRef<PendingReportUploadAcquire | null>(null);
  const retainedUploadRef = useRef<RetainedReportUpload | null>(null);

  return useMutation({
    mutationFn: async ({
      caseId,
      expectedUpdatedAt,
      file,
      preserveExistingReport = false,
    }: UploadTotalLossReportMutationInput): Promise<UploadTotalLossReportMutationResult> => {
      const authenticatedUserId = requireUserId(userId);
      const resolvedStorageService = requireService(storageService);
      const resolvedDetailsService = requireService(detailsService);

      const retryOnce = async <T>(operation: () => Promise<T>) => {
        try {
          return await operation();
        } catch {
          return operation();
        }
      };

      const leaseScope = (operation: RetainedReportUpload) => ({
        caseId: operation.caseId,
        uploadId: operation.lease.uploadId,
        userId: operation.userId,
        storageOwnerUserId: operation.lease.storageOwnerUserId,
      });

      const deleteBackupBestEffort = async (
        operation: RetainedReportUpload,
      ) => {
        try {
          await retryOnce(() =>
            resolvedStorageService.deleteReportBackup(leaseScope(operation)),
          );
        } catch {
          // The single reusable backup is overwritten by the next acquired
          // upload before it can be trusted, so failed cleanup cannot create
          // an accumulating set of objects or an unsafe future restore.
        }
      };

      const renew = async (operation: RetainedReportUpload) => {
        let renewed: TotalLossReportUploadLease;
        try {
          renewed = await resolvedDetailsService.renewReportUploadLease(
            leaseScope(operation),
          );
        } catch (error) {
          if (
            error instanceof TotalLossReportUploadLeaseLostError &&
            retainedUploadRef.current === operation
          ) {
            retainedUploadRef.current = null;
          }
          throw error;
        }
        operation.lease = {
          ...renewed,
          storageOwnerUserId:
            renewed.storageOwnerUserId ?? operation.lease.storageOwnerUserId,
        };
        if (renewed.recoveryRequired) {
          operation.stage = "needs-recovery";
          operation.hasBackup = true;
        }
        return renewed;
      };

      const recoverPreviousReport = async (operation: RetainedReportUpload) => {
        try {
          const scope = leaseScope(operation);
          if (operation.stage !== "recovery-completing") {
            const renewed = await renew(operation);
            const backup = await retryOnce(() =>
              resolvedStorageService.downloadReportBackup(scope),
            );
            if (renewed.recoveryRequired) {
              await retryOnce(() =>
                resolvedStorageService.storeReportBackup({
                  ...scope,
                  backup,
                  replaceExisting: true,
                }),
              );
            }
            await retryOnce(() =>
              resolvedStorageService.restoreReport({ ...scope, backup }),
            );
            operation.stage = "recovery-completing";
            retainedUploadRef.current = operation;
          }

          // Completing recovery is idempotent for this token. Keeping a
          // distinct stage means a lost RPC response is retried without first
          // attempting another canonical write after the database may already
          // have moved the lease back to its preparing phase.
          operation.lease = await retryOnce(() =>
            resolvedDetailsService.completeReportUploadRecovery(scope),
          );
          operation.stage = "preparing";
          operation.hasBackup = false;
        } catch (error) {
          if (error instanceof TotalLossReportUploadLeaseLostError) {
            if (retainedUploadRef.current === operation) {
              retainedUploadRef.current = null;
            }
            throw error;
          }
          if (operation.stage !== "recovery-completing") {
            operation.stage = "needs-recovery";
          }
          operation.hasBackup = true;
          retainedUploadRef.current = operation;
          throw new TotalLossReportRestoreError();
        }
      };

      const cancel = async (operation: RetainedReportUpload) => {
        operation.stage = "cancelling";
        retainedUploadRef.current = operation;
        try {
          await retryOnce(() =>
            resolvedDetailsService.cancelReportUpload(leaseScope(operation)),
          );
        } catch (error) {
          if (
            error instanceof TotalLossReportUploadLeaseLostError &&
            retainedUploadRef.current === operation
          ) {
            retainedUploadRef.current = null;
          }
          throw error;
        }
        if (retainedUploadRef.current === operation) {
          retainedUploadRef.current = null;
        }
      };

      const rollbackAndCancel = async (operation: RetainedReportUpload) => {
        const hadBackup = operation.hasBackup;
        if (operation.hasBackup) {
          operation.stage = "needs-recovery";
          await recoverPreviousReport(operation);
        }
        await cancel(operation);
        if (hadBackup) {
          // Backup deletion is intentionally delayed until the lease is
          // cleared. Storage policy rejects this old token if another session
          // has already acquired a newer lease or replaced the backup.
          await deleteBackupBestEffort(operation);
        }
      };

      let operation = retainedUploadRef.current;
      if (
        operation &&
        (operation.caseId !== caseId ||
          operation.userId !== authenticatedUserId)
      ) {
        operation = null;
        retainedUploadRef.current = null;
      }

      const pendingAcquire = pendingAcquireRef.current;
      if (
        pendingAcquire &&
        (pendingAcquire.caseId !== caseId ||
          pendingAcquire.userId !== authenticatedUserId ||
          pendingAcquire.expectedUpdatedAt !== expectedUpdatedAt)
      ) {
        pendingAcquireRef.current = null;
      }

      if (operation?.stage === "cancelling") {
        try {
          await cancel(operation);
        } catch (error) {
          if (!(error instanceof TotalLossReportUploadLeaseLostError)) {
            throw error;
          }
        }
        operation = null;
      }

      if (operation) {
        try {
          await renew(operation);
        } catch (error) {
          if (!(error instanceof TotalLossReportUploadLeaseLostError)) {
            throw error;
          }
          operation = null;
        }
      }

      if (!operation) {
        const acquire = pendingAcquireRef.current ?? {
          caseId,
          expectedUpdatedAt,
          uploadId: createUploadId(),
          userId: authenticatedUserId,
        };
        pendingAcquireRef.current = acquire;
        let lease: TotalLossReportUploadLease;
        try {
          lease = await retryOnce(() =>
            resolvedDetailsService.acquireReportUploadLease(acquire),
          );
        } catch (error) {
          if (
            error instanceof TotalLossDetailsConflictError ||
            error instanceof TotalLossReportUploadBusyError ||
            error instanceof TotalLossReportUploadLeaseLostError
          ) {
            pendingAcquireRef.current = null;
          }
          throw error;
        }
        pendingAcquireRef.current = null;
        operation = {
          caseId,
          userId: authenticatedUserId,
          lease,
          stage: lease.recoveryRequired ? "needs-recovery" : "preparing",
          hasBackup: lease.recoveryRequired,
        };
        retainedUploadRef.current = operation;
      }

      if (
        operation.stage === "needs-recovery" ||
        operation.stage === "recovery-completing"
      ) {
        await recoverPreviousReport(operation);
      }

      const hasExistingReport =
        preserveExistingReport ||
        Boolean(
          operation.lease.reportOriginalFilename &&
          operation.lease.reportUploadedAt,
        );

      if (operation.stage === "preparing") {
        if (hasExistingReport) {
          try {
            const scope = leaseScope(operation);
            const backup = await resolvedStorageService.downloadReport(scope);
            await resolvedStorageService.storeReportBackup({
              ...scope,
              backup,
              replaceExisting: false,
            });
            operation.stage = "backup-stored";
            operation.hasBackup = true;
          } catch (backupError) {
            try {
              await cancel(operation);
              await deleteBackupBestEffort(operation);
            } catch {
              if (retainedUploadRef.current === operation) {
                operation.stage = "cancelling";
              }
            }
            throw backupError;
          }
        }
      }

      if (
        operation.stage === "preparing" ||
        operation.stage === "backup-stored"
      ) {
        try {
          const readyLease = await retryOnce(() =>
            resolvedDetailsService.markReportUploadReady({
              ...leaseScope(operation),
              hasBackup: operation.hasBackup,
            }),
          );
          operation.lease = {
            ...readyLease,
            storageOwnerUserId:
              readyLease.storageOwnerUserId ??
              operation.lease.storageOwnerUserId,
          };
          operation.stage = "ready";
        } catch (readyError) {
          // An ambiguous mark-ready response is retained and retried with the
          // same unguessable token. A crash is healed by expiry acquisition.
          operation.stage = operation.hasBackup ? "backup-stored" : "preparing";
          retainedUploadRef.current = operation;
          throw readyError;
        }
      }

      let upload: TotalLossReportUpload;
      try {
        await renew(operation);
        upload = await resolvedStorageService.uploadReport({
          ...leaseScope(operation),
          file,
          replaceExisting: hasExistingReport,
        });
      } catch (uploadError) {
        await rollbackAndCancel(operation);
        throw uploadError;
      }

      const uploadedAt = now().toISOString();
      const finalize = () =>
        resolvedDetailsService.finalizeReportUpload({
          ...leaseScope(operation),
          originalFilename: upload.displayFilename,
          uploadedAt,
        });

      try {
        const details = await retryOnce(finalize);
        retainedUploadRef.current = null;
        if (operation.hasBackup) {
          await deleteBackupBestEffort(operation);
        }
        return { upload, details };
      } catch (finalizeError) {
        try {
          await rollbackAndCancel(operation);
        } catch {
          // If finalization committed but its response was lost, storage RLS
          // rejects restoration because the lease was cleared. The idempotent
          // finalizer then returns the committed row instead of permitting old
          // bytes to overwrite the newer canonical report.
          try {
            const details = await retryOnce(finalize);
            retainedUploadRef.current = null;
            if (operation.hasBackup) {
              await deleteBackupBestEffort(operation);
            }
            return { upload, details };
          } catch {
            throw new TotalLossReportRestoreError();
          }
        }
        throw finalizeError;
      }
    },
    onSuccess: async ({ details }) => {
      if (activeUserIdRef.current !== userId) return;
      queryClient.setQueryData(
        totalLossQueryKeys.details(userId, details.caseId),
        details,
      );
      await refreshTotalLossCaseQueries(queryClient, userId);
    },
    retry: false,
  });
}
