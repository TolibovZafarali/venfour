import type {
  DiminishedValueDraft,
  DiminishedValueFormErrors,
  DiminishedValueFormField,
} from "./types";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/u;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const INTEGER_PATTERN = /^\d+$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TIME_ZONE_PATTERN =
  /\b(?:eastern|central|mountain|pacific|alaska|hawaii(?:-aleutian)?|atlantic|arizona|ET|CT|MT|PT|AKT|HST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|UTC|GMT)(?:\s+time)?\b|\bAmerica\/[A-Za-z_]+\b/iu;

const MAX_INTEGER = 2_147_483_647;
const MIN_VEHICLE_YEAR = 1981;

export function maximumDiminishedValueVehicleYear(referenceDate = new Date()) {
  return referenceDate.getFullYear() + 1;
}

export function normalizeDiminishedValueVin(value: string) {
  return value.trim().toUpperCase();
}

export function formatDiminishedValueMileage(value: string) {
  const digits = value.replace(/\D/gu, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function formatDiminishedValueCurrency(value: string) {
  const unformatted = value.replaceAll("$", "").replaceAll(",", "").trim();
  if (!unformatted) return "";

  const sanitized = unformatted.replace(/[^\d.]/gu, "");
  if (!sanitized) return "";
  const decimalIndex = sanitized.indexOf(".");
  const hasDecimal = decimalIndex >= 0;
  const wholeRaw = hasDecimal ? sanitized.slice(0, decimalIndex) : sanitized;
  const decimalRaw = hasDecimal
    ? sanitized.slice(decimalIndex + 1).replaceAll(".", "").slice(0, 2)
    : "";
  const whole = wholeRaw.replace(/^0+(?=\d)/u, "") || "0";
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `$${groupedWhole}${hasDecimal ? `.${decimalRaw}` : ""}`;
}

export function validateDiminishedValueStart(
  draft: DiminishedValueDraft,
  referenceDate = new Date(),
): DiminishedValueFormErrors {
  const errors: DiminishedValueFormErrors = {};
  assign(errors, "accidentState", required(draft.accidentState, "State"));
  assign(
    errors,
    "accidentDate",
    validateAccidentDate(draft.accidentDate, referenceDate),
  );
  assign(
    errors,
    "repairStatus",
    required(draft.repairStatus, "Repair status"),
  );
  return errors;
}

export function validateDiminishedValueVehicle(
  draft: DiminishedValueDraft,
  referenceDate = new Date(),
): DiminishedValueFormErrors {
  const errors: DiminishedValueFormErrors = {};
  if (draft.vehicleEntryMethod === "vin") {
    const vin = normalizeDiminishedValueVin(draft.vin);
    assign(
      errors,
      "vin",
      !vin
        ? "VIN is required."
        : VIN_PATTERN.test(vin)
          ? null
          : "Enter a 17-character VIN without I, O, or Q.",
    );
  } else {
    const maximumYear = maximumDiminishedValueVehicleYear(referenceDate);
    const year = Number(draft.vehicleYear);
    assign(
      errors,
      "vehicleYear",
      !draft.vehicleYear.trim()
        ? "Year is required."
        : /^\d{4}$/u.test(draft.vehicleYear) &&
            year >= MIN_VEHICLE_YEAR &&
            year <= maximumYear
          ? null
          : `Enter a year from ${MIN_VEHICLE_YEAR} to ${maximumYear}.`,
    );
    assign(errors, "make", required(draft.make, "Make"));
    assign(errors, "model", required(draft.model, "Model"));
  }

  assign(
    errors,
    "mileageAtAccident",
    validateMileage(draft.mileageAtAccident, "Mileage at the accident", true),
  );
  assign(
    errors,
    "currentMileage",
    validateMileage(draft.currentMileage, "Current mileage", false),
  );
  return errors;
}

export function validateDiminishedValueAccidentRepairs(
  draft: DiminishedValueDraft,
): DiminishedValueFormErrors {
  const errors: DiminishedValueFormErrors = {};
  assign(
    errors,
    "otherPartyAtFault",
    required(draft.otherPartyAtFault, "At-fault party"),
  );
  assign(
    errors,
    "structuralDamage",
    required(draft.structuralDamage, "Structural or frame damage"),
  );
  assign(
    errors,
    "airbagDeployment",
    required(draft.airbagDeployment, "Airbag deployment"),
  );
  return errors;
}

export function validateDiminishedValueConsultation(
  draft: DiminishedValueDraft,
): DiminishedValueFormErrors {
  const errors: DiminishedValueFormErrors = {};
  assign(errors, "fullName", required(draft.fullName, "Name"));
  assign(
    errors,
    "email",
    !draft.email.trim()
      ? "Email is required."
      : EMAIL_PATTERN.test(draft.email.trim())
        ? null
        : "Enter a valid email address.",
  );
  assign(errors, "phone", required(draft.phone, "Phone"));
  assign(
    errors,
    "preferredContactMethod",
    required(draft.preferredContactMethod, "Preferred contact method"),
  );
  assign(
    errors,
    "availability",
    !draft.availability.trim()
      ? "General availability and time zone are required."
      : TIME_ZONE_PATTERN.test(draft.availability)
        ? null
        : "Include your time zone (for example, Central Time or CT).",
  );
  return errors;
}

export function hasDiminishedValueErrors(errors: DiminishedValueFormErrors) {
  return Object.keys(errors).length > 0;
}

function validateAccidentDate(value: string, referenceDate: Date) {
  if (!value.trim()) return "Accident date is required.";
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return "Enter a valid accident date.";

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return "Enter a valid accident date.";
  }

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  return parsed.getTime() <= today.getTime()
    ? null
    : "Accident date cannot be in the future.";
}

function validateMileage(value: string, label: string, requiredValue: boolean) {
  const normalized = value.replaceAll(",", "").trim();
  if (!normalized) return requiredValue ? `${label} is required.` : null;
  if (!INTEGER_PATTERN.test(normalized)) {
    return "Enter mileage as a nonnegative whole number.";
  }
  const numericValue = Number(normalized);
  return Number.isSafeInteger(numericValue) && numericValue <= MAX_INTEGER
    ? null
    : "Mileage is too large.";
}

function required(value: string, label: string) {
  return value.trim() ? null : `${label} is required.`;
}

function assign(
  errors: DiminishedValueFormErrors,
  field: DiminishedValueFormField,
  error: string | null,
) {
  if (error) errors[field] = error;
}
