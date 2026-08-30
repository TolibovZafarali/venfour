import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClaimEmailOtpError,
  createClaimEmailOtpService,
  createIsolatedClaimEmailClient,
} from "@/features/total-loss-claim/email-otp-service";
import type { installSessionForAnonymousOwner } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const CASE_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const GUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const EMAIL = "customer@example.test";
const input = { caseId: CASE_ID, claimId: CLAIM_ID, email: EMAIL, expectedUserId: GUEST_ID, token: "123456" };
const sendInput = { caseId: CASE_ID, email: EMAIL, expectedUserId: GUEST_ID, captchaToken: "local-captcha" };

function sessionFor(id: string, anonymous: boolean, email = EMAIL): Session {
  return {
    access_token: `access-for-${id}`,
    refresh_token: `refresh-for-${id}`,
    expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    expires_in: 3_600,
    token_type: "bearer",
    user: {
      id,
      email,
      is_anonymous: anonymous,
      email_confirmed_at: anonymous ? undefined : "2026-08-29T00:00:00Z",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-08-29T00:00:00Z",
    },
  };
}

const completedRow = {
  outcome: "claimed",
  case_id: CASE_ID,
  owner_user_id: OWNER_ID,
  contact_email: EMAIL,
  email_verified_at: "2026-08-29T00:00:00Z",
  claimed_at: "2026-08-29T00:00:00Z",
  ownership_transferred: true,
  claim_purpose: "post_continue",
};

type AuthResult = {
  data: { session: Session | null; user: Session["user"] | null };
  error: unknown;
};

