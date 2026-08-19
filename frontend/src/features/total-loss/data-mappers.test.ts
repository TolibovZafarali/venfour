import { describe, expect, it } from "vitest";

import {
  hasUnpersistedTotalLossManualValues,
  totalLossDetailsToManualForm,
  totalLossManualFormToDetailsValues,
} from "@/features/total-loss/data-mappers";
import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";

const REFERENCE_DATE = new Date(2026, 7, 18, 12);

describe("total-loss data mappers", () => {
  it("normalizes browser form strings into typed database values", () => {
    expect(
      totalLossManualFormToDetailsValues(
        {
          vin: " 1hgcm82633a004352 ",
          vehicleYear: "2023",
          make: " Honda ",
          model: " Accord ",
          trim: " ",
          mileageAtLoss: "31,250",
          zipCode: "606011234",
          dateOfLoss: "2026-08-18",
          insurerName: " Example  Insurance ",
          insurerVehicleValuation: "$20,500.50",
        },
        REFERENCE_DATE,
      ),
    ).toEqual({
      intakeMode: "manual",
      vin: "1HGCM82633A004352",
      vehicleYear: 2023,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      vehicleTrim: null,
      mileageAtLoss: 31250,
      postalCode: "60601-1234",
      dateOfLoss: "2026-08-18",
      insurerName: "Example Insurance",
      insurerVehicleValuation: 20500.5,
    });
  });

  it("maps server details back to restorable manual form strings", () => {
    const details: TotalLossCaseDetails = {
      caseId: "22222222-2222-4222-8222-222222222222",
      intakeMode: "manual",
      vin: "1HGCM82633A004352",
      vehicleYear: 2023,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      vehicleTrim: null,
      mileageAtLoss: 31250,
      postalCode: "60601-1234",
      dateOfLoss: "2026-08-18",
      insurerName: "Example Insurance",
      insurerVehicleValuation: 20500.5,
      reportOriginalFilename: null,
      reportUploadedAt: null,
      intakeCompletedAt: null,
      createdAt: "2026-08-18T14:00:00.000Z",
      updatedAt: "2026-08-18T15:00:00.000Z",
    };

    expect(totalLossDetailsToManualForm(details)).toEqual({
      vin: "1HGCM82633A004352",
      vehicleYear: "2023",
      make: "Honda",
      model: "Accord",
      trim: "",
      mileageAtLoss: "31250",
      zipCode: "60601-1234",
      dateOfLoss: "2026-08-18",
      insurerName: "Example Insurance",
      insurerVehicleValuation: "20500.50",
    });
  });

  it("keeps incomplete typed values local without clearing prior server values", () => {
    const form = {
      vin: "1HG",
      vehicleYear: "20",
      make: "Hon",
      model: "",
      trim: "",
      mileageAtLoss: "1,",
      zipCode: "606",
      dateOfLoss: "2026-08",
      insurerName: "",
      insurerVehicleValuation: "$20.",
    };

    expect(totalLossManualFormToDetailsValues(form, REFERENCE_DATE)).toMatchObject({
      vehicleYear: undefined,
      mileageAtLoss: undefined,
      dateOfLoss: undefined,
      insurerVehicleValuation: undefined,
    });
    expect(hasUnpersistedTotalLossManualValues(form, REFERENCE_DATE)).toBe(true);
  });
});
