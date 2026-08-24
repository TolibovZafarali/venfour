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
  isAnonymousUser,
  type AuthContextValue,
  type AuthState,
  type GuestSessionOptions,
} from "@/features/auth/auth-context";
import {
  createSupabaseAuthService,
  type AuthService,
} from "@/features/auth/auth-service";
import {
  getAuthCallbackUrl,
  storeAuthReturnLocation,
} from "@/features/auth/return-location";
import {
  defaultTurnstileController,
  type TurnstileController,
} from "@/features/auth/turnstile-controller";
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
    ? {
        status: "signedIn",
        identity: isAnonymousUser(session.user) ? "anonymous" : "permanent",
        session,
        user: session.user,
      }
    : { status: "signedOut", session: null, user: null };
}

interface AuthProviderProps {
  children: ReactNode;
  service?: AuthService | null;
  unavailableReason?: string;
  onIdentityResolved?: (userId: string | null) => void;
  onIdentityChange?: (
    previousUserId: string | null,
    nextUserId: string | null,
  ) => void;
  turnstileController?: TurnstileController;
}

interface GuestSessionRequest {
  promise: Promise<Session>;
  signal?: AbortSignal;
}

export function AuthProvider({
  children,
  service,
  unavailableReason = defaultUnavailableReason,
  onIdentityResolved,
  onIdentityChange,
  turnstileController = defaultTurnstileController,
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
  const currentSessionRef = useRef<Session | null>(null);
  const guestSessionRequestRef = useRef<GuestSessionRequest | null>(null);
  const identityInitializedRef = useRef(false);
  const sessionUpdateVersionRef = useRef(0);

  const applySession = useCallback(
    (session: Session | null) => {
      sessionUpdateVersionRef.current += 1;
      const nextUserId = session?.user.id ?? null;
      const previousUserId = currentUserIdRef.current;
      currentUserIdRef.current = nextUserId;
      currentSessionRef.current = session;
      setAuth(stateFromSession(session));

      if (
        !identityInitializedRef.current ||
        previousUserId !== nextUserId
      ) {
        onIdentityResolved?.(nextUserId);
      }
      if (
        identityInitializedRef.current &&
        previousUserId !== nextUserId
      ) {
        onIdentityChange?.(previousUserId, nextUserId);
      }
      identityInitializedRef.current = true;
    },
    [onIdentityChange, onIdentityResolved],
  );

  useEffect(() => {
    if (!resolvedService) {
      onIdentityResolved?.(null);
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
  }, [applySession, onIdentityResolved, resolvedService]);

  const requireService = useCallback(() => {
    if (!resolvedService) {
      throw new Error(unavailableReason);
    }
    return resolvedService;
  }, [resolvedService, unavailableReason]);

  const ensureGuestSession = useCallback<
    AuthContextValue["ensureGuestSession"]
  >(function ensureGuestSession(
    options?: GuestSessionOptions,
  ): Promise<Session> {
    const existingSession = currentSessionRef.current;
    if (existingSession) {
      return Promise.resolve(existingSession);
    }

    if (options?.signal?.aborted) {
      return Promise.reject(
        new Error("The security check was interrupted. Please try again."),
      );
    }

    const pendingRequest = guestSessionRequestRef.current;
    if (pendingRequest) {
      if (pendingRequest.signal?.aborted && !options?.signal?.aborted) {
        return pendingRequest.promise.catch(() =>
          ensureGuestSession(options),
        );
      }
      return pendingRequest.promise;
    }

    const guestSessionRequest = (async () => {
      const authService = requireService();
      const restoredSession = await authService.getSession();
      const sessionAfterRestoration = currentSessionRef.current;

      if (sessionAfterRestoration) {
        return sessionAfterRestoration;
      }

      if (restoredSession) {
        applySession(restoredSession);
        return restoredSession;
      }

      if (!authService.signInAnonymously) {
        throw new Error("Anonymous sign-in is unavailable.");
      }

      const signInAnonymously = authService.signInAnonymously;
      const anonymousSession = await turnstileController.runWithToken(
        "anonymous-auth",
        (captchaToken) => {
          const sessionBeforeSignup = currentSessionRef.current;
          return sessionBeforeSignup
            ? Promise.resolve(sessionBeforeSignup)
            : signInAnonymously(captchaToken);
        },
        options?.signal,
      );
      const activeSession = currentSessionRef.current;

      if (activeSession) {
        return activeSession;
      }

      applySession(anonymousSession);
      return anonymousSession;
    })();
    const trackedRequest = guestSessionRequest.finally(() => {
      if (guestSessionRequestRef.current?.promise === trackedRequest) {
        guestSessionRequestRef.current = null;
      }
    });

    const requestRecord = { promise: trackedRequest, signal: options?.signal };
    guestSessionRequestRef.current = requestRecord;
    return trackedRequest;
  }, [applySession, requireService, turnstileController]);

  const restoreSession = useCallback<AuthContextValue["restoreSession"]>(
    async (session) => {
      if (!isAnonymousUser(session.user)) {
        throw new Error("Only an anonymous session can be restored here.");
      }
      const authService = requireService();
      if (!authService.restoreSession) {
        throw new Error("Session restoration is unavailable.");
      }
      const restoredSession = await authService.restoreSession(session);
      if (
        restoredSession.user.id !== session.user.id ||
        !isAnonymousUser(restoredSession.user)
      ) {
        throw new Error("Supabase did not restore the anonymous session.");
      }
      applySession(restoredSession);
      return restoredSession;
    },
    [applySession, requireService],
  );

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
      const authService = requireService();
      const redirectTo = getAuthCallbackUrl(options?.callbackParameters);
      await turnstileController.runWithToken(
        "magic-link",
        (captchaToken) =>
          authService.sendMagicLink(email, redirectTo, captchaToken),
      );
    },
    [requireService, turnstileController],
  );

  const completeAuthCallback = useCallback<
    AuthContextValue["completeAuthCallback"]
  >(
    async (code, flowId) => {
      const session = await requireService().exchangeCodeForSession(
        code,
        flowId,
      );
      applySession(session);
      return session;
    },
    [applySession, requireService],
  );

  const completeEmailAuthCallback = useCallback<
    AuthContextValue["completeEmailAuthCallback"]
  >(
    async (tokenHash) => {
      const session = await requireService().verifyEmailOtp(tokenHash);
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
      completeEmailAuthCallback,
      ensureGuestSession,
      restoreSession,
      sendMagicLink,
      signInWithGoogle,
      signOut,
    }),
    [
      auth,
      completeAuthCallback,
      completeEmailAuthCallback,
      ensureGuestSession,
      restoreSession,
      sendMagicLink,
      signInWithGoogle,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
