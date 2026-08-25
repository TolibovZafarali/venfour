import { http, HttpResponse } from "msw";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { AuthService } from "@/features/auth";
import { representativeRunId } from "@/test/fixtures/analysis-presentation";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const casePath = `/total-loss/cases/${CASE_ID}/analysis`;
const progressHeading = "We’re reviewing and analyzing your claim.";
const materialResultHeading =
  "Strong evidence suggests the insurer’s valuation may be too low.";

function sessionFor(id = USER_ID) {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-18T14:00:00.000Z",
      email: "owner@example.com",
      id,
      user_metadata: {},
    },
  } as Session;
}

function authService(session: Session | null): AuthService {
  return {
    exchangeCodeForSession: async () => sessionFor(),
    getSession: async () => session,
    onAuthStateChange: () => () => undefined,
    sendMagicLink: async () => undefined,
    signInWithGoogle: async () => undefined,
    signOut: async () => undefined,
    verifyEmailOtp: async () => sessionFor(),
  };
}

describe("total-loss case analysis page", () => {
  it("auto-submits only a not-submitted case and sends the bearer token", async () => {
    let postCount = 0;
    let authorization: string | null = null;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({ status: "not_submitted" }),
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/analysis",
        ({ request }) => {
          postCount += 1;
          authorization = request.headers.get("Authorization");
          return HttpResponse.json(
            {
              status: "processing",
              attemptCount: 1,
              processingExpiresAt: null,
            },
            { status: 202 },
          );
        },
      ),
    );

    renderTestApp([casePath], {
      authService: authService(sessionFor()),
      strictMode: true,
    });

    expect(
      await screen.findByRole("heading", {
        name: progressHeading,
      }),
    ).toBeVisible();
    await waitFor(() => expect(postCount).toBe(1));
    expect(authorization).toBe(`Bearer access-${USER_ID}`);
  });

  it("polls without duplicate submission and renders the result on the same route", async () => {
    let getCount = 0;
    let postCount = 0;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        getCount += 1;
        if (getCount === 1) {
          return HttpResponse.json({
            status: "processing",
            attemptCount: 1,
            processingExpiresAt: null,
          });
        }
        return HttpResponse.json({
          status: "completed",
          attemptCount: 1,
          runId: representativeRunId,
        });
      }),
      http.post("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        postCount += 1;
        return HttpResponse.json({
          status: "processing",
          attemptCount: 1,
          processingExpiresAt: null,
        });
      }),
    );

    const { router } = renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    expect(
      await screen.findByRole("heading", {
        name: progressHeading,
      }),
    ).toBeVisible();
    expect(
      await screen.findByRole(
        "heading",
        { name: materialResultHeading },
        { timeout: 4_000 },
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(casePath);
    expect(getCount).toBeGreaterThanOrEqual(2);
    expect(postCount).toBe(0);
  });

  it("offers a safe resume after the processing lease expires", async () => {
    let postCount = 0;
    let processingExpiresAt = "2000-01-01T00:00:00.000Z";
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({
          status: "processing",
          attemptCount: 1,
          processingExpiresAt,
        }),
      ),
      http.post("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        postCount += 1;
        processingExpiresAt = new Date(Date.now() + 60_000).toISOString();
        return HttpResponse.json(
          {
            status: "processing",
            attemptCount: 2,
            processingExpiresAt,
          },
          { status: 202 },
        );
      }),
    );
    const user = userEvent.setup();

    renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    expect(
      await screen.findByRole("heading", {
        name: "This value check needs to resume.",
      }),
    ).toBeVisible();
    expect(postCount).toBe(0);

    await user.click(
      screen.getByRole("button", { name: "Resume value check" }),
    );

    await waitFor(() => expect(postCount).toBe(1));
    expect(
      await screen.findByRole("heading", {
        name: progressHeading,
      }),
    ).toBeVisible();
  });

  it("reveals the resume action when an open page reaches lease expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T17:00:00.000Z"));
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({
          status: "processing",
          attemptCount: 1,
          processingExpiresAt: "2026-08-19T17:00:01.000Z",
        }),
      ),
    );

    const rendered = renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    try {
      await vi.waitFor(() =>
        expect(
          screen.getByRole("heading", {
            name: progressHeading,
          }),
        ).toBeVisible(),
      );
      expect(
        screen.queryByRole("button", { name: "Resume value check" }),
      ).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(
        screen.getByRole("heading", {
          name: "This value check needs to resume.",
        }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Resume value check" }),
      ).toBeVisible();
    } finally {
      rendered.unmount();
      vi.useRealTimers();
    }
  });

  it("retries a retryable failed analysis only after explicit confirmation", async () => {
    let postCount = 0;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({
          status: "failed",
          attemptCount: 1,
          error: {
            code: "MARKET_PROVIDER_UNAVAILABLE",
            message: "Market evidence is temporarily unavailable.",
          },
          retryable: true,
        }),
      ),
      http.post("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        postCount += 1;
        return HttpResponse.json({
          status: "completed",
          attemptCount: 2,
          runId: representativeRunId,
        });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    expect(
      await screen.findByText("Market evidence is temporarily unavailable."),
    ).toBeVisible();
    expect(postCount).toBe(0);
    await user.click(
      screen.getByRole("button", { name: "Retry value check" }),
    );

    expect(
      await screen.findByRole("heading", { name: materialResultHeading }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(casePath);
    expect(postCount).toBe(1);
  });

  it("offers intake review for a nonretryable failure", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({
          status: "failed",
          attemptCount: 1,
          error: {
            code: "REPORT_NOT_ANALYZABLE",
            message: "The uploaded report could not be analyzed.",
          },
          retryable: false,
        }),
      ),
    );

    renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    expect(
      await screen.findByRole("link", { name: "Review intake" }),
    ).toHaveAttribute(
      "href",
      `/start?service=total-loss&caseId=${CASE_ID}`,
    );
    expect(
      screen.queryByRole("button", { name: "Retry value check" }),
    ).not.toBeInTheDocument();
  });

  it("does not request a private case while signed out", async () => {
    let requestCount = 0;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        requestCount += 1;
        return HttpResponse.json({ status: "not_submitted" });
      }),
    );

    renderTestApp([casePath], { authService: authService(null) });

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to view this value check.",
      }),
    ).toBeVisible();
    expect(requestCount).toBe(0);
  });

  it("uses the same unavailable state for a missing or unowned case", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
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

    renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this appraisal.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to appraisals" }),
    ).toHaveAttribute("href", "/appraisals");
    expect(
      screen.getByText(/may not exist, or it may belong to a different account/),
    ).toBeVisible();
  });

  it("prefers the authoritative processing status after a submit conflict", async () => {
    let getCount = 0;
    let postCount = 0;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        getCount += 1;
        return HttpResponse.json(
          getCount === 1
            ? { status: "not_submitted" }
            : {
                status: "processing",
                attemptCount: 1,
                processingExpiresAt: null,
              },
        );
      }),
      http.post("*/api/v1/appraisal-cases/:caseId/analysis", () => {
        postCount += 1;
        return HttpResponse.json(
          {
            error: {
              code: "CASE_NOT_READY",
              message: "The appraisal case is already being processed.",
            },
          },
          { status: 409 },
        );
      }),
    );

    renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2));
    expect(postCount).toBe(1);
    expect(
      screen.getByRole("heading", {
        name: progressHeading,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "We couldn’t start your value check.",
      }),
    ).not.toBeInTheDocument();
  });

  it("turns report-intake API errors into a replace-report action", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({ status: "not_submitted" }),
      ),
      http.post("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json(
          {
            error: {
              code: "REPORT_INTAKE_NOT_READY",
              message: "The saved report intake is not ready.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderTestApp([casePath], {
      authService: authService(sessionFor()),
    });

    expect(
      await screen.findByText("The saved report intake is not ready."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Replace report" }),
    ).toHaveAttribute(
      "href",
      `/start?service=total-loss&caseId=${CASE_ID}`,
    );
  });
});
