import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
  TurnstileAction,
  TurnstileController,
} from "@/features/auth";
import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const ANONYMOUS_USER_ID = "11111111-1111-4111-8111-111111111111";
const PERMANENT_USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_PATH = `/total-loss/cases/${CASE_ID}/claim`;
const CONTACT_EMAIL = "owner@example.com";

function sessionFor(
  id: string,
  identity: "anonymous" | "permanent",
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
      created_at: "2026-08-26T12:00:00.000Z",
      email: identity === "permanent" ? CONTACT_EMAIL : undefined,
      id,
      is_anonymous: identity === "anonymous",
      user_metadata: {},
    },
  } as Session;
}

function createAuthService(
  session: Session | null,
  overrides: Partial<AuthService> = {},
) {
  return {
    exchangeCodeForSession: vi.fn(async () =>
      sessionFor(PERMANENT_USER_ID, "permanent"),
    ),
    getSession: vi.fn(async () => session),
    onAuthStateChange: vi.fn(() => () => undefined),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () =>
      sessionFor(PERMANENT_USER_ID, "permanent"),
    ),
    ...overrides,
  } satisfies AuthService;
}

function createTurnstileController() {
  let sequence = 0;
  const runWithToken = vi.fn();
  const controller: TurnstileController = {
    async runWithToken<T>(
      action: TurnstileAction,
      operation: (captchaToken: string) => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      runWithToken(action, operation, signal);
      if (signal?.aborted) throw new Error("Security check interrupted.");
      sequence += 1;
      return operation(`test-${action}-${sequence}`);
    },
  };
  return { controller, runWithToken };
}

function secureRequiredResponse() {
  return {
    state: "secure_required",
    caseId: CASE_ID,
    commerce: null,
    contactEmail: CONTACT_EMAIL,
    workflow: null,
  };
}

