export interface DecodedVehicle {
  readonly vin: string;
  readonly year: number;
  readonly make: string;
  readonly model: string;
  readonly trim: string | null;
}

export interface ListVehicleModelsInput {
  readonly year: number;
  readonly make: string;
}

export interface ListVehicleTrimsInput extends ListVehicleModelsInput {
  readonly model: string;
}

export type VehicleTrimQueryField = "trim" | "version";

export interface VehicleConfigurationIdentity {
  readonly source: string;
  readonly field: VehicleTrimQueryField;
  readonly values: readonly string[];
}

export interface VehicleTrimOption {
  readonly source: string;
  readonly id: string;
  readonly label: string;
  readonly trim: string;
  readonly queryField: VehicleTrimQueryField;
  readonly queryValues: readonly string[];
}

export function vehicleConfigurationFromTrimOption(
  option: VehicleTrimOption,
): VehicleConfigurationIdentity {
  return {
    source: option.source,
    field: option.queryField,
    values: [...option.queryValues],
  };
}

export function vehicleConfigurationIdentity(
  value: unknown,
): VehicleConfigurationIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 3 ||
    typeof candidate.source !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,49}$/u.test(candidate.source) ||
    (candidate.field !== "trim" && candidate.field !== "version") ||
    !Array.isArray(candidate.values) ||
    candidate.values.length < 1 ||
    candidate.values.length > 20
  ) {
    return null;
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of candidate.values) {
    if (typeof rawValue !== "string") return null;
    const normalized = rawValue.trim().replace(/\s+/gu, " ");
    const key = normalized.toLocaleLowerCase("en-US");
    if (
      normalized !== rawValue ||
      normalized.length < 1 ||
      normalized.length > 200 ||
      normalized.includes(",") ||
      Array.from(normalized).some((character) => {
        const codePoint = character.codePointAt(0)!;
        return (
          codePoint <= 31 ||
          codePoint === 127 ||
          codePoint === 0x061c ||
          codePoint === 0x200e ||
          codePoint === 0x200f ||
          (codePoint >= 0x202a && codePoint <= 0x202e) ||
          (codePoint >= 0x2066 && codePoint <= 0x2069)
        );
      }) ||
      seen.has(key)
    ) {
      return null;
    }
    seen.add(key);
    values.push(normalized);
  }

  return {
    source: candidate.source,
    field: candidate.field,
    values,
  };
}

export function sameVehicleConfiguration(
  left: VehicleConfigurationIdentity | null | undefined,
  right: VehicleConfigurationIdentity | null | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.source === right.source &&
    left.field === right.field &&
    left.values.length === right.values.length &&
    left.values.every((value, index) => value === right.values[index])
  );
}

export function uniquelyMatchingVehicleTrimOption(
  options: readonly VehicleTrimOption[],
  trim: string,
  configuration?: VehicleConfigurationIdentity | null,
) {
  if (configuration) {
    const matches = options.filter((option) =>
      sameVehicleConfiguration(
        vehicleConfigurationFromTrimOption(option),
        configuration,
      ),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  const key = trimKey(trim);
  if (!key) return null;
  const matches = options.filter((option) =>
    [option.label, option.trim, ...option.queryValues].some(
      (value) => trimKey(value) === key,
    ),
  );
  return matches.length === 1 ? matches[0] : null;
}

function trimKey(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleUpperCase("en-US");
}

export interface VehicleLookupService {
  decodeVin(vin: string): Promise<DecodedVehicle>;
  listMakes(): Promise<readonly string[]>;
  listModels(
    input: ListVehicleModelsInput,
  ): Promise<readonly string[]>;
  listTrims(
    input: ListVehicleTrimsInput,
  ): Promise<readonly VehicleTrimOption[]>;
}

export const VEHICLE_LOOKUP_ERROR_CODES = [
  "invalid-input",
  "vehicle-not-found",
  "service-unavailable",
  "invalid-response",
] as const;

export type VehicleLookupErrorCode =
  (typeof VEHICLE_LOOKUP_ERROR_CODES)[number];

export class VehicleLookupError extends Error {
  readonly code: VehicleLookupErrorCode;
  readonly userMessage: string;

  constructor(code: VehicleLookupErrorCode, userMessage: string) {
    super(userMessage);
    this.name = "VehicleLookupError";
    this.code = code;
    this.userMessage = userMessage;
  }
}
