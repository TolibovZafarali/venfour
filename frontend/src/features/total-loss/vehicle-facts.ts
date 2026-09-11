import type { TotalLossManualFormErrors, TotalLossManualFormValues } from "./types";
import type { VehicleConfigurationIdentity } from "@/features/intake/vehicle-lookup-types";

export const VEHICLE_FACT_LABELS = {
  bodyType: "Body style", drivetrain: "Drive type", engine: "Engine",
  fuelType: "Fuel type", transmission: "Transmission", powertrain: "Powertrain",
  cabType: "Cab style", bedLength: "Bed length", doors: "Number of doors",
  cylinders: "Number of cylinders", bodySubtype: "Body configuration",
} as const;
export type VehicleFactField = keyof typeof VEHICLE_FACT_LABELS;
export type SubjectVehicleFacts = Partial<Record<VehicleFactField, string>>;
export const VEHICLE_FACT_FIELDS = Object.keys(VEHICLE_FACT_LABELS) as VehicleFactField[];
const UNKNOWN = new Set(["unknown", "not sure", "other/not sure", "other / not sure", "other", "n/a", "none", "-"]);
const known = (value: string | undefined) => Boolean(value?.trim() && !UNKNOWN.has(value.trim().toLowerCase()));

export function vehicleFacts(value: unknown): SubjectVehicleFacts | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("The saved vehicle details are invalid.");
  const result: SubjectVehicleFacts = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!VEHICLE_FACT_FIELDS.includes(field as VehicleFactField) || typeof raw !== "string" || !raw.trim() || raw.length > 200) {
      throw new Error("The saved vehicle details are invalid.");
    }
    result[field as VehicleFactField] = raw;
  }
  return result;
}

export function factsFromForm(values: TotalLossManualFormValues): SubjectVehicleFacts | null {
  const facts = Object.fromEntries(VEHICLE_FACT_FIELDS.flatMap(field => {
    const value = values[field]?.trim().replace(/\s+/gu, " ");
    return value ? [[field, value]] : [];
  }));
  return Object.keys(facts).length ? facts : null;
}

export function sameVehicleFacts(left: SubjectVehicleFacts | null | undefined, right: SubjectVehicleFacts | null | undefined) {
  return VEHICLE_FACT_FIELDS.every(field => (left?.[field] ?? "") === (right?.[field] ?? ""));
}

export function clearVehicleFacts<T extends TotalLossManualFormValues>(values: T): T {
  const result = { ...values };
  for (const field of VEHICLE_FACT_FIELDS) delete result[field];
  return result;
}

export function fillConfigurationFacts<T extends TotalLossManualFormValues>(values: T, configuration?: VehicleConfigurationIdentity | null): T {
  if (values.drivetrain || configuration?.source !== "marketcheck" || configuration.field !== "version" || !configuration.values.length) return values;
  const drives = configuration.values.map(value => {
    const text = value.toLowerCase().replace(/[^a-z0-9]+/gu, " ");
    const matches = [
      [/\b(?:awd|all (?:wheel|whel|whl) (?:drive|drv))\b/u, "AWD"],
      [/\b(?:fwd|front wheel drive)\b/u, "FWD"],
      [/\b(?:rwd|rear wheel drive)\b/u, "RWD"],
      [/\b(?:4wd|4x4|(?:four|4) wheel drive|four by four|4 by 4)\b/u, "4WD"],
    ] as const;
    const found = matches.filter(([pattern]) => pattern.test(text));
    return found.length === 1 ? found[0][1] : null;
  });
  return drives[0] && drives.every(drive => drive === drives[0]) ? { ...values, drivetrain: drives[0] } : values;
}

export function vehicleFactErrors(values: TotalLossManualFormValues): TotalLossManualFormErrors {
  const errors: TotalLossManualFormErrors = {};
  for (const field of VEHICLE_FACT_FIELDS) {
    if (values[field] && (!known(values[field]) || values[field]!.length > 200)) errors[field] = `Check ${VEHICLE_FACT_LABELS[field].toLowerCase()}.`;
  }
  if (values.drivetrain && !["FWD", "RWD", "AWD", "4WD"].includes(values.drivetrain)) errors.drivetrain = "Choose the drive type.";
  if (UNKNOWN.has(values.trim.trim().toLowerCase())) errors.trim = "Confirm the trim or version shown on your vehicle documents.";
  return errors;
}
