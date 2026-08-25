import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  LoaderCircle,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useId, useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Link } from "react-router";

import { InsuranceCompanyField } from "@/features/total-loss/insurance-company-field";
import {
  FlowCard,
  IntakeProgress,
  IntakeDatePicker,
  IntakeTextField,
  InlineError,
  StepActions,
  StepHeading,
  primaryFlowButtonClassName,
  secondaryFlowButtonClassName,
} from "@/features/total-loss/intake-fields";
import { VehicleIdentificationFields } from "@/features/intake";
import type {
  TotalLossIntakeMode,
  TotalLossContactFormErrors,
  TotalLossContactFormValues,
  TotalLossManualFormErrors,
  TotalLossManualFormValues,
  TotalLossReportExtractionStatus,
} from "@/features/total-loss/types";
import {
  formatCurrencyInput,
  formatCurrencyValue,
  formatMileageInput,
  getMaximumTotalLossVehicleYear,
  MIN_TOTAL_LOSS_VEHICLE_YEAR,
} from "@/features/total-loss/validation";
import { cn } from "@/lib/utils";

interface ChoiceStepProps {
  selectedMode: TotalLossIntakeMode | null;
  onSelect: (mode: TotalLossIntakeMode) => void;
  onContinue: () => void;
  busy?: boolean;
  error?: string | null;
}

const choiceOptions = [
  {
    mode: "report" as const,
    title: "I have my valuation report",
    description:
      "Upload the valuation report your insurance company used, regardless of provider.",
    icon: FileText,
  },
  {
    mode: "manual" as const,
    title: "I don’t have the report",
    description:
      "Enter the vehicle and claim details needed for an independent market review.",
    icon: PenLine,
  },
] as const;

type TotalLossProgressStep =
  | "choice"
  | "report"
  | "vehicle"
  | "claim"
  | "contact"
  | "review";

const reportProgressSteps = [
  { step: "choice", label: "Start" },
  { step: "report", label: "Valuation report" },
  { step: "vehicle", label: "Vehicle" },
  { step: "claim", label: "Claim" },
  { step: "contact", label: "Contact" },
  { step: "review", label: "Review" },
] as const;

const manualProgressSteps = reportProgressSteps.filter(
  ({ step }) => step !== "report",
);

function TotalLossProgress({
  mode,
  step,
}: {
  readonly mode: TotalLossIntakeMode | null;
  readonly step: TotalLossProgressStep;
}) {
  const progressSteps =
    mode === "manual" ? manualProgressSteps : reportProgressSteps;
  const current = progressSteps.findIndex((item) => item.step === step) + 1;

  return (
    <IntakeProgress
      current={current}
      steps={progressSteps}
      maxTotal={reportProgressSteps.length}
    />
  );
}

