import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import { isNewTotalLossAppraisalIntentId } from "@/features/total-loss/new-appraisal";
import { renderTestApp } from "@/test/render";

const FIRST_USER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_USER_ID = "22222222-2222-4222-8222-222222222222";

function sessionFor(id = FIRST_USER_ID, anonymous = false): Session {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: anonymous ? { provider: "anonymous" } : {},
      aud: "authenticated",
      created_at: "2026-08-18T14:00:00.000Z",
      email: anonymous ? undefined : `${id.slice(0, 4)}@example.com`,
      id,
      is_anonymous: anonymous,
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
  id = "33333333-3333-4333-8333-333333333333",
  lastActivityAt = "2026-08-24T15:00:00.000Z",
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
    getAppraisalCase: async () => null,
    getOrCreateTotalLossDraft: async () => appraisalCase(),
    getRecentDraftAppraisalCase: async () => null,
    listAppraisalCases,
    touchAppraisalCase: async () => null,
  };
}

function expectNewAppraisalHref(link: HTMLElement) {
  const href = link.getAttribute("href");
  expect(href).not.toBeNull();
  const url = new URL(href ?? "", "http://localhost");
  expect(url.pathname).toBe("/start");
  expect(url.searchParams.get("service")).toBe("total-loss");
  expect(
    isNewTotalLossAppraisalIntentId(
      url.searchParams.get("newCaseId") ?? "",
    ),
  ).toBe(true);
  expect(url.searchParams.has("caseId")).toBe(false);
}

