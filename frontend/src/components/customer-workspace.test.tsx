import type { Session } from "@supabase/supabase-js";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "@/features/auth";
import type { AppraisalCaseService } from "@/features/cases/service";
import { materialUndervalueAnalysis } from "@/test/fixtures/analysis-presentation";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";
import { requestAutomaticSubmission } from "@/features/analyses/case-analysis-queries";

const caseId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";
const base = `/total-loss/cases/${caseId}`;
const session = { access_token: "test-workspace", refresh_token: "test-workspace", expires_in: 3600, token_type: "bearer", user: { id: userId, email: "owner@example.com", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-09-15T12:00:00Z" } } as Session;
const authService: AuthService = { getSession: async () => session, onAuthStateChange: () => () => undefined, exchangeCodeForSession: async () => session, verifyEmailOtp: async () => session, verifyEmailCode: async () => session, sendMagicLink: async () => undefined, sendEmailCode: async () => undefined, signInWithGoogle: async () => undefined, signInWithApple: async () => undefined, signOut: async () => undefined };

function fixtures(owner = userId) {
  const write = vi.fn();
  const service: AppraisalCaseService = {
    listAppraisalCases: vi.fn(async () => [{ id: caseId, userId: owner, vehicleLabel: "2026 Hyundai Kona SE", serviceType: "total_loss" as const, status: "check_complete" as const, createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z", lastActivityAt: "2026-09-15T12:00:00Z" }]),
    getAppraisalCase: async () => null, getRecentDraftAppraisalCase: async () => null,
    createAppraisalCase: write, createOrGetAppraisalCase: write, getOrCreateTotalLossDraft: write, touchAppraisalCase: write,
  };
  server.use(
    http.get("*/api/v1/appraisal-cases/:id/analysis", () => HttpResponse.json({ status: "completed", runId: materialUndervalueAnalysis.runId, attemptCount: 1, intakeCorrectionAllowed: true })),
    http.get("*/api/v1/analyses/:id", () => HttpResponse.json(materialUndervalueAnalysis)),
    http.get("*/api/v1/appraisal-cases/:id/full-review", () => HttpResponse.json({ caseId, stage: "full_review", status: "report_required", ready: false, issues: [], message: "Add your report.", report: null, canReuseReport: false, locked: false, analysisInputId: null, analysisInputRevision: null, checkoutAvailable: false, paymentReadiness: { status: "not_evaluated", eligible: false, reviewId: null, version: null, digest: null } })),
    http.post("*/api/v1/appraisal-cases/:id/analysis", () => { write(); return HttpResponse.json({}); }),
  );
  return { service, write };
}

describe("persistent customer workspace", () => {
  it("keeps the same shell, header, and case context across result, upload, and browser history", async () => {
    const { service, write } = fixtures();
    const { container, router } = renderTestApp([`${base}/analysis`], { authService, appraisalCaseService: service });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Your insurer may be undervaluing your vehicle." });
    await waitFor(() => expect(container.querySelector(".customer-workspace__identity")).toHaveTextContent("2026 Hyundai Kona SE"));
    const shell = container.querySelector("[data-customer-workspace]");
    const frame = container.querySelector(".customer-workspace");
    const header = container.querySelector("header");
    const identity = container.querySelector(".customer-workspace__context");
    expect(header?.contains(identity)).toBe(true);
    expect(frame?.querySelector(".customer-workspace__context")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Upload insurer valuation report" }));
    await screen.findByRole("heading", { name: "Add your insurer’s valuation report" });
    expect(container.querySelector("[data-customer-workspace]")).toBe(shell);
    expect(container.querySelector(".customer-workspace")).toBe(frame);
    expect(container.querySelector("header")).toBe(header);
    expect(container.querySelector(".customer-workspace__context")).toBe(identity);
    expect(container.querySelector(".claim-workflow-card")).toBeNull();
    expect(screen.queryByRole("link", { name: /Back to/ })).not.toBeInTheDocument();
    await act(async () => router.navigate(-1));
    await screen.findByRole("heading", { name: "Your insurer may be undervaluing your vehicle." });
    await act(async () => router.navigate(1));
    await screen.findByLabelText("Choose the complete valuation PDF");
    expect(container.querySelector("header")).toBe(header);
    expect(write).not.toHaveBeenCalled();
    expect(service.listAppraisalCases).toHaveBeenCalledOnce();
  });

  it("does not display another owner's vehicle in workspace context", async () => {
    const { service } = fixtures("different-owner");
    const { container } = renderTestApp([`${base}/review-report`], { authService, appraisalCaseService: service });
    await screen.findByLabelText("Choose the complete valuation PDF");
    expect(container.querySelector(".customer-workspace__identity")).toHaveTextContent("Your appraisal");
    expect(container.querySelector(".customer-workspace__identity")).not.toHaveTextContent("Hyundai");
  });

  it("opens a saved report link in a modal without submitting an unfinished free valuation", async () => {
    const { service, write } = fixtures();
    const input = { expectedAnalysisInputId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedAnalysisInputRevision: 1 };
    requestAutomaticSubmission(userId, caseId, input);
    server.use(http.get("*/api/v1/appraisal-cases/:id/analysis", () => HttpResponse.json({ status: "not_submitted", analysisInputId: input.expectedAnalysisInputId, analysisInputRevision: 1 })));
    const { router } = renderTestApp([`${base}/review-report`], { authService, appraisalCaseService: service });
    await screen.findByLabelText("Choose the complete valuation PDF");
    expect(screen.getByRole("dialog", { name: "Insurer valuation review" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${base}/review-report`);
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps a confirmation choice when closing a saved report route and reopening from the result", async () => {
    const { service } = fixtures();
    server.use(http.get("*/api/v1/appraisal-cases/:id/full-review", () => HttpResponse.json({ caseId, stage: "full_review", status: "needs_confirmation", ready: false,
      issues: [{ field: "mileage", code: "REPORT_FACT_CONFLICT", message: "Which mileage?", reportValue: 32000, savedValue: 30000 }], message: "Confirm mileage.",
      report: { id: "44444444-4444-4444-8444-444444444444", revision: 1, filename: "valuation.pdf" }, canReuseReport: false, locked: false, analysisInputId: null, analysisInputRevision: null, checkoutAvailable: false,
      paymentReadiness: { status: "not_evaluated", eligible: false, reviewId: null, version: null, digest: null } })));
    const user = userEvent.setup();
    renderTestApp([`${base}/review-report`], { authService, appraisalCaseService: service });
    await user.click(await screen.findByRole("radio", { name: /In the report/ }));
    await user.click(screen.getByRole("button", { name: "Close report review" }));
    await user.click(await screen.findByRole("button", { name: "Upload insurer valuation report" }));
    expect(await screen.findByRole("radio", { name: /In the report/ })).toBeChecked();
  });
});