describe("total-loss claim page", () => {
  it("shows an authorized anonymous owner the saved email and sends a case-bound magic link", async () => {
    let resolverAuthorization: string | null = null;
    let accessLinkAuthorization: string | null = null;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
        resolverAuthorization = request.headers.get("Authorization");
        return HttpResponse.json(secureRequiredResponse());
      }),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        ({ request }) => {
          accessLinkAuthorization = request.headers.get("Authorization");
          return HttpResponse.json(
            {
              state: "secure_required",
              caseId: CASE_ID,
              contactEmail: CONTACT_EMAIL,
              claimId: CLAIM_ID,
              expiresAt: "2026-08-26T13:00:00.000Z",
            },
            { status: 202 },
          );
        },
      ),
    );
    const user = userEvent.setup();
    const authService = createAuthService(
      sessionFor(ANONYMOUS_USER_ID, "anonymous"),
    );
    const turnstile = createTurnstileController();

    renderTestApp([CLAIM_PATH], {
      authService,
      authTurnstileController: turnstile.controller,
      strictMode: true,
    });

    expect(
      await screen.findByRole("heading", { name: "Secure and save your claim" }),
    ).toBeVisible();
    expect(screen.getByText(CONTACT_EMAIL)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Send secure link" }));

    expect(await screen.findByText("Secure link sent")).toBeVisible();
    expect(resolverAuthorization).toBe(`Bearer access-${ANONYMOUS_USER_ID}`);
    expect(accessLinkAuthorization).toBe(
      `Bearer access-${ANONYMOUS_USER_ID}`,
    );
    expect(authService.sendMagicLink).toHaveBeenCalledOnce();
    expect(authService.sendMagicLink).toHaveBeenCalledWith(
      CONTACT_EMAIL,
      expect.stringContaining(`/auth/callback/case-claim/${CLAIM_ID}`),
      "test-magic-link-1",
    );
    expect(turnstile.runWithToken).toHaveBeenCalledWith(
      "magic-link",
      expect.any(Function),
      undefined,
    );
    expect(screen.getByRole("button", { name: "Resend secure link" })).toBeVisible();
  });

  it("uses a fresh recovery Turnstile token and shows only the neutral accepted result while signed out", async () => {
    const requests: unknown[] = [];
    let authorization: string | null = "unexpected";
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-recovery",
        async ({ request }) => {
          authorization = request.headers.get("Authorization");
          requests.push(await request.json());
          return HttpResponse.json({ status: "accepted" }, { status: 202 });
        },
      ),
    );
    const user = userEvent.setup();
    const turnstile = createTurnstileController();

    renderTestApp([CLAIM_PATH], {
      authService: createAuthService(null),
      authTurnstileController: turnstile.controller,
    });

    expect(
      await screen.findByRole("heading", { name: "Request a secure claim link" }),
    ).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "Email used for this claim" }),
      "OWNER@EXAMPLE.COM ",
    );
    await user.click(screen.getByRole("button", { name: "Request secure link" }));

    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeVisible();
    expect(
      screen.getByText(/confirmation is the same whether or not/u),
    ).toBeVisible();
    expect(authorization).toBeNull();
    expect(requests).toEqual([
      {
        email: CONTACT_EMAIL,
        turnstileToken: "test-claim-recovery-1",
      },
    ]);
    expect(turnstile.runWithToken).toHaveBeenCalledWith(
      "claim-recovery",
      expect.any(Function),
      undefined,
    );

    await user.click(
      screen.getByRole("button", { name: "Request another link" }),
    );
    await user.click(screen.getByRole("button", { name: "Request secure link" }));
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeVisible();
    expect(requests).toEqual([
      {
        email: CONTACT_EMAIL,
        turnstileToken: "test-claim-recovery-1",
      },
      {
        email: CONTACT_EMAIL,
        turnstileToken: "test-claim-recovery-2",
      },
    ]);
  });

  it("renders a permanent owner as secured without exposing payment UI", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "secured",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: true,
            orderStatus: null,
            paymentStatus: null,
            entitlementStatus: null,
            nextTask: "secure_claim",
          },
          contactEmail: CONTACT_EMAIL,
          workflow: {
            phase: "review",
            currentTask: "secure_claim",
            revision: 1,
          },
        }),
      ),
    );

    renderTestApp([CLAIM_PATH], {
      authService: createAuthService(
        sessionFor(PERMANENT_USER_ID, "permanent"),
      ),
    });

    const securedHeading = await screen.findByRole("heading", {
        name: "Your claim is saved to your account",
      });
    expect(securedHeading).toBeVisible();
    expect(screen.getByRole("link", { name: "View my appraisals" })).toHaveAttribute(
      "href",
      "/appraisals",
    );
    const securedCard = securedHeading.closest("section");
    expect(securedCard).not.toBeNull();
    expect(within(securedCard!).queryByText(CONTACT_EMAIL)).not.toBeInTheDocument();
    expect(within(securedCard!).queryByText(/payment|checkout/iu)).not.toBeInTheDocument();
  });

  it("keeps account-mismatch details bounded and allows switching accounts", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "account_switch_required",
          caseId: CASE_ID,
          commerce: null,
          contactEmail: null,
          workflow: null,
        }),
      ),
    );
    const user = userEvent.setup();
    const signOut = vi.fn(async () => undefined);

    renderTestApp([CLAIM_PATH], {
      authService: createAuthService(
        sessionFor(PERMANENT_USER_ID, "permanent"),
        { signOut },
      ),
    });

    const mismatchHeading = await screen.findByRole("heading", {
        name: "Use the account associated with this claim",
      });
    expect(mismatchHeading).toBeVisible();
    const mismatchCard = mismatchHeading.closest("section");
    expect(mismatchCard).not.toBeNull();
    expect(within(mismatchCard!).queryByText(CONTACT_EMAIL)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Use a different account" }),
    );
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("heading", { name: "Request a secure claim link" }),
    ).toBeVisible();
  });

  it("turns an owner-safe 404 into recovery without revealing case existence", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json(
          {
            error: {
              code: "APPRAISAL_CASE_NOT_FOUND",
              message: "Appraisal case was not found.",
            },
          },
          { status: 404 },
        ),
      ),
    );

    renderTestApp([CLAIM_PATH], {
      authService: createAuthService(
        sessionFor(PERMANENT_USER_ID, "permanent"),
      ),
    });

    const recoveryHeading = await screen.findByRole("heading", {
      name: "Request a secure claim link",
    });
    expect(recoveryHeading).toBeVisible();
    expect(screen.queryByText(/not found/iu)).not.toBeInTheDocument();
    const recoveryCard = recoveryHeading.closest("section");
    expect(recoveryCard).not.toBeNull();
    expect(within(recoveryCard!).queryByText(CONTACT_EMAIL)).not.toBeInTheDocument();
  });

  it("scopes resolver cache state to identity changes", async () => {
    let emitAuthState: AuthStateChangeListener = () => undefined;
    let authorization: string | null = null;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
        authorization = request.headers.get("Authorization");
        return authorization === `Bearer access-${ANONYMOUS_USER_ID}`
          ? HttpResponse.json(secureRequiredResponse())
          : HttpResponse.json({
              state: "secured",
              caseId: CASE_ID,
              contactEmail: CONTACT_EMAIL,
              workflow: null,
            });
      }),
    );
    const service = createAuthService(
      sessionFor(ANONYMOUS_USER_ID, "anonymous"),
      {
        onAuthStateChange: (nextListener) => {
          emitAuthState = nextListener;
          return () => undefined;
        },
      },
    );
    const rendered = renderTestApp([CLAIM_PATH], { authService: service });

    expect(await screen.findByText(CONTACT_EMAIL)).toBeVisible();

    emitAuthState(
      "SIGNED_IN" as AuthChangeEvent,
      sessionFor(PERMANENT_USER_ID, "permanent"),
    );

    const securedHeading = await screen.findByRole("heading", {
      name: "Your claim is saved to your account",
    });
    expect(securedHeading).toBeVisible();
    const securedCard = securedHeading.closest("section");
    expect(securedCard).not.toBeNull();
    expect(within(securedCard!).queryByText(CONTACT_EMAIL)).not.toBeInTheDocument();
    expect(authorization).toBe(`Bearer access-${PERMANENT_USER_ID}`);
    expect(
      rendered.queryClient.getQueryData(
        totalLossClaimQueryKeys.detail(ANONYMOUS_USER_ID, CASE_ID),
      ),
    ).toBeUndefined();
  });

  it("rejects an invalid case route before making an API request", async () => {
    const claimRequest = vi.fn();
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () => {
        claimRequest();
        return HttpResponse.json(secureRequiredResponse());
      }),
    );

    renderTestApp(["/total-loss/cases/not-a-uuid/claim"], {
      authService: createAuthService(null),
    });

    expect(
      await screen.findByRole("heading", { name: "This claim link is invalid" }),
    ).toBeVisible();
    expect(claimRequest).not.toHaveBeenCalled();
  });
});
