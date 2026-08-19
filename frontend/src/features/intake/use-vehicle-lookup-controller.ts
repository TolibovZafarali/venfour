import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DecodedVehicle,
  VehicleLookupError,
  type VehicleLookupService,
} from "@/features/intake/vehicle-lookup-types";
import type { VehicleLookupState } from "@/features/intake/vehicle-identification-fields";

export interface UseVehicleLookupControllerOptions {
  readonly service: VehicleLookupService;
  readonly catalogEnabled: boolean;
  readonly vehicleYear: string;
  readonly make: string;
  readonly currentVin: string;
  readonly unknownVinErrorMessage: string;
}

export interface VehicleLookupController {
  readonly makeOptions: readonly string[];
  readonly modelOptions: readonly string[];
  readonly makesState: VehicleLookupState;
  readonly modelsState: VehicleLookupState;
  readonly vinLookupState: VehicleLookupState;
  readonly vinLookupMessage: string | null;
  readonly decodeVin: (vin: string) => Promise<DecodedVehicle | null>;
  readonly hasDecodedVin: (vin: string) => boolean;
  readonly resetVinLookup: () => void;
  readonly resetModelLookup: () => void;
  readonly retryMakes: () => void;
  readonly retryModels: () => void;
}

export function useVehicleLookupController({
  service,
  catalogEnabled,
  vehicleYear,
  make,
  currentVin,
  unknownVinErrorMessage,
}: UseVehicleLookupControllerOptions): VehicleLookupController {
  const [makeOptions, setMakeOptions] = useState<readonly string[]>([]);
  const [modelOptions, setModelOptions] = useState<readonly string[]>([]);
  const [makesState, setMakesState] = useState<VehicleLookupState>("idle");
  const [modelsState, setModelsState] = useState<VehicleLookupState>("idle");
  const [vinLookupState, setVinLookupState] =
    useState<VehicleLookupState>("idle");
  const [vinLookupMessage, setVinLookupMessage] = useState<string | null>(null);
  const makesRequestRef = useRef(0);
  const modelsRequestRef = useRef(0);
  const vinRequestRef = useRef(0);
  const currentVinRef = useRef(currentVin);
  const decodedVinRef = useRef<string | null>(null);
  const catalogInputRef = useRef({ vehicleYear, make });

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
    catalogInputRef.current = { vehicleYear, make };
  }, [make, vehicleYear]);

  useEffect(
    () => () => {
      makesRequestRef.current += 1;
      modelsRequestRef.current += 1;
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

  return {
    makeOptions,
    modelOptions,
    makesState,
    modelsState,
    vinLookupState,
    vinLookupMessage,
    decodeVin,
    hasDecodedVin,
    resetVinLookup,
    resetModelLookup,
    retryMakes,
    retryModels,
  };
}
