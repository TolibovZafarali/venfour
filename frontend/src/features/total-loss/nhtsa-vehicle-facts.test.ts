import { describe, expect, it } from "vitest";
import { decodedVehicleFacts } from "./nhtsa-vehicle-facts";
import { vehicleFacts, vehicleFactErrors } from "./vehicle-facts";
import { createEmptyTotalLossManualForm } from "./types";

const sedan = {
  BodyClass: "Sedan/Saloon", DriveType: "FWD/Front-Wheel Drive",
  FuelTypePrimary: "Gasoline", TransmissionStyle: "Automatic",
  EngineCylinders: "6", DisplacementL: "3.0", EngineConfiguration: "V-Shaped", Doors: "4",
};

describe("decoded vehicle specifications", () => {
  it("fills complete explicit facts in the persisted subject contract", () => {
    const facts = decodedVehicleFacts(sedan);
    expect(facts).toEqual({ bodyType: "Sedan", drivetrain: "FWD", fuelType: "Unleaded", transmission: "Automatic", engine: "3.0L V6", cylinders: "6", doors: "4" });
    expect(vehicleFacts(facts)).toEqual(facts);
    expect(vehicleFactErrors({ ...createEmptyTotalLossManualForm(), ...facts, trim: "EX-V6" })).toEqual({});
  });
  it("requires only the unresolved fact and never infers an axle from 4x2", () => {
    const facts = decodedVehicleFacts({ ...sedan, DriveType: "4x2" });
    expect(vehicleFactErrors({ ...createEmptyTotalLossManualForm(), ...facts, trim: "EX-V6" })).toEqual({ drivetrain: "Confirm drive type." });
  });
  it("retains explicit pickup dimensions and leaves absent cab and bed unresolved", () => {
    const pickup = { ...sedan, BodyClass: "Pickup", DriveType: "4WD/4-Wheel Drive/4x4" };
    expect(vehicleFactErrors({ ...createEmptyTotalLossManualForm(), ...decodedVehicleFacts(pickup), trim: "XL" })).toEqual({ cabType: "Confirm cab style.", bedLength: "Confirm bed length." });
    expect(decodedVehicleFacts({ ...pickup, BodyCabType: "Crew Cab", BedLengthIN: "67.0" })).toMatchObject({ cabType: "Crew Cab", bedLength: "67 in", drivetrain: "4WD" });
  });
  it("does not turn ambiguous, unsupported, invalid or empty decoded values into confirmed facts", () => {
    expect(decodedVehicleFacts({ BodyClass: "Other", DriveType: "Unknown", TransmissionStyle: "Automatic/Manual", FuelTypePrimary: "Gasoline", FuelTypeSecondary: "Natural Gas", EngineModel: "A/B", BodyCabType: "Regular/Extended", BedLengthIN: "0", Doors: "4\n", EngineCylinders: "unknown" })).toEqual({});
    expect(decodedVehicleFacts({ EngineModel: "x".repeat(201) })).toEqual({});
    expect(decodedVehicleFacts({})).toEqual({});
  });
  it("retains explicit hybrid fuel and turbo configuration without inventing missing engine details", () => {
    expect(decodedVehicleFacts({ ...sedan, FuelTypeSecondary: "Electric", Turbo: "Yes" })).toMatchObject({ fuelType: "Electric / Unleaded", engine: "3.0L V6 Turbo" });
    expect(decodedVehicleFacts({ FuelTypePrimary: "Electric" })).toEqual({ fuelType: "Electric" });
  });
});
