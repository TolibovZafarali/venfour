import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { appRoutes } from "@/app/router";
import type { AuthService } from "@/features/auth";
import type {
  TotalLossClaimFulfillmentState,
  TotalLossClaimJourneyState,
  TotalLossEducationStep,
} from "@/features/total-loss-claim/contracts";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const MESSAGE_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const UPDATED_MESSAGE_VERSION_ID = "99999999-9999-4999-8999-999999999999";
const COMMUNICATION_ID = "77777777-7777-4777-8777-777777777777";
const ROUND_ID = "88888888-8888-4888-8888-888888888888";
const NOW = "2026-08-29T18:00:00.000Z";
const CLAIM_BASE = `/total-loss/cases/${CASE_ID}/claim`;

function session(): Session {
  return {
    access_token: "workflow-access-token",
    expires_in: 3600,
    refresh_token: "workflow-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "email" },
      aud: "authenticated",
      created_at: NOW,
      email: "owner@example.com",
      id: USER_ID,
      is_anonymous: false,
      user_metadata: {},
    },
  } as Session;
}

function authService(): AuthService {
  return {
    exchangeCodeForSession: vi.fn(async () => session()),
    getSession: vi.fn(async () => session()),
    onAuthStateChange: vi.fn(() => () => undefined),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => session()),
  };
}

function educationSteps(
  resultCompleted = false,
): Record<
  TotalLossEducationStep,
  { completedAt: string | null; skippedAt: string | null; viewedAt: string | null }
> {
  return {
    result: {
      completedAt: resultCompleted ? NOW : null,
      skippedAt: null,
      viewedAt: resultCompleted ? NOW : null,
    },
    insurer_review: { completedAt: null, skippedAt: null, viewedAt: null },
    valuation: { completedAt: null, skippedAt: null, viewedAt: null },
    report: { completedAt: null, skippedAt: null, viewedAt: null },
    what_next: { completedAt: null, skippedAt: null, viewedAt: null },
    send: { completedAt: null, skippedAt: null, viewedAt: null },
  };
}

const money = (amountMinorUnits: number, formatted: string) => ({
  amountMinorUnits,
  currency: "USD",
  formatted,
});

