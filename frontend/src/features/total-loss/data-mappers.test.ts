import { describe, expect, it } from "vitest";

import {
  hasUnpersistedTotalLossManualValues,
  totalLossDetailsToManualForm,
  totalLossManualFormToDetailsValues,
  totalLossReportFormToDetailsValues,
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
          trim: " EX-L ",
          mileageAtLoss: "31,250",
          zipCode: "606011234",
          dateOfLoss: "2026-08-18",
          insurerName: " Example  Insurance ",
          insurerVehicleValuation: "$20,500.50",
          vehicleCondition: " Good ",
          optionsPackages: " Technology package ",
        },
        REFERENCE_DATE,
        {
          source: "marketcheck",
          field: "version",
          values: ["Accord EX-L CVT FWD"],
        },
      ),
    ).toEqual({
      intakeMode: "manual",
      vin: "1HGCM82633A004352",
      vehicleYear: 2023,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      vehicleTrim: "EX-L",
      vehicleConfiguration: {
        source: "marketcheck",
        field: "version",
        values: ["Accord EX-L CVT FWD"],
      },
      mileageAtLoss: 31250,
      postalCode: "60601-1234",
      dateOfLoss: "2026-08-18",
      insurerName: "Example Insurance",
      insurerVehicleValuation: 20500.5,
      vehicleCondition: "Good",
      optionsPackages: "Technology package",
    });
  });

  it("maps confirmed report facts into the shared provider-neutral fields", () => {
    expect(
      totalLossReportFormToDetailsValues(
        {
          vin: "1HGCM82633A004352",
          vehicleYear: "2020",
          make: "Honda",
          model: "Accord",
          trim: "EX-L",
          mileageAtLoss: "48250",
          zipCode: "606011234",
          dateOfLoss: "2020-01-02",
          insurerName: "Private Insurer",
          insurerVehicleValuation: "18750.00",
          vehicleCondition: "Good",
          optionsPackages: "None known",
        },
        REFERENCE_DATE,
      ),
    ).toEqual({
      intakeMode: "report",
      vin: "1HGCM82633A004352",
      vehicleYear: 2020,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      vehicleTrim: "EX-L",
      vehicleConfiguration: null,
      mileageAtLoss: 48250,
      postalCode: "60601-1234",
      dateOfLoss: "2020-01-02",
      insurerName: "Private Insurer",
      insurerVehicleValuation: 18750,
      vehicleCondition: "Good",
      optionsPackages: "None known",
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
      vehicleCondition: "Good",
      optionsPackages: "Technology package",
      reportUploadRecoveryRequired: false,
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
      vehicleCondition: "Good",
      optionsPackages: "Technology package",
    });
  });

  it("keeps removed condition and options fields nullable", () => {
    const emptyOptions = totalLossManualFormToDetailsValues(
      {
        vin: "",
        vehicleYear: "2020",
        make: "Honda",
        model: "Accord",
        trim: "EX-L",
        mileageAtLoss: "48250",
        zipCode: "60611",
        dateOfLoss: "2026-08-18",
        insurerName: "Example Insurance",
        insurerVehicleValuation: "",
        vehicleCondition: "",
        optionsPackages: "",
      },
      REFERENCE_DATE,
    );

    expect(emptyOptions).toMatchObject({
      vehicleCondition: null,
      optionsPackages: null,
    });
    expect(
      totalLossDetailsToManualForm({
        caseId: "22222222-2222-4222-8222-222222222222",
        intakeMode: "manual",
        vin: null,
        vehicleYear: 2020,
        vehicleMake: "Honda",
        vehicleModel: "Accord",
        vehicleTrim: "EX-L",
        mileageAtLoss: 48250,
        postalCode: "60611",
        dateOfLoss: "2026-08-18",
        insurerName: "Example Insurance",
        insurerVehicleValuation: null,
        vehicleCondition: null,
        optionsPackages: emptyOptions.optionsPackages ?? null,
        reportUploadRecoveryRequired: false,
        reportOriginalFilename: null,
        reportUploadedAt: null,
        intakeCompletedAt: null,
        createdAt: "2026-08-18T14:00:00.000Z",
        updatedAt: "2026-08-18T15:00:00.000Z",
      }),
    ).toMatchObject({ optionsPackages: "" });
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
      vehicleCondition: "",
      optionsPackages: "",
    };

    expect(
      totalLossManualFormToDetailsValues(form, REFERENCE_DATE),
    ).toMatchObject({
      vehicleYear: undefined,
      mileageAtLoss: undefined,
      dateOfLoss: undefined,
      insurerVehicleValuation: undefined,
    });
    expect(hasUnpersistedTotalLossManualValues(form, REFERENCE_DATE)).toBe(
      true,
    );
  });
});
