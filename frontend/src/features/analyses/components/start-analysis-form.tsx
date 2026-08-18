import {
  AlertCircle,
  ArrowRight,
  FileText,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useId,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";

import { useCreateAnalysisMutation } from "@/features/analyses/mutations";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const US_ZIP_CODE_PATTERN = /^[0-9]{5}(?:-[0-9]{4})?$/;
const GENERIC_BINARY_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

interface FormErrors {
  report?: string;
  postalCode?: string;
}

interface CustomerError {
  title: string;
  description: string;
}

function validateReport(report: File) {
  if (report.size <= 0) {
    return "This PDF is empty. Choose the original insurance value report.";
  }

  if (report.size >= MAX_REPORT_BYTES) {
    return "Choose a PDF smaller than 50 MiB.";
  }

  const hasPdfName = report.name.toLowerCase().endsWith(".pdf");
  const normalizedType = report.type.toLowerCase();
  const hasPdfType = normalizedType === "application/pdf";
  const hasConflictingType =
    Boolean(normalizedType) &&
    !hasPdfType &&
    !GENERIC_BINARY_MIME_TYPES.has(normalizedType);

  if ((!hasPdfName && !hasPdfType) || hasConflictingType) {
    return "Choose a PDF version of your insurance value report.";
  }

  return undefined;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function validatePostalCode(postalCode: string) {
  const normalizedPostalCode = postalCode.trim();

  if (!normalizedPostalCode) {
    return "Enter the ZIP code for the vehicle.";
  }

  if (!US_ZIP_CODE_PATTERN.test(normalizedPostalCode)) {
    return "Enter a 5-digit ZIP code or ZIP+4, such as 60611 or 60611-1234.";
  }

  return undefined;
}

function customerErrorFor(error: unknown): CustomerError {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "REPORT_REQUIRED":
      case "INVALID_REPORT":
        return {
          title: "Choose a valid PDF",
          description:
            "We couldn’t use this file. Select the original PDF version of your insurance value report.",
        };
      case "INVALID_MULTIPART_REQUEST":
      case "UNSUPPORTED_MEDIA_TYPE":
        return {
          title: "We couldn’t submit your report",
          description:
            "Your report and ZIP code are still selected. Refresh the page and try again.",
        };
      case "REPORT_TOO_LARGE":
        return {
          title: "Your report is too large",
          description: "Choose a PDF smaller than 50 MiB, then try again.",
        };
      case "REPORT_EXTRACTION_FAILED":
        return {
          title: "We couldn’t read this report",
          description:
            "Venfour couldn’t finish reading the PDF. Your selections are still here, so you can try again.",
        };
      case "REPORT_NOT_ANALYZABLE":
        return {
          title: "This report couldn’t be analyzed",
          description:
            "The PDF was readable, but its valuation details weren’t complete enough for a reliable review. If you have another copy, try that one.",
        };
      case "POSTAL_CODE_REQUIRED":
        return {
          title: "Enter a ZIP code",
          description:
            "Add the ZIP code for the vehicle so we can search the relevant local market.",
        };
      case "INVALID_POSTAL_CODE":
        return {
          title: "Check the ZIP code",
          description:
            "Enter a 5-digit US ZIP code or ZIP+4, such as 60611 or 60611-1234.",
        };
      case "MARKET_PROVIDER_UNAVAILABLE":
        return {
          title: "Market search is temporarily unavailable",
          description:
            "Your report and ZIP code are still selected. Please try again in a few minutes.",
        };
      case "ANALYSIS_CREATION_UNAVAILABLE":
        return {
          title: "Analysis is temporarily unavailable",
          description:
            "Your report and ZIP code are still selected. Please try again in a few minutes.",
        };
      case "ANALYSIS_CREATION_FAILED":
      case "INTERNAL_ERROR":
        return {
          title: "Venfour couldn’t complete this review",
          description:
            "No analysis was created. Your report and ZIP code are still selected, so you can try again.",
        };
    }

    if (error.status >= 500) {
      return {
        title: "Venfour couldn’t complete this review",
        description:
          "The service encountered a temporary problem. Your selections are still here; please try again in a few minutes.",
      };
    }
  }

  if (error instanceof TypeError) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return {
        title: "You appear to be offline",
        description:
          "Reconnect to the internet, then try again. Your report and ZIP code are still selected.",
      };
    }

    return {
      title: "We couldn’t reach Venfour",
      description:
        "Check your internet connection and try again. Your report and ZIP code are still selected.",
    };
  }

  return {
    title: "We couldn’t create your review",
    description:
      "Your report and ZIP code are still selected. Please try again.",
  };
}

