import {
  isOfficialTurnstileTestSiteKey,
  isTurnstileSiteKey,
} from "./turnstile-site-key.mjs";

export const EXPECTED_STAGING_ORIGIN = "https://staging.venfour.com";
export const EXPECTED_STAGING_SUPABASE_ORIGIN =
  "https://bjvsgaqitehtwasugvla.supabase.co";

const PRODUCTION_HOSTNAMES = new Set(["venfour.com", "www.venfour.com"]);
const REQUIRED_NAMES = [
  "VITE_STAGING_ORIGIN",
  "VITE_SUPPORT_EMAIL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_TURNSTILE_SITE_KEY",
];

export class StagingEnvironmentValidationError extends Error {
  constructor(issues) {
    super("Staging environment validation failed.");
    this.name = "StagingEnvironmentValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

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

function httpsOrigin(value) {
  if (!isTrimmedPrintable(value) || !value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function decodeJwtPayload(value) {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))) {
    return null;
  }
  try {
    const payload = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const padding = "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(payload + padding, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isPublishableSupabaseKey(value) {
  if (!isTrimmedPrintable(value) || value.length > 4_096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(value)) return true;
  const payload = decodeJwtPayload(value);
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.role === "anon"
  );
}

function isEmail(value) {
  return (
    isTrimmedPrintable(value) &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  );
}

export function validateStagingEnvironment(environment) {
  const issues = [];
  for (const name of REQUIRED_NAMES) {
    if (typeof environment[name] !== "string" || !environment[name].trim()) {
      issues.push(`${name} is required.`);
    }
  }

  if ((environment.VITE_API_BASE_URL ?? "").trim()) {
    issues.push(
      "VITE_API_BASE_URL must be empty so staging API requests remain same-origin.",
    );
  }

  const stagingOrigin = httpsOrigin(environment.VITE_STAGING_ORIGIN);
  if (!stagingOrigin) {
    issues.push("VITE_STAGING_ORIGIN must be an HTTPS origin without a path.");
  } else {
    if (PRODUCTION_HOSTNAMES.has(stagingOrigin.hostname.toLowerCase())) {
      issues.push("VITE_STAGING_ORIGIN must not use the production apex or www host.");
    }
    if (stagingOrigin.origin !== EXPECTED_STAGING_ORIGIN) {
      issues.push(
        `VITE_STAGING_ORIGIN must be ${EXPECTED_STAGING_ORIGIN} for this deployment.`,
      );
    }
  }

  const supabaseOrigin = httpsOrigin(environment.VITE_SUPABASE_URL);
  if (!supabaseOrigin) {
    issues.push("VITE_SUPABASE_URL must be an HTTPS origin without a path.");
  } else if (supabaseOrigin.origin !== EXPECTED_STAGING_SUPABASE_ORIGIN) {
    issues.push(
      `VITE_SUPABASE_URL must be ${EXPECTED_STAGING_SUPABASE_ORIGIN} for this deployment.`,
    );
  }
  if (!isPublishableSupabaseKey(environment.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    issues.push(
      "VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable or anon key.",
    );
  }
  if (!isEmail(environment.VITE_SUPPORT_EMAIL)) {
    issues.push("VITE_SUPPORT_EMAIL must be a valid email address.");
  }
  if (!isTurnstileSiteKey(environment.VITE_TURNSTILE_SITE_KEY)) {
    issues.push("VITE_TURNSTILE_SITE_KEY must be a valid public site key.");
  } else if (
    isOfficialTurnstileTestSiteKey(environment.VITE_TURNSTILE_SITE_KEY)
  ) {
    issues.push(
      "VITE_TURNSTILE_SITE_KEY must not use an official Turnstile test key in staging.",
    );
  }

  if (issues.length > 0) throw new StagingEnvironmentValidationError(issues);
  return Object.freeze({
    apiBaseUrl: "",
    stagingOrigin: stagingOrigin.origin,
    supabaseUrl: supabaseOrigin.origin,
    supportEmail: environment.VITE_SUPPORT_EMAIL,
    turnstileSiteKey: environment.VITE_TURNSTILE_SITE_KEY,
  });
}
