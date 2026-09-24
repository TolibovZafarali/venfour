/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_ADS_CONVERSION_ID?: string;
  readonly VITE_GOOGLE_ADS_PURCHASE_LABEL?: string;
  readonly VITE_GOOGLE_ENHANCED_CONVERSIONS?: string;
  readonly VITE_PUBLIC_SITE_ONLY?: string;
  readonly VITE_PUBLIC_INTAKE_OPEN?: string;
  readonly VITE_ENABLE_POST_CONTINUE_FLOW?: string;
  readonly VITE_ENABLE_LOCAL_CLAIM_FIXTURES?: string;
  readonly VITE_LOCAL_MARKET_FIXTURES?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
