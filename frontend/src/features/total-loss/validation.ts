import type {
  TotalLossContactFormErrors,
  TotalLossContactFormValues,
  TotalLossManualFormErrors,
  TotalLossManualFormValues,
} from "@/features/total-loss/types";

export const MIN_TOTAL_LOSS_VEHICLE_YEAR = 1981;
export const MAX_TOTAL_LOSS_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_LOSS_PDF_MIB = 50;
export const MAX_TOTAL_LOSS_MILEAGE = 10_000_000;
export const MAX_INSURER_VALUATION_CENTS = 999_999_999_999;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const ZIP_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INTEGER_PATTERN = /^\d+$/;
const CURRENCY_PATTERN = /^\d+(?:\.(\d{1,2}))?$/;
const GROUPED_NUMBER_PATTERN = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const REPORT_FILE_TYPES = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
} as const;

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface TotalLossPdfCandidate {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export type TotalLossPdfValidationResult =
  | { readonly valid: true; readonly displayFilename: string }
  | { readonly valid: false; readonly error: string };

export function getMaximumTotalLossVehicleYear(referenceDate = new Date()) {
  return referenceDate.getFullYear() + 1;
}

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeVin(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeZipCode(value: string) {
  const trimmed = value.trim();
  return /^\d{9}$/.test(trimmed)
    ? `${trimmed.slice(0, 5)}-${trimmed.slice(5)}`
    : trimmed;
}

export function normalizeMileageInput(value: string) {
  const trimmed = value.trim();
  return /^\d{1,3}(?:,\d{3})+$/.test(trimmed)
    ? trimmed.replaceAll(",", "")
    : trimmed;
}

export function formatMileageInput(value: string) {
  const digits = value.replace(/\D/gu, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function normalizeCurrencyInput(value: string) {
  let trimmed = value.trim();
  if (trimmed.startsWith("$")) {
    trimmed = trimmed.slice(1).trim();
  }

  return GROUPED_NUMBER_PATTERN.test(trimmed)
    ? trimmed.replaceAll(",", "")
    : trimmed;
}

export function formatCurrencyInput(value: string) {
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

export function parseCurrencyToCents(value: string): number | null {
  const normalized = normalizeCurrencyInput(value);
  const match = CURRENCY_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  const [wholePart, decimalPart = ""] = normalized.split(".");
  const cents = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, "0"));

  if (!Number.isSafeInteger(cents) || cents > MAX_INSURER_VALUATION_CENTS) {
    return null;
  }

  return cents;
}

export function currencyCentsToDecimal(cents: number) {
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    cents > MAX_INSURER_VALUATION_CENTS
  ) {
    throw new RangeError("Currency cents are outside the supported range.");
  }

  const wholePart = Math.floor(cents / 100);
  const decimalPart = String(cents % 100).padStart(2, "0");
  return `${wholePart}.${decimalPart}`;
}

export function formatCurrencyFromCents(cents: number) {
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    cents > MAX_INSURER_VALUATION_CENTS
  ) {
    throw new RangeError("Currency cents are outside the supported range.");
  }

  return usdFormatter.format(cents / 100);
}

export function formatCurrencyValue(value: string): string | null {
  const cents = parseCurrencyToCents(value);
  return cents === null ? null : formatCurrencyFromCents(cents);
}

export function normalizeTotalLossManualForm(
  values: TotalLossManualFormValues,
): TotalLossManualFormValues {
  const valuationCents = parseCurrencyToCents(
    values.insurerVehicleValuation,
  );

  return {
    vin: normalizeVin(values.vin),
    vehicleYear: values.vehicleYear.trim(),
    make: normalizeWhitespace(values.make),
    model: normalizeWhitespace(values.model),
    trim: normalizeWhitespace(values.trim),
    mileageAtLoss: normalizeMileageInput(values.mileageAtLoss),
    zipCode: normalizeZipCode(values.zipCode),
    dateOfLoss: values.dateOfLoss.trim(),
    insurerName: normalizeWhitespace(values.insurerName),
    insurerVehicleValuation:
      valuationCents === null
        ? values.insurerVehicleValuation.trim()
        : currencyCentsToDecimal(valuationCents),
    vehicleCondition: normalizeWhitespace(values.vehicleCondition),
    optionsPackages: normalizeWhitespace(values.optionsPackages),
  };
}

export function validateVin(value: string): string | null {
  const normalized = normalizeVin(value);
  if (!normalized) {
    return "VIN is required.";
  }

  return VIN_PATTERN.test(normalized)
    ? null
    : "Enter a 17-character VIN without I, O, or Q.";
}

export function validateVehicleYear(
  value: string,
  referenceDate = new Date(),
): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return "Year is required.";
  }

  if (!/^\d{4}$/.test(normalized)) {
    return "Enter a valid four-digit vehicle year.";
  }

  const year = Number(normalized);
  const maximumYear = getMaximumTotalLossVehicleYear(referenceDate);
  return year >= MIN_TOTAL_LOSS_VEHICLE_YEAR && year <= maximumYear
    ? null
    : `Enter a year from ${MIN_TOTAL_LOSS_VEHICLE_YEAR} to ${maximumYear}.`;
}

