const configuredSupportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const supportEmail =
  configuredSupportEmail && EMAIL_PATTERN.test(configuredSupportEmail)
    ? configuredSupportEmail
    : null;
