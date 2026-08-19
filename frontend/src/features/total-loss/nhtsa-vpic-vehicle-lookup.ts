import {
  type DecodedVehicle,
  type ListVehicleModelsInput,
  VehicleLookupError,
  type VehicleLookupService,
} from "@/features/total-loss/vehicle-lookup-service";

const NHTSA_VPIC_VEHICLES_URL =
  "https://vpic.nhtsa.dot.gov/api/vehicles";
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const MIN_CATALOG_YEAR = 1886;
const MAX_CATALOG_YEAR = 9_999;
const CONSUMER_VEHICLE_TYPES = ["car", "truck", "multipurpose"] as const;
const COMMON_US_PASSENGER_VEHICLE_MAKES = [
  "Acura",
  "Alfa Romeo",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Fiat",
  "Ford",
  "Genesis",
  "GMC",
  "Honda",
  "Hummer",
  "Hyundai",
  "Infiniti",
  "Isuzu",
  "Jaguar",
  "Jeep",
  "Kia",
  "Land Rover",
  "Lexus",
  "Lincoln",
  "Lucid",
  "Mazda",
  "Mercedes-Benz",
  "Mercury",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Oldsmobile",
  "Plymouth",
  "Polestar",
  "Pontiac",
  "Porsche",
  "Ram",
  "Rivian",
  "Saab",
  "Saturn",
  "Scion",
  "Smart",
  "Subaru",
  "Suzuki",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
] as const;

const catalogCollator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

interface NhtsaVpicVehicleLookupOptions {
  readonly fetchImplementation?: typeof fetch;
}

