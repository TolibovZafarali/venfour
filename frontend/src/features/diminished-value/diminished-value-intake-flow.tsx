import { CheckCircle2, PencilLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  FlowCard,
  InlineError,
  IntakeDatePicker,
  IntakeProgress,
  IntakeRadioChoiceGroup,
  IntakeSelectField,
  IntakeStepTransition,
  IntakeTextareaField,
  IntakeTextField,
  secondaryFlowButtonClassName,
  StepActions,
  StepHeading,
  type VehicleLookupService,
  type VehicleLookupState,
  VehicleIdentificationFields,
  useVehicleLookupController,
} from "@/features/intake";
import { createNhtsaVpicVehicleLookupService } from "@/features/total-loss/nhtsa-vpic-vehicle-lookup";
import { cn } from "@/lib/utils";

import { LocalDocumentPicker } from "./local-document-picker";
import {
  diminishedValueDraftReducer,
  type DiminishedValueDraftAction,
} from "./state";
import type {
  DiminishedValueDraft,
  DiminishedValueFormErrors,
  DiminishedValueFormField,
  DiminishedValueStep,
  DiminishedValueVehicleEntryMethod,
} from "./types";
import {
  formatDiminishedValueCurrency,
  formatDiminishedValueMileage,
  hasDiminishedValueErrors,
  maximumDiminishedValueVehicleYear,
  normalizeDiminishedValueVin,
  validateDiminishedValueAccidentRepairs,
  validateDiminishedValueConsultation,
  validateDiminishedValueStart,
  validateDiminishedValueVehicle,
} from "./validation";

interface DiminishedValueIntakeFlowProps {
  readonly draft: DiminishedValueDraft;
  readonly onDraftChange: (draft: DiminishedValueDraft) => void;
  readonly selectedFiles: readonly File[];
  readonly onSelectedFilesChange: (files: File[]) => void;
  readonly vehicleLookupService?: VehicleLookupService;
}

const defaultVehicleLookupService = createNhtsaVpicVehicleLookupService();
const progressSteps = [
  { label: "Start" },
  { label: "Vehicle" },
  { label: "Accident and repairs" },
  { label: "Consultation" },
] as const;
const stepPositions: Record<DiminishedValueStep, number> = {
  start: 1,
  vehicle: 2,
  "accident-repairs": 3,
  consultation: 4,
  complete: 5,
};

