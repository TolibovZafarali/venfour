import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import {
  MAX_DIMINISHED_VALUE_DOCUMENT_BYTES,
  normalizeDiminishedValueDocumentDisplayFilename,
  validateDiminishedValueDocument,
  type DiminishedValueDocumentExtension,
  type DiminishedValueDocumentMimeType,
} from "./local-document-files";

const CASE_FILES_BUCKET = "case-files";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DOCUMENT_NAME_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|jpg|png|heic|heif)$/iu;
const DOCUMENT_EXTENSIONS = new Set(["pdf", "jpg", "png", "heic", "heif"]);

export interface DiminishedValueStoredDocument {
  readonly id: string;
  readonly path: string;
  readonly displayFilename: string;
  readonly mimeType: DiminishedValueDocumentMimeType;
  readonly extension: DiminishedValueDocumentExtension;
  readonly size: number;
  readonly createdAt: string;
}

export interface UploadDiminishedValueDocumentInput {
  readonly userId: string;
  readonly caseId: string;
  readonly documentId: string;
  readonly file: File;
}

export interface DiminishedValueDocumentScope {
  readonly userId: string;
  readonly caseId: string;
}

export interface RemoveDiminishedValueDocumentInput extends DiminishedValueDocumentScope {
  readonly document: DiminishedValueStoredDocument;
}

export interface DownloadDiminishedValueDocumentInput extends DiminishedValueDocumentScope {
  readonly document: DiminishedValueStoredDocument;
  readonly signal?: AbortSignal;
}

export interface DiminishedValueDocumentReadService {
  listDocuments(
    input: DiminishedValueDocumentScope,
  ): Promise<DiminishedValueStoredDocument[]>;
  downloadDocument(input: DownloadDiminishedValueDocumentInput): Promise<Blob>;
}

export interface DiminishedValueDocumentStorageService {
  listDocuments(
    input: DiminishedValueDocumentScope,
  ): Promise<DiminishedValueStoredDocument[]>;
  uploadDocument(
    input: UploadDiminishedValueDocumentInput,
  ): Promise<DiminishedValueStoredDocument>;
  removeDocument(input: RemoveDiminishedValueDocumentInput): Promise<void>;
}

export class DiminishedValueDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiminishedValueDocumentValidationError";
  }
}

export class DiminishedValueDocumentResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiminishedValueDocumentResponseError";
  }
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new DiminishedValueDocumentValidationError(
      `${label} must be a valid UUID.`,
    );
  }
}

export function getDiminishedValueDocumentPrefix(
  userId: string,
  caseId: string,
) {
  assertUuid(userId, "User ID");
  assertUuid(caseId, "Case ID");
  return `${userId}/${caseId}/diminished-value`;
}

export function getDiminishedValueDocumentPath(
  userId: string,
  caseId: string,
  documentId: string,
  extension: DiminishedValueDocumentExtension,
) {
  assertUuid(documentId, "Document ID");
  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw new DiminishedValueDocumentValidationError(
      "Document extension is not supported.",
    );
  }
  return `${getDiminishedValueDocumentPrefix(userId, caseId)}/${documentId}.${extension}`;
}

