import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  LoaderCircle,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useId, useRef } from "react";
import type { ChangeEvent } from "react";

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
  TotalLossManualFormErrors,
  TotalLossManualFormValues,
} from "@/features/total-loss/types";
import {
  formatCurrencyInput,
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
      "Upload the PDF your insurance company used to determine your vehicle’s value.",
    icon: FileText,
  },
  {
    mode: "manual" as const,
    title: "I don’t have the report",
    description: "Find your vehicle by VIN or choose it from guided lists.",
    icon: PenLine,
  },
] as const;

export function ChoiceStep({
  selectedMode,
  onSelect,
  onContinue,
  busy,
  error,
}: ChoiceStepProps) {
  return (
    <FlowCard busy={busy}>
      <IntakeProgress
        current={1}
        total={selectedMode === "report" ? 2 : 3}
        label="Start"
      />
      <fieldset className="mt-7">
        <legend className="text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
          Do you have your insurance valuation report?
        </legend>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {choiceOptions.map((option) => {
            const selected = selectedMode === option.mode;
            const Icon = option.icon;
            return (
              <label
                key={option.mode}
                className={cn(
                  "relative flex min-h-44 cursor-pointer flex-col rounded-xl border bg-white p-5 transition-colors focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 hover:border-brand/45 hover:bg-brand-soft/35 motion-reduce:transition-none",
                  selected
                    ? "border-brand bg-brand-soft/45 shadow-[inset_0_0_0_1px_var(--brand)]"
                    : "border-line",
                  busy && "cursor-not-allowed opacity-65",
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
  entryMethod: VehicleEntryMethod;
  makeOptions: readonly string[];
  modelOptions: readonly string[];
  makesState: "idle" | "loading" | "success" | "error";
  modelsState: "idle" | "loading" | "success" | "error";
  vinLookupState: "idle" | "loading" | "success" | "error";
  vinLookupMessage?: string | null;
  onEntryMethodChange: (method: VehicleEntryMethod) => void;
  onRetryMakes: () => void;
  onRetryModels: () => void;
}

const vehicleYearOptions = Array.from(
  {
    length: getMaximumTotalLossVehicleYear() - MIN_TOTAL_LOSS_VEHICLE_YEAR + 1,
  },
  (_, index) => String(getMaximumTotalLossVehicleYear() - index),
);

export function VehicleStep({
  values,
  errors,
  entryMethod,
  makeOptions,
  modelOptions,
  makesState,
  modelsState,
  vinLookupState,
  vinLookupMessage,
  onEntryMethodChange,
  onRetryMakes,
  onRetryModels,
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
      <IntakeProgress current={2} total={3} label="Vehicle" />
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
        makesState={makesState}
        modelsState={modelsState}
        vinLookupState={vinLookupState}
        vinLookupMessage={vinLookupMessage}
        fieldsDisabled={fieldsDisabled}
        methodDisabled={fieldsDisabled || busy}
        mileageFields={[
          {
            id: "total-loss-mileage",
            label: "Mileage at date of loss",
            value: formatMileageInput(values.mileageAtLoss),
            error: errors.mileageAtLoss,
            placeholder: "48,250",
            disabled: fieldsDisabled,
            onChange: (value) =>
              onChange("mileageAtLoss", formatMileageInput(value)),
            onBlur: () => onBlur("mileageAtLoss"),
          },
        ]}
        onEntryMethodChange={onEntryMethodChange}
        onChange={(field, value) => onChange(field, value)}
        onBlur={(field) => onBlur(field)}
        onRetryMakes={onRetryMakes}
        onRetryModels={onRetryModels}
      />
      {error ? <InlineError message={error} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        busy={busy || vinLookupState === "loading"}
        continueLabel={
          entryMethod === "vin" ? "Find vehicle & continue" : "Continue"
        }
      />
    </FlowCard>
  );
}

export function ClaimStep({
  values,
  errors,
  onChange,
  onBlur,
  onBack,
  onContinue,
  busy,
  fieldsDisabled,
  error,
}: ManualStepProps) {
  return (
    <FlowCard busy={busy}>
      <IntakeProgress current={3} total={3} label="Claim" />
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
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
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
        <div className="sm:col-span-2">
          <IntakeTextField
            id="total-loss-insurer"
            label="Insurance company"
            value={values.insurerName}
            error={errors.insurerName}
            autoComplete="organization"
            placeholder="Insurance company name"
            disabled={fieldsDisabled}
            onChange={(event) => onChange("insurerName", event.target.value)}
            onBlur={() => onBlur("insurerName")}
          />
        </div>
        <div className="sm:col-span-2">
          <IntakeTextField
            id="total-loss-valuation"
            label="Insurer’s vehicle valuation"
            value={formatCurrencyInput(values.insurerVehicleValuation)}
            error={errors.insurerVehicleValuation}
            help="The value the insurer assigned to your vehicle before deductible, loan payoff, or other settlement adjustments."
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
      </div>
      {error ? <InlineError message={error} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        busy={busy}
        continueLabel="Continue to Free Value Check"
      />
    </FlowCard>
  );
}

interface ReportStepProps {
  authenticated: boolean;
  authenticationLoading: boolean;
  storageAvailable: boolean;
  selectedFilename?: string | null;
  savedFilename?: string | null;
  uploadState: "idle" | "uploading" | "success" | "error";
  uploadError?: string | null;
  error?: string | null;
  completing?: boolean;
  onBack: () => void;
  onRequestAuthentication: () => void;
  onFileSelected: (file: File) => void;
  onRetryUpload: () => void;
  onContinue: () => void;
}

export function ReportStep({
  authenticated,
  authenticationLoading,
  storageAvailable,
  selectedFilename,
  savedFilename,
  uploadState,
  uploadError,
  error,
  completing,
  onBack,
  onRequestAuthentication,
  onFileSelected,
  onRetryUpload,
  onContinue,
}: ReportStepProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadPending = uploadState === "uploading";
  const hasSavedReport = Boolean(savedFilename);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <FlowCard busy={uploadPending || completing}>
      <IntakeProgress current={2} total={2} label="Insurance report" />
      <StepHeading
        title="Upload your valuation report"
        description="Use the PDF your insurance company relied on to determine your vehicle’s value."
      />

      {!authenticated ? (
        <div className="mt-7 rounded-xl border border-brand/20 bg-brand-soft/55 p-5">
          <ShieldCheck className="size-6 text-brand" aria-hidden />
          <h3 className="mt-3 text-base font-semibold text-ink">
            Sign in before choosing your report
          </h3>
          <p className="mt-2 text-sm leading-6 text-copy">
            Signing in is required so Venfour can securely store the insurance
            document with your appraisal case.
          </p>
          <button
            type="button"
            className={cn(primaryFlowButtonClassName, "mt-5")}
            disabled={authenticationLoading}
            onClick={onRequestAuthentication}
          >
            {authenticationLoading
              ? "Checking sign-in…"
              : "Sign in to choose PDF"}
          </button>
        </div>
      ) : !storageAvailable ? (
        <InlineError message="Secure report storage is temporarily unavailable. Your selections are still saved on this device." />
      ) : (
        <div className="mt-7">
          <input
            ref={inputRef}
            id={inputId}
            className="hidden"
            type="file"
            tabIndex={-1}
            accept=".pdf,application/pdf"
            disabled={uploadPending || completing}
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={handleFileChange}
          />
          <div
            className={cn(
              "rounded-xl border border-dashed p-6 text-center",
              uploadState === "error"
                ? "border-red-300 bg-red-50/45"
                : "border-line-strong/70 bg-surface/65",
            )}
          >
            {uploadPending ? (
              <>
                <LoaderCircle
                  className="mx-auto size-8 animate-spin text-brand motion-reduce:animate-none"
                  aria-hidden
                />
                <p
                  className="mt-3 text-sm font-semibold text-ink"
                  role="status"
                >
                  Uploading…
                </p>
                {selectedFilename ? (
                  <p className="mx-auto mt-1 max-w-sm truncate text-xs text-copy">
                    {selectedFilename}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-copy">
                  Keep this page open until it is saved.
                </p>
              </>
            ) : hasSavedReport ? (
              <>
                <CheckCircle2
                  className="mx-auto size-8 text-market-strong"
                  aria-hidden
                />
                <p className="mt-3 text-sm font-semibold text-ink">
                  Report saved securely
                </p>
                <p className="mx-auto mt-1 max-w-sm truncate text-xs text-copy">
                  {savedFilename}
                </p>
                <button
                  type="button"
                  className={cn(secondaryFlowButtonClassName, "mt-5")}
                  onClick={() => inputRef.current?.click()}
                >
                  Replace report
                </button>
              </>
            ) : (
              <>
                <Upload className="mx-auto size-8 text-brand" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-ink">
                  {selectedFilename ?? "Choose your insurance report"}
                </p>
                <p className="mt-1 text-xs text-copy">
                  PDF · 50 MiB or smaller
                </p>
                <button
                  type="button"
                  className={cn(primaryFlowButtonClassName, "mt-5")}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose PDF
                </button>
              </>
            )}
          </div>
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
                    We couldn’t save this report
                  </p>
                  <p className="mt-1 text-sm leading-6 text-red-800">
                    {uploadError}
                  </p>
                  {selectedFilename ? (
                    <button
                      type="button"
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                      onClick={onRetryUpload}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      Try again
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {error ? <InlineError message={error} /> : null}
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className={secondaryFlowButtonClassName}
          disabled={uploadPending || completing}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </button>
        <button
          type="button"
          className={primaryFlowButtonClassName}
          disabled={!hasSavedReport || uploadPending || completing}
          onClick={onContinue}
        >
          {completing ? (
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : null}
          Continue to Free Value Check
        </button>
      </div>
    </FlowCard>
  );
}

export function ReadyStep() {
  return (
    <FlowCard className="text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-market-soft text-market-strong">
        <CheckCircle2 className="size-7" aria-hidden />
      </span>
      <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-ink">
        Your information is saved
      </h2>
      <p className="mt-3 text-base leading-7 text-copy">
        You’re ready for the free value check.
      </p>
      <div className="mx-auto mt-7 max-w-lg rounded-xl border border-line bg-surface p-5">
        <p className="text-sm font-semibold text-ink">
          Free value check coming next
        </p>
        <p className="mt-2 text-sm leading-6 text-copy">
          Venfour has not run a market-value check yet. Your saved intake is
          ready for that next step when it becomes available.
        </p>
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
