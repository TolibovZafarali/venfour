import {
  createEmptyTotalLossManualForm,
  TOTAL_LOSS_DRAFT_VERSION,
  TOTAL_LOSS_INTAKE_MODES,
  TOTAL_LOSS_INTAKE_STEPS,
  TOTAL_LOSS_PENDING_AUTH_ACTIONS,
  type TotalLossDraft,
  type TotalLossManualFormValues,
} from "@/features/total-loss/types";

export { TOTAL_LOSS_DRAFT_VERSION } from "@/features/total-loss/types";

export const TOTAL_LOSS_DRAFT_STORAGE_KEY = "venfour.totalLossDraft.v1";

export interface TotalLossDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type TotalLossDraftReadResult =
  | { readonly ok: true; readonly draft: TotalLossDraft | null }
  | {
      readonly ok: false;
      readonly draft: null;
      readonly reason: "storage-unavailable" | "read-failed" | "corrupt";
      readonly removedCorruptValue?: boolean;
    };

export type TotalLossDraftWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "storage-unavailable"
        | "invalid-draft"
        | "write-failed";
    };

export type TotalLossDraftClearResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "storage-unavailable" | "remove-failed";
    };

const DRAFT_KEYS = [
  "version",
  "mode",
  "step",
  "manual",
  "confirmedCaseId",
  "reservedCaseId",
  "ownerUserId",
  "pendingAuthAction",
  "dirty",
  "revision",
  "dismissedResumeCaseId",
  "lastUpdatedAt",
] as const;

const MANUAL_FORM_KEYS = [
  "vin",
  "vehicleYear",
  "make",
  "model",
  "trim",
  "mileageAtLoss",
  "zipCode",
  "dateOfLoss",
  "insurerName",
  "insurerVehicleValuation",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createEmptyTotalLossDraft(
  referenceDate = new Date(),
): TotalLossDraft {
  return {
    version: TOTAL_LOSS_DRAFT_VERSION,
    mode: null,
    step: "choice",
    manual: createEmptyTotalLossManualForm(),
    confirmedCaseId: null,
    reservedCaseId: null,
    ownerUserId: null,
    pendingAuthAction: null,
    dirty: false,
    revision: 0,
    dismissedResumeCaseId: null,
    lastUpdatedAt: referenceDate.toISOString(),
  };
}

export function readTotalLossDraft(
  storage?: TotalLossDraftStorage | null,
): TotalLossDraftReadResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return {
      ok: false,
      draft: null,
      reason: "storage-unavailable",
    };
  }

  let serializedDraft: string | null;
  try {
    serializedDraft = resolvedStorage.getItem(TOTAL_LOSS_DRAFT_STORAGE_KEY);
  } catch {
    return { ok: false, draft: null, reason: "read-failed" };
  }

  if (serializedDraft === null) {
    return { ok: true, draft: null };
  }

  let parsedDraft: unknown;
  try {
    parsedDraft = JSON.parse(serializedDraft) as unknown;
  } catch {
    return corruptResult(resolvedStorage);
  }

  const draft = toTotalLossDraft(parsedDraft);
  return draft ? { ok: true, draft } : corruptResult(resolvedStorage);
}

export function writeTotalLossDraft(
  draft: TotalLossDraft,
  storage?: TotalLossDraftStorage | null,
): TotalLossDraftWriteResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, reason: "storage-unavailable" };
  }

  const safeDraft = toTotalLossDraft(draft);
  if (!safeDraft) {
    return { ok: false, reason: "invalid-draft" };
  }

  try {
    resolvedStorage.setItem(
      TOTAL_LOSS_DRAFT_STORAGE_KEY,
      JSON.stringify(safeDraft),
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

export function clearTotalLossDraft(
  storage?: TotalLossDraftStorage | null,
): TotalLossDraftClearResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, reason: "storage-unavailable" };
  }

  try {
    resolvedStorage.removeItem(TOTAL_LOSS_DRAFT_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, reason: "remove-failed" };
  }
}

export function isTotalLossDraft(value: unknown): value is TotalLossDraft {
  return toTotalLossDraft(value) !== null;
}

function resolveStorage(storage: TotalLossDraftStorage | null | undefined) {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function corruptResult(
  storage: TotalLossDraftStorage,
): TotalLossDraftReadResult {
  let removedCorruptValue = false;
  try {
    storage.removeItem(TOTAL_LOSS_DRAFT_STORAGE_KEY);
    removedCorruptValue = true;
  } catch {
    // A failed cleanup remains non-fatal; the caller can still start fresh.
  }

  return {
    ok: false,
    draft: null,
    reason: "corrupt",
    removedCorruptValue,
  };
}

function toTotalLossDraft(value: unknown): TotalLossDraft | null {
  try {
    if (!isRecord(value) || !hasExactKeys(value, DRAFT_KEYS)) {
      return null;
    }

    if (
      value.version !== TOTAL_LOSS_DRAFT_VERSION ||
      !isNullableMember(value.mode, TOTAL_LOSS_INTAKE_MODES) ||
      !isMember(value.step, TOTAL_LOSS_INTAKE_STEPS) ||
      !isManualFormValues(value.manual) ||
      !isNullableUuid(value.confirmedCaseId) ||
      !isNullableUuid(value.reservedCaseId) ||
      !isNullableUuid(value.ownerUserId) ||
      !isNullableMember(
        value.pendingAuthAction,
        TOTAL_LOSS_PENDING_AUTH_ACTIONS,
      ) ||
      typeof value.dirty !== "boolean" ||
      typeof value.revision !== "number" ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !isNullableUuid(value.dismissedResumeCaseId) ||
      !isCanonicalIsoTimestamp(value.lastUpdatedAt)
    ) {
      return null;
    }

    return {
      version: TOTAL_LOSS_DRAFT_VERSION,
      mode: value.mode,
      step: value.step,
      manual: copyManualForm(value.manual),
      confirmedCaseId: value.confirmedCaseId,
      reservedCaseId: value.reservedCaseId,
      ownerUserId: value.ownerUserId,
      pendingAuthAction: value.pendingAuthAction,
      dirty: value.dirty,
      revision: value.revision,
      dismissedResumeCaseId: value.dismissedResumeCaseId,
      lastUpdatedAt: value.lastUpdatedAt,
    };
  } catch {
    return null;
  }
}

function isManualFormValues(value: unknown): value is TotalLossManualFormValues {
  return (
    isRecord(value) &&
    hasExactKeys(value, MANUAL_FORM_KEYS) &&
    MANUAL_FORM_KEYS.every((key) => typeof value[key] === "string")
  );
}

function copyManualForm(
  value: TotalLossManualFormValues,
): TotalLossManualFormValues {
  return {
    vin: value.vin,
    vehicleYear: value.vehicleYear,
    make: value.make,
    model: value.model,
    trim: value.trim,
    mileageAtLoss: value.mileageAtLoss,
    zipCode: value.zipCode,
    dateOfLoss: value.dateOfLoss,
    insurerName: value.insurerName,
    insurerVehicleValuation: value.insurerVehicleValuation,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function isMember<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === "string" && values.some((item) => item === value);
}

function isNullableMember<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] | null {
  return value === null || isMember(value, values);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}
