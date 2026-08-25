import {
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
import { useId, useLayoutEffect, useRef } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
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
} from "@/features/total-loss/types";
import {
  formatCurrencyInput,
  formatMileageInput,
  formatUsPhoneNumberInput,
  getUsPhoneNumberDigits,
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
  | "contact";

const reportProgressSteps = [
  { step: "choice", label: "Start" },
  { step: "report", label: "Valuation report" },
  { step: "contact", label: "Contact" },
] as const;

const manualProgressSteps = [
  { step: "choice", label: "Start" },
  { step: "vehicle", label: "Vehicle" },
  { step: "claim", label: "Claim" },
  { step: "contact", label: "Contact" },
] as const;

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
      maxTotal={manualProgressSteps.length}
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

interface ReportUploadStepProps {
  readonly storageAvailable: boolean;
  readonly marketZipCode: string;
  readonly marketZipCodeError?: string;
  readonly selectedFilename?: string | null;
  readonly savedFilename?: string | null;
  readonly uploadState: "idle" | "queued" | "uploading" | "success" | "error";
  readonly uploadError?: string | null;
  readonly error?: string | null;
  readonly busy?: boolean;
  readonly hideBack?: boolean;
  readonly onRetryStorage?: () => void;
  readonly onBack: () => void;
  readonly onMarketZipCodeChange: (value: string) => void;
  readonly onMarketZipCodeBlur: () => void;
  readonly onFilesSelected: (files: readonly File[]) => void;
  readonly onRetryUpload: () => void;
  readonly onContinue: () => void;
}

export function ReportUploadStep({
  storageAvailable,
  marketZipCode,
  marketZipCodeError,
  selectedFilename,
  savedFilename,
  uploadState,
  uploadError,
  error,
  busy,
  hideBack,
  onRetryStorage,
  onBack,
  onMarketZipCodeChange,
  onMarketZipCodeBlur,
  onFilesSelected,
  onRetryUpload,
  onContinue,
}: ReportUploadStepProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadPending =
    uploadState === "queued" || uploadState === "uploading";
  const retryAvailable =
    uploadState === "error" && Boolean(selectedFilename);
  const displayedFilename = uploadPending
    ? (selectedFilename ?? savedFilename)
    : (savedFilename ?? selectedFilename);
  const hasSavedReport = Boolean(savedFilename);
  const disabled = uploadPending || Boolean(busy);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onFilesSelected(files);
  };

  if (!storageAvailable) {
    return (
      <FlowCard>
        <TotalLossProgress mode="report" step="report" />
        <StepHeading
          title="Upload your valuation report"
          description="Secure report storage is temporarily unavailable. Your file has not been requested or uploaded."
        />
        <InlineError message="Report upload is unavailable in this browser right now." />
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {hideBack ? (
            <Link className={secondaryFlowButtonClassName} to="/">
              Return home
            </Link>
          ) : (
            <button
              type="button"
              className={secondaryFlowButtonClassName}
              onClick={onBack}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </button>
          )}
          {onRetryStorage ? (
            <button
              type="button"
              className={primaryFlowButtonClassName}
              onClick={onRetryStorage}
            >
              <RefreshCw className="size-4" aria-hidden />
              Retry secure storage
            </button>
          ) : null}
        </div>
      </FlowCard>
    );
  }

  return (
    <FlowCard busy={disabled}>
      <TotalLossProgress mode="report" step="report" />
      <StepHeading
        title="Upload your valuation report"
        description="Add your market ZIP and securely attach the report to your private appraisal. Venfour won’t read or analyze it until after your contact details are saved."
      />

      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        multiple
        disabled={disabled}
        onChange={handleFiles}
      />

      <div className="mt-7 overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex min-w-0 flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <span
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-2xl",
              hasSavedReport
                ? "bg-market-soft text-market-strong"
                : "bg-brand-soft text-brand",
            )}
            aria-hidden
          >
            {uploadPending ? (
              <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" />
            ) : hasSavedReport ? (
              <CheckCircle2 className="size-6" />
            ) : (
              <FileText className="size-6" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink">
              {uploadPending
                ? uploadState === "queued"
                  ? "Waiting to upload securely"
                  : "Uploading securely"
                : hasSavedReport
                  ? "Report securely attached"
                  : "Choose your valuation report"}
            </p>
            <p className="mt-1 text-sm leading-6 text-copy">
              {uploadPending
                ? "Keep this page open while Venfour finishes saving the file."
                : hasSavedReport
                  ? "Next, add your contact details. The report will be reviewed during analysis."
                  : "Add one PDF, or select JPG/PNG pages together. Venfour combines image pages into one private PDF before upload."}
            </p>
            {displayedFilename ? (
              <p className="mt-2 truncate text-sm font-semibold text-ink" title={displayedFilename}>
                {displayedFilename}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={secondaryFlowButtonClassName}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden />
            {hasSavedReport ? "Replace report" : "Choose report"}
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-line bg-surface/55 px-5 py-3 text-xs leading-5 text-copy sm:px-6">
          <ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden />
          Private, owner-only storage · PDF, JPG, or PNG · 50 MiB total
        </div>
      </div>

      <div className="mt-6 w-full">
        <IntakeTextField
          id="total-loss-report-market-zip"
          label="Market ZIP code"
          value={marketZipCode}
          error={marketZipCodeError}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={10}
          placeholder="60611"
          disabled={disabled}
          help="Used to find comparable vehicles near you."
          helpAfterInput
          onChange={(event) => onMarketZipCodeChange(event.target.value)}
          onBlur={onMarketZipCodeBlur}
        />
      </div>

      {uploadError ? <InlineError message={uploadError} /> : null}
      {error ? <InlineError message={error} /> : null}

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {!hideBack ? (
          <button
            type="button"
            className={secondaryFlowButtonClassName}
            disabled={disabled}
            onClick={onBack}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          {retryAvailable ? (
            <button
              type="button"
              className={secondaryFlowButtonClassName}
              disabled={disabled}
              onClick={onRetryUpload}
            >
              <RefreshCw className="size-4" aria-hidden />
              Try upload again
            </button>
          ) : null}
          {hasSavedReport && !uploadPending ? (
            <button
              type="button"
              className={primaryFlowButtonClassName}
              disabled={disabled}
              onClick={onContinue}
            >
              Continue to contact
              <ArrowRight className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
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
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const pendingPhoneCaretRef = useRef<number | null>(null);
  const displayedPhoneNumber = formatUsPhoneNumberInput(values.phoneNumber);

  useLayoutEffect(() => {
    const caret = pendingPhoneCaretRef.current;
    const input = phoneInputRef.current;
    if (caret === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
    pendingPhoneCaretRef.current = null;
  });

  const updatePhoneNumber = (digits: string, digitOffset: number, atEnd = false) => {
    const formatted = formatUsPhoneNumberInput(digits);
    pendingPhoneCaretRef.current = atEnd
      ? formatted.length
      : phoneCaretPosition(formatted, digitOffset);
    onChange("phoneNumber", formatted);
  };

  const handlePhoneChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    const selectionStart = event.currentTarget.selectionStart ?? rawValue.length;
    const digits = getUsPhoneNumberDigits(rawValue).slice(0, 10);
    const digitOffset = Math.min(
      getUsPhoneNumberDigits(rawValue.slice(0, selectionStart)).length,
      digits.length,
    );
    updatePhoneNumber(digits, digitOffset, selectionStart === rawValue.length);
  };

  const handlePhoneKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;

    const input = event.currentTarget;
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    if (
      selectionStart === null ||
      selectionEnd === null ||
      selectionStart !== selectionEnd
    ) {
      return;
    }

    const adjacentCharacter =
      event.key === "Backspace"
        ? input.value[selectionStart - 1]
        : input.value[selectionStart];
    if (!adjacentCharacter || /\d/u.test(adjacentCharacter)) return;

    const digits = getUsPhoneNumberDigits(input.value).slice(0, 10);
    const digitOffset = getUsPhoneNumberDigits(
      input.value.slice(0, selectionStart),
    ).length;
    const removeIndex = event.key === "Backspace" ? digitOffset - 1 : digitOffset;
    if (removeIndex < 0 || removeIndex >= digits.length) return;

    event.preventDefault();
    const nextDigits = `${digits.slice(0, removeIndex)}${digits.slice(removeIndex + 1)}`;
    updatePhoneNumber(nextDigits, removeIndex);
  };

  return (
    <FlowCard busy={busy}>
      <TotalLossProgress mode={mode} step="contact" />
      <StepHeading
        title="Contact details"
        description="Tell us where to save your private result."
      />
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
          value={displayedPhoneNumber}
          error={errors.phoneNumber}
          optional
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 123-4567"
          disabled={busy}
          inputRef={phoneInputRef}
          onChange={handlePhoneChange}
          onKeyDown={handlePhoneKeyDown}
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
        continueLabel="Review & analyze"
      />
    </FlowCard>
  );
}

function phoneCaretPosition(formattedValue: string, digitOffset: number) {
  if (digitOffset <= 0) return formattedValue ? 1 : 0;

  let digitsSeen = 0;
  for (let index = 0; index < formattedValue.length; index += 1) {
    if (!/\d/u.test(formattedValue[index])) continue;
    digitsSeen += 1;
    if (digitsSeen === digitOffset) return index + 1;
  }
  return formattedValue.length;
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
