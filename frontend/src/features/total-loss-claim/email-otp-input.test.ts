import { describe, expect, it } from "vitest";

import {
  emailOtpCaretOffset,
  formatEmailOtp,
  rawEmailOtp,
} from "@/features/total-loss-claim/email-otp-input";

describe("email verification code input", () => {
  it.each(["123456", "123-456", "123 456", "a1b2c3!4@5#6"])(
    "formats %s as two groups of three digits without changing the raw value",
    (value) => {
      expect(formatEmailOtp(value)).toBe("123-456");
      expect(rawEmailOtp(value)).toBe("123456");
    },
  );

  it.each([
    ["", ""],
    ["a - !", ""],
    ["1", "1"],
    ["123", "123"],
    ["1234", "123-4"],
    ["123456789", "123-456"],
    ["000001", "000-001"],
  ])("keeps incremental and bounded input %s readable", (value, expected) => {
    expect(formatEmailOtp(value)).toBe(expected);
    expect(rawEmailOtp(value).length).toBeLessThanOrEqual(6);
  });

  it.each([[0, 0], [2, 2], [3, 3], [4, 5], [6, 7]])(
    "places the caret after %i digits at %i",
    (digitCount, expected) => {
      expect(emailOtpCaretOffset(digitCount)).toBe(expected);
    },
  );
});
