const configuredSupportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "support@venfour.com";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const supportEmail =
  configuredSupportEmail && EMAIL_PATTERN.test(configuredSupportEmail)
    ? configuredSupportEmail
    : null;

export const refundRequestSubject = "Refund request — Venfour case [case number]";
