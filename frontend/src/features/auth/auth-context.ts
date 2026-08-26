import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

import type { TurnstileController } from "@/features/auth/turnstile-controller";

export type AuthIdentityKind = "anonymous" | "permanent";

export interface SignedInAuthState {
  status: "signedIn";
  identity: AuthIdentityKind;
  session: Session;
  user: User;
}

export type AuthState =
  | {
      status: "loading";
      session: null;
      user: null;
    }
  | {
      status: "signedOut";
      session: null;
      user: null;
    }
  | SignedInAuthState
  | {
      status: "unavailable";
      session: null;
      user: null;
      reason: string;
    };

export interface AuthActionOptions {
  returnTo?: string;
  callbackParameters?: Readonly<Record<string, string>>;
}

export interface GuestSessionOptions {
  signal?: AbortSignal;
}

export interface AuthContextValue {
  auth: AuthState;
  ensureGuestSession: (options?: GuestSessionOptions) => Promise<Session>;
  restoreSession: (session: Session) => Promise<Session>;
  runTurnstileChallenge: TurnstileController["runWithToken"];
  signInWithGoogle: (options?: AuthActionOptions) => Promise<void>;
  sendMagicLink: (
    email: string,
    options?: AuthActionOptions,
  ) => Promise<void>;
  completeAuthCallback: (
    code: string,
    flowId?: string,
  ) => Promise<Session>;
  completeEmailAuthCallback: (tokenHash: string) => Promise<Session>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function isAnonymousUser(user: User) {
  return (
    user.is_anonymous === true || user.app_metadata?.provider === "anonymous"
  );
}

export function isPermanentUser(user: User) {
  return !isAnonymousUser(user);
}

export function isAnonymousAuthState(
  auth: AuthState,
): auth is SignedInAuthState & { identity: "anonymous" } {
  return auth.status === "signedIn" && auth.identity === "anonymous";
}

export function isPermanentAuthState(
  auth: AuthState,
): auth is SignedInAuthState & { identity: "permanent" } {
  return auth.status === "signedIn" && auth.identity === "permanent";
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
