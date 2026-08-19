import type {
  CreateTotalLossDetailsValues,
  TotalLossCaseDetails,
} from "@/features/total-loss/data-types";
import {
  createEmptyTotalLossManualForm,
  type TotalLossManualFormValues,
} from "@/features/total-loss/types";
import {
  normalizeTotalLossManualForm,
  parseCurrencyToCents,
  validateDateOfLoss,
  validateInsurerVehicleValuation,
  validateMileage,
  validateVehicleYear,
} from "@/features/total-loss/validation";

function nullable(value: string) {
  return value || null;
}

export function totalLossManualFormToDetailsValues(
  values: TotalLossManualFormValues,
  referenceDate = new Date(),
): CreateTotalLossDetailsValues {
  const normalized = normalizeTotalLossManualForm(values);
  const valuationCents = parseCurrencyToCents(
    normalized.insurerVehicleValuation,
  );
  const vehicleYear =
    !normalized.vehicleYear
      ? null
      : validateVehicleYear(normalized.vehicleYear, referenceDate) === null
        ? Number(normalized.vehicleYear)
        : undefined;
  const mileageAtLoss = !normalized.mileageAtLoss
    ? null
    : validateMileage(normalized.mileageAtLoss) === null
      ? Number(normalized.mileageAtLoss)
      : undefined;
  const dateOfLoss =
    !normalized.dateOfLoss
      ? null
      : validateDateOfLoss(normalized.dateOfLoss, referenceDate) === null
        ? normalized.dateOfLoss
        : undefined;
  const insurerVehicleValuation = !normalized.insurerVehicleValuation
    ? null
    : valuationCents !== null &&
        validateInsurerVehicleValuation(
          normalized.insurerVehicleValuation,
        ) === null
      ? valuationCents / 100
      : undefined;

  return {
    intakeMode: "manual",
    vin: nullable(normalized.vin),
    vehicleYear,
    vehicleMake: nullable(normalized.make),
    vehicleModel: nullable(normalized.model),
    vehicleTrim: nullable(normalized.trim),
    mileageAtLoss,
    postalCode: nullable(normalized.zipCode),
    dateOfLoss,
    insurerName: nullable(normalized.insurerName),
    insurerVehicleValuation,
  };
}

export function hasUnpersistedTotalLossManualValues(
  values: TotalLossManualFormValues,
  referenceDate = new Date(),
) {
  const normalized = normalizeTotalLossManualForm(values);
  return Boolean(
    (normalized.vehicleYear &&
      validateVehicleYear(normalized.vehicleYear, referenceDate)) ||
      (normalized.mileageAtLoss && validateMileage(normalized.mileageAtLoss)) ||
      (normalized.dateOfLoss &&
        validateDateOfLoss(normalized.dateOfLoss, referenceDate)) ||
      (normalized.insurerVehicleValuation &&
        validateInsurerVehicleValuation(
          normalized.insurerVehicleValuation,
        )),
  );
}

export function totalLossDetailsToManualForm(
  details: TotalLossCaseDetails,
): TotalLossManualFormValues {
  return {
    ...createEmptyTotalLossManualForm(),
    vin: details.vin ?? "",
    vehicleYear:
      details.vehicleYear === null ? "" : String(details.vehicleYear),
    make: details.vehicleMake ?? "",
    model: details.vehicleModel ?? "",
    trim: details.vehicleTrim ?? "",
    mileageAtLoss:
      details.mileageAtLoss === null ? "" : String(details.mileageAtLoss),
    zipCode: details.postalCode ?? "",
    dateOfLoss: details.dateOfLoss ?? "",
    insurerName: details.insurerName ?? "",
    insurerVehicleValuation:
      details.insurerVehicleValuation === null
        ? ""
        : details.insurerVehicleValuation.toFixed(2),
  };
}
