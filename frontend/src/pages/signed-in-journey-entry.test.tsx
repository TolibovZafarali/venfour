import { screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { AuthService } from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import { renderTestApp } from "@/test/render";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CASE_ID = "44444444-4444-4444-8444-444444444444";

function session(): Session {
  return {
    access_token: `access-${USER_ID}`,
    expires_in: 3600,
    refresh_token: `refresh-${USER_ID}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-18T14:00:00.000Z",
      email: "owner@example.com",
      id: USER_ID,
      user_metadata: {},
    },
  } as Session;
}

function authService(): AuthService {
  return {
    exchangeCodeForSession: async () => session(),
    getSession: async () => session(),
    onAuthStateChange: () => () => undefined,
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: async () => session(),
  };
}

function appraisalCase(
  values: Partial<AppraisalCase> = {},
): AppraisalCase {
  return {
    id: CASE_ID,
    userId: USER_ID,
    serviceType: "total_loss",
    status: "draft",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    lastActivityAt: "2026-09-01T12:00:00.000Z",
    caseStage: "intake_in_progress",
    ...values,
  };
}

function caseService(cases: readonly AppraisalCase[]): AppraisalCaseService {
  return {
    createAppraisalCase: async () => appraisalCase(),
    createOrGetAppraisalCase: async () => appraisalCase(),
    getAppraisalCase: async () => null,
    getOrCreateTotalLossDraft: async () => appraisalCase(),
    getRecentDraftAppraisalCase: async () => null,
    listAppraisalCases: vi.fn(async () => [...cases]),
    touchAppraisalCase: async () => null,
  };
}

describe("signed-in guided valuation review entry", () => {
  it("keeps an empty account in appraisal history without creating a case", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([]),
      authService: authService(),
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/appraisals"),
    );
    expect(
      await screen.findByRole("heading", { name: "No appraisals yet" }),
    ).toBeVisible();
  });

  it("resumes an active claim through its authoritative resolver", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([
        appraisalCase({
          hasTotalLossClaimWorkflow: true,
          status: "paid",
          caseStage: "analysis_complete",
        }),
      ]),
      authService: authService(),
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/total-loss/cases/${CASE_ID}/claim`,
      ),
    );
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("skips an unsupported attention summary when a resumable claim exists", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([
        appraisalCase({
          needsAttention: true,
          caseStage: "report_uploaded",
        }),
        appraisalCase({
          id: OTHER_CASE_ID,
          hasTotalLossClaimWorkflow: true,
          status: "paid",
          caseStage: "analysis_complete",
        }),
      ]),
      authService: authService(),
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/total-loss/cases/${OTHER_CASE_ID}/claim`,
      ),
    );
  });

  it("resumes a pre-claim case at its current intake or analysis route", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([appraisalCase()]),
      authService: authService(),
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    const search = new URLSearchParams(router.state.location.search);
    expect(search.get("service")).toBe("total-loss");
    expect(search.get("view")).toBe("intake");
    expect(search.get("caseId")).toBe(CASE_ID);
  });

  it("sends an all-closed account to appraisal history", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([
        appraisalCase({ status: "closed", caseStage: "closed", hasTotalLossClaimWorkflow: true }),
      ]),
      authService: authService(),
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/appraisals"),
    );
    expect(
      await screen.findByRole("heading", { name: "My appraisals" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View case history" }))
      .toHaveAttribute("href", `/total-loss/cases/${CASE_ID}/claim`);
  });

  it("prioritizes an active claim over a more recently closed claim", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([
        appraisalCase({ status: "closed", caseStage: "closed", hasTotalLossClaimWorkflow: true, needsAttention: true }),
        appraisalCase({ id: OTHER_CASE_ID, status: "paid", caseStage: "analysis_complete", hasTotalLossClaimWorkflow: true }),
      ]),
      authService: authService(),
    });

    await waitFor(() => expect(router.state.location.pathname)
      .toBe(`/total-loss/cases/${OTHER_CASE_ID}/claim`));
  });

  it("does not treat a paused diminished-value case as the guided review", async () => {
    const { router } = renderTestApp(["/"], {
      appraisalCaseService: caseService([
        appraisalCase({
          serviceType: "diminished_value",
          status: "draft",
          caseStage: "intake_in_progress",
        }),
      ]),
      authService: authService(),
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/appraisals"),
    );
  });

  it("fails closed when the owner-scoped list exposes another account", async () => {
    renderTestApp(["/"], {
      appraisalCaseService: caseService([
        appraisalCase({ userId: OTHER_USER_ID }),
      ]),
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t open your guided valuation review",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/could not verify an owner-scoped active case/iu),
    ).toBeVisible();
  });

  it("shows a truthful configuration error without creating a case", async () => {
    renderTestApp(["/"], {
      appraisalCaseService: null,
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Your guided valuation review is temporarily unavailable",
      }),
    ).toBeVisible();
  });
});
