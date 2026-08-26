import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  OTHER_VEHICLE_TRIM_OPTION,
  useVehicleLookupController,
  VehicleLookupError,
  type DecodedVehicle,
  type VehicleLookupService,
  type VehicleTrimOption,
} from "@/features/intake";

describe("useVehicleLookupController", () => {
  it("loads provider-neutral make and model catalogs when enabled", async () => {
    const service = vehicleService();
    const { result, rerender } = renderHook(
      (props: { enabled: boolean; year: string; make: string }) =>
        useVehicleLookupController({
          service,
          catalogEnabled: props.enabled,
          vehicleYear: props.year,
          make: props.make,
          currentVin: "",
          unknownVinErrorMessage: "Lookup unavailable.",
        }),
      {
        initialProps: { enabled: false, year: "2024", make: "Honda" },
      },
    );

    expect(service.listMakes).not.toHaveBeenCalled();
    expect(service.listModels).not.toHaveBeenCalled();

    rerender({ enabled: true, year: "2024", make: "Honda" });

    await waitFor(() => expect(result.current.makesState).toBe("success"));
    await waitFor(() => expect(result.current.modelsState).toBe("success"));
    expect(result.current.makeOptions).toEqual(["Honda", "Toyota"]);
    expect(result.current.modelOptions).toEqual(["Accord", "Civic"]);
    expect(service.listModels).toHaveBeenCalledWith({
      year: 2024,
      make: "Honda",
    });
  });

  it("owns VIN success, cache, reset, and provider error state", async () => {
    const service = vehicleService();
    const { result } = renderHook(() =>
      useVehicleLookupController({
        service,
        catalogEnabled: false,
        vehicleYear: "",
        make: "",
        currentVin: "1HGCM82633A004352",
        unknownVinErrorMessage: "Lookup unavailable.",
      }),
    );

    let decoded;
    await act(async () => {
      decoded = await result.current.decodeVin("1HGCM82633A004352");
    });

    expect(decoded).toMatchObject({ make: "Honda", model: "Accord" });
    expect(result.current.vinLookupState).toBe("success");
    expect(result.current.vinLookupMessage).toBe(
      "Vehicle found: 2024 Honda Accord EX",
    );
    expect(result.current.hasDecodedVin("1HGCM82633A004352")).toBe(true);

    act(() => result.current.resetVinLookup());
    expect(result.current.vinLookupState).toBe("idle");
    expect(result.current.vinLookupMessage).toBeNull();
    expect(result.current.hasDecodedVin("1HGCM82633A004352")).toBe(false);

    vi.mocked(service.decodeVin).mockRejectedValueOnce(
      new VehicleLookupError("vehicle-not-found", "Vehicle not found."),
    );
    await act(async () => {
      decoded = await result.current.decodeVin("1HGCM82633A004352");
    });
    expect(decoded).toBeNull();
    expect(result.current.vinLookupState).toBe("error");
    expect(result.current.vinLookupMessage).toBe("Vehicle not found.");
  });

  it("loads trims only for the current year, make, and model", async () => {
    const accord = deferred<readonly VehicleTrimOption[]>();
    const civic = deferred<readonly VehicleTrimOption[]>();
    const service = vehicleService();
    vi.mocked(service.listTrims)
      .mockReturnValueOnce(accord.promise)
      .mockReturnValueOnce(civic.promise);
    const { result, rerender } = renderHook(
      (props: { model: string }) =>
        useVehicleLookupController({
          service,
          catalogEnabled: false,
          trimCatalogEnabled: true,
          vehicleYear: "2024",
          make: "Honda",
          model: props.model,
          currentVin: "",
          unknownVinErrorMessage: "Lookup unavailable.",
        }),
      { initialProps: { model: "" } },
    );

    expect(service.listTrims).not.toHaveBeenCalled();
    expect(result.current.trimsState).toBe("idle");

    rerender({ model: "Accord" });
    await waitFor(() =>
      expect(service.listTrims).toHaveBeenCalledWith({
        year: 2024,
        make: "Honda",
        model: "Accord",
      }),
    );
    expect(result.current.trimsState).toBe("loading");

    rerender({ model: "Civic" });
    await waitFor(() => expect(service.listTrims).toHaveBeenCalledTimes(2));
    expect(result.current.trimOptions).toEqual([
      OTHER_VEHICLE_TRIM_OPTION,
    ]);

    await act(async () => accord.resolve([trimOption("ex", "EX")]));
    expect(result.current.trimOptions).toEqual([
      OTHER_VEHICLE_TRIM_OPTION,
    ]);

    const civicOptions = [
      trimOption("sport", "Sport"),
      trimOption("touring", "Touring"),
    ];
    await act(async () => civic.resolve(civicOptions));
    await waitFor(() => expect(result.current.trimsState).toBe("success"));
    expect(result.current.trimOptions).toEqual([
      ...civicOptions,
      OTHER_VEHICLE_TRIM_OPTION,
    ]);
  });

  it("keeps the fallback selectable after a trim lookup failure", async () => {
    const service = vehicleService();
    vi.mocked(service.listTrims).mockRejectedValueOnce(
      new Error("synthetic lookup failure"),
    );
    const { result } = renderHook(() =>
      useVehicleLookupController({
        service,
        catalogEnabled: false,
        trimCatalogEnabled: true,
        vehicleYear: "2024",
        make: "Honda",
        model: "Accord",
        currentVin: "",
        unknownVinErrorMessage: "Lookup unavailable.",
      }),
    );

    await waitFor(() => expect(result.current.trimsState).toBe("error"));
    expect(result.current.trimOptions).toEqual([
      OTHER_VEHICLE_TRIM_OPTION,
    ]);
  });

  it("ignores a VIN response after the current VIN changes", async () => {
    const pending = deferred<{
      vin: string;
      year: number;
      make: string;
      model: string;
      trim: string | null;
    }>();
    const service = vehicleService();
    vi.mocked(service.decodeVin).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ currentVin }: { currentVin: string }) =>
        useVehicleLookupController({
          service,
          catalogEnabled: false,
          vehicleYear: "",
          make: "",
          currentVin,
          unknownVinErrorMessage: "Lookup unavailable.",
        }),
      { initialProps: { currentVin: "1HGCM82633A004352" } },
    );

    let lookupResult: DecodedVehicle | null = null;
    let lookupPromise!: Promise<DecodedVehicle | null>;
    act(() => {
      lookupPromise = result.current.decodeVin("1HGCM82633A004352");
    });
    rerender({ currentVin: "2HGCM82633A004352" });

    await waitFor(() => expect(result.current.vinLookupState).toBe("idle"));

    await act(async () => {
      pending.resolve({
        vin: "1HGCM82633A004352",
        year: 2024,
        make: "Honda",
        model: "Accord",
        trim: "EX",
      });
      lookupResult = await lookupPromise;
    });

    expect(lookupResult).toBeNull();
    expect(result.current.vinLookupState).toBe("idle");
    expect(result.current.hasDecodedVin("1HGCM82633A004352")).toBe(false);
  });
});

function vehicleService(): VehicleLookupService {
  return {
    decodeVin: vi.fn(async (vin: string) => ({
      vin,
      year: 2024,
      make: "Honda",
      model: "Accord",
      trim: "EX",
    })),
    listMakes: vi.fn(async () => ["Honda", "Toyota"]),
    listModels: vi.fn(async () => ["Accord", "Civic"]),
    listTrims: vi.fn(async () => [trimOption("ex", "EX")]),
  };
}

function trimOption(id: string, label: string): VehicleTrimOption {
  return {
    source: "marketcheck",
    id,
    label,
    trim: label,
    queryField: "trim",
    queryValues: [label],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
