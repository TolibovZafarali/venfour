import {
  vehicleConfigurationFromTrimOption,
  type VehicleTrimOption,
} from "@/features/intake/vehicle-lookup-types";
import type { DecodedVehicle } from "@/features/total-loss/vehicle-lookup-service";

import type {
  DiminishedValueDraft,
  DiminishedValueFormField,
  DiminishedValueStep,
  DiminishedValueVehicleEntryMethod,
} from "./types";

export type DiminishedValueDraftAction =
  | {
      readonly type: "field-changed";
      readonly field: DiminishedValueFormField;
      readonly value: string;
    }
  | {
      readonly type: "vehicle-method-changed";
      readonly method: DiminishedValueVehicleEntryMethod;
    }
  | {
      readonly type: "vehicle-decoded";
      readonly vehicle: DecodedVehicle;
    }
  | {
      readonly type: "trim-selected";
      readonly option: VehicleTrimOption;
    }
  | {
      readonly type: "step-changed";
      readonly step: DiminishedValueStep;
      readonly returnAfterStartEdit?: boolean;
    };

export function diminishedValueDraftReducer(
  draft: DiminishedValueDraft,
  action: DiminishedValueDraftAction,
): DiminishedValueDraft {
  switch (action.type) {
    case "field-changed": {
      const next = { ...draft, [action.field]: action.value };
      if (action.field === "vin") {
        return {
          ...next,
          vehicleYear: "",
          make: "",
          model: "",
          trim: "",
          vehicleConfiguration: null,
        } as DiminishedValueDraft;
      }
      if (action.field === "vehicleYear" || action.field === "make") {
        return {
          ...next,
          model: "",
          trim: "",
          vehicleConfiguration: null,
        } as DiminishedValueDraft;
      }
      if (action.field === "model" || action.field === "trim") {
        return {
          ...next,
          trim: action.field === "model" ? "" : next.trim,
          vehicleConfiguration: null,
        } as DiminishedValueDraft;
      }
      return next as DiminishedValueDraft;
    }

    case "vehicle-method-changed":
      return action.method === "details"
        ? {
            ...draft,
            vehicleEntryMethod: action.method,
            vin: "",
            trim: "",
            vehicleConfiguration: null,
          }
        : {
            ...draft,
            vehicleEntryMethod: action.method,
            vehicleYear: "",
            make: "",
            model: "",
            trim: "",
            vehicleConfiguration: null,
          };

    case "vehicle-decoded":
      return {
        ...draft,
        vin: action.vehicle.vin,
        vehicleYear: String(action.vehicle.year),
        make: action.vehicle.make,
        model: action.vehicle.model,
        trim: action.vehicle.trim ?? "",
        vehicleConfiguration: null,
      };

    case "trim-selected":
      return {
        ...draft,
        trim: action.option.trim,
        vehicleConfiguration: vehicleConfigurationFromTrimOption(action.option),
      };

    case "step-changed":
      return {
        ...draft,
        step: action.step,
        returnAfterStartEdit:
          action.returnAfterStartEdit ?? draft.returnAfterStartEdit,
      };
  }
}
