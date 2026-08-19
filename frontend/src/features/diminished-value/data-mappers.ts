import type {
  CreateDiminishedValueDetailsValues,
  DiminishedValueCaseDetails,
  DiminishedValueDraftStep,
} from "./data-types";
import {
  createEmptyDiminishedValueDraft,
  type DiminishedValueDraft,
} from "./types";
import {
  formatDiminishedValueCurrency,
  formatDiminishedValueMileage,
  normalizeDiminishedValueVin,
} from "./validation";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const NUMERIC_12_2_MAX = 9_999_999_999.99;
const INTEGER_PATTERN = /^\d+$/u;
const CURRENCY_PATTERN = /^\d+(?:\.\d{0,2})?$/u;

export function diminishedValueDraftToDetailsValues(
  draft: DiminishedValueDraft,
): CreateDiminishedValueDetailsValues {
  return {
    draftStep: editableStep(draft.step),
    accidentState: uppercaseOrNull(draft.accidentState),
    accidentDate: singleLineOrNull(draft.accidentDate),
    repairStatus: draft.repairStatus || null,
    vehicleEntryMethod: draft.vehicleEntryMethod,
    vin: nullableVin(draft.vin),
    vehicleYear: parseOptionalInteger(draft.vehicleYear, 9_999),
    vehicleMake: singleLineOrNull(draft.make),
    vehicleModel: singleLineOrNull(draft.model),
    vehicleTrim: singleLineOrNull(draft.trim),
    mileageAtAccident: parseOptionalInteger(
      draft.mileageAtAccident,
      POSTGRES_INTEGER_MAX,
    ),
    currentMileage: parseOptionalInteger(
      draft.currentMileage,
      POSTGRES_INTEGER_MAX,
    ),
    otherPartyAtFault: draft.otherPartyAtFault || null,
    atFaultInsurer: singleLineOrNull(draft.atFaultInsurer),
    repairCost: parseOptionalCurrency(draft.repairCost),
    repairFacility: singleLineOrNull(draft.repairFacility),
    structuralDamage: draft.structuralDamage || null,
    airbagDeployment: draft.airbagDeployment || null,
    majorRepairDetails: multilineOrNull(draft.majorRepairDetails),
    fullName: singleLineOrNull(draft.fullName),
    email: lowercaseOrNull(draft.email),
    phone: singleLineOrNull(draft.phone),
    preferredContactMethod: draft.preferredContactMethod || null,
    availability: multilineOrNull(draft.availability),
    notes: multilineOrNull(draft.notes),
  };
}

export function diminishedValueDetailsToDraft(
  details: DiminishedValueCaseDetails,
): DiminishedValueDraft {
  return {
    ...createEmptyDiminishedValueDraft(),
    step: details.submittedAt ? "complete" : details.draftStep,
    returnAfterStartEdit: false,
    accidentState: details.accidentState ?? "",
    accidentDate: details.accidentDate ?? "",
    repairStatus: details.repairStatus ?? "",
    vehicleEntryMethod: details.vehicleEntryMethod,
    vin: details.vin ?? "",
    vehicleYear:
      details.vehicleYear === null ? "" : String(details.vehicleYear),
    make: details.vehicleMake ?? "",
    model: details.vehicleModel ?? "",
    trim: details.vehicleTrim ?? "",
    mileageAtAccident: formatOptionalMileage(details.mileageAtAccident),
    currentMileage: formatOptionalMileage(details.currentMileage),
    otherPartyAtFault: details.otherPartyAtFault ?? "",
    atFaultInsurer: details.atFaultInsurer ?? "",
    repairCost: formatOptionalCurrency(details.repairCost),
    repairFacility: details.repairFacility ?? "",
    structuralDamage: details.structuralDamage ?? "",
    airbagDeployment: details.airbagDeployment ?? "",
    majorRepairDetails: details.majorRepairDetails ?? "",
    fullName: details.fullName ?? "",
    email: details.email ?? "",
    phone: details.phone ?? "",
    preferredContactMethod: details.preferredContactMethod ?? "",
    availability: details.availability ?? "",
    notes: details.notes ?? "",
  };
}

function editableStep(step: DiminishedValueDraft["step"]): DiminishedValueDraftStep {
  return step === "complete" ? "consultation" : step;
}

function singleLineOrNull(value: string) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized || null;
}

function multilineOrNull(value: string) {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized || null;
}

function uppercaseOrNull(value: string) {
  return singleLineOrNull(value)?.toUpperCase() ?? null;
}

function lowercaseOrNull(value: string) {
  return singleLineOrNull(value)?.toLowerCase() ?? null;
}

function nullableVin(value: string) {
  const normalized = normalizeDiminishedValueVin(value);
  return normalized || null;
}

function parseOptionalInteger(
  value: string,
  maximum: number,
): number | null | undefined {
  const normalized = value.replaceAll(",", "").trim();
  if (!normalized) return null;
  if (!INTEGER_PATTERN.test(normalized)) return undefined;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

function parseOptionalCurrency(value: string): number | null | undefined {
  let normalized = value.trim();
  if (!normalized) return null;
  if (normalized.startsWith("$")) {
    normalized = normalized.slice(1).trim();
  }
  normalized = normalized.replaceAll(",", "");
  if (!CURRENCY_PATTERN.test(normalized)) return undefined;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed <= NUMERIC_12_2_MAX
    ? parsed
    : undefined;
}

function formatOptionalMileage(value: number | null) {
  return value === null ? "" : formatDiminishedValueMileage(String(value));
}

function formatOptionalCurrency(value: number | null) {
  return value === null ? "" : formatDiminishedValueCurrency(String(value));
}
