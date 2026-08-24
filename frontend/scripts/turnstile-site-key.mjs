const OFFICIAL_TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);

function isTrimmedPrintable(value) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

export function isOfficialTurnstileTestSiteKey(value) {
  return OFFICIAL_TURNSTILE_TEST_SITE_KEYS.has(value);
}

export function isTurnstileSiteKey(value) {
  return (
    isTrimmedPrintable(value) &&
    value.length <= 32 &&
    /^[A-Za-z0-9_-]{20,}$/u.test(value)
  );
}

export function assertProductionTurnstileSiteKey(value) {
  if (value === undefined || value === "") return;

  if (isOfficialTurnstileTestSiteKey(value)) {
    throw new Error(
      "VITE_TURNSTILE_SITE_KEY must not use an official Turnstile test key in a production build.",
    );
  }

  if (typeof value !== "string" || value.length > 32) {
    throw new Error(
      "VITE_TURNSTILE_SITE_KEY must not contain a secret or any value longer than 32 characters in a production build.",
    );
  }

  if (!isTurnstileSiteKey(value)) {
    throw new Error(
      "VITE_TURNSTILE_SITE_KEY must be empty or a valid public site key in a production build.",
    );
  }
}