export function validateMileage(value: string): string | null {
  const normalized = normalizeMileageInput(value);
  if (!normalized) {
    return "Mileage at date of loss is required.";
  }

  if (!INTEGER_PATTERN.test(normalized)) {
    return "Enter mileage as a nonnegative whole number.";
  }

  const mileage = Number(normalized);
  return Number.isSafeInteger(mileage) && mileage <= MAX_TOTAL_LOSS_MILEAGE
    ? null
    : "Mileage must be 10,000,000 or less.";
}

export function validateZipCode(value: string): string | null {
  const normalized = normalizeZipCode(value);
  if (!normalized) {
    return "ZIP code is required.";
  }

  return ZIP_CODE_PATTERN.test(normalized)
    ? null
    : "Enter a 5-digit ZIP code or ZIP+4.";
}

export function validateDateOfLoss(
  value: string,
  referenceDate = new Date(),
): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return "Date of loss is required.";
  }

  const parsed = parseIsoCalendarDate(normalized);
  if (!parsed) {
    return "Enter a valid date of loss.";
  }

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  return parsed.getTime() <= today.getTime()
    ? null
    : "Date of loss cannot be in the future.";
}

export function validateInsurerVehicleValuation(
  value: string,
): string | null {
  if (!value.trim()) {
    return null;
  }

  const cents = parseCurrencyToCents(value);
  if (cents === null) {
    return "Enter a valid amount with no more than two decimal places.";
  }

  return cents > 0
    ? null
    : "Insurer's vehicle valuation must be greater than zero.";
}

export function validateTotalLossManualForm(
  values: TotalLossManualFormValues,
  referenceDate = new Date(),
): TotalLossManualFormErrors {
  const errors: TotalLossManualFormErrors = {};
  const assignError = (
    field: keyof TotalLossManualFormValues,
    error: string | null,
  ) => {
    if (error) {
      errors[field] = error;
    }
  };

  if (normalizeVin(values.vin)) assignError("vin", validateVin(values.vin));
  assignError(
    "vehicleYear",
    validateVehicleYear(values.vehicleYear, referenceDate),
  );
  assignError("make", requiredTextError(values.make, "Make"));
  assignError("model", requiredTextError(values.model, "Model"));
  assignError("trim", requiredTextError(values.trim, "Trim"));
  assignError("mileageAtLoss", validateMileage(values.mileageAtLoss));
  assignError("zipCode", validateZipCode(values.zipCode));
  assignError(
    "dateOfLoss",
    validateDateOfLoss(values.dateOfLoss, referenceDate),
  );
  assignError(
    "insurerName",
    requiredTextError(values.insurerName, "Insurance company"),
  );
  assignError(
    "insurerVehicleValuation",
    validateInsurerVehicleValuation(values.insurerVehicleValuation),
  );
  assignError(
    "vehicleCondition",
    requiredTextError(values.vehicleCondition, "Vehicle condition"),
  );
  assignError(
    "optionsPackages",
    requiredTextError(values.optionsPackages, "Options and packages response"),
  );

  return errors;
}

export function hasTotalLossManualFormErrors(
  errors: TotalLossManualFormErrors,
) {
  return Object.keys(errors).length > 0;
}

export function sanitizeDisplayFilename(filename: string) {
  const basename = filename.split(/[\\/]/u).at(-1) ?? "";
  const sanitized = [...basename]
    .filter((character) => !isUnsafeDisplayCharacter(character))
    .join("")
    .trim()
    .replace(/\s+/gu, " ");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "valuation-report";
  }

  if (sanitized.length <= 255) {
    return sanitized;
  }

  const extension = /\.(?:pdf|jpe?g|png)$/iu.exec(sanitized)?.[0] ?? "";
  return `${sanitized.slice(0, 255 - extension.length).trimEnd()}${extension}`;
}

