import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { AuthService, AuthStateChangeListener, TurnstileController } from "@/features/auth";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import type { CompleteTotalLossIdentityClaimResult } from "@/features/total-loss/data-types";
import { representativeRunId } from "@/test/fixtures/analysis-presentation";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const GUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const ANALYSIS_PATH = `/total-loss/cases/${CASE_ID}/analysis`;
const RETURN_PATH = `/total-loss/cases/${CASE_ID}/return`;
const EMAIL_PATH = `/auth/callback/preview-ready/${CASE_ID}/${CLAIM_ID}?token_hash=synthetic-token&type=email`;

function sessionFor(anonymous = true): Session {
  const id = anonymous ? GUEST_ID : OWNER_ID;
  return {
    access_token: `access-${id}`, expires_in: 3600, refresh_token: `refresh-${id}`, token_type: "bearer",
    user: { id, is_anonymous: anonymous, aud: "authenticated", app_metadata: {}, user_metadata: {},
      created_at: "2026-08-29T12:00:00Z", email: anonymous ? undefined : "preview@example.test" },
  } as Session;
}

function authHarness(initial: Session | null) {
  const listeners = new Set<AuthStateChangeListener>();
  const service: AuthService = {
    getSession: vi.fn(async () => initial),
    onAuthStateChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    exchangeCodeForSession: vi.fn(async () => sessionFor(false)),
    verifyEmailOtp: vi.fn(async () => sessionFor(false)),
    restoreSession: vi.fn(async (session) => session),
    sendMagicLink: vi.fn(async () => undefined), signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };
  return { service, clear: () => listeners.forEach((listener) => listener("SIGNED_OUT", null)) };
}

function caseFor(overrides: Partial<AppraisalCase> = {}): AppraisalCase {
  return { id: CASE_ID, userId: GUEST_ID, serviceType: "total_loss", status: "check_complete",
    caseStage: "analysis_complete", createdAt: "2026-08-29T12:00:00Z", updatedAt: "2026-08-29T12:00:00Z",
    lastActivityAt: "2026-08-29T12:00:00Z", ...overrides };
}

function caseService(list = vi.fn(async (): Promise<AppraisalCase[]> => [caseFor()])): AppraisalCaseService {
  return { listAppraisalCases: list, createAppraisalCase: vi.fn(), createOrGetAppraisalCase: vi.fn(),
    getAppraisalCase: vi.fn(), getOrCreateTotalLossDraft: vi.fn(), getRecentDraftAppraisalCase: vi.fn(),
    touchAppraisalCase: vi.fn() };
}

function completedResponse() {
  return HttpResponse.json({ status: "completed", attemptCount: 1, runId: representativeRunId });
}

function deniedResponse() {
  return HttpResponse.json({ error: { code: "CASE_NOT_FOUND", message: "Case unavailable." } }, { status: 404 });
}

function claimedResult(): CompleteTotalLossIdentityClaimResult {
  return { outcome: "claimed", caseId: CASE_ID, ownerUserId: OWNER_ID, contactEmail: "preview@example.test",
    emailVerifiedAt: "2026-08-29T12:00:00Z", claimedAt: "2026-08-29T12:00:00Z",
    ownershipTransferred: true, claimPurpose: "intake" };
}

function identityDependencies(completeIdentityClaim = vi.fn(async () => claimedResult())) {
  return { totalLossIdentityService: { completeIdentityClaim, getContact: vi.fn(), saveContactAndBeginClaim: vi.fn() } } as unknown as TotalLossDependencies;
}

describe("guest homepage return", () => {
  it("replaces the header and hero actions with the saved guest result, ignoring a newer draft", async () => {
    const list = vi.fn(async () => [caseFor({ id: CLAIM_ID, status: "draft", caseStage: "intake_not_started",
      lastActivityAt: "2026-08-29T13:00:00Z" }), caseFor()]);
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/analysis", completedResponse));
    const user = userEvent.setup();
    const { router } = renderTestApp(["/"], { authService: authHarness(sessionFor()).service,
      appraisalCaseService: caseService(list) });
    const links = await screen.findAllByRole("link", { name: "View my result" });
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toHaveAttribute("href", ANALYSIS_PATH);
    expect(screen.queryByRole("link", { name: "Get Started" })).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(GUEST_ID);
    expect(list).toHaveBeenCalledOnce();
    await user.click(links[0]);
    await waitFor(() => expect(router.state.location.pathname).toBe(ANALYSIS_PATH));
    expect(await screen.findByRole("heading", { name: "Your insurer may be undervaluing your vehicle." })).toBeVisible();
  });

  it("does not flash Get Started while the owned-case lookup is pending", async () => {
    let resolve!: (cases: AppraisalCase[]) => void;
    const list = vi.fn(() => new Promise<AppraisalCase[]>((done) => { resolve = done; }));
    renderTestApp(["/"], { authService: authHarness(sessionFor()).service, appraisalCaseService: caseService(list) });
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    expect(screen.queryByRole("link", { name: "Get Started" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View my result" })).not.toBeInTheDocument();
    await act(async () => resolve([caseFor()]));
    expect((await screen.findAllByRole("link", { name: "View my result" }))).toHaveLength(3);
  });

  it("labels an active analysis as progress and removes guest links when its session is cleared", async () => {
    const auth = authHarness(sessionFor());
    renderTestApp(["/"], { authService: auth.service, appraisalCaseService: caseService(vi.fn(async () => [
      caseFor({ caseStage: "analysis_processing", status: "checking", analysisStatus: "processing" }),
    ])) });
    expect((await screen.findAllByRole("link", { name: "View analysis progress" }))).toHaveLength(3);
    await act(async () => auth.clear());
    expect((await screen.findAllByRole("link", { name: "Get Started" }))).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "View analysis progress" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find my review" })).toHaveAttribute("href", "/find-review");
  });

  it("never offers a cached case from another owner", async () => {
    renderTestApp(["/"], { authService: authHarness(sessionFor()).service,
      appraisalCaseService: caseService(vi.fn(async () => [caseFor({ userId: OWNER_ID })])) });
    expect((await screen.findAllByRole("link", { name: "Get Started" }))).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "View my result" })).not.toBeInTheDocument();
  });

  it("keeps a failed analysis reachable so the guest can use the existing recovery options", async () => {
    renderTestApp(["/"], { authService: authHarness(sessionFor()).service,
      appraisalCaseService: caseService(vi.fn(async () => [caseFor({
        caseStage: "analysis_failed", analysisStatus: "failed", status: "checking",
      })])) });
    const links = await screen.findAllByRole("link", { name: "Return to my review" });
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toHaveAttribute("href", ANALYSIS_PATH);
    expect(screen.queryByRole("link", { name: "Get Started" })).not.toBeInTheDocument();
  });
});

