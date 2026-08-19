import { act, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, test, vi } from "vitest";

import { useAuth } from "@/features/auth/auth-context";
import { AuthProvider } from "@/features/auth/auth-provider";
import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function sessionFor(id: string, email = `${id}@example.com`) {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-18T00:00:00Z",
      email,
      id,
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
    sendMagicLink: vi.fn(async () => undefined),
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

function AuthProbe() {
  const { auth, completeAuthCallback, signOut } = useAuth();
  return (
    <div>
      <output data-testid="status">{auth.status}</output>
      <output data-testid="user">
        {auth.status === "signedIn" ? auth.user.id : "none"}
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
