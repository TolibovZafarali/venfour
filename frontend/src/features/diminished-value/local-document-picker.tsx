import { FileText, Upload, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import { cn } from "@/lib/utils";

import {
  DIMINISHED_VALUE_DOCUMENT_ACCEPT,
  fileIdentity,
  MAX_DIMINISHED_VALUE_DOCUMENT_COUNT,
  mergeUniqueFiles,
  validateDiminishedValueDocument,
} from "./local-document-files";
import type { DiminishedValueStoredDocument } from "./storage-service";

export interface DiminishedValuePendingDocumentState {
  readonly identity: string;
  readonly state: "queued" | "uploading" | "error";
  readonly error?: string;
}

interface LocalDocumentPickerProps {
  readonly files: readonly File[];
  readonly onFilesChange: (files: File[]) => void;
  readonly storedDocuments?: readonly DiminishedValueStoredDocument[];
  readonly pendingStates?: readonly DiminishedValuePendingDocumentState[];
  readonly onRetryUploads?: () => void;
  readonly onRemoveStoredDocument?: (
    document: DiminishedValueStoredDocument,
  ) => void;
  readonly removingDocumentId?: string | null;
  readonly requiresAuthentication?: boolean;
  readonly onAuthenticationRequired?: () => void;
  readonly disabled?: boolean;
}

export function LocalDocumentPicker({
  files,
  onFilesChange,
  storedDocuments = [],
  pendingStates = [],
  onRetryUploads,
  onRemoveStoredDocument,
  removingDocumentId = null,
  requiresAuthentication = false,
  onAuthenticationRequired,
  disabled = false,
}: LocalDocumentPickerProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const validationRunRef = useRef(0);
  const latestSelectionRef = useRef({
    files,
    onFilesChange,
    storedDocuments,
  });

  useLayoutEffect(() => {
    latestSelectionRef.current = { files, onFilesChange, storedDocuments };
  }, [files, onFilesChange, storedDocuments]);

  useEffect(
    () => () => {
      validationRunRef.current += 1;
    },
    [],
  );

  const addFiles = async (candidates: readonly File[]) => {
    if (disabled) return;
    if (requiresAuthentication) {
      onAuthenticationRequired?.();
      return;
    }

    const validationRun = validationRunRef.current + 1;
    validationRunRef.current = validationRun;
    setValidating(true);
    const results = await Promise.all(
      candidates.map(async (file) => ({
        file,
        validation: await validateDiminishedValueDocument(file),
      })),
    );
    if (validationRun !== validationRunRef.current) return;

    setValidating(false);
    const {
      files: currentFiles,
      onFilesChange: updateFiles,
      storedDocuments: currentStoredDocuments,
    } = latestSelectionRef.current;
    const accepted = results
      .filter((result) => result.validation.valid)
      .map((result) => result.file);
    const rejected = results.filter((result) => !result.validation.valid);
    const rejectedCount = rejected.length;
    const availableSlots = Math.max(
      0,
      MAX_DIMINISHED_VALUE_DOCUMENT_COUNT - currentStoredDocuments.length,
    );
    const merged = mergeUniqueFiles(currentFiles, accepted).slice(
      0,
      availableSlots,
    );
    const duplicateCount =
      currentFiles.length + accepted.length - merged.length;
    updateFiles(merged);

    const updates = [
      rejectedCount > 0
        ? rejected[0]?.validation.valid === false
          ? rejected[0].validation.error
          : `${rejectedCount} unsupported ${pluralize(rejectedCount, "file", "files")} not added.`
        : null,
      duplicateCount > 0
        ? `${duplicateCount} duplicate ${pluralize(duplicateCount, "file", "files")} already selected.`
        : null,
      currentStoredDocuments.length + currentFiles.length + accepted.length >
      MAX_DIMINISHED_VALUE_DOCUMENT_COUNT
        ? `Attach up to ${MAX_DIMINISHED_VALUE_DOCUMENT_COUNT} supporting documents.`
        : null,
    ].filter(Boolean);
    setMessage(updates.join(" ") || null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-ink">Supporting documents</p>
        <span className="text-xs text-copy">Optional</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-copy">
        Repair estimates or invoices, photos, police reports, and insurance
        documents can help a reviewer understand the case.
      </p>
      <input
        id={inputId}
        className="peer sr-only"
        type="file"
        multiple
        accept={DIMINISHED_VALUE_DOCUMENT_ACCEPT}
        disabled={disabled || requiresAuthentication || validating}
        onChange={handleFileChange}
      />
      <div
        className={cn(
          "mt-3 rounded-xl border border-dashed bg-surface/65 p-6 text-center transition-colors motion-reduce:transition-none",
          "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2",
          dragging ? "border-brand bg-brand-soft/55" : "border-line-strong/70",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
      >
        <Upload className="mx-auto size-8 text-brand" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-ink">
          Drop documents here or browse your device
        </p>
        <p className="mt-1 text-xs text-copy">PDF, JPEG, PNG, HEIC, or HEIF</p>
        {requiresAuthentication ? (
          <button
            type="button"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-brand/35 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
            onClick={onAuthenticationRequired}
          >
            Sign in to attach files
          </button>
        ) : (
          <label
            htmlFor={inputId}
            className={cn(
              "mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 motion-reduce:transition-none",
              disabled || validating
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-brand/35 hover:bg-brand-soft",
            )}
          >
            {validating ? "Checking files…" : "Choose files"}
          </label>
        )}
      </div>

      {message ? (
        <p className="mt-2 text-sm leading-5 text-red-700" role="alert">
          {message}
        </p>
      ) : null}

      {storedDocuments.length > 0 ? (
        <ul className="mt-4 grid gap-2" aria-label="Attached documents">
          {storedDocuments.map((document) => (
            <li
              key={document.id}
              className="flex items-center gap-3 rounded-lg border border-market/25 bg-market-soft/20 px-3 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-market-soft text-market-strong">
                <FileText className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {document.displayFilename}
                </span>
                <span className="block text-xs text-copy">
                  Attached · {formatFileSize(document.size)}
                </span>
              </span>
              {onRemoveStoredDocument ? (
                <button
                  type="button"
                  disabled={disabled || removingDocumentId === document.id}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-copy transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                  aria-label={`Remove ${document.displayFilename}`}
                  onClick={() => onRemoveStoredDocument(document)}
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <ul className="mt-4 grid gap-2" aria-label="Selected documents">
          {files.map((file) => {
            const key = fileIdentity(file);
            const pending = pendingStates.find(
              (candidate) => candidate.identity === key,
            );
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <FileText className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {file.name}
                  </span>
                  <span className="block text-xs text-copy">
                    {pending?.state === "uploading"
                      ? "Uploading securely…"
                      : pending?.state === "error"
                        ? pending.error ?? "Upload failed"
                        : `${fileTypeLabel(file)} · ${formatFileSize(file.size)}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={disabled || pending?.state === "uploading"}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-copy transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    onFilesChange(files.filter((candidate) => candidate !== file))
                  }
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {pendingStates.some((pending) => pending.state === "error") &&
      onRetryUploads ? (
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          onClick={onRetryUploads}
        >
          Retry failed uploads
        </button>
      ) : null}

      <p
        className="mt-3 rounded-lg bg-brand-soft/45 px-3 py-2 text-xs leading-5 text-copy"
        role="status"
      >
        {requiresAuthentication
          ? "Sign in before choosing documents so they can be stored privately with your case."
          : files.length > 0
            ? "Selected documents are awaiting secure upload. Retry or remove any failed upload before submitting."
            : "Attached documents are stored privately with your case. You can remove or replace them until you submit the request."}
      </p>
    </div>
  );
}

function fileTypeLabel(file: File) {
  const extension = file.name.split(".").at(-1)?.toUpperCase();
  return extension || file.type || "File";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KiB`;
  return `${(kibibytes / 1024).toFixed(1)} MiB`;
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}
