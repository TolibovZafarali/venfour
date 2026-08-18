import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
} from "@/features/auth/auth-context";
import {
  createSupabaseAuthService,
  type AuthService,
} from "@/features/auth/auth-service";
import {
  getAuthCallbackUrl,
  storeAuthReturnLocation,
} from "@/features/auth/return-location";
import { supabaseClientState } from "@/lib/supabase/client";

const defaultAuthService =
  supabaseClientState.status === "available"
    ? createSupabaseAuthService(supabaseClientState.client)
    : null;

const defaultUnavailableReason =
  supabaseClientState.status === "unavailable"
    ? supabaseClientState.reason
    : "Authentication is unavailable.";

function stateFromSession(session: Session | null): AuthState {
  return session
    ? { status: "signedIn", session, user: session.user }
    : { status: "signedOut", session: null, user: null };
}

interface AuthProviderProps {
  children: ReactNode;
  service?: AuthService | null;
  unavailableReason?: string;
  onIdentityChange?: (
    previousUserId: string | null,
    nextUserId: string | null,
  ) => void;
}

export function AuthProvider({
  children,
  service,
  unavailableReason = defaultUnavailableReason,
  onIdentityChange,
}: AuthProviderProps) {
  const resolvedService = service === undefined ? defaultAuthService : service;
  const [auth, setAuth] = useState<AuthState>(() =>
    resolvedService
      ? { status: "loading", session: null, user: null }
      : {
          status: "unavailable",
          session: null,
          user: null,
          reason: unavailableReason,
        },
  );
  const currentUserIdRef = useRef<string | null>(null);
  const identityInitializedRef = useRef(false);
  const sessionUpdateVersionRef = useRef(0);

  const applySession = useCallback(
    (session: Session | null) => {
      sessionUpdateVersionRef.current += 1;
      const nextUserId = session?.user.id ?? null;
      const previousUserId = currentUserIdRef.current;
      currentUserIdRef.current = nextUserId;
      setAuth(stateFromSession(session));

      if (
        identityInitializedRef.current &&
        previousUserId !== nextUserId
      ) {
        onIdentityChange?.(previousUserId, nextUserId);
      }
      identityInitializedRef.current = true;
    },
    [onIdentityChange],
  );

  useEffect(() => {
    if (!resolvedService) {
      return;
    }

    let active = true;
    const restorationVersion = sessionUpdateVersionRef.current;
    const unsubscribe = resolvedService.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }
      applySession(session);
    });

    void resolvedService
      .getSession()
      .then((session) => {
        if (
          active &&
          sessionUpdateVersionRef.current === restorationVersion
        ) {
          applySession(session);
        }
      })
      .catch(() => {
        if (
          active &&
          sessionUpdateVersionRef.current === restorationVersion
        ) {
          applySession(null);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySession, resolvedService]);

  const requireService = useCallback(() => {
    if (!resolvedService) {
      throw new Error(unavailableReason);
    }
    return resolvedService;
  }, [resolvedService, unavailableReason]);

  const signInWithGoogle = useCallback<AuthContextValue["signInWithGoogle"]>(
    async (options) => {
      storeAuthReturnLocation(options?.returnTo);
      await requireService().signInWithGoogle(getAuthCallbackUrl());
    },
    [requireService],
  );

  const sendMagicLink = useCallback<AuthContextValue["sendMagicLink"]>(
    async (email, options) => {
      storeAuthReturnLocation(options?.returnTo);
      await requireService().sendMagicLink(email, getAuthCallbackUrl());
    },
    [requireService],
  );

  const completeAuthCallback = useCallback<
    AuthContextValue["completeAuthCallback"]
  >(
    async (code) => {
      const session = await requireService().exchangeCodeForSession(code);
      applySession(session);
      return session;
    },
    [applySession, requireService],
  );

  const signOut = useCallback<AuthContextValue["signOut"]>(async () => {
    await requireService().signOut();
    applySession(null);
  }, [applySession, requireService]);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      completeAuthCallback,
      sendMagicLink,
      signInWithGoogle,
      signOut,
    }),
    [
      auth,
      completeAuthCallback,
      sendMagicLink,
      signInWithGoogle,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
