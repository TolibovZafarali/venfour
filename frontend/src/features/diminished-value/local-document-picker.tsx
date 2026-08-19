import { FileText, Upload, X } from "lucide-react";
import { useId, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import { cn } from "@/lib/utils";

import {
  fileIdentity,
  isAcceptedFile,
  mergeUniqueFiles,
} from "./local-document-files";

interface LocalDocumentPickerProps {
  readonly files: readonly File[];
  readonly onFilesChange: (files: File[]) => void;
}

const ACCEPTED_FILE_TYPES =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";
export function LocalDocumentPicker({
  files,
  onFilesChange,
}: LocalDocumentPickerProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const addFiles = (candidates: readonly File[]) => {
    const accepted = candidates.filter(isAcceptedFile);
    const rejectedCount = candidates.length - accepted.length;
    const merged = mergeUniqueFiles(files, accepted);
    const duplicateCount = files.length + accepted.length - merged.length;
    onFilesChange(merged);

    const updates = [
      rejectedCount > 0
        ? `${rejectedCount} unsupported ${pluralize(rejectedCount, "file", "files")} not added.`
        : null,
      duplicateCount > 0
        ? `${duplicateCount} duplicate ${pluralize(duplicateCount, "file", "files")} already selected.`
        : null,
    ].filter(Boolean);
    setMessage(updates.join(" ") || null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
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
        accept={ACCEPTED_FILE_TYPES}
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
        <label
          htmlFor={inputId}
          className="mt-4 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-brand/35 hover:bg-brand-soft focus-within:outline-none focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 motion-reduce:transition-none"
        >
          Choose files
        </label>
      </div>

      {message ? (
        <p className="mt-2 text-sm leading-5 text-red-700" role="alert">
          {message}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="mt-4 grid gap-2" aria-label="Selected documents">
          {files.map((file) => {
            const key = fileIdentity(file);
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
                    {fileTypeLabel(file)} · {formatFileSize(file.size)}
                  </span>
                </span>
                <button
                  type="button"
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

      <p
        className="mt-3 rounded-lg bg-brand-soft/45 px-3 py-2 text-xs leading-5 text-copy"
        role="status"
      >
        Files remain only in this browser session. They have not been uploaded
        or sent to Venfour.
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
