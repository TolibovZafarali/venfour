import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from "react-router";
import { describe, expect, test, vi } from "vitest";

import {
  AccountControl,
  AuthCallbackPage,
  AuthProvider,
  MobileAccountControl,
  SignInDialogProvider,
  useSignInDialog,
} from "@/features/auth";
import type { AuthService } from "@/features/auth/auth-service";
import { storeAuthReturnLocation } from "@/features/auth/return-location";

function sessionFor(id: string, name?: string) {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-18T00:00:00Z",
      email: `${id}@example.com`,
      id,
      user_metadata: name ? { full_name: name } : {},
    },
  } as Session;
}

function createService(overrides: Partial<AuthService> = {}) {
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor("callback-user")),
    getSession: vi.fn(async () => null),
    onAuthStateChange: vi.fn(() => () => undefined),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => sessionFor("email-user")),
    ...overrides,
  };
  return service;
}

function SignInLauncher() {
  const { openSignIn } = useSignInDialog();
  return (
    <button type="button" onClick={() => openSignIn({ returnTo: "/cases" })}>
      Open sign in
    </button>
  );
}

function SecureReportSignInLauncher() {
  const { openSignIn } = useSignInDialog();
  return (
    <button
      type="button"
      onClick={() =>
        openSignIn({
          intent: "secure-report-upload",
          returnTo: "/total-loss/start",
        })
      }
    >
      Secure report sign in
    </button>
  );
}

