import {
  CarFront,
  CheckCircle2,
  RefreshCw,
  ScanLine,
} from "lucide-react";

import {
  IntakeSelectField,
  IntakeTextField,
} from "@/features/total-loss/intake-fields";
import { cn } from "@/lib/utils";

export type VehicleEntryMethod = "vin" | "details";
export type VehicleLookupState = "idle" | "loading" | "success" | "error";

export interface VehicleIdentificationValues {
  readonly vin: string;
  readonly vehicleYear: string;
  readonly make: string;
  readonly model: string;
  readonly trim?: string;
}

export interface VehicleIdentificationErrors {
  readonly vin?: string;
  readonly vehicleYear?: string;
  readonly make?: string;
  readonly model?: string;
  readonly trim?: string;
}

export type VehicleIdentificationField = keyof VehicleIdentificationValues;

export interface VehicleMileageField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error?: string;
  readonly help?: string;
  readonly optional?: boolean;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
}

export interface VehicleIdentificationFieldsProps {
  idPrefix: string;
  namePrefix?: string;
  entryMethod: VehicleEntryMethod;
  values: VehicleIdentificationValues;
  errors?: VehicleIdentificationErrors;
  yearOptions: readonly string[];
  makeOptions: readonly string[];
  modelOptions: readonly string[];
  trimOptions?: readonly string[];
  makesState: VehicleLookupState;
  modelsState: VehicleLookupState;
  trimsState?: VehicleLookupState;
  vinLookupState: VehicleLookupState;
  vinLookupMessage?: string | null;
  fieldsDisabled?: boolean;
  methodDisabled?: boolean;
  mileageFields?: readonly VehicleMileageField[];
  vinHelp?: string;
  trimRequired?: boolean;
  onEntryMethodChange: (method: VehicleEntryMethod) => void;
  onChange: (field: VehicleIdentificationField, value: string) => void;
  onBlur?: (field: VehicleIdentificationField) => void;
  onRetryMakes: () => void;
  onRetryModels: () => void;
  onRetryTrims?: () => void;
}

