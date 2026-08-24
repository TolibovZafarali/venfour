import { act, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

import { useAuth } from "@/features/auth/auth-context";
import { AuthProvider } from "@/features/auth/auth-provider";
import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import type {
  TurnstileAction,
  TurnstileController,
} from "@/features/auth/turnstile-controller";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function sessionFor(
  id: string,
  email = `${id}@example.com`,
  identity: "anonymous" | "permanent" = "permanent",
) {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {
        provider: identity === "anonymous" ? "anonymous" : "email",
      },
      aud: "authenticated",
      created_at: "2026-08-18T00:00:00Z",
      email,
      id,
      is_anonymous: identity === "anonymous",
      user_metadata: {},
    },
  } as Session;
}

interface FakeAuthService {
  emit: (session: Session | null, event?: AuthChangeEvent) => void;
  service: AuthService;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createFakeAuthService(
  getSession: AuthService["getSession"] = async () => null,
): FakeAuthService {
  let listener: AuthStateChangeListener | null = null;
  const unsubscribe = vi.fn();
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor("callback-user")),
    getSession,
    onAuthStateChange: vi.fn((nextListener) => {
      listener = nextListener;
      return unsubscribe;
    }),
    restoreSession: vi.fn(async (session) => session),
    sendMagicLink: vi.fn(async () => undefined),
    signInAnonymously: vi.fn(async () =>
      sessionFor("anonymous-user", "", "anonymous"),
    ),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => sessionFor("email-user")),
  };

  return {
    emit(session, event = session ? "SIGNED_IN" : "SIGNED_OUT") {
      listener?.(event, session);
    },
    service,
    unsubscribe,
  };
}

function createTurnstileHarness(tokens: string[]) {
  const runWithToken = vi.fn<
    (
      action: TurnstileAction,
      operation: (captchaToken: string) => Promise<unknown>,
      signal?: AbortSignal,
    ) => void
  >();
  const controller: TurnstileController = {
    async runWithToken<T>(
      action: TurnstileAction,
      operation: (captchaToken: string) => Promise<T>,
      signal?: AbortSignal,
    ) {
      runWithToken(action, operation, signal);
      const token = tokens.shift();
      if (!token) throw new Error("No test Turnstile token available.");
      return operation(token);
    },
  };
  return {
    controller,
    runWithToken,
  };
}

