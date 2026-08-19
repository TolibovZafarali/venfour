import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";
import {
  TotalLossDataAuthenticationError,
  useSaveTotalLossDetailsMutation,
  useUploadTotalLossReportMutation,
} from "@/features/total-loss/mutations";
import {
  totalLossQueryKeys,
  useTotalLossDetailsQuery,
} from "@/features/total-loss/queries";
import {
  TotalLossDetailsConflictError,
  type TotalLossDetailsService,
  TotalLossReportUploadLeaseLostError,
} from "@/features/total-loss/service";
import type { TotalLossReportStorageService } from "@/features/total-loss/storage-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-08-18T15:00:00.000Z";

const lease = {
  uploadId: UPLOAD_ID,
  expiresAt: "2026-08-18T15:30:00.000Z",
  detailsUpdatedAt: UPDATED_AT,
  reportOriginalFilename: null,
  reportUploadedAt: null,
  recoveryRequired: false,
} as const;

const details: TotalLossCaseDetails = {
  caseId: CASE_ID,
  intakeMode: "manual",
  vin: null,
  vehicleYear: null,
  vehicleMake: null,
  vehicleModel: null,
  vehicleTrim: null,
  mileageAtLoss: null,
  postalCode: null,
  dateOfLoss: null,
  insurerName: null,
  insurerVehicleValuation: null,
  reportOriginalFilename: null,
  reportUploadedAt: null,
  intakeCompletedAt: null,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
};

function createDetailsService(
  overrides: Partial<TotalLossDetailsService> = {},
): TotalLossDetailsService {
  return {
    getDetails: async () => details,
    createDetails: async () => details,
    updateDetails: async () => details,
    saveDetails: async () => details,
    acquireReportUploadLease: async () => lease,
    renewReportUploadLease: async () => lease,
    markReportUploadReady: async () => lease,
    completeReportUploadRecovery: async () => lease,
    finalizeReportUpload: async () => details,
    cancelReportUpload: async () => details,
    ...overrides,
  };
}

function createStorageService(
  overrides: Partial<TotalLossReportStorageService> = {},
): TotalLossReportStorageService {
  return {
    uploadReport: async ({ userId, caseId, file }) => ({
      path: `${userId}/${caseId}/valuation-report.pdf`,
      displayFilename: file.name,
    }),
    downloadReport: async () =>
      new Blob(["%PDF previous"], { type: "application/pdf" }),
    downloadReportBackup: async () =>
      new Blob(["%PDF previous"], { type: "application/pdf" }),
    storeReportBackup: async () => undefined,
    restoreReport: async () => undefined,
    deleteReportBackup: async () => undefined,
    ...overrides,
  };
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return { queryClient, wrapper: Wrapper };
}

