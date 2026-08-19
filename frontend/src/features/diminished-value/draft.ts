import {
  createEmptyDiminishedValueDraft,
  DIMINISHED_VALUE_ANSWER_OPTIONS,
  DIMINISHED_VALUE_CONTACT_METHODS,
  DIMINISHED_VALUE_REPAIR_STATUSES,
  type DiminishedValueDraft,
} from "./types";

export const DIMINISHED_VALUE_DRAFT_VERSION = 1 as const;
export const DIMINISHED_VALUE_DRAFT_STORAGE_KEY =
  "venfour.diminishedValueDraft.v1";

export const DIMINISHED_VALUE_PENDING_AUTH_ACTIONS = [
  "upload-documents",
  "submit-review",
] as const;

export type DiminishedValuePendingAuthAction =
  (typeof DIMINISHED_VALUE_PENDING_AUTH_ACTIONS)[number];

export interface DiminishedValueDraftEnvelope {
  readonly version: typeof DIMINISHED_VALUE_DRAFT_VERSION;
  readonly intake: DiminishedValueDraft;
  readonly confirmedCaseId: string | null;
  readonly reservedCaseId: string | null;
  readonly ownerUserId: string | null;
  readonly pendingAuthAction: DiminishedValuePendingAuthAction | null;
  readonly dirty: boolean;
  readonly revision: number;
  readonly serverRevision: number | null;
  readonly dismissedResumeCaseId: string | null;
  readonly lastUpdatedAt: string;
}

export interface DiminishedValueDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DiminishedValueDraftReadResult =
  | { readonly ok: true; readonly envelope: DiminishedValueDraftEnvelope | null }
  | {
      readonly ok: false;
      readonly envelope: null;
      readonly reason: "storage-unavailable" | "read-failed" | "corrupt";
      readonly removedCorruptValue?: boolean;
    };

export type DiminishedValueDraftWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "storage-unavailable"
        | "invalid-envelope"
        | "write-failed";
    };

export type DiminishedValueDraftClearResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "storage-unavailable" | "remove-failed";
    };

const ENVELOPE_KEYS = [
  "version",
  "intake",
  "confirmedCaseId",
  "reservedCaseId",
  "ownerUserId",
  "pendingAuthAction",
  "dirty",
  "revision",
  "serverRevision",
  "dismissedResumeCaseId",
  "lastUpdatedAt",
] as const;

const INTAKE_KEYS = [
  "step",
  "returnAfterStartEdit",
  "accidentState",
  "accidentDate",
  "repairStatus",
  "vehicleEntryMethod",
  "vin",
  "vehicleYear",
  "make",
  "model",
  "trim",
  "mileageAtAccident",
  "currentMileage",
  "otherPartyAtFault",
  "atFaultInsurer",
  "repairCost",
  "repairFacility",
  "structuralDamage",
  "airbagDeployment",
  "majorRepairDetails",
  "fullName",
  "email",
  "phone",
  "preferredContactMethod",
  "availability",
  "notes",
] as const satisfies readonly (keyof DiminishedValueDraft)[];

const EDITABLE_DIMINISHED_VALUE_STEPS = [
  "start",
  "vehicle",
  "accident-repairs",
  "consultation",
] as const;

const STRING_INTAKE_KEYS = [
  "accidentState",
  "accidentDate",
  "vin",
  "vehicleYear",
  "make",
  "model",
  "trim",
  "mileageAtAccident",
  "currentMileage",
  "atFaultInsurer",
  "repairCost",
  "repairFacility",
  "majorRepairDetails",
  "fullName",
  "email",
  "phone",
  "availability",
  "notes",
] as const satisfies readonly (keyof DiminishedValueDraft)[];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function createEmptyDiminishedValueDraftEnvelope(
  referenceDate = new Date(),
): DiminishedValueDraftEnvelope {
  return {
    version: DIMINISHED_VALUE_DRAFT_VERSION,
    intake: createEmptyDiminishedValueDraft(),
    confirmedCaseId: null,
    reservedCaseId: null,
    ownerUserId: null,
    pendingAuthAction: null,
    dirty: false,
    revision: 0,
    serverRevision: null,
    dismissedResumeCaseId: null,
    lastUpdatedAt: referenceDate.toISOString(),
  };
}

export function readDiminishedValueDraftEnvelope(
  storage?: DiminishedValueDraftStorage | null,
): DiminishedValueDraftReadResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return {
      ok: false,
      envelope: null,
      reason: "storage-unavailable",
    };
  }

  let serializedEnvelope: string | null;
  try {
    serializedEnvelope = resolvedStorage.getItem(
      DIMINISHED_VALUE_DRAFT_STORAGE_KEY,
    );
  } catch {
    return { ok: false, envelope: null, reason: "read-failed" };
  }

  if (serializedEnvelope === null) {
    return { ok: true, envelope: null };
  }

  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(serializedEnvelope) as unknown;
  } catch {
    return corruptResult(resolvedStorage);
  }

  const envelope = toDiminishedValueDraftEnvelope(parsedEnvelope);
  return envelope
    ? { ok: true, envelope }
    : corruptResult(resolvedStorage);
}

