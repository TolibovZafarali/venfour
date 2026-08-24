import { act, render, screen, waitFor, within } from "@testing-library/react";
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
import {
  TotalLossDependenciesProvider,
  type TotalLossDependencies,
} from "@/features/total-loss/dependencies";
import type { TotalLossIdentityService } from "@/features/total-loss/identity-service";

const CASE_CLAIM_ID = "88888888-8888-4888-8888-888888888888";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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

function anonymousSessionFor(id: string) {
  const session = sessionFor(id);
  session.user.app_metadata = { provider: "anonymous", providers: [] };
  session.user.is_anonymous = true;
  return session;
}

function createService(overrides: Partial<AuthService> = {}) {
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor("callback-user")),
    getSession: vi.fn(async () => null),
    onAuthStateChange: vi.fn(() => () => undefined),
    restoreSession: vi.fn(async (session) => session),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => sessionFor("email-user")),
    ...overrides,
  };
  return service;
}

function callbackDependencies(
  completeIdentityClaim: TotalLossIdentityService["completeIdentityClaim"],
) {
  const identityService = {
    completeIdentityClaim,
    getContact: vi.fn(async () => null),
    saveContactAndBeginClaim: vi.fn(async () => {
      throw new Error("Unexpected contact save.");
    }),
  } satisfies TotalLossIdentityService;
  return {
    totalLossIdentityService: identityService,
  } as unknown as TotalLossDependencies;
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
      expect.stringMatching(/^turnstile-test-magic-link-/u),
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
      "Sign in to open a saved Total Loss case and its private valuation report.",
    );
    expect(
      screen.getByRole("link", { name: "Terms of Use" }),
    ).toHaveAttribute("href", "/terms");
  });

  test("links the current legal pages and closes before navigating", async () => {
    const user = userEvent.setup();
    renderSignIn(createService());

    await user.click(screen.getByRole("button", { name: "Open sign in" }));

    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Cookie Policy" })).toHaveAttribute(
      "href",
      "/cookies",
    );

    await user.click(screen.getByRole("link", { name: "Terms of Use" }));
    expect(
      screen.queryByRole("dialog", { name: "Sign in to Venfour" }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.getByRole("menuitem", { name: "My appraisals" }),
    ).toHaveAttribute("href", "/appraisals");
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
    await waitFor(() => expect(service.signOut).toHaveBeenCalledOnce());
  });

  test("keeps an authenticated anonymous session visually signed out", async () => {
    const service = createService({
      getSession: vi.fn(async () => anonymousSessionFor("guest")),
    });
    render(
      <MemoryRouter>
        <AuthProvider service={service}>
          <SignInDialogProvider>
            <AccountControl />
            <MobileAccountControl />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findAllByRole("button", { name: "Sign In" }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /Account for/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "My appraisals" }),
    ).not.toBeInTheDocument();
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

  test("links a signed-in mobile customer to their appraisals", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <MemoryRouter>
        <AuthProvider
          service={createService({
            getSession: vi.fn(async () => sessionFor("owner")),
          })}
        >
          <SignInDialogProvider>
            <MobileAccountControl onAction={onAction} />
          </SignInDialogProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const appraisals = await screen.findByRole("link", {
      name: "My appraisals",
    });
    expect(appraisals).toHaveAttribute("href", "/appraisals");
    await user.click(appraisals);
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe("auth callback", () => {
  test("exchanges the code and navigates to a stored safe location", async () => {
    const service = createService();
    storeAuthReturnLocation("/destination?from=auth");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback/*", element: <AuthCallbackPage /> },
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

  test("waits for restoration before exchanging a callback code", async () => {
    const restoration = createDeferred<Session | null>();
    const exchangeCodeForSession = vi.fn(async () => sessionFor("new-user"));
    const service = createService({
      exchangeCodeForSession,
      getSession: vi.fn(() => restoration.promise),
    });
    storeAuthReturnLocation("/destination");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback/*", element: <AuthCallbackPage /> },
        { path: "/destination", element: <h1>Destination</h1> },
      ],
      { initialEntries: ["/auth/callback?code=new-account-code"] },
    );

    render(
      <AuthProvider service={service}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await waitFor(() => expect(service.getSession).toHaveBeenCalledOnce());
    expect(exchangeCodeForSession).not.toHaveBeenCalled();

    await act(async () => {
      restoration.resolve(anonymousSessionFor("existing-guest"));
      await restoration.promise;
    });

    expect(await screen.findByRole("heading", { name: "Destination" })).toBeVisible();
    expect(exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(exchangeCodeForSession).toHaveBeenCalledWith(
      "new-account-code",
      undefined,
    );
  });

  test("restores a captured guest when verified case claiming fails", async () => {
    const guestSession = anonymousSessionFor("existing-guest");
    const permanentSession = sessionFor("claim-owner");
    const completeIdentityClaim = vi.fn<
      TotalLossIdentityService["completeIdentityClaim"]
    >(async () => {
      throw new Error("The case claim is unavailable.");
    });
    const dependencies = callbackDependencies(completeIdentityClaim);
    const service = createService({
      getSession: vi.fn(async () => guestSession),
      verifyEmailOtp: vi.fn(async () => permanentSession),
    });
    storeAuthReturnLocation("/destination");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback/*", element: <AuthCallbackPage /> },
        { path: "/destination", element: <h1>Destination</h1> },
      ],
      {
        initialEntries: [
          `/auth/callback/case-claim/${CASE_CLAIM_ID}?token_hash=claim-token&type=email`,
        ],
      },
    );

    render(
      <TotalLossDependenciesProvider dependencies={dependencies}>
        <AuthProvider service={service}>
          <RouterProvider router={router} />
        </AuthProvider>
      </TotalLossDependenciesProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "We couldn’t sign you in" }),
    ).toBeVisible();
    expect(service.verifyEmailOtp).toHaveBeenCalledWith("claim-token");
    expect(completeIdentityClaim).toHaveBeenCalledOnce();
    expect(completeIdentityClaim).toHaveBeenCalledWith(CASE_CLAIM_ID);
    expect(service.restoreSession).toHaveBeenCalledOnce();
    expect(service.restoreSession).toHaveBeenCalledWith(guestSession);
    expect(router.state.location.pathname).toBe(
      `/auth/callback/case-claim/${CASE_CLAIM_ID}`,
    );
  });

  test("keeps the verified session and routes a claimed case through appraisals", async () => {
    const guestSession = anonymousSessionFor("existing-guest");
    const permanentSession = sessionFor("claim-owner");
    const completeIdentityClaim = vi.fn<
      TotalLossIdentityService["completeIdentityClaim"]
    >(async () => ({
      outcome: "claimed",
      caseId: "77777777-7777-4777-8777-777777777777",
      ownerUserId: permanentSession.user.id,
      contactEmail: permanentSession.user.email ?? "claim-owner@example.com",
      emailVerifiedAt: "2026-08-23T20:00:00.000Z",
      claimedAt: "2026-08-23T20:00:00.000Z",
      ownershipTransferred: true,
    }));
    const dependencies = callbackDependencies(completeIdentityClaim);
    const service = createService({
      getSession: vi.fn(async () => guestSession),
      verifyEmailOtp: vi.fn(async () => permanentSession),
    });
    storeAuthReturnLocation(
      "/start?service=total-loss&caseId=77777777-7777-4777-8777-777777777777",
    );
    const router = createMemoryRouter(
      [
        { path: "/auth/callback/*", element: <AuthCallbackPage /> },
        { path: "/appraisals", element: <h1>My appraisals</h1> },
      ],
      {
        initialEntries: [
          `/auth/callback/case-claim/${CASE_CLAIM_ID}?token_hash=claim-token&type=email`,
        ],
      },
    );

    render(
      <TotalLossDependenciesProvider dependencies={dependencies}>
        <AuthProvider service={service}>
          <RouterProvider router={router} />
        </AuthProvider>
      </TotalLossDependenciesProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "My appraisals" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/appraisals");
    expect(service.verifyEmailOtp).toHaveBeenCalledWith("claim-token");
    expect(completeIdentityClaim).toHaveBeenCalledOnce();
    expect(completeIdentityClaim).toHaveBeenCalledWith(CASE_CLAIM_ID);
    expect(service.restoreSession).not.toHaveBeenCalled();
  });

  test("does not complete sign-in from an anonymous session without callback credentials", async () => {
    const service = createService({
      getSession: vi.fn(async () => anonymousSessionFor("existing-guest")),
    });
    storeAuthReturnLocation("/destination");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback", element: <AuthCallbackPage /> },
        { path: "/destination", element: <h1>Destination</h1> },
      ],
      { initialEntries: ["/auth/callback"] },
    );

    render(
      <AuthProvider service={service}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "We couldn’t sign you in" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "missing required information",
    );
    expect(router.state.location.pathname).toBe("/auth/callback");
    expect(service.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(service.verifyEmailOtp).not.toHaveBeenCalled();
  });

  test("rejects a callback result that is still anonymous", async () => {
    const service = createService({
      exchangeCodeForSession: vi.fn(async () =>
        anonymousSessionFor("callback-guest"),
      ),
    });
    storeAuthReturnLocation("/destination");
    const router = createMemoryRouter(
      [
        { path: "/auth/callback", element: <AuthCallbackPage /> },
        { path: "/destination", element: <h1>Destination</h1> },
      ],
      { initialEntries: ["/auth/callback?code=anonymous-code"] },
    );

    render(
      <AuthProvider service={service}>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "We couldn’t sign you in" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/auth/callback");
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
