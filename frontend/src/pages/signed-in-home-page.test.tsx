import { http, HttpResponse } from "msw";
import { act, screen, waitFor, within } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type {
  TotalLossClaimFulfillmentState,
  TotalLossClaimJourneyState,
  TotalLossClaimResolver,
} from "@/features/total-loss-claim/contracts";
import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import { isNewTotalLossAppraisalIntentId } from "@/features/total-loss/new-appraisal";
import type { TotalLossDetailsService } from "@/features/total-loss/service";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const FIRST_USER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_USER_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_CASE_ID = "44444444-4444-4444-8444-444444444444";
const THIRD_CASE_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = "2026-08-20T12:00:00.000Z";

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
    createdAt: CREATED_AT,
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

function detailsFor(
  caseId: string,
  values: Partial<TotalLossCaseDetails> = {},
): TotalLossCaseDetails {
  return {
    caseId,
    intakeMode: "manual",
    vin: null,
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleTrim: null,
    mileageAtLoss: null,
    postalCode: null,
    dateOfLoss: null,
    insurerName: null,
    insurerVehicleValuation: null,
    reportUploadRecoveryRequired: false,
    reportOriginalFilename: null,
    reportUploadedAt: null,
    intakeCompletedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...values,
  };
}

function createTotalLossDependencies(
  getDetails: TotalLossDetailsService["getDetails"],
): TotalLossDependencies {
  return {
    appraisalCaseService: createCaseService(),
    totalLossDetailsService: { getDetails },
    totalLossReportStorageService: {},
    vehicleLookupService: {},
  } as unknown as TotalLossDependencies;
}

function claimResolver(
  caseId: string,
  nextState: TotalLossClaimJourneyState,
  fulfillmentState: TotalLossClaimFulfillmentState,
): TotalLossClaimResolver {
  return {
    caseId,
    commerce: {
      checkoutAvailable: false,
      entitlementStatus: "active",
      nextTask: nextState,
      orderStatus: "paid",
      paymentStatus: "succeeded",
    },
    contactEmail: null,
    journey: { fulfillmentState, nextState, retryable: false },
    state: "secured",
    workflow: {
      currentTask: nextState,
      phase: "initial_request",
      revision: 7,
    },
  };
}

