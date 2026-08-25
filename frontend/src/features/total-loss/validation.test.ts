import { describe, expect, it } from "vitest";

import {
  currencyCentsToDecimal,
  formatCurrencyInput,
  formatCurrencyValue,
  formatMileageInput,
  formatUsPhoneNumberInput,
  getMaximumTotalLossVehicleYear,
  MAX_TOTAL_LOSS_MILEAGE,
  MAX_TOTAL_LOSS_PDF_BYTES,
  normalizeTotalLossManualForm,
  normalizeTotalLossContactForm,
  parseCurrencyToCents,
  sanitizeDisplayFilename,
  validateDateOfLoss,
  validateMileage,
  validateTotalLossManualForm,
  validateTotalLossContactForm,
  validateTotalLossPdf,
  validateVin,
} from "@/features/total-loss/validation";
import type {
  TotalLossContactFormValues,
  TotalLossManualFormValues,
} from "@/features/total-loss/types";

const REFERENCE_DATE = new Date(2026, 7, 18, 12);

const validContactForm: TotalLossContactFormValues = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.test",
  phoneNumber: "(312) 555-0182",
  termsAccepted: true,
  privacyAccepted: true,
  operationalFollowUpAllowed: false,
};

const validManualForm: TotalLossManualFormValues = {
  vin: "1HGCM82633A004352",
  vehicleYear: "2023",
  make: "Honda",
  model: "Accord",
  trim: "EX-L",
  mileageAtLoss: "31,250",
  zipCode: "60601-1234",
  dateOfLoss: "2026-08-18",
  insurerName: "Example Insurance",
  insurerVehicleValuation: "$20,500.50",
  vehicleCondition: "Good",
  optionsPackages: "Technology package",
};

describe("total-loss manual validation", () => {
  it("normalizes VIN, whitespace, ZIP, mileage, and currency", () => {
    expect(
      normalizeTotalLossManualForm({
        ...validManualForm,
        vin: " 1hgcm82633a004352 ",
        make: "  Alfa   Romeo ",
        trim: "  ",
        zipCode: "606011234",
      }),
    ).toEqual({
      ...validManualForm,
      vin: "1HGCM82633A004352",
      make: "Alfa Romeo",
      trim: "",
      mileageAtLoss: "31250",
      zipCode: "60601-1234",
      insurerVehicleValuation: "20500.50",
    });
  });

  it("requires confirmation of year, make, model, and trim even with a VIN", () => {
    expect(
      validateTotalLossManualForm(
        {
          ...validManualForm,
          vehicleYear: "",
          make: "",
          model: "",
          trim: "",
        },
        REFERENCE_DATE,
      ),
    ).toMatchObject({
      vehicleYear: expect.any(String),
      make: expect.any(String),
      model: expect.any(String),
      trim: expect.any(String),
    });
  });

  it("accepts guided vehicle selections when VIN is unavailable", () => {
    expect(
      validateTotalLossManualForm(
        { ...validManualForm, vin: "" },
        REFERENCE_DATE,
      ),
    ).toEqual({});
  });

  it("validates every required field", () => {
    const errors = validateTotalLossManualForm(
      {
        vin: "",
        vehicleYear: "",
        make: " ",
        model: "",
        trim: "",
        mileageAtLoss: "",
        zipCode: "",
        dateOfLoss: "",
        insurerName: "",
        insurerVehicleValuation: "",
        vehicleCondition: "",
        optionsPackages: "",
      },
      REFERENCE_DATE,
    );

    expect(Object.keys(errors)).toEqual([
      "vehicleYear",
      "make",
      "model",
      "trim",
      "mileageAtLoss",
      "zipCode",
      "dateOfLoss",
      "insurerName",
    ]);
    expect(errors).not.toHaveProperty("insurerVehicleValuation");
    expect(errors).not.toHaveProperty("vehicleCondition");
    expect(errors).not.toHaveProperty("optionsPackages");
  });

  it("does not require the removed condition or options fields", () => {
    expect(
      validateTotalLossManualForm(
        { ...validManualForm, vehicleCondition: "", optionsPackages: "" },
        REFERENCE_DATE,
      ),
    ).toEqual({});
  });

  it("enforces VIN characters without applying a checksum", () => {
    expect(validateVin("1hgcm82633a004352")).toBeNull();
    expect(validateVin("1HGCM82633A00435I")).toMatch(/without I, O, or Q/);
    expect(validateVin("1HGCM82633A00435")).toMatch(/17-character/);
  });

  it("enforces year, integer mileage, ZIP, nonfuture date, and valuation", () => {
    const errors = validateTotalLossManualForm(
      {
        ...validManualForm,
        vin: "",
        vehicleYear: String(getMaximumTotalLossVehicleYear(REFERENCE_DATE) + 1),
        mileageAtLoss: "-1",
        zipCode: "6060",
        dateOfLoss: "2026-08-19",
        insurerVehicleValuation: "0",
      },
      REFERENCE_DATE,
    );

    expect(errors.vehicleYear).toMatch(/1981/);
    expect(errors.mileageAtLoss).toMatch(/nonnegative whole number/);
    expect(errors.zipCode).toMatch(/ZIP\+4/);
    expect(errors.dateOfLoss).toMatch(/future/);
    expect(errors.insurerVehicleValuation).toMatch(/greater than zero/);
  });

  it("rejects invalid calendar dates and accepts today's local date", () => {
    expect(validateDateOfLoss("2026-02-29", REFERENCE_DATE)).toMatch(
      /valid date/,
    );
    expect(validateDateOfLoss("2026-08-18", REFERENCE_DATE)).toBeNull();
  });

  it("matches the analysis pipeline mileage ceiling", () => {
    expect(validateMileage(String(MAX_TOTAL_LOSS_MILEAGE))).toBeNull();
    expect(validateMileage(String(MAX_TOTAL_LOSS_MILEAGE + 1))).toBe(
      "Mileage must be 10,000,000 or less.",
    );
  });
});

