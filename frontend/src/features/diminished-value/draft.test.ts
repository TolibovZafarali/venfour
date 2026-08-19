import { describe, expect, it } from "vitest";

import {
  clearDiminishedValueDraftEnvelope,
  createEmptyDiminishedValueDraftEnvelope,
  DIMINISHED_VALUE_DRAFT_STORAGE_KEY,
  isDiminishedValueDraftEnvelope,
  readDiminishedValueDraftEnvelope,
  writeDiminishedValueDraftEnvelope,
  type DiminishedValueDraftStorage,
} from "./draft";

const NOW = new Date("2026-08-19T14:00:00.000Z");
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

class MemoryStorage implements DiminishedValueDraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("diminished-value browser draft envelope", () => {
  it("creates the exact versioned empty envelope", () => {
    expect(createEmptyDiminishedValueDraftEnvelope(NOW)).toEqual({
      version: 1,
      intake: {
        step: "start",
        returnAfterStartEdit: false,
        accidentState: "",
        accidentDate: "",
        repairStatus: "",
        vehicleEntryMethod: "vin",
        vin: "",
        vehicleYear: "",
        make: "",
        model: "",
        trim: "",
        mileageAtAccident: "",
        currentMileage: "",
        otherPartyAtFault: "",
        atFaultInsurer: "",
        repairCost: "",
        repairFacility: "",
        structuralDamage: "",
        airbagDeployment: "",
        majorRepairDetails: "",
        fullName: "",
        email: "",
        phone: "",
        preferredContactMethod: "",
        availability: "",
        notes: "",
      },
      confirmedCaseId: null,
      reservedCaseId: null,
      ownerUserId: null,
      pendingAuthAction: null,
      dirty: false,
      revision: 0,
      serverRevision: null,
      dismissedResumeCaseId: null,
      lastUpdatedAt: NOW.toISOString(),
    });
  });

  it("round-trips an editable intake under the exact storage key", () => {
    const storage = new MemoryStorage();
    const envelope = {
      ...createEmptyDiminishedValueDraftEnvelope(NOW),
      intake: {
        ...createEmptyDiminishedValueDraftEnvelope(NOW).intake,
        step: "consultation" as const,
        accidentState: "IL",
        accidentDate: "2026-08-01",
        repairStatus: "complete" as const,
        vehicleEntryMethod: "details" as const,
        vehicleYear: "2024",
        make: "Honda",
        model: "Accord",
        mileageAtAccident: "48,250",
        otherPartyAtFault: "yes" as const,
        structuralDamage: "no" as const,
        airbagDeployment: "not-sure" as const,
        fullName: "Jordan Lee",
        email: "jordan@example.com",
        phone: "312-555-0123",
        preferredContactMethod: "email" as const,
        availability: "Weekdays after 4 p.m. Central Time",
      },
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
      ownerUserId: USER_ID,
      pendingAuthAction: "submit-review" as const,
      dirty: true,
      revision: 7,
      serverRevision: 3,
    };

    expect(writeDiminishedValueDraftEnvelope(envelope, storage)).toEqual({
      ok: true,
    });
    expect([...storage.values.keys()]).toEqual([
      "venfour.diminishedValueDraft.v1",
    ]);
    expect(readDiminishedValueDraftEnvelope(storage)).toEqual({
      ok: true,
      envelope,
    });
  });

  it("accepts both supported pending authentication actions", () => {
    for (const pendingAuthAction of [
      "upload-documents",
      "submit-review",
    ] as const) {
      expect(
        isDiminishedValueDraftEnvelope({
          ...createEmptyDiminishedValueDraftEnvelope(NOW),
          pendingAuthAction,
        }),
      ).toBe(true);
    }
  });

  it("rejects complete because browser storage contains editable drafts only", () => {
    const storage = new MemoryStorage();
    const completed = {
      ...createEmptyDiminishedValueDraftEnvelope(NOW),
      intake: {
        ...createEmptyDiminishedValueDraftEnvelope(NOW).intake,
        step: "complete" as const,
      },
    };

    expect(isDiminishedValueDraftEnvelope(completed)).toBe(false);
    expect(
      writeDiminishedValueDraftEnvelope(completed, storage),
    ).toEqual({ ok: false, reason: "invalid-envelope" });
    storage.values.set(
      DIMINISHED_VALUE_DRAFT_STORAGE_KEY,
      JSON.stringify(completed),
    );
    expect(readDiminishedValueDraftEnvelope(storage)).toEqual({
      ok: false,
      envelope: null,
      reason: "corrupt",
      removedCorruptValue: true,
    });
  });

  it("removes corrupt, outdated, and unexpected schemas", () => {
    const invalidValues = [
      { ...createEmptyDiminishedValueDraftEnvelope(NOW), version: 2 },
      {
        ...createEmptyDiminishedValueDraftEnvelope(NOW),
        accessToken: "secret",
      },
      {
        ...createEmptyDiminishedValueDraftEnvelope(NOW),
        file: "data:application/pdf;base64,secret",
      },
      {
        ...createEmptyDiminishedValueDraftEnvelope(NOW),
        intake: {
          ...createEmptyDiminishedValueDraftEnvelope(NOW).intake,
          accessToken: "secret",
        },
      },
      {
        ...createEmptyDiminishedValueDraftEnvelope(NOW),
        intake: {
          ...createEmptyDiminishedValueDraftEnvelope(NOW).intake,
          file: "data:image/png;base64,secret",
        },
      },
    ];

    for (const value of invalidValues) {
      const storage = new MemoryStorage();
      storage.values.set(
        DIMINISHED_VALUE_DRAFT_STORAGE_KEY,
        JSON.stringify(value),
      );

      expect(readDiminishedValueDraftEnvelope(storage)).toEqual({
        ok: false,
        envelope: null,
        reason: "corrupt",
        removedCorruptValue: true,
      });
      expect(storage.getItem(DIMINISHED_VALUE_DRAFT_STORAGE_KEY)).toBeNull();
    }
  });

  it("rejects invalid metadata and intake discriminants", () => {
    const base = createEmptyDiminishedValueDraftEnvelope(NOW);
    const invalidValues = [
      { ...base, confirmedCaseId: "not-a-uuid" },
      { ...base, reservedCaseId: "not-a-uuid" },
      { ...base, ownerUserId: "not-a-uuid" },
      { ...base, dismissedResumeCaseId: "not-a-uuid" },
      { ...base, pendingAuthAction: "access-token" },
      { ...base, dirty: "yes" },
      { ...base, revision: -1 },
      { ...base, revision: 1.5 },
      { ...base, serverRevision: -1 },
      { ...base, serverRevision: 1.5 },
      { ...base, lastUpdatedAt: "yesterday" },
      { ...base, lastUpdatedAt: "2026-08-19T14:00:00Z" },
      { ...base, intake: { ...base.intake, repairStatus: "finished" } },
      { ...base, intake: { ...base.intake, vehicleEntryMethod: "plate" } },
      { ...base, intake: { ...base.intake, otherPartyAtFault: "maybe" } },
      { ...base, intake: { ...base.intake, structuralDamage: "maybe" } },
      { ...base, intake: { ...base.intake, airbagDeployment: "maybe" } },
      {
        ...base,
        intake: { ...base.intake, preferredContactMethod: "text" },
      },
      { ...base, intake: { ...base.intake, notes: 42 } },
    ];

    for (const value of invalidValues) {
      expect(isDiminishedValueDraftEnvelope(value)).toBe(false);
    }
  });

  it("does not write a runtime-invalid typed value", () => {
    const storage = new MemoryStorage();
    const invalidEnvelope = {
      ...createEmptyDiminishedValueDraftEnvelope(NOW),
      revision: Number.NaN,
    };

    expect(
      writeDiminishedValueDraftEnvelope(invalidEnvelope, storage),
    ).toEqual({ ok: false, reason: "invalid-envelope" });
    expect(storage.values.size).toBe(0);
  });

  it("distinguishes unavailable and failed storage operations", () => {
    const failingStorage: DiminishedValueDraftStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readDiminishedValueDraftEnvelope(null)).toMatchObject({
      ok: false,
      reason: "storage-unavailable",
    });
    expect(readDiminishedValueDraftEnvelope(failingStorage)).toMatchObject({
      ok: false,
      reason: "read-failed",
    });
    expect(
      writeDiminishedValueDraftEnvelope(
        createEmptyDiminishedValueDraftEnvelope(NOW),
        failingStorage,
      ),
    ).toEqual({ ok: false, reason: "write-failed" });
    expect(clearDiminishedValueDraftEnvelope(failingStorage)).toEqual({
      ok: false,
      reason: "remove-failed",
    });
  });

  it("reports a failed corrupt-value cleanup without throwing", () => {
    const storage: DiminishedValueDraftStorage = {
      getItem() {
        return "not-json";
      },
      setItem() {},
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readDiminishedValueDraftEnvelope(storage)).toEqual({
      ok: false,
      envelope: null,
      reason: "corrupt",
      removedCorruptValue: false,
    });
  });

  it("clears the stored envelope", () => {
    const storage = new MemoryStorage();
    expect(
      writeDiminishedValueDraftEnvelope(
        createEmptyDiminishedValueDraftEnvelope(NOW),
        storage,
      ),
    ).toEqual({ ok: true });

    expect(clearDiminishedValueDraftEnvelope(storage)).toEqual({ ok: true });
    expect(storage.getItem(DIMINISHED_VALUE_DRAFT_STORAGE_KEY)).toBeNull();
  });
});
