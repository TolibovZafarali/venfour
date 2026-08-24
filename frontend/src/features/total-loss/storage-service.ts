import type { SupabaseClient } from "@supabase/supabase-js";

import { validateTotalLossPdf } from "@/features/total-loss/validation";
import type { Database } from "@/lib/supabase/database.types";

const CASE_FILES_BUCKET = "case-files";
const REPORT_OBJECT_NAME = "valuation-report.pdf";
const REPORT_BACKUP_OBJECT_NAME = "valuation-report-backup.pdf";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UploadTotalLossReportInput {
  readonly userId: string;
  readonly storageOwnerUserId?: string;
  readonly caseId: string;
  readonly uploadId: string;
  readonly file: File;
  readonly replaceExisting: boolean;
}

export interface TotalLossReportStorageScope {
  readonly userId: string;
  readonly storageOwnerUserId?: string;
  readonly caseId: string;
  readonly uploadId: string;
}

export interface StoreTotalLossReportBackupInput
  extends TotalLossReportStorageScope {
  readonly backup: Blob;
  readonly replaceExisting: boolean;
}

export interface TotalLossReportUpload {
  readonly path: string;
  readonly displayFilename: string;
}

export interface TotalLossReportStorageService {
  uploadReport(
    input: UploadTotalLossReportInput,
  ): Promise<TotalLossReportUpload>;
  downloadReport(input: TotalLossReportStorageScope): Promise<Blob>;
  downloadReportBackup(input: TotalLossReportStorageScope): Promise<Blob>;
  storeReportBackup(input: StoreTotalLossReportBackupInput): Promise<void>;
  restoreReport(
    input: TotalLossReportStorageScope & {
      readonly backup: Blob;
    },
  ): Promise<void>;
  deleteReportBackup(input: TotalLossReportStorageScope): Promise<void>;
}

export class TotalLossReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossReportValidationError";
  }
}

export class TotalLossReportUploadResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossReportUploadResponseError";
  }
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new TotalLossReportValidationError(
      `${label} must be a valid UUID before uploading a report.`,
    );
  }
}

export function getTotalLossReportObjectPath(
  userId: string,
  caseId: string,
) {
  assertUuid(userId, "User ID");
  assertUuid(caseId, "Case ID");
  return `${userId}/${caseId}/${REPORT_OBJECT_NAME}`;
}

export function getTotalLossReportBackupObjectPath(
  userId: string,
  caseId: string,
) {
  assertUuid(userId, "User ID");
  assertUuid(caseId, "Case ID");
  return `${userId}/${caseId}/${REPORT_BACKUP_OBJECT_NAME}`;
}

export function createTotalLossReportStorageService(
  client: SupabaseClient<Database>,
): TotalLossReportStorageService {
  const bucket = client.storage.from(CASE_FILES_BUCKET);

  const writePdfBlob = async (
    path: string,
    body: Blob,
    uploadId: string,
    replaceExisting: boolean,
    failureMessage: string,
  ) => {
    assertUuid(uploadId, "Upload ID");
    const pdfBody = await body.arrayBuffer();
    const options = {
      cacheControl: "0",
      contentType: "application/pdf",
      metadata: { uploadId },
    };
    let response = replaceExisting
      ? await bucket.update(path, pdfBody, options)
      : await bucket.upload(path, pdfBody, { ...options, upsert: false });

    if (!replaceExisting && isDuplicateStorageObjectError(response.error)) {
      response = await bucket.update(path, pdfBody, options);
    }

    const { data, error } = response;
    if (error) throw error;
    if (!data || data.path !== path) {
      throw new TotalLossReportUploadResponseError(failureMessage);
    }
  };

  return {
    async uploadReport({
      userId,
      storageOwnerUserId,
      caseId,
      uploadId,
      file,
      replaceExisting,
    }) {
      const validation = validateTotalLossPdf(file);
      if (!validation.valid) {
        throw new TotalLossReportValidationError(validation.error);
      }

      const path = getTotalLossReportObjectPath(
        storageOwnerUserId ?? userId,
        caseId,
      );
      await writePdfBlob(
        path,
        file,
        uploadId,
        replaceExisting,
        "Supabase did not confirm the expected private report path.",
      );

      return {
        path,
        displayFilename: validation.displayFilename,
      };
    },

    async downloadReport({ userId, storageOwnerUserId, caseId, uploadId }) {
      assertUuid(uploadId, "Upload ID");
      const path = getTotalLossReportObjectPath(
        storageOwnerUserId ?? userId,
        caseId,
      );
      const { data, error } = await bucket.download(path, {
        cacheNonce: uploadId,
      });
      if (error) throw error;
      if (!data) {
        throw new TotalLossReportUploadResponseError(
          "Supabase did not return the existing private report.",
        );
      }
      return data;
    },

    async downloadReportBackup({
      userId,
      storageOwnerUserId,
      caseId,
      uploadId,
    }) {
      assertUuid(uploadId, "Upload ID");
      const path = getTotalLossReportBackupObjectPath(
        storageOwnerUserId ?? userId,
        caseId,
      );
      const { data, error } = await bucket.download(path, {
        cacheNonce: uploadId,
      });
      if (error) throw error;
      if (!data) {
        throw new TotalLossReportUploadResponseError(
          "Supabase did not return the recoverable report backup.",
        );
      }
      return data;
    },

    async storeReportBackup({
      userId,
      storageOwnerUserId,
      caseId,
      uploadId,
      backup,
      replaceExisting,
    }) {
      await writePdfBlob(
        getTotalLossReportBackupObjectPath(
          storageOwnerUserId ?? userId,
          caseId,
        ),
        backup,
        uploadId,
        replaceExisting,
        "Supabase did not confirm the recoverable report backup.",
      );
    },

    async restoreReport({
      userId,
      storageOwnerUserId,
      caseId,
      uploadId,
      backup,
    }) {
      const path = getTotalLossReportObjectPath(
        storageOwnerUserId ?? userId,
        caseId,
      );
      await writePdfBlob(
        path,
        backup,
        uploadId,
        true,
        "Supabase did not confirm restoration of the previous private report.",
      );
    },

    async deleteReportBackup({
      userId,
      storageOwnerUserId,
      caseId,
      uploadId,
    }) {
      assertUuid(uploadId, "Upload ID");
      const path = getTotalLossReportBackupObjectPath(
        storageOwnerUserId ?? userId,
        caseId,
      );
      const { data, error } = await bucket.remove([path]);
      if (error) throw error;
      if (!data?.some((object) => object.name === path)) {
        throw new TotalLossReportUploadResponseError(
          "Supabase did not confirm cleanup of the report backup.",
        );
      }
    },
  };
}

function isDuplicateStorageObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const storageError = error as {
    readonly code?: unknown;
    readonly status?: unknown;
    readonly statusCode?: unknown;
  };
  return (
    storageError.status === 409 ||
    storageError.statusCode === "409" ||
    storageError.code === "Duplicate" ||
    storageError.code === "ResourceAlreadyExists"
  );
}
