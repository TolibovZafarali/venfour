import { describe, expect, it } from "vitest";
import { createEmptyTotalLossManualForm } from "./types";
import { factsFromForm, vehicleFactErrors, clearVehicleFacts, vehicleFacts, sameVehicleFacts } from "./vehicle-facts";
import { createEmptyTotalLossDraft, writeTotalLossDraft, readTotalLossDraft } from "./draft";
import { totalLossDetailsToManualForm, totalLossManualFormToDetailsValues } from "./data-mappers";

const facts = { bodyType: "Sedan", drivetrain: "FWD", engine: "2.0L I4", fuelType: "Unleaded", transmission: "Automatic" };

describe("confirmed subject vehicle facts", () => {
  it("blocks the incomplete canary with named corrections", () => {
    expect(vehicleFactErrors({ ...createEmptyTotalLossManualForm(), vehicleYear: "2025", make: "Hyundai", model: "Elantra", trim: "SEL" }))
      .toEqual({ bodyType: "Confirm body style.", drivetrain: "Confirm drive type.", engine: "Confirm engine.", fuelType: "Confirm fuel type.", transmission: "Confirm transmission." });
  });
  it("accepts complete facts without a VIN, offer, or optional specifications", () => {
    expect(vehicleFactErrors({ ...createEmptyTotalLossManualForm(), ...facts, trim: "SEL" })).toEqual({});
  });
  it("requires a pickup cab and bed, and refuses unknown identity", () => {
    expect(vehicleFactErrors({ ...createEmptyTotalLossManualForm(), ...facts, bodyType: "Pickup", trim: "Other/Not sure" }))
      .toEqual({ cabType: "Confirm cab style.", bedLength: "Confirm bed length.", trim: "Confirm the trim or version shown on your vehicle documents." });
  });
  it("preserves authored facts through draft recovery and database mapping", () => {
    const manual = { ...createEmptyTotalLossManualForm(), ...facts, trim: "SEL" };
    const draft = { ...createEmptyTotalLossDraft(), manual };
    expect(writeTotalLossDraft(JSON.parse(JSON.stringify(draft)))).toEqual({ ok: true });
    expect(readTotalLossDraft()).toMatchObject({ ok: true, draft: { manual } });
    const values = totalLossManualFormToDetailsValues(manual);
    expect(values.vehicleFacts).toEqual(facts);
    expect(factsFromForm(totalLossDetailsToManualForm({
      ...values, intakeMode: "manual", caseId: "22222222-2222-4222-8222-222222222222",
      vin: null, vehicleYear: 2025, vehicleMake: "Hyundai", vehicleModel: "Elantra", vehicleTrim: "SEL",
      mileageAtLoss: 32000, postalCode: "63123", dateOfLoss: "2026-08-03", insurerName: "Example", insurerVehicleValuation: null,
      reportUploadRecoveryRequired: false, reportOriginalFilename: null, reportUploadedAt: null, intakeCompletedAt: null,
      createdAt: "2026-09-11T00:00:00Z", updatedAt: "2026-09-11T00:00:00Z",
    }))).toEqual(facts);
  });
  it("clears stale facts on vehicle change and never invents replacements", () => {
    expect(factsFromForm(clearVehicleFacts({ ...createEmptyTotalLossManualForm(), ...facts }))).toBeNull();
    expect(sameVehicleFacts(facts, { ...facts })).toBe(true);
    expect(() => vehicleFacts({ apiKey: "unexpected" })).toThrow();
  });
});
