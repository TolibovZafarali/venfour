function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function normalizeValue(value: string | undefined) {
  return value?.trim() ?? "";
}

export const TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY =
  "1x00000000000000000000BB";

function turnstileSiteKey(value: string | undefined) {
  const configuredValue = normalizeValue(value);
  if (configuredValue) return configuredValue;
  return import.meta.env.DEV ? TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY : "";
}

export const environment = {
  localPostContinueEnabled:
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_POST_CONTINUE_FLOW === "true" &&
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname),
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  supabaseUrl: normalizeBaseUrl(import.meta.env.VITE_SUPABASE_URL),
  supabasePublishableKey: normalizeValue(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  ),
  turnstileSiteKey: turnstileSiteKey(
    import.meta.env.VITE_TURNSTILE_SITE_KEY,
  ),
} as const;
