import { http, HttpResponse } from "msw";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import { AUTH_RETURN_LOCATION_STORAGE_KEY } from "@/features/auth/return-location";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import { isNewTotalLossAppraisalIntentId } from "@/features/total-loss/new-appraisal";
import { representativeRunId } from "@/test/fixtures/analysis-presentation";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const FIRST_USER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_USER_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_CASE_ID = "44444444-4444-4444-8444-444444444444";

function sessionFor(id = FIRST_USER_ID): Session {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-08-18T14:00:00.000Z",
      email: `${id.slice(0, 4)}@example.com`,
      id,
      user_metadata: {},
    },
  } as Session;
}

function createAuthHarness(initialSession: Session | null) {
  let currentSession = initialSession;
  const listeners = new Set<AuthStateChangeListener>();
  const service: AuthService = {
    exchangeCodeForSession: async () => sessionFor(),
    getSession: async () => currentSession,
    onAuthStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: async () => sessionFor(),
  };

  return {
    service,
    emit(event: AuthChangeEvent, session: Session | null) {
      currentSession = session;
      for (const listener of listeners) listener(event, session);
    },
  };
}

function appraisalCase({
  id = FIRST_CASE_ID,
  lastActivityAt = "2026-08-22T15:00:00.000Z",
  serviceType = "total_loss",
  status = "draft",
  userId = FIRST_USER_ID,
  ...operation
}: Partial<AppraisalCase> = {}): AppraisalCase {
  return {
    id,
    userId,
    serviceType,
    status,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: lastActivityAt,
    lastActivityAt,
    ...operation,
  };
}

function createCaseService(
  listAppraisalCases: AppraisalCaseService["listAppraisalCases"] = async () => [],
): AppraisalCaseService {
  return {
    createAppraisalCase: async () => appraisalCase(),
    createOrGetAppraisalCase: async () => appraisalCase(),
    getOrCreateTotalLossDraft: async () => appraisalCase(),
    getAppraisalCase: async () => null,
    getRecentDraftAppraisalCase: async () => null,
    listAppraisalCases,
    touchAppraisalCase: async () => null,
  };
}

function cardAt(index: number) {
  const card = screen.getAllByRole("article")[index];
  if (!card) throw new Error(`Appraisal card ${index} was not rendered.`);
  return within(card);
}

