import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as EnvironmentModule from "@/config/env";
import type {
  AuthService,
  AuthStateChangeListener,
  TurnstileAction,
  TurnstileController,
} from "@/features/auth";
import { ClaimEmailOtpError } from "@/features/total-loss-claim/email-otp-service";
import type * as EmailOtpServiceModule from "@/features/total-loss-claim/email-otp-service";
import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const otp = vi.hoisted(() => ({
  enabled: true,
  sendCode: vi.fn(),
  verifyCodeAndClaim: vi.fn(),
  clearPendingVerification: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvironmentModule>();
  return {
    ...actual,
    environment: {
      ...actual.environment,
      get localPostContinueEnabled() { return otp.enabled; },
    },
  };
});

vi.mock("@/features/total-loss-claim/email-otp-service", async (importOriginal) => {
  const actual = await importOriginal<typeof EmailOtpServiceModule>();
  return {
    ...actual,
    claimEmailOtpService: {
      sendCode: otp.sendCode,
      verifyCodeAndClaim: otp.verifyCodeAndClaim,
      clearPendingVerification: otp.clearPendingVerification,
    },
  };
});

const ANONYMOUS_USER_ID = "11111111-1111-4111-8111-111111111111";
const PERMANENT_USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_PATH = `/total-loss/cases/${CASE_ID}/claim`;
const CHECKOUT_PATH = `${CLAIM_PATH}/checkout`;
const CONTACT_EMAIL = "owner@example.com";
const CODE_LABEL = "Enter the 6-digit code we sent to your email";

function sessionFor(identity: "anonymous" | "permanent") {
  const id = identity === "anonymous" ? ANONYMOUS_USER_ID : PERMANENT_USER_ID;
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: { provider: identity === "anonymous" ? "anonymous" : "email" },
      aud: "authenticated",
      created_at: "2026-08-26T12:00:00.000Z",
      email: identity === "permanent" ? CONTACT_EMAIL : undefined,
      email_confirmed_at: identity === "permanent" ? "2026-08-26T12:00:00.000Z" : undefined,
      id,
      is_anonymous: identity === "anonymous",
      user_metadata: {},
    },
  } as Session;
}

function createAuth(identity: "anonymous" | "permanent" | "signed-out" = "anonymous") {
  let session = identity === "signed-out" ? null : sessionFor(identity);
  const listeners = new Set<AuthStateChangeListener>();
  const service = {
    exchangeCodeForSession: vi.fn(async () => sessionFor("permanent")),
    getSession: vi.fn(async () => session),
    onAuthStateChange: (listener: AuthStateChangeListener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => sessionFor("permanent")),
  } satisfies AuthService;
  return {
    service,
    signInPermanent() {
      session = sessionFor("permanent");
      for (const listener of listeners) listener("SIGNED_IN", session);
    },
  };
}

function createTurnstile(): TurnstileController {
  let sequence = 0;
  return {
    async runWithToken<T>(
      action: TurnstileAction,
      operation: (captchaToken: string) => Promise<T>,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) throw new Error("Security check interrupted.");
      sequence += 1;
      return operation(`test-${action}-${sequence}`);
    },
  };
}

function secureRequired() {
  return {
    state: "secure_required",
    caseId: CASE_ID,
    commerce: null,
    contactEmail: CONTACT_EMAIL,
    workflow: null,
  };
}

function secured() {
  return {
    state: "secured",
    caseId: CASE_ID,
    contactEmail: CONTACT_EMAIL,
    commerce: {
      checkoutAvailable: false,
      entitlementStatus: null,
      nextTask: "checkout",
      orderStatus: null,
      paymentStatus: null,
    },
    workflow: null,
  };
}

function installClaimHandlers() {
  const renewedRequests: { authorization: string | null; body: string }[] = [];
  const paymentInitialization = vi.fn();
  server.use(
    http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) =>
      HttpResponse.json(request.headers.get("Authorization") === `Bearer access-${PERMANENT_USER_ID}`
        ? secured() : secureRequired()),
    ),
    http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () => HttpResponse.json({
      amountMinorUnits: 12900, availability: "available", currency: "USD",
    })),
    http.post("*/api/v1/appraisal-cases/:caseId/checkout-sessions", () => {
      paymentInitialization();
      return HttpResponse.json({}, { status: 403 });
    }),
    http.post("*/api/v1/appraisal-cases/:caseId/claim/access-link", async ({ request }) => {
      renewedRequests.push({ authorization: request.headers.get("Authorization"), body: await request.text() });
      return HttpResponse.json({
        state: "secure_required",
        caseId: CASE_ID,
        contactEmail: CONTACT_EMAIL,
        claimId: CLAIM_ID,
        expiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      }, { status: 202 });
    }),
  );
  return { renewedRequests, paymentInitialization };
}