function harness() {
  let mainSession: Session | null = sessionFor(GUEST_ID, true);
  const verifiedSession = sessionFor(OWNER_ID, false);
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const events: string[] = [];
  const changeIdentity = (session: Session | null, event: AuthChangeEvent = "SIGNED_IN") => {
    mainSession = session;
    listeners.forEach((listener) => listener(event, session));
  };
  const unsubscribe = vi.fn();
  const getSession = vi.fn(async () => ({ data: { session: mainSession }, error: null }));
  const setSession = vi.fn<() => Promise<AuthResult>>(async () => {
    events.push("install");
    changeIdentity(verifiedSession);
    return { data: { session: verifiedSession, user: verifiedSession.user }, error: null };
  });
  const mainClient = {
    auth: {
      getSession,
      setSession,
      onAuthStateChange: vi.fn((listener) => {
        listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => {
          unsubscribe();
          listeners.delete(listener);
        } } } };
      }),
    },
  } as unknown as SupabaseClient<Database>;
  const signInWithOtp = vi.fn<() => Promise<{ error: unknown }>>(async () => ({ error: null }));
  const verifyOtp = vi.fn<() => Promise<AuthResult>>(async () => {
    events.push("verify");
    return { data: { session: verifiedSession, user: verifiedSession.user }, error: null };
  });
  const rpc = vi.fn<() => Promise<{ data: unknown; error: unknown }>>(async () => {
    events.push("claim");
    return { data: [completedRow], error: null };
  });
  const dispose = vi.fn(async () => undefined);
  const isolatedClient = { auth: { signInWithOtp, verifyOtp, dispose }, rpc } as unknown as SupabaseClient<Database>;
  const createIsolatedClient = vi.fn(() => isolatedClient);
  const installer: typeof installSessionForAnonymousOwner = async (client, session, _expectedId, assertUnchanged) => {
    assertUnchanged();
    return client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  };
  const installSession = vi.fn(installer);
  const service = createClaimEmailOtpService({
    mainClient,
    createIsolatedClient,
    origin: () => "http://localhost:5173",
    installSession,
  });
  return { service, mainClient, createIsolatedClient, isolatedClient, signInWithOtp, verifyOtp, rpc,
    getSession, setSession, installSession, events, changeIdentity, verifiedSession, dispose, unsubscribe };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("inline claim email verification", () => {
  it("sends the exact saved email using the official OTP request without a callback", async () => {
    const h = harness();
    await h.service.sendCode(sendInput);
    expect(h.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: EMAIL,
      options: {
        captchaToken: "local-captcha",
        shouldCreateUser: true,
        emailRedirectTo: `http://localhost:5173/total-loss/cases/${CASE_ID}/claim/checkout`,
      },
    });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it("verifies raw digits in memory, completes the secure claim, then publishes the permanent session", async () => {
    const h = harness();
    await expect(h.service.verifyCodeAndClaim(input)).resolves.toMatchObject({
      caseId: CASE_ID, ownerUserId: OWNER_ID, claimPurpose: "post_continue", outcome: "claimed",
    });
    expect(h.verifyOtp).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, token: "123456", type: "email" });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("complete_total_loss_case_claim_with_context", { claim_id: CLAIM_ID });
    expect(h.events).toEqual(["verify", "claim", "install"]);
    expect(h.installSession).toHaveBeenCalledWith(h.mainClient, h.verifiedSession, GUEST_ID, expect.any(Function));
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it.each(["", "123-456", "123 456", "12345", "1234567", "１２３４５６", "12345x", "123456\n"])(
    "rejects a token other than six raw ASCII digits: %j", async (token) => {
      const h = harness();
      await expect(h.service.verifyCodeAndClaim({ ...input, token })).rejects.toMatchObject({ code: "invalid_code" });
      expect(h.verifyOtp).not.toHaveBeenCalled();
      expect(h.setSession).not.toHaveBeenCalled();
    },
  );

  it.each([null, sessionFor(OWNER_ID, false), sessionFor("another-guest", true)])(
    "refuses a missing, permanent, or different original session", async (session) => {
      const h = harness();
      h.changeIdentity(session);
      await expect(h.service.sendCode(sendInput)).rejects.toMatchObject({ code: "identity_changed" });
      await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "identity_changed" });
      expect(h.createIsolatedClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    { code: "otp_expired", status: 403 },
    { code: "validation_failed", status: 400 },
    { code: "over_request_rate_limit", status: 429 },
  ])("does not claim or replace the guest after an invalid, expired/reused, or throttled token", async (error) => {
    const h = harness();
    h.verifyOtp.mockResolvedValueOnce({ data: { session: null, user: null }, error });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toBeInstanceOf(ClaimEmailOtpError);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("does not expose provider error text or the token in safe errors", async () => {
    const h = harness();
    h.verifyOtp.mockRejectedValueOnce(new Error(`provider failure ${input.token} ${EMAIL}`));
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toEqual(new ClaimEmailOtpError("request_failed"));
  });

  it("maps send throttling without automatically retrying the email endpoint", async () => {
    const h = harness();
    h.signInWithOtp.mockResolvedValueOnce({ error: { status: 429, code: "over_email_send_rate_limit" } });
    await expect(h.service.sendCode(sendInput)).rejects.toMatchObject({ code: "rate_limited" });
    expect(h.signInWithOtp).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    sessionFor(OWNER_ID, true),
    sessionFor(OWNER_ID, false, "different@example.test"),
    { ...sessionFor(OWNER_ID, false), user: { ...sessionFor(OWNER_ID, false).user, email_confirmed_at: undefined } },
  ])("rejects an unverified or wrong-email OTP session before case completion", async (session) => {
    const h = harness();
    h.verifyOtp.mockResolvedValueOnce({ data: { session, user: session?.user ?? null }, error: null });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "claim_conflict" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it.each([
    { case_id: "other-case" },
    { owner_user_id: "other-owner" },
    { contact_email: "other@example.test" },
    { claim_purpose: "intake" },
  ])("validates the trusted completion scope before session installation: %j", async (change) => {
    const h = harness();
    h.rpc.mockResolvedValueOnce({ data: [{ ...completedRow, ...change }], error: null });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "claim_conflict" });
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("leaves original-owner, paid-case, expiration and conflicting replay denial to the existing RPC", async () => {
    const h = harness();
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Case claim unavailable" } });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "claim_conflict" });
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("accepts the RPC's safe same-destination-owner replay outcome", async () => {
    const h = harness();
    h.rpc.mockResolvedValueOnce({ data: [{ ...completedRow, outcome: "already_claimed", ownership_transferred: false }], error: null });
    await expect(h.service.verifyCodeAndClaim(input)).resolves.toMatchObject({ outcome: "already_claimed" });
  });

  it("detects identity changes during OTP verification, even if the original identity returns", async () => {
    const h = harness();
    h.verifyOtp.mockImplementationOnce(async () => {
      h.changeIdentity(sessionFor("other-owner", false));
      h.changeIdentity(sessionFor(GUEST_ID, true));
      return { data: { session: h.verifiedSession, user: h.verifiedSession.user }, error: null };
    });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "identity_changed" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("detects verification in another tab while case completion is pending", async () => {
    const h = harness();
    h.rpc.mockImplementationOnce(async () => {
      h.changeIdentity(h.verifiedSession);
      return { data: [completedRow], error: null };
    });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "identity_changed" });
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("does not persist a session after the request is aborted during verification", async () => {
    const h = harness();
    const controller = new AbortController();
    h.verifyOtp.mockImplementationOnce(async () => {
      controller.abort();
      return { data: { session: h.verifiedSession, user: h.verifiedSession.user }, error: null };
    });
    await expect(h.service.verifyCodeAndClaim({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("resolves committed verification when its intended sign-in publication unmounts the old panel", async () => {
    const h = harness();
    const controller = new AbortController();
    h.mainClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user.id === OWNER_ID) controller.abort();
    });
    await expect(h.service.verifyCodeAndClaim({ ...input, signal: controller.signal }))
      .resolves.toMatchObject({ outcome: "claimed", ownerUserId: OWNER_ID });
    expect(controller.signal.aborted).toBe(true);
    expect(h.setSession).toHaveBeenCalledOnce();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("still rejects aborts between session installation start and the guarded persistent write", async () => {
    const h = harness();
    const controller = new AbortController();
    h.installSession.mockImplementationOnce(async (_client, _session, _expected, assertUnchanged) => {
      await Promise.resolve();
      controller.abort();
      assertUnchanged();
      return h.mainClient.auth.setSession({
        access_token: h.verifiedSession.access_token,
        refresh_token: h.verifiedSession.refresh_token,
      });
    });
    await expect(h.service.verifyCodeAndClaim({ ...input, signal: controller.signal }))
      .rejects.toMatchObject({ code: "aborted" });
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("keeps wrong-identity denial after intended publication even if the old panel also unmounts", async () => {
    const h = harness();
    const controller = new AbortController();
    h.setSession.mockImplementationOnce(async () => {
      h.changeIdentity(h.verifiedSession);
      controller.abort();
      h.changeIdentity(sessionFor("different-owner", false));
      return { data: { session: h.verifiedSession, user: h.verifiedSession.user }, error: null };
    });
    await expect(h.service.verifyCodeAndClaim({ ...input, signal: controller.signal }))
      .rejects.toMatchObject({ code: "identity_changed" });
  });

  it("retries an ambiguous claim response with only the in-memory verified session, not the consumed OTP", async () => {
    const h = harness();
    h.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    h.rpc.mockResolvedValueOnce({ data: [{ ...completedRow, outcome: "already_claimed" }], error: null });
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" })).resolves.toMatchObject({ outcome: "already_claimed" });
    expect(h.verifyOtp).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("retries local session installation without submitting the consumed OTP again", async () => {
    const h = harness();
    h.setSession.mockResolvedValueOnce({ data: { session: null, user: null }, error: new TypeError("Failed to fetch") });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    expect(h.dispose).not.toHaveBeenCalled();
    h.rpc.mockResolvedValueOnce({ data: [{ ...completedRow, outcome: "already_claimed" }], error: null });
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" })).resolves.toMatchObject({ outcome: "already_claimed" });
    expect(h.verifyOtp).toHaveBeenCalledOnce();
    expect(h.setSession).toHaveBeenCalledTimes(2);
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("clears pending verified credentials on explicit cleanup and on resend", async () => {
    const h = harness();
    h.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    h.service.clearPendingVerification();
    expect(h.dispose).toHaveBeenCalledOnce();
    await h.service.sendCode(sendInput);
    expect(h.signInWithOtp).toHaveBeenCalledOnce();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("drops pending credentials if the active identity changes before a retry", async () => {
    const h = harness();
    h.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    h.changeIdentity(sessionFor("other-owner", false));
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" })).rejects.toMatchObject({ code: "identity_changed" });
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledOnce();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("disposes idle verified credentials at their bounded expiry without another call", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    expect(h.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(h.dispose).toHaveBeenCalledOnce();
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" })).rejects.toMatchObject({ code: "expired_code" });
    expect(h.verifyOtp).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledOnce();
  });

  it("invalidates idle pending credentials when identity leaves and returns to the original guest", async () => {
    const h = harness();
    h.setSession.mockResolvedValueOnce({ data: { session: null, user: null }, error: new TypeError("Offline") });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    h.changeIdentity(sessionFor("another-owner", false));
    expect(h.dispose).toHaveBeenCalledOnce();
    h.changeIdentity(sessionFor(GUEST_ID, true));
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" }))
      .rejects.toMatchObject({ code: "identity_changed" });
    expect(h.verifyOtp).toHaveBeenCalledOnce();
    expect(h.setSession).toHaveBeenCalledOnce();
  });

  it("stops idle cleanup when a verified retry intentionally publishes the new owner", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.setSession.mockResolvedValueOnce({ data: { session: null, user: null }, error: new TypeError("Offline") });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" })).resolves.toMatchObject({ outcome: "claimed" });
    expect(h.dispose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("ignores a previously queued idle identity notification after retry starts", async () => {
    const h = harness();
    h.setSession.mockResolvedValueOnce({ data: { session: null, user: null }, error: new TypeError("Offline") });
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    const staleIdleListener = vi.mocked(h.mainClient.auth.onAuthStateChange).mock.calls[1][0];
    h.setSession.mockImplementationOnce(async () => {
      await staleIdleListener("SIGNED_IN", h.verifiedSession);
      h.changeIdentity(h.verifiedSession);
      return { data: { session: h.verifiedSession, user: h.verifiedSession.user }, error: null };
    });
    await expect(h.service.verifyCodeAndClaim({ ...input, token: "" })).resolves.toMatchObject({ outcome: "claimed" });
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("cannot reuse pending verified credentials for a different claim or email", async () => {
    const h = harness();
    h.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(h.service.verifyCodeAndClaim(input)).rejects.toMatchObject({ code: "session_install_failed" });
    await expect(h.service.verifyCodeAndClaim({ ...input, claimId: "another-claim", token: "" }))
      .rejects.toMatchObject({ code: "invalid_code" });
    await expect(h.service.verifyCodeAndClaim({ ...input, email: "other@example.test", token: "" }))
      .rejects.toMatchObject({ code: "invalid_code" });
    expect(h.rpc).toHaveBeenCalledOnce();
    h.service.clearPendingVerification();
  });

  it("rejects overlapping requests rather than hammering Auth", async () => {
    const h = harness();
    let resolveRequest: (value: { error: null }) => void = () => undefined;
    h.signInWithOtp.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const first = h.service.sendCode(sendInput);
    await vi.waitFor(() => expect(h.signInWithOtp).toHaveBeenCalledOnce());
    await expect(h.service.sendCode(sendInput)).rejects.toMatchObject({ code: "busy" });
    resolveRequest({ error: null });
    await first;
    expect(h.signInWithOtp).toHaveBeenCalledOnce();
  });

  it("creates isolated clients with no browser storage, URL handling, refresh, broadcast, or debug logging", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    const debug = vi.spyOn(console, "debug");
    const warn = vi.spyOn(console, "warn");
    const first = createIsolatedClaimEmailClient("http://127.0.0.1:54321", "test-publishable-key");
    const second = createIsolatedClaimEmailClient("http://127.0.0.1:54321", "test-publishable-key");
    await first.auth.getSession();
    const configuration = first.auth as unknown as Record<string, unknown>;
    expect(configuration).toMatchObject({
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      flowType: "implicit", broadcastChannel: null, logDebugMessages: false,
    });
    expect(configuration.storageKey).not.toEqual((second.auth as unknown as Record<string, unknown>).storageKey);
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    await first.auth.dispose();
    await second.auth.dispose();
  });
});