function report(continuingSupported = true) {
  return {
    conclusion: {
      classificationLabel: continuingSupported
        ? "Material undervalue signal"
        : "Existing valuation reasonably supported",
      continuingSupported,
      indicatedDifference: continuingSupported ? money(300000, "$3,000") : null,
      insurerValuation: money(1800000, "$18,000"),
      limitations: ["Advertised prices are not guaranteed transaction prices."],
      preliminaryComparison: {
        status: "CONFIRMED",
        summary: "The final review confirmed the preliminary classification and supported range.",
      },
      summary: continuingSupported
        ? "The completed review supports a written reconsideration request."
        : "Final QA did not find sufficient evidence for a higher valuation request.",
      supportedRange: continuingSupported
        ? {
            evidenceBasis: "Selected current-market evidence",
            high: money(2200000, "$22,000"),
            low: money(2000000, "$20,000"),
            median: money(2100000, "$21,000"),
          }
        : null,
    },
    insurerEvidence: {
      adjustmentContext:
        "Insurer adjustments are shown as disclosed; missing details are not invented.",
      comparableCount: 3,
      comparables: [
        {
          adjustedValue: "$20,000.00",
          adjustmentDisclosure: "Fully disclosed",
          adjustments: {
            condition: "$0.00",
            mileage: "$200.00",
            options: "$0.00",
            package: "$0.00",
          },
          advertisedPrice: "$19,800.00",
          contributionPercent: 33.33,
          mileage: 32_000,
          netAdjustment: "$200.00",
          vehicle: "2022 Example Sedan",
        },
      ],
      insurerName: "Example Insurance",
      methodologyStatement:
        "Every insurer comparable was shown descriptively; V1 did not assign professional weights.",
      summary: {
        adjustedValueMissingCount: 0,
        adjustedValues: null,
        advertisedPriceMissingCount: 0,
        advertisedPrices: null,
        fullyDisclosedAdjustmentCount: 2,
        partiallyDisclosedAdjustmentCount: 1,
        totalCount: 3,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 0,
      },
    },
    issueDate: "2026-08-29",
    marketEvidence: {
      comparables: [
        {
          advertisedPrice: "$21,000.00",
          dealer: "Example Motors",
          distanceMiles: 12.5,
          evidenceDate: "2026-08-28",
          location: "Chicago, IL",
          mileage: 31_500,
          role: "PRIMARY",
          temporalBasis: "Current listing",
          vehicle: "2022 Example Sedan",
        },
      ],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement:
        "Only selected frozen evidence from the completed deterministic review is shown.",
      primary: {
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        label: "Current market evidence",
        prices: null,
        selectedCount: 1,
      },
      secondary: null,
    },
    reportId: REPORT_ID,
    status: "published",
    subjectVehicle: { description: "2022 Example Sedan" },
    suggestedFilename: "Venfour_Valuation_Evidence_Synthetic_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function draft() {
  return {
    body: "Please review the attached valuation evidence package and respond in writing.",
    draftId: DRAFT_ID,
    purpose: "initial_reconsideration",
    recipient: "adjuster@example.com",
    reportVersionId: REPORT_ID,
    revision: 1,
    subject: "Claim CLM-42 valuation reconsideration",
    updatedAt: NOW,
  };
}

function claimProjection({
  continuingSupported = true,
  entitlementStatus = "active",
  fulfillmentState,
  journey = "guide_result",
  progress = educationSteps(false),
  withDraft = false,
}: {
  readonly continuingSupported?: boolean;
  readonly entitlementStatus?:
    | "active"
    | "refunded_access_retained"
    | "revoked"
    | "suspended";
  readonly fulfillmentState?: TotalLossClaimFulfillmentState;
  readonly journey?: TotalLossClaimJourneyState;
  readonly progress?: ReturnType<typeof educationSteps>;
  readonly withDraft?: boolean;
} = {}) {
  const noDispute = !continuingSupported;
  return {
    caseId: CASE_ID,
    commerce: {
      checkoutAvailable: journey === "checkout",
      entitlementStatus: journey === "checkout" ? null : entitlementStatus,
      nextTask: journey,
      orderStatus: journey === "checkout" ? null : noDispute ? "refunded" : "paid",
      paymentStatus:
        journey === "checkout" ? null : noDispute ? "refunded" : "succeeded",
    },
    contactEmail: "owner@example.com",
    education:
      journey === "checkout"
        ? null
        : { reportVersionId: REPORT_ID, steps: progress },
    journey: {
      fulfillmentState:
        fulfillmentState ??
        (journey === "checkout"
          ? "not_started"
          : journey === "awaiting_insurer_response"
            ? "awaiting_insurer_response"
            : noDispute
              ? "no_dispute"
              : "report_ready"),
      nextState: journey,
      retryable: false,
    },
    messageDraft: withDraft ? draft() : null,
    report: journey === "checkout" ? null : report(continuingSupported),
    sendingDetails:
      journey === "checkout"
        ? null
        : {
            adjusterEmail: "adjuster@example.com",
            adjusterEmailConfirmed: true,
            adjusterName: "A. Adjuster",
            claimReference: "CLM-42",
            claimReferenceConfirmed: true,
            customerName: "Case Owner",
            insurerName: "Example Insurance",
            revision: 1,
            vehicleDescription: "2022 Example Sedan",
          },
    state: "secured",
    workflow: {
      currentTask: journey,
      phase: "initial_request",
      revision: 7,
    },
  };
}

function useClaimHandler(projection: () => ReturnType<typeof claimProjection>) {
  server.use(
    http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
      expect(request.headers.get("Authorization")).toBe(
        "Bearer workflow-access-token",
      );
      return HttpResponse.json(projection());
    }),
  );
}

