import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

import { MAX_DIMINISHED_VALUE_DOCUMENT_BYTES } from "./local-document-files";
import {
  createDiminishedValueDocumentStorageService,
  DiminishedValueDocumentResponseError,
  DiminishedValueDocumentValidationError,
  getDiminishedValueDocumentPath,
  getDiminishedValueDocumentPrefix,
  type DiminishedValueStoredDocument,
} from "./storage-service";

const SUPABASE_URL = "https://diminished-value-storage-test.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const STORAGE_OBJECT_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = "2026-08-19T15:00:00.000Z";
const PREFIX = `${USER_ID}/${CASE_ID}/diminished-value`;
const PDF_PATH = `${PREFIX}/${DOCUMENT_ID}.pdf`;
const PNG_PATH = `${PREFIX}/${DOCUMENT_ID}.png`;
const JPG_PATH = `${PREFIX}/${SECOND_DOCUMENT_ID}.jpg`;

function createTestService() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_diminished_value_storage_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return createDiminishedValueDocumentStorageService(client);
}

describe("diminished-value document storage service", () => {
  it("builds deterministic owner/case/document paths from UUIDs only", () => {
    expect(getDiminishedValueDocumentPrefix(USER_ID, CASE_ID)).toBe(PREFIX);
    expect(
      getDiminishedValueDocumentPath(USER_ID, CASE_ID, DOCUMENT_ID, "pdf"),
    ).toBe(PDF_PATH);

    expect(() => getDiminishedValueDocumentPrefix("../other", CASE_ID)).toThrow(
      DiminishedValueDocumentValidationError,
    );
    expect(() => getDiminishedValueDocumentPrefix(USER_ID, "not-a-case")).toThrow(
      DiminishedValueDocumentValidationError,
    );
    expect(() =>
      getDiminishedValueDocumentPath(USER_ID, CASE_ID, "../document", "pdf"),
    ).toThrow(DiminishedValueDocumentValidationError);
    expect(() =>
      getDiminishedValueDocumentPath(
        USER_ID,
        CASE_ID,
        DOCUMENT_ID,
        "exe" as "pdf",
      ),
    ).toThrow(DiminishedValueDocumentValidationError);
  });

  it("propagates metadata and signature validation before any storage request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = createTestService();

    await expect(
      service.uploadDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        documentId: DOCUMENT_ID,
        file: binaryFile(
          "mismatched.png",
          "image/jpeg",
          pngSignature(),
        ),
      }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentValidationError);

    await expect(
      service.uploadDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        documentId: DOCUMENT_ID,
        file: binaryFile(
          "spoofed.pdf",
          "application/pdf",
          ascii("plain text"),
        ),
      }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentValidationError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uploads validated bytes with canonical content type and safe originalName metadata", async () => {
    let write: CapturedStorageWrite | undefined;
    const file = binaryFile(
      "../  repair\u0000\u202E   photo.PNG  ",
      "",
      pngSignature(),
    );
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${PNG_PATH}`,
        async ({ request }) => {
          write = await captureStorageWrite(request);
          return HttpResponse.json({
            Id: STORAGE_OBJECT_ID,
            Key: `case-files/${PNG_PATH}`,
          });
        },
      ),
      infoHandler(PNG_PATH, {
        content_type: "image/png",
        metadata: { originalName: "repair photo.PNG" },
        size: file.size,
      }),
    );

    const document = await createTestService().uploadDocument({
      userId: USER_ID,
      caseId: CASE_ID,
      documentId: DOCUMENT_ID,
      file,
    });

    expect(write).toEqual({
      body: [...pngSignature()],
      cacheControl: "0",
      contentType: "image/png",
      metadata: JSON.stringify({ originalName: "repair photo.PNG" }),
      upsert: "false",
    });
    expect(document).toEqual({
      id: DOCUMENT_ID,
      path: PNG_PATH,
      displayFilename: "repair photo.PNG",
      mimeType: "image/png",
      extension: "png",
      size: file.size,
      createdAt: CREATED_AT,
    });
  });

  it("lists durable objects under the exact prefix and maps verified info", async () => {
    let listBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/list/case-files`,
        async ({ request }) => {
          listBody = await request.json();
          return HttpResponse.json([
            listObject("nested-folder", null),
            listObject(`${DOCUMENT_ID}.pdf`, STORAGE_OBJECT_ID),
            listObject(`${SECOND_DOCUMENT_ID}.jpg`, SECOND_DOCUMENT_ID),
          ]);
        },
      ),
      infoHandler(PDF_PATH, {
        content_type: "application/pdf",
        metadata: {
          originalName: "../  repair\u0000\u202E   invoice.pdf  ",
        },
        size: pdfFile().size,
      }),
      infoHandler(JPG_PATH, {
        content_type: "image/jpeg",
        metadata: null,
        size: jpegFile().size,
      }),
    );

    const documents = await createTestService().listDocuments({
      userId: USER_ID,
      caseId: CASE_ID,
    });

    expect(listBody).toMatchObject({
      limit: 100,
      prefix: PREFIX,
      sortBy: { column: "created_at", order: "asc" },
    });
    expect(documents).toEqual([
      {
        id: DOCUMENT_ID,
        path: PDF_PATH,
        displayFilename: "repair invoice.pdf",
        mimeType: "application/pdf",
        extension: "pdf",
        size: pdfFile().size,
        createdAt: CREATED_AT,
      },
      {
        id: SECOND_DOCUMENT_ID,
        path: JPG_PATH,
        displayFilename: "Supporting document.jpg",
        mimeType: "image/jpeg",
        extension: "jpg",
        size: jpegFile().size,
        createdAt: CREATED_AT,
      },
    ]);
  });

  it("recovers an idempotent duplicate upload only when durable info matches", async () => {
    const file = pdfFile("repair invoice.pdf");
    let uploadCount = 0;
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${PDF_PATH}`,
        () => {
          uploadCount += 1;
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
      infoHandler(PDF_PATH, {
        content_type: "application/pdf",
        metadata: { originalName: "repair invoice.pdf" },
        size: file.size,
      }),
    );

    await expect(
      createTestService().uploadDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        documentId: DOCUMENT_ID,
        file,
      }),
    ).resolves.toEqual({
      id: DOCUMENT_ID,
      path: PDF_PATH,
      displayFilename: "repair invoice.pdf",
      mimeType: "application/pdf",
      extension: "pdf",
      size: file.size,
      createdAt: CREATED_AT,
    });
    expect(uploadCount).toBe(1);
  });

  it("does not treat a divergent duplicate object as the successful retry", async () => {
    const file = pdfFile("repair invoice.pdf");
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${PDF_PATH}`,
        () =>
          HttpResponse.json(
            {
              error: "Conflict",
              message: "The resource already exists",
              statusCode: "409",
            },
            { status: 409 },
          ),
      ),
      infoHandler(PDF_PATH, {
        content_type: "application/pdf",
        metadata: { originalName: "another document.pdf" },
        size: file.size,
      }),
    );

    await expect(
      createTestService().uploadDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        documentId: DOCUMENT_ID,
        file,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an upload response bound to a different full path", async () => {
    const file = pdfFile();
    const otherPath = `${USER_ID}/${CASE_ID}/diminished-value/${SECOND_DOCUMENT_ID}.pdf`;
    server.use(
      http.post(
        `${SUPABASE_URL}/storage/v1/object/case-files/${PDF_PATH}`,
        () =>
          HttpResponse.json({
            Id: STORAGE_OBJECT_ID,
            Key: `case-files/${otherPath}`,
          }),
      ),
      infoHandler(PDF_PATH, {
        content_type: "application/pdf",
        metadata: { originalName: file.name },
        size: file.size,
      }),
    );

    await expect(
      createTestService().uploadDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        documentId: DOCUMENT_ID,
        file,
      }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentResponseError);
  });

  it.each([
    ["path", { name: `${PREFIX}/${SECOND_DOCUMENT_ID}.pdf` }],
    ["content type", { content_type: "application/octet-stream" }],
    ["zero size", { size: 0 }],
    ["fractional size", { size: 1.5 }],
    ["oversized object", { size: MAX_DIMINISHED_VALUE_DOCUMENT_BYTES + 1 }],
  ] as const)("rejects unexpected stored-document %s", async (_label, override) => {
    server.use(
      listHandler([listObject(`${DOCUMENT_ID}.pdf`, STORAGE_OBJECT_ID)]),
      infoHandler(PDF_PATH, override),
    );

    await expect(
      createTestService().listDocuments({ userId: USER_ID, caseId: CASE_ID }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentResponseError);
  });

  it("rejects an unexpected object name returned within the list scope", async () => {
    server.use(
      listHandler([listObject("../../unexpected.pdf", STORAGE_OBJECT_ID)]),
    );

    await expect(
      createTestService().listDocuments({ userId: USER_ID, caseId: CASE_ID }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentResponseError);
  });

  it("removes exactly the verified document path", async () => {
    let removalBody: unknown;
    server.use(
      http.delete(
        `${SUPABASE_URL}/storage/v1/object/case-files`,
        async ({ request }) => {
          removalBody = await request.json();
          return HttpResponse.json([{ name: PDF_PATH }]);
        },
      ),
    );

    await createTestService().removeDocument({
      userId: USER_ID,
      caseId: CASE_ID,
      document: storedPdfDocument(),
    });
    expect(removalBody).toEqual({ prefixes: [PDF_PATH] });
  });

  it("rejects an out-of-scope document before attempting removal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      createTestService().removeDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        document: {
          ...storedPdfDocument(),
          path: `${USER_ID}/${SECOND_DOCUMENT_ID}/diminished-value/${DOCUMENT_ID}.pdf`,
        },
      }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [[{ name: `${PREFIX}/${SECOND_DOCUMENT_ID}.pdf` }]],
    [[{ name: PDF_PATH }, { name: `${PREFIX}/${SECOND_DOCUMENT_ID}.pdf` }]],
  ] as const)("rejects a mismatched removal response", async (response) => {
    server.use(
      http.delete(
        `${SUPABASE_URL}/storage/v1/object/case-files`,
        () => HttpResponse.json(response),
      ),
    );

    await expect(
      createTestService().removeDocument({
        userId: USER_ID,
        caseId: CASE_ID,
        document: storedPdfDocument(),
      }),
    ).rejects.toBeInstanceOf(DiminishedValueDocumentResponseError);
  });
});