export function StartAnalysisForm() {
  const navigate = useNavigate();
  const mutation = useCreateAnalysisMutation();
  const [report, setReport] = useState<File | null>(null);
  const [postalCode, setPostalCode] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const postalCodeRef = useRef<HTMLInputElement>(null);
  const submissionInFlightRef = useRef(false);
  const reportInputId = useId();
  const reportHelpId = useId();
  const reportErrorId = useId();
  const postalHelpId = useId();
  const postalErrorId = useId();

  const clearServerError = () => {
    if (mutation.isError) {
      mutation.reset();
    }
  };

  const selectReport = (nextReport: File) => {
    clearServerError();
    const reportError = validateReport(nextReport);

    if (reportError) {
      setReport(null);
      setErrors((current) => ({ ...current, report: reportError }));
      return;
    }

    setReport(nextReport);
    setErrors((current) => ({ ...current, report: undefined }));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [nextReport] = Array.from(event.target.files ?? []);

    if (nextReport) {
      selectReport(nextReport);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    if (mutation.isPending) {
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length !== 1) {
      clearServerError();
      setReport(null);
      setErrors((current) => ({
        ...current,
        report: "Choose one insurance value report PDF at a time.",
      }));
      return;
    }

    selectReport(droppedFiles[0]);
  };

  const submitAnalysis = (nextReport: File, normalizedPostalCode: string) => {
    if (submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    mutation.mutate(
      { report: nextReport, postalCode: normalizedPostalCode },
      {
        onSuccess: ({ runId }) => {
          navigate(`/analyses/${encodeURIComponent(runId)}`);
        },
        onSettled: () => {
          submissionInFlightRef.current = false;
        },
      },
    );
  };

  const validateAndSubmit = () => {
    const nextErrors: FormErrors = {};
    const normalizedPostalCode = postalCode.trim();

    if (!report) {
      nextErrors.report = "Choose your insurance value report.";
    } else {
      nextErrors.report = validateReport(report);
    }

    nextErrors.postalCode = validatePostalCode(normalizedPostalCode);

    setErrors(nextErrors);

    if (nextErrors.report) {
      fileInputRef.current?.focus();
      return;
    }

    if (nextErrors.postalCode) {
      postalCodeRef.current?.focus();
      return;
    }

    if (report) {
      submitAnalysis(report, normalizedPostalCode);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!mutation.isPending) {
      validateAndSubmit();
    }
  };

  const customerError = mutation.isError
    ? customerErrorFor(mutation.error)
    : null;

  return (
    <div className="relative">
      <p className="sr-only" aria-live="polite">
        {report ? `${report.name} selected.` : ""}
      </p>
      <form
        className="overflow-hidden rounded-xl border border-neutral-200 bg-white p-5 shadow-[0_18px_50px_-38px_rgba(0,0,0,0.35)] sm:p-7 lg:p-8"
        onSubmit={handleSubmit}
        aria-busy={mutation.isPending}
        aria-label="Start total-loss appraisal"
        noValidate
      >
        <div className="border-b border-neutral-100 pb-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-neutral-500 uppercase">
            Start your appraisal
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-neutral-950 sm:text-2xl">
            Upload your insurance report
          </h3>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Add the valuation PDF from your insurer and the vehicle’s ZIP code.
          </p>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label
                htmlFor={reportInputId}
                className="text-sm font-medium text-neutral-900"
              >
                Insurance value report
              </label>
              <span className="text-xs text-neutral-500">
                PDF · under 50 MiB
              </span>
            </div>
            <div
              className={cn(
                "flex min-h-40 items-center justify-center rounded-lg border border-dashed px-5 py-6 text-center transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2",
                isDragging
                  ? "border-brand bg-brand-soft"
                  : "border-neutral-300 bg-neutral-50/70",
                errors.report && "border-destructive/60 bg-destructive/[0.025]",
              )}
              role="group"
              aria-label="Insurance report upload"
              onDragEnter={(event) => {
                event.preventDefault();
                if (!mutation.isPending) {
                  setIsDragging(true);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setIsDragging(false);
                }
              }}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                id={reportInputId}
                className="sr-only"
                type="file"
                accept=".pdf,application/pdf"
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={handleFileChange}
                aria-describedby={
                  errors.report
                    ? `${reportHelpId} ${reportErrorId}`
                    : reportHelpId
                }
                aria-invalid={Boolean(errors.report)}
                disabled={mutation.isPending}
              />
              {report ? (
                <div className="flex w-full items-center gap-3 text-left">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white shadow-sm">
                    <FileText className="size-5 text-brand" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-950">
                      {report.name}
                    </span>
                    <span className="mt-1 block text-xs text-neutral-500">
                      PDF · {formatFileSize(report.size)}
                    </span>
                  </span>
                  <label
                    htmlFor={reportInputId}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200/70 hover:text-brand"
                  >
                    Change
                  </label>
                  <button
                    type="button"
                    className="inline-flex size-11 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => {
                      clearServerError();
                      setReport(null);
                      setErrors((current) => ({
                        ...current,
                        report: undefined,
                      }));
                    }}
                    aria-label={`Remove ${report.name}`}
                    disabled={mutation.isPending}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="flex size-11 items-center justify-center rounded-md border border-neutral-200 bg-white shadow-sm">
                    <Upload className="size-5 text-brand" aria-hidden />
                  </span>
                  <p className="mt-4 text-sm font-medium text-neutral-950">
                    Drop your report here
                  </p>
                  <p
                    id={reportHelpId}
                    className="mt-1 text-xs text-neutral-500"
                  >
                    or select the PDF from your device
                  </p>
                  <label
                    htmlFor={reportInputId}
                    className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-md border border-neutral-300 bg-white px-3.5 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-brand/40 hover:bg-brand-soft"
                  >
                    Choose PDF
                  </label>
                </div>
              )}
            </div>
            {report && !errors.report ? (
              <p id={reportHelpId} className="sr-only">
                Selected insurance value report PDF.
              </p>
            ) : null}
            {errors.report ? (
              <p
                id={reportErrorId}
                className="mt-2 text-sm text-destructive"
                role="alert"
              >
                {errors.report}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="analysis-postal-code"
              className="text-sm font-medium text-neutral-900"
            >
              Vehicle ZIP code
            </label>
            <div className="relative mt-2">
              <MapPin
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <input
                ref={postalCodeRef}
                id="analysis-postal-code"
                className="h-12 w-full rounded-md border border-neutral-300 bg-white pr-4 pl-10 text-base text-neutral-950 shadow-sm transition-colors placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 sm:text-sm"
                name="postalCode"
                value={postalCode}
                onChange={(event) => {
                  clearServerError();
                  setPostalCode(event.target.value);
                  setErrors((current) => ({
                    ...current,
                    postalCode: undefined,
                  }));
                }}
                placeholder="e.g. 60611"
                autoComplete="postal-code"
                inputMode="text"
                maxLength={16}
                aria-describedby={
                  errors.postalCode
                    ? `${postalHelpId} ${postalErrorId}`
                    : postalHelpId
                }
                aria-invalid={Boolean(errors.postalCode)}
                disabled={mutation.isPending}
              />
            </div>
            <p
              id={postalHelpId}
              className="mt-2 text-xs leading-5 text-neutral-500"
            >
              Enter a 5-digit ZIP or ZIP+4. This is used to find relevant
              similar vehicles near you.
            </p>
            {errors.postalCode ? (
              <p
                id={postalErrorId}
                className="mt-1 text-sm text-destructive"
                role="alert"
              >
                {errors.postalCode}
              </p>
            ) : null}
          </div>

          {customerError ? (
            <div
              className="rounded-lg border border-neutral-300 bg-neutral-50 p-4"
              role="alert"
            >
              <div className="flex gap-3">
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-neutral-700"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-950">
                    {customerError.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">
                    {customerError.description}
                  </p>
                  <button
                    type="button"
                    className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-brand/40 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50"
                    onClick={validateAndSubmit}
                    disabled={mutation.isPending}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    Try again
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <p className="text-xs leading-5 text-neutral-500">
            Venfour uses third-party services to process your report and gather
            market information. Do not upload documents you are not authorized to
            share.
          </p>

          <button
            type="submit"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            disabled={mutation.isPending}
          >
            Start appraisal
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden
            />
          </button>
          <p className="text-center text-xs leading-5 text-neutral-500">
            Preparing a review can take a few minutes.
          </p>
        </div>
      </form>

      {mutation.isPending ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/95 px-8 text-center backdrop-blur-[2px]"
          role="status"
          aria-label="Analysis in progress"
          aria-live="polite"
        >
          <div className="max-w-sm">
            <span className="mx-auto flex size-14 items-center justify-center rounded-lg border border-neutral-200 bg-brand-soft shadow-sm">
              <LoaderCircle
                className="size-6 animate-spin text-brand motion-reduce:animate-none"
                aria-hidden
              />
            </span>
            <p className="mt-5 text-lg font-semibold tracking-[-0.02em] text-neutral-950">
              Preparing your total-loss appraisal
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Venfour is reading the insurance report, reviewing relevant market
              evidence, and preparing your results. This can take a few minutes.
            </p>
            <p className="mt-5 text-xs font-medium tracking-wide text-neutral-500 uppercase">
              Keep this page open
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
