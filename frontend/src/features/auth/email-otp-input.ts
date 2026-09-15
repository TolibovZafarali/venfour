export function rawEmailOtp(value: string) {
  return value.replace(/[^0-9]/gu, "").slice(0, 8);
}

export function isValidEmailOtp(value: string) {
  return (value.length === 6 || value.length === 8) && /^[0-9]+$/u.test(value);
}

export function formatEmailOtp(value: string) {
  const digits = rawEmailOtp(value);
  return digits.length > 3
    ? `${digits.slice(0, 3)}-${digits.slice(3)}`
    : digits;
}

export function emailOtpCaretOffset(digitCount: number) {
  return digitCount > 3 ? digitCount + 1 : digitCount;
}
