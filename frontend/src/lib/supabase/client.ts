import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { environment } from "@/config/env";
import type { Database } from "@/lib/supabase/database.types";

export interface SupabaseBrowserConfiguration {
  url: string;
  publishableKey: string;
}

export type SupabaseClientState =
  | {
      status: "available";
      client: SupabaseClient<Database>;
    }
  | {
      status: "unavailable";
      reason: string;
    };

export function createSupabaseClientState({
  url,
  publishableKey,
}: SupabaseBrowserConfiguration): SupabaseClientState {
  if (!url || !publishableKey) {
    return {
      status: "unavailable",
      reason:
        "Supabase authentication is not configured for this environment.",
    };
  }

  try {
    return {
      status: "available",
      client: createClient<Database>(url, publishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: "pkce",
          persistSession: true,
        },
      }),
    };
  } catch {
    return {
      status: "unavailable",
      reason:
        "Supabase authentication configuration is invalid for this environment.",
    };
  }
}

export const supabaseClientState = createSupabaseClientState({
  url: environment.supabaseUrl,
  publishableKey: environment.supabasePublishableKey,
});
