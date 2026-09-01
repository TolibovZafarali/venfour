import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTotalLossInsurerResponseStorageService,
  sha256Hex,
  TotalLossInsurerResponseStorageError,
} from "./insurer-response-storage-service";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${OWNER_ID}/${CASE_ID}/insurer-responses/${REQUEST_ID}.png`;

function pngFile() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    "insurer-response.png",
    { type: "image/png" },
  );
}

function clientWith(bucket: Record<string, unknown>) {
  return {
    storage: { from: vi.fn(() => bucket) },
  } as unknown as SupabaseClient<Database>;
}

async function prepared(file = pngFile()) {
  return {
    byteSize: file.size,
    contentDigest: await sha256Hex(file),
    documentId: REQUEST_ID,
    mediaType: "image/png" as const,
    originalFilename: file.name,
    uploadPath: PATH,
  };
}

describe("total-loss insurer-response storage service", () => {
  it("uploads exact original bytes immutably with the required metadata", async () => {
    const file = pngFile();
    const upload = vi.fn(async () => ({
      data: { path: PATH, fullPath: `case-files/${PATH}` },
      error: null,
    }));
    const service = createTotalLossInsurerResponseStorageService(clientWith({ upload }));

    await service.uploadPreparedResponse({
      caseId: CASE_ID,
      clientRequestId: REQUEST_ID,
      file,
      preparation: await prepared(file),
    });

    expect(upload).toHaveBeenCalledWith(
      PATH,
      expect.any(ArrayBuffer),
      expect.objectContaining({
        cacheControl: "0",
        contentType: "image/png",
        metadata: {
          clientRequestId: REQUEST_ID,
          contentDigest: await sha256Hex(file),
          originalName: file.name,
        },
        upsert: false,
      }),
    );
  });

  it("rejects a prepared path outside the exact owner/case/request namespace", async () => {
    const upload = vi.fn();
    const service = createTotalLossInsurerResponseStorageService(clientWith({ upload }));
    const file = pngFile();
    const preparation = await prepared(file);

    await expect(service.uploadPreparedResponse({
      caseId: CASE_ID,
      clientRequestId: REQUEST_ID,
      file,
      preparation: { ...preparation, uploadPath: `prefix/${PATH}` },
    })).rejects.toBeInstanceOf(TotalLossInsurerResponseStorageError);
    await expect(service.uploadPreparedResponse({
      caseId: CASE_ID,
      clientRequestId: REQUEST_ID,
      file,
      preparation: { ...preparation, uploadPath: `not-a-user/${CASE_ID}/insurer-responses/${REQUEST_ID}.png` },
    })).rejects.toBeInstanceOf(TotalLossInsurerResponseStorageError);
    expect(upload).not.toHaveBeenCalled();
  });

  it("accepts an immutable duplicate only after exact metadata and digest verification", async () => {
    const file = pngFile();
    const digest = await sha256Hex(file);
    const upload = vi.fn(async () => ({ data: null, error: { statusCode: "409" } }));
    const info = vi.fn(async () => ({
      data: {
        contentType: "image/png",
        metadata: {
          clientRequestId: REQUEST_ID,
          contentDigest: digest,
          originalName: file.name,
        },
        name: PATH,
        size: file.size,
      },
      error: null,
    }));
    const download = vi.fn(async () => ({
      data: new Blob([await file.arrayBuffer()], { type: "image/png" }),
      error: null,
    }));
    const service = createTotalLossInsurerResponseStorageService(
      clientWith({ download, info, upload }),
    );

    await expect(service.uploadPreparedResponse({
      caseId: CASE_ID,
      clientRequestId: REQUEST_ID,
      file,
      preparation: await prepared(file),
    })).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith(PATH);
    expect(download).toHaveBeenCalledWith(PATH, expect.objectContaining({ cacheNonce: expect.any(String) }));
  });

  it("rejects duplicate metadata that does not match the prepared file", async () => {
    const file = pngFile();
    const upload = vi.fn(async () => ({ data: null, error: { status: 409 } }));
    const info = vi.fn(async () => ({
      data: {
        contentType: "image/png",
        metadata: {
          clientRequestId: REQUEST_ID,
          contentDigest: "0".repeat(64),
          originalName: file.name,
        },
        name: PATH,
        size: file.size,
      },
      error: null,
    }));
    const service = createTotalLossInsurerResponseStorageService(
      clientWith({ download: vi.fn(), info, upload }),
    );

    await expect(service.uploadPreparedResponse({
      caseId: CASE_ID,
      clientRequestId: REQUEST_ID,
      file,
      preparation: await prepared(file),
    })).rejects.toBeInstanceOf(TotalLossInsurerResponseStorageError);
  });
});