export function validateTotalLossPdf(
  file: TotalLossPdfCandidate,
): TotalLossPdfValidationResult {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { valid: false, error: "Choose a nonempty PDF report." };
  }

  if (file.size > MAX_TOTAL_LOSS_PDF_BYTES) {
    return {
      valid: false,
      error: `The PDF must be ${MAX_TOTAL_LOSS_PDF_MIB} MiB or smaller.`,
    };
  }

  const trimmedName = file.name.trim();
  if (
    !trimmedName ||
    trimmedName.length > 255 ||
    trimmedName.includes("/") ||
    trimmedName.includes("\\") ||
    [...trimmedName].some(isUnsafeDisplayCharacter) ||
    trimmedName === "." ||
    trimmedName === ".."
  ) {
    return { valid: false, error: "Choose a PDF with a safe filename." };
  }

  if (!/\.pdf$/iu.test(trimmedName)) {
    return { valid: false, error: "The report filename must end in .pdf." };
  }

  const mimeType = file.type.trim().toLowerCase();
  if (mimeType && mimeType !== "application/pdf") {
    return { valid: false, error: "The selected file is not a PDF." };
  }

  return {
    valid: true,
    displayFilename: sanitizeDisplayFilename(trimmedName),
  };
}

export function validateTotalLossReport(
  file: TotalLossPdfCandidate,
): TotalLossPdfValidationResult {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { valid: false, error: "Choose a nonempty valuation report." };
  }
  if (file.size > MAX_TOTAL_LOSS_PDF_BYTES) {
    return {
      valid: false,
      error: `Each report file must be ${MAX_TOTAL_LOSS_PDF_MIB} MiB or smaller.`,
    };
  }

  const trimmedName = file.name.trim();
  if (
    !trimmedName ||
    trimmedName.length > 255 ||
    trimmedName.includes("/") ||
    trimmedName.includes("\\") ||
    [...trimmedName].some(isUnsafeDisplayCharacter) ||
    trimmedName === "." ||
    trimmedName === ".."
  ) {
    return { valid: false, error: "Choose a report with a safe filename." };
  }

  const extension = /\.([a-z0-9]+)$/iu.exec(trimmedName)?.[1]?.toLowerCase();
  if (!extension || !(extension in REPORT_FILE_TYPES)) {
    return {
      valid: false,
      error: "Choose a PDF, JPG/JPEG, or PNG valuation report.",
    };
  }
  const allowedMimeTypes = REPORT_FILE_TYPES[
    extension as keyof typeof REPORT_FILE_TYPES
  ] as readonly string[];
  const mimeType = file.type.trim().toLowerCase();
  if (mimeType && !allowedMimeTypes.includes(mimeType)) {
    return {
      valid: false,
      error: "The file type does not match its filename.",
    };
  }

  return {
    valid: true,
    displayFilename: sanitizeDisplayFilename(trimmedName),
  };
}

export function normalizeTotalLossContactForm(
  values: TotalLossContactFormValues,
): TotalLossContactFormValues {
  return {
    ...values,
    fullName: normalizeWhitespace(values.fullName),
    email: values.email.trim().toLowerCase(),
  };
}

export function validateTotalLossContactForm(
  values: TotalLossContactFormValues,
): TotalLossContactFormErrors {
  const normalized = normalizeTotalLossContactForm(values);
  const errors: TotalLossContactFormErrors = {};
  if (!normalized.fullName || normalized.fullName.length > 200) {
    errors.fullName = normalized.fullName
      ? "Full name must be 200 characters or fewer."
      : "Enter your full name.";
  }
  if (
    !normalized.email ||
    normalized.email.length > 320 ||
    !EMAIL_PATTERN.test(normalized.email)
  ) {
    errors.email = "Enter a valid email address.";
  }
  if (!normalized.termsAccepted || !normalized.privacyAccepted) {
    errors.legal = "Accept the Terms of Use and acknowledge the Privacy Policy.";
  }
  return errors;
}

function requiredTextError(value: string, label: string) {
  return normalizeWhitespace(value) ? null : `${label} is required.`;
}

function isUnsafeDisplayCharacter(character: string) {
  const codePoint = character.codePointAt(0);
  return (
    codePoint === undefined ||
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function parseIsoCalendarDate(value: string) {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}
