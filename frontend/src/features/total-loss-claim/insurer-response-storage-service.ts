import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateDiminishedValueDocument,
} from "@/features/diminished-value/local-document-files";
import type {
  TotalLossInsurerResponseMediaType,
  TotalLossInsurerResponseUploadPreparation,
} from "@/features/total-loss-claim/contracts";
import type { Database } from "@/lib/supabase/database.types";

const CASE_FILES_BUCKET = "case-files";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface UploadPreparedInsurerResponseInput {
  readonly caseId: string;
  readonly clientRequestId: string;
  readonly file: File;
  readonly preparation: TotalLossInsurerResponseUploadPreparation;
}

export interface TotalLossInsurerResponseStorageService {
  uploadPreparedResponse(
    input: UploadPreparedInsurerResponseInput,
  ): Promise<void>;
}

export class TotalLossInsurerResponseStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossInsurerResponseStorageError";
  }
}

function canonicalExtension(mediaType: TotalLossInsurerResponseMediaType) {
  switch (mediaType) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
  }
}

function copyToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function sha256Hex(file: Blob) {
  if (!globalThis.crypto?.subtle) {
    throw new TotalLossInsurerResponseStorageError(
      "Secure file verification is unavailable in this browser.",
    );
  }
  const source = new Uint8Array(await file.arrayBuffer());
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function assertPreparedUpload(
  input: UploadPreparedInsurerResponseInput,
  digest: string,
  mediaType: TotalLossInsurerResponseMediaType,
  originalFilename: string,
) {
  const { caseId, clientRequestId, file, preparation } = input;
  if (!UUID_PATTERN.test(caseId) || !UUID_PATTERN.test(clientRequestId)) {
    throw new TotalLossInsurerResponseStorageError(
      "A valid case and upload request are required.",
    );
  }
  const pathSegments = preparation.uploadPath.split("/");
  const expectedFilename = `${clientRequestId.toLowerCase()}.${canonicalExtension(mediaType)}`;
  if (
    preparation.documentId.toLowerCase() !== clientRequestId.toLowerCase() ||
    pathSegments.length !== 4 ||
    !UUID_PATTERN.test(pathSegments[0]) ||
    pathSegments[1].toLowerCase() !== caseId.toLowerCase() ||
    pathSegments[2] !== "insurer-responses" ||
    pathSegments[3].toLowerCase() !== expectedFilename ||
    preparation.originalFilename !== originalFilename ||
    preparation.mediaType !== mediaType ||
    preparation.byteSize !== file.size ||
    preparation.contentDigest !== digest
  ) {
    throw new TotalLossInsurerResponseStorageError(
      "The prepared private upload did not match the selected response file.",
    );
  }
}

async function verifyExistingObject(
  bucket: ReturnType<SupabaseClient<Database>["storage"]["from"]>,
  path: string,
  file: File,
  digest: string,
  mediaType: TotalLossInsurerResponseMediaType,
  clientRequestId: string,
  originalFilename: string,
) {
  const { data: info, error: infoError } = await bucket.info(path);
  if (infoError) throw infoError;
  const metadata = info?.metadata && typeof info.metadata === "object"
    ? info.metadata as Record<string, unknown>
    : null;
  if (
    !info ||
    info.name !== path ||
    info.contentType !== mediaType ||
    info.size !== file.size ||
    metadata?.clientRequestId !== clientRequestId ||
    metadata?.contentDigest !== digest ||
    metadata?.originalName !== originalFilename
  ) {
    throw new TotalLossInsurerResponseStorageError(
      "The existing private upload metadata did not match this response file.",
    );
  }
  const { data, error } = await bucket.download(path, {
    cacheNonce: globalThis.crypto.randomUUID(),
  });
  if (error) throw error;
  if (
    !data ||
    data.size !== file.size ||
    (Boolean(data.type) && data.type !== mediaType) ||
    await sha256Hex(data) !== digest
  ) {
    throw new TotalLossInsurerResponseStorageError(
      "The existing private upload did not match this response file.",
    );
  }
}

export function createTotalLossInsurerResponseStorageService(
  client: SupabaseClient<Database>,
): TotalLossInsurerResponseStorageService {
  const bucket = client.storage.from(CASE_FILES_BUCKET);
  return {
    async uploadPreparedResponse(input) {
      const validation = await validateDiminishedValueDocument(input.file);
      if (!validation.valid) {
        throw new TotalLossInsurerResponseStorageError(validation.error);
      }
      const mediaType = validation.mimeType as TotalLossInsurerResponseMediaType;
      const digest = await sha256Hex(input.file);
      assertPreparedUpload(
        input,
        digest,
        mediaType,
        validation.displayFilename,
      );

      const bytes = new Uint8Array(await input.file.arrayBuffer());
      const { data, error } = await bucket.upload(
        input.preparation.uploadPath,
        copyToArrayBuffer(bytes),
        {
          cacheControl: "0",
          contentType: mediaType,
          metadata: {
            clientRequestId: input.clientRequestId,
            contentDigest: digest,
            originalName: validation.displayFilename,
          },
          upsert: false,
        },
      );
      if (error) {
        if (isDuplicateStorageObjectError(error)) {
          await verifyExistingObject(
            bucket,
            input.preparation.uploadPath,
            input.file,
            digest,
            mediaType,
            input.clientRequestId,
            validation.displayFilename,
          );
          return;
        }
        throw error;
      }
      if (
        !data ||
        data.path !== input.preparation.uploadPath ||
        data.fullPath !== `${CASE_FILES_BUCKET}/${input.preparation.uploadPath}`
      ) {
        throw new TotalLossInsurerResponseStorageError(
          "Secure storage did not confirm the expected private response path.",
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
