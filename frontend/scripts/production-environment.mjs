import { httpsOrigin, isEmail, isPublishableSupabaseKey } from "./staging-environment.mjs";
import { isOfficialTurnstileTestSiteKey, isTurnstileSiteKey } from "./turnstile-site-key.mjs";

export const EXPECTED_PUBLIC_ORIGIN = "https://venfour.com";
export const EXPECTED_APPLICATION_ORIGIN = "https://app.venfour.com";

export class ProductionEnvironmentValidationError extends Error {
  constructor(issues) {
    super("Production environment validation failed.");
    this.name = "ProductionEnvironmentValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

export function validateProductionEnvironment(environment) {
  const issues = [];
  if (environment.VITE_PUBLIC_SITE_ONLY === "true") {
    issues.push("VITE_PUBLIC_SITE_ONLY must not enable public-site mode in a production application build.");
  }
  for (const [name, expected] of [
    ["VITE_PUBLIC_ORIGIN", EXPECTED_PUBLIC_ORIGIN],
    ["VITE_APPLICATION_ORIGIN", EXPECTED_APPLICATION_ORIGIN],
  ]) {
    if (environment[name] !== expected) issues.push(`${name} must be ${expected}.`);
  }
  if ((environment.VITE_API_BASE_URL ?? "") !== "") {
    issues.push("VITE_API_BASE_URL must be empty so production API requests remain same-origin.");
  }
  if (environment.VITE_STAGING_ORIGIN) issues.push("VITE_STAGING_ORIGIN must be absent in a production build.");
  const expectedSupabase = httpsOrigin(environment.VENFOUR_PRODUCTION_SUPABASE_ORIGIN);
  const supabase = httpsOrigin(environment.VITE_SUPABASE_URL);
  if (!expectedSupabase || expectedSupabase.port || !/^[a-z0-9-]+\.supabase\.co$/u.test(expectedSupabase.hostname)) {
    issues.push("VENFOUR_PRODUCTION_SUPABASE_ORIGIN must identify the reviewed production Supabase project.");
  }
  if (!supabase || !expectedSupabase || supabase.origin !== expectedSupabase.origin) {
    issues.push("VITE_SUPABASE_URL must match VENFOUR_PRODUCTION_SUPABASE_ORIGIN exactly.");
  }
  if (!isPublishableSupabaseKey(environment.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    issues.push("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable or anon key.");
  }
  if (!isEmail(environment.VITE_SUPPORT_EMAIL)) issues.push("VITE_SUPPORT_EMAIL must be a valid email address.");
  if (!isTurnstileSiteKey(environment.VITE_TURNSTILE_SITE_KEY) || isOfficialTurnstileTestSiteKey(environment.VITE_TURNSTILE_SITE_KEY)) {
    issues.push("VITE_TURNSTILE_SITE_KEY must be a valid production site key, not an official test key.");
  }
  if (issues.length) throw new ProductionEnvironmentValidationError(issues);
  return Object.freeze({
    apiBaseUrl: "",
    publicOrigin: EXPECTED_PUBLIC_ORIGIN,
    applicationOrigin: EXPECTED_APPLICATION_ORIGIN,
    supabaseUrl: supabase.origin,
    supportEmail: environment.VITE_SUPPORT_EMAIL,
    turnstileSiteKey: environment.VITE_TURNSTILE_SITE_KEY,
  });
}