export function createNhtsaVpicVehicleLookupService({
  fetchImplementation = globalThis.fetch,
}: NhtsaVpicVehicleLookupOptions = {}): VehicleLookupService {
  let makesRequest: Promise<readonly string[]> | null = null;
  const modelRequests = new Map<string, Promise<readonly string[]>>();

  const requestJson = async (url: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw serviceUnavailableError();
    }

    if (!response.ok) {
      throw serviceUnavailableError();
    }

    try {
      return await response.json();
    } catch {
      throw invalidResponseError();
    }
  };

  return {
    async decodeVin(value) {
      const vin = normalizeVin(value);
      if (!VIN_PATTERN.test(vin)) {
        throw new VehicleLookupError(
          "invalid-input",
          "Enter a valid 17-character VIN without I, O, or Q.",
        );
      }

      const payload = await requestJson(
        `${NHTSA_VPIC_VEHICLES_URL}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
      );
      return decodeVehicle(payload, vin);
    },

    listMakes() {
      if (makesRequest) {
        return makesRequest;
      }

      makesRequest = Promise.all(
        CONSUMER_VEHICLE_TYPES.map((vehicleType) =>
          requestJson(
            `${NHTSA_VPIC_VEHICLES_URL}/GetMakesForVehicleType/${vehicleType}?format=json`,
          ),
        ),
        )
        .then((payloads) =>
          commonUsPassengerVehicleMakes(
            payloads.flatMap((payload) => catalogNames(payload, "MakeName")),
          ),
        )
        .catch((error: unknown) => {
          makesRequest = null;
          throw error;
        });
      return makesRequest;
    },

    async listModels(input) {
      const normalized = normalizeModelsInput(input);
      const cacheKey = `${normalized.year}:${normalized.make.toLocaleUpperCase("en-US")}`;
      const cached = modelRequests.get(cacheKey);
      if (cached) {
        return cached;
      }

      const request = requestJson(
        `${NHTSA_VPIC_VEHICLES_URL}/GetModelsForMakeYear/make/${encodeURIComponent(normalized.make)}/modelyear/${normalized.year}?format=json`,
      )
        .then((payload) =>
          uniqueCatalogOptions(catalogNames(payload, "Model_Name")),
        )
        .catch((error: unknown) => {
          modelRequests.delete(cacheKey);
          throw error;
        });
      modelRequests.set(cacheKey, request);
      return request;
    },
  };
}

function decodeVehicle(payload: unknown, expectedVin: string): DecodedVehicle {
  const results = responseResults(payload);
  if (results.length !== 1 || !isRecord(results[0])) {
    throw invalidResponseError();
  }

  const row = results[0];
  const returnedVin = requiredString(row, "VIN");
  const errorCode = requiredString(row, "ErrorCode");
  const modelYear = requiredString(row, "ModelYear");
  const make = requiredString(row, "Make");
  const model = requiredString(row, "Model");
  const trim = optionalString(row, "Trim");

  if (returnedVin.toUpperCase() !== expectedVin) {
    throw invalidResponseError();
  }

  const errorCodes = errorCode.split(",").map((code) => code.trim());
  const year = Number(modelYear);
  if (
    errorCodes.length === 0 ||
    errorCodes.some((code) => code !== "0") ||
    !/^\d{4}$/.test(modelYear) ||
    !Number.isSafeInteger(year) ||
    year < MIN_CATALOG_YEAR ||
    year > MAX_CATALOG_YEAR ||
    !make ||
    !model
  ) {
    throw new VehicleLookupError(
      "vehicle-not-found",
      "We couldn’t identify a vehicle with that VIN. Check the VIN and try again.",
    );
  }

  return Object.freeze({
    vin: expectedVin,
    year,
    make,
    model,
    trim: trim || null,
  });
}

function catalogNames(
  payload: unknown,
  nameField: "MakeName" | "Model_Name",
) {
  return responseResults(payload).map((result) => {
    if (!isRecord(result)) {
      throw invalidResponseError();
    }
    const name = requiredString(result, nameField);
    if (!name) {
      throw invalidResponseError();
    }
    return name;
  });
}

function uniqueCatalogOptions(names: readonly string[]) {
  const uniqueNames = new Map<string, string>();
  for (const name of names) {
    const key = name.toLocaleUpperCase("en-US");
    if (!uniqueNames.has(key)) {
      uniqueNames.set(key, name);
    }
  }

  return Object.freeze(
    [...uniqueNames.values()]
      .sort((left, right) => catalogCollator.compare(left, right)),
  );
}

function commonUsPassengerVehicleMakes(names: readonly string[]) {
  const availableMakeKeys = new Set(names.map(catalogKey));
  return Object.freeze(
    COMMON_US_PASSENGER_VEHICLE_MAKES.filter((make) =>
      availableMakeKeys.has(catalogKey(make)),
    ),
  );
}

function catalogKey(value: string) {
  return normalizeText(value)
    .toLocaleUpperCase("en-US")
    .replace(/[^A-Z0-9]/gu, "");
}

function normalizeModelsInput(
  input: ListVehicleModelsInput,
): ListVehicleModelsInput {
  const make = normalizeText(input.make);
  if (
    !Number.isSafeInteger(input.year) ||
    input.year < MIN_CATALOG_YEAR ||
    input.year > MAX_CATALOG_YEAR ||
    !make
  ) {
    throw new VehicleLookupError(
      "invalid-input",
      "Choose a valid vehicle year and make.",
    );
  }
  return { year: input.year, make };
}

function responseResults(payload: unknown): readonly unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.Results)) {
    throw invalidResponseError();
  }
  return payload.Results;
}

function requiredString(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string") {
    throw invalidResponseError();
  }
  return normalizeText(value);
}

function optionalString(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw invalidResponseError();
  }
  return normalizeText(value);
}

function normalizeVin(value: string) {
  return value.trim().toUpperCase();
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceUnavailableError() {
  return new VehicleLookupError(
    "service-unavailable",
    "Vehicle lookup is temporarily unavailable. Try again.",
  );
}

function invalidResponseError() {
  return new VehicleLookupError(
    "invalid-response",
    "Vehicle lookup is temporarily unavailable. Try again.",
  );
}
