function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function normalizeValue(value: string | undefined) {
  return value?.trim() ?? "";
}

export const environment = {
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  supabaseUrl: normalizeBaseUrl(import.meta.env.VITE_SUPABASE_URL),
  supabasePublishableKey: normalizeValue(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  ),
} as const;