describe("total-loss contact validation", () => {
  it("normalizes split names, email, and optional phone", () => {
    expect(
      normalizeTotalLossContactForm({
        ...validContactForm,
        firstName: "  Ada  ",
        lastName: "  Byron   Lovelace ",
        email: " ADA@EXAMPLE.TEST ",
        phoneNumber: "  (312)   555-0182 ",
      }),
    ).toMatchObject({
      firstName: "Ada",
      lastName: "Byron Lovelace",
      email: "ada@example.test",
      phoneNumber: "(312) 555-0182",
    });
  });

  it("requires first name, last name, email, and legal acknowledgement but not phone", () => {
    expect(
      validateTotalLossContactForm({
        ...validContactForm,
        firstName: "",
        lastName: "",
        email: "",
        phoneNumber: "",
        termsAccepted: false,
        privacyAccepted: false,
      }),
    ).toEqual({
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      email: "Enter a valid email address.",
      legal: "Accept the Terms of Use and acknowledge the Privacy Policy.",
    });
    expect(validateTotalLossContactForm(validContactForm)).toEqual({});
  });

  it("formats U.S. phone numbers progressively and keeps the field optional", () => {
    expect(formatUsPhoneNumberInput("5")).toBe("(5");
    expect(formatUsPhoneNumberInput("555123")).toBe("(555) 123");
    expect(formatUsPhoneNumberInput("5551234567")).toBe("(555) 123-4567");
    expect(formatUsPhoneNumberInput("+1 (555) 123-4567")).toBe(
      "(555) 123-4567",
    );
    expect(
      normalizeTotalLossContactForm({
        ...validContactForm,
        phoneNumber: "555-123-4567",
      }).phoneNumber,
    ).toBe("(555) 123-4567");
    expect(
      validateTotalLossContactForm({ ...validContactForm, phoneNumber: "" }),
    ).toEqual({});
    expect(
      validateTotalLossContactForm({
        ...validContactForm,
        phoneNumber: "(555) 12",
      }),
    ).toMatchObject({
      phoneNumber: "Enter a 10-digit U.S. phone number.",
    });
  });

  it("matches the persisted combined-name limit", () => {
    expect(
      validateTotalLossContactForm({
        ...validContactForm,
        firstName: "A".repeat(100),
        lastName: "B".repeat(100),
      }),
    ).toMatchObject({
      lastName: "First and last name must be 200 characters or fewer combined.",
    });
  });
});

describe("total-loss currency helpers", () => {
  it("groups mileage and money while the user is still typing", () => {
    expect(formatMileageInput("50000")).toBe("50,000");
    expect(formatMileageInput("50,000")).toBe("50,000");
    expect(formatCurrencyInput("18750")).toBe("$18,750");
    expect(formatCurrencyInput("$18,750.")).toBe("$18,750.");
    expect(formatCurrencyInput("$18,750.5")).toBe("$18,750.5");
  });

  it("parses and formats positive values exactly to cents", () => {
    expect(parseCurrencyToCents("$20,500.5")).toBe(2_050_050);
    expect(currencyCentsToDecimal(2_050_050)).toBe("20500.50");
    expect(formatCurrencyValue("20500.50")).toBe("$20,500.50");
  });

  it("rejects malformed, over-precise, and out-of-range currency", () => {
    expect(parseCurrencyToCents("1,2")).toBeNull();
    expect(parseCurrencyToCents("10.999")).toBeNull();
    expect(parseCurrencyToCents("10000000000.00")).toBeNull();
  });
});

describe("total-loss PDF validation", () => {
  it("accepts an application/pdf file at the inclusive size limit", () => {
    expect(
      validateTotalLossPdf({
        name: "Insurer Valuation.PDF",
        size: MAX_TOTAL_LOSS_PDF_BYTES,
        type: "application/pdf",
      }),
    ).toEqual({
      valid: true,
      displayFilename: "Insurer Valuation.PDF",
    });
  });

  it("accepts an empty MIME type only when the filename is PDF-compatible", () => {
    expect(
      validateTotalLossPdf({
        name: "valuation.pdf",
        size: 1,
        type: "",
      }).valid,
    ).toBe(true);
    expect(
      validateTotalLossPdf({ name: "valuation", size: 1, type: "" }),
    ).toMatchObject({ valid: false });
  });

  it("rejects empty, oversized, conflicting-MIME, and unsafe files", () => {
    expect(
      validateTotalLossPdf({
        name: "report.pdf",
        size: 0,
        type: "application/pdf",
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateTotalLossPdf({
        name: "report.pdf",
        size: MAX_TOTAL_LOSS_PDF_BYTES + 1,
        type: "application/pdf",
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateTotalLossPdf({
        name: "report.pdf",
        size: 1,
        type: "text/plain",
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateTotalLossPdf({
        name: "../report.pdf",
        size: 1,
        type: "application/pdf",
      }),
    ).toMatchObject({ valid: false });
  });

  it("sanitizes display-only filenames without preserving path controls", () => {
    expect(sanitizeDisplayFilename("..\\folder/report\u0000.pdf")).toBe(
      "report.pdf",
    );
    expect(sanitizeDisplayFilename("\u202ereport.pdf")).toBe("report.pdf");
  });
});
