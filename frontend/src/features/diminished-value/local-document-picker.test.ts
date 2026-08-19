import { describe, expect, it } from "vitest";

import {
  DIMINISHED_VALUE_DOCUMENT_ACCEPT,
  DIMINISHED_VALUE_DOCUMENT_ACCEPTED_MIME_TYPES,
  isAcceptedFile,
  MAX_DIMINISHED_VALUE_DOCUMENT_BYTES,
  MAX_DIMINISHED_VALUE_DOCUMENT_COUNT,
  mergeUniqueFiles,
  normalizeDiminishedValueDocumentDisplayFilename,
  validateDiminishedValueDocument,
  validateDiminishedValueDocumentMetadata,
} from "./local-document-files";

describe("local diminished-value documents", () => {
  it("exports one shared allowlist for all documented formats", () => {
    expect(DIMINISHED_VALUE_DOCUMENT_ACCEPTED_MIME_TYPES).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/heic",
      "image/heif",
    ]);
    expect(DIMINISHED_VALUE_DOCUMENT_ACCEPT).toBe(
      ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif",
    );
  });

  it("accepts supported extensions when MIME is absent or agrees", () => {
    expect(isAcceptedFile(file("estimate.pdf", "application/pdf"))).toBe(true);
    expect(isAcceptedFile(file("damage.jpeg", "image/jpeg"))).toBe(true);
    expect(isAcceptedFile(file("damage.PNG", ""))).toBe(true);
    expect(isAcceptedFile(file("phone-photo.heic", "image/heic"))).toBe(true);
    expect(isAcceptedFile(file("scan.heif", "image/heif"))).toBe(true);
  });

  it("rejects unsupported, mismatched, empty, and oversized candidates", () => {
    expect(isAcceptedFile(file("notes.txt", "text/plain"))).toBe(false);
    expect(isAcceptedFile(file("photo.png", "image/jpeg"))).toBe(false);
    expect(isAcceptedFile(file("photo", "image/png"))).toBe(false);
    expect(isAcceptedFile(file("empty.pdf", "application/pdf", 0))).toBe(false);

    expect(
      validateDiminishedValueDocumentMetadata({
        name: "large.pdf",
        type: "application/pdf",
        size: MAX_DIMINISHED_VALUE_DOCUMENT_BYTES + 1,
      }),
    ).toEqual({
      valid: false,
      error: "Each supporting document must be 10 MiB or smaller.",
    });
  });

  it("returns canonical storage metadata without trusting a blank browser MIME", () => {
    expect(
      validateDiminishedValueDocumentMetadata(file("photo.JPEG", "")),
    ).toEqual({
      valid: true,
      displayFilename: "photo.JPEG",
      mimeType: "image/jpeg",
      extension: "jpg",
    });
  });

  it("normalizes display-only filenames and retains an extension while truncating", () => {
    expect(
      normalizeDiminishedValueDocumentDisplayFilename(
        "../  repair\u0000\u202E   invoice.pdf  ",
      ),
    ).toBe("repair invoice.pdf");
    expect(normalizeDiminishedValueDocumentDisplayFilename("..")).toBe(
      "supporting-document",
    );

    const normalized = normalizeDiminishedValueDocumentDisplayFilename(
      `${"a".repeat(300)}.pdf`,
    );
    expect([...normalized]).toHaveLength(255);
    expect(normalized).toMatch(/\.pdf$/u);
  });

  it("merges unique selections and enforces the ten-document limit", () => {
    const estimate = file("estimate.pdf", "application/pdf", 1_000, 10);
    const duplicateEstimate = file(
      "estimate.pdf",
      "application/pdf",
      1_000,
      10,
    );
    const photos = Array.from({ length: 12 }, (_, index) =>
      file(`damage-${index}.jpg`, "image/jpeg", 20 + index, 20 + index),
    );

    const merged = mergeUniqueFiles(
      [estimate],
      [duplicateEstimate, ...photos],
    );
    expect(merged).toHaveLength(MAX_DIMINISHED_VALUE_DOCUMENT_COUNT);
    expect(merged[0]).toBe(estimate);
    expect(
      merged.filter((candidate) => candidate.name === "estimate.pdf"),
    ).toHaveLength(1);
    expect(merged.at(-1)?.name).toBe("damage-8.jpg");
  });

  it.each([
    ["estimate.pdf", "application/pdf", ascii("%PDF-1.7\n")],
    ["damage.jpg", "image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    [
      "damage.png",
      "image/png",
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ],
    ["phone.heic", "image/heic", heifHeader("heic", "mif1")],
    ["phone.heif", "image/heif", heifHeader("mif1", "heic")],
  ] as const)(
    "validates %s with matching metadata and magic bytes",
    async (name, type, contents) => {
      await expect(
        validateDiminishedValueDocument(binaryFile(name, type, contents)),
      ).resolves.toMatchObject({ valid: true });
    },
  );

  it("rejects extension-spoofed content after asynchronous signature validation", async () => {
    await expect(
      validateDiminishedValueDocument(
        binaryFile("not-really.pdf", "application/pdf", ascii("plain text")),
      ),
    ).resolves.toEqual({
      valid: false,
      error: "The document contents do not match its filename and file type.",
    });

    await expect(
      validateDiminishedValueDocument(
        binaryFile(
          "renamed.png",
          "image/png",
          bytes(0xff, 0xd8, 0xff, 0xe0),
        ),
      ),
    ).resolves.toMatchObject({ valid: false });
  });
});

function file(
  name: string,
  type: string,
  size = 10,
  lastModified = 1,
) {
  return new File(["x".repeat(size)], name, { type, lastModified });
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

function heifHeader(majorBrand: string, compatibleBrand: string) {
  return bytes(
    0,
    0,
    0,
    24,
    ...ascii("ftyp"),
    ...ascii(majorBrand),
    0,
    0,
    0,
    0,
    ...ascii(compatibleBrand),
    0,
    0,
    0,
    0,
  );
}
