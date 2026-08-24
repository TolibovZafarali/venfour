import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isNewTotalLossAppraisalIntentId,
  newTotalLossAppraisalHref,
  useNewTotalLossAppraisalHref,
} from "@/features/total-loss/new-appraisal";

const CASE_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("new Total Loss appraisal links", () => {
  it("carries a stable intent ID in a distinct query parameter", () => {
    expect(newTotalLossAppraisalHref(CASE_ID)).toBe(
      `/start?service=total-loss&newCaseId=${CASE_ID}`,
    );
    expect(isNewTotalLossAppraisalIntentId(CASE_ID)).toBe(true);
    expect(isNewTotalLossAppraisalIntentId("not-a-case")).toBe(false);
    expect(() => newTotalLossAppraisalHref("not-a-case")).toThrow(
      "A valid new-appraisal intent ID is required.",
    );
  });

  it("keeps one reservation stable across rerenders", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);
    const { result, rerender } = renderHook(() =>
      useNewTotalLossAppraisalHref(),
    );
    const firstHref = result.current;

    rerender();

    expect(result.current).toBe(firstHref);
    expect(randomUUID).toHaveBeenCalledOnce();
  });
});
