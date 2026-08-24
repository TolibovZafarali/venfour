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
const CLAIMED_OWNER_ID = "44444444-4444-4444-8444-444444444444";
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

interface CapturedStorageWrite {
  readonly body: string;
  readonly cacheControl: string | null;
  readonly metadata: string | null;
  readonly method: string;
  readonly type: string;
  readonly upsert: string | null;
}

async function captureStorageWrite(
  request: Request,
): Promise<CapturedStorageWrite> {
  const requestContentType = request.headers.get("content-type") ?? "";
  if (!requestContentType.startsWith("multipart/form-data")) {
    const encodedMetadata = request.headers.get("x-metadata");
    return {
      body: await request.text(),
      cacheControl:
        request.headers.get("cache-control")?.replace(/^max-age=/u, "") ??
        null,
      metadata: encodedMetadata ? atob(encodedMetadata) : null,
      method: request.method,
      type: requestContentType,
      upsert: request.headers.get("x-upsert"),
    };
  }

  const serializedBody = await request.clone().text();
  const formData = await request.formData();
  const body = formData.get("");
  if (!body || typeof body === "string") {
    throw new Error("Expected a multipart PDF body.");
  }
  return {
    body: serializedBody,
    cacheControl: formData.get("cacheControl")?.toString() ?? null,
    metadata: formData.get("metadata")?.toString() ?? null,
    method: request.method,
    type: body.type,
    upsert: request.headers.get("x-upsert"),
  };
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

  it("creates a private PDF without upsert and sets raw MIME, cache, and metadata headers", async () => {
    let write: CapturedStorageWrite | undefined;
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        async ({ request }) => {
          write = await captureStorageWrite(request);
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
      replaceExisting: false,
      file: new File(["%PDF-1.7"], "  valuation   report.pdf  ", {
        type: "",
      }),
    });

    expect(write).toMatchObject({
      body: "%PDF-1.7",
      cacheControl: "0",
      metadata: JSON.stringify({ uploadId: UPLOAD_ID }),
      method: "POST",
      type: "application/pdf",
      upsert: "false",
    });
    expect(result).toEqual({
      path: OBJECT_PATH,
      displayFilename: "valuation report.pdf",
    });
  });

  it("replaces the canonical object with Storage update instead of upload upsert", async () => {
    let write: CapturedStorageWrite | undefined;
    server.use(
      http.put(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        async ({ request }) => {
          write = await captureStorageWrite(request);
          return HttpResponse.json({
            Id: "33333333-3333-4333-8333-333333333333",
            Key: `case-files/${OBJECT_PATH}`,
          });
        },
      ),
    );

    await createTestService().uploadReport({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      replaceExisting: true,
      file: new File(["%PDF-1.7 replacement"], "replacement.pdf", {
        type: "application/pdf",
      }),
    });

    expect(write).toMatchObject({
      body: "%PDF-1.7 replacement",
      cacheControl: "0",
      metadata: JSON.stringify({ uploadId: UPLOAD_ID }),
      method: "PUT",
      type: "application/pdf",
      upsert: null,
    });
  });

  it("keeps a claimed case in its immutable guest storage namespace", async () => {
    let requested = false;
    server.use(
      http.get(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        () => {
          requested = true;
          return new HttpResponse("%PDF-1.7 guest report", {
            headers: { "content-type": "application/pdf" },
          });
        },
      ),
    );

    const report = await createTestService().downloadReport({
      caseId: CASE_ID,
      userId: CLAIMED_OWNER_ID,
      storageOwnerUserId: USER_ID,
      uploadId: UPLOAD_ID,
    });

    expect(requested).toBe(true);
    expect(await report.text()).toContain("guest report");
  });

  it("updates a leftover canonical object after a duplicate create response", async () => {
    const methods: string[] = [];
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        ({ request }) => {
          methods.push(request.method);
          return HttpResponse.json(
            {
              error: "Conflict",
              message: "The resource already exists",
              statusCode: "409",
            },
            { status: 409 },
          );
        },
      ),
      http.put(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        ({ request }) => {
          methods.push(request.method);
          return HttpResponse.json({
            Id: "33333333-3333-4333-8333-333333333333",
            Key: `case-files/${OBJECT_PATH}`,
          });
        },
      ),
    );

    await createTestService().uploadReport({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      replaceExisting: false,
      file: new File(["%PDF-1.7"], "valuation.pdf", {
        type: "application/pdf",
      }),
    });

    expect(methods).toEqual(["POST", "PUT"]);
  });

  it("stores one reusable backup and restores the canonical object with the lease token", async () => {
    let backupWrite: CapturedStorageWrite | undefined;
    let canonicalDownloadNonce: string | null | undefined;
    let backupDownloadNonce: string | null | undefined;
    let restoreWrite: CapturedStorageWrite | undefined;
    server.use(
      http.get(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        ({ request }) => {
          canonicalDownloadNonce = new URL(request.url).searchParams.get(
            "cacheNonce",
          );
          return new HttpResponse("%PDF-1.7 previous", {
            headers: { "content-type": "application/pdf" },
          });
        },
      ),
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${BACKUP_PATH}`,
        async ({ request }) => {
          backupWrite = await captureStorageWrite(request);
          return HttpResponse.json({
            Id: "44444444-4444-4444-8444-444444444444",
            Key: `case-files/${BACKUP_PATH}`,
          });
        },
      ),
      http.get(
        `${SUPABASE_URL}/storage/v1/object/case-files/${BACKUP_PATH}`,
        ({ request }) => {
          backupDownloadNonce = new URL(request.url).searchParams.get(
            "cacheNonce",
          );
          return new HttpResponse("%PDF-1.7 previous", {
            headers: { "content-type": "application/pdf" },
          });
        },
      ),
      http.put(
        `${SUPABASE_URL}/storage/v1/object/case-files/${OBJECT_PATH}`,
        async ({ request }) => {
          restoreWrite = await captureStorageWrite(request);
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
      uploadId: UPLOAD_ID,
    });
    await service.storeReportBackup({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      backup,
      replaceExisting: false,
    });
    const durableBackup = await service.downloadReportBackup({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
    });
    await service.restoreReport({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      backup: durableBackup,
    });

    expect(await backup.text()).toContain("%PDF-1.7 previous");
    expect(canonicalDownloadNonce).toBe(UPLOAD_ID);
    expect(backupDownloadNonce).toBe(UPLOAD_ID);
    expect(backupWrite).toMatchObject({
      body: "%PDF-1.7 previous",
      cacheControl: "0",
      metadata: JSON.stringify({ uploadId: UPLOAD_ID }),
      method: "POST",
      type: "application/pdf",
      upsert: "false",
    });
    expect(restoreWrite).toMatchObject({
      body: "%PDF-1.7 previous",
      cacheControl: "0",
      metadata: JSON.stringify({ uploadId: UPLOAD_ID }),
      method: "PUT",
      type: "application/pdf",
      upsert: null,
    });
  });

  it("rebinds an existing recovery backup with Storage update", async () => {
    let write: CapturedStorageWrite | undefined;
    server.use(
      http.put(
        `${SUPABASE_URL}/storage/v1/object/case-files/${BACKUP_PATH}`,
        async ({ request }) => {
          write = await captureStorageWrite(request);
          return HttpResponse.json({
            Id: "44444444-4444-4444-8444-444444444444",
            Key: `case-files/${BACKUP_PATH}`,
          });
        },
      ),
    );

    await createTestService().storeReportBackup({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      backup: new Blob(["%PDF previous"], { type: "application/pdf" }),
      replaceExisting: true,
    });

    expect(write).toMatchObject({
      body: "%PDF previous",
      cacheControl: "0",
      method: "PUT",
      upsert: null,
    });
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
        replaceExisting: false,
        file: new File(["plain text"], "valuation.txt", {
          type: "text/plain",
        }),
      }),
    ).rejects.toBeInstanceOf(TotalLossReportValidationError);
  });
});