describe("Milestone 6 total-loss customer workflow", () => {
  it("registers exactly six conceptual guide routes", () => {
    const guideRoutes = appRoutes[0]?.children?.filter((route) =>
      String(route.path).includes("/claim/guide/"),
    );
    expect(guideRoutes?.map((route) => route.path)).toEqual([
      "total-loss/cases/:caseId/claim/guide/result",
      "total-loss/cases/:caseId/claim/guide/insurer-review",
      "total-loss/cases/:caseId/claim/guide/valuation",
      "total-loss/cases/:caseId/claim/guide/report",
      "total-loss/cases/:caseId/claim/guide/what-next",
      "total-loss/cases/:caseId/claim/guide/send",
    ]);
  });

  it("uses the resolver as the authoritative resume route and loads a server quote", async () => {
    let projection = claimProjection({ journey: "checkout" });
    useClaimHandler(() => projection);
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
    );

    const { router } = renderTestApp([CLAIM_BASE], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Your valuation evidence package",
      }),
    ).toBeVisible();
    expect(await screen.findByText(/129\.00/u)).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/checkout`);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Continue to secure checkout" }),
      ).toBeEnabled(),
    );

    projection = claimProjection({
      journey: "guide_report",
      progress: educationSteps(true),
    });
  });

  it("shows a canceled checkout without changing the saved checkout state", async () => {
    useClaimHandler(() => claimProjection({ journey: "checkout" }));
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
    );

    renderTestApp([`${CLAIM_BASE}/checkout?checkout=canceled`], {
      authService: authService(),
    });

    expect(
      await screen.findByText(/Checkout was canceled/u),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Continue to secure checkout" }),
      ).toBeEnabled(),
    );
  });

  it("returns an unpaid checkout session to checkout after reconciliation", async () => {
    let reconciliationCalls = 0;
    useClaimHandler(() => claimProjection({ journey: "checkout" }));
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/checkout-reconciliation",
        () => {
          reconciliationCalls += 1;
          return HttpResponse.json({
            checkoutStatus: "expired",
            checkoutUrl: null,
            entitlementStatus: null,
            orderStatus: "pending",
            state: "reconciled",
          });
        },
      ),
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
    );

    const { router } = renderTestApp(
      [`${CLAIM_BASE}/checkout/return?session_id=cs_test_unpaid`],
      { authService: authService() },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Your valuation evidence package",
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/checkout`);
    expect(reconciliationCalls).toBe(1);
  });

  it("returns a tampered checkout-session link to authoritative checkout", async () => {
    useClaimHandler(() => claimProjection({ journey: "checkout" }));
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/checkout-reconciliation",
        () => HttpResponse.json({ detail: "Checkout was not found" }, { status: 404 }),
      ),
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
    );

    const { router } = renderTestApp(
      [`${CLAIM_BASE}/checkout/return?session_id=cs_tampered`],
      { authService: authService() },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Your valuation evidence package",
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/checkout`);
  });

  it.each(["suspended", "revoked"] as const)(
    "shows needs-attention UI for a %s entitlement even with stale fulfillment state",
    async (entitlementStatus) => {
      useClaimHandler(() =>
        claimProjection({
          entitlementStatus,
          journey: "needs_attention",
        }),
      );

      renderTestApp([`${CLAIM_BASE}/processing`], {
        authService: authService(),
      });

      expect(
        await screen.findByRole("heading", {
          name: "Your package needs attention",
        }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
      expect(screen.getByText(/could not safely complete the package yet/u))
        .toHaveAttribute("aria-busy", "false");
    },
  );

  it("keeps first-visit primary and skip actions enabled while viewed progress refetches", async () => {
    const progress = educationSteps(true);
    let resolverCalls = 0;
    let viewPutCompleted = false;
    let releaseRefetch: () => void = () => undefined;
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    server.use(
      http.get(
        "*/api/v1/appraisal-cases/:caseId/claim",
        async ({ request }) => {
          expect(request.headers.get("Authorization")).toBe(
            "Bearer workflow-access-token",
          );
          resolverCalls += 1;
          if (resolverCalls > 1) await refetchGate;
          return HttpResponse.json(
            claimProjection({
              journey: "guide_insurer_review",
              progress,
            }),
          );
        },
      ),
      http.put(
        "*/api/v1/appraisal-cases/:caseId/education/:step",
        async ({ params, request }) => {
          expect(params.step).toBe("insurer_review");
          expect(await request.json()).toMatchObject({ state: "viewed" });
          progress.insurer_review.viewedAt = NOW;
          viewPutCompleted = true;
          return HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress });
        },
      ),
    );

    renderTestApp([`${CLAIM_BASE}/guide/insurer-review`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "We reviewed the insurer’s evidence too",
      }),
    ).toBeVisible();
    await waitFor(() => expect(viewPutCompleted).toBe(true));
    await waitFor(() => expect(resolverCalls).toBeGreaterThanOrEqual(2));

    const primaryEnabled = !screen
      .getByRole("button", { name: "See the market evidence" })
      .hasAttribute("disabled");
    const skipEnabled = !screen
      .getByRole("button", { name: "Skip to prepare request" })
      .hasAttribute("disabled");
    releaseRefetch();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "See the market evidence" }),
      ).toBeEnabled(),
    );

    expect(primaryEnabled).toBe(true);
    expect(skipEnabled).toBe(true);
  });

  it("persists required result completion and an optional skip before opening Screen 6", async () => {
    const progress = educationSteps(false);
    let journey: TotalLossClaimJourneyState = "guide_result";
    const updates: Array<{ state: string; step: string }> = [];
    useClaimHandler(() => claimProjection({ journey, progress, withDraft: true }));
    server.use(
      http.put(
        "*/api/v1/appraisal-cases/:caseId/education/:step",
        async ({ params, request }) => {
          const step = String(params.step) as TotalLossEducationStep;
          const payload = (await request.json()) as { state: string };
          updates.push({ state: payload.state, step });
          progress[step].viewedAt ??= NOW;
          if (payload.state === "completed") progress[step].completedAt = NOW;
          if (payload.state === "skipped") progress[step].skippedAt = NOW;
          if (step === "result" && payload.state === "completed") {
            journey = "guide_insurer_review";
          }
          if (step === "insurer_review" && payload.state === "skipped") {
            journey = "prepare_request";
          }
          return HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress });
        },
      ),
    );
    const user = userEvent.setup();
    const { router } = renderTestApp([`${CLAIM_BASE}/guide/result`], {
      authService: authService(),
    });

    const resultHeading = await screen.findByRole("heading", {
      name: "Here’s what the completed evidence supports",
    });
    expect(resultHeading).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "The final review confirmed your preliminary result",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Result/u })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.queryByRole("link", { name: /Prepare request/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Prepare request").closest("[aria-disabled=true]"))
      .toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Skip to prepare request" }),
    ).not.toBeInTheDocument();

    const continueButton = screen.getByRole("button", {
      name: "See how we reached it",
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);

    expect(
      await screen.findByRole("heading", {
        name: "We reviewed the insurer’s evidence too",
      }),
    ).toBeVisible();
    expect(screen.getByText("3 reviewed")).toBeVisible();
    expect(screen.getByText("2 of 3")).toBeVisible();
    expect(screen.getByText(/Every insurer comparable was shown descriptively/u))
      .toBeVisible();
    expect(screen.getByText(/Advertised \$19,800\.00/u)).toBeVisible();
    const skip = screen.getByRole("button", { name: "Skip to prepare request" });
    await waitFor(() => expect(skip).toBeEnabled());
    await user.click(skip);

    expect(
      await screen.findByRole("heading", {
        name: "Review your valuation reconsideration request",
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/guide/send`);
    expect(screen.getByRole("link", { name: /Insurer review/u })).toBeVisible();
    expect(updates).toEqual(
      expect.arrayContaining([
        { state: "completed", step: "result" },
        { state: "skipped", step: "insurer_review" },
      ]),
    );
  });

  it("rejects a direct send route until the resolver authorizes preparation", async () => {
    const progress = educationSteps(true);
    useClaimHandler(() =>
      claimProjection({
        journey: "guide_insurer_review",
        progress,
        withDraft: true,
      }),
    );
    server.use(
      http.put("*/api/v1/appraisal-cases/:caseId/education/:step", () =>
        HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress }),
      ),
    );

    const { router } = renderTestApp([`${CLAIM_BASE}/guide/send`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "We reviewed the insurer’s evidence too",
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `${CLAIM_BASE}/guide/insurer-review`,
    );
    expect(
      screen.queryByRole("heading", {
        name: "Review your valuation reconsideration request",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders only safe completed evidence facts on Screens 1 through 3", async () => {
    const progress = educationSteps(true);
    progress.insurer_review.completedAt = NOW;
    progress.insurer_review.viewedAt = NOW;
    useClaimHandler(() =>
      claimProjection({ journey: "guide_valuation", progress }),
    );
    server.use(
      http.put("*/api/v1/appraisal-cases/:caseId/education/:step", () =>
        HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress }),
      ),
    );

    renderTestApp([`${CLAIM_BASE}/guide/valuation`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "How the evidence supports your range",
      }),
    ).toBeVisible();
    expect(screen.getByText("2022 Example Sedan")).toBeVisible();
    expect(screen.getByText(/Chicago, IL/u)).toBeVisible();
    expect(screen.getByText(/Only selected frozen evidence/u)).toBeVisible();
    expect(screen.getByText("2026-08-28")).toBeVisible();
    expect(screen.getByText(/server-completed report values/u)).toBeVisible();
    expect(screen.queryByText(/provider|source listing|VIN/iu)).not.toBeInTheDocument();
  });

  it("keeps Screen 5 optional without a redundant skip action", async () => {
    const progress = educationSteps(true);
    for (const step of ["insurer_review", "valuation", "report"] as const) {
      progress[step].completedAt = NOW;
      progress[step].viewedAt = NOW;
    }
    useClaimHandler(() =>
      claimProjection({ journey: "guide_what_next", progress }),
    );
    server.use(
      http.put("*/api/v1/appraisal-cases/:caseId/education/:step", () =>
        HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress }),
      ),
    );

    renderTestApp([`${CLAIM_BASE}/guide/what-next`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", { name: "What may happen next" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Prepare my request" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Skip to prepare request" }),
    ).not.toBeInTheDocument();
  });

  it("diverts a refunded no-dispute result away from education and email", async () => {
    useClaimHandler(() =>
      claimProjection({
        continuingSupported: false,
        entitlementStatus: "refunded_access_retained",
        journey: "no_dispute",
        progress: educationSteps(false),
      }),
    );
    const { router } = renderTestApp(
      [`${CLAIM_BASE}/guide/insurer-review`],
      { authService: authService() },
    );

    expect(
      await screen.findByRole("heading", {
        name: "The completed review does not support asking for a higher valuation",
      }),
    ).toBeVisible();
    expect(screen.getByText("Refunded")).toBeVisible();
    expect(screen.getByText("1 selected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download report" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Prepare request|Open default email/u }),
    ).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/guide/result`);
  });

  it("routes a published no-dispute report to its result while refund is pending", async () => {
    let fulfillmentState: TotalLossClaimFulfillmentState = "refund_pending";
    let entitlementStatus: "active" | "refunded_access_retained" = "active";
    let resolverCalls = 0;
    useClaimHandler(() => {
      resolverCalls += 1;
      const projection = claimProjection({
        continuingSupported: false,
        entitlementStatus,
        fulfillmentState,
        journey: "no_dispute",
      });
      if (resolverCalls === 1) {
        fulfillmentState = "no_dispute";
        entitlementStatus = "refunded_access_retained";
      }
      return projection;
    });

    const { router } = renderTestApp([`${CLAIM_BASE}/processing`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "The completed review does not support asking for a higher valuation",
      }),
    ).toBeVisible();
    expect(screen.getByText("Refund in progress")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download report" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/guide/result`);
    expect(await screen.findByText("Refunded", {}, { timeout: 4_000 })).toBeVisible();
    expect(resolverCalls).toBeGreaterThanOrEqual(2);
  });

  it("prepares the exact saved edit before copy and sent confirmation", async () => {
    const progress = educationSteps(true);
    let journey: TotalLossClaimJourneyState = "prepare_request";
    let persistedDraft = draft();
    let prepareCalls = 0;
    let sentBody: Record<string, unknown> | null = null;
    const preparedSubjects: string[] = [];
    useClaimHandler(() => claimProjection({ journey, progress }));
    server.use(
      http.put(
        "*/api/v1/appraisal-cases/:caseId/education/:step",
        async ({ params }) => {
          const step = String(params.step) as TotalLossEducationStep;
          progress[step].viewedAt ??= NOW;
          return HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress });
        },
      ),
      http.patch(
        "*/api/v1/appraisal-cases/:caseId/message-draft",
        async ({ request }) => {
          const payload = (await request.json()) as {
            body: string;
            recipient: string;
            subject: string;
          };
          persistedDraft = {
            ...persistedDraft,
            body: payload.body,
            recipient: payload.recipient,
            revision: persistedDraft.revision + 1,
            subject: payload.subject,
          };
          return HttpResponse.json(persistedDraft);
        },
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/message/prepare",
        () => {
          prepareCalls += 1;
          preparedSubjects.push(persistedDraft.subject);
          return HttpResponse.json({
            draft: persistedDraft,
            messageVersion: {
              body: persistedDraft.body,
              createdAt: NOW,
              messageVersionId:
                prepareCalls === 1
                  ? MESSAGE_VERSION_ID
                  : UPDATED_MESSAGE_VERSION_ID,
              recipient: persistedDraft.recipient,
              reportVersionId: REPORT_ID,
              state: "prepared",
              subject: persistedDraft.subject,
              versionNumber: prepareCalls,
            },
            workflowRevision: 9,
          });
        },
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/message/sent",
        async ({ request }) => {
          sentBody = (await request.json()) as Record<string, unknown>;
          journey = "awaiting_insurer_response";
          return HttpResponse.json({
            communicationId: COMMUNICATION_ID,
            customerReportedSentAt: NOW,
            messageVersionId: UPDATED_MESSAGE_VERSION_ID,
            negotiationRoundId: ROUND_ID,
            state: "awaiting_insurer_response",
            workflowRevision: 10,
          });
        },
      ),
    );
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderTestApp([`${CLAIM_BASE}/guide/send`], {
      authService: authService(),
    });

    await user.click(
      await screen.findByRole("button", { name: "Prepare request draft" }),
    );
    const subject = await screen.findByRole("textbox", { name: "Subject" });
    const message = screen.getByRole("textbox", { name: "Message" });
    await user.clear(subject);
    await user.type(subject, "Updated claim CLM-42 valuation request");
    await user.clear(message);
    await user.type(
      message,
      "Please review my updated request and the attached evidence package.",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Draft saved.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copy email" }));
    expect(await screen.findByText(/Email copied/u)).toBeVisible();
    expect(prepareCalls).toBe(2);
    expect(preparedSubjects).toEqual([
      draft().subject,
      "Updated claim CLM-42 valuation request",
    ]);
    expect(writeText).toHaveBeenCalledWith(
      "Subject: Updated claim CLM-42 valuation request\n\nPlease review my updated request and the attached evidence package.",
    );

    await user.click(screen.getByRole("button", { name: "I sent it" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Confirm that you sent the request",
    });
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /I sent the email to my insurer and attached the Venfour report/u,
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm I sent it" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your request is recorded" }),
    ).toBeVisible();
    expect(prepareCalls).toBe(2);
    expect(sentBody).toMatchObject({
      messageVersionId: UPDATED_MESSAGE_VERSION_ID,
    });
    writeText.mockRestore();
  });

  it("requires explicit attachment confirmation and records sent only once", async () => {
    const progress = educationSteps(true);
    let journey: TotalLossClaimJourneyState = "prepare_request";
    let sentBody: Record<string, unknown> | null = null;
    let sentCalls = 0;
    useClaimHandler(() => claimProjection({ journey, progress, withDraft: true }));
    server.use(
      http.put(
        "*/api/v1/appraisal-cases/:caseId/education/:step",
        async ({ params }) => {
          const step = String(params.step) as TotalLossEducationStep;
          progress[step].viewedAt ??= NOW;
          return HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress });
        },
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/message/prepare",
        () =>
          HttpResponse.json({
            draft: draft(),
            messageVersion: {
              body: draft().body,
              createdAt: NOW,
              messageVersionId: MESSAGE_VERSION_ID,
              recipient: draft().recipient,
              reportVersionId: REPORT_ID,
              state: "prepared",
              subject: draft().subject,
              versionNumber: 1,
            },
            workflowRevision: 9,
          }),
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/message/sent",
        async ({ request }) => {
          sentCalls += 1;
          sentBody = (await request.json()) as Record<string, unknown>;
          journey = "awaiting_insurer_response";
          return HttpResponse.json({
            communicationId: COMMUNICATION_ID,
            customerReportedSentAt: NOW,
            messageVersionId: MESSAGE_VERSION_ID,
            negotiationRoundId: ROUND_ID,
            state: "awaiting_insurer_response",
            workflowRevision: 8,
          });
        },
      ),
    );
    const user = userEvent.setup();
    renderTestApp([`${CLAIM_BASE}/guide/send`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Review your valuation reconsideration request",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("Venfour_Valuation_Evidence_Synthetic_v1.pdf"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "I sent it" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Confirm that you sent the request",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm I sent it",
    });
    expect(confirm).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /I sent the email to my insurer and attached the Venfour report/u,
      }),
    );
    await user.click(confirm);

    expect(
      await screen.findByRole("heading", { name: "Your request is recorded" }),
    ).toBeVisible();
    expect(sentCalls).toBe(1);
    expect(sentBody).toMatchObject({
      confirmedReportAttached: true,
      expectedWorkflowRevision: 9,
      messageVersionId: MESSAGE_VERSION_ID,
    });
    expect(screen.getByText(/cannot verify email delivery/iu)).toBeVisible();
  });

  it("recovers from a stale sent confirmation by refreshing authoritative state", async () => {
    const progress = educationSteps(true);
    let journey: TotalLossClaimJourneyState = "prepare_request";
    let sentCalls = 0;
    useClaimHandler(() => claimProjection({ journey, progress, withDraft: true }));
    server.use(
      http.put(
        "*/api/v1/appraisal-cases/:caseId/education/:step",
        async ({ params }) => {
          const step = String(params.step) as TotalLossEducationStep;
          progress[step].viewedAt ??= NOW;
          return HttpResponse.json({ reportVersionId: REPORT_ID, steps: progress });
        },
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/message/prepare",
        () =>
          HttpResponse.json({
            draft: draft(),
            messageVersion: {
              body: draft().body,
              createdAt: NOW,
              messageVersionId: MESSAGE_VERSION_ID,
              recipient: draft().recipient,
              reportVersionId: REPORT_ID,
              state: "prepared",
              subject: draft().subject,
              versionNumber: 1,
            },
            workflowRevision: 9,
          }),
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/message/sent",
        () => {
          sentCalls += 1;
          journey = "awaiting_insurer_response";
          return HttpResponse.json(
            { detail: "The case changed in another tab." },
            { status: 409 },
          );
        },
      ),
    );
    const user = userEvent.setup();
    renderTestApp([`${CLAIM_BASE}/guide/send`], {
      authService: authService(),
    });

    expect(
      await screen.findByRole("heading", {
        name: "Review your valuation reconsideration request",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "I sent it" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Confirm that you sent the request",
    });
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /I sent the email to my insurer and attached the Venfour report/u,
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm I sent it" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your request is recorded" }),
    ).toBeVisible();
    expect(sentCalls).toBe(1);
    expect(screen.getByText(/cannot verify email delivery/iu)).toBeVisible();
    expect(
      screen.queryByText(/couldn’t record the confirmation/iu),
    ).not.toBeInTheDocument();
  });
});
