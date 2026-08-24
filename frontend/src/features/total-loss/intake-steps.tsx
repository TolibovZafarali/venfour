import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useId, useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Link } from "react-router";

import {
  FlowCard,
  IntakeProgress,
  IntakeDatePicker,
  IntakeSelectField,
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
        total={6}
        label="Start"
      />
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
      <IntakeProgress current={3} total={6} label="Vehicle" />
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
        trimRequired
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
          entryMethod === "vin" &&
          (!values.vehicleYear || !values.make || !values.model)
            ? "Find vehicle"
            : "Confirm vehicle & continue"
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
      <IntakeProgress current={4} total={6} label="Claim" />
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
            help="The value the insurer assigned to your vehicle before deductible, loan payoff, or other settlement adjustments. Leave this blank if you have not received one."
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
        <div>
          <IntakeSelectField
            id="total-loss-condition"
            label="Pre-loss condition"
            value={values.vehicleCondition}
            error={errors.vehicleCondition}
            placeholder="Choose the closest description"
            options={[
              "Excellent",
              "Good",
              "Average",
              "Fair",
              "Poor",
              "Not sure",
            ]}
            disabled={fieldsDisabled}
            onChange={(event) =>
              onChange("vehicleCondition", event.target.value)
            }
            onBlur={() => onBlur("vehicleCondition")}
          />
        </div>
        <div>
          <IntakeTextField
            id="total-loss-options"
            label="Important options or packages"
            value={values.optionsPackages}
            error={errors.optionsPackages}
            help="List value-relevant equipment, or enter “None” if there is nothing notable."
            placeholder="Premium package, AWD, panoramic roof—or None"
            disabled={fieldsDisabled}
            onChange={(event) =>
              onChange("optionsPackages", event.target.value)
            }
            onBlur={() => onBlur("optionsPackages")}
          />
        </div>
      </div>
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
  uploadState: "idle" | "uploading" | "success" | "error";
  extractionState: TotalLossReportExtractionStatus;
  reportProvider?: string | null;
  extractionWarnings?: readonly string[];
  uploadError?: string | null;
  error?: string | null;
  completing?: boolean;
  onBack: () => void;
  onFilesSelected: (files: readonly File[]) => void;
  onRetryUpload: () => void;
  onContinue: () => void;
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
  onBack,
  onFilesSelected,
  onRetryUpload,
  onContinue,
}: ReportStepProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadPending = uploadState === "uploading";
  const hasSavedReport = Boolean(savedFilename);
  const extractionReady =
    extractionState === "complete" ||
    extractionState === "partial" ||
    extractionState === "error";

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFilesSelected(files);
  };

  return (
    <FlowCard busy={uploadPending || completing || extractionState === "processing"}>
      <IntakeProgress current={2} total={6} label="Valuation report" />
      <StepHeading
        title="Upload your valuation report"
        description="Venfour accepts insurer valuation reports from any provider. We’ll extract what we can, then ask you to confirm every important fact."
      />

      {!storageAvailable ? (
        <InlineError message="Secure report storage is temporarily unavailable. Your selections are still saved on this device." />
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
                <p className="mt-3 text-sm font-semibold text-ink" role="status">
                  Preparing and saving your report…
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
                <CheckCircle2 className="mx-auto size-8 text-market-strong" aria-hidden />
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
                  {selectedFilename ?? "Choose your valuation report"}
                </p>
                <p className="mt-1 text-xs text-copy">
                  PDF, JPG/JPEG, or PNG · 50 MiB total. Select image pages in order.
                </p>
                <button
                  type="button"
                  className={cn(primaryFlowButtonClassName, "mt-5")}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose report
                </button>
              </>
            )}
          </div>
          {uploadError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-red-950">
                    We couldn’t use this report
                  </p>
                  <p className="mt-1 text-sm leading-6 text-red-800">{uploadError}</p>
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
          {hasSavedReport && extractionState === "processing" ? (
            <p className="mt-4 text-sm font-semibold text-copy" role="status">
              Reading the report and preparing details for your review…
            </p>
          ) : null}
          {hasSavedReport && extractionReady ? (
            <div className="mt-4 rounded-xl border border-market/25 bg-market-soft p-4">
              <p className="text-sm font-semibold text-market-strong">
                {extractionState === "error"
                  ? "Your report is saved"
                  : reportProvider
                    ? `${reportProvider} report details extracted`
                    : "Report details extracted"}
              </p>
              <p className="mt-1 text-sm leading-6 text-copy">
                {extractionState === "error"
                  ? "Automatic extraction could not finish. Continue to enter the needed details manually; your report will remain available for review."
                  : extractionState === "partial"
                  ? "Some details still need your help. The report is saved, and you can complete the missing fields next."
                  : "Review and correct the extracted vehicle and claim details next."}
              </p>
              {extractionWarnings.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-copy">
                  {extractionWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
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
          disabled={!hasSavedReport || !extractionReady || uploadPending || completing}
          onClick={onContinue}
        >
          {extractionState === "error"
            ? "Continue with manual details"
            : "Review extracted details"}
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </FlowCard>
  );
}

interface ContactStepProps {
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
      <IntakeProgress current={5} total={6} label="Contact" />
      <StepHeading
        title="Where should we send and save your results?"
        description="You can continue in this browser now. We’ll also send a secure access link so you can return later."
      />
      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <IntakeTextField
          id="total-loss-contact-name"
          label="Full name"
          value={values.fullName}
          error={errors.fullName}
          autoComplete="name"
          maxLength={200}
          disabled={busy}
          onChange={(event) => onChange("fullName", event.target.value)}
        />
        <IntakeTextField
          id="total-loss-contact-email"
          label={emailLocked ? "Verified account email" : "Email address"}
          value={values.email}
          error={errors.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={320}
          disabled={busy || emailLocked}
          help={
            emailLocked
              ? "This case will remain with your signed-in account."
              : "This address is not verified until you use the secure link we send."
          }
          onChange={(event) => onChange("email", event.target.value)}
        />
      </div>

      <div className="mt-6 space-y-3">
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
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface/55 p-4">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-brand"
            checked={values.operationalFollowUpAllowed}
            disabled={busy}
            onChange={(event) =>
              onChange("operationalFollowUpAllowed", event.target.checked)
            }
          />
          <span>
            <span className="block text-sm font-semibold text-ink">
              Optional case follow-up
            </span>
            <span className="mt-1 block text-xs leading-5 text-copy">
              Venfour may contact me about this case or related service follow-up. This is optional and separate from essential messages I request.
            </span>
          </span>
        </label>
      </div>

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
      <IntakeProgress current={6} total={6} label="Review" />
      <StepHeading
        title="Review your details"
        description="Confirm the information Venfour will use before the analysis begins."
      />
      <div className="mt-7 grid gap-4 lg:grid-cols-2">
        <ReviewPanel title="Vehicle" onEdit={onEditVehicle}>
          <p className="font-semibold text-ink">{vehicle}</p>
          <p>{values.mileageAtLoss} miles · {values.vehicleCondition} condition</p>
          {values.vin ? <p>VIN {values.vin}</p> : null}
          <p>Options/packages: {values.optionsPackages}</p>
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
          <p className="font-semibold text-ink">{contact.fullName}</p>
          <p>{contact.email}</p>
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
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4">
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
