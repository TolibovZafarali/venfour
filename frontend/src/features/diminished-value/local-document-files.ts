export const MAX_DIMINISHED_VALUE_DOCUMENT_COUNT = 10;
export const MAX_DIMINISHED_VALUE_DOCUMENT_MIB = 10;
export const MAX_DIMINISHED_VALUE_DOCUMENT_BYTES =
  MAX_DIMINISHED_VALUE_DOCUMENT_MIB * 1024 * 1024;

export const DIMINISHED_VALUE_DOCUMENT_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
] as const;

export const DIMINISHED_VALUE_DOCUMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

export type DiminishedValueDocumentMimeType =
  (typeof DIMINISHED_VALUE_DOCUMENT_ACCEPTED_MIME_TYPES)[number];

export type DiminishedValueDocumentExtension =
  | "pdf"
  | "jpg"
  | "png"
  | "heic"
  | "heif";

export type DiminishedValueDocumentValidationResult =
  | {
      readonly valid: true;
      readonly displayFilename: string;
      readonly mimeType: DiminishedValueDocumentMimeType;
      readonly extension: DiminishedValueDocumentExtension;
    }
  | { readonly valid: false; readonly error: string };

interface DiminishedValueDocumentCandidate {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

const ACCEPTED_MIME_TYPES = new Set<string>(
  DIMINISHED_VALUE_DOCUMENT_ACCEPTED_MIME_TYPES,
);
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
]);
const HEIF_BRANDS = new Set(["mif1", "msf1", "heif"]);
const MAGIC_BYTES_TO_READ = 256;
const MAX_DISPLAY_FILENAME_CHARACTERS = 255;

export function mergeUniqueFiles(
  currentFiles: readonly File[],
  incomingFiles: readonly File[],
) {
  const filesByIdentity = new Map(
    currentFiles.map((file) => [fileIdentity(file), file]),
  );
  for (const file of incomingFiles) {
    if (!filesByIdentity.has(fileIdentity(file))) {
      filesByIdentity.set(fileIdentity(file), file);
    }
  }
  return [...filesByIdentity.values()].slice(
    0,
    MAX_DIMINISHED_VALUE_DOCUMENT_COUNT,
  );
}

/**
 * Performs the synchronous checks suitable for a file-input preflight. The
 * asynchronous validator must still confirm the file signature before upload.
 */
export function isAcceptedFile(file: File) {
  return validateDiminishedValueDocumentMetadata(file).valid;
}

export function validateDiminishedValueDocumentMetadata(
  file: DiminishedValueDocumentCandidate,
): DiminishedValueDocumentValidationResult {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { valid: false, error: "Choose a nonempty supporting document." };
  }

  if (file.size > MAX_DIMINISHED_VALUE_DOCUMENT_BYTES) {
    return {
      valid: false,
      error: `Each supporting document must be ${MAX_DIMINISHED_VALUE_DOCUMENT_MIB} MiB or smaller.`,
    };
  }

  const displayFilename = normalizeDiminishedValueDocumentDisplayFilename(
    file.name,
  );
  const format = formatForFilename(displayFilename);
  if (!format) {
    return {
      valid: false,
      error: "Choose a PDF, JPEG, PNG, HEIC, or HEIF file.",
    };
  }

  const browserMimeType = file.type.trim().toLocaleLowerCase("en-US");
  if (
    browserMimeType &&
    (!ACCEPTED_MIME_TYPES.has(browserMimeType) ||
      browserMimeType !== format.mimeType)
  ) {
    return {
      valid: false,
      error: "The filename extension and file type do not match.",
    };
  }

  return {
    valid: true,
    displayFilename,
    mimeType: format.mimeType,
    extension: format.extension,
  };
}

export async function validateDiminishedValueDocument(
  file: File,
): Promise<DiminishedValueDocumentValidationResult> {
  const metadata = validateDiminishedValueDocumentMetadata(file);
  if (!metadata.valid) return metadata;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(
      await file.slice(0, MAGIC_BYTES_TO_READ).arrayBuffer(),
    );
  } catch {
    return {
      valid: false,
      error: "Venfour could not verify the selected document. Choose it again.",
    };
  }

  const detectedMimeType = detectMimeType(bytes);
  if (detectedMimeType !== metadata.mimeType) {
    return {
      valid: false,
      error: "The document contents do not match its filename and file type.",
    };
  }

  return metadata;
}