describe("secure preview return", () => {
  it("opens the exact saved result for the original guest without consuming the email token or restarting analysis", async () => {
    const auth = authHarness(sessionFor());
    const submit = vi.fn();
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/analysis", completedResponse),
      http.post("*/api/v1/appraisal-cases/:caseId/analysis", () => { submit(); return completedResponse(); }));
    const { router } = renderTestApp([EMAIL_PATH], { authService: auth.service, strictMode: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(ANALYSIS_PATH));
    expect(router.state.location.search).toBe("");
    expect(auth.service.verifyEmailOtp).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("verifies the contact email and transfers access once when the original browser session is missing", async () => {
    let claimed = false;
    const auth = authHarness(null);
    const complete = vi.fn(async () => { claimed = true; return claimedResult(); });
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/analysis", ({ request }) =>
      claimed && request.headers.get("Authorization") === `Bearer access-${OWNER_ID}` ? completedResponse() : deniedResponse()));
    const { router } = renderTestApp([EMAIL_PATH], { authService: auth.service,
      totalLossDependencies: identityDependencies(complete), strictMode: true });
    await waitFor(() => expect(router.state.location.pathname).toBe(ANALYSIS_PATH));
    expect(auth.service.verifyEmailOtp).toHaveBeenCalledExactlyOnceWith("synthetic-token");
    expect(complete).toHaveBeenCalledExactlyOnceWith(CLAIM_ID);
  });

  it("shows fresh recovery when an email token has expired", async () => {
    const auth = authHarness(null);
    auth.service.verifyEmailOtp = vi.fn(async () => { throw new Error("Expired token"); });
    renderTestApp([EMAIL_PATH], { authService: auth.service, totalLossDependencies: identityDependencies(), strictMode: true });
    expect(await screen.findByText(/This verification link can’t be used anymore/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Email me a return link" })).toBeVisible();
    expect(auth.service.verifyEmailOtp).toHaveBeenCalledOnce();
  });

  it("restores an unrelated guest session when verification cannot claim this review", async () => {
    const auth = authHarness(sessionFor());
    const complete = vi.fn(async () => { throw new Error("Claim unavailable"); });
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/analysis", deniedResponse));
    const { router } = renderTestApp([EMAIL_PATH], { authService: auth.service,
      totalLossDependencies: identityDependencies(complete), strictMode: true });
    expect(await screen.findByText(/This verification link can’t be used anymore/u)).toBeVisible();
    expect(auth.service.restoreSession).toHaveBeenCalledExactlyOnceWith(sessionFor());
    expect(router.state.location.pathname).toContain("/auth/callback/preview-ready/");
  });

  it("rejects a completion response for another case", async () => {
    const complete = vi.fn(async () => ({ ...claimedResult(), caseId: CLAIM_ID }));
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/analysis", deniedResponse));
    renderTestApp([EMAIL_PATH], { authService: authHarness(null).service,
      totalLossDependencies: identityDependencies(complete) });
    expect(await screen.findByText(/This verification link can’t be used anymore/u)).toBeVisible();
  });

  it("keeps the result private when only a case URL remains and uses the minimal product shell", async () => {
    renderTestApp([RETURN_PATH], { authService: authHarness(null).service });
    expect(await screen.findByRole("heading", { name: "Return to your review" })).toBeVisible();
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Get Started" })).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated market range")).not.toBeInTheDocument();
  });

  it("supports email-only recovery with neutral responses and a fresh security check for each request", async () => {
    let challenge = 0;
    const controller: TurnstileController = { runWithToken: async (_action, operation) => operation(`challenge-${++challenge}`) };
    const bodies: unknown[] = [];
    server.use(http.post("*/api/v1/preview-access/recovery", async ({ request }) => {
      bodies.push(await request.json());
      expect(request.headers.get("Authorization")).toBeNull();
      return HttpResponse.json({ status: "accepted" }, { status: 202 });
    }));
    const user = userEvent.setup();
    renderTestApp(["/find-review"], { authService: authHarness(null).service, authTurnstileController: controller });
    await user.type(await screen.findByRole("textbox", { name: "Email used for your review" }), "PREVIEW@EXAMPLE.TEST");
    await user.click(screen.getByRole("button", { name: "Email me a return link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(screen.getByText(/If we find a matching review/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Request another link" }));
    await user.click(screen.getByRole("button", { name: "Email me a return link" }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(bodies).toEqual([{ email: "preview@example.test", turnstileToken: "challenge-1" },
      { email: "preview@example.test", turnstileToken: "challenge-2" }]);
  });
});