describe("customer appraisals page", () => {
  it("waits for authentication before requesting any owner data", async () => {
    let resolveSession!: (session: Session | null) => void;
    const auth = createAuthHarness(null);
    auth.service.getSession = vi.fn(
      () =>
        new Promise<Session | null>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const listAppraisalCases = vi.fn(async () => [appraisalCase()]);

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: auth.service,
    });

    expect(
      screen.getByRole("heading", { name: "Checking your sign-in…" }),
    ).toBeVisible();
    expect(listAppraisalCases).not.toHaveBeenCalled();

    resolveSession(null);
    expect(
      await screen.findByRole("heading", {
        name: "Sign in to view your appraisals.",
      }),
    ).toBeVisible();
    expect(listAppraisalCases).not.toHaveBeenCalled();
  });

  it("stores the appraisals return location when a signed-out customer signs in", async () => {
    const user = userEvent.setup();
    const auth = createAuthHarness(null);
    const listAppraisalCases = vi.fn(async () => [appraisalCase()]);

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: auth.service,
    });

    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(window.localStorage.getItem(AUTH_RETURN_LOCATION_STORAGE_KEY)).toBe(
      "/appraisals",
    );
    expect(listAppraisalCases).not.toHaveBeenCalled();
  });

  it("shows an explicit configuration state without starting a query", async () => {
    renderTestApp(["/appraisals"], {
      appraisalCaseService: null,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Your appraisals are temporarily unavailable.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", "/contact");
  });

  it("shows an explicit auth-unavailable state without requesting owner data", async () => {
    const listAppraisalCases = vi.fn(async () => [appraisalCase()]);

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: null,
      authUnavailableReason:
        "Secure sign-in is unavailable in this environment.",
    });

    expect(
      await screen.findByRole("heading", {
        name: "We can’t securely open your appraisals right now.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("Secure sign-in is unavailable in this environment."),
    ).toBeVisible();
    expect(listAppraisalCases).not.toHaveBeenCalled();
  });

  it("shows the authenticated loading state without stale case content", async () => {
    let resolveCases!: (cases: AppraisalCase[]) => void;
    const listAppraisalCases = vi.fn(
      () =>
        new Promise<AppraisalCase[]>((resolve) => {
          resolveCases = resolve;
        }),
    );

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "My appraisals" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Loading appraisals")).toBeVisible();
    expect(screen.queryAllByRole("article")).toHaveLength(0);

    resolveCases([]);
    expect(
      await screen.findByRole("heading", { name: "No appraisals yet" }),
    ).toBeVisible();
  });

  it("renders the empty state with a separate start-another action", async () => {
    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "No appraisals yet" }),
    ).toBeVisible();
    const newAppraisalHref = screen
      .getByRole("link", { name: "Start another appraisal" })
      .getAttribute("href");
    expect(newAppraisalHref).not.toBeNull();
    const newAppraisalUrl = new URL(newAppraisalHref ?? "", "http://localhost");
    expect(newAppraisalUrl.pathname).toBe("/start");
    expect(newAppraisalUrl.searchParams.get("service")).toBe("total-loss");
    expect(
      isNewTotalLossAppraisalIntentId(
        newAppraisalUrl.searchParams.get("newCaseId") ?? "",
      ),
    ).toBe(true);
    expect(newAppraisalUrl.searchParams.has("caseId")).toBe(false);
    expect(document.title).toBe("My Appraisals | Venfour");
  });

  it("retries a temporary list failure", async () => {
    const user = userEvent.setup();
    const listAppraisalCases = vi
      .fn<AppraisalCaseService["listAppraisalCases"]>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([appraisalCase()]);

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your appraisals.",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("link", { name: "Continue review" }),
    ).toBeVisible();
    expect(listAppraisalCases).toHaveBeenCalledTimes(2);
  });

  it("preserves server order and renders supported, unsupported, closed, and unknown cases", async () => {
    const cases = [
      appraisalCase({
        id: FIRST_CASE_ID,
        status: "payment_pending",
        caseStage: "analysis_processing",
      }),
      appraisalCase({
        id: SECOND_CASE_ID,
        serviceType: "diminished_value",
        status: "submitted",
      }),
      appraisalCase({
        id: "55555555-5555-4555-8555-555555555555",
        status: "payment_pending",
        caseStage: "needs_attention",
        needsAttention: true,
      }),
      appraisalCase({
        id: "66666666-6666-4666-8666-666666666666",
        serviceType: "diminished_value",
        status: "closed",
      }),
      appraisalCase({
        id: "77777777-7777-4777-8777-777777777777",
        serviceType: "unexpected_workflow",
        status: "unexpected_status",
      } as unknown as Partial<AppraisalCase>),
    ];

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(async () => cases),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("link", { name: "View progress" }),
    ).toBeVisible();
    const renderedCards = screen.getAllByRole("article");
    expect(renderedCards).toHaveLength(cases.length);
    expect(
      renderedCards.map(
        (card) => within(card).getByRole("heading", { level: 2 }).textContent,
      ),
    ).toEqual([
      "Total-loss review",
      "Diminished-value request",
      "Total-loss review",
      "Diminished-value request",
      "Vehicle review",
    ]);
    expect(screen.queryByText(FIRST_CASE_ID)).not.toBeInTheDocument();

    expect(
      cardAt(0).getByRole("link", { name: "View progress" }),
    ).toHaveAttribute("href", `/total-loss/cases/${FIRST_CASE_ID}/analysis`);
    expect(
      cardAt(1).getByRole("link", {
        name: "View service update",
      }),
    ).toHaveAttribute("href", "/start?service=diminished-value");
    expect(cardAt(2).getByText("Needs attention")).toBeVisible();
    expect(
      cardAt(2).getByRole("link", {
        name: "Contact support",
      }),
    ).toHaveAttribute("href", "/contact");
    expect(cardAt(3).getByText("Closed")).toBeVisible();
    expect(cardAt(3).queryByRole("link")).not.toBeInTheDocument();
    expect(
      cardAt(4).getByRole("heading", {
        name: "Vehicle review",
      }),
    ).toBeVisible();
    expect(
      cardAt(4).getByRole("link", {
        name: "Contact support",
      }),
    ).toBeVisible();
  });

  it("reopens a completed result after local browser state has been cleared", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
        HttpResponse.json({
          status: "completed",
          attemptCount: 1,
          runId: representativeRunId,
        }),
      ),
    );

    const { router } = renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ status: "check_complete" }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
    });

    await user.click(await screen.findByRole("link", { name: "View result" }));

    expect(
      await screen.findByRole("heading", {
        name: "Your insurer may be undervaluing your vehicle.",
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/total-loss/cases/${FIRST_CASE_ID}/analysis`,
    );
    expect(window.localStorage.length).toBe(0);
  });

  it("clears the prior identity list before loading a newly signed-in owner", async () => {
    const auth = createAuthHarness(sessionFor(FIRST_USER_ID));
    const listAppraisalCases = vi.fn(async (userId: string) =>
      userId === FIRST_USER_ID
        ? [appraisalCase({ status: "checking" })]
        : [
            appraisalCase({
              id: SECOND_CASE_ID,
              serviceType: "diminished_value",
              status: "submitted",
              userId: SECOND_USER_ID,
            }),
          ],
    );

    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: auth.service,
    });

    expect(
      await screen.findByRole("link", { name: "View progress" }),
    ).toBeVisible();
    act(() => auth.emit("SIGNED_IN", sessionFor(SECOND_USER_ID)));

    expect(
      await screen.findByRole("link", { name: "View service update" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "View progress" }),
    ).not.toBeInTheDocument();
    expect(listAppraisalCases).toHaveBeenNthCalledWith(1, FIRST_USER_ID);
    expect(listAppraisalCases).toHaveBeenNthCalledWith(2, SECOND_USER_ID);
  });

  it("denies an out-of-scope service response without rendering its case", async () => {
    renderTestApp(["/appraisals"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ userId: SECOND_USER_ID }),
      ]),
      authService: createAuthHarness(sessionFor(FIRST_USER_ID)).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your appraisals.",
      }),
    ).toBeVisible();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(
      screen.queryByRole("link", { name: "Continue review" }),
    ).not.toBeInTheDocument();
  });
});