function renderSignIn(service: AuthService | null = createService()) {
  return render(
    <MemoryRouter>
      <AuthProvider service={service}>
        <SignInDialogProvider>
          <SignInLauncher />
        </SignInDialogProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("sign-in dialog", () => {
  test("validates email, submits normalized email, and shows success", async () => {
    const user = userEvent.setup();
    const service = createService();
    renderSignIn(service);

    const trigger = screen.getByRole("button", { name: "Open sign in" });
    trigger.focus();
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Sign in to Venfour" });
    expect(
      within(dialog).getByRole("button", { name: "Continue with Google" }),
    ).toHaveFocus();

    await user.click(
      within(dialog).getByRole("button", { name: "Continue with Email" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter a valid email address.",
    );

    await user.type(
      within(dialog).getByRole("textbox", { name: "Email address" }),
      "  Owner@Example.com  ",
    );
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Check your email" }),
      ).toBeVisible(),
    );
    expect(service.sendMagicLink).toHaveBeenCalledWith(
      "owner@example.com",
      `${window.location.origin}/auth/callback`,
    );
    expect(screen.getByText("owner@example.com")).toBeVisible();
  });

  test("starts Google sign-in with the exact callback URL", async () => {
    const user = userEvent.setup();
    const service = createService();
    renderSignIn(service);

    await user.click(screen.getByRole("button", { name: "Open sign in" }));
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(service.signInWithGoogle).toHaveBeenCalledWith(
      `${window.location.origin}/auth/callback`,
    );
  });

  test("supports intent-specific copy without changing the reusable dialog", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider service={createService()}>
          <SignInDialogProvider>
            <SecureReportSignInLauncher />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: "Secure report sign in" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Sign in to Venfour" }),
    ).toHaveTextContent(
      "Sign in so Venfour can securely store your insurance valuation report",
    );
  });

  test("disables competing controls while an email link is pending", async () => {
    const user = userEvent.setup();
    let finishSending!: () => void;
    const sendMagicLink = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSending = resolve;
        }),
    );
    const service = createService({ sendMagicLink });
    renderSignIn(service);

    await user.click(screen.getByRole("button", { name: "Open sign in" }));
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "owner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Continue with Email" }));

    expect(screen.getByRole("button", { name: "Sending secure link…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Email address" })).toBeDisabled();

    finishSending();
    expect(
      await screen.findByRole("dialog", { name: "Check your email" }),
    ).toBeVisible();
  });

  test("shows friendly provider and rate-limit errors", async () => {
    const user = userEvent.setup();
    const service = createService({
      sendMagicLink: vi.fn(async () => {
        throw { message: "email rate limit exceeded", status: 429 };
      }),
      signInWithGoogle: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });
    renderSignIn(service);

    await user.click(screen.getByRole("button", { name: "Open sign in" }));
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t start Google sign-in.",
    );

    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "owner@example.com",
    );
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Too many sign-in attempts.",
      ),
    );
  });

  test("traps focus, closes with Escape, and restores trigger focus", async () => {
    const user = userEvent.setup();
    renderSignIn();

    const trigger = screen.getByRole("button", { name: "Open sign in" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("explains unavailable configuration without provider controls", async () => {
    const user = userEvent.setup();
    renderSignIn(null);

    await user.click(screen.getByRole("button", { name: "Open sign in" }));
    const dialog = screen.getByRole("dialog", { name: "Sign in to Venfour" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Continue with Google" }),
    ).not.toBeInTheDocument();
  });
});

describe("account control", () => {
  test("reserves loading space and opens sign in when signed out", async () => {
    const user = userEvent.setup();
    let resolveSession!: (session: Session | null) => void;
    const getSession = vi.fn(
      () =>
        new Promise<Session | null>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const service = createService({ getSession });
    render(
      <MemoryRouter>
        <AuthProvider service={service}>
          <SignInDialogProvider>
            <AccountControl />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(document.querySelector("[data-auth-state='loading']")).toBeTruthy();
    resolveSession(null);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign In" })).toBeVisible(),
    );
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(screen.getByRole("dialog", { name: "Sign in to Venfour" })).toBeVisible();
  });

  test("shows first name, identity, and signs out from the account menu", async () => {
    const user = userEvent.setup();
    const service = createService({
      getSession: vi.fn(async () => sessionFor("owner", "Jordan Rivera")),
    });
    render(
      <MemoryRouter>
        <AuthProvider service={service}>
          <SignInDialogProvider>
            <AccountControl />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const account = await screen.findByRole("button", {
      name: "Account for owner@example.com",
    });
    expect(account).toHaveTextContent("Jordan");
    await user.click(account);
    expect(screen.getByText("owner@example.com")).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
    await waitFor(() => expect(service.signOut).toHaveBeenCalledOnce());
  });

  test("keeps desktop sign-out errors visible inside the account menu", async () => {
    const user = userEvent.setup();
    const service = createService({
      getSession: vi.fn(async () => sessionFor("owner")),
      signOut: vi.fn(async () => {
        throw new Error("sign out failed");
      }),
    });
    render(
      <MemoryRouter>
        <AuthProvider service={service}>
          <SignInDialogProvider>
            <AccountControl />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Account for owner@example.com",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent("We couldn’t sign you out.");
    expect(screen.getByRole("menu")).toBeVisible();
  });

  test("keeps the mobile sign-in trigger mounted for focus restoration", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <MemoryRouter>
        <AuthProvider service={createService()}>
          <SignInDialogProvider>
            <MobileAccountControl onAction={onAction} />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const trigger = await screen.findByRole("button", { name: "Sign In" });
    await user.click(trigger);
    expect(onAction).not.toHaveBeenCalled();
    expect(trigger).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("auth callback", () => {
  test("exchanges the code and navigates to a stored safe location", async () => {
    const service = createService();
    storeAuthReturnLocation("/destination?from=auth");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback", element: <AuthCallbackPage /> },
        { path: "/destination", element: <h1>Destination</h1> },
      ],
      {
        initialEntries: [
          "/auth/callback?code=secure-code&sb_flow_id=0123456789abcdef0123456789abcdef",
        ],
      },
    );

    render(
      <AuthProvider service={service}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    expect(screen.getByRole("heading", { name: "Finishing your sign in" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Destination" })).toBeVisible();
    expect(service.exchangeCodeForSession).toHaveBeenCalledWith(
      "secure-code",
      "0123456789abcdef0123456789abcdef",
    );
    expect(router.state.location.search).toBe("?from=auth");
  });

  test("exchanges a callback code even when an older session is restored", async () => {
    const exchangeCodeForSession = vi.fn(async () => sessionFor("new-user"));
    const service = createService({
      exchangeCodeForSession,
      getSession: vi.fn(async () => sessionFor("existing-user")),
    });
    storeAuthReturnLocation("/destination");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback", element: <AuthCallbackPage /> },
        { path: "/destination", element: <h1>Destination</h1> },
      ],
      { initialEntries: ["/auth/callback?code=new-account-code"] },
    );

    render(
      <AuthProvider service={service}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Destination" })).toBeVisible();
    expect(exchangeCodeForSession).toHaveBeenCalledWith(
      "new-account-code",
      undefined,
    );
  });

  test("renders callback errors and never exchanges a rejected callback", async () => {
    const service = createService();
    const router = createMemoryRouter(
      [
        { path: "/auth/callback", element: <AuthCallbackPage /> },
        { path: "/", element: <h1>Home</h1> },
      ],
      {
        initialEntries: [
          "/auth/callback?error=access_denied&error_description=Cancelled",
        ],
      },
    );

    render(
      <AuthProvider service={service}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "We couldn’t sign you in" }),
    ).toBeVisible();
    expect(service.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(service.verifyEmailOtp).not.toHaveBeenCalled();
  });

  test("reports exchange failures once under Strict Mode", async () => {
    const exchangeCodeForSession = vi.fn(async () => {
      throw new Error("expired code");
    });
    const service = createService({ exchangeCodeForSession });
    const router = createMemoryRouter(
      [{ path: "/auth/callback", element: <AuthCallbackPage /> }],
      { initialEntries: ["/auth/callback?code=expired-code"] },
    );

    render(
      <StrictMode>
        <AuthProvider service={service}>
          <RouterProvider router={router} />
        </AuthProvider>
      </StrictMode>,
    );

    expect(
      await screen.findByRole("heading", { name: "We couldn’t sign you in" }),
    ).toBeVisible();
    expect(exchangeCodeForSession).toHaveBeenCalledOnce();
  });
});