describe("total-loss data hooks", () => {
  it("keeps details cache keys scoped below the authenticated appraisal-case root", () => {
    expect(totalLossQueryKeys.details(USER_ID, CASE_ID)).toEqual([
      "appraisalCases",
      "user",
      USER_ID,
      "totalLoss",
      "details",
      CASE_ID,
    ]);
  });

  it("does not query secure details while signed out", () => {
    const getDetails = vi.fn(async () => details);
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useTotalLossDetailsQuery({
          service: createDetailsService({ getDetails }),
          userId: null,
          caseId: CASE_ID,
        }),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(getDetails).not.toHaveBeenCalled();
  });

  it("saves details with authenticated ownership and refreshes the cache", async () => {
    const saveDetails = vi.fn(async () => details);
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useSaveTotalLossDetailsMutation({
          detailsService: createDetailsService({ saveDetails }),
          userId: USER_ID,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        caseId: CASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        values: { vehicleMake: "Honda" },
      });
    });

    expect(saveDetails).toHaveBeenCalledWith({
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      userId: USER_ID,
      values: { vehicleMake: "Honda" },
    });
    expect(
      queryClient.getQueryData(totalLossQueryKeys.details(USER_ID, CASE_ID)),
    ).toEqual(details);
  });

  it("leases the canonical path and finalizes metadata only after upload", async () => {
    const calls: string[] = [];
    const file = new File(["%PDF"], "valuation.pdf", {
      type: "application/pdf",
    });
    const acquireReportUploadLease = vi.fn(async () => {
      calls.push("acquire");
      return lease;
    });
    const markReportUploadReady = vi.fn(async () => {
      calls.push("ready");
      return lease;
    });
    const renewReportUploadLease = vi.fn(async () => {
      calls.push("renew");
      return lease;
    });
    const uploadReport = vi.fn(async () => {
      calls.push("upload");
      return {
        path: `${USER_ID}/${CASE_ID}/valuation-report.pdf`,
        displayFilename: "valuation.pdf",
      };
    });
    const finalizeReportUpload = vi.fn(async () => {
      calls.push("finalize");
      return {
        ...details,
        intakeMode: "report" as const,
        reportOriginalFilename: "valuation.pdf",
        reportUploadedAt: UPDATED_AT,
      };
    });
    const storageService = createStorageService({ uploadReport });
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService: createDetailsService({
            acquireReportUploadLease,
            markReportUploadReady,
            renewReportUploadLease,
            finalizeReportUpload,
          }),
          storageService,
          userId: USER_ID,
          now: () => new Date(UPDATED_AT),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        caseId: CASE_ID,
        expectedUpdatedAt: null,
        file,
      });
    });

    expect(calls).toEqual([
      "acquire",
      "ready",
      "renew",
      "upload",
      "finalize",
    ]);
    expect(uploadReport).toHaveBeenCalledWith({
      caseId: CASE_ID,
      file,
      replaceExisting: false,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
    });
    expect(finalizeReportUpload).toHaveBeenCalledWith({
      caseId: CASE_ID,
      originalFilename: "valuation.pdf",
      uploadedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
    });
  });

  it("reuses a pending upload UUID after acquisition responses are lost", async () => {
    const networkError = new Error("acquire response lost");
    const acquireReportUploadLease = vi
      .fn<TotalLossDetailsService["acquireReportUploadLease"]>()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue(lease);
    const createUploadId = vi.fn(() => UPLOAD_ID);
    const uploadReport = vi.fn<TotalLossReportStorageService["uploadReport"]>(
      async ({ userId, caseId, file }) => ({
        path: `${userId}/${caseId}/valuation-report.pdf`,
        displayFilename: file.name,
      }),
    );
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          createUploadId,
          detailsService: createDetailsService({
            acquireReportUploadLease,
          }),
          storageService: createStorageService({ uploadReport }),
          userId: USER_ID,
        }),
      { wrapper },
    );
    const input = {
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      file: new File(["%PDF"], "valuation.pdf", {
        type: "application/pdf",
      }),
    };

    await expect(result.current.mutateAsync(input)).rejects.toBe(networkError);
    await expect(result.current.mutateAsync(input)).resolves.toBeDefined();
    expect(createUploadId).toHaveBeenCalledOnce();
    expect(acquireReportUploadLease).toHaveBeenCalledTimes(3);
    expect(acquireReportUploadLease).toHaveBeenNthCalledWith(1, {
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
    });
    expect(acquireReportUploadLease).toHaveBeenNthCalledWith(3, {
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
    });
  });

  it("durably backs up and restores the prior canonical object when upload fails", async () => {
    const replacementLease = {
      ...lease,
      reportOriginalFilename: "previous.pdf",
      reportUploadedAt: UPDATED_AT,
    };
    const completeReportUploadRecovery = vi.fn(async () => lease);
    const cancelReportUpload = vi.fn(async () => details);
    const restoreReport = vi.fn(async () => undefined);
    const storeReportBackup = vi.fn(async () => undefined);
    const deleteReportBackup = vi.fn(async () => undefined);
    const uploadReport = vi.fn<TotalLossReportStorageService["uploadReport"]>(
      async () => {
        throw new Error("storage unavailable");
      },
    );
    const storageService = createStorageService({
      uploadReport,
      storeReportBackup,
      restoreReport,
      deleteReportBackup,
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService: createDetailsService({
            acquireReportUploadLease: async () => replacementLease,
            renewReportUploadLease: async () => replacementLease,
            markReportUploadReady: async () => replacementLease,
            completeReportUploadRecovery,
            cancelReportUpload,
          }),
          storageService,
          userId: USER_ID,
        }),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync({
        caseId: CASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        file: new File(["%PDF"], "replacement.pdf", {
          type: "application/pdf",
        }),
        preserveExistingReport: true,
      }),
    ).rejects.toThrow("storage unavailable");
    expect(uploadReport).toHaveBeenCalledWith({
      caseId: CASE_ID,
      file: expect.any(File),
      replaceExisting: true,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
    });
    expect(storeReportBackup).toHaveBeenCalledWith({
      backup: expect.any(Blob),
      caseId: CASE_ID,
      replaceExisting: false,
      uploadId: UPLOAD_ID,
      userId: USER_ID,
    });
    expect(restoreReport).toHaveBeenCalledOnce();
    expect(completeReportUploadRecovery).toHaveBeenCalledOnce();
    expect(cancelReportUpload).toHaveBeenCalledOnce();
    expect(deleteReportBackup).toHaveBeenCalled();
  });

  it("retries idempotent finalization instead of restoring after a lost response", async () => {
    const finalizedDetails = {
      ...details,
      intakeMode: "report" as const,
      reportOriginalFilename: "replacement.pdf",
      reportUploadedAt: UPDATED_AT,
    };
    const finalizeReportUpload = vi
      .fn<TotalLossDetailsService["finalizeReportUpload"]>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(finalizedDetails);
    const restoreReport = vi.fn(async () => undefined);
    const storageService = createStorageService({ restoreReport });
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService: createDetailsService({ finalizeReportUpload }),
          storageService,
          userId: USER_ID,
          now: () => new Date(UPDATED_AT),
        }),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync({
        caseId: CASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        file: new File(["%PDF replacement"], "replacement.pdf", {
          type: "application/pdf",
        }),
      }),
    ).resolves.toMatchObject({ details: finalizedDetails });
    expect(finalizeReportUpload).toHaveBeenCalledTimes(2);
    expect(restoreReport).not.toHaveBeenCalled();
  });

  it("restores the prior report when details change before finalization", async () => {
    const replacementLease = {
      ...lease,
      reportOriginalFilename: "previous.pdf",
      reportUploadedAt: UPDATED_AT,
    };
    const conflict = new TotalLossDetailsConflictError({
      ...details,
      intakeMode: "manual",
      updatedAt: "2026-08-18T15:05:00.000Z",
    });
    const finalizeReportUpload = vi
      .fn<TotalLossDetailsService["finalizeReportUpload"]>()
      .mockRejectedValue(conflict);
    const completeReportUploadRecovery = vi.fn(async () => lease);
    const cancelReportUpload = vi.fn(async () => details);
    const restoreReport = vi.fn(async () => undefined);
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService: createDetailsService({
            acquireReportUploadLease: async () => replacementLease,
            renewReportUploadLease: async () => replacementLease,
            markReportUploadReady: async () => replacementLease,
            finalizeReportUpload,
            completeReportUploadRecovery,
            cancelReportUpload,
          }),
          storageService: createStorageService({ restoreReport }),
          userId: USER_ID,
        }),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync({
        caseId: CASE_ID,
        expectedUpdatedAt: UPDATED_AT,
        file: new File(["%PDF replacement"], "replacement.pdf", {
          type: "application/pdf",
        }),
        preserveExistingReport: true,
      }),
    ).rejects.toBe(conflict);
    expect(finalizeReportUpload).toHaveBeenCalledTimes(2);
    expect(restoreReport).toHaveBeenCalledOnce();
    expect(completeReportUploadRecovery).toHaveBeenCalledOnce();
    expect(cancelReportUpload).toHaveBeenCalledOnce();
  });

  it("heals an expired backup-ready upload before starting a replacement", async () => {
    const recoveryLease = {
      ...lease,
      reportOriginalFilename: "previous.pdf",
      reportUploadedAt: UPDATED_AT,
      recoveryRequired: true,
    };
    const calls: string[] = [];
    const storeReportBackup = vi.fn<
      TotalLossReportStorageService["storeReportBackup"]
    >(async () => {
      calls.push("store-backup");
    });
    const detailsService = createDetailsService({
      acquireReportUploadLease: async () => {
        calls.push("acquire-recovery");
        return recoveryLease;
      },
      renewReportUploadLease: async () => {
        calls.push("renew");
        return recoveryLease;
      },
      completeReportUploadRecovery: async () => {
        calls.push("recovery-complete");
        return lease;
      },
      markReportUploadReady: async () => {
        calls.push("ready");
        return lease;
      },
      finalizeReportUpload: async () => {
        calls.push("finalize");
        return details;
      },
    });
    const storageService = createStorageService({
      downloadReportBackup: async () => {
        calls.push("download-backup");
        return new Blob(["%PDF previous"], { type: "application/pdf" });
      },
      storeReportBackup,
      restoreReport: async () => {
        calls.push("restore-canonical");
      },
      deleteReportBackup: async () => {
        calls.push("delete-backup");
      },
      downloadReport: async () => {
        calls.push("download-canonical");
        return new Blob(["%PDF previous"], { type: "application/pdf" });
      },
      uploadReport: async ({ userId, caseId, file }) => {
        calls.push("upload-new");
        return {
          path: `${userId}/${caseId}/valuation-report.pdf`,
          displayFilename: file.name,
        };
      },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService,
          storageService,
          userId: USER_ID,
        }),
      { wrapper },
    );

    await result.current.mutateAsync({
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      file: new File(["%PDF new"], "new.pdf", {
        type: "application/pdf",
      }),
      preserveExistingReport: true,
    });

    expect(calls.slice(0, 7)).toEqual([
      "acquire-recovery",
      "renew",
      "download-backup",
      "store-backup",
      "restore-canonical",
      "recovery-complete",
      "download-canonical",
    ]);
    expect(calls.indexOf("restore-canonical")).toBeLessThan(
      calls.indexOf("upload-new"),
    );
    expect(storeReportBackup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ replaceExisting: true }),
    );
    expect(storeReportBackup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ replaceExisting: false }),
    );
    expect(calls).toContain("finalize");
    expect(calls.indexOf("delete-backup")).toBeGreaterThan(
      calls.indexOf("finalize"),
    );
  });

  it("drops a replaced retained token and reacquires crash recovery in the same retry", async () => {
    const recoveryLease = { ...lease, recoveryRequired: true };
    const acquireReportUploadLease = vi
      .fn<TotalLossDetailsService["acquireReportUploadLease"]>()
      .mockResolvedValueOnce(lease)
      .mockResolvedValueOnce(recoveryLease);
    const renewReportUploadLease = vi
      .fn<TotalLossDetailsService["renewReportUploadLease"]>()
      .mockResolvedValueOnce(lease)
      .mockResolvedValue(recoveryLease);
    const cancelReportUpload = vi
      .fn<TotalLossDetailsService["cancelReportUpload"]>()
      .mockRejectedValueOnce(new Error("cancel response lost"))
      .mockRejectedValueOnce(new Error("cancel response lost"))
      .mockRejectedValueOnce(new TotalLossReportUploadLeaseLostError())
      .mockRejectedValueOnce(new TotalLossReportUploadLeaseLostError())
      .mockResolvedValue(details);
    const uploadReport = vi
      .fn<TotalLossReportStorageService["uploadReport"]>()
      .mockRejectedValueOnce(new Error("upload timed out"))
      .mockResolvedValue({
        path: `${USER_ID}/${CASE_ID}/valuation-report.pdf`,
        displayFilename: "replacement.pdf",
      });
    const detailsService = createDetailsService({
      acquireReportUploadLease,
      renewReportUploadLease,
      completeReportUploadRecovery: async () => lease,
      cancelReportUpload,
    });
    const storageService = createStorageService({ uploadReport });
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService,
          storageService,
          userId: USER_ID,
        }),
      { wrapper },
    );
    const input = {
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      file: new File(["%PDF replacement"], "replacement.pdf", {
        type: "application/pdf",
      }),
    };

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      "cancel response lost",
    );
    await expect(result.current.mutateAsync(input)).resolves.toBeDefined();
    expect(acquireReportUploadLease).toHaveBeenCalledTimes(2);
  });

  it("retries an ambiguous recovery completion without rewriting canonical storage", async () => {
    const recoveryLease = {
      ...lease,
      reportOriginalFilename: "previous.pdf",
      reportUploadedAt: UPDATED_AT,
      recoveryRequired: true,
    };
    const completeReportUploadRecovery = vi
      .fn<TotalLossDetailsService["completeReportUploadRecovery"]>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(lease);
    const restoreReport = vi.fn(async () => undefined);
    const detailsService = createDetailsService({
      acquireReportUploadLease: async () => recoveryLease,
      renewReportUploadLease: async () => lease,
      completeReportUploadRecovery,
    });
    const storageService = createStorageService({ restoreReport });
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useUploadTotalLossReportMutation({
          detailsService,
          storageService,
          userId: USER_ID,
        }),
      { wrapper },
    );
    const input = {
      caseId: CASE_ID,
      expectedUpdatedAt: UPDATED_AT,
      file: new File(["%PDF new"], "new.pdf", {
        type: "application/pdf",
      }),
    };

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      "previous report could not be restored",
    );
    await expect(result.current.mutateAsync(input)).resolves.toBeDefined();
    expect(completeReportUploadRecovery).toHaveBeenCalledTimes(3);
    expect(restoreReport).toHaveBeenCalledOnce();
  });

  it("rejects persistence while signed out", async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () =>
        useSaveTotalLossDetailsMutation({
          detailsService: createDetailsService(),
          userId: null,
        }),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync({
        caseId: CASE_ID,
        expectedUpdatedAt: null,
        values: { intakeMode: "manual" },
      }),
    ).rejects.toBeInstanceOf(TotalLossDataAuthenticationError);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