export function DiminishedValueIntakeFlow({
  draft,
  onDraftChange,
  selectedFiles,
  onSelectedFilesChange,
  vehicleLookupService = defaultVehicleLookupService,
}: DiminishedValueIntakeFlowProps) {
  const [errors, setErrors] = useState<DiminishedValueFormErrors>({});
  const [flowError, setFlowError] = useState<string | null>(null);
  const [transitionDirection, setTransitionDirection] = useState<
    "forward" | "backward"
  >("forward");
  const stepContainerRef = useRef<HTMLDivElement>(null);
  const previousStepRef = useRef(draft.step);
  const {
    makeOptions,
    modelOptions,
    makesState,
    modelsState,
    vinLookupState,
    vinLookupMessage,
    decodeVin,
    resetVinLookup,
    resetModelLookup,
    retryMakes,
    retryModels,
  } = useVehicleLookupController({
    service: vehicleLookupService,
    catalogEnabled: draft.vehicleEntryMethod === "details",
    vehicleYear: draft.vehicleYear,
    make: draft.make,
    currentVin: normalizeDiminishedValueVin(draft.vin),
    unknownVinErrorMessage: "Vehicle lookup is temporarily unavailable. Try again.",
  });

  useEffect(() => {
    if (previousStepRef.current === draft.step) return;
    previousStepRef.current = draft.step;
    const frame = window.requestAnimationFrame(() => {
      stepContainerRef.current?.querySelector<HTMLElement>("h2")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft.step]);

  const dispatch = useCallback(
    (action: DiminishedValueDraftAction) => {
      onDraftChange(diminishedValueDraftReducer(draft, action));
    },
    [draft, onDraftChange],
  );

  const goToStep = useCallback(
    (step: DiminishedValueStep, returnAfterStartEdit?: boolean) => {
      setTransitionDirection(
        stepPositions[step] < stepPositions[draft.step]
          ? "backward"
          : "forward",
      );
      setErrors({});
      setFlowError(null);
      dispatch({ type: "step-changed", step, returnAfterStartEdit });
    },
    [dispatch, draft.step],
  );

  const changeField = useCallback(
    (field: DiminishedValueFormField, value: string) => {
      setErrors((current) => withoutError(current, field));
      setFlowError(null);
      if (field === "vin") {
        resetVinLookup();
      }
      if (field === "vehicleYear" || field === "make") {
        resetModelLookup();
      }
      dispatch({ type: "field-changed", field, value });
    },
    [dispatch, resetModelLookup, resetVinLookup],
  );

  const changeVehicleMethod = useCallback(
    (method: DiminishedValueVehicleEntryMethod) => {
      setErrors((current) =>
        withoutErrors(current, ["vin", "vehicleYear", "make", "model"]),
      );
      setFlowError(null);
      resetVinLookup();
      dispatch({ type: "vehicle-method-changed", method });
    },
    [dispatch, resetVinLookup],
  );

  const validateAndContinueStart = () => {
    const nextErrors = validateDiminishedValueStart(draft);
    if (showValidationErrors(nextErrors, setErrors, setFlowError)) return;
    goToStep(
      draft.returnAfterStartEdit ? "accident-repairs" : "vehicle",
      false,
    );
  };

  const validateAndContinueVehicle = async () => {
    const nextErrors = validateDiminishedValueVehicle(draft);
    if (showValidationErrors(nextErrors, setErrors, setFlowError)) return;

    if (draft.vehicleEntryMethod === "details") {
      goToStep("accident-repairs");
      return;
    }

    setFlowError(null);
    const vehicle = await decodeVin(normalizeDiminishedValueVin(draft.vin));
    if (!vehicle) return;
    const decodedDraft = diminishedValueDraftReducer(draft, {
      type: "vehicle-decoded",
      vehicle,
    });
    setTransitionDirection("forward");
    onDraftChange(
      diminishedValueDraftReducer(decodedDraft, {
        type: "step-changed",
        step: "accident-repairs",
      }),
    );
  };

  const validateAndContinueRepairs = () => {
    const nextErrors = validateDiminishedValueAccidentRepairs(draft);
    if (showValidationErrors(nextErrors, setErrors, setFlowError)) return;
    goToStep("consultation");
  };

  const prepareReviewRequest = () => {
    const nextErrors = validateDiminishedValueConsultation(draft);
    if (showValidationErrors(nextErrors, setErrors, setFlowError)) return;
    goToStep("complete");
  };

  const renderedStep = (() => {
    switch (draft.step) {
      case "start":
        return (
          <DiminishedValueStartStep
            draft={draft}
            errors={errors}
            onChange={changeField}
            onContinue={validateAndContinueStart}
            flowError={flowError}
          />
        );
      case "vehicle":
        return (
          <DiminishedValueVehicleStep
            draft={draft}
            errors={errors}
            makeOptions={makeOptions}
            modelOptions={modelOptions}
            makesState={makesState}
            modelsState={modelsState}
            vinLookupState={vinLookupState}
            vinLookupMessage={vinLookupMessage}
            flowError={flowError}
            onChange={changeField}
            onMethodChange={changeVehicleMethod}
            onRetryMakes={retryMakes}
            onRetryModels={retryModels}
            onUseDetails={() => changeVehicleMethod("details")}
            onBack={() => goToStep("start", false)}
            onContinue={() => void validateAndContinueVehicle()}
          />
        );
      case "accident-repairs":
        return (
          <DiminishedValueRepairsStep
            draft={draft}
            errors={errors}
            files={selectedFiles}
            flowError={flowError}
            onChange={changeField}
            onFilesChange={onSelectedFilesChange}
            onEditStart={() => goToStep("start", true)}
            onBack={() => goToStep("vehicle")}
            onContinue={validateAndContinueRepairs}
          />
        );
      case "consultation":
        return (
          <DiminishedValueConsultationStep
            draft={draft}
            errors={errors}
            flowError={flowError}
            onChange={changeField}
            onBack={() => goToStep("accident-repairs")}
            onContinue={prepareReviewRequest}
          />
        );
      case "complete":
        return (
          <DiminishedValueCompleteStep
            fileCount={selectedFiles.length}
            onEdit={() => goToStep("consultation")}
          />
        );
    }
  })();

  return (
    <div ref={stepContainerRef}>
      <IntakeStepTransition
        direction={transitionDirection}
        transitionKey={draft.step}
      >
        {renderedStep}
      </IntakeStepTransition>
    </div>
  );
}

interface SharedStepProps {
  readonly draft: DiminishedValueDraft;
  readonly errors: DiminishedValueFormErrors;
  readonly flowError: string | null;
  readonly onChange: (field: DiminishedValueFormField, value: string) => void;
}

interface StartStepProps extends SharedStepProps {
  readonly onContinue: () => void;
}

export function DiminishedValueStartStep({
  draft,
  errors,
  flowError,
  onChange,
  onContinue,
}: StartStepProps) {
  return (
    <FlowCard>
      <DiminishedValueProgress current={1} />
      <StepHeading
        title="Start with the accident details"
        description="A few basics help us understand where the claim stands before we gather vehicle and repair information."
      />
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <IntakeSelectField
          id="diminished-value-state"
          label="State where the accident occurred"
          value={draft.accidentState}
          error={errors.accidentState}
          placeholder="Select a state"
          options={US_STATE_OPTIONS}
          onChange={(event) => onChange("accidentState", event.target.value)}
        />
        <IntakeDatePicker
          id="diminished-value-accident-date"
          label="Accident date"
          calendarLabel="Choose accident date"
          value={draft.accidentDate}
          error={errors.accidentDate}
          onChange={(value) => onChange("accidentDate", value)}
        />
        <div className="sm:col-span-2">
          <IntakeSelectField
            id="diminished-value-repair-status"
            label="Repair status"
            value={draft.repairStatus}
            error={errors.repairStatus}
            placeholder="Select repair status"
            options={REPAIR_STATUS_OPTIONS}
            onChange={(event) => onChange("repairStatus", event.target.value)}
          />
          {draft.repairStatus && draft.repairStatus !== "complete" ? (
            <p
              className="mt-3 rounded-lg bg-brand-soft/45 px-3 py-2 text-sm leading-6 text-copy"
              role="status"
            >
              That’s okay. A review can begin while repairs are unfinished or
              their status is still unclear.
            </p>
          ) : null}
        </div>
      </div>
      {flowError ? <InlineError message={flowError} /> : null}
      <StepActions onContinue={onContinue} />
    </FlowCard>
  );
}

interface VehicleStepProps extends SharedStepProps {
  readonly makeOptions: readonly string[];
  readonly modelOptions: readonly string[];
  readonly makesState: VehicleLookupState;
  readonly modelsState: VehicleLookupState;
  readonly vinLookupState: VehicleLookupState;
  readonly vinLookupMessage: string | null;
  readonly onMethodChange: (method: DiminishedValueVehicleEntryMethod) => void;
  readonly onRetryMakes: () => void;
  readonly onRetryModels: () => void;
  readonly onUseDetails: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function DiminishedValueVehicleStep({
  draft,
  errors,
  makeOptions,
  modelOptions,
  makesState,
  modelsState,
  vinLookupState,
  vinLookupMessage,
  flowError,
  onChange,
  onMethodChange,
  onRetryMakes,
  onRetryModels,
  onUseDetails,
  onBack,
  onContinue,
}: VehicleStepProps) {
  return (
    <FlowCard busy={vinLookupState === "loading"}>
      <DiminishedValueProgress current={2} />
      <StepHeading
        title="Tell us about the vehicle"
        description="Use the VIN for the quickest match, or choose the year, make, and model from guided lists."
      />
      <VehicleIdentificationFields
        idPrefix="diminished-value"
        entryMethod={draft.vehicleEntryMethod}
        values={draft}
        errors={errors}
        yearOptions={vehicleYearOptions}
        makeOptions={makeOptions}
        modelOptions={modelOptions}
        makesState={makesState}
        modelsState={modelsState}
        vinLookupState={vinLookupState}
        vinLookupMessage={vinLookupMessage}
        fieldsDisabled={vinLookupState === "loading"}
        methodDisabled={vinLookupState === "loading"}
        mileageFields={[
          {
            id: "diminished-value-mileage-at-accident",
            label: "Mileage at the accident",
            value: formatDiminishedValueMileage(draft.mileageAtAccident),
            error: errors.mileageAtAccident,
            placeholder: "48,250",
            onChange: (value) =>
              onChange(
                "mileageAtAccident",
                formatDiminishedValueMileage(value),
              ),
          },
          {
            id: "diminished-value-current-mileage",
            label: "Current mileage",
            value: formatDiminishedValueMileage(draft.currentMileage),
            error: errors.currentMileage,
            optional: true,
            placeholder: "49,100",
            onChange: (value) =>
              onChange("currentMileage", formatDiminishedValueMileage(value)),
          },
        ]}
        onEntryMethodChange={onMethodChange}
        onChange={onChange}
        onRetryMakes={onRetryMakes}
        onRetryModels={onRetryModels}
      />
      {draft.vehicleEntryMethod === "vin" &&
      vinLookupState === "error" &&
      vinLookupMessage ? (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-red-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
          onClick={onUseDetails}
        >
          Select vehicle details instead
        </button>
      ) : null}
      {flowError ? <InlineError message={flowError} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        busy={vinLookupState === "loading"}
        continueLabel={
          draft.vehicleEntryMethod === "vin"
            ? "Find vehicle & continue"
            : "Continue"
        }
      />
    </FlowCard>
  );
}

interface RepairsStepProps extends SharedStepProps {
  readonly files: readonly File[];
  readonly onFilesChange: (files: File[]) => void;
  readonly onEditStart: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function DiminishedValueRepairsStep({
  draft,
  errors,
  files,
  flowError,
  onChange,
  onFilesChange,
  onEditStart,
  onBack,
  onContinue,
}: RepairsStepProps) {
  return (
    <FlowCard>
      <DiminishedValueProgress current={3} />
      <StepHeading
        title="Describe the accident and repairs"
        description="These facts help a reviewer understand the severity of the loss and the repair record."
      />
      <div className="mt-6 rounded-xl border border-line bg-surface p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="text-sm font-semibold text-ink">Accident summary</p>
          <p className="mt-1 text-sm leading-6 text-copy">
            {formatDisplayDate(draft.accidentDate)} · {draft.accidentState} ·{" "}
            {repairStatusLabel(draft.repairStatus)}
          </p>
        </div>
        <button
          type="button"
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none sm:mt-0"
          onClick={onEditStart}
        >
          <PencilLine className="size-4" aria-hidden />
          Edit accident details
        </button>
      </div>

      <div className="mt-6 grid gap-6">
        <IntakeRadioChoiceGroup
          id="diminished-value-other-party-at-fault"
          legend="Was another party at fault?"
          value={draft.otherPartyAtFault}
          error={errors.otherPartyAtFault}
          options={YES_NO_NOT_SURE_OPTIONS}
          onChange={(value) => onChange("otherPartyAtFault", value)}
        />
        <IntakeTextField
          id="diminished-value-at-fault-insurer"
          label="At-fault party’s insurance company"
          value={draft.atFaultInsurer}
          optional
          autoComplete="organization"
          placeholder="Insurance company name, if known"
          onChange={(event) => onChange("atFaultInsurer", event.target.value)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <IntakeTextField
            id="diminished-value-repair-cost"
            label="Repair cost"
            value={formatDiminishedValueCurrency(draft.repairCost)}
            error={errors.repairCost}
            optional
            inputMode="decimal"
            autoComplete="off"
            placeholder="$12,500.00"
            onChange={(event) =>
              onChange(
                "repairCost",
                formatDiminishedValueCurrency(event.target.value),
              )
            }
          />
          <IntakeTextField
            id="diminished-value-repair-facility"
            label="Repair facility"
            value={draft.repairFacility}
            optional
            autoComplete="organization"
            placeholder="Shop or facility name"
            onChange={(event) =>
              onChange("repairFacility", event.target.value)
            }
          />
        </div>
        <IntakeRadioChoiceGroup
          id="diminished-value-structural-damage"
          legend="Was there structural or frame damage?"
          value={draft.structuralDamage}
          error={errors.structuralDamage}
          options={YES_NO_NOT_SURE_OPTIONS}
          onChange={(value) => onChange("structuralDamage", value)}
        />
        <IntakeRadioChoiceGroup
          id="diminished-value-airbag-deployment"
          legend="Did any airbags deploy?"
          value={draft.airbagDeployment}
          error={errors.airbagDeployment}
          options={YES_NO_NOT_SURE_OPTIONS}
          onChange={(value) => onChange("airbagDeployment", value)}
        />
        <IntakeTextareaField
          id="diminished-value-major-repair-details"
          label="Major repair information"
          value={draft.majorRepairDetails}
          optional
          rows={4}
          placeholder="Describe major parts replaced, paint or body work, mechanical repairs, or anything else a reviewer should know."
          onChange={(event) =>
            onChange("majorRepairDetails", event.target.value)
          }
        />
        <LocalDocumentPicker files={files} onFilesChange={onFilesChange} />
      </div>
      {flowError ? <InlineError message={flowError} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Continue"
      />
    </FlowCard>
  );
}

interface ConsultationStepProps extends SharedStepProps {
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function DiminishedValueConsultationStep({
  draft,
  errors,
  flowError,
  onChange,
  onBack,
  onContinue,
}: ConsultationStepProps) {
  return (
    <FlowCard>
      <DiminishedValueProgress current={4} />
      <StepHeading
        title="Prepare your review request"
        description="Add contact details and general availability so your information is ready for a future consultation workflow."
      />
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <IntakeTextField
            id="diminished-value-full-name"
            label="Name"
            value={draft.fullName}
            error={errors.fullName}
            autoComplete="name"
            onChange={(event) => onChange("fullName", event.target.value)}
          />
        </div>
        <IntakeTextField
          id="diminished-value-email"
          label="Email"
          value={draft.email}
          error={errors.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          onChange={(event) => onChange("email", event.target.value)}
        />
        <IntakeTextField
          id="diminished-value-phone"
          label="Phone"
          value={draft.phone}
          error={errors.phone}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="(312) 555-0123"
          onChange={(event) => onChange("phone", event.target.value)}
        />
        <div className="sm:col-span-2">
          <IntakeRadioChoiceGroup
            id="diminished-value-preferred-contact"
            legend="Preferred contact method"
            value={draft.preferredContactMethod}
            error={errors.preferredContactMethod}
            columns={2}
            options={CONTACT_METHOD_OPTIONS}
            onChange={(value) => onChange("preferredContactMethod", value)}
          />
        </div>
        <div className="sm:col-span-2">
          <IntakeTextareaField
            id="diminished-value-availability"
            label="General availability"
            value={draft.availability}
            error={errors.availability}
            help="Include your time zone and a few windows that generally work for you. No appointment will be confirmed here."
            rows={4}
            placeholder="Weekdays after 4 p.m. Central Time"
            onChange={(event) => onChange("availability", event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <IntakeTextareaField
            id="diminished-value-notes"
            label="Anything else we should know?"
            value={draft.notes}
            optional
            rows={4}
            placeholder="Add any questions or context you would want a reviewer to see."
            onChange={(event) => onChange("notes", event.target.value)}
          />
        </div>
      </div>
      {flowError ? <InlineError message={flowError} /> : null}
      <StepActions
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Request a review"
      />
    </FlowCard>
  );
}

export function DiminishedValueCompleteStep({
  fileCount,
  onEdit,
}: {
  readonly fileCount: number;
  readonly onEdit: () => void;
}) {
  return (
    <FlowCard className="text-center">
      <div role="status" aria-live="polite">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-market-soft text-market-strong">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>
        <h2
          className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-ink"
          tabIndex={-1}
        >
          Your review request is prepared
        </h2>
        <p className="mt-3 text-base leading-7 text-copy">
          {fileCount > 0
            ? `Your answers and ${fileCount} selected ${fileCount === 1 ? "file are" : "files are"} ready for you to review in this browser session.`
            : "Your answers are ready for you to review in this browser session."}
        </p>
        <div className="mx-auto mt-7 max-w-lg rounded-xl border border-line bg-surface p-5">
          <p className="text-sm font-semibold text-ink">Nothing was sent</p>
          <p className="mt-2 text-sm leading-6 text-copy">
            Venfour has not received this information, and no appointment or
            consultation has been confirmed.
          </p>
        </div>
      </div>
      <button
        type="button"
        className={cn(secondaryFlowButtonClassName, "mt-7")}
        onClick={onEdit}
      >
        <PencilLine className="size-4" aria-hidden />
        Edit contact details
      </button>
    </FlowCard>
  );
}

function DiminishedValueProgress({ current }: { readonly current: number }) {
  return <IntakeProgress current={current} steps={progressSteps} />;
}

function showValidationErrors(
  errors: DiminishedValueFormErrors,
  setErrors: (errors: DiminishedValueFormErrors) => void,
  setFlowError: (message: string | null) => void,
) {
  setErrors(errors);
  if (!hasDiminishedValueErrors(errors)) {
    setFlowError(null);
    return false;
  }
  setFlowError("Review the highlighted fields before continuing.");
  focusFirstError(errors);
  return true;
}

function focusFirstError(errors: DiminishedValueFormErrors) {
  const field = Object.keys(errors)[0] as DiminishedValueFormField | undefined;
  if (!field) return;
  const control = document.getElementById(fieldControlIds[field]);
  control?.focus();
}

function withoutError(
  errors: DiminishedValueFormErrors,
  field: DiminishedValueFormField,
) {
  if (!errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

function withoutErrors(
  errors: DiminishedValueFormErrors,
  fields: readonly DiminishedValueFormField[],
) {
  let next = errors;
  for (const field of fields) next = withoutError(next, field);
  return next;
}

function repairStatusLabel(status: DiminishedValueDraft["repairStatus"]) {
  return (
    REPAIR_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    "Repair status not provided"
  );
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    !year ||
    !month ||
    !day ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return value || "Date not provided";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

const vehicleYearOptions = Array.from(
  { length: maximumDiminishedValueVehicleYear() - 1981 + 1 },
  (_, index) => String(maximumDiminishedValueVehicleYear() - index),
);

const YES_NO_NOT_SURE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not-sure", label: "Not sure" },
] as const;

const CONTACT_METHOD_OPTIONS = [
  {
    value: "email",
    label: "Email",
    description: "Use the email address above.",
  },
  {
    value: "phone",
    label: "Phone call",
    description: "Call the phone number above.",
  },
] as const;

const REPAIR_STATUS_OPTIONS = [
  { value: "complete", label: "Repairs are complete" },
  { value: "in-progress", label: "Repairs are in progress" },
  { value: "not-started", label: "Repairs have not started" },
  { value: "not-sure", label: "I’m not sure" },
] as const;

const US_STATE_OPTIONS = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
].map(([value, label]) => ({ value, label }));

const fieldControlIds: Record<DiminishedValueFormField, string> = {
  accidentState: "diminished-value-state",
  accidentDate: "diminished-value-accident-date",
  repairStatus: "diminished-value-repair-status",
  vin: "diminished-value-vin",
  vehicleYear: "diminished-value-year",
  make: "diminished-value-make",
  model: "diminished-value-model",
  trim: "diminished-value-model",
  mileageAtAccident: "diminished-value-mileage-at-accident",
  currentMileage: "diminished-value-current-mileage",
  otherPartyAtFault: "diminished-value-other-party-at-fault",
  atFaultInsurer: "diminished-value-at-fault-insurer",
  repairCost: "diminished-value-repair-cost",
  repairFacility: "diminished-value-repair-facility",
  structuralDamage: "diminished-value-structural-damage",
  airbagDeployment: "diminished-value-airbag-deployment",
  majorRepairDetails: "diminished-value-major-repair-details",
  fullName: "diminished-value-full-name",
  email: "diminished-value-email",
  phone: "diminished-value-phone",
  preferredContactMethod: "diminished-value-preferred-contact",
  availability: "diminished-value-availability",
  notes: "diminished-value-notes",
};

export type { DiminishedValueIntakeFlowProps };
