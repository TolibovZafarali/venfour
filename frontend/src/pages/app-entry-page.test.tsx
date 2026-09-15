import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { automaticSubmissionRequested, requestAutomaticSubmission } from "@/features/analyses/case-analysis-queries";
import { renderTestApp } from "@/test/render";

const { host } = vi.hoisted(() => ({ host: { audience: "combined" } }));
vi.mock("@/app/site-boundary", async importOriginal => ({ ...await importOriginal<object>(), hostAudience: () => host.audience }));
afterEach(() => { host.audience = "combined"; });
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CASE_ID = "44444444-4444-4444-8444-444444444444";
function session(): Session {
  return { access_token: `access-${USER_ID}`, expires_in: 3600, refresh_token: "test-refresh", token_type: "bearer",
    user: { app_metadata: {}, aud: "authenticated", created_at: "2026-08-18T14:00:00.000Z", email: "owner@example.com", id: USER_ID, user_metadata: {} } } as Session;
}
function authService(value: Session | null = session()): AuthService {
  return { exchangeCodeForSession: async () => session(), getSession: async () => value,
    onAuthStateChange: () => () => undefined, sendEmailCode: async () => undefined,
    verifyEmailCode: async () => session(), sendMagicLink: vi.fn(), signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), signOut: vi.fn(), verifyEmailOtp: async () => session() };
}
function appraisalCase(values: Partial<AppraisalCase> = {}): AppraisalCase {
  return { id: CASE_ID, userId: USER_ID, serviceType: "total_loss", status: "draft", createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z", lastActivityAt: "2026-09-01T12:00:00.000Z", caseStage: "intake_in_progress", ...values };
}
function caseService(cases: readonly AppraisalCase[]): AppraisalCaseService {
  return { createAppraisalCase: vi.fn(), createOrGetAppraisalCase: vi.fn(), getAppraisalCase: vi.fn(async () => null),
    getOrCreateTotalLossDraft: vi.fn(), getRecentDraftAppraisalCase: vi.fn(async () => null), listAppraisalCases: vi.fn(async () => [...cases]), touchAppraisalCase: vi.fn() };
}

describe.each(["/app", "/appraisals", "/"])("workspace entry from %s", entry => {
  function render(cases: readonly AppraisalCase[], service = caseService(cases)) {
    if (entry === "/") host.audience = "application";
    return { ...renderTestApp([entry], { appraisalCaseService: service, authService: authService() }), service };
  }
  it("opens the zero-case start without creating an appraisal", async () => {
    const { router, service } = render([]);
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe("/start?service=total-loss&entry=resume"));
    expect(service.createAppraisalCase).not.toHaveBeenCalled();
    expect(service.getOrCreateTotalLossDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "My appraisals" })).not.toBeInTheDocument();
  });
  it.each([
    [{ caseStage: "intake_in_progress" }, `/start?service=total-loss&view=intake&caseId=${CASE_ID}`],
    [{ caseStage: "analysis_processing", status: "checking" }, `/total-loss/cases/${CASE_ID}/analysis`],
    [{ caseStage: "analysis_complete", status: "check_complete" }, `/total-loss/cases/${CASE_ID}/analysis`],
    [{ hasFullReviewReport: true, caseStage: "analysis_complete" }, `/total-loss/cases/${CASE_ID}/review-report`],
    [{ hasTotalLossClaimWorkflow: true, status: "paid" }, `/total-loss/cases/${CASE_ID}/claim`],
    [{ hasTotalLossClaimWorkflow: true, status: "closed", caseStage: "closed" }, `/total-loss/cases/${CASE_ID}/claim`],
  ] as [Partial<AppraisalCase>, string][])("resumes saved state %j", async (state, destination) => {
    const { router } = render([appraisalCase(state)]);
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe(destination));
    expect(router.state.historyAction).toBe("REPLACE");
  });
  it("uses activity ahead of stage priority and keeps active work ahead of completed history", async () => {
    const { router } = render([
      appraisalCase({ status: "closed", caseStage: "closed", lastActivityAt: "2026-09-15T12:00:00Z" }),
      appraisalCase({ id: "55555555-5555-4555-8555-555555555555", hasTotalLossClaimWorkflow: true, needsAttention: true }),
      appraisalCase({ id: OTHER_CASE_ID, lastActivityAt: "2026-09-14T12:00:00Z" }),
    ]);
    await waitFor(() => expect(router.state.location.search).toContain(`caseId=${OTHER_CASE_ID}`));
  });
  it("opens the latest completed workspace when all cases are complete", async () => {
    const { router } = render([
      appraisalCase({ status: "closed", caseStage: "closed", hasTotalLossClaimWorkflow: true }),
      appraisalCase({ id: OTHER_CASE_ID, status: "closed", caseStage: "closed", hasTotalLossClaimWorkflow: true, lastActivityAt: "2026-09-14T12:00:00Z" }),
    ]);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/total-loss/cases/${OTHER_CASE_ID}/claim`));
  });
  it("fails closed on another owner's summary", async () => {
    const { router } = render([appraisalCase({ userId: "another-owner" })]);
    expect(await screen.findByRole("heading", { name: "We couldn’t open your appraisal" })).toBeVisible();
    expect(router.state.location.pathname).toBe(entry === "/" ? "/app" : entry);
  });
});

describe("account audiences", () => {
  it.each(["/app", "/appraisals"])("keeps signed-out and guest visitors behind normal sign-in at %s", async entry => {
    const service = caseService([appraisalCase()]);
    renderTestApp([entry], { appraisalCaseService: service, authService: authService(null) });
    expect(await screen.findByRole("heading", { name: "Continue your appraisal" })).toBeVisible();
    expect(service.listAppraisalCases).not.toHaveBeenCalled();
  });
  it("does not list permanent-account history for an anonymous session", async () => {
    const guest = session(); guest.user.is_anonymous = true;
    const service = caseService([]);
    renderTestApp(["/appraisals"], { appraisalCaseService: service, authService: authService(guest) });
    expect(await screen.findByRole("heading", { name: "Continue your appraisal" })).toBeVisible();
    expect(service.listAppraisalCases).not.toHaveBeenCalled();
  });
  it.each([["staff", "/admin"], ["partner", "/partners"]] as const)("preserves the %s destination", async (role, path) => {
    const service = caseService([]); service.getWorkspaceRole = vi.fn(async () => role);
    const { router } = renderTestApp(["/app"], { appraisalCaseService: service, authService: authService() });
    await waitFor(() => expect(router.state.location.pathname.startsWith(path)).toBe(true));
    expect(service.listAppraisalCases).not.toHaveBeenCalled();
    expect(service.createAppraisalCase).not.toHaveBeenCalled();
  });
  it("does not guess a customer destination when role lookup fails", async () => {
    const service = caseService([]); service.getWorkspaceRole = vi.fn().mockRejectedValue(new Error("offline"));
    renderTestApp(["/app"], { appraisalCaseService: service, authService: authService() });
    expect(await screen.findByRole("heading", { name: "We couldn’t open your workspace" })).toBeVisible();
    expect(service.listAppraisalCases).not.toHaveBeenCalled();
  });
});

describe("specific appraisal returns", () => {
  it.each(["/app", `/total-loss/cases/${CASE_ID}`])("waits for current saved state instead of routing from cached intake at %s", async entry => {
    const service = caseService([appraisalCase()]);
    const { router, queryClient } = renderTestApp(["/contact"], { appraisalCaseService: service, authService: authService() });
    await screen.findByRole("button", { name: "Account for owner@example.com" });
    await waitFor(() => expect(queryClient.getQueryData(appraisalCaseQueryKeys.list(USER_ID))).toBeDefined());
    let finish!: (cases: AppraisalCase[]) => void;
    vi.mocked(service.listAppraisalCases).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const input = { expectedAnalysisInputId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedAnalysisInputRevision: 1 };
    requestAutomaticSubmission(USER_ID, CASE_ID, input);
    await act(async () => { await router.navigate(entry); });
    await screen.findByRole("heading", { name: "Opening your appraisal…" });
    expect(automaticSubmissionRequested(USER_ID, CASE_ID, input)).toBe(false);
    expect(router.state.location.pathname).toBe(entry);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => { finish([appraisalCase({ hasFullReviewReport: true })]); });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/total-loss/cases/${CASE_ID}/review-report`));
    expect(service.getOrCreateTotalLossDraft).not.toHaveBeenCalled();
  });
  it.each([false, true])("opens the claimed case for anonymous=%s without selecting a newer case", async anonymous => {
    const value = session(); value.user.is_anonymous = anonymous;
    const service = caseService([
      appraisalCase({ hasFullReviewReport: true }),
      appraisalCase({ id: OTHER_CASE_ID, lastActivityAt: "2026-09-15T12:00:00Z" }),
    ]);
    const { router } = renderTestApp([`/total-loss/cases/${CASE_ID}`], { appraisalCaseService: service, authService: authService(value) });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/total-loss/cases/${CASE_ID}/review-report`));
    expect(service.createAppraisalCase).not.toHaveBeenCalled();
    expect(service.touchAppraisalCase).not.toHaveBeenCalled();
  });
  it("does not disclose a different owner's case from a deep link", async () => {
    const service = caseService([appraisalCase({ userId: "another-owner", vehicleLabel: "Private vehicle" })]);
    const { router } = renderTestApp([`/total-loss/cases/${CASE_ID}`], { appraisalCaseService: service, authService: authService() });
    expect(await screen.findByRole("heading", { name: "This appraisal is unavailable" })).toBeVisible();
    expect(screen.queryByText("Private vehicle")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/total-loss/cases/${CASE_ID}`);
  });
});

