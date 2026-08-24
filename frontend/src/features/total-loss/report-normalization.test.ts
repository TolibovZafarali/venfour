import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  normalizeTotalLossReportFiles,
  TotalLossReportNormalizationError,
} from "@/features/total-loss/report-normalization";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs90AAAAASUVORK5CYII=";

describe("Total Loss report normalization", () => {
  it("keeps one valid multi-page PDF and sanitizes its display name", async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    document.addPage([612, 792]);
    const source = new File(
      [copyToArrayBuffer(await document.save())],
      "  insurer   valuation.pdf  ",
      { type: "application/pdf" },
    );

    const normalized = await normalizeTotalLossReportFiles([source]);

    expect(normalized.file).toBe(source);
    expect(normalized.displayFilename).toBe("insurer valuation.pdf");
    expect(normalized.sourceFileCount).toBe(1);
  });

  it("combines selected PNG scan pages into one ordered private PDF", async () => {
    const image = decodeBase64(ONE_PIXEL_PNG);
    const normalized = await normalizeTotalLossReportFiles([
      new File([image], "page-1.png", { type: "image/png" }),
      new File([image], "page-2.png", { type: "image/png" }),
    ]);

    expect(normalized.displayFilename).toBe(
      "valuation-report-scan-2-pages.pdf",
    );
    expect(normalized.file.type).toBe("application/pdf");
    expect(normalized.sourceFileCount).toBe(2);
    const combined = await PDFDocument.load(await normalized.file.arrayBuffer());
    expect(combined.getPageCount()).toBe(2);
  });

  it("rejects a PDF mixed with image pages", async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const pdf = new File(
      [copyToArrayBuffer(await document.save())],
      "report.pdf",
      { type: "application/pdf" },
    );
    const image = new File([decodeBase64(ONE_PIXEL_PNG)], "page.png", {
      type: "image/png",
    });

    await expect(
      normalizeTotalLossReportFiles([pdf, image]),
    ).rejects.toThrow(
      "Choose one PDF, or select image pages together in the order they appear.",
    );
  });

  it("rejects image pages whose combined source size exceeds the report limit", async () => {
    const imagePage = (name: string) =>
      ({
        name,
        size: 26 * 1024 * 1024,
        type: "image/png",
        arrayBuffer: () => {
          throw new Error("combined-size validation should run first");
        },
      }) as unknown as File;

    await expect(
      normalizeTotalLossReportFiles([
        imagePage("page-1.png"),
        imagePage("page-2.png"),
      ]),
    ).rejects.toThrow(
      "The selected report files must be 50 MiB or smaller in total.",
    );
  });

  it("rejects mismatched image contents before creating a PDF", async () => {
    await expect(
      normalizeTotalLossReportFiles([
        new File(["not an image"], "scan.png", { type: "image/png" }),
      ]),
    ).rejects.toThrow("scan.png does not match its image type.");
  });

  it("returns an actionable error for a corrupt or encrypted-looking PDF", async () => {
    const malformed = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00,
    ]);
    await expect(
      normalizeTotalLossReportFiles([
        new File([copyToArrayBuffer(malformed)], "broken.pdf", {
          type: "application/pdf",
        }),
      ]),
    ).rejects.toThrow(
      "This PDF is corrupted, encrypted, or unreadable. Save an unlocked copy and try again.",
    );
    await expect(
      normalizeTotalLossReportFiles([
        new File([copyToArrayBuffer(malformed)], "broken.pdf", {
          type: "application/pdf",
        }),
      ]),
    ).rejects.toBeInstanceOf(TotalLossReportNormalizationError);
  });
});

function decodeBase64(value: string) {
  const decoded = atob(value);
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return buffer;
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
