import {
  AlertCircle,
  CarFront,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  ScanLine,
} from "lucide-react";

import {
  IntakeSelectField,
  IntakeTextField,
} from "@/features/total-loss/intake-fields";
import {
  OTHER_VEHICLE_TRIM_OPTION,
  uniquelyMatchingVehicleTrimOption,
  type VehicleConfigurationIdentity,
  type VehicleTrimOption,
} from "@/features/intake/vehicle-lookup-types";
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
  trimOptions?: readonly VehicleTrimOption[];
  vehicleConfiguration?: VehicleConfigurationIdentity | null;
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
  onTrimSelectionChange?: (option: VehicleTrimOption) => void;
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
  vehicleConfiguration = null,
  makesState,
  modelsState,
  trimsState = "idle",
  vinLookupState,
  vinLookupMessage,
  fieldsDisabled,
  methodDisabled = fieldsDisabled,
  mileageFields = [],
  vinHelp =
    "VINs are exactly 17 characters and never include I, O, or Q. We’ll use NHTSA vehicle data to identify yours.",
  trimRequired = false,
  onEntryMethodChange,
  onChange,
  onBlur,
  onRetryMakes,
  onRetryModels,
  onRetryTrims = () => undefined,
  onTrimSelectionChange,
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
            <VinEntryField
              id={`${idPrefix}-vin`}
              value={values.vin}
              error={errors.vin}
              help={vinHelp}
              lookupState={vinLookupState}
              lookupMessage={vinLookupMessage}
              vehicleIdentity={
                values.vehicleYear && values.make && values.model
                  ? vehicleIdentitySummary(values)
                  : null
              }
              disabled={fieldsDisabled || vinLookupState === "loading"}
              onChange={(value) => onChange("vin", value.toUpperCase())}
              onBlur={() => onBlur?.("vin")}
            />
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
                    configuration={vehicleConfiguration}
                    state={trimsState}
                    disabled={fieldsDisabled}
                    onChange={(value) => onChange("trim", value)}
                    onBlur={() => onBlur?.("trim")}
                    onRetry={onRetryTrims}
                    onTrimSelectionChange={onTrimSelectionChange}
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
                trimRequired
                  ? "grid-cols-1 sm:grid-cols-2"
                  : "grid-cols-1",
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
                  configuration={vehicleConfiguration}
                  state={trimsState}
                  disabled={fieldsDisabled}
                  onChange={(value) => onChange("trim", value)}
                  onBlur={() => onBlur?.("trim")}
                  onRetry={onRetryTrims}
                  onTrimSelectionChange={onTrimSelectionChange}
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