describe("account appraisal switching", () => {
  it("shows vehicle, status, current selection, and direct workspace links", async () => {
    const user = userEvent.setup();
    const service = caseService([
      appraisalCase({ vehicleLabel: "2026 Hyundai Kona", hasTotalLossClaimWorkflow: true, workspaceStatus: "awaiting_insurer_response" }),
      appraisalCase({ id: OTHER_CASE_ID, vehicleLabel: "2024 Hyundai Elantra", status: "completed", analysisStatus: "completed", caseStage: "analysis_complete" }),
    ]);
    const { router } = renderTestApp([`/start?service=total-loss&view=intake&caseId=${CASE_ID}`], { appraisalCaseService: service, authService: authService() });
    const account = await screen.findByRole("button", { name: "Account for owner@example.com" });
    await user.click(account);
    const menu = await screen.findByRole("menu");
    const current = await within(menu).findByRole("menuitem", { name: /2026 Hyundai Kona.*Waiting for response/ });
    expect(current).toHaveAttribute("href", `/total-loss/cases/${CASE_ID}`);
    expect(current).toHaveAttribute("aria-current", "page");
    const other = within(menu).getByRole("menuitem", { name: /2024 Hyundai Elantra/ });
    expect(other).toHaveAttribute("href", `/total-loss/cases/${OTHER_CASE_ID}`);
    expect(within(menu).getByRole("menuitem", { name: "Start new appraisal" })).toHaveAttribute("href", expect.stringContaining("/start?"));
    expect(within(menu).queryByText("My appraisals")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(account).toHaveFocus();
    await user.click(account);
    await user.click(await screen.findByRole("menuitem", { name: /2024 Hyundai Elantra/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/total-loss/cases/${OTHER_CASE_ID}/analysis`));
    expect(service.createAppraisalCase).not.toHaveBeenCalled();
    expect(service.touchAppraisalCase).not.toHaveBeenCalled();
  });
  it("hides all rows if an owner mismatch reaches the menu", async () => {
    const user = userEvent.setup();
    const service = caseService([appraisalCase({ userId: "another-owner", vehicleLabel: "Private vehicle" })]);
    renderTestApp(["/start?service=total-loss&entry=resume"], { appraisalCaseService: service, authService: authService() });
    await user.click(await screen.findByRole("button", { name: "Account for owner@example.com" }));
    expect(await screen.findByText("We couldn’t load your appraisals.", { exact: false })).toBeVisible();
    expect(screen.queryByText("Private vehicle")).not.toBeInTheDocument();
  });
});
