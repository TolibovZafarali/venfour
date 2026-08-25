import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DecodedVehicle,
  VehicleLookupError,
  type VehicleLookupService,
  type VehicleTrimOption,
} from "@/features/intake/vehicle-lookup-types";
import type { VehicleLookupState } from "@/features/intake/vehicle-identification-fields";

export interface UseVehicleLookupControllerOptions {
  readonly service: VehicleLookupService;
  readonly catalogEnabled: boolean;
  readonly trimCatalogEnabled?: boolean;
  readonly vehicleYear: string;
  readonly make: string;
  readonly model?: string;
  readonly currentVin: string;
  readonly unknownVinErrorMessage: string;
}

export interface VehicleLookupController {
  readonly makeOptions: readonly string[];
  readonly modelOptions: readonly string[];
  readonly trimOptions: readonly VehicleTrimOption[];
  readonly makesState: VehicleLookupState;
  readonly modelsState: VehicleLookupState;
  readonly trimsState: VehicleLookupState;
  readonly vinLookupState: VehicleLookupState;
  readonly vinLookupMessage: string | null;
  readonly decodeVin: (vin: string) => Promise<DecodedVehicle | null>;
  readonly hasDecodedVin: (vin: string) => boolean;
  readonly resetVinLookup: () => void;
  readonly resetModelLookup: () => void;
  readonly retryMakes: () => void;
  readonly retryModels: () => void;
  readonly retryTrims: () => void;
}

interface TrimCatalogSnapshot {
  readonly key: string | null;
  readonly options: readonly VehicleTrimOption[];
  readonly state: VehicleLookupState;
}

