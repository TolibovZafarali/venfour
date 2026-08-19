import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDocumentPicker } from "./local-document-picker";
import {
  validateDiminishedValueDocument,
  type DiminishedValueDocumentValidationResult,
} from "./local-document-files";

vi.mock("./local-document-files", { spy: true });

const validateDocument = vi.mocked(validateDiminishedValueDocument);

afterEach(() => {
  validateDocument.mockReset();
});

describe("LocalDocumentPicker", () => {
  it("ignores an older validation run that finishes after a newer selection", async () => {
    const first = pdfFile("first.pdf");
    const second = pdfFile("second.pdf");
    const firstValidation = deferred<DiminishedValueDocumentValidationResult>();
    const secondValidation = deferred<DiminishedValueDocumentValidationResult>();
    validateDocument.mockImplementation((file) =>
      file === first ? firstValidation.promise : secondValidation.promise,
    );
    const onFilesChange = vi.fn();

    render(<LocalDocumentPicker files={[]} onFilesChange={onFilesChange} />);
    const input = screen.getByLabelText("Choose files");
    const dropTarget = screen
      .getByText("Drop documents here or browse your device")
      .closest("div");
    if (!dropTarget) throw new Error("Document drop target was not rendered.");

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.drop(dropTarget, { dataTransfer: { files: [second] } });

    await act(async () => {
      secondValidation.resolve(validPdf("second.pdf"));
      await secondValidation.promise;
    });
    expect(onFilesChange).toHaveBeenCalledOnce();
    expect(onFilesChange).toHaveBeenLastCalledWith([second]);

    await act(async () => {
      firstValidation.resolve(validPdf("first.pdf"));
      await firstValidation.promise;
    });
    expect(onFilesChange).toHaveBeenCalledOnce();
    expect(onFilesChange).toHaveBeenLastCalledWith([second]);
  });

  it("merges a completed validation into the latest selected files", async () => {
    const existing = pdfFile("existing.pdf");
    const incoming = pdfFile("incoming.pdf");
    const validation = deferred<DiminishedValueDocumentValidationResult>();
    validateDocument.mockReturnValue(validation.promise);

    function Harness() {
      const [files, setFiles] = useState<File[]>([existing]);
      return <LocalDocumentPicker files={files} onFilesChange={setFiles} />;
    }

    render(<Harness />);
    const input = screen.getByLabelText("Choose files");
    fireEvent.change(input, { target: { files: [incoming] } });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove existing.pdf" }),
    );
    expect(screen.queryByText("existing.pdf")).not.toBeInTheDocument();

    await act(async () => {
      validation.resolve(validPdf("incoming.pdf"));
      await validation.promise;
    });

    expect(screen.getByText("incoming.pdf")).toBeVisible();
    expect(screen.queryByText("existing.pdf")).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pdfFile(name: string) {
  return new File(["%PDF-1.7\n"], name, {
    type: "application/pdf",
    lastModified: 1,
  });
}

function validPdf(
  displayFilename: string,
): DiminishedValueDocumentValidationResult {
  return {
    valid: true,
    displayFilename,
    mimeType: "application/pdf",
    extension: "pdf",
  };
}
