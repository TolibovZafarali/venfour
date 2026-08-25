import { describe, expect, it } from "vitest";

import { createEmptyDiminishedValueDraft } from "./types";
import {
  formatDiminishedValueCurrency,
  formatDiminishedValueMileage,
  validateDiminishedValueAccidentRepairs,
  validateDiminishedValueConsultation,
  validateDiminishedValueStart,
  validateDiminishedValueVehicle,
} from "./validation";

const referenceDate = new Date(2026, 7, 18);

describe("diminished-value validation", () => {
  it("requires the concise start fields and rejects future accidents", () => {
    expect(
      validateDiminishedValueStart(
        createEmptyDiminishedValueDraft(),
        referenceDate,
      ),
    ).toEqual({
      accidentState: "State is required.",
      accidentDate: "Accident date is required.",
      repairStatus: "Repair status is required.",
    });

    expect(
      validateDiminishedValueStart(
        {
          ...createEmptyDiminishedValueDraft(),
          accidentState: "IL",
          accidentDate: "2026-08-19",
          repairStatus: "not-started",
        },
        referenceDate,
      ),
    ).toEqual({ accidentDate: "Accident date cannot be in the future." });
  });

  it("validates VIN and manual vehicle paths with optional current mileage", () => {
    const base = {
      ...createEmptyDiminishedValueDraft(),
      mileageAtAccident: "48,250",
    };

    expect(validateDiminishedValueVehicle(base, referenceDate)).toEqual({
      vin: "VIN is required.",
    });
    expect(
      validateDiminishedValueVehicle(
        { ...base, vin: "1HGCM82633A004352" },
        referenceDate,
      ),
    ).toEqual({});
    expect(
      validateDiminishedValueVehicle(
        {
          ...base,
          vehicleEntryMethod: "details",
          vehicleYear: "2024",
          make: "Honda",
          model: "Accord",
          trim: "EX-L",
          currentMileage: "49,100",
        },
        referenceDate,
      ),
    ).toEqual({});
  });

  it("requires evidence questions but keeps repair details optional", () => {
    expect(
      validateDiminishedValueAccidentRepairs(
        createEmptyDiminishedValueDraft(),
      ),
    ).toEqual({
      otherPartyAtFault: "At-fault party is required.",
      structuralDamage: "Structural or frame damage is required.",
      airbagDeployment: "Airbag deployment is required.",
    });

    expect(
      validateDiminishedValueAccidentRepairs({
        ...createEmptyDiminishedValueDraft(),
        otherPartyAtFault: "not-sure",
        repairCost: "$12.",
        structuralDamage: "no",
        airbagDeployment: "yes",
      }),
    ).toEqual({});

    expect(
      validateDiminishedValueAccidentRepairs({
        ...createEmptyDiminishedValueDraft(),
        otherPartyAtFault: "not-sure",
        repairCost: "12$34",
        structuralDamage: "no",
        airbagDeployment: "yes",
      }),
    ).toEqual({
      repairCost:
        "Enter a valid repair cost with no more than two decimal places.",
    });
  });

  it("requires consultation contact and time-zone availability", () => {
    expect(
      validateDiminishedValueConsultation(createEmptyDiminishedValueDraft()),
    ).toEqual({
      fullName: "Name is required.",
      email: "Email is required.",
      phone: "Phone is required.",
      preferredContactMethod: "Preferred contact method is required.",
      availability: "General availability and time zone are required.",
    });

    expect(
      validateDiminishedValueConsultation({
        ...createEmptyDiminishedValueDraft(),
        fullName: "Jordan Lee",
        email: "jordan@example.com",
        phone: "312-555-0123",
        preferredContactMethod: "email",
        availability: "Weekdays after 4 p.m. Central Time",
      }),
    ).toEqual({});

    expect(
      validateDiminishedValueConsultation({
        ...createEmptyDiminishedValueDraft(),
        fullName: "Jordan Lee",
        email: "jordan@example.com",
        phone: "312-555-0123",
        preferredContactMethod: "email",
        availability: "Weekdays after 4 p.m.",
      }),
    ).toEqual({
      availability: "Include your time zone (for example, Central Time or CT).",
    });
  });

  it("formats mileage and currency without changing stored meaning", () => {
    expect(formatDiminishedValueMileage("48250 miles")).toBe("48,250");
    expect(formatDiminishedValueCurrency("12500.5")).toBe("$12,500.5");
  });
});
