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

export interface VehicleTrimOption {
  readonly source: string;
  readonly id: string;
  readonly label: string;
  readonly trim: string;
  readonly queryField: VehicleTrimQueryField;
  readonly queryValues: readonly string[];
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