export function writeDiminishedValueDraftEnvelope(
  envelope: DiminishedValueDraftEnvelope,
  storage?: DiminishedValueDraftStorage | null,
): DiminishedValueDraftWriteResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, reason: "storage-unavailable" };
  }

  const safeEnvelope = toDiminishedValueDraftEnvelope(envelope);
  if (!safeEnvelope) {
    return { ok: false, reason: "invalid-envelope" };
  }

  try {
    resolvedStorage.setItem(
      DIMINISHED_VALUE_DRAFT_STORAGE_KEY,
      JSON.stringify(safeEnvelope),
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

export function clearDiminishedValueDraftEnvelope(
  storage?: DiminishedValueDraftStorage | null,
): DiminishedValueDraftClearResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, reason: "storage-unavailable" };
  }

  try {
    resolvedStorage.removeItem(DIMINISHED_VALUE_DRAFT_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, reason: "remove-failed" };
  }
}

export function isDiminishedValueDraftEnvelope(
  value: unknown,
): value is DiminishedValueDraftEnvelope {
  return toDiminishedValueDraftEnvelope(value) !== null;
}

function resolveStorage(
  storage: DiminishedValueDraftStorage | null | undefined,
) {
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
  storage: DiminishedValueDraftStorage,
): DiminishedValueDraftReadResult {
  let removedCorruptValue = false;
  try {
    storage.removeItem(DIMINISHED_VALUE_DRAFT_STORAGE_KEY);
    removedCorruptValue = true;
  } catch {
    // Failed cleanup is non-fatal; callers can still start from a fresh draft.
  }

  return {
    ok: false,
    envelope: null,
    reason: "corrupt",
    removedCorruptValue,
  };
}

function toDiminishedValueDraftEnvelope(
  value: unknown,
): DiminishedValueDraftEnvelope | null {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)) {
      return null;
    }

    const intake = toEditableDiminishedValueDraft(value.intake);
    if (
      value.version !== DIMINISHED_VALUE_DRAFT_VERSION ||
      !intake ||
      !isNullableUuid(value.confirmedCaseId) ||
      !isNullableUuid(value.reservedCaseId) ||
      !isNullableUuid(value.ownerUserId) ||
      !isNullableMember(
        value.pendingAuthAction,
        DIMINISHED_VALUE_PENDING_AUTH_ACTIONS,
      ) ||
      typeof value.dirty !== "boolean" ||
      typeof value.revision !== "number" ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !isNullableNonnegativeInteger(value.serverRevision) ||
      !isNullableUuid(value.dismissedResumeCaseId) ||
      !isCanonicalIsoTimestamp(value.lastUpdatedAt)
    ) {
      return null;
    }

    return {
      version: DIMINISHED_VALUE_DRAFT_VERSION,
      intake,
      confirmedCaseId: value.confirmedCaseId,
      reservedCaseId: value.reservedCaseId,
      ownerUserId: value.ownerUserId,
      pendingAuthAction: value.pendingAuthAction,
      dirty: value.dirty,
      revision: value.revision,
      serverRevision: value.serverRevision,
      dismissedResumeCaseId: value.dismissedResumeCaseId,
      lastUpdatedAt: value.lastUpdatedAt,
    };
  } catch {
    return null;
  }
}

function toEditableDiminishedValueDraft(
  value: unknown,
): DiminishedValueDraft | null {
  if (!isRecord(value) || !hasExactKeys(value, INTAKE_KEYS)) {
    return null;
  }

  if (
    !isMember(value.step, EDITABLE_DIMINISHED_VALUE_STEPS) ||
    typeof value.returnAfterStartEdit !== "boolean" ||
    !isStringMemberOrEmpty(value.repairStatus, DIMINISHED_VALUE_REPAIR_STATUSES) ||
    !isMember(value.vehicleEntryMethod, ["vin", "details"] as const) ||
    !isStringMemberOrEmpty(
      value.otherPartyAtFault,
      DIMINISHED_VALUE_ANSWER_OPTIONS,
    ) ||
    !isStringMemberOrEmpty(
      value.structuralDamage,
      DIMINISHED_VALUE_ANSWER_OPTIONS,
    ) ||
    !isStringMemberOrEmpty(
      value.airbagDeployment,
      DIMINISHED_VALUE_ANSWER_OPTIONS,
    ) ||
    !isStringMemberOrEmpty(
      value.preferredContactMethod,
      DIMINISHED_VALUE_CONTACT_METHODS,
    ) ||
    !hasStringIntakeFields(value)
  ) {
    return null;
  }

  return {
    step: value.step,
    returnAfterStartEdit: value.returnAfterStartEdit,
    accidentState: value.accidentState,
    accidentDate: value.accidentDate,
    repairStatus: value.repairStatus,
    vehicleEntryMethod: value.vehicleEntryMethod,
    vin: value.vin,
    vehicleYear: value.vehicleYear,
    make: value.make,
    model: value.model,
    trim: value.trim,
    mileageAtAccident: value.mileageAtAccident,
    currentMileage: value.currentMileage,
    otherPartyAtFault: value.otherPartyAtFault,
    atFaultInsurer: value.atFaultInsurer,
    repairCost: value.repairCost,
    repairFacility: value.repairFacility,
    structuralDamage: value.structuralDamage,
    airbagDeployment: value.airbagDeployment,
    majorRepairDetails: value.majorRepairDetails,
    fullName: value.fullName,
    email: value.email,
    phone: value.phone,
    preferredContactMethod: value.preferredContactMethod,
    availability: value.availability,
    notes: value.notes,
  };
}

function hasStringIntakeFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> &
  Record<(typeof STRING_INTAKE_KEYS)[number], string> {
  return STRING_INTAKE_KEYS.every((key) => typeof value[key] === "string");
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

function isStringMemberOrEmpty<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] | "" {
  return value === "" || isMember(value, values);
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

function isNullableNonnegativeInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0)
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}