function AuthProbe() {
  const {
    auth,
    completeAuthCallback,
    ensureGuestSession,
    restoreSession,
    sendMagicLink,
    signOut,
  } = useAuth();
  return (
    <div>
      <output data-testid="status">{auth.status}</output>
      <output data-testid="user">
        {auth.status === "signedIn" ? auth.user.id : "none"}
      </output>
      <output data-testid="identity">
        {auth.status === "signedIn" ? auth.identity : "none"}
      </output>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <button
        type="button"
        onClick={() => void completeAuthCallback("callback-code")}
      >
        Complete callback
      </button>
      <button
        type="button"
        onClick={() =>
          void Promise.all([
            sendMagicLink("first@example.com"),
            sendMagicLink("second@example.com"),
          ])
        }
      >
        Send magic links twice
      </button>
      <button
        type="button"
        onClick={() =>
          void Promise.all([ensureGuestSession(), ensureGuestSession()])
        }
      >
        Ensure guest twice
      </button>
      <button
        type="button"
        onClick={() =>
          void restoreSession(
            sessionFor("recovery-guest", "", "anonymous"),
          )
        }
      >
        Restore guest
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  test("restores a persisted signed-out session and unsubscribes", async () => {
    const fake = createFakeAuthService();
    const { unmount } = render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signedOut"),
    );

    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  test("restores an existing session", async () => {
    const fake = createFakeAuthService(async () => sessionFor("restored"));
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("restored"),
    );
  });

  test("classifies anonymous sessions without treating them as signed out", async () => {
    const anonymousSession = sessionFor("restored-guest", "", "anonymous");
    delete anonymousSession.user.is_anonymous;
    const fake = createFakeAuthService(async () => anonymousSession);
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("restored-guest"),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("signedIn");
    expect(screen.getByTestId("identity")).toHaveTextContent("anonymous");
  });

  test("shares one anonymous sign-in across concurrent guest requests", async () => {
    const fake = createFakeAuthService();
    const turnstile = createTurnstileHarness(["guest-captcha-token"]);
    render(
      <AuthProvider
        service={fake.service}
        turnstileController={turnstile.controller}
      >
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signedOut"),
    );
    screen.getByRole("button", { name: "Ensure guest twice" }).click();

    await waitFor(() =>
      expect(fake.service.signInAnonymously).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("identity")).toHaveTextContent("anonymous"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("anonymous-user");
    expect(turnstile.runWithToken).toHaveBeenCalledOnce();
    expect(turnstile.runWithToken).toHaveBeenCalledWith(
      "anonymous-auth",
      expect.any(Function),
      undefined,
    );
    expect(fake.service.signInAnonymously).toHaveBeenCalledWith(
      "guest-captcha-token",
    );
  });

  test("does not start anonymous signup when a session arrives during the challenge", async () => {
    const fake = createFakeAuthService();
    const token = createDeferred<string>();
    const runWithTokenCall = vi.fn();
    const controller: TurnstileController = {
      async runWithToken<T>(
        action: TurnstileAction,
        operation: (captchaToken: string) => Promise<T>,
        signal?: AbortSignal,
      ): Promise<T> {
        runWithTokenCall(action, operation, signal);
        return operation(await token.promise);
      },
    };
    render(
      <AuthProvider
        service={fake.service}
        turnstileController={controller}
      >
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signedOut"),
    );
    screen.getByRole("button", { name: "Ensure guest twice" }).click();
    await waitFor(() => expect(runWithTokenCall).toHaveBeenCalledOnce());

    act(() => fake.emit(sessionFor("challenge-account")));
    await act(async () => token.resolve("late-challenge-token"));

    expect(fake.service.signInAnonymously).not.toHaveBeenCalled();
    expect(screen.getByTestId("identity")).toHaveTextContent("permanent");
    expect(screen.getByTestId("user")).toHaveTextContent("challenge-account");
  });

  test("uses a fresh security token for every magic-link request", async () => {
    const fake = createFakeAuthService();
    const turnstile = createTurnstileHarness([
      "magic-captcha-token-1",
      "magic-captcha-token-2",
    ]);
    render(
      <AuthProvider
        service={fake.service}
        turnstileController={turnstile.controller}
      >
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signedOut"),
    );
    screen.getByRole("button", { name: "Send magic links twice" }).click();

    await waitFor(() =>
      expect(fake.service.sendMagicLink).toHaveBeenCalledTimes(2),
    );
    expect(fake.service.sendMagicLink).toHaveBeenNthCalledWith(
      1,
      "first@example.com",
      `${window.location.origin}/auth/callback`,
      "magic-captcha-token-1",
    );
    expect(fake.service.sendMagicLink).toHaveBeenNthCalledWith(
      2,
      "second@example.com",
      `${window.location.origin}/auth/callback`,
      "magic-captcha-token-2",
    );
    expect(turnstile.runWithToken).toHaveBeenCalledTimes(2);
  });

  test("reuses a permanent session instead of replacing it with a guest", async () => {
    const fake = createFakeAuthService(async () => sessionFor("account-user"));
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("identity")).toHaveTextContent("permanent"),
    );
    screen.getByRole("button", { name: "Ensure guest twice" }).click();

    expect(fake.service.signInAnonymously).not.toHaveBeenCalled();
    expect(screen.getByTestId("user")).toHaveTextContent("account-user");
  });

  test("restores an anonymous session through the auth service", async () => {
    const fake = createFakeAuthService(async () => sessionFor("account-user"));
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("account-user"),
    );
    screen.getByRole("button", { name: "Restore guest" }).click();

    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("recovery-guest"),
    );
    expect(screen.getByTestId("identity")).toHaveTextContent("anonymous");
    expect(fake.service.restoreSession).toHaveBeenCalledOnce();
  });

  test("does not overwrite a permanent auth event with a stale guest response", async () => {
    const guestCreation = createDeferred<Session>();
    const fake = createFakeAuthService();
    fake.service.signInAnonymously = vi.fn(() => guestCreation.promise);
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signedOut"),
    );
    screen.getByRole("button", { name: "Ensure guest twice" }).click();
    await waitFor(() =>
      expect(fake.service.signInAnonymously).toHaveBeenCalledOnce(),
    );

    act(() => fake.emit(sessionFor("shared-user")));
    await act(async () =>
      guestCreation.resolve(sessionFor("shared-user", "", "anonymous")),
    );

    expect(screen.getByTestId("identity")).toHaveTextContent("permanent");
    expect(screen.getByTestId("user")).toHaveTextContent("shared-user");
  });

  test("does not let stale restoration override a newer auth event", async () => {
    const restoration = createDeferred<Session | null>();
    const fake = createFakeAuthService(() => restoration.promise);
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    act(() => fake.emit(sessionFor("event-user")));
    expect(screen.getByTestId("user")).toHaveTextContent("event-user");

    await act(async () => restoration.resolve(null));
    expect(screen.getByTestId("user")).toHaveTextContent("event-user");
  });

  test("does not let stale restoration override a completed callback", async () => {
    const restoration = createDeferred<Session | null>();
    const fake = createFakeAuthService(() => restoration.promise);
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Complete callback" }).click();
    });
    expect(screen.getByTestId("user")).toHaveTextContent("callback-user");

    await act(async () => restoration.resolve(null));
    expect(screen.getByTestId("user")).toHaveTextContent("callback-user");
  });

  test("tracks auth changes, sign-out, and identity changes", async () => {
    const fake = createFakeAuthService(async () => sessionFor("first"));
    const onIdentityChange = vi.fn();
    const onIdentityResolved = vi.fn();
    render(
      <AuthProvider
        service={fake.service}
        onIdentityChange={onIdentityChange}
        onIdentityResolved={onIdentityResolved}
      >
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("first"),
    );
    expect(onIdentityChange).not.toHaveBeenCalled();
    expect(onIdentityResolved).toHaveBeenLastCalledWith("first");

    act(() => fake.emit(sessionFor("second")));
    expect(onIdentityChange).toHaveBeenCalledWith("first", "second");
    expect(onIdentityResolved).toHaveBeenLastCalledWith("second");

    screen.getByRole("button", { name: "Sign out" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signedOut"),
    );
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    expect(onIdentityChange).toHaveBeenLastCalledWith("second", null);
    expect(onIdentityResolved).toHaveBeenLastCalledWith(null);
  });

  test("exposes an explicit unavailable state without calling a service", () => {
    const onIdentityResolved = vi.fn();
    render(
      <AuthProvider
        service={null}
        unavailableReason="Missing public config"
        onIdentityResolved={onIdentityResolved}
      >
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("unavailable");
    expect(onIdentityResolved).toHaveBeenCalledWith(null);
  });

  test("falls back to signed out when restoration fails", async () => {
    const restoration = createDeferred<Session | null>();
    const fake = createFakeAuthService(() => restoration.promise);
    render(
      <AuthProvider service={fake.service}>
        <AuthProbe />
      </AuthProvider>,
    );

    await act(async () => restoration.reject(new Error("storage failed")));
    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
  });
});