export function VehicleIdentificationFields({
  idPrefix,
  namePrefix = idPrefix,
  entryMethod,
  values,
  errors = {},
  yearOptions,
  makeOptions,
  modelOptions,
  trimOptions = [],
  makesState,
  modelsState,
  trimsState = "idle",
  vinLookupState,
  vinLookupMessage,
  fieldsDisabled,
  methodDisabled = fieldsDisabled,
  mileageFields = [],
  vinHelp =
    "Enter the 17-character VIN. We’ll use NHTSA vehicle data to identify it.",
  trimRequired = false,
  onEntryMethodChange,
  onChange,
  onBlur,
  onRetryMakes,
  onRetryModels,
  onRetryTrims = () => undefined,
}: VehicleIdentificationFieldsProps) {
  return (
    <>
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-ink">
          How would you like to identify your vehicle?
        </legend>
        <div
          className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-surface p-1.5"
          data-stable-selection-group
          data-vehicle-method-switch
        >
          {(
            [
              ["vin", "Use my VIN", ScanLine],
              ["details", "Select vehicle details", CarFront],
            ] as const
          ).map(([method, label, Icon]) => (
            <label
              key={method}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 text-center text-sm font-semibold transition-[background-color,border-color,box-shadow,color,transform] duration-300 ease-out focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-1 active:scale-[0.99] motion-reduce:transition-none sm:px-3",
                entryMethod === method
                  ? "border-transparent bg-white text-brand shadow-[0_8px_22px_-18px_rgba(21,94,239,0.9)]"
                  : "border-transparent text-copy hover:border-line hover:bg-white/60 hover:text-ink",
                methodDisabled && "cursor-not-allowed opacity-65",
              )}
            >
              <input
                className="sr-only"
                type="radio"
                name={`${namePrefix}-vehicle-entry-method`}
                value={method}
                checked={entryMethod === method}
                disabled={methodDisabled}
                onChange={() => onEntryMethodChange(method)}
              />
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div
        className="vehicle-method-panel mt-5"
        data-vehicle-method-panel={entryMethod}
      >
        {entryMethod === "vin" ? (
          <div>
            <IntakeTextField
              id={`${idPrefix}-vin`}
              label="VIN"
              value={values.vin}
              error={errors.vin}
              help={vinHelp}
              autoComplete="off"
              maxLength={17}
              disabled={fieldsDisabled || vinLookupState === "loading"}
              onChange={(event) =>
                onChange("vin", event.target.value.toUpperCase())
              }
              onBlur={() => onBlur?.("vin")}
            />
            {vinLookupState === "success" &&
            values.vehicleYear &&
            values.make &&
            values.model ? (
              <VehicleLookupSuccess
                message={`Vehicle found: ${vehicleIdentitySummary(values)}`}
              />
            ) : values.vehicleYear && values.make && values.model ? (
              <VehicleLookupSuccess
                message={`Vehicle: ${vehicleIdentitySummary(values)}`}
              />
            ) : null}
            {vinLookupState === "error" && vinLookupMessage ? (
              <p className="mt-2 text-sm leading-5 text-red-700" role="alert">
                {vinLookupMessage}
              </p>
            ) : null}
            {trimRequired && values.vehicleYear && values.make && values.model ? (
              <section
                className="mt-5 rounded-xl border border-line bg-surface/55 p-4 sm:p-5"
                aria-labelledby={`${idPrefix}-confirmed-vehicle-heading`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3
                      id={`${idPrefix}-confirmed-vehicle-heading`}
                      className="text-sm font-semibold text-ink"
                    >
                      Confirmed vehicle details
                    </h3>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-copy">
                      NHTSA identified the year, make, and model from this VIN.
                      Choose the exact trim to continue.
                    </p>
                  </div>
                  <span className="inline-flex min-h-7 items-center rounded-full border border-market/20 bg-market-soft px-2.5 text-xs font-semibold text-market-strong">
                    VIN confirmed
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line bg-white shadow-sm">
                  {[
                    ["Year", values.vehicleYear],
                    ["Make", values.make],
                    ["Model", values.model],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 px-3 py-3 sm:px-4">
                      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-copy">
                        {label}
                      </dt>
                      <dd className="mt-1 break-words text-sm font-semibold text-ink">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 border-t border-line pt-5">
                  <VehicleTrimSelect
                    id={`${idPrefix}-trim`}
                    values={values}
                    error={errors.trim}
                    options={trimOptions}
                    state={trimsState}
                    disabled={fieldsDisabled}
                    onChange={(value) => onChange("trim", value)}
                    onBlur={() => onBlur?.("trim")}
                    onRetry={onRetryTrims}
                  />
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <IntakeSelectField
              id={`${idPrefix}-year`}
              label="Year"
              value={values.vehicleYear}
              error={errors.vehicleYear}
              placeholder="Select year"
              options={withCurrentOption(yearOptions, values.vehicleYear)}
              disabled={fieldsDisabled}
              onChange={(event) =>
                onChange("vehicleYear", event.target.value)
              }
              onBlur={() => onBlur?.("vehicleYear")}
            />
            <div>
              <IntakeSelectField
                id={`${idPrefix}-make`}
                label="Make"
                value={values.make}
                error={errors.make}
                placeholder="Select make"
                options={withCurrentOption(makeOptions, values.make)}
                loading={makesState === "loading"}
                disabled={fieldsDisabled || makesState === "error"}
                onChange={(event) => onChange("make", event.target.value)}
                onBlur={() => onBlur?.("make")}
              />
              {makesState === "error" ? (
                <OptionLoadError label="makes" onRetry={onRetryMakes} />
              ) : null}
            </div>
            <div
              className={cn(
                "grid gap-5 sm:col-span-2",
                trimRequired ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              <div>
                <IntakeSelectField
                  id={`${idPrefix}-model`}
                  label="Model"
                  value={values.model}
                  error={errors.model}
                  placeholder={
                    values.vehicleYear && values.make
                      ? "Select model"
                      : "Choose year and make first"
                  }
                  options={withCurrentOption(modelOptions, values.model)}
                  loading={modelsState === "loading"}
                  disabled={
                    fieldsDisabled ||
                    !values.vehicleYear ||
                    !values.make ||
                    modelsState === "error"
                  }
                  onChange={(event) => onChange("model", event.target.value)}
                  onBlur={() => onBlur?.("model")}
                />
                {modelsState === "error" ? (
                  <OptionLoadError label="models" onRetry={onRetryModels} />
                ) : null}
              </div>
              {trimRequired ? (
                <VehicleTrimSelect
                  id={`${idPrefix}-trim`}
                  values={values}
                  error={errors.trim}
                  options={trimOptions}
                  state={trimsState}
                  disabled={fieldsDisabled}
                  onChange={(value) => onChange("trim", value)}
                  onBlur={() => onBlur?.("trim")}
                  onRetry={onRetryTrims}
                />
              ) : null}
            </div>
          </div>
        )}

        {mileageFields.length > 0 ? (
          <div
            className={cn(
              "mt-5 grid gap-5",
              mileageFields.length > 1 && "sm:grid-cols-2",
            )}
          >
            {mileageFields.map((field) => (
              <IntakeTextField
                key={field.id}
                id={field.id}
                label={field.label}
                value={field.value}
                error={field.error}
                help={field.help}
                optional={field.optional}
                inputMode="numeric"
                autoComplete="off"
                placeholder={field.placeholder ?? "48,250"}
                disabled={fieldsDisabled || field.disabled}
                onChange={(event) => field.onChange(event.target.value)}
                onBlur={field.onBlur}
              />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function VehicleTrimSelect({
  className,
  id,
  values,
  error,
  options,
  state,
  disabled,
  onChange,
  onBlur,
  onRetry,
}: {
  className?: string;
  id: string;
  values: VehicleIdentificationValues;
  error?: string;
  options: readonly string[];
  state: VehicleLookupState;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onRetry: () => void;
}) {
  const vehicleKnown = Boolean(
    values.vehicleYear && values.make && values.model,
  );
  return (
    <div className={className}>
      <IntakeSelectField
        id={id}
        label="Trim"
        value={values.trim ?? ""}
        error={error}
        placeholder={
          vehicleKnown
            ? "Select trim"
            : "Choose year, make, and model first"
        }
        options={withCurrentOption(options, values.trim ?? "")}
        loading={state === "loading"}
        disabled={disabled || !vehicleKnown || state === "error"}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {state === "error" ? (
        <OptionLoadError label="trims" onRetry={onRetry} />
      ) : null}
      {state === "success" && options.length === 0 && !values.trim ? (
        <p className="mt-2 text-sm text-copy" role="status">
          No trim options were found for this vehicle. Check the year, make,
          and model or use the VIN option.
        </p>
      ) : null}
    </div>
  );
}

function VehicleLookupSuccess({ message }: { message: string }) {
  return (
    <div
      className="mt-3 flex items-center gap-2 rounded-lg bg-market-soft px-3 py-2 text-sm font-semibold text-market-strong"
      role="status"
    >
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      {message}
    </div>
  );
}

function OptionLoadError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <p className="mt-2 text-sm text-red-700" role="alert">
      We couldn’t load {label}.{" "}
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        onClick={onRetry}
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Try again
      </button>
    </p>
  );
}

function vehicleIdentitySummary(values: VehicleIdentificationValues) {
  return [values.vehicleYear, values.make, values.model]
    .filter(Boolean)
    .join(" ");
}

function withCurrentOption(options: readonly string[], current: string) {
  return current && !options.includes(current)
    ? [current, ...options]
    : options;
}
