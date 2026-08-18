import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

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
  | {
      status: "signedIn";
      session: Session;
      user: User;
    }
  | {
      status: "unavailable";
      session: null;
      user: null;
      reason: string;
    };

export interface AuthActionOptions {
  returnTo?: string;
}

export interface AuthContextValue {
  auth: AuthState;
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

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
