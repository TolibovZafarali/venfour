import { describe, expect, it } from "vitest";

import {
  clearTotalLossDraft,
  createEmptyTotalLossDraft,
  isTotalLossDraft,
  readTotalLossDraft,
  TOTAL_LOSS_DRAFT_STORAGE_KEY,
  writeTotalLossDraft,
  type TotalLossDraftStorage,
} from "@/features/total-loss/draft";

const NOW = new Date("2026-08-18T14:00:00.000Z");
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

class MemoryStorage implements TotalLossDraftStorage {
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

describe("total-loss browser draft", () => {
  it("creates the expected versioned empty shape", () => {
    expect(createEmptyTotalLossDraft(NOW)).toEqual({
      version: 3,
      mode: null,
      step: "choice",
      manual: {
        vin: "",
        vehicleYear: "",
        make: "",
        model: "",
        trim: "",
        mileageAtLoss: "",
        zipCode: "",
        dateOfLoss: "",
        insurerName: "",
        insurerVehicleValuation: "",
        priorTitleStatus: "",
        vehicleCondition: "",
        existingDamageDescription: "",
        optionsPackages: "",
      },
      contact: {
        fullName: "",
        email: "",
        termsAccepted: false,
        privacyAccepted: false,
        operationalFollowUpAllowed: false,
      },
      reportProvider: null,
      reportExtractionStatus: "idle",
      reportExtractionWarnings: [],
      identityClaimId: null,
      identityClaimExpiresAt: null,
      accessLinkSentAt: null,
      confirmedCaseId: null,
      reservedCaseId: null,
      ownerUserId: null,
      pendingAuthAction: null,
      dirty: false,
      revision: 0,
      dismissedResumeCaseId: null,
      lastUpdatedAt: NOW.toISOString(),
    });
  });

  it("round-trips a manual draft under the exact storage key", () => {
    const storage = new MemoryStorage();
    const draft = {
      ...createEmptyTotalLossDraft(NOW),
      mode: "manual" as const,
      step: "claim" as const,
      manual: {
        ...createEmptyTotalLossDraft(NOW).manual,
        vin: "1HGCM82633A004352",
      },
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
      ownerUserId: USER_ID,
      dirty: true,
      revision: 4,
    };

    expect(writeTotalLossDraft(draft, storage)).toEqual({ ok: true });
    expect([...storage.values.keys()]).toEqual([
      "venfour.totalLossDraft.v1",
    ]);
    expect(readTotalLossDraft(storage)).toEqual({ ok: true, draft });
  });

  it("migrates a version-one draft without inventing contact or report facts", () => {
    const storage = new MemoryStorage();
    const legacy = {
      version: 1,
      mode: "manual",
      step: "claim",
      manual: {
        vin: "1HGCM82633A004352",
        vehicleYear: "2020",
        make: "Honda",
        model: "Accord",
        trim: "EX-L",
        mileageAtLoss: "48250",
        zipCode: "60611",
        dateOfLoss: "2026-08-18",
        insurerName: "Example Insurance",
        insurerVehicleValuation: "18750",
      },
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
      ownerUserId: USER_ID,
      pendingAuthAction: null,
      dirty: true,
      revision: 4,
      dismissedResumeCaseId: null,
      lastUpdatedAt: NOW.toISOString(),
    };
    storage.values.set(
      TOTAL_LOSS_DRAFT_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    expect(readTotalLossDraft(storage)).toMatchObject({
      ok: true,
      draft: {
        version: 3,
        step: "claim",
        manual: {
          vin: "1HGCM82633A004352",
          priorTitleStatus: "",
          vehicleCondition: "",
          existingDamageDescription: "",
          optionsPackages: "",
        },
        contact: {
          fullName: "",
          email: "",
        },
        reportProvider: null,
        reportExtractionStatus: "idle",
        reportExtractionWarnings: [],
        identityClaimId: null,
      },
    });
  });

  it("migrates a version-two draft with empty values for the new claim facts", () => {
    const storage = new MemoryStorage();
    const current = createEmptyTotalLossDraft(NOW);
    const legacy = {
      ...current,
      version: 2,
      manual: {
        vin: "",
        vehicleYear: "2020",
        make: "Honda",
        model: "Accord",
        trim: "EX-L",
        mileageAtLoss: "48250",
        zipCode: "60611",
        dateOfLoss: "2026-08-18",
        insurerName: "Example Insurance",
        insurerVehicleValuation: "18750",
        vehicleCondition: "Good",
        optionsPackages: "Technology package",
      },
    };
    storage.values.set(
      TOTAL_LOSS_DRAFT_STORAGE_KEY,
      JSON.stringify(legacy),
    );

    expect(readTotalLossDraft(storage)).toMatchObject({
      ok: true,
      draft: {
        version: 3,
        manual: {
          vehicleYear: "2020",
          priorTitleStatus: "",
          existingDamageDescription: "",
        },
      },
    });
  });

  it("removes corrupt and unsupported-version values", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      TOTAL_LOSS_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...createEmptyTotalLossDraft(NOW), version: 4 }),
    );

    expect(readTotalLossDraft(storage)).toMatchObject({
      ok: false,
      reason: "corrupt",
      removedCorruptValue: true,
    });
    expect(storage.getItem(TOTAL_LOSS_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("rejects and removes unexpected file or token properties", () => {
    for (const extra of [
      { accessToken: "secret" },
      { file: "data:application/pdf;base64,secret" },
    ]) {
      const storage = new MemoryStorage();
      storage.values.set(
        TOTAL_LOSS_DRAFT_STORAGE_KEY,
        JSON.stringify({ ...createEmptyTotalLossDraft(NOW), ...extra }),
      );

      expect(readTotalLossDraft(storage)).toMatchObject({
        ok: false,
        reason: "corrupt",
        removedCorruptValue: true,
      });
    }
  });

  it("does not write a runtime-invalid typed value", () => {
    const storage = new MemoryStorage();
    const invalidDraft = {
      ...createEmptyTotalLossDraft(NOW),
      revision: -1,
    };

    expect(writeTotalLossDraft(invalidDraft, storage)).toEqual({
      ok: false,
      reason: "invalid-draft",
    });
    expect(storage.values.size).toBe(0);
    expect(isTotalLossDraft(invalidDraft)).toBe(false);
  });

  it("distinguishes unavailable and failed storage operations", () => {
    const failingStorage: TotalLossDraftStorage = {
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

    expect(readTotalLossDraft(null)).toMatchObject({
      ok: false,
      reason: "storage-unavailable",
    });
    expect(readTotalLossDraft(failingStorage)).toMatchObject({
      ok: false,
      reason: "read-failed",
    });
    expect(
      writeTotalLossDraft(createEmptyTotalLossDraft(NOW), failingStorage),
    ).toEqual({ ok: false, reason: "write-failed" });
    expect(clearTotalLossDraft(failingStorage)).toEqual({
      ok: false,
      reason: "remove-failed",
    });
  });

  it("reports a failed corrupt-value cleanup without throwing", () => {
    const storage: TotalLossDraftStorage = {
      getItem() {
        return "not-json";
      },
      setItem() {},
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readTotalLossDraft(storage)).toEqual({
      ok: false,
      draft: null,
      reason: "corrupt",
      removedCorruptValue: false,
    });
  });

  it("clears the stored draft", () => {
    const storage = new MemoryStorage();
    expect(writeTotalLossDraft(createEmptyTotalLossDraft(NOW), storage)).toEqual(
      { ok: true },
    );

    expect(clearTotalLossDraft(storage)).toEqual({ ok: true });
    expect(storage.getItem(TOTAL_LOSS_DRAFT_STORAGE_KEY)).toBeNull();
  });
});
