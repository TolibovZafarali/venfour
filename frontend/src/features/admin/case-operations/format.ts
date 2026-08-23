import type {
  CaseOperationAnalysisStatus,
  CaseOperationServiceType,
  CaseOperationStage,
  CaseOperationStatus,
} from "./types";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const stageLabels: Readonly<Record<CaseOperationStage, string>> = {
  intake_not_started: "Intake not started",
  intake_in_progress: "Intake in progress",
  report_uploaded: "Report uploaded",
  report_required: "Report required",
  ready_for_analysis: "Ready for analysis",
  analysis_processing: "Analysis processing",
  analysis_failed: "Analysis failed",
  analysis_complete: "Analysis complete",
  submitted: "Submitted",
  closed: "Closed",
  needs_attention: "Needs attention",
};

const statusLabels: Readonly<Record<CaseOperationStatus, string>> = {
  draft: "Draft",
  submitted: "Submitted",
  checking: "Checking",
  check_complete: "Check complete",
  payment_pending: "Payment pending",
  paid: "Paid",
  completed: "Completed",
  closed: "Closed",
};

const analysisStatusLabels: Readonly<
  Record<CaseOperationAnalysisStatus, string>
> = {
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export function formatCaseOperationDate(value: string | null) {
  if (!value) return "Not provided";
  const date = dateOnly(value);
  return date ? dateFormatter.format(date) : value;
}

export function formatCaseOperationDateTime(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

export function formatCaseOperationMileage(value: number | null) {
  return value === null
    ? "Not provided"
    : `${integerFormatter.format(value)} mi`;
}

export function formatCaseOperationCurrency(value: number | null) {
  return value === null ? "Not provided" : currencyFormatter.format(value);
}

export function formatCaseOperationVehicle(
  year: number | null,
  make: string | null,
  model: string | null,
  trim?: string | null,
) {
  const description = [year, make, model, trim].filter(Boolean).join(" ");
  return description || "Not provided";
}

export function formatCaseOperationReference(caseId: string) {
  return caseId.slice(0, 8).toUpperCase();
}

export function formatCaseOperationService(
  serviceType: CaseOperationServiceType,
) {
  return serviceType === "total_loss" ? "Total loss" : "Diminished value";
}

export function formatCaseOperationStage(stage: CaseOperationStage) {
  return stageLabels[stage];
}

export function formatCaseOperationStatus(status: CaseOperationStatus) {
  return statusLabels[status];
}

export function formatCaseOperationAnalysisStatus(
  status: CaseOperationAnalysisStatus | null,
) {
  return status ? analysisStatusLabels[status] : "Not started";
}

export function formatOperationalFollowUp(value: boolean | null) {
  if (value === true) return "Allowed";
  if (value === false) return "Not allowed";
  return "Not recorded";
}

export function formatCaseOperationBoolean(value: boolean | null) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not recorded";
}

export function formatCaseOperationCode(value: string | null) {
  if (!value) return "Not recorded";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}