function renderPurchase(identity: "anonymous" | "permanent" | "signed-out" = "anonymous") {
  const auth = createAuth(identity);
  const result = renderTestApp([CHECKOUT_PATH], {
    authService: auth.service,
    authTurnstileController: createTurnstile(),
    strictMode: true,
  });
  return { ...result, auth };
}

async function requestCode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Send verification code" }));
  return screen.findByRole("textbox", { name: CODE_LABEL });
}

describe("local purchase email verification", () => {
  beforeEach(() => {
    otp.enabled = true;
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    otp.sendCode.mockReset().mockResolvedValue(undefined);
    otp.verifyCodeAndClaim.mockReset().mockResolvedValue(undefined);
    otp.clearPendingVerification.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests a code only for the saved email using the existing bodyless case claim", async () => {
    const { renewedRequests, paymentInitialization } = installClaimHandlers();
    const user = userEvent.setup();
    const { router, auth } = renderPurchase();

    expect(await screen.findByText("ow••••@example.com")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete purchase" })).toBeDisabled();
    expect(otp.sendCode).not.toHaveBeenCalled();
    await requestCode(user);

    expect(renewedRequests).toEqual([{ authorization: `Bearer access-${ANONYMOUS_USER_ID}`, body: "" }]);
    expect(otp.sendCode).toHaveBeenCalledExactlyOnceWith({
      captchaToken: "test-magic-link-1",
      caseId: CASE_ID,
      email: CONTACT_EMAIL,
      expectedUserId: ANONYMOUS_USER_ID,
      signal: expect.any(AbortSignal),
    });
    expect(auth.service.sendMagicLink).not.toHaveBeenCalled();
    expect(screen.getByText("We sent a 6-digit code to ow••••@example.com")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Email used for this claim" })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
    expect(paymentInitialization).not.toHaveBeenCalled();
  });

  it.each(["123456", "123-456", "123 456", "a1b2c3!4@5#6"])(
    "formats pasted %s and sends only six raw digits for verification",
    async (pasted) => {
      installClaimHandlers();
      const user = userEvent.setup();
      renderPurchase();
      const input = await requestCode(user);
      await user.click(input);
      await user.paste(pasted);
      expect(input).toHaveValue("123-456");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      expect(otp.verifyCodeAndClaim).toHaveBeenCalledExactlyOnceWith({
        caseId: CASE_ID,
        claimId: CLAIM_ID,
        email: CONTACT_EMAIL,
        expectedUserId: ANONYMOUS_USER_ID,
        signal: expect.any(AbortSignal),
        token: "123456",
      });
      expect(input).toHaveValue("");
    },
  );

  it("formats typed digits and never stores or logs the code", async () => {
    installClaimHandlers();
    const user = userEvent.setup();
    renderPurchase();
    await screen.findByRole("button", { name: "Send verification code" });
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const input = await requestCode(user);
    await user.type(input, "12ab3456");
    expect(input).toHaveValue("123-456");
    expect(writes).toHaveBeenCalled();
    for (const [key, value] of writes.mock.calls) {
      expect(key).toBe(`venfour:claim-email-code-cooldown:${ANONYMOUS_USER_ID}`);
      expect(value).toMatch(/^\d{13}$/u);
      expect(value).not.toContain("123456");
      expect(value).not.toContain(CONTACT_EMAIL);
      expect(value).not.toContain(CLAIM_ID);
    }
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(logs.flatMap((logger) => logger.mock.calls)).toEqual([]);
  });

  it.each(["invalid_code", "expired_code"] as const)("shows safe copy for %s and allows another attempt", async (errorCode) => {
    installClaimHandlers();
    otp.verifyCodeAndClaim.mockRejectedValueOnce(new ClaimEmailOtpError(errorCode));
    const user = userEvent.setup();
    const { router } = renderPurchase();
    const input = await requestCode(user);
    await user.type(input, "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is incorrect or has expired. Enter the newest code, or request a new one.");
    expect(input).toBeEnabled();
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
    await user.type(input, "654321");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("hides resend until 60 seconds and does not duplicate a pending send", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    installClaimHandlers();
    let release: (() => void) | undefined;
    otp.sendCode.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderPurchase();
    const send = await screen.findByRole("button", { name: "Send verification code" });
    await user.dblClick(send);
    await waitFor(() => expect(otp.sendCode).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Sending verification code…" })).toBeDisabled();
    await act(async () => { release?.(); });
    await screen.findByRole("textbox", { name: CODE_LABEL });
    expect(screen.queryByRole("button", { name: "Resend code" })).not.toBeInTheDocument();
    expect(screen.getByText("You can resend in 60s.")).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(59_000); });
    expect(screen.queryByRole("button", { name: "Resend code" })).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(otp.sendCode).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Resend code" })).not.toBeInTheDocument();
  });

  it("stays on checkout and renders verified after the completed transfer publishes its session", async () => {
    installClaimHandlers();
    const user = userEvent.setup();
    const { router, auth } = renderPurchase();
    otp.verifyCodeAndClaim.mockImplementationOnce(async () => { auth.signInPermanent(); });
    const input = await requestCode(user);
    await user.type(input, "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Verified")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: CODE_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByText("Verify your email above to continue with payment.")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
  });

  it("resumes an existing code after reload during cooldown without sending another email", async () => {
    const { renewedRequests } = installClaimHandlers();
    const user = userEvent.setup();
    const first = renderPurchase();
    await requestCode(user);
    const retryKey = `venfour:claim-email-code-cooldown:${ANONYMOUS_USER_ID}`;
    const retryAt = window.localStorage.getItem(retryKey);
    first.unmount();
    otp.sendCode.mockClear();

    const { router } = renderPurchase();
    expect(await screen.findByRole("button", { name: "Send verification code" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Already have a code?" }));
    const input = await screen.findByRole("textbox", { name: CODE_LABEL });
    expect(screen.getByText("Use the newest code sent to ow••••@example.com")).toBeVisible();
    expect(screen.queryByText("We sent a 6-digit code to ow••••@example.com")).not.toBeInTheDocument();
    expect(otp.sendCode).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(retryKey)).toBe(retryAt);
    expect(renewedRequests).toHaveLength(2);
    expect(renewedRequests[1]).toEqual({ authorization: `Bearer access-${ANONYMOUS_USER_ID}`, body: "" });
    await user.type(input, "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(otp.verifyCodeAndClaim).toHaveBeenCalledWith(expect.objectContaining({ token: "123456", claimId: CLAIM_ID }));
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
  });

  it("refreshes as verified when another tab publishes the permanent owner session", async () => {
    installClaimHandlers();
    const user = userEvent.setup();
    const { auth, router } = renderPurchase();
    const input = await requestCode(user);
    await user.type(input, "123");
    await act(async () => { auth.signInPermanent(); });
    expect(await screen.findByText("Verified")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: CODE_LABEL })).not.toBeInTheDocument();
    expect(otp.verifyCodeAndClaim).not.toHaveBeenCalled();
    expect(otp.sendCode).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
  });

  it("retries session installation after clearing the code without requesting another email", async () => {
    installClaimHandlers();
    const user = userEvent.setup();
    const { auth, router } = renderPurchase();
    otp.verifyCodeAndClaim
      .mockRejectedValueOnce(new ClaimEmailOtpError("session_install_failed"))
      .mockImplementationOnce(async () => { auth.signInPermanent(); });
    const input = await requestCode(user);
    await user.type(input, "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select Verify again to retry.");
    expect(input).toHaveValue("");
    expect(input).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(otp.verifyCodeAndClaim).toHaveBeenNthCalledWith(2, expect.objectContaining({ token: "", claimId: CLAIM_ID }));
    expect(await screen.findByText("Verified")).toBeVisible();
    expect(otp.sendCode).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
  });

  it("keeps retry verification on checkout after server transfer despite focus and reconnect events", async () => {
    const { paymentInitialization } = installClaimHandlers();
    let transferred = false;
    let anonymousReads = 0;
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
      if (request.headers.get("Authorization") === `Bearer access-${PERMANENT_USER_ID}`) {
        return HttpResponse.json(secured());
      }
      anonymousReads += 1;
      return transferred
        ? HttpResponse.json({ detail: "Not found" }, { status: 404 })
        : HttpResponse.json(secureRequired());
    }));
    const user = userEvent.setup();
    const result = renderPurchase();
    otp.verifyCodeAndClaim
      .mockImplementationOnce(async () => {
        transferred = true;
        throw new ClaimEmailOtpError("session_install_failed");
      })
      .mockImplementationOnce(async () => { result.auth.signInPermanent(); });
    try {
      const input = await requestCode(user);
      await user.type(input, "123456");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Select Verify again to retry.");
      const readsBeforeFocus = anonymousReads;

      await act(async () => {
        focusManager.setFocused(false);
        onlineManager.setOnline(false);
      });
      await act(async () => {
        onlineManager.setOnline(true);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(result.queryClient.isFetching({
        queryKey: totalLossClaimQueryKeys.detail(ANONYMOUS_USER_ID, CASE_ID),
      })).toBe(0));

      expect(anonymousReads).toBe(readsBeforeFocus);
      expect(result.router.state.location.pathname).toBe(CHECKOUT_PATH);
      expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Complete purchase" })).toBeDisabled();
      expect(screen.queryByRole("textbox", { name: "Email used for this claim" })).not.toBeInTheDocument();
      expect(paymentInitialization).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Verify" }));
      expect(await screen.findByText("Verified")).toBeVisible();
      expect(otp.verifyCodeAndClaim).toHaveBeenNthCalledWith(2, expect.objectContaining({ token: "", claimId: CLAIM_ID }));
      expect(result.router.state.location.pathname).toBe(CHECKOUT_PATH);
      expect(otp.sendCode).toHaveBeenCalledOnce();
    } finally {
      result.unmount();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
    }
  });

  it("retains the authorized retry panel when an already-inflight old-owner resolver returns 404", async () => {
    const { paymentInitialization } = installClaimHandlers();
    let deferAnonymousRead = false;
    let oldReadStarted = false;
    let transferred = false;
    let releaseOldRead: (() => void) | undefined;
    const oldRead = new Promise<void>((resolve) => { releaseOldRead = resolve; });
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", async ({ request }) => {
      if (request.headers.get("Authorization") === `Bearer access-${PERMANENT_USER_ID}`) {
        return HttpResponse.json(secured());
      }
      if (deferAnonymousRead) {
        oldReadStarted = true;
        await oldRead;
      }
      return transferred
        ? HttpResponse.json({ detail: "Not found" }, { status: 404 })
        : HttpResponse.json(secureRequired());
    }));
    const user = userEvent.setup();
    const result = renderPurchase();
    const claimKey = totalLossClaimQueryKeys.detail(ANONYMOUS_USER_ID, CASE_ID);
    otp.verifyCodeAndClaim
      .mockImplementationOnce(async () => {
        transferred = true;
        throw new ClaimEmailOtpError("session_install_failed");
      })
      .mockImplementationOnce(async () => { result.auth.signInPermanent(); });

    const input = await requestCode(user);
    await user.type(input, "123456");
    deferAnonymousRead = true;
    let refetch: Promise<void> | undefined;
    act(() => {
      refetch = result.queryClient.refetchQueries({ queryKey: claimKey, exact: true });
    });
    await waitFor(() => expect(oldReadStarted).toBe(true));
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select Verify again to retry.");

    await act(async () => {
      releaseOldRead?.();
      await refetch;
    });
    await waitFor(() => expect(result.queryClient.getQueryState(claimKey)?.status).toBe("error"));
    expect(result.router.state.location.pathname).toBe(CHECKOUT_PATH);
    expect(screen.getByText("ow••••@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Complete purchase" })).toBeDisabled();
    expect(paymentInitialization).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Verified")).toBeVisible();
    expect(result.router.state.location.pathname).toBe(CHECKOUT_PATH);
    expect(otp.verifyCodeAndClaim).toHaveBeenCalledTimes(2);
    expect(otp.sendCode).toHaveBeenCalledOnce();
  });

  it("skips OTP entirely for a matching verified permanent owner", async () => {
    installClaimHandlers();
    renderPurchase("permanent");
    expect(await screen.findByText("Verified")).toBeVisible();
    expect(screen.getByText("ow••••@example.com")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send verification code" })).not.toBeInTheDocument();
    expect(otp.sendCode).not.toHaveBeenCalled();
    expect(otp.verifyCodeAndClaim).not.toHaveBeenCalled();
  });

  it.each(["anonymous", "permanent", "signed-out"] as const)("keeps an unrecognized %s visitor on neutral recovery without saved-email disclosure", async (identity) => {
    installClaimHandlers();
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json({ detail: "Not found" }, { status: 404 })));
    renderPurchase(identity);
    expect(await screen.findByRole("textbox", { name: "Email used for this claim" })).toBeVisible();
    expect(screen.queryByText("ow••••@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText(CONTACT_EMAIL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send verification code" })).not.toBeInTheDocument();
    expect(otp.sendCode).not.toHaveBeenCalled();
    expect(otp.verifyCodeAndClaim).not.toHaveBeenCalled();
  });

  it("preserves the existing magic-link flow when the local feature is disabled", async () => {
    otp.enabled = false;
    installClaimHandlers();
    const user = userEvent.setup();
    const { auth, router } = renderPurchase();
    await user.click(await screen.findByRole("button", { name: "Send verification link" }));
    expect(await screen.findByText("Check your email")).toBeVisible();
    expect(auth.service.sendMagicLink).toHaveBeenCalledWith(CONTACT_EMAIL, expect.stringContaining(`/auth/callback/case-claim/${CLAIM_ID}`), "test-magic-link-1");
    expect(otp.sendCode).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(CHECKOUT_PATH);
  });
});