describe("signed-in homepage", () => {
  it("shows a neutral surface until authentication resolves", async () => {
    let resolveSession!: (session: Session | null) => void;
    const auth = createAuthHarness(null);
    auth.service.getSession = vi.fn(
      () =>
        new Promise<Session | null>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const listAppraisalCases = vi.fn(async () => []);

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: auth.service,
    });

    expect(screen.getByLabelText("Loading home")).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Your Vehicle’s Value, Made Clear.",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Welcome back.")).not.toBeInTheDocument();
    expect(listAppraisalCases).not.toHaveBeenCalled();

    await act(async () => resolveSession(sessionFor()));

    expect(
      await screen.findByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await waitFor(() => expect(listAppraisalCases).toHaveBeenCalledOnce());
  });

  it.each([
    ["signed out", null, undefined],
    ["anonymous guest", sessionFor(FIRST_USER_ID, true), undefined],
    ["auth unavailable", null, "Secure sign-in is unavailable."],
  ])(
    "keeps the public homepage for a %s visitor",
    async (_label, session, unavailableReason) => {
      const listAppraisalCases = vi.fn(async () => [appraisalCase()]);

      renderTestApp(["/"], {
        appraisalCaseService: createCaseService(listAppraisalCases),
        authService: unavailableReason
          ? null
          : createAuthHarness(session).service,
        authUnavailableReason: unavailableReason,
      });

      expect(
        await screen.findByRole("heading", {
          name: "Your Vehicle’s Value, Made Clear.",
        }),
      ).toBeVisible();
      expect(screen.queryByText("Welcome back.")).not.toBeInTheDocument();
      if (session?.user.is_anonymous) {
        await waitFor(() => expect(listAppraisalCases).toHaveBeenCalledWith(session.user.id));
      } else {
        expect(listAppraisalCases).not.toHaveBeenCalled();
      }
    },
  );

  it("features the highest-priority next step and shows three distinct recent cases", async () => {
    const cases = [
      appraisalCase({
        id: "33333333-3333-4333-8333-333333333333",
        status: "checking",
        caseStage: "analysis_processing",
      }),
      appraisalCase({
        id: "44444444-4444-4444-8444-444444444444",
        status: "check_complete",
        caseStage: "analysis_complete",
      }),
      appraisalCase({
        id: "55555555-5555-4555-8555-555555555555",
        status: "payment_pending",
        caseStage: "needs_attention",
        needsAttention: true,
      }),
      appraisalCase({
        id: "66666666-6666-4666-8666-666666666666",
        status: "draft",
        caseStage: "intake_in_progress",
      }),
      appraisalCase({
        id: "77777777-7777-4777-8777-777777777777",
        serviceType: "diminished_value",
        status: "submitted",
        caseStage: "submitted",
      }),
    ];

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => cases),
      authService: createAuthHarness(sessionFor()).service,
    });

    const nextStep = await screen.findByRole("region", {
      name: "Total-loss review",
    });
    expect(within(nextStep).getByText("Needs attention")).toBeVisible();
    expect(
      within(nextStep).getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", "/contact");

    const recent = screen.getByRole("region", { name: "Recent appraisals" });
    const recentCards = within(recent).getAllByRole("article");
    expect(recentCards).toHaveLength(3);
    expect(within(recentCards[0]).getByText("Value check in progress")).toBeVisible();
    expect(within(recentCards[1]).getByText("Result ready")).toBeVisible();
    expect(within(recentCards[2]).getByText("Intake in progress")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View all appraisals" }),
    ).toHaveAttribute("href", "/appraisals");
    expect(
      screen.queryByRole("link", { name: "Start a new appraisal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Start Total Loss review" }),
    ).not.toBeInTheDocument();
  });

  it("opens a completed result and offers a quiet new appraisal when no draft exists", async () => {
    const resultCaseId = "44444444-4444-4444-8444-444444444444";

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({
          id: resultCaseId,
          status: "check_complete",
          caseStage: "analysis_complete",
        }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("link", { name: "View result" }),
    ).toHaveAttribute("href", `/total-loss/cases/${resultCaseId}/analysis`);
    expectNewAppraisalHref(
      screen.getByRole("link", { name: "Start a new appraisal" }),
    );
  });

  it("makes the first-appraisal action primary for an empty account", async () => {
    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "No appraisals yet" }),
    ).toBeVisible();
    expectNewAppraisalHref(
      screen.getByRole("link", { name: "Start your first appraisal" }),
    );
    expect(
      screen.queryByRole("link", { name: "Start a new appraisal" }),
    ).not.toBeInTheDocument();
  });

  it("shows an all-caught-up state and recent history for closed cases", async () => {
    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ status: "closed", caseStage: "closed" }),
        appraisalCase({
          id: "44444444-4444-4444-8444-444444444444",
          serviceType: "diminished_value",
          status: "closed",
          caseStage: "closed",
        }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "You’re all caught up." }),
    ).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expectNewAppraisalHref(
      screen.getByRole("link", { name: "Start a new appraisal" }),
    );
  });

  it("retries a temporary owner-list failure without showing a new-appraisal action", async () => {
    const user = userEvent.setup();
    const listAppraisalCases = vi
      .fn<AppraisalCaseService["listAppraisalCases"]>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([
        appraisalCase({ caseStage: "intake_in_progress" }),
      ]);

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your appraisal overview.",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Start a new appraisal" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("link", { name: "Continue review" }),
    ).toBeVisible();
    expect(listAppraisalCases).toHaveBeenCalledTimes(2);
  });

  it("rejects data outside the signed-in owner scope", async () => {
    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ userId: SECOND_USER_ID }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your appraisal overview.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Start a new appraisal" }),
    ).not.toBeInTheDocument();
  });

  it("does not expose the prior owner while a new identity loads", async () => {
    const auth = createAuthHarness(sessionFor());
    let resolveSecondOwner!: (cases: AppraisalCase[]) => void;
    const listAppraisalCases = vi.fn((userId: string) => {
      if (userId === FIRST_USER_ID) {
        return Promise.resolve([
          appraisalCase({
            caseStage: "analysis_processing",
            status: "checking",
          }),
        ]);
      }
      return new Promise<AppraisalCase[]>((resolve) => {
        resolveSecondOwner = resolve;
      });
    });

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: auth.service,
    });

    expect(
      await screen.findByRole("link", { name: "View progress" }),
    ).toBeVisible();

    act(() => auth.emit("SIGNED_IN", sessionFor(SECOND_USER_ID)));

    expect(
      await screen.findByLabelText("Loading appraisal overview"),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "View progress" }),
    ).not.toBeInTheDocument();

    await act(async () =>
      resolveSecondOwner([
        appraisalCase({
          id: "44444444-4444-4444-8444-444444444444",
          serviceType: "diminished_value",
          status: "submitted",
          caseStage: "submitted",
          userId: SECOND_USER_ID,
        }),
      ]),
    );

    expect(
      await screen.findByRole("link", { name: "View service update" }),
    ).toBeVisible();
  });

  it("shows a safe configuration state when the case service is unavailable", async () => {
    renderTestApp(["/"], {
      appraisalCaseService: null,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your appraisal overview.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", "/contact");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
