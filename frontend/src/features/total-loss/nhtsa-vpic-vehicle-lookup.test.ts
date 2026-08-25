import { describe, expect, it, vi } from "vitest";

import { createNhtsaVpicVehicleLookupService } from "@/features/total-loss/nhtsa-vpic-vehicle-lookup";
import { VehicleLookupError } from "@/features/total-loss/vehicle-lookup-service";

const VIN = "1HGCM82633A004352";

describe("NHTSA vPIC vehicle lookup", () => {
  it("decodes and normalizes a complete VIN response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        Results: [
          {
            VIN,
            ModelYear: "2003",
            Make: " HONDA ",
            Model: " Accord ",
            Trim: " EX-V6 ",
            ErrorCode: "0",
          },
        ],
      }),
    );
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    await expect(service.decodeVin(` ${VIN.toLowerCase()} `)).resolves.toEqual({
      vin: VIN,
      year: 2003,
      make: "HONDA",
      model: "Accord",
      trim: "EX-V6",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${VIN}?format=json`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("returns null for an unavailable optional trim", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        Results: [
          {
            VIN,
            ModelYear: "2003",
            Make: "HONDA",
            Model: "Accord",
            Trim: "",
            ErrorCode: "0",
          },
        ],
      }),
    );
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    await expect(service.decodeVin(VIN)).resolves.toMatchObject({ trim: null });
  });

  it("rejects an invalid VIN without making a request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    await expect(service.decodeVin("1HGCM82633A00435I")).rejects.toMatchObject({
      name: "VehicleLookupError",
      code: "invalid-input",
      userMessage: "Enter a valid 17-character VIN without I, O, or Q.",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("maps unsuccessful provider decoding to a safe not-found error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        Results: [
          {
            VIN,
            ModelYear: "",
            Make: "",
            Model: "",
            Trim: "",
            ErrorCode: "1,7",
            ErrorText: "provider diagnostic that must not reach the customer",
          },
        ],
      }),
    );
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    const error = await captureVehicleLookupError(() => service.decodeVin(VIN));
    expect(error).toMatchObject({
      code: "vehicle-not-found",
      userMessage:
        "We couldn’t identify a vehicle with that VIN. Check the VIN and try again.",
    });
    expect(error.message).not.toContain("provider diagnostic");
  });

  it.each([
    ["a mismatched VIN", { Results: [{ VIN: "2HGFC2F59MH500001", ModelYear: "2003", Make: "HONDA", Model: "Accord", Trim: "EX", ErrorCode: "0" }] }],
    ["a missing results collection", { Count: 1 }],
    ["a malformed decoded field", { Results: [{ VIN, ModelYear: 2003, Make: "HONDA", Model: "Accord", Trim: "EX", ErrorCode: "0" }] }],
  ])("rejects %s as an invalid response", async (_label, payload) => {
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(payload)),
    });

    await expect(service.decodeVin(VIN)).rejects.toMatchObject({
      name: "VehicleLookupError",
      code: "invalid-response",
      userMessage: "Vehicle lookup is temporarily unavailable. Try again.",
    });
  });

  it("maps network and HTTP failures to a safe unavailable error", async () => {
    const networkService = createNhtsaVpicVehicleLookupService({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("socket details")),
    });
    const httpService = createNhtsaVpicVehicleLookupService({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: "provider failure" }, 503)),
    });

    for (const service of [networkService, httpService]) {
      const error = await captureVehicleLookupError(() => service.decodeVin(VIN));
      expect(error).toMatchObject({
        code: "service-unavailable",
        userMessage: "Vehicle lookup is temporarily unavailable. Try again.",
      });
      expect(error.message).not.toMatch(/socket|provider failure/i);
    }
  });

  it("rejects invalid JSON as an invalid response", async () => {
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    });

    await expect(service.decodeVin(VIN)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});

describe("NHTSA vPIC vehicle catalog", () => {
  it("returns only common U.S. passenger-vehicle makes and caches them", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        Results: [
          { MakeId: 1, MakeName: " Honda " },
          { MakeId: 2, MakeName: "FORD" },
          { MakeId: 3, MakeName: "honda" },
          { MakeId: 4, MakeName: "BMW" },
          { MakeId: 5, MakeName: "ACME TRAILER" },
          { MakeId: 6, MakeName: "LADA" },
        ],
      }),
    );
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    const firstRequest = service.listMakes();
    const secondRequest = service.listMakes();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(first).toEqual(["BMW", "Ford", "Honda"]);
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json",
      "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/truck?format=json",
      "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/multipurpose?format=json",
    ]);
  });

  it("normalizes the request and caches model options by year and make", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        Results: [
          { Model_ID: 1, Model_Name: " Range Rover " },
          { Model_ID: 2, Model_Name: "Defender" },
          { Model_ID: 3, Model_Name: "range rover" },
          { Model_ID: 4, Model_Name: "Discovery 2" },
          { Model_ID: 5, Model_Name: "Discovery 10" },
        ],
      }),
    );
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    const first = await service.listModels({
      year: 2024,
      make: " Land   Rover ",
    });
    const second = await service.listModels({ year: 2024, make: "land rover" });

    expect(first).toEqual([
      "Defender",
      "Discovery 2",
      "Discovery 10",
      "Range Rover",
    ]);
    expect(second).toBe(first);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Land%20Rover/modelyear/2024?format=json",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("loads, exact-deduplicates, naturally sorts, and caches trim options", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        trims: [
          trimOption({
            id: "long-range-awd-10",
            label: "Long Range — AWD 10",
            trim: "Long Range AWD 10",
            queryField: "version",
            queryValues: ["Model 3 Long Range AWD 10"],
          }),
          trimOption({
            id: "long-range-awd-2",
            label: "Long Range — AWD 2",
            trim: "Long Range AWD 2",
            queryField: "version",
            queryValues: [
              "Long Range Battery AWD",
              "Long Range AWD",
              "Long Range Battery AWD",
            ],
          }),
          trimOption(),
          trimOption(),
          trimOption({ id: "alternate-xle-id" }),
        ],
      }),
    );
    const service = createNhtsaVpicVehicleLookupService({
      apiBaseUrl: "https://api.example.test/",
      fetchImplementation,
    });

    const first = await service.listTrims({
      year: 2020,
      make: " Toyota ",
      model: " Camry ",
    });
    const second = await service.listTrims({
      year: 2020,
      make: "toyota",
      model: "camry",
    });

    expect(first).toEqual([
      {
        source: "marketcheck",
        id: "long-range-awd-2",
        label: "Long Range — AWD 2",
        trim: "Long Range AWD 2",
        queryField: "version",
        queryValues: ["Long Range AWD", "Long Range Battery AWD"],
      },
      {
        source: "marketcheck",
        id: "long-range-awd-10",
        label: "Long Range — AWD 10",
        trim: "Long Range AWD 10",
        queryField: "version",
        queryValues: ["Model 3 Long Range AWD 10"],
      },
      {
        source: "marketcheck",
        id: "alternate-xle-id",
        label: "XLE",
        trim: "XLE",
        queryField: "trim",
        queryValues: ["XLE"],
      },
    ]);
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]?.queryValues)).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/vehicle-trims?year=2020&make=Toyota&model=Camry",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    ["a legacy string option", { trims: ["XLE"] }],
    [
      "an unknown envelope field",
      { trims: [trimOption()], source: "marketcheck" },
    ],
    [
      "an unknown option field",
      { trims: [{ ...trimOption(), provider: "marketcheck" }] },
    ],
    [
      "an invalid provider source",
      { trims: [trimOption({ source: "Market Check" })] },
    ],
    [
      "an unsupported query field",
      { trims: [trimOption({ queryField: "drivetrain" })] },
    ],
    ["an empty query list", { trims: [trimOption({ queryValues: [] })] }],
    [
      "too many aliases for one configuration",
      {
        trims: [
          trimOption({
            queryValues: Array.from(
              { length: 21 },
              (_, index) => `XLE alias ${index + 1}`,
            ),
          }),
        ],
      },
    ],
    ["noncanonical label whitespace", { trims: [trimOption({ label: " XLE" })] }],
    [
      "one ID for conflicting configurations",
      {
        trims: [
          trimOption(),
          trimOption({ label: "XLE Hybrid", trim: "XLE Hybrid" }),
        ],
      },
    ],
    [
      "one display label for conflicting configurations",
      {
        trims: [
          trimOption(),
          trimOption({
            id: "xle-hybrid",
            trim: "XLE Hybrid",
            queryValues: ["XLE Hybrid"],
          }),
        ],
      },
    ],
  ])("rejects %s in the trim catalog", async (_label, payload) => {
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(payload)),
    });

    await expect(
      service.listTrims({ year: 2020, make: "Toyota", model: "Camry" }),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("rejects an incomplete trim lookup without making a request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    await expect(
      service.listTrims({ year: 2024, make: "Honda", model: " " }),
    ).rejects.toMatchObject({
      code: "invalid-input",
      userMessage: "Choose a valid vehicle year, make, and model.",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not cache a failed catalog request", async () => {
    let requestCount = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      return jsonResponse({
        Results: [{ MakeName: requestCount === 1 ? 10 : "HONDA" }],
      });
    });
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    await expect(service.listMakes()).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(service.listMakes()).resolves.toEqual(["Honda"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
  });

  it.each([
    [{ year: 2024, make: " " }, "an empty make"],
    [{ year: 2024.5, make: "Honda" }, "a fractional year"],
    [{ year: 1800, make: "Honda" }, "an unsupported year"],
  ])("rejects %s without making a catalog request", async (input) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation,
    });

    await expect(service.listModels(input)).rejects.toMatchObject({
      code: "invalid-input",
      userMessage: "Choose a valid vehicle year and make.",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects a malformed catalog envelope", async () => {
    const service = createNhtsaVpicVehicleLookupService({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ Results: "not-an-array" })),
    });

    await expect(service.listMakes()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function captureVehicleLookupError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(VehicleLookupError);
    return error as VehicleLookupError;
  }
  throw new Error("Expected vehicle lookup to reject.");
}

function trimOption(
  overrides: Partial<{
    source: string;
    id: string;
    label: string;
    trim: string;
    queryField: string;
    queryValues: readonly string[];
  }> = {},
) {
  return {
    source: "marketcheck",
    id: "xle",
    label: "XLE",
    trim: "XLE",
    queryField: "trim",
    queryValues: ["XLE"],
    ...overrides,
  };
}