export function useVehicleLookupController({
  service,
  catalogEnabled,
  trimCatalogEnabled = false,
  vehicleYear,
  make,
  model = "",
  currentVin,
  unknownVinErrorMessage,
}: UseVehicleLookupControllerOptions): VehicleLookupController {
  const [makeOptions, setMakeOptions] = useState<readonly string[]>([]);
  const [modelOptions, setModelOptions] = useState<readonly string[]>([]);
  const [trimCatalog, setTrimCatalog] = useState<TrimCatalogSnapshot>({
    key: null,
    options: [],
    state: "idle",
  });
  const [makesState, setMakesState] = useState<VehicleLookupState>("idle");
  const [modelsState, setModelsState] = useState<VehicleLookupState>("idle");
  const [vinLookupState, setVinLookupState] =
    useState<VehicleLookupState>("idle");
  const [vinLookupMessage, setVinLookupMessage] = useState<string | null>(null);
  const makesRequestRef = useRef(0);
  const modelsRequestRef = useRef(0);
  const trimsRequestRef = useRef(0);
  const vinRequestRef = useRef(0);
  const currentVinRef = useRef(currentVin);
  const decodedVinRef = useRef<string | null>(null);
  const catalogInputRef = useRef({ vehicleYear, make, model });

  useEffect(() => {
    if (currentVinRef.current === currentVin) return;
    currentVinRef.current = currentVin;
    const requestId = ++vinRequestRef.current;
    decodedVinRef.current = null;
    queueMicrotask(() => {
      if (
        currentVinRef.current !== currentVin ||
        vinRequestRef.current !== requestId
      ) {
        return;
      }
      setVinLookupState("idle");
      setVinLookupMessage(null);
    });
  }, [currentVin]);

  useEffect(() => {
    catalogInputRef.current = { vehicleYear, make, model };
  }, [make, model, vehicleYear]);

  useEffect(
    () => () => {
      makesRequestRef.current += 1;
      modelsRequestRef.current += 1;
      trimsRequestRef.current += 1;
      vinRequestRef.current += 1;
    },
    [],
  );

  const loadMakes = useCallback(async () => {
    const requestId = ++makesRequestRef.current;
    setMakesState("loading");
    try {
      const options = await service.listMakes();
      if (requestId !== makesRequestRef.current) return;
      setMakeOptions(options);
      setMakesState("success");
    } catch {
      if (requestId !== makesRequestRef.current) return;
      setMakesState("error");
    }
  }, [service]);

  const loadModels = useCallback(
    async (year: number, requestedMake: string) => {
      const requestId = ++modelsRequestRef.current;
      setModelsState("loading");
      try {
        const options = await service.listModels({
          year,
          make: requestedMake,
        });
        if (requestId !== modelsRequestRef.current) return;
        setModelOptions(options);
        setModelsState("success");
      } catch {
        if (requestId !== modelsRequestRef.current) return;
        setModelsState("error");
      }
    },
    [service],
  );

  const loadTrims = useCallback(
    async (
      year: number,
      requestedMake: string,
      requestedModel: string,
      key: string,
    ) => {
      const requestId = ++trimsRequestRef.current;
      setTrimCatalog({ key, options: [], state: "loading" });
      try {
        const options = await service.listTrims({
          year,
          make: requestedMake,
          model: requestedModel,
        });
        if (requestId !== trimsRequestRef.current) return;
        setTrimCatalog({ key, options, state: "success" });
      } catch {
        if (requestId !== trimsRequestRef.current) return;
        setTrimCatalog({ key, options: [], state: "error" });
      }
    },
    [service],
  );

  useEffect(() => {
    if (catalogEnabled && makesState === "idle") {
      queueMicrotask(() => void loadMakes());
    }
  }, [catalogEnabled, loadMakes, makesState]);

  useEffect(() => {
    if (!catalogEnabled) return;
    const year = Number(vehicleYear);
    const normalizedMake = make.trim();
    if (!Number.isSafeInteger(year) || !normalizedMake) {
      modelsRequestRef.current += 1;
      return;
    }
    queueMicrotask(() => void loadModels(year, normalizedMake));
  }, [catalogEnabled, loadModels, make, vehicleYear]);

  useEffect(() => {
    const input = trimCatalogInput(vehicleYear, make, model);
    if (!trimCatalogEnabled || !input) {
      trimsRequestRef.current += 1;
      queueMicrotask(() =>
        setTrimCatalog({ key: null, options: [], state: "idle" }),
      );
      return;
    }
    queueMicrotask(() =>
      void loadTrims(input.year, input.make, input.model, input.key),
    );
  }, [loadTrims, make, model, trimCatalogEnabled, vehicleYear]);

  const resetVinLookup = useCallback(() => {
    vinRequestRef.current += 1;
    decodedVinRef.current = null;
    setVinLookupState("idle");
    setVinLookupMessage(null);
  }, []);

  const resetModelLookup = useCallback(() => {
    modelsRequestRef.current += 1;
    setModelOptions([]);
    setModelsState("idle");
  }, []);

  const decodeVin = useCallback(
    async (vin: string) => {
      const requestId = ++vinRequestRef.current;
      setVinLookupState("loading");
      setVinLookupMessage(null);
      try {
        const vehicle = await service.decodeVin(vin);
        if (
          requestId !== vinRequestRef.current ||
          currentVinRef.current !== vehicle.vin
        ) {
          return null;
        }
        decodedVinRef.current = vehicle.vin;
        setVinLookupState("success");
        setVinLookupMessage(
          `Vehicle found: ${[
            vehicle.year,
            vehicle.make,
            vehicle.model,
            vehicle.trim,
          ]
            .filter(Boolean)
            .join(" ")}`,
        );
        return vehicle;
      } catch (error) {
        if (requestId !== vinRequestRef.current) return null;
        setVinLookupState("error");
        setVinLookupMessage(
          error instanceof VehicleLookupError
            ? error.userMessage
            : unknownVinErrorMessage,
        );
        return null;
      }
    },
    [service, unknownVinErrorMessage],
  );

  const hasDecodedVin = useCallback(
    (vin: string) => decodedVinRef.current === vin,
    [],
  );

  const retryMakes = useCallback(() => {
    void loadMakes();
  }, [loadMakes]);

  const retryModels = useCallback(() => {
    const year = Number(catalogInputRef.current.vehicleYear);
    const requestedMake = catalogInputRef.current.make.trim();
    if (Number.isSafeInteger(year) && requestedMake) {
      void loadModels(year, requestedMake);
    }
  }, [loadModels]);

  const retryTrims = useCallback(() => {
    const input = trimCatalogInput(
      catalogInputRef.current.vehicleYear,
      catalogInputRef.current.make,
      catalogInputRef.current.model,
    );
    if (trimCatalogEnabled && input) {
      void loadTrims(input.year, input.make, input.model, input.key);
    }
  }, [loadTrims, trimCatalogEnabled]);

  const activeTrimKey = trimCatalogEnabled
    ? trimCatalogInput(vehicleYear, make, model)?.key ?? null
    : null;
  const trimOptions =
    activeTrimKey && trimCatalog.key === activeTrimKey
      ? trimCatalog.options
      : [];
  const trimsState: VehicleLookupState = !activeTrimKey
    ? "idle"
    : trimCatalog.key === activeTrimKey
      ? trimCatalog.state
      : "loading";

  return {
    makeOptions,
    modelOptions,
    trimOptions,
    makesState,
    modelsState,
    trimsState,
    vinLookupState,
    vinLookupMessage,
    decodeVin,
    hasDecodedVin,
    resetVinLookup,
    resetModelLookup,
    retryMakes,
    retryModels,
    retryTrims,
  };
}

function trimCatalogInput(
  vehicleYear: string,
  make: string,
  model: string,
) {
  const year = Number(vehicleYear);
  const normalizedMake = make.trim();
  const normalizedModel = model.trim();
  if (
    !Number.isSafeInteger(year) ||
    !normalizedMake ||
    !normalizedModel
  ) {
    return null;
  }
  return {
    year,
    make: normalizedMake,
    model: normalizedModel,
    key: [
      year,
      normalizedMake.toLocaleUpperCase("en-US"),
      normalizedModel.toLocaleUpperCase("en-US"),
    ].join(":"),
  } as const;
}
