import { describe, expect, it } from "vitest";

import type { DiminishedValueCaseDetails } from "./data-types";
import {
  diminishedValueDetailsToDraft,
  diminishedValueDraftToDetailsValues,
} from "./data-mappers";
import { createEmptyDiminishedValueDraft } from "./types";

const details: DiminishedValueCaseDetails = {
  caseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  draftStep: "accident-repairs",
  accidentState: "IL",
  accidentDate: "2026-08-01",
  repairStatus: "in-progress",
  vehicleEntryMethod: "details",
  vin: null,
  vehicleYear: 2024,
  vehicleMake: "Honda",
  vehicleModel: "Accord",
  vehicleTrim: "EX-L",
  mileageAtAccident: 48_250,
  currentMileage: 49_100,
  otherPartyAtFault: "not-sure",
  atFaultInsurer: "Example Mutual",
  repairCost: 12_500.5,
  repairFacility: "Example Collision",
  structuralDamage: "no",
  airbagDeployment: "yes",
  majorRepairDetails: "Replaced the left front door.",
  fullName: "Jordan Lee",
  email: "jordan@example.com",
  phone: "312-555-0123",
  preferredContactMethod: "email",
  availability: "Weekdays after 4 p.m. Central Time",
  notes: "Please email first.",
  revision: 3,
  submittedAt: null,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:05:00.000Z",
};

describe("diminished-value data mappers", () => {
  it("normalizes every persisted intake value without persisting UI-only state", () => {
    const values = diminishedValueDraftToDetailsValues({
      ...createEmptyDiminishedValueDraft(),
      step: "complete",
      returnAfterStartEdit: true,
      accidentState: " il ",
      accidentDate: " 2026-08-01 ",
      repairStatus: "not-started",
      vehicleEntryMethod: "details",
      vin: " 1hgcm82633a004352 ",
      vehicleYear: " 2024 ",
      make: "  Honda   Motor  ",
      model: " Accord ",
      trim: " EX-L ",
      mileageAtAccident: "48,250",
      currentMileage: "49,100",
      otherPartyAtFault: "not-sure",
      atFaultInsurer: " Example   Mutual ",
      repairCost: " $12,500.50 ",
      repairFacility: " Example   Collision ",
      structuralDamage: "no",
      airbagDeployment: "yes",
      majorRepairDetails: "  First line.\r\nSecond line.  ",
      fullName: " Jordan   Lee ",
      email: " JORDAN@EXAMPLE.COM ",
      phone: " 312-555-0123 ",
      preferredContactMethod: "email",
      availability: "  Weekdays after 4 p.m. Central Time  ",
      notes: "  Please email first.  ",
    });

    expect(values).toEqual({
      draftStep: "consultation",
      accidentState: "IL",
      accidentDate: "2026-08-01",
      repairStatus: "not-started",
      vehicleEntryMethod: "details",
      vin: "1HGCM82633A004352",
      vehicleYear: 2024,
      vehicleMake: "Honda Motor",
      vehicleModel: "Accord",
      vehicleTrim: "EX-L",
      mileageAtAccident: 48_250,
      currentMileage: 49_100,
      otherPartyAtFault: "not-sure",
      atFaultInsurer: "Example Mutual",
      repairCost: 12_500.5,
      repairFacility: "Example Collision",
      structuralDamage: "no",
      airbagDeployment: "yes",
      majorRepairDetails: "First line.\nSecond line.",
      fullName: "Jordan Lee",
      email: "jordan@example.com",
      phone: "312-555-0123",
      preferredContactMethod: "email",
      availability: "Weekdays after 4 p.m. Central Time",
      notes: "Please email first.",
    });
    expect(values).not.toHaveProperty("returnAfterStartEdit");
    expect(values).not.toHaveProperty("submittedAt");
  });

  it("maps empty optional strings to null and leaves invalid typed numbers local", () => {
    const emptyValues = diminishedValueDraftToDetailsValues(
      createEmptyDiminishedValueDraft(),
    );

    expect(emptyValues.vehicleYear).toBeNull();
    expect(emptyValues.mileageAtAccident).toBeNull();
    expect(emptyValues.currentMileage).toBeNull();
    expect(emptyValues.repairCost).toBeNull();

    const values = diminishedValueDraftToDetailsValues({
      ...createEmptyDiminishedValueDraft(),
      vehicleYear: "twenty twenty-four",
      mileageAtAccident: "48k",
      currentMileage: "999999999999999",
      repairCost: "$12.345",
    });

    expect(values.accidentState).toBeNull();
    expect(values.repairStatus).toBeNull();
    expect(values.vehicleMake).toBeNull();
    expect(values.atFaultInsurer).toBeNull();
    expect(values.notes).toBeNull();
    expect(values.vehicleYear).toBeUndefined();
    expect(values.mileageAtAccident).toBeUndefined();
    expect(values.currentMileage).toBeUndefined();
    expect(values.repairCost).toBeUndefined();
  });

  it("hydrates an editable server draft and formats numeric values for the UI", () => {
    expect(diminishedValueDetailsToDraft(details)).toEqual({
      step: "accident-repairs",
      returnAfterStartEdit: false,
      accidentState: "IL",
      accidentDate: "2026-08-01",
      repairStatus: "in-progress",
      vehicleEntryMethod: "details",
      vin: "",
      vehicleYear: "2024",
      make: "Honda",
      model: "Accord",
      trim: "EX-L",
      mileageAtAccident: "48,250",
      currentMileage: "49,100",
      otherPartyAtFault: "not-sure",
      atFaultInsurer: "Example Mutual",
      repairCost: "$12,500.5",
      repairFacility: "Example Collision",
      structuralDamage: "no",
      airbagDeployment: "yes",
      majorRepairDetails: "Replaced the left front door.",
      fullName: "Jordan Lee",
      email: "jordan@example.com",
      phone: "312-555-0123",
      preferredContactMethod: "email",
      availability: "Weekdays after 4 p.m. Central Time",
      notes: "Please email first.",
    });
  });

  it("hydrates complete only from an authoritative submission timestamp", () => {
    expect(
      diminishedValueDetailsToDraft({
        ...details,
        draftStep: "consultation",
        submittedAt: "2026-08-19T12:10:00.000Z",
      }).step,
    ).toBe("complete");

    expect(
      diminishedValueDetailsToDraft({
        ...details,
        draftStep: "consultation",
        submittedAt: null,
      }).step,
    ).toBe("consultation");
  });
});
