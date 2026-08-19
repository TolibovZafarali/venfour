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
  readonly caseId: string;
  readonly uploadId: string;
  readonly file: File;
}

export type TotalLossReportStorageScope = Pick<
  UploadTotalLossReportInput,
  "userId" | "caseId" | "uploadId"
>;

export interface StoreTotalLossReportBackupInput
  extends TotalLossReportStorageScope {
  readonly backup: Blob;
}

export interface TotalLossReportUpload {
  readonly path: string;
  readonly displayFilename: string;
}

export interface TotalLossReportStorageService {
  uploadReport(
    input: UploadTotalLossReportInput,
  ): Promise<TotalLossReportUpload>;
  downloadReport(
    input: Pick<UploadTotalLossReportInput, "userId" | "caseId">,
  ): Promise<Blob>;
  downloadReportBackup(
    input: Pick<UploadTotalLossReportInput, "userId" | "caseId">,
  ): Promise<Blob>;
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

  const uploadPdfBlob = async (
    path: string,
    body: Blob,
    uploadId: string,
    failureMessage: string,
  ) => {
    assertUuid(uploadId, "Upload ID");
    const { data, error } = await bucket.upload(path, body, {
      contentType: "application/pdf",
      metadata: { uploadId },
      upsert: true,
    });
    if (error) throw error;
    if (!data || data.path !== path) {
      throw new TotalLossReportUploadResponseError(failureMessage);
    }
  };

  return {
    async uploadReport({ userId, caseId, uploadId, file }) {
      const validation = validateTotalLossPdf(file);
      if (!validation.valid) {
        throw new TotalLossReportValidationError(validation.error);
      }

      const path = getTotalLossReportObjectPath(userId, caseId);
      await uploadPdfBlob(
        path,
        file,
        uploadId,
        "Supabase did not confirm the expected private report path.",
      );

      return {
        path,
        displayFilename: validation.displayFilename,
      };
    },

    async downloadReport({ userId, caseId }) {
      const path = getTotalLossReportObjectPath(userId, caseId);
      const { data, error } = await bucket.download(path);
      if (error) throw error;
      if (!data) {
        throw new TotalLossReportUploadResponseError(
          "Supabase did not return the existing private report.",
        );
      }
      return data;
    },

    async downloadReportBackup({ userId, caseId }) {
      const path = getTotalLossReportBackupObjectPath(userId, caseId);
      const { data, error } = await bucket.download(path);
      if (error) throw error;
      if (!data) {
        throw new TotalLossReportUploadResponseError(
          "Supabase did not return the recoverable report backup.",
        );
      }
      return data;
    },

    async storeReportBackup({ userId, caseId, uploadId, backup }) {
      await uploadPdfBlob(
        getTotalLossReportBackupObjectPath(userId, caseId),
        backup,
        uploadId,
        "Supabase did not confirm the recoverable report backup.",
      );
    },

    async restoreReport({ userId, caseId, uploadId, backup }) {
      const path = getTotalLossReportObjectPath(userId, caseId);
      await uploadPdfBlob(
        path,
        backup,
        uploadId,
        "Supabase did not confirm restoration of the previous private report.",
      );
    },

    async deleteReportBackup({ userId, caseId, uploadId }) {
      assertUuid(uploadId, "Upload ID");
      const path = getTotalLossReportBackupObjectPath(userId, caseId);
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
