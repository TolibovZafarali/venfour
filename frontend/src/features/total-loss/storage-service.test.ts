import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  createTotalLossReportStorageService,
  getTotalLossReportBackupObjectPath,
  getTotalLossReportObjectPath,
  TotalLossReportValidationError,
} from "@/features/total-loss/storage-service";
import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

const SUPABASE_URL = "https://total-loss-storage-test.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const OBJECT_PATH = `${USER_ID}/${CASE_ID}/valuation-report.pdf`;
const BACKUP_PATH = `${USER_ID}/${CASE_ID}/valuation-report-backup.pdf`;

function createTestService() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_total_loss_storage_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return createTotalLossReportStorageService(client);
}

describe("total-loss report storage service", () => {
  it("builds one deterministic ownership-safe object path", () => {
    expect(getTotalLossReportObjectPath(USER_ID, CASE_ID)).toBe(OBJECT_PATH);
    expect(getTotalLossReportBackupObjectPath(USER_ID, CASE_ID)).toBe(
      BACKUP_PATH,
    );
    expect(() => getTotalLossReportObjectPath("../other", CASE_ID)).toThrow(
      TotalLossReportValidationError,
    );
  });

  it("uploads a PDF privately with application/pdf and replacement enabled", async () => {
    let requestMethod: string | undefined;
    let requestBody: string | undefined;
    let requestUpsert: string | null | undefined;
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        async ({ request }) => {
          requestMethod = request.method;
          requestUpsert = request.headers.get("x-upsert");
          requestBody = await request.text();
          return HttpResponse.json({
            Id: "33333333-3333-4333-8333-333333333333",
            Key: `case-files/${OBJECT_PATH}`,
          });
        },
      ),
    );

    const result = await createTestService().uploadReport({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      file: new File(["%PDF-1.7"], "  valuation   report.pdf  ", {
        type: "application/pdf",
      }),
    });

    expect(requestMethod).toBe("POST");
    expect(requestBody).toContain("Content-Type: application/pdf");
    expect(requestBody).toContain(UPLOAD_ID);
    expect(requestUpsert).toBe("true");
    expect(result).toEqual({
      path: OBJECT_PATH,
      displayFilename: "valuation report.pdf",
    });
  });

  it("stores one reusable backup and restores the canonical object with the lease token", async () => {
    const uploadedBodies = new Map<string, string>();
    const uploadedMetadata = new Map<string, string>();
    let restoredBody: string | undefined;
    let restoreUpsert: string | null | undefined;
    server.use(
      http.get(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        () =>
          new HttpResponse("%PDF-1.7 previous", {
            headers: { "content-type": "application/pdf" },
          }),
      ),
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${BACKUP_PATH}`,
        async ({ request }) => {
          const body = await request.text();
          uploadedBodies.set(BACKUP_PATH, body);
          const encodedMetadata = request.headers.get("x-metadata");
          uploadedMetadata.set(
            BACKUP_PATH,
            encodedMetadata ? atob(encodedMetadata) : body,
          );
          return HttpResponse.json({
            Id: "44444444-4444-4444-8444-444444444444",
            Key: `case-files/${BACKUP_PATH}`,
          });
        },
      ),
      http.get(
        `${SUPABASE_URL}/storage/v1/object/case-files/${BACKUP_PATH}`,
        () =>
          new HttpResponse("%PDF-1.7 previous", {
            headers: { "content-type": "application/pdf" },
          }),
      ),
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        async ({ request }) => {
          restoredBody = await request.text();
          const encodedMetadata = request.headers.get("x-metadata");
          uploadedMetadata.set(
            OBJECT_PATH,
            encodedMetadata ? atob(encodedMetadata) : restoredBody,
          );
          restoreUpsert = request.headers.get("x-upsert");
          return HttpResponse.json({
            Id: "33333333-3333-4333-8333-333333333333",
            Key: `case-files/${OBJECT_PATH}`,
          });
        },
      ),
    );

    const service = createTestService();
    const backup = await service.downloadReport({
      caseId: CASE_ID,
      userId: USER_ID,
    });
    await service.storeReportBackup({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      backup,
    });
    const durableBackup = await service.downloadReportBackup({
      caseId: CASE_ID,
      userId: USER_ID,
    });
    await service.restoreReport({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      backup: durableBackup,
    });

    expect(await backup.text()).toContain("%PDF-1.7 previous");
    expect(uploadedBodies.get(BACKUP_PATH)).toContain("%PDF-1.7 previous");
    expect(uploadedMetadata.get(BACKUP_PATH)).toContain(UPLOAD_ID);
    expect(restoredBody).toContain("%PDF-1.7 previous");
    expect(uploadedMetadata.get(OBJECT_PATH)).toContain(UPLOAD_ID);
    expect(restoreUpsert).toBe("true");
  });

  it("deletes only the deterministic reusable backup path", async () => {
    let requestBody: unknown;
    server.use(
      http.delete(
        `${SUPABASE_URL}/storage/v1/object/case-files`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json([{ name: BACKUP_PATH }]);
        },
      ),
    );

    await createTestService().deleteReportBackup({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
    });
    expect(requestBody).toEqual({ prefixes: [BACKUP_PATH] });
  });

  it("rejects non-PDF input before making a storage request", async () => {
    await expect(
      createTestService().uploadReport({
        caseId: CASE_ID,
        userId: USER_ID,
        uploadId: UPLOAD_ID,
        file: new File(["plain text"], "valuation.txt", {
          type: "text/plain",
        }),
      }),
    ).rejects.toBeInstanceOf(TotalLossReportValidationError);
  });
});
