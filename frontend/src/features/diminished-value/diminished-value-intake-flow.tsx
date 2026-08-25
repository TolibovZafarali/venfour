import { CheckCircle2, PencilLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
  StepActions,
  StepHeading,
  type VehicleLookupService,
  type VehicleLookupState,
  type VehicleTrimOption,
  VehicleIdentificationFields,
  uniquelyMatchingVehicleTrimOption,
  useVehicleLookupController,
} from "@/features/intake";
import { createNhtsaVpicVehicleLookupService } from "@/features/total-loss/nhtsa-vpic-vehicle-lookup";

import {
  LocalDocumentPicker,
  type DiminishedValuePendingDocumentState,
} from "./local-document-picker";
import type { DiminishedValueStoredDocument } from "./storage-service";
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
  validateDiminishedValueStart,
  validateDiminishedValueSubmission,
  validateDiminishedValueVehicle,
} from "./validation";

export interface DiminishedValueIntakeFlowProps {
  readonly status?: ReactNode;
  readonly draft: DiminishedValueDraft;
  readonly onDraftChange: (draft: DiminishedValueDraft) => void;
  readonly selectedFiles: readonly File[];
  readonly onSelectedFilesChange: (files: File[]) => void;
  readonly onSubmit: () => void;
  readonly submitting?: boolean;
  readonly submissionError?: string | null;
  readonly submittedAt?: string | null;
  readonly submittedFileCount?: number;
  readonly storedDocuments?: readonly DiminishedValueStoredDocument[];
  readonly pendingDocumentStates?: readonly DiminishedValuePendingDocumentState[];
  readonly documentsRequireAuthentication?: boolean;
  readonly onDocumentAuthenticationRequired?: () => void;
  readonly onRetryDocumentUploads?: () => void;
  readonly onRemoveStoredDocument?: (
    document: DiminishedValueStoredDocument,
  ) => void;
  readonly removingDocumentId?: string | null;
  readonly documentsDisabled?: boolean;
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
  status,
  draft,
  onDraftChange,
  selectedFiles,
  onSelectedFilesChange,
  onSubmit,
  submitting = false,
  submissionError = null,
  submittedAt = null,
  submittedFileCount = 0,
  storedDocuments = [],
  pendingDocumentStates = [],
  documentsRequireAuthentication = false,
  onDocumentAuthenticationRequired,
  onRetryDocumentUploads,
  onRemoveStoredDocument,
  removingDocumentId = null,
  documentsDisabled = false,
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
    trimOptions,
    makesState,
    modelsState,
    trimsState,
    vinLookupState,
    vinLookupMessage,
    decodeVin,
    resetVinLookup,
    resetModelLookup,
    retryMakes,
    retryModels,
    retryTrims,
  } = useVehicleLookupController({
    service: vehicleLookupService,
    catalogEnabled: draft.vehicleEntryMethod === "details",
    trimCatalogEnabled: draft.step === "vehicle",
    vehicleYear: draft.vehicleYear,
    make: draft.make,
    model: draft.model,
    currentVin: normalizeDiminishedValueVin(draft.vin),
    unknownVinErrorMessage:
      "Vehicle lookup is temporarily unavailable. Try again.",
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
      const dependentFields: DiminishedValueFormField[] =
        field === "vin"
          ? ["vin", "vehicleYear", "make", "model", "trim"]
          : field === "vehicleYear" || field === "make"
            ? [field, "model", "trim"]
            : field === "model"
              ? [field, "trim"]
              : [field];
      setErrors((current) => withoutErrors(current, dependentFields));
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
        withoutErrors(current, [
          "vin",
          "vehicleYear",
          "make",
          "model",
          "trim",
        ]),
      );
      setFlowError(null);
      resetVinLookup();
      dispatch({ type: "vehicle-method-changed", method });
    },
    [dispatch, resetVinLookup],
  );

  const selectTrim = useCallback(
    (option: VehicleTrimOption) => {
      setErrors((current) => withoutError(current, "trim"));
      setFlowError(null);
      dispatch({ type: "trim-selected", option });
    },
    [dispatch],
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
    const vehicleResolved = Boolean(
      draft.vehicleYear.trim() && draft.make.trim() && draft.model.trim(),
    );
    if (vehicleResolved && trimsState === "loading") {
      setFlowError("Wait while we load the exact trim options.");
      return;
    }
    const selectedTrim = uniquelyMatchingVehicleTrimOption(
      trimOptions,
      draft.trim,
      draft.vehicleConfiguration,
    );
    const configuredDraft = selectedTrim
      ? diminishedValueDraftReducer(draft, {
          type: "trim-selected",
          option: selectedTrim,
        })
      : { ...draft, vehicleConfiguration: null };
    const nextErrors = validateDiminishedValueVehicle(configuredDraft);
    if (vehicleResolved && trimOptions.length > 0 && !selectedTrim) {
      nextErrors.trim = "Choose the exact vehicle configuration from the list.";
    }
    if (showValidationErrors(nextErrors, setErrors, setFlowError)) return;

    if (draft.vehicleEntryMethod === "vin" && !vehicleResolved) {
      setFlowError(null);
      const vehicle = await decodeVin(normalizeDiminishedValueVin(draft.vin));
      if (!vehicle) return;
      onDraftChange(
        diminishedValueDraftReducer(draft, {
          type: "vehicle-decoded",
          vehicle,
        }),
      );
      setFlowError(null);
      return;
    }

    setTransitionDirection("forward");
    onDraftChange(
      diminishedValueDraftReducer(configuredDraft, {
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
    const nextErrors = validateDiminishedValueSubmission(draft);
    if (hasDiminishedValueErrors(nextErrors)) {
      const errorStep = stepForDiminishedValueErrors(nextErrors);
      if (errorStep !== draft.step) {
        setTransitionDirection(
          stepPositions[errorStep] < stepPositions[draft.step]
            ? "backward"
            : "forward",
        );
        dispatch({ type: "step-changed", step: errorStep });
      }
      setErrors(nextErrors);
      setFlowError("Review the highlighted fields before continuing.");
      window.requestAnimationFrame(() => focusFirstError(nextErrors));
      return;
    }
    setErrors({});
    setFlowError(null);
    onSubmit();
  };

  const renderedStep = (() => {
    switch (draft.step) {
      case "start":
        return (
          <DiminishedValueStartStep
            status={status}
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
            status={status}
            draft={draft}
            errors={errors}
            makeOptions={makeOptions}
            modelOptions={modelOptions}
            trimOptions={trimOptions}
            makesState={makesState}
            modelsState={modelsState}
            trimsState={trimsState}
            vinLookupState={vinLookupState}
            vinLookupMessage={vinLookupMessage}
            flowError={flowError}
            onChange={changeField}
            onMethodChange={changeVehicleMethod}
            onRetryMakes={retryMakes}
            onRetryModels={retryModels}
            onRetryTrims={retryTrims}
            onTrimSelectionChange={selectTrim}
            onUseDetails={() => changeVehicleMethod("details")}
            onBack={() => goToStep("start", false)}
            onContinue={() => void validateAndContinueVehicle()}
          />
        );
      case "accident-repairs":
        return (
          <DiminishedValueRepairsStep
            status={status}
            draft={draft}
            errors={errors}
            files={selectedFiles}
            flowError={flowError}
            onChange={changeField}
            onFilesChange={onSelectedFilesChange}
            storedDocuments={storedDocuments}
            pendingDocumentStates={pendingDocumentStates}
            documentsRequireAuthentication={documentsRequireAuthentication}
            onDocumentAuthenticationRequired={onDocumentAuthenticationRequired}
            onRetryDocumentUploads={onRetryDocumentUploads}
            onRemoveStoredDocument={onRemoveStoredDocument}
            removingDocumentId={removingDocumentId}
            documentsDisabled={documentsDisabled || submitting}
            onEditStart={() => goToStep("start", true)}
            onBack={() => goToStep("vehicle")}
            onContinue={validateAndContinueRepairs}
          />
        );
      case "consultation":
        return (
          <DiminishedValueConsultationStep
            status={status}
            draft={draft}
            errors={errors}
            flowError={submissionError ?? flowError}
            onChange={changeField}
            onBack={() => goToStep("accident-repairs")}
            onContinue={prepareReviewRequest}
            busy={submitting}
          />
        );
      case "complete":
        return (
          <DiminishedValueCompleteStep
            fileCount={submittedFileCount}
            submittedAt={submittedAt}
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
        {draft.step === "complete" ? (
          renderedStep
        ) : (
          <fieldset
            className="m-0 min-w-0 border-0 p-0"
            disabled={submitting}
            aria-busy={submitting || undefined}
            aria-label="Diminished value intake"
          >
            {renderedStep}
          </fieldset>
        )}
      </IntakeStepTransition>
    </div>
  );
}

interface SharedStepProps {
  readonly status?: ReactNode;
  readonly draft: DiminishedValueDraft;
  readonly errors: DiminishedValueFormErrors;
  readonly flowError: string | null;
  readonly onChange: (field: DiminishedValueFormField, value: string) => void;
}

interface StartStepProps extends SharedStepProps {
  readonly onContinue: () => void;
}

export function DiminishedValueStartStep({
  status,
  draft,
  errors,
  flowError,
  onChange,
  onContinue,
}: StartStepProps) {
  return (
    <FlowCard>
      <DiminishedValueProgress current={1} status={status} />
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
              You can still submit a request while repairs are unfinished or
              their status is unclear. Submission does not mean a review has
              begun.
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
  readonly trimOptions: readonly VehicleTrimOption[];
  readonly makesState: VehicleLookupState;
  readonly modelsState: VehicleLookupState;
  readonly trimsState: VehicleLookupState;
  readonly vinLookupState: VehicleLookupState;
  readonly vinLookupMessage: string | null;
  readonly onMethodChange: (method: DiminishedValueVehicleEntryMethod) => void;
  readonly onRetryMakes: () => void;
  readonly onRetryModels: () => void;
  readonly onRetryTrims: () => void;
  readonly onTrimSelectionChange: (option: VehicleTrimOption) => void;
  readonly onUseDetails: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function DiminishedValueVehicleStep({
  status,
  draft,
  errors,
  makeOptions,
  modelOptions,
  trimOptions,
  makesState,
  modelsState,
  trimsState,
  vinLookupState,
  vinLookupMessage,
  flowError,
  onChange,
  onMethodChange,
  onRetryMakes,
  onRetryModels,
  onRetryTrims,
  onTrimSelectionChange,
  onUseDetails,
  onBack,
  onContinue,
}: VehicleStepProps) {
  return (
    <FlowCard busy={vinLookupState === "loading"}>
      <DiminishedValueProgress current={2} status={status} />
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
        trimOptions={trimOptions}
        vehicleConfiguration={draft.vehicleConfiguration}
        makesState={makesState}
        modelsState={modelsState}
        trimsState={trimsState}
        vinLookupState={vinLookupState}
        vinLookupMessage={vinLookupMessage}
        trimRequired
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
        onRetryTrims={onRetryTrims}
        onTrimSelectionChange={onTrimSelectionChange}
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
        busy={vinLookupState === "loading" || trimsState === "loading"}
        continueLabel={
          draft.vehicleEntryMethod === "vin" &&
          (!draft.vehicleYear || !draft.make || !draft.model)
            ? "Find vehicle"
            : "Continue"
        }
      />
    </FlowCard>
  );
}

interface RepairsStepProps extends SharedStepProps {
  readonly files: readonly File[];
  readonly onFilesChange: (files: File[]) => void;
  readonly storedDocuments: readonly DiminishedValueStoredDocument[];
  readonly pendingDocumentStates: readonly DiminishedValuePendingDocumentState[];
  readonly documentsRequireAuthentication: boolean;
  readonly onDocumentAuthenticationRequired?: () => void;
  readonly onRetryDocumentUploads?: () => void;
  readonly onRemoveStoredDocument?: (
    document: DiminishedValueStoredDocument,
  ) => void;
  readonly removingDocumentId: string | null;
  readonly documentsDisabled: boolean;
  readonly onEditStart: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

export function DiminishedValueRepairsStep({
  status,
  draft,
  errors,
  files,
  flowError,
  onChange,
  onFilesChange,
  storedDocuments,
  pendingDocumentStates,
  documentsRequireAuthentication,
  onDocumentAuthenticationRequired,
  onRetryDocumentUploads,
  onRemoveStoredDocument,
  removingDocumentId,
  documentsDisabled,
  onEditStart,
  onBack,
  onContinue,
}: RepairsStepProps) {
  return (
    <FlowCard>
      <DiminishedValueProgress current={3} status={status} />
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
            onChange={(event) => onChange("repairFacility", event.target.value)}
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
        <LocalDocumentPicker
          files={files}
          onFilesChange={onFilesChange}
          storedDocuments={storedDocuments}
          pendingStates={pendingDocumentStates}
          requiresAuthentication={documentsRequireAuthentication}
          onAuthenticationRequired={onDocumentAuthenticationRequired}
          onRetryUploads={onRetryDocumentUploads}
          onRemoveStoredDocument={onRemoveStoredDocument}
          removingDocumentId={removingDocumentId}
          disabled={documentsDisabled}
        />
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
  readonly busy: boolean;
}

export function DiminishedValueConsultationStep({
  status,
  draft,
  errors,
  flowError,
  onChange,
  onBack,
  onContinue,
  busy,
}: ConsultationStepProps) {
  return (
    <FlowCard busy={busy}>
      <DiminishedValueProgress current={4} status={status} />
      <StepHeading
        title="Prepare your review request"
        description="Add contact details and general availability for an authorized Venfour reviewer. Submission does not schedule an appointment or complete an appraisal."
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
        busy={busy}
      />
    </FlowCard>
  );
}

export function DiminishedValueCompleteStep({
  fileCount,
  submittedAt,
}: {
  readonly fileCount: number;
  readonly submittedAt: string | null;
}) {
  if (!submittedAt) {
    return (
      <FlowCard>
        <InlineError message="Venfour could not verify that this review request was submitted. Return to the previous step and try again." />
      </FlowCard>
    );
  }

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
          Venfour received your review request
        </h2>
        <p className="mt-3 text-base leading-7 text-copy">
          {fileCount > 0
            ? `Your answers and ${fileCount} supporting ${fileCount === 1 ? "document were" : "documents were"} securely submitted ${formatSubmissionTime(submittedAt)}.`
            : `Your answers were securely submitted ${formatSubmissionTime(submittedAt)}.`}
        </p>
        <div className="mx-auto mt-7 max-w-lg rounded-xl border border-line bg-surface p-5">
          <p className="text-sm font-semibold text-ink">Request received</p>
          <p className="mt-2 text-sm leading-6 text-copy">
            Venfour has securely received this information for future manual
            review. It is not an automated appraisal, no appraisal has been
            completed, and no appointment has been scheduled.
          </p>
        </div>
      </div>
    </FlowCard>
  );
}

function formatSubmissionTime(value: string) {
  const submittedAt = new Date(value);
  if (Number.isNaN(submittedAt.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(submittedAt);
}

function DiminishedValueProgress({
  current,
  status,
}: {
  readonly current: number;
  readonly status?: ReactNode;
}) {
  return (
    <>
      <IntakeProgress current={current} steps={progressSteps} />
      {status ? (
        <div className="mt-4" aria-live="polite">
          {status}
        </div>
      ) : null}
    </>
  );
}

function stepForDiminishedValueErrors(
  errors: DiminishedValueFormErrors,
): Exclude<DiminishedValueStep, "complete"> {
  if (errors.accidentState || errors.accidentDate || errors.repairStatus) {
    return "start";
  }
  if (
    errors.vin ||
    errors.vehicleYear ||
    errors.make ||
    errors.model ||
    errors.trim ||
    errors.mileageAtAccident ||
    errors.currentMileage
  ) {
    return "vehicle";
  }
  if (
    errors.otherPartyAtFault ||
    errors.repairCost ||
    errors.structuralDamage ||
    errors.airbagDeployment
  ) {
    return "accident-repairs";
  }
  return "consultation";
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
  trim: "diminished-value-trim",
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
