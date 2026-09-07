import { describe, expect, it } from "vitest";

import { adminMoney, formatAdminFact } from "./ui-format";

describe("staff currency display", () => {
  it.each([
    [14900, "USD", "USD 149.00"],
    [14900, "JPY", "JPY 14,900"],
    [14900, "KWD", "KWD 14.900"],
  ])("preserves the recorded currency exponent for %s %s", (amount, currency, expected) => {
    expect(adminMoney(amount, currency).replace(/\s/gu, " ")).toBe(expected);
    expect(formatAdminFact("Amount", `${currency} ${amount} minor units`).replace(/\s/gu, " ")).toBe(expected);
  });

  it("keeps unrecognized currencies in recorded minor units", () => {
    expect(adminMoney(14900, "ZZZ")).toBe("ZZZ 14900 minor units");
  });

  it("does not format unsafe or fractional amounts as precise money", () => {
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, -1, 14.9]) {
      expect(adminMoney(amount, "USD")).toBe("Amount unavailable");
    }
    expect(formatAdminFact("Amount", "USD 9007199254740993 minor units")).toBe("USD 9007199254740993 minor units");
  });
});