function VinEntryField({
  id,
  value,
  error,
  help,
  lookupState,
  lookupMessage,
  vehicleIdentity,
  disabled,
  onChange,
  onBlur,
}: {
  id: string;
  value: string;
  error?: string;
  help: string;
  lookupState: VehicleLookupState;
  lookupMessage?: string | null;
  vehicleIdentity: string | null;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const characterCount = Array.from(value).length;
  const lookupError = lookupState === "error" ? lookupMessage : null;
  const errorMessage = lookupError ?? error;
  const confirmed = Boolean(vehicleIdentity);
  const visualState = errorMessage
    ? "error"
    : lookupState === "loading"
      ? "loading"
      : confirmed
        ? "success"
        : "idle";
  const helpId = `${id}-help`;
  const statusId =
    visualState === "idle" ? undefined : `${id}-${visualState}-status`;
  const describedBy = [helpId, statusId].filter(Boolean).join(" ");

  return (
    <div data-vin-entry-state={visualState}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor={id}
            className="text-base font-semibold tracking-[-0.01em] text-ink"
          >
            Enter your 17-character VIN
          </label>
          <p id={helpId} className="mt-1 max-w-xl text-xs leading-5 text-copy">
            {help}
          </p>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 font-mono text-xs font-semibold tabular-nums transition-colors motion-reduce:transition-none",
            visualState === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : visualState === "success"
                ? "border-market/25 bg-market-soft text-market-strong"
                : characterCount === 17 || visualState === "loading"
                  ? "border-brand/20 bg-brand-soft text-brand"
                  : "border-line bg-surface text-copy",
          )}
          aria-live="polite"
          data-vin-character-count
        >
          <span aria-hidden>
            {characterCount}<span className="px-0.5 opacity-50">/</span>17
          </span>
          <span className="sr-only">
            {characterCount} of 17 characters entered
          </span>
        </span>
      </div>

      <div className="relative mt-3">
        <ScanLine
          className={cn(
            "pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 transition-colors motion-reduce:transition-none",
            visualState === "error"
              ? "text-red-600"
              : visualState === "success"
                ? "text-market-strong"
                : "text-brand",
          )}
          aria-hidden
        />
        <input
          id={id}
          name={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={value}
          maxLength={17}
          placeholder="1HGCM82633A004352"
          disabled={disabled}
          aria-label="VIN"
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-h-14 w-full rounded-xl border bg-white py-3 pl-12 pr-4 font-mono text-base font-semibold uppercase tracking-[0.09em] text-ink shadow-[0_12px_30px_-24px_rgba(11,31,51,0.5)] transition-[border-color,box-shadow,background-color] placeholder:font-normal placeholder:tracking-[0.04em] placeholder:text-copy/40 hover:border-line-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10 disabled:cursor-wait motion-reduce:transition-none sm:text-lg sm:tracking-[0.12em]",
            visualState === "loading" &&
              "border-brand/45 bg-brand-soft/25 pr-12",
            visualState === "success" &&
              "border-market/45 bg-market-soft/25",
            visualState === "error" &&
              "border-red-400 bg-red-50/35 focus-visible:border-red-500 focus-visible:ring-red-500/10",
          )}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        {lookupState === "loading" ? (
          <LoaderCircle
            className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-brand motion-reduce:animate-none"
            aria-hidden
          />
        ) : visualState === "success" ? (
          <CheckCircle2
            className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-market-strong"
            aria-hidden
          />
        ) : null}
      </div>

      {visualState === "loading" ? (
        <div
          id={statusId}
          className="mt-3 flex items-start gap-3 rounded-lg border border-brand/15 bg-brand-soft/55 px-3.5 py-3"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle
            className="mt-0.5 size-4 shrink-0 animate-spin text-brand motion-reduce:animate-none"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-ink">Checking your VIN…</p>
            <p className="mt-0.5 text-xs leading-5 text-copy">
              Matching the year, make, and model.
            </p>
          </div>
        </div>
      ) : visualState === "success" && vehicleIdentity ? (
        <div
          id={statusId}
          className="mt-3 flex items-start gap-3 rounded-lg border border-market/20 bg-market-soft px-3.5 py-3"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2
            className="mt-0.5 size-4 shrink-0 text-market-strong"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-market-strong">
              VIN confirmed
            </p>
            <p className="mt-0.5 text-sm leading-5 text-ink">
              {lookupState === "success" ? "Vehicle found:" : "Vehicle:"}{" "}
              {vehicleIdentity}
            </p>
          </div>
        </div>
      ) : visualState === "error" && errorMessage ? (
        <div
          id={statusId}
          className="mt-3 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-red-700"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {lookupError ? "We couldn’t match this VIN" : "Check your VIN"}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-red-700">
              {errorMessage}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VehicleTrimSelect({
  className,
  id,
  values,
  error,
  options,
  configuration,
  state,
  disabled,
  onChange,
  onBlur,
  onRetry,
  onTrimSelectionChange,
}: {
  className?: string;
  id: string;
  values: VehicleIdentificationValues;
  error?: string;
  options: readonly VehicleTrimOption[];
  configuration: VehicleConfigurationIdentity | null;
  state: VehicleLookupState;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onRetry: () => void;
  onTrimSelectionChange?: (option: VehicleTrimOption) => void;
}) {
  const vehicleKnown = Boolean(
    values.vehicleYear && values.make && values.model,
  );
  const currentTrim = values.trim ?? "";
  const selectedOption = uniquelyMatchingVehicleTrimOption(
    options,
    currentTrim,
    configuration,
  );
  const legacyValue =
    currentTrim && !selectedOption
      ? availableLegacyTrimValue(options)
      : null;
  const selectOptions = [
    ...(legacyValue
      ? [
          {
            value: legacyValue,
            label: legacyTrimLabel(options, currentTrim),
          },
        ]
      : []),
    ...options.map((option) => ({ value: option.id, label: option.label })),
  ];
  const hasExactOptions = options.some(
    (option) => option.id !== OTHER_VEHICLE_TRIM_OPTION.id,
  );
  return (
    <div className={className}>
      <IntakeSelectField
        id={id}
        label="Trim"
        value={selectedOption?.id ?? legacyValue ?? ""}
        error={error}
        placeholder={
          vehicleKnown
            ? "Select trim"
            : "Choose year, make, and model first"
        }
        options={selectOptions}
        loading={state === "loading"}
        disabled={disabled || !vehicleKnown}
        onChange={(event) => {
          if (!event.target.value) {
            onChange("");
            return;
          }
          const option = options.find(
            (candidate) => candidate.id === event.target.value,
          );
          if (!option) return;
          if (onTrimSelectionChange) {
            onTrimSelectionChange(option);
          } else {
            onChange(option.trim);
          }
        }}
        onBlur={onBlur}
      />
      {state === "error" ? (
        <p className="mt-2 text-sm text-copy" role="status">
          We couldn’t load exact trim options. Choose Other / Not sure, or{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            onClick={onRetry}
          >
            try again
          </button>
          .
        </p>
      ) : null}
      {state === "success" && !hasExactOptions ? (
        <p className="mt-2 text-sm text-copy" role="status">
          No exact trim options were found for this vehicle. Choose Other / Not
          sure, check the year, make, and model, or{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            onClick={onRetry}
          >
            try again
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}

function legacyTrimLabel(
  options: readonly VehicleTrimOption[],
  current: string,
) {
  const currentKey = legacyTrimKey(current);
  return options.some((option) => legacyTrimKey(option.label) === currentKey)
    ? `Current selection: ${current}`
    : current;
}

function availableLegacyTrimValue(options: readonly VehicleTrimOption[]) {
  let value = "__legacy-current-trim__";
  const ids = new Set(options.map((option) => option.id));
  while (ids.has(value)) value = `_${value}`;
  return value;
}

function legacyTrimKey(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleUpperCase("en-US");
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