interface CapturedStorageWrite {
  readonly body: number[];
  readonly cacheControl: string | null;
  readonly contentType: string | null;
  readonly metadata: string | null;
  readonly upsert: string | null;
}

async function captureStorageWrite(
  request: Request,
): Promise<CapturedStorageWrite> {
  const encodedMetadata = request.headers.get("x-metadata");
  return {
    body: [...new Uint8Array(await request.arrayBuffer())],
    cacheControl:
      request.headers.get("cache-control")?.replace(/^max-age=/u, "") ?? null,
    contentType: request.headers.get("content-type"),
    metadata: encodedMetadata ? atob(encodedMetadata) : null,
    upsert: request.headers.get("x-upsert"),
  };
}

function listHandler(objects: readonly Record<string, unknown>[]) {
  return http.post(
    `${SUPABASE_URL}/storage/v1/object/list/case-files`,
    () => HttpResponse.json(objects),
  );
}

function infoHandler(
  path: string,
  overrides: Record<string, unknown> = {},
) {
  return http.get(
    `${SUPABASE_URL}/storage/v1/object/info/case-files/${path}`,
    () => HttpResponse.json(storageInfo(path, overrides)),
  );
}

function listObject(name: string, id: string | null) {
  return {
    name,
    id,
    updated_at: id ? CREATED_AT : null,
    created_at: id ? CREATED_AT : null,
    last_accessed_at: id ? CREATED_AT : null,
    metadata: id ? {} : null,
  };
}