function installClaimResolver(
  resolver: (caseId: string) => TotalLossClaimResolver,
) {
  const requests: Array<{
    authorization: string | null;
    caseId: string;
  }> = [];

  server.use(
    http.get(
      "*/api/v1/appraisal-cases/:caseId/claim",
      ({ params, request }) => {
        const caseId = String(params.caseId);
        requests.push({
          authorization: request.headers.get("Authorization"),
          caseId,
        });
        return HttpResponse.json(resolver(caseId));
      },
    ),
  );

  return requests;
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

function expectCurrentMilestone(label: string) {
  const milestones = screen.getByRole("list", { name: "Case milestones" });
  const milestone = within(milestones).getByText(label).closest("li");
  expect(milestone).toHaveAttribute("aria-current", "step");
}

function expectMilestoneState(label: string, stateLabel: string) {
  const milestones = screen.getByRole("list", { name: "Case milestones" });
  const milestone = within(milestones).getByText(label).closest("li");
  expect(milestone).not.toBeNull();
  expect(within(milestone as HTMLElement).getByText(stateLabel)).toBeInTheDocument();
}

describe("signed-in homepage case workspace", () => {
  it("shows an intentional first-appraisal state without case enrichment", async () => {
    const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>();
    const listAppraisalCases = vi.fn(async () => []);

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(getDetails),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Start your first appraisal",
      }),
    ).toBeVisible();
    expectNewAppraisalHref(
      screen.getByRole("link", { name: "Start your first appraisal" }),
    );
    expect(screen.queryByText("Case progress")).not.toBeInTheDocument();
    expect(listAppraisalCases).toHaveBeenCalledOnce();
    expect(getDetails).not.toHaveBeenCalled();
  });

  it("enriches only the focal intake case and keeps all other cases in history", async () => {
    const cases = [
      appraisalCase({ caseStage: "intake_in_progress" }),
      appraisalCase({
        id: SECOND_CASE_ID,
        caseStage: "closed",
        status: "closed",
      }),
      appraisalCase({
        id: THIRD_CASE_ID,
        caseStage: "closed",
        serviceType: "diminished_value",
        status: "closed",
      }),
    ];
    const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) =>
        detailsFor(caseId, {
          dateOfLoss: "2026-08-14",
          insurerName: "Example Mutual",
          vehicleMake: "Honda",
          vehicleModel: "Accord",
          vehicleTrim: "EX",
          vehicleYear: 2021,
        }),
    );

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => cases),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(getDetails),
    });

    expect(
      await screen.findByRole("heading", { name: "2021 Honda Accord EX" }),
    ).toBeVisible();
    expect(screen.getByText("Example Mutual")).toBeVisible();
    expect(screen.getByText("Date of loss Aug 14, 2026")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Continue your case details" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Continue review" }),
    ).toHaveAttribute(
      "href",
      `/start?service=total-loss&view=intake&caseId=${FIRST_CASE_ID}`,
    );
    expectCurrentMilestone("Vehicle details");
    expect(
      screen.getByRole("link", { name: "View all appraisals (3)" }),
    ).toHaveAttribute("href", "/appraisals");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByText("Recent appraisals")).not.toBeInTheDocument();
    expect(getDetails).toHaveBeenCalledOnce();
    expect(getDetails).toHaveBeenCalledWith({
      caseId: FIRST_CASE_ID,
      userId: FIRST_USER_ID,
    });
  });

  it("presents processing and completed preliminary-analysis branches", async () => {
    const processingDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) => detailsFor(caseId),
    );
    const processing = renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({
          caseStage: "analysis_processing",
          status: "checking",
        }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(processingDetails),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Your value check is in progress",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute(
      "href",
      `/total-loss/cases/${FIRST_CASE_ID}/analysis`,
    );
    expectCurrentMilestone("Value analysis");
    expectMilestoneState("Vehicle details", "Completed");
    expectMilestoneState("Value analysis", "Current step");
    expect(screen.getByText("Current status").parentElement?.parentElement).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    processing.unmount();

    const completedDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) => detailsFor(caseId),
    );
    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({
          caseStage: "analysis_complete",
          status: "check_complete",
        }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(completedDetails),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Your preliminary result is ready",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute(
      "href",
      `/total-loss/cases/${FIRST_CASE_ID}/analysis`,
    );
    expectCurrentMilestone("Value analysis");
  });

  it("resolves only the focal post-Continue case once and uses its canonical manual route", async () => {
    const cases = [
      appraisalCase({
        caseStage: "analysis_complete",
        hasTotalLossClaimWorkflow: true,
        status: "paid",
      }),
      appraisalCase({
        id: SECOND_CASE_ID,
        caseStage: "analysis_complete",
        status: "check_complete",
      }),
      appraisalCase({
        id: THIRD_CASE_ID,
        caseStage: "closed",
        status: "closed",
      }),
    ];
    const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) =>
        detailsFor(caseId, {
          intakeMode: "manual",
          vehicleMake: "Toyota",
          vehicleModel: "Camry",
          vehicleYear: 2022,
        }),
    );
    const claimRequests = installClaimResolver((caseId) =>
      claimResolver(caseId, "guide_insurer_review", "report_ready"),
    );

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => cases),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(getDetails),
    });

    expect(
      await screen.findByRole("heading", { name: "Your valuation is ready" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Review valuation" }),
    ).toHaveAttribute(
      "href",
      `/total-loss/cases/${FIRST_CASE_ID}/claim/review/market`,
    );
    await waitFor(() => expect(claimRequests).toHaveLength(1));
    expect(claimRequests).toEqual([
      {
        authorization: `Bearer access-${FIRST_USER_ID}`,
        caseId: FIRST_CASE_ID,
      },
    ]);
    expect(getDetails).toHaveBeenCalledOnce();
    expect(getDetails).toHaveBeenCalledWith({
      caseId: FIRST_CASE_ID,
      userId: FIRST_USER_ID,
    });
  });

  it.each([
    {
      action: "Prepare request",
      fulfillmentState: "report_ready" as const,
      heading: "Prepare your request",
      href: `/total-loss/cases/${FIRST_CASE_ID}/claim/review/request`,
      milestone: "Request",
      nextState: "prepare_request" as const,
    },
    {
      action: "View sent request",
      fulfillmentState: "awaiting_insurer_response" as const,
      heading: "Waiting for Example Mutual",
      href: `/total-loss/cases/${FIRST_CASE_ID}/claim/review/sent`,
      milestone: "Waiting for insurer",
      nextState: "awaiting_insurer_response" as const,
    },
    {
      action: "Review status",
      fulfillmentState: "needs_attention" as const,
      heading: "Your case needs attention",
      href: `/total-loss/cases/${FIRST_CASE_ID}/claim/processing`,
      milestone: "Valuation report",
      nextState: "needs_attention" as const,
    },
  ])(
    "renders the $nextState post-Continue branch",
    async ({
      action,
      fulfillmentState,
      heading,
      href,
      milestone,
      nextState,
    }) => {
      const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
        async ({ caseId }) =>
          detailsFor(caseId, { insurerName: "Example Mutual" }),
      );
      const claimRequests = installClaimResolver((caseId) =>
        claimResolver(caseId, nextState, fulfillmentState),
      );

      renderTestApp(["/"], {
        appraisalCaseService: createCaseService(async () => [
          appraisalCase({
            caseStage: "analysis_complete",
            hasTotalLossClaimWorkflow: true,
            status: "paid",
          }),
        ]),
        authService: createAuthHarness(sessionFor()).service,
        totalLossDependencies: createTotalLossDependencies(getDetails),
      });

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: action })).toHaveAttribute(
        "href",
        href,
      );
      expectCurrentMilestone(milestone);
      expect(claimRequests).toHaveLength(1);
    },
  );

  it("keeps a closed case as a meaningful terminal workspace", async () => {
    const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) =>
        detailsFor(caseId, {
          vehicleMake: "Ford",
          vehicleModel: "Escape",
          vehicleYear: 2020,
        }),
    );

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ caseStage: "closed", status: "closed" }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(getDetails),
    });

    expect(
      await screen.findByRole("heading", { name: "2020 Ford Escape" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Case closed" }),
    ).toBeVisible();
    expect(
      screen.getByText("No action is required for this case."),
    ).toBeVisible();
    expectCurrentMilestone("Case closed");
  });

  it("retains safe status and resume paths when detail or resolver enrichment fails", async () => {
    const failingDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async () => {
        throw new Error("details unavailable");
      },
    );
    const detailFailure = renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ caseStage: "intake_in_progress" }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(failingDetails),
    });

    expect(
      await screen.findByText(
        "Some vehicle context could not be refreshed. The case status and resume path are still available.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Your total-loss case" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Continue review" }),
    ).toHaveAttribute(
      "href",
      `/start?service=total-loss&view=intake&caseId=${FIRST_CASE_ID}`,
    );
    detailFailure.unmount();

    let claimRequests = 0;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () => {
        claimRequests += 1;
        return HttpResponse.json(
          { error: { code: "FORBIDDEN", message: "Unavailable" } },
          { status: 403 },
        );
      }),
    );
    const availableDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) =>
        detailsFor(caseId, {
          vehicleMake: "Mazda",
          vehicleModel: "CX-5",
          vehicleYear: 2021,
        }),
    );
    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({
          caseStage: "analysis_complete",
          hasTotalLossClaimWorkflow: true,
          status: "paid",
        }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(availableDetails),
    });

    expect(
      await screen.findByText(
        "Some vehicle context could not be refreshed. The case status and resume path are still available.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "2021 Mazda CX-5" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open case" })).toHaveAttribute(
      "href",
      `/total-loss/cases/${FIRST_CASE_ID}/claim`,
    );
    expect(claimRequests).toBe(1);
  });

  it("rejects an owner-mismatched list before any focal enrichment", async () => {
    const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>();

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(async () => [
        appraisalCase({ userId: SECOND_USER_ID }),
      ]),
      authService: createAuthHarness(sessionFor()).service,
      totalLossDependencies: createTotalLossDependencies(getDetails),
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your case workspace.",
      }),
    ).toBeVisible();
    expect(getDetails).not.toHaveBeenCalled();
    expect(screen.queryByText("Your total-loss case")).not.toBeInTheDocument();
  });

  it("clears the prior focal workspace while a new identity loads", async () => {
    const auth = createAuthHarness(sessionFor());
    let resolveSecondOwner!: (cases: AppraisalCase[]) => void;
    const listAppraisalCases = vi.fn((userId: string) => {
      if (userId === FIRST_USER_ID) {
        return Promise.resolve([
          appraisalCase({ caseStage: "intake_in_progress" }),
        ]);
      }
      return new Promise<AppraisalCase[]>((resolve) => {
        resolveSecondOwner = resolve;
      });
    });
    const getDetails = vi.fn<TotalLossDetailsService["getDetails"]>(
      async ({ caseId }) =>
        caseId === FIRST_CASE_ID
          ? detailsFor(caseId, {
              vehicleMake: "Honda",
              vehicleModel: "Accord",
              vehicleYear: 2021,
            })
          : detailsFor(caseId, {
              vehicleMake: "Toyota",
              vehicleModel: "RAV4",
              vehicleYear: 2024,
            }),
    );

    renderTestApp(["/"], {
      appraisalCaseService: createCaseService(listAppraisalCases),
      authService: auth.service,
      totalLossDependencies: createTotalLossDependencies(getDetails),
    });

    expect(
      await screen.findByRole("heading", { name: "2021 Honda Accord" }),
    ).toBeVisible();

    act(() => auth.emit("SIGNED_IN", sessionFor(SECOND_USER_ID)));

    expect(await screen.findByLabelText("Loading case workspace")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "2021 Honda Accord" }),
    ).not.toBeInTheDocument();

    await act(async () =>
      resolveSecondOwner([
        appraisalCase({
          id: SECOND_CASE_ID,
          caseStage: "intake_in_progress",
          userId: SECOND_USER_ID,
        }),
      ]),
    );

    expect(
      await screen.findByRole("heading", { name: "2024 Toyota RAV4" }),
    ).toBeVisible();
    expect(listAppraisalCases).toHaveBeenNthCalledWith(1, FIRST_USER_ID);
    expect(listAppraisalCases).toHaveBeenNthCalledWith(2, SECOND_USER_ID);
    expect(getDetails).toHaveBeenCalledWith({
      caseId: SECOND_CASE_ID,
      userId: SECOND_USER_ID,
    });
  });
});
