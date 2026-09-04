import { describe, expect, it } from "vitest";

import {
  readTotalLossIntakeCorrectionIntent,
  totalLossIntakeCorrectionPath,
} from "@/features/total-loss/intake-correction";

const CASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CASE_ID = "33333333-3333-4333-8333-333333333333";

describe("Total Loss intake correction intent", () => {
  it("restores only an explicit correction intent tied to a valid case", () => {
    expect(readTotalLossIntakeCorrectionIntent(
      `?service=total-loss&caseId=${CASE_ID}&intent=correct-intake`,
    )).toEqual({ caseId: CASE_ID, focus: null });
    expect(readTotalLossIntakeCorrectionIntent(
      `?service=total-loss&caseId=${CASE_ID}&intent=correct-intake&focus=insurer-offer`,
    )).toEqual({ caseId: CASE_ID, focus: "insurer-offer" });
  });

  it.each([
    "",
    `?service=total-loss&caseId=${CASE_ID}`,
    `?service=total-loss&caseId=${CASE_ID}&focus=insurer-offer`,
    `?service=total-loss&caseId=${CASE_ID}&intent=review`,
    "?service=total-loss&intent=correct-intake",
    "?service=total-loss&caseId=&intent=correct-intake",
    "?service=total-loss&caseId=not-a-case&intent=correct-intake",
    `?service=total-loss&caseId=${CASE_ID}extra&intent=correct-intake`,
    `?service=total-loss&caseId=${CASE_ID}&intent=correct-intake&newCaseId=${OTHER_CASE_ID}`,
    `?service=total-loss&caseId=${CASE_ID}&intent=correct-intake&newCaseId=`,
  ])("does not enter correction for absent, malformed, or conflicting intent: %s", (search) => {
    expect(readTotalLossIntakeCorrectionIntent(search)).toBeNull();
  });

  it("ignores an unknown focus while retaining the case-specific correction intent", () => {
    expect(readTotalLossIntakeCorrectionIntent(
      `?service=total-loss&caseId=${CASE_ID}&intent=correct-intake&focus=contact`,
    )).toEqual({ caseId: CASE_ID, focus: null });
  });

  it("generates correction links for the requested case without carrying prior focus or case state", () => {
    const offerPath = totalLossIntakeCorrectionPath(CASE_ID, "insurer-offer");
    const reviewPath = totalLossIntakeCorrectionPath(OTHER_CASE_ID);

    expect(offerPath).toBe(
      `/start?service=total-loss&caseId=${CASE_ID}&intent=correct-intake&focus=insurer-offer`,
    );
    expect(reviewPath).toBe(
      `/start?service=total-loss&caseId=${OTHER_CASE_ID}&intent=correct-intake`,
    );
    expect(readTotalLossIntakeCorrectionIntent(offerPath.split("?")[1])).toEqual({
      caseId: CASE_ID,
      focus: "insurer-offer",
    });
    expect(readTotalLossIntakeCorrectionIntent(reviewPath.split("?")[1])).toEqual({
      caseId: OTHER_CASE_ID,
      focus: null,
    });
    expect(readTotalLossIntakeCorrectionIntent(`?caseId=${CASE_ID}`)).toBeNull();
  });
});