function storageInfo(path: string, overrides: Record<string, unknown> = {}) {
  return {
    id: STORAGE_OBJECT_ID,
    version: "1",
    name: path,
    bucket_id: "case-files",
    created_at: CREATED_AT,
    size: pdfFile().size,
    cache_control: "0",
    content_type: "application/pdf",
    etag: "test-etag",
    last_modified: CREATED_AT,
    metadata: { originalName: "repair invoice.pdf" },
    ...overrides,
  };
}

function storedPdfDocument(): DiminishedValueStoredDocument {
  return {
    id: DOCUMENT_ID,
    path: PDF_PATH,
    displayFilename: "repair invoice.pdf",
    mimeType: "application/pdf",
    extension: "pdf",
    size: pdfFile().size,
    createdAt: CREATED_AT,
  };
}

function pdfFile(name = "repair invoice.pdf") {
  return binaryFile(name, "application/pdf", ascii("%PDF-1.7\ncontent"));
}

function jpegFile(name = "damage.jpg") {
  return binaryFile(name, "image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0));
}

function pngSignature() {
  return bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
}

function binaryFile(name: string, type: string, contents: Uint8Array) {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return new File([buffer], name, { type, lastModified: 1 });
}

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

function ascii(value: string) {
  return new TextEncoder().encode(value);
}
