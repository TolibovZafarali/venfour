import { PDFDocument } from "pdf-lib";

import {
  MAX_TOTAL_LOSS_PDF_BYTES,
  sanitizeDisplayFilename,
  validateTotalLossReport,
} from "@/features/total-loss/validation";

const MAX_REPORT_PAGES = 250;
const MAX_IMAGE_PAGES = 100;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_TOTAL_IMAGE_PIXELS = 150_000_000;

export interface NormalizedTotalLossReport {
  readonly file: File;
  readonly displayFilename: string;
  readonly sourceFileCount: number;
}

export class TotalLossReportNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossReportNormalizationError";
  }
}

export async function normalizeTotalLossReportFiles(
  files: readonly File[],
): Promise<NormalizedTotalLossReport> {
  if (files.length < 1) {
    throw new TotalLossReportNormalizationError("Choose a valuation report.");
  }
  if (files.length > MAX_IMAGE_PAGES) {
    throw new TotalLossReportNormalizationError(
      `Choose no more than ${MAX_IMAGE_PAGES} image pages.`,
    );
  }

  for (const file of files) {
    const validation = validateTotalLossReport(file);
    if (!validation.valid) {
      throw new TotalLossReportNormalizationError(validation.error);
    }
  }

  const combinedSourceBytes = files.reduce(
    (total, file) => total + file.size,
    0,
  );
  if (
    !Number.isSafeInteger(combinedSourceBytes) ||
    combinedSourceBytes > MAX_TOTAL_LOSS_PDF_BYTES
  ) {
    throw new TotalLossReportNormalizationError(
      "The selected report files must be 50 MiB or smaller in total.",
    );
  }

  const extensions = files.map(fileExtension);
  const includesPdf = extensions.includes("pdf");
  if (includesPdf) {
    if (files.length !== 1) {
      throw new TotalLossReportNormalizationError(
        "Choose one PDF, or select image pages together in the order they appear.",
      );
    }
    return validatePdf(files[0]);
  }

  return imagesToPdf(files, extensions);
}

async function validatePdf(file: File): Promise<NormalizedTotalLossReport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfSignature(bytes)) {
    throw new TotalLossReportNormalizationError(
      "This file does not contain a valid PDF report.",
    );
  }

  let pageCount: number;
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    pageCount = document.getPageCount();
  } catch {
    throw new TotalLossReportNormalizationError(
      "This PDF is corrupted, encrypted, or unreadable. Save an unlocked copy and try again.",
    );
  }
  if (pageCount < 1 || pageCount > MAX_REPORT_PAGES) {
    throw new TotalLossReportNormalizationError(
      `The report must contain between 1 and ${MAX_REPORT_PAGES} pages.`,
    );
  }

  return {
    file,
    displayFilename: sanitizeDisplayFilename(file.name),
    sourceFileCount: 1,
  };
}

async function imagesToPdf(
  files: readonly File[],
  extensions: readonly string[],
): Promise<NormalizedTotalLossReport> {
  const document = await PDFDocument.create();
  let totalPixels = 0;

  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = extensions[index];
    if (!hasExpectedImageSignature(bytes, extension)) {
      throw new TotalLossReportNormalizationError(
        `${sanitizeDisplayFilename(file.name)} does not match its image type.`,
      );
    }

    try {
      const image =
        extension === "png"
          ? await document.embedPng(bytes)
          : await document.embedJpg(bytes);
      const pixels = image.width * image.height;
      totalPixels += pixels;
      if (
        !Number.isSafeInteger(pixels) ||
        pixels < 1 ||
        pixels > MAX_IMAGE_PIXELS ||
        totalPixels > MAX_TOTAL_IMAGE_PIXELS
      ) {
        throw new TotalLossReportNormalizationError(
          "One or more scan pages have dimensions that are too large.",
        );
      }
      const page = document.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    } catch (error) {
      if (error instanceof TotalLossReportNormalizationError) throw error;
      throw new TotalLossReportNormalizationError(
        `${sanitizeDisplayFilename(file.name)} is corrupted or unreadable.`,
      );
    }
  }

  const pdfBytes = await document.save({
    addDefaultPage: false,
    useObjectStreams: true,
  });
  if (pdfBytes.byteLength > MAX_TOTAL_LOSS_PDF_BYTES) {
    throw new TotalLossReportNormalizationError(
      "The combined scan is larger than 50 MiB. Use a smaller or compressed scan.",
    );
  }

  const displayFilename =
    files.length === 1
      ? replaceExtension(sanitizeDisplayFilename(files[0].name), ".pdf")
      : `valuation-report-scan-${files.length}-pages.pdf`;
  return {
    file: new File([copyToArrayBuffer(pdfBytes)], displayFilename, {
      type: "application/pdf",
      lastModified: Date.now(),
    }),
    displayFilename,
    sourceFileCount: files.length,
  };
}

function fileExtension(file: File) {
  return file.name.trim().split(".").at(-1)?.toLowerCase() ?? "";
}

function hasPdfSignature(bytes: Uint8Array) {
  const maximumOffset = Math.min(bytes.length - 5, 1_024);
  for (let offset = 0; offset <= maximumOffset; offset += 1) {
    if (
      bytes[offset] === 0x25 &&
      bytes[offset + 1] === 0x50 &&
      bytes[offset + 2] === 0x44 &&
      bytes[offset + 3] === 0x46 &&
      bytes[offset + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

function hasExpectedImageSignature(bytes: Uint8Array, extension: string) {
  if (extension === "png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  return (
    (extension === "jpg" || extension === "jpeg") &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function replaceExtension(filename: string, extension: string) {
  return filename.replace(/\.[^.]+$/u, "") + extension;
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
