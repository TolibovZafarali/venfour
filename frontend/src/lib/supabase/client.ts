import { createClient, navigatorLock } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

import { environment } from "@/config/env";
import type { Database } from "@/lib/supabase/database.types";
import {
  createBrowserSessionStorage,
  createGuardedSessionStorage,
  hasBrowserSessionLocks,
  lockBrowserSessionMutation,
  SessionInstallationIdentityError,
} from "@/lib/supabase/guarded-session-storage";

const guardedStorageByClient = new WeakMap<
  SupabaseClient<Database>,
  ReturnType<typeof createGuardedSessionStorage>
>();

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
    const guardedStorage = environment.localPostContinueEnabled && hasBrowserSessionLocks()
      ? createGuardedSessionStorage(createBrowserSessionStorage(), lockBrowserSessionMutation)
      : null;
    const client = createClient<Database>(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        ...(guardedStorage ? {
          storage: guardedStorage.storage,
          lock: navigatorLock,
          lockAcquireTimeout: -1,
        } : {}),
      },
    });
    if (guardedStorage) guardedStorageByClient.set(client, guardedStorage);
    return {
      status: "available",
      client,
    };
  } catch {
    return {
      status: "unavailable",
      reason:
        "Supabase authentication configuration is invalid for this environment.",
    };
  }
}

export function canInstallSessionForAnonymousOwner(client: SupabaseClient<Database>) {
  return guardedStorageByClient.has(client);
}

export function installSessionForAnonymousOwner(
  client: SupabaseClient<Database>,
  session: Session,
  expectedAnonymousUserId: string,
  assertUnchanged: () => void,
) {
  const guardedStorage = guardedStorageByClient.get(client);
  if (!guardedStorage || !session.expires_at ||
    session.expires_at * 1_000 <= Date.now() + 30_000) {
    throw new SessionInstallationIdentityError();
  }
  return guardedStorage.install({
    accessToken: session.access_token,
    expectedAnonymousUserId,
    assertUnchanged,
  }, () => client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }));
}

export const supabaseClientState = createSupabaseClientState({
  url: environment.supabaseUrl,
  publishableKey: environment.supabasePublishableKey,
});