export function ChoiceStep({
  selectedMode,
  onSelect,
  onContinue,
  busy,
  error,
}: ChoiceStepProps) {
  return (
    <FlowCard busy={busy}>
      <TotalLossProgress mode={selectedMode} step="choice" />
      <fieldset className="mt-7">
        <legend className="text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
          Do you have your insurance valuation report?
        </legend>
        <div
          className="mt-6 grid gap-4 sm:grid-cols-2"
          data-stable-selection-group
        >
          {choiceOptions.map((option) => {
            const selected = selectedMode === option.mode;
            const Icon = option.icon;
            return (
              <label
                key={option.mode}
                className={cn(
                  "relative flex min-h-44 cursor-pointer flex-col rounded-xl border bg-white p-5 transition-colors focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 hover:bg-brand-soft/35 motion-reduce:transition-none",
                  selected
                    ? "border-line bg-brand-soft/55"
                    : "border-line",
                  busy &&
                    "cursor-not-allowed bg-surface/70 opacity-70 hover:border-line hover:bg-surface/70",
                )}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="total-loss-intake-mode"
                  value={option.mode}
                  checked={selected}
                  disabled={busy}
                  onChange={() => onSelect(option.mode)}
                />
                <span className="flex size-11 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="mt-5 text-lg font-semibold tracking-[-0.02em] text-ink">
                  {option.title}
                </span>
                <span className="mt-2 text-sm leading-6 text-copy">
                  {option.description}
                </span>
                <span
                  className={cn(
                    "mt-auto pt-5 text-xs font-semibold",
                    selected ? "text-brand" : "text-copy",
                  )}
                  aria-hidden
                >
                  {selected ? "Selected" : "Select"}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error ? <InlineError message={error} /> : null}
      <div className="mt-7 flex justify-end">
        <button
          type="button"
          className={primaryFlowButtonClassName}
          disabled={!selectedMode || busy}
          onClick={onContinue}
        >
          {busy ? (
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : null}
          Continue
          {!busy ? <ArrowRight className="size-4" aria-hidden /> : null}
        </button>
      </div>
    </FlowCard>
  );
}

interface ManualStepProps {
  values: TotalLossManualFormValues;
  errors: TotalLossManualFormErrors;
  onChange: (field: keyof TotalLossManualFormValues, value: string) => void;
  onBlur: (field: keyof TotalLossManualFormValues) => void;
  onBack: () => void;
  onContinue: () => void;
  busy?: boolean;
  fieldsDisabled?: boolean;
  error?: string | null;
}

export type VehicleEntryMethod = "vin" | "details";

interface VehicleStepProps extends ManualStepProps {
  mode: TotalLossIntakeMode;
  entryMethod: VehicleEntryMethod;
  makeOptions: readonly string[];
  modelOptions: readonly string[];
  trimOptions: readonly string[];
  makesState: "idle" | "loading" | "success" | "error";
  modelsState: "idle" | "loading" | "success" | "error";
  trimsState: "idle" | "loading" | "success" | "error";
  vinLookupState: "idle" | "loading" | "success" | "error";
  vinLookupMessage?: string | null;
  onEntryMethodChange: (method: VehicleEntryMethod) => void;
  onRetryMakes: () => void;
  onRetryModels: () => void;
  onRetryTrims: () => void;
}

const vehicleYearOptions = Array.from(
  {
    length: getMaximumTotalLossVehicleYear() - MIN_TOTAL_LOSS_VEHICLE_YEAR + 1,
  },
  (_, index) => String(getMaximumTotalLossVehicleYear() - index),
);

export function VehicleStep({
  mode,
  values,
  errors,
  entryMethod,
  makeOptions,
  modelOptions,
  trimOptions,
  makesState,
  modelsState,
  trimsState,
  vinLookupState,
  vinLookupMessage,
  onEntryMethodChange,
  onRetryMakes,
  onRetryModels,
  onRetryTrims,
  onChange,
  onBlur,
  onBack,
  onContinue,
  busy,
  fieldsDisabled,
  error,
}: VehicleStepProps) {
  return (
    <FlowCard busy={busy}>
      <TotalLossProgress mode={mode} step="vehicle" />
      <StepHeading
        title="Tell us about your vehicle"
        description="Use your VIN for the quickest match, or choose your vehicle from the lists."
      />
      <VehicleIdentificationFields
        idPrefix="total-loss"
        entryMethod={entryMethod}
        values={values}
        errors={errors}
        yearOptions={vehicleYearOptions}
        makeOptions={makeOptions}
        modelOptions={modelOptions}
        trimOptions={trimOptions}
        makesState={makesState}
        modelsState={modelsState}
        trimsState={trimsState}
        vinLookupState={vinLookupState}
        vinLookupMessage={vinLookupMessage}
        trimRequired
        fieldsDisabled={fieldsDisabled}
        methodDisabled={fieldsDisabled || busy}
        onEntryMethodChange={onEntryMethodChange}
        onChange={(field, value) => onChange(field, value)}
        onBlur={(field) => onBlur(field)}
        onRetryMakes={onRetryMakes}
        onRetryModels={onRetryModels}
        onRetryTrims={onRetryTrims}
      />
      {error ? <InlineError message={error} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        busy={
          busy ||
          vinLookupState === "loading" ||
          trimsState === "loading"
        }
        continueLabel={
          entryMethod === "vin" &&
          (!values.vehicleYear || !values.make || !values.model)
            ? "Find vehicle"
            : "Confirm vehicle & continue"
        }
      />
    </FlowCard>
  );
}

interface ClaimStepProps extends ManualStepProps {
  mode: TotalLossIntakeMode;
}

export function ClaimStep({
  mode,
  values,
  errors,
  onChange,
  onBlur,
  onBack,
  onContinue,
  busy,
  fieldsDisabled,
  error,
}: ClaimStepProps) {
  return (
    <FlowCard busy={busy}>
      <TotalLossProgress mode={mode} step="claim" />
      <StepHeading
        title="Add the claim details"
        description="These details help Venfour understand the insurer’s vehicle value in context."
      />
      {values.vehicleYear && values.make && values.model ? (
        <p
          className="mt-5 rounded-lg bg-market-soft px-3 py-2 text-sm font-semibold text-market-strong"
          role="status"
        >
          Vehicle: {values.vehicleYear} {values.make} {values.model}
          {values.trim ? ` ${values.trim}` : ""}
        </p>
      ) : null}
      <section className="mt-6" aria-labelledby="vehicle-loss-details-heading">
        <h3
          id="vehicle-loss-details-heading"
          className="text-base font-semibold text-ink"
        >
          Vehicle and loss information
        </h3>
        <p className="mt-1 text-sm leading-6 text-copy">
          Add the facts that most directly affect the vehicle appraisal.
        </p>
        <div className="mt-5 grid items-start gap-5 sm:grid-cols-3">
          <IntakeTextField
            id="total-loss-mileage"
            label="Mileage at time of loss"
            value={formatMileageInput(values.mileageAtLoss)}
            error={errors.mileageAtLoss}
            inputMode="numeric"
            autoComplete="off"
            placeholder="48,250"
            disabled={fieldsDisabled}
            onChange={(event) =>
              onChange("mileageAtLoss", formatMileageInput(event.target.value))
            }
            onBlur={() => onBlur("mileageAtLoss")}
          />
          <IntakeTextField
            id="total-loss-zip"
            label="ZIP code"
            value={values.zipCode}
            error={errors.zipCode}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="60611"
            disabled={fieldsDisabled}
            onChange={(event) => onChange("zipCode", event.target.value)}
            onBlur={() => onBlur("zipCode")}
          />
          <IntakeDatePicker
            id="total-loss-date"
            label="Date of loss"
            value={values.dateOfLoss}
            error={errors.dateOfLoss}
            disabled={fieldsDisabled}
            onChange={(value) => onChange("dateOfLoss", value)}
            onBlur={() => onBlur("dateOfLoss")}
          />
        </div>
      </section>
      <section
        className="mt-8 rounded-xl border border-line bg-surface/55 p-4 sm:p-5"
        aria-labelledby="insurance-information-heading"
      >
        <h3
          id="insurance-information-heading"
          className="text-base font-semibold text-ink"
        >
          Insurance information
        </h3>
        <p className="mt-1 text-sm leading-6 text-copy">
          Add the insurer details separately from the vehicle appraisal facts.
        </p>
        <div className="mt-5 grid items-start gap-5 sm:grid-cols-2">
          <InsuranceCompanyField
            id="total-loss-insurer"
            value={values.insurerName}
            error={errors.insurerName}
            disabled={fieldsDisabled}
            onChange={(value) => onChange("insurerName", value)}
            onBlur={() => onBlur("insurerName")}
          />
          <IntakeTextField
            id="total-loss-valuation"
            label="Insurer’s vehicle valuation"
            value={formatCurrencyInput(values.insurerVehicleValuation)}
            error={errors.insurerVehicleValuation}
            labelTooltip="The value assigned to the vehicle before deductible, loan payoff, or other settlement adjustments."
            optional
            inputMode="decimal"
            autoComplete="off"
            placeholder="$18,750.00"
            disabled={fieldsDisabled}
            onChange={(event) =>
              onChange(
                "insurerVehicleValuation",
                formatCurrencyInput(event.target.value),
              )
            }
            onBlur={() => onBlur("insurerVehicleValuation")}
          />
        </div>
      </section>
      {error ? <InlineError message={error} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        busy={busy}
        continueLabel="Continue"
      />
    </FlowCard>
  );
}

interface ReportStepProps {
  storageAvailable: boolean;
  selectedFilename?: string | null;
  savedFilename?: string | null;
  uploadState: "idle" | "queued" | "uploading" | "success" | "error";
  extractionState: TotalLossReportExtractionStatus;
  reportProvider?: string | null;
  extractionWarnings?: readonly string[];
  uploadError?: string | null;
  error?: string | null;
  completing?: boolean;
  hideBack?: boolean;
  onRetryStorage?: () => void;
  onBack: () => void;
  onFilesSelected: (files: readonly File[]) => void;
  onRetryUpload: () => void;
  onContinue: () => void;
}

type ReportProcessingStepStatus =
  "complete" | "active" | "waiting" | "pending" | "attention";

const reportProcessingSteps = [
  {
    label: "Uploading",
    description: "Saving the report to your private case",
  },
  {
    label: "Reading report",
    description: "Understanding the document and its format",
  },
  {
    label: "Extracting vehicle and valuation details",
    description: "Finding the facts you’ll review next",
  },
  {
    label: "Ready for review",
    description: "Your next step becomes available",
  },
] as const;

function reportProcessingStatuses({
  extractionState,
  hasSavedReport,
  uploadQueued,
  uploadPending,
}: {
  readonly extractionState: TotalLossReportExtractionStatus;
  readonly hasSavedReport: boolean;
  readonly uploadQueued: boolean;
  readonly uploadPending: boolean;
}): readonly ReportProcessingStepStatus[] {
  if (uploadQueued) {
    return ["waiting", "pending", "pending", "pending"];
  }
  if (uploadPending) {
    return ["active", "pending", "pending", "pending"];
  }
  if (!hasSavedReport) {
    return ["pending", "pending", "pending", "pending"];
  }
  if (extractionState === "processing") {
    // Report ingestion is one server operation. Keep both truthful subphases
    // active together instead of simulating progress the backend cannot expose.
    return ["complete", "active", "active", "pending"];
  }
  if (extractionState === "complete" || extractionState === "partial") {
    return ["complete", "complete", "complete", "complete"];
  }
  if (extractionState === "error") {
    // The ingestion API does not expose which internal phase failed. Mark the
    // first unknown phase for attention instead of claiming the report was read.
    return ["complete", "attention", "pending", "pending"];
  }
  return ["complete", "pending", "pending", "pending"];
}

function ReportProcessingProgress({
  extractionState,
  hasSavedReport,
  uploadQueued,
  uploadPending,
}: {
  readonly extractionState: TotalLossReportExtractionStatus;
  readonly hasSavedReport: boolean;
  readonly uploadQueued: boolean;
  readonly uploadPending: boolean;
}) {
  const statuses = reportProcessingStatuses({
    extractionState,
    hasSavedReport,
    uploadQueued,
    uploadPending,
  });
  const activeStep = statuses.lastIndexOf("active");
  const currentStep =
    activeStep >= 0
      ? activeStep
      : Math.max(statuses.indexOf("waiting"), statuses.indexOf("attention"));

  return (
    <ol className="mt-7 space-y-1" aria-label="Report processing progress">
      {reportProcessingSteps.map((step, index) => {
        const status = statuses[index] ?? "pending";
        const complete = status === "complete";
        const active = status === "active";
        const waiting = status === "waiting";
        const attention = status === "attention";
        return (
          <li
            key={step.label}
            className={cn(
              "relative grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-xl px-2.5 py-3",
              (active || waiting) && "bg-brand-soft/65",
              attention && "bg-amber-soft/70",
            )}
            aria-current={index === currentStep ? "step" : undefined}
            data-report-processing-status={status}
            data-report-processing-step={index + 1}
          >
            {index < reportProcessingSteps.length - 1 ? (
              <span
                className={cn(
                  "absolute top-10 bottom-[-0.75rem] left-[1.625rem] w-px",
                  complete ? "bg-market/35" : "bg-line",
                )}
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-8 items-center justify-center rounded-full border bg-white text-xs font-semibold",
                complete &&
                  "border-market/25 bg-market-soft text-market-strong",
                active && "border-brand/25 bg-white text-brand",
                waiting && "border-brand/25 bg-white text-brand",
                attention && "border-amber/30 bg-white text-amber-strong",
                status === "pending" && "border-line text-copy/70",
              )}
              aria-hidden
            >
              {complete ? (
                <CheckCircle2 className="size-4" />
              ) : active ? (
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              ) : waiting ? (
                <Clock3 className="size-4" />
              ) : attention ? (
                <AlertCircle className="size-4" />
              ) : (
                index + 1
              )}
            </span>
            <span className="min-w-0 pt-0.5">
              <span
                className={cn(
                  "block text-sm font-semibold",
                  complete && "text-market-strong",
                  active && "text-brand-strong",
                  waiting && "text-brand-strong",
                  attention && "text-amber-strong",
                  status === "pending" && "text-copy",
                )}
              >
                {step.label}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-copy">
                {uploadQueued && index === 0
                  ? "Waiting for the current report read to finish"
                  : step.description}
                <span className="sr-only">
                  {complete
                    ? ", complete"
                    : active
                      ? ", in progress"
                      : waiting
                        ? ", waiting to start"
                      : attention
                        ? ", needs attention"
                        : ", not started"}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ReportDocumentStatusVisual({
  extractionState,
  uploadQueued,
  uploadPending,
}: {
  readonly extractionState: TotalLossReportExtractionStatus;
  readonly uploadQueued: boolean;
  readonly uploadPending: boolean;
}) {
  const uploadActive = uploadQueued || uploadPending;
  const processing = !uploadActive && extractionState === "processing";
  const ready =
    !uploadActive &&
    (extractionState === "complete" || extractionState === "partial");
  const failed = !uploadActive && extractionState === "error";

  return (
    <div
      className={cn(
        "relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border sm:size-32",
        ready
          ? "border-market/20 bg-market-soft/75"
          : failed
            ? "border-amber/25 bg-amber-soft/70"
            : "border-brand/15 bg-brand-soft/75",
      )}
      aria-hidden
    >
      <span className="absolute -top-10 -right-10 size-24 rounded-full bg-white/60 blur-2xl" />
      <span className="absolute -bottom-12 -left-10 size-28 rounded-full bg-brand-subtle/60 blur-2xl" />
      <span className="relative flex h-[5.5rem] w-[4.25rem] flex-col overflow-hidden rounded-lg border border-line bg-white p-2.5 shadow-[0_18px_38px_-24px_rgba(11,31,51,0.55)] sm:h-24 sm:w-[4.75rem]">
        <span className="flex items-center justify-between">
          <FileText className="size-4 text-brand" />
          <span className="text-[0.45rem] font-bold tracking-[0.12em] text-copy uppercase">
            Report
          </span>
        </span>
        <span className="mt-2 h-1.5 w-4/5 rounded-full bg-line" />
        <span className="mt-1.5 h-1.5 w-full rounded-full bg-surface" />
        <span className="mt-1.5 h-1.5 w-2/3 rounded-full bg-surface" />
        <span className="mt-auto grid grid-cols-2 gap-1">
          <span className="h-3 rounded-sm bg-brand-soft" />
          <span className="h-3 rounded-sm bg-market-soft" />
        </span>
        {processing ? (
          <span className="report-scan-line absolute inset-x-1.5 top-1/2 h-px bg-brand shadow-[0_0_12px_2px_rgba(21,94,239,0.32)]" />
        ) : null}
        {uploadPending ? (
          <span className="absolute inset-x-2 bottom-1.5 h-1 overflow-hidden rounded-full bg-brand-soft">
            <span className="report-upload-sweep block h-full w-1/2 rounded-full bg-brand" />
          </span>
        ) : null}
      </span>
      {ready ? (
        <span className="absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full border-2 border-white bg-market text-white shadow-sm">
          <CheckCircle2 className="size-4" />
        </span>
      ) : failed ? (
        <span className="absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full border-2 border-white bg-amber text-white shadow-sm">
          <AlertCircle className="size-4" />
        </span>
      ) : null}
    </div>
  );
}

export function ReportStep({
  storageAvailable,
  selectedFilename,
  savedFilename,
  uploadState,
  extractionState,
  reportProvider,
  extractionWarnings = [],
  uploadError,
  error,
  completing,
  hideBack,
  onRetryStorage,
  onBack,
  onFilesSelected,
  onRetryUpload,
  onContinue,
}: ReportStepProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadQueued = uploadState === "queued";
  const uploadInProgress = uploadState === "uploading";
  const uploadPending = uploadQueued || uploadInProgress;
  const hasSavedReport = Boolean(savedFilename);
  const reviewReady =
    !uploadPending &&
    (extractionState === "complete" || extractionState === "partial");
  const manualFallbackReady =
    !uploadPending && hasSavedReport && extractionState === "error";
  const processing = !uploadPending && extractionState === "processing";
  const showProcessingWorkspace = uploadPending || hasSavedReport;
  const retryAvailable = uploadState === "error" && Boolean(selectedFilename);
  const displayedFilename = uploadPending
    ? (selectedFilename ?? savedFilename)
    : (savedFilename ?? selectedFilename);
  const replaceTemporarilyUnavailable = uploadPending || Boolean(completing);

  const statePresentation = uploadQueued
    ? {
        eyebrow: "Replacement selected",
        title: "We’ll replace your report next",
        description:
          "Venfour is finishing the current read before securely uploading your replacement. This keeps details from the two reports from being mixed.",
        reassurance:
          "You don’t need to do anything. Keep this page open and the replacement will upload automatically when the current read finishes.",
        tone: "brand" as const,
      }
    : uploadInProgress
    ? {
        eyebrow: hasSavedReport ? "Replacing securely" : "Secure upload",
        title: hasSavedReport
          ? "Uploading your replacement report"
          : "Uploading your report securely",
        description:
          "Venfour is saving this file to your private case. Keep this page open for just a moment.",
        reassurance:
          "Nothing else is needed right now. Reading begins automatically after the upload is confirmed.",
        tone: "brand" as const,
      }
    : reviewReady
      ? {
          eyebrow: "Ready for review",
          title: "Your details are ready to review",
          description:
            extractionState === "partial"
              ? `Venfour extracted the available vehicle and valuation details${reportProvider ? ` from this ${reportProvider} report` : ""}. Review them next and fill in anything the report did not clearly show.`
              : `Venfour extracted the vehicle and valuation details${reportProvider ? ` from this ${reportProvider} report` : ""}. Review them next and correct anything that doesn’t look right.`,
          reassurance:
            "The appraisal analysis has not started yet. You’ll confirm these report facts first.",
          tone: "market" as const,
        }
      : manualFallbackReady
        ? {
            eyebrow: "Report saved",
            title: "Your report is safely uploaded",
            description:
              "Automatic extraction could not finish, but your file is secure. You can continue by entering the needed details manually.",
            reassurance:
              "You won’t need to upload the report again. It will remain attached to this appraisal.",
            tone: "amber" as const,
          }
        : processing
          ? {
              eyebrow: "Upload complete",
              title: "Venfour is reading your report",
              description:
                "Your report uploaded successfully. Venfour is now reading it and extracting the vehicle and valuation details for you.",
              reassurance:
                "You don’t need to do anything while we work. We’ll make the review button available when your details are ready.",
              tone: "brand" as const,
            }
          : {
              eyebrow: "Upload complete",
              title: "Your report was uploaded successfully",
              description:
                "Your report is securely attached to this appraisal. Venfour is preparing the next review step.",
              reassurance:
                "You don’t need to upload it again. Keep this page open while the saved state refreshes.",
              tone: "brand" as const,
            };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFilesSelected(files);
  };

  return (
    <FlowCard busy={completing}>
      <TotalLossProgress mode="report" step="report" />
      <StepHeading
        title={
          showProcessingWorkspace
            ? "Your valuation report"
            : "Upload your valuation report"
        }
        description={
          showProcessingWorkspace
            ? "Follow the secure upload and extraction status below. Venfour will make the next step available as soon as the details are ready."
            : "Add the report your insurance company used, regardless of provider. Venfour will confirm the upload, read the report, and ask you to review every important fact."
        }
      />

      {!storageAvailable ? (
        <div className="mt-7">
          <InlineError message="Secure report storage is temporarily unavailable. Your selections are still saved on this device." />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {onRetryStorage ? (
              <button
                type="button"
                className={cn(
                  primaryFlowButtonClassName,
                  "report-action-focus w-full sm:w-auto",
                )}
                onClick={onRetryStorage}
              >
                <RefreshCw className="size-4" aria-hidden />
                Retry secure storage
              </button>
            ) : null}
            <Link
              to="/"
              className={cn(
                secondaryFlowButtonClassName,
                "report-action-focus w-full sm:w-auto",
              )}
            >
              Return home
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-7">
          <input
            ref={inputRef}
            id={inputId}
            className="hidden"
            type="file"
            multiple
            tabIndex={-1}
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            disabled={uploadPending || completing}
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={handleFileChange}
          />
          {!showProcessingWorkspace ? (
            <div
              className={cn(
                "flex flex-col gap-5 border-y py-7 sm:flex-row sm:items-center sm:justify-between",
                uploadState === "error" ? "border-red-200" : "border-line",
              )}
            >
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Upload className="size-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="break-words text-base font-semibold text-ink [overflow-wrap:anywhere]">
                    {selectedFilename ?? "Choose your valuation report"}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-copy">
                    PDF, JPG/JPEG, or PNG · 50 MiB total. Select image pages in
                    order.
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-market-strong">
                    <ShieldCheck className="size-4" aria-hidden />
                    Private, case-owned report storage
                  </p>
                </div>
              </div>
              {!retryAvailable ? (
                <button
                  type="button"
                  className={cn(
                    primaryFlowButtonClassName,
                    "report-action-focus w-full shrink-0 sm:w-auto",
                  )}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose report
                </button>
              ) : null}
            </div>
          ) : (
            <div data-report-processing-workspace>
              <div className="flex min-w-0 flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      uploadPending
                        ? "bg-brand-soft text-brand"
                        : "bg-market-soft text-market-strong",
                    )}
                  >
                    {uploadInProgress ? (
                      <LoaderCircle
                        className="size-5 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : uploadQueued ? (
                      <RefreshCw className="size-5" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-5" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-[0.11em] text-copy uppercase">
                      {uploadQueued
                        ? "Replacement queued"
                        : uploadInProgress
                          ? "Uploading securely"
                          : "Report uploaded successfully"}
                    </p>
                    <p
                      className="mt-0.5 truncate text-sm font-semibold text-ink"
                      title={displayedFilename ?? undefined}
                    >
                      {displayedFilename ?? "Valuation report"}
                    </p>
                  </div>
                </div>
                {hasSavedReport && !retryAvailable ? (
                  <div className="shrink-0 sm:text-right">
                    <button
                      type="button"
                      className="report-action-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-copy transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:underline disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
                      disabled={replaceTemporarilyUnavailable}
                      onClick={() => inputRef.current?.click()}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      Replace report
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
                <ReportDocumentStatusVisual
                  extractionState={extractionState}
                  uploadQueued={uploadQueued}
                  uploadPending={uploadInProgress}
                />
                <div
                  className="min-w-0 flex-1"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <p
                    className={cn(
                      "text-xs font-semibold tracking-[0.13em] uppercase",
                      statePresentation.tone === "market"
                        ? "text-market-strong"
                        : statePresentation.tone === "amber"
                          ? "text-amber-strong"
                          : "text-brand",
                    )}
                  >
                    {statePresentation.eyebrow}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
                    {statePresentation.title}
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-copy">
                    {statePresentation.description}
                  </p>
                  <div
                    className={cn(
                      "mt-4 flex items-start gap-3 rounded-xl px-3.5 py-3",
                      statePresentation.tone === "market"
                        ? "bg-market-soft/75"
                        : statePresentation.tone === "amber"
                          ? "bg-amber-soft"
                          : "bg-brand-soft/75",
                    )}
                  >
                    <ShieldCheck
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        statePresentation.tone === "market"
                          ? "text-market-strong"
                          : statePresentation.tone === "amber"
                            ? "text-amber-strong"
                            : "text-brand",
                      )}
                      aria-hidden
                    />
                    <p className="text-xs leading-5 text-copy">
                      {statePresentation.reassurance}
                    </p>
                  </div>
                </div>
              </div>

              <ReportProcessingProgress
                extractionState={extractionState}
                hasSavedReport={hasSavedReport}
                uploadQueued={uploadQueued}
                uploadPending={uploadInProgress}
              />

              {reviewReady && extractionWarnings.length > 0 ? (
                <div className="mt-5 border-t border-line pt-5">
                  <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
                    Items to confirm
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-copy">
                    {extractionWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
          {uploadError ? (
            <div
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-red-700"
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-semibold text-red-950">
                    {hasSavedReport
                      ? "Replacement wasn’t uploaded"
                      : "We couldn’t use this report"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-red-800">
                    {uploadError}
                  </p>
                  {hasSavedReport ? (
                    <p className="mt-1 text-sm leading-6 text-red-800">
                      Your current report is still saved.
                    </p>
                  ) : null}
                  {selectedFilename ? (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        className={cn(
                          primaryFlowButtonClassName,
                          "report-action-focus w-full sm:w-auto",
                        )}
                        onClick={onRetryUpload}
                      >
                        <RefreshCw className="size-4" aria-hidden />
                        Try again
                      </button>
                      <button
                        type="button"
                        className={cn(
                          secondaryFlowButtonClassName,
                          "report-action-focus w-full sm:w-auto",
                        )}
                        onClick={() => inputRef.current?.click()}
                      >
                        Choose another report
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {error ? <InlineError message={error} /> : null}
      <div className="mt-8 flex min-h-12 flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {!hideBack ? (
          <button
            type="button"
            className={cn(
              secondaryFlowButtonClassName,
              "report-action-focus",
            )}
            disabled={uploadPending || completing}
            onClick={onBack}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
        ) : null}
        {reviewReady || manualFallbackReady ? (
          <button
            type="button"
            className={cn(
              primaryFlowButtonClassName,
              "report-action-focus w-full sm:w-auto",
            )}
            disabled={!hasSavedReport || uploadPending || completing}
            onClick={onContinue}
          >
            {manualFallbackReady
              ? "Continue with manual details"
              : "Review extracted details"}
            <ArrowRight className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </FlowCard>
  );
}

interface ContactStepProps {
  readonly mode: TotalLossIntakeMode;
  readonly values: TotalLossContactFormValues;
  readonly errors: TotalLossContactFormErrors;
  readonly emailLocked?: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly accessLinkSent?: boolean;
  readonly onChange: <K extends keyof TotalLossContactFormValues>(
    field: K,
    value: TotalLossContactFormValues[K],
  ) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function ContactStep({
  mode,
  values,
  errors,
  emailLocked = false,
  busy,
  error,
  accessLinkSent,
  onChange,
  onBack,
  onContinue,
}: ContactStepProps) {
  return (
    <FlowCard busy={busy}>
      <TotalLossProgress mode={mode} step="contact" />
      <StepHeading title="Your contact details" />
      <div className="mt-6 grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <IntakeTextField
          id="total-loss-contact-first-name"
          label="First name"
          value={values.firstName}
          error={errors.firstName}
          autoComplete="given-name"
          maxLength={100}
          disabled={busy}
          onChange={(event) => onChange("firstName", event.target.value)}
        />
        <IntakeTextField
          id="total-loss-contact-last-name"
          label="Last name"
          value={values.lastName}
          error={errors.lastName}
          autoComplete="family-name"
          maxLength={100}
          disabled={busy}
          onChange={(event) => onChange("lastName", event.target.value)}
        />
        <IntakeTextField
          id="total-loss-contact-email"
          label="Email address"
          value={values.email}
          error={errors.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={320}
          disabled={busy || emailLocked}
          help="Used to save your appraisal."
          helpAfterInput
          onChange={(event) => onChange("email", event.target.value)}
        />
        <IntakeTextField
          id="total-loss-contact-phone"
          label="Phone number"
          value={values.phoneNumber}
          error={errors.phoneNumber}
          optional
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={50}
          disabled={busy}
          onChange={(event) => onChange("phoneNumber", event.target.value)}
        />
      </div>

      <section className="mt-7 border-t border-line pt-6" aria-labelledby="consent-heading">
        <div>
          <h3 id="consent-heading" className="text-base font-semibold text-ink">
            Consent and preferences
          </h3>
          <p className="mt-1 text-sm leading-6 text-copy">
            Review the required acknowledgements and choose whether you want optional follow-up.
          </p>
        </div>
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          <Acknowledgement
            checked={values.termsAccepted}
            disabled={Boolean(busy)}
            onChange={(checked) => onChange("termsAccepted", checked)}
          >
            I agree to Venfour’s <PolicyLink to="/terms">Terms of Use</PolicyLink>.
          </Acknowledgement>
          <Acknowledgement
            checked={values.privacyAccepted}
            disabled={Boolean(busy)}
            onChange={(checked) => onChange("privacyAccepted", checked)}
          >
            I acknowledge Venfour’s <PolicyLink to="/privacy">Privacy Policy</PolicyLink>.
          </Acknowledgement>
          <label className="flex cursor-pointer items-start gap-3 bg-surface/45 px-4 py-3.5 transition-colors hover:bg-surface/70 focus-within:bg-surface/70 motion-reduce:transition-none">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-brand"
              checked={values.operationalFollowUpAllowed}
              disabled={busy}
              onChange={(event) =>
                onChange("operationalFollowUpAllowed", event.target.checked)
              }
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                Case follow-up
                <span className="rounded-full bg-white px-2 py-0.5 text-[0.6875rem] font-medium text-copy ring-1 ring-inset ring-line">
                  Optional
                </span>
              </span>
              <span className="mt-1 block text-xs leading-5 text-copy">
                Venfour may contact me about this case or related service follow-up. This is optional and separate from essential messages I request.
              </span>
            </span>
          </label>
        </div>
      </section>

      {errors.legal ? <InlineError message={errors.legal} /> : null}
      {accessLinkSent ? (
        <p className="mt-4 text-sm font-semibold text-market-strong" role="status">
          Secure access link sent. You do not need to open it to continue here.
        </p>
      ) : null}
      {error ? <InlineError message={error} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        busy={busy}
        continueLabel="Continue to review"
      />
    </FlowCard>
  );
}

interface ReviewStepProps {
  readonly mode: TotalLossIntakeMode;
  readonly values: TotalLossManualFormValues;
  readonly contact: TotalLossContactFormValues;
  readonly reportFilename?: string | null;
  readonly reportProvider?: string | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onBack: () => void;
  readonly onEditVehicle: () => void;
  readonly onEditClaim: () => void;
  readonly onStartAnalysis: () => void;
}

export function ReviewStep({
  mode,
  values,
  contact,
  reportFilename,
  reportProvider,
  busy,
  error,
  onBack,
  onEditVehicle,
  onEditClaim,
  onStartAnalysis,
}: ReviewStepProps) {
  const vehicle = [values.vehicleYear, values.make, values.model, values.trim]
    .filter(Boolean)
    .join(" ");
  const valuation = values.insurerVehicleValuation
    ? formatCurrencyValue(values.insurerVehicleValuation)
    : null;

  return (
    <FlowCard busy={busy}>
      <TotalLossProgress mode={mode} step="review" />
      <StepHeading
        title="Review your details"
        description="Confirm the information Venfour will use before the analysis begins."
      />
      <div className="mt-7 grid gap-4 lg:grid-cols-2">
        <ReviewPanel title="Vehicle" onEdit={onEditVehicle}>
          <p className="font-semibold text-ink">{vehicle}</p>
          <p>{values.mileageAtLoss} miles</p>
          {values.vin ? <p>VIN {values.vin}</p> : null}
        </ReviewPanel>
        <ReviewPanel title="Claim" onEdit={onEditClaim}>
          <p className="font-semibold text-ink">{values.insurerName}</p>
          <p>Date of loss: {values.dateOfLoss}</p>
          <p>Market ZIP: {values.zipCode}</p>
          <p>{valuation ? `Stated vehicle value: ${valuation}` : "No insurer vehicle value supplied"}</p>
        </ReviewPanel>
        <ReviewPanel title="Evidence available">
          {mode === "report" ? (
            <>
              <p className="font-semibold text-ink">Valuation report review + independent market research</p>
              <p>{reportProvider ?? "Provider not identified"} · {reportFilename}</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-ink">Independent market research</p>
              <p>There is no report to review. Venfour will compare market evidence with the stated offer only if one was supplied.</p>
            </>
          )}
        </ReviewPanel>
        <ReviewPanel title="Results access">
          <p className="font-semibold text-ink">
            {contact.firstName} {contact.lastName}
          </p>
          <p>{contact.email}</p>
          {contact.phoneNumber ? <p>{contact.phoneNumber}</p> : null}
          <p>{contact.operationalFollowUpAllowed ? "Optional follow-up allowed" : "No optional follow-up"}</p>
        </ReviewPanel>
      </div>
      <div className="mt-5 rounded-xl border border-line bg-surface/60 p-4 text-sm leading-6 text-copy">
        {mode === "report"
          ? "Venfour will independently research the market and review only the report facts, comparables, and adjustments that were actually available."
          : "Venfour will independently research the market. It will not claim to review report comparables or adjustments that were never supplied."}
      </div>
      {error ? <InlineError message={error} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onStartAnalysis}
        busy={busy}
        continueLabel="Start analysis"
      />
    </FlowCard>
  );
}

function ReviewPanel({
  children,
  onEdit,
  title,
}: {
  readonly children: ReactNode;
  readonly onEdit?: () => void;
  readonly title: string;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-white p-5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold text-ink">{title}</h3>
        {onEdit ? (
          <button type="button" className="text-sm font-semibold text-brand hover:text-brand-strong" onClick={onEdit}>
            Edit
          </button>
        ) : null}
      </div>
      <div className="mt-3 min-w-0 space-y-1 text-sm leading-6 break-words text-copy [overflow-wrap:anywhere]">{children}</div>
    </section>
  );
}

function Acknowledgement({
  checked,
  children,
  disabled,
  onChange,
}: {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface/45 focus-within:bg-surface/45 motion-reduce:transition-none">
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-brand"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-sm leading-6 text-copy">{children}</span>
    </label>
  );
}

function PolicyLink({ children, to }: { readonly children: ReactNode; readonly to: string }) {
  return (
    <Link
      className="rounded-sm font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      target="_blank"
      rel="noreferrer"
      to={to}
    >
      {children}
    </Link>
  );
}

interface ReadyStepProps {
  readonly mode?: TotalLossIntakeMode | null;
  readonly busy?: boolean;
  readonly onReplaceReport?: () => void;
  readonly onStartValueCheck?: () => void;
}

export function ReadyStep({
  busy,
  mode,
  onReplaceReport,
  onStartValueCheck,
}: ReadyStepProps = {}) {
  return (
    <FlowCard className="text-center" busy={busy}>
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-market-soft text-market-strong">
        <CheckCircle2 className="size-7" aria-hidden />
      </span>
      <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-ink">
        Your information is ready
      </h2>
      <p className="mt-3 text-base leading-7 text-copy">
        Start the analysis when you’re ready.
      </p>
      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        {mode === "report" && onReplaceReport ? (
          <button type="button" className={secondaryFlowButtonClassName} disabled={busy} onClick={onReplaceReport}>
            Replace report
          </button>
        ) : null}
        {onStartValueCheck ? (
          <button type="button" className={primaryFlowButtonClassName} disabled={busy} onClick={onStartValueCheck}>
            Start analysis
            <ArrowRight className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </FlowCard>
  );
}

interface ResumeStepProps {
  summary: string;
  savedAt: string;
  busy?: boolean;
  error?: string | null;
  onContinue: () => void;
  onStartNew: () => void;
}

export function ResumeStep({
  summary,
  savedAt,
  busy,
  error,
  onContinue,
  onStartNew,
}: ResumeStepProps) {
  return (
    <FlowCard busy={busy}>
      <p className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
        Saved appraisal
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
        Continue your saved appraisal?
      </h2>
      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <p className="text-base font-semibold text-ink">{summary}</p>
        <p className="mt-1 text-sm text-copy">Last saved {savedAt}</p>
      </div>
      {error ? <InlineError message={error} /> : null}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          className={secondaryFlowButtonClassName}
          disabled={busy}
          onClick={onStartNew}
        >
          Start a new appraisal
        </button>
        <button
          type="button"
          className={primaryFlowButtonClassName}
          disabled={busy}
          onClick={onContinue}
        >
          {busy ? (
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : null}
          Continue
        </button>
      </div>
    </FlowCard>
  );
}
