import { describe, expect, it } from "vitest";

import {
  createEmptyTotalLossManualForm,
  TOTAL_LOSS_MANUAL_FORM_DEFAULTS,
} from "@/features/total-loss/types";

describe("total-loss types", () => {
  it("creates independent empty manual form values", () => {
    const first = createEmptyTotalLossManualForm();
    const second = createEmptyTotalLossManualForm();

    expect(first).toEqual(TOTAL_LOSS_MANUAL_FORM_DEFAULTS);
    expect(second).toEqual(TOTAL_LOSS_MANUAL_FORM_DEFAULTS);
    expect(first).not.toBe(second);
  });
});
