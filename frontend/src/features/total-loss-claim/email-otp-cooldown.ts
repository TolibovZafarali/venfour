export const EMAIL_OTP_RESEND_INTERVAL_MS = 60_000;
export const EMAIL_OTP_COOLDOWN_EVENT = "venfour:claim-email-code-cooldown";

function cooldownKey(userId: string) {
  return `venfour:claim-email-code-cooldown:${userId}`;
}

export function emailOtpRetryAt(userId: string) {
  try {
    const stored = window.localStorage.getItem(cooldownKey(userId));
    if (!stored || !/^\d{13}$/u.test(stored)) return 0;
    const retryAt = Number(stored);
    return retryAt <= Date.now() + EMAIL_OTP_RESEND_INTERVAL_MS ? retryAt : 0;
  } catch {
    return 0;
  }
}

export function startEmailOtpCooldown(userId: string) {
  const retryAt = Date.now() + EMAIL_OTP_RESEND_INTERVAL_MS;
  try {
    // Only a retry timestamp is shared; codes, email, and claim credentials stay out.
    window.localStorage.setItem(cooldownKey(userId), String(retryAt));
    window.dispatchEvent(new Event(EMAIL_OTP_COOLDOWN_EVENT));
  } catch {
    // The component timer and Supabase rate limit still apply without storage.
  }
  return retryAt;
}

export async function withEmailOtpRequestLock<T>(
  userId: string,
  operation: () => Promise<T>,
) {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(cooldownKey(userId), operation)
    : operation();
}
