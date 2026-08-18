import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type AuthStateChangeListener = (
  event: AuthChangeEvent,
  session: Session | null,
) => void;

export interface AuthService {
  getSession: () => Promise<Session | null>;
  onAuthStateChange: (listener: AuthStateChangeListener) => () => void;
  signInWithGoogle: (redirectTo: string) => Promise<void>;
  sendMagicLink: (email: string, redirectTo: string) => Promise<void>;
  exchangeCodeForSession: (
    code: string,
    flowId?: string,
  ) => Promise<Session>;
  verifyEmailOtp: (tokenHash: string) => Promise<Session>;
  signOut: () => Promise<void>;
}

function throwIfError(error: Error | null) {
  if (error) {
    throw error;
  }
}

export function createSupabaseAuthService(
  client: SupabaseClient<Database>,
): AuthService {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      throwIfError(error);
      return data.session;
    },

    onAuthStateChange(listener) {
      const { data } = client.auth.onAuthStateChange(listener);
      return () => data.subscription.unsubscribe();
    },

    async signInWithGoogle(redirectTo) {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      throwIfError(error);
    },

    async sendMagicLink(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });
      throwIfError(error);
    },

    async exchangeCodeForSession(code, flowId) {
      const { data, error } = await client.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      throwIfError(error);

      if (!data.session) {
        throw new Error("Supabase did not return a session.");
      }

      return data.session;
    },

    async verifyEmailOtp(tokenHash) {
      const { data, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
      });
      throwIfError(error);

      if (!data.session) {
        throw new Error("Supabase did not return a session.");
      }

      return data.session;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      throwIfError(error);
    },
  };
}