export function normalizeDiminishedValueDocumentDisplayFilename(
  filename: string,
) {
  const basename = filename.split(/[\\/]/u).at(-1) ?? "";
  const sanitized = [...basename.normalize("NFC")]
    .filter((character) => !isUnsafeDisplayCharacter(character))
    .join("")
    .trim()
    .replace(/\s+/gu, " ");
  const safeName =
    !sanitized || sanitized === "." || sanitized === ".."
      ? "supporting-document"
      : sanitized;

  if ([...safeName].length <= MAX_DISPLAY_FILENAME_CHARACTERS) {
    return safeName;
  }

  const extensionMatch = /\.[^.]+$/u.exec(safeName);
  const extension = extensionMatch?.[0] ?? "";
  const extensionCharacters = [...extension];
  const stemCharacters = [...safeName.slice(0, -extension.length)];
  const availableStemCharacters = Math.max(
    1,
    MAX_DISPLAY_FILENAME_CHARACTERS - extensionCharacters.length,
  );
  const stem = stemCharacters
    .slice(0, availableStemCharacters)
    .join("")
    .trimEnd();
  return `${stem}${extensionCharacters
    .slice(0, MAX_DISPLAY_FILENAME_CHARACTERS - [...stem].length)
    .join("")}`;
}

export function fileIdentity(file: File) {
  return [file.name, file.size, file.lastModified, file.type].join("\u0000");
}

function formatForFilename(displayFilename: string): {
  readonly mimeType: DiminishedValueDocumentMimeType;
  readonly extension: DiminishedValueDocumentExtension;
} | null {
  const extension = /\.([^.]+)$/u.exec(displayFilename)?.[1]?.toLowerCase();
  switch (extension) {
    case "pdf":
      return { mimeType: "application/pdf", extension: "pdf" };
    case "jpg":
    case "jpeg":
      return { mimeType: "image/jpeg", extension: "jpg" };
    case "png":
      return { mimeType: "image/png", extension: "png" };
    case "heic":
      return { mimeType: "image/heic", extension: "heic" };
    case "heif":
      return { mimeType: "image/heif", extension: "heif" };
    default:
      return null;
  }
}

function detectMimeType(
  bytes: Uint8Array,
): DiminishedValueDocumentMimeType | null {
  if (startsWithAscii(bytes, "%PDF-")) return "application/pdf";
  if (matchesBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    matchesBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  return detectHeifMimeType(bytes);
}

function detectHeifMimeType(
  bytes: Uint8Array,
): "image/heic" | "image/heif" | null {
  if (bytes.length < 12 || !startsWithAscii(bytes, "ftyp", 4)) return null;

  const declaredBoxSize =
    ((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0);
  const boxEnd =
    declaredBoxSize >= 12
      ? Math.min(declaredBoxSize >>> 0, bytes.length)
      : bytes.length;
  const majorBrand = readAscii(bytes, 8, 12);
  const compatibleBrands: string[] = [];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    compatibleBrands.push(readAscii(bytes, offset, offset + 4));
  }

  if (HEIC_BRANDS.has(majorBrand)) return "image/heic";
  if (HEIF_BRANDS.has(majorBrand)) return "image/heif";
  if (compatibleBrands.some((brand) => HEIC_BRANDS.has(brand))) {
    return "image/heic";
  }
  if (compatibleBrands.some((brand) => HEIF_BRANDS.has(brand))) {
    return "image/heif";
  }
  return null;
}

function matchesBytes(bytes: Uint8Array, expected: readonly number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, expected: string, offset = 0) {
  return readAscii(bytes, offset, offset + expected.length) === expected;
}

function readAscii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function isUnsafeDisplayCharacter(character: string) {
  const codePoint = character.codePointAt(0);
  return (
    codePoint === undefined ||
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}
