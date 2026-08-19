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
  makesState: VehicleLookupState;
  modelsState: VehicleLookupState;
  vinLookupState: VehicleLookupState;
  vinLookupMessage?: string | null;
  fieldsDisabled?: boolean;
  methodDisabled?: boolean;
  mileageFields?: readonly VehicleMileageField[];
  vinHelp?: string;
  onEntryMethodChange: (method: VehicleEntryMethod) => void;
  onChange: (field: VehicleIdentificationField, value: string) => void;
  onBlur?: (field: VehicleIdentificationField) => void;
  onRetryMakes: () => void;
  onRetryModels: () => void;
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
  makesState,
  modelsState,
  vinLookupState,
  vinLookupMessage,
  fieldsDisabled,
  methodDisabled = fieldsDisabled,
  mileageFields = [],
  vinHelp =
    "Enter the 17-character VIN. We’ll use NHTSA vehicle data to identify it.",
  onEntryMethodChange,
  onChange,
  onBlur,
  onRetryMakes,
  onRetryModels,
}: VehicleIdentificationFieldsProps) {
  return (
    <>
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-ink">
          How would you like to identify your vehicle?
        </legend>
        <div
          className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-surface p-1.5"
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
                  ? "border-brand/25 bg-white text-brand shadow-[0_8px_22px_-18px_rgba(21,94,239,0.9)]"
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
        key={entryMethod}
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
            {vinLookupState === "success" && vinLookupMessage ? (
              <VehicleLookupSuccess message={vinLookupMessage} />
            ) : values.vehicleYear && values.make && values.model ? (
              <VehicleLookupSuccess
                message={`Vehicle: ${vehicleSummary(values)}`}
              />
            ) : null}
            {vinLookupState === "error" && vinLookupMessage ? (
              <p className="mt-2 text-sm leading-5 text-red-700" role="alert">
                {vinLookupMessage}
              </p>
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
            <div className="sm:col-span-2">
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

function vehicleSummary(values: VehicleIdentificationValues) {
  return [values.vehicleYear, values.make, values.model, values.trim]
    .filter(Boolean)
    .join(" ");
}

function withCurrentOption(options: readonly string[], current: string) {
  return current && !options.includes(current)
    ? [current, ...options]
    : options;
}