export function createDiminishedValueDocumentStorageService(
  client: SupabaseClient<Database>,
): DiminishedValueDocumentStorageService & DiminishedValueDocumentReadService {
  const bucket = client.storage.from(CASE_FILES_BUCKET);

  const readStoredDocument = async (
    scope: DiminishedValueDocumentScope,
    objectName: string,
  ): Promise<DiminishedValueStoredDocument> => {
    const match = DOCUMENT_NAME_PATTERN.exec(objectName);
    if (!match) {
      throw new DiminishedValueDocumentResponseError(
        "Supabase returned an unexpected diminished-value document path.",
      );
    }

    const id = match[1].toLowerCase();
    const extension =
      match[2].toLowerCase() as DiminishedValueDocumentExtension;
    const path = getDiminishedValueDocumentPath(
      scope.userId,
      scope.caseId,
      id,
      extension,
    );
    const { data, error } = await bucket.info(path);
    if (error) throw error;
    if (!data || data.name !== path) {
      throw new DiminishedValueDocumentResponseError(
        "Supabase did not confirm the expected private document path.",
      );
    }

    const mimeType = mimeTypeForExtension(extension);
    if (data.contentType !== mimeType) {
      throw new DiminishedValueDocumentResponseError(
        "A stored document has an unexpected content type.",
      );
    }
    if (
      !Number.isSafeInteger(data.size) ||
      (data.size ?? 0) <= 0 ||
      (data.size ?? 0) > MAX_DIMINISHED_VALUE_DOCUMENT_BYTES
    ) {
      throw new DiminishedValueDocumentResponseError(
        "A stored document has an invalid size.",
      );
    }

    const originalName = readOriginalName(data.metadata);
    return {
      id,
      path,
      displayFilename: originalName ?? `Supporting document.${extension}`,
      mimeType,
      extension,
      size: data.size as number,
      createdAt: data.createdAt,
    };
  };

  return {
    async listDocuments(scope) {
      const prefix = getDiminishedValueDocumentPrefix(
        scope.userId,
        scope.caseId,
      );
      const { data, error } = await bucket.list(prefix, {
        limit: 100,
        sortBy: { column: "created_at", order: "asc" },
      });
      if (error) throw error;
      if (!data) {
        throw new DiminishedValueDocumentResponseError(
          "Supabase did not return the private document list.",
        );
      }

      const objectNames = data
        .filter((object) => object.id !== null)
        .map((object) => object.name);
      return Promise.all(
        objectNames.map((objectName) => readStoredDocument(scope, objectName)),
      );
    },

    async downloadDocument({ userId, caseId, document, signal }) {
      const expectedPath = getDiminishedValueDocumentPath(
        userId,
        caseId,
        document.id,
        document.extension,
      );
      if (document.path !== expectedPath) {
        throw new DiminishedValueDocumentValidationError(
          "The document is outside the requested case scope.",
        );
      }

      const { data, error } = await bucket.download(
        expectedPath,
        { cacheNonce: globalThis.crypto.randomUUID() },
        { cache: "no-store", signal },
      );
      if (error) throw error;
      if (!data) {
        throw new DiminishedValueDocumentResponseError(
          "Supabase did not return the requested private document.",
        );
      }
      if (data.size !== document.size || data.type !== document.mimeType) {
        throw new DiminishedValueDocumentResponseError(
          "The downloaded document did not match its verified metadata.",
        );
      }

      return data;
    },

    async uploadDocument({ userId, caseId, documentId, file }) {
      const validation = await validateDiminishedValueDocument(file);
      if (!validation.valid) {
        throw new DiminishedValueDocumentValidationError(validation.error);
      }

      const path = getDiminishedValueDocumentPath(
        userId,
        caseId,
        documentId,
        validation.extension,
      );
      const options = {
        cacheControl: "0",
        contentType: validation.mimeType,
        metadata: { originalName: validation.displayFilename },
        upsert: false,
      } as const;
      const { data, error } = await bucket.upload(
        path,
        await file.arrayBuffer(),
        options,
      );

      if (error) {
        if (isDuplicateStorageObjectError(error)) {
          const existing = await readStoredDocument(
            { userId, caseId },
            `${documentId}.${validation.extension}`,
          );
          if (
            existing.displayFilename === validation.displayFilename &&
            existing.mimeType === validation.mimeType &&
            existing.size === file.size
          ) {
            return existing;
          }
        }
        throw error;
      }
      if (
        !data ||
        data.path !== path ||
        data.fullPath !== `${CASE_FILES_BUCKET}/${path}`
      ) {
        throw new DiminishedValueDocumentResponseError(
          "Supabase did not confirm the expected private document path.",
        );
      }

      return readStoredDocument(
        { userId, caseId },
        `${documentId}.${validation.extension}`,
      );
    },

    async removeDocument({ userId, caseId, document }) {
      const expectedPath = getDiminishedValueDocumentPath(
        userId,
        caseId,
        document.id,
        document.extension,
      );
      if (document.path !== expectedPath) {
        throw new DiminishedValueDocumentValidationError(
          "The document is outside the requested case scope.",
        );
      }

      const { data, error } = await bucket.remove([expectedPath]);
      if (error) throw error;
      if (data?.length !== 1 || data[0]?.name !== expectedPath) {
        throw new DiminishedValueDocumentResponseError(
          "Supabase did not confirm removal of the private document.",
        );
      }
    },
  };
}

function mimeTypeForExtension(
  extension: DiminishedValueDocumentExtension,
): DiminishedValueDocumentMimeType {
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
  }
}

function readOriginalName(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const candidate = (metadata as Record<string, unknown>).originalName;
  if (typeof candidate !== "string") return null;
  const normalized = normalizeDiminishedValueDocumentDisplayFilename(candidate);
  return normalized || null;
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
