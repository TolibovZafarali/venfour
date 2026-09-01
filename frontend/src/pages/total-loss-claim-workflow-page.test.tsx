import { http, HttpResponse } from "msw";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRoutes } from "@/app/router";
import type { AuthService } from "@/features/auth";
import type * as TotalLossDependenciesModule from "@/features/total-loss/dependencies";
import type {
  TotalLossClaimFulfillmentState,
  TotalLossClaimJourneyState,
  TotalLossEducationStep,
} from "@/features/total-loss-claim/contracts";
import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const stripeMock = vi.hoisted(() => ({
  confirm: vi.fn(),
  loadStripe: vi.fn(async () => ({})),
}));
const detailsMock = vi.hoisted(() => ({ getDetails: vi.fn() }));
vi.mock("@/features/total-loss/dependencies", async (importOriginal) => ({
  ...await importOriginal<typeof TotalLossDependenciesModule>(),
  useTotalLossDependencies: () => ({ totalLossDetailsService: detailsMock }),
}));
vi.mock("@stripe/stripe-js/pure", () => ({
  loadStripe: stripeMock.loadStripe,
}));
vi.mock("@stripe/react-stripe-js/checkout", async () => {
  const React = await import("react");
  return {
    CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) =>
      children,
    PaymentElement: ({ onReady }: { onReady: () => void }) => {
      React.useEffect(() => {
        onReady();
      }, [onReady]);
      return (
        <div data-testid="stripe-payment-element">Secure Stripe fields</div>
      );
    },
    useCheckoutElements: () => ({
      type: "success",
      checkout: { confirm: stripeMock.confirm },
    }),
  };
});
function embeddedSession(overrides: Record<string, unknown> = {}) {
  return {
    checkoutStatus: "open",
    checkoutUrl: null,
    checkoutSessionId: "cs_test_local_session",
    clientSecret: "cs_test_local_session" + "_secret_local_fixture",
    publishableKey: "pk_test_" + "local_fixture",
    uiMode: "elements",
    entitlementStatus: null,
    orderStatus: "pending",
    state: "checkout_ready",
    ...overrides,
  };
}

const USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
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
  {
    completedAt: string | null;
    skippedAt: string | null;
    viewedAt: string | null;
  }
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

function completedEducationSteps() {
  const progress = educationSteps(true);
  for (const step of ["insurer_review", "valuation", "report", "what_next"] as const) {
    progress[step] = { viewedAt: NOW, completedAt: NOW, skippedAt: null };
  }
  return progress;
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
        summary:
          "The final review confirmed the preliminary classification and supported range.",
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
    "active" | "refunded_access_retained" | "revoked" | "suspended";
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
      orderStatus:
        journey === "checkout" ? null : noDispute ? "refunded" : "paid",
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

describe("total-loss customer workflow", () => {
  beforeEach(() => {
    detailsMock.getDetails.mockReset();
    detailsMock.getDetails.mockResolvedValue({ caseId: CASE_ID, intakeMode: "report" });
    stripeMock.confirm.mockReset();
    stripeMock.confirm.mockResolvedValue({ type: "success", session: {} });
    vi.spyOn(window, "open").mockReturnValue(null);
    server.use(
      http.post("*/api/v1/appraisal-cases/:caseId/checkout-sessions", () =>
        HttpResponse.json(embeddedSession()),
      ),
    );
  });
  it("initializes one case-bound payment after verification and ignores browser success until entitlement exists", async () => {
    let initializationCalls = 0;
    let reconciliationCalls = 0;
    let paid = false;
    useClaimHandler(() =>
      paid
        ? claimProjection({
            journey: "processing",
            fulfillmentState: "finalizing",
          })
        : claimProjection({ journey: "checkout" }),
    );
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/checkout-sessions",
        async ({ request, params }) => {
          initializationCalls += 1;
          expect(params.caseId).toBe(CASE_ID);
          expect(request.headers.get("Authorization")).toBe(
            "Bearer workflow-access-token",
          );
          expect(await request.json()).toEqual({
            clientRequestId: expect.any(String),
          });
          return HttpResponse.json(embeddedSession());
        },
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/checkout-reconciliation",
        async ({ request }) => {
          reconciliationCalls += 1;
          expect(await request.json()).toEqual({
            checkoutSessionId: "cs_test_local_session",
          });
          return HttpResponse.json(
            embeddedSession({
              state: "payment_pending",
              checkoutStatus: "complete",
              clientSecret: null,
              publishableKey: null,
              uiMode: null,
            }),
          );
        },
      ),
    );
    const user = userEvent.setup();
    const { router } = renderTestApp([`${CLAIM_BASE}/checkout`], {
      authService: authService(),
      strictMode: true,
    });
    expect(await screen.findByText("Verified")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
      ).toBeEnabled(),
    );
    expect(screen.getByTestId("stripe-payment-element")).toBeVisible();
    expect(initializationCalls).toBe(1);
    await user.click(screen.getByRole("button", { name: "Complete purchase" }));
    expect(stripeMock.confirm).toHaveBeenCalledWith({
      redirect: "if_required",
    });
    expect(
      await screen.findByRole("heading", { name: "Confirming your payment" }),
    ).toBeVisible();
    await waitFor(() => expect(reconciliationCalls).toBeGreaterThan(0));
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/checkout`);
    expect(
      screen.queryByText("We’re preparing your valuation report"),
    ).not.toBeInTheDocument();
    paid = true;
    await waitFor(
      () =>
        expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/processing`),
      { timeout: 4_000 },
    );
    expect(
      await screen.findByText("We’re preparing your valuation report"),
    ).toBeVisible();
    expect(initializationCalls).toBe(1);
  });

  it("keeps a declined or canceled authentication attempt on the payment form", async () => {
    stripeMock.confirm.mockResolvedValue({
      type: "error",
      error: { message: "Authentication was canceled. Please try again." },
    });
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
    const user = userEvent.setup();
    const { router } = renderTestApp([`${CLAIM_BASE}/checkout`], {
      authService: authService(),
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Complete purchase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Authentication was canceled",
    );
    expect(
      screen.getByRole("button", { name: "Complete purchase" }),
    ).toBeEnabled();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/checkout`);
    expect(router.state.location.search).toBe("");
  });

  it.each(["open", "expired", "failed", "unknown"])(
    "restores payment after an unpaid %s authentication return",
    async (status) => {
      useClaimHandler(() => claimProjection({ journey: "checkout" }));
      server.use(
        http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
          HttpResponse.json({
            amountMinorUnits: 12900,
            availability: "available",
            currency: "USD",
          }),
        ),
        http.post(
          "*/api/v1/appraisal-cases/:caseId/checkout-reconciliation",
          () =>
            status === "unknown"
              ? HttpResponse.json({ detail: "Not found" }, { status: 404 })
              : HttpResponse.json(
                  embeddedSession({
                    state: "reconciled",
                    checkoutStatus: status,
                    clientSecret: null,
                    publishableKey: null,
                    uiMode: null,
                  }),
                ),
        ),
      );
      const { router } = renderTestApp(
        [`${CLAIM_BASE}/checkout?session_id=cs_test_previous_session`],
        { authService: authService() },
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Complete purchase" }),
        ).toBeEnabled(),
      );
      expect(router.state.location.search).toBe("");
      expect(screen.getByTestId("stripe-payment-element")).toBeVisible();
    },
  );

  it("clears a confirming marker without a session only after refreshing authoritative unpaid state", async () => {
    let resolverCalls = 0;
    let initializationCalls = 0;
    useClaimHandler(() => {
      resolverCalls += 1;
      return claimProjection({ journey: "checkout" });
    });
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
      http.post("*/api/v1/appraisal-cases/:caseId/checkout-sessions", () => {
        initializationCalls += 1;
        return HttpResponse.json(embeddedSession());
      }),
    );
    const { router } = renderTestApp(
      [`${CLAIM_BASE}/checkout?payment=confirming`],
      { authService: authService() },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
      ).toBeEnabled(),
    );
    expect(router.state.location.search).toBe("");
    expect(resolverCalls).toBeGreaterThanOrEqual(2);
    expect(initializationCalls).toBe(1);
  });

  it("reuses a saved checkout when the browser closes and reopens", async () => {
    const requests: unknown[] = [];
    useClaimHandler(() => claimProjection({ journey: "checkout" }));
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/checkout-quote", () =>
        HttpResponse.json({
          amountMinorUnits: 12900,
          availability: "available",
          currency: "USD",
        }),
      ),
      http.post(
        "*/api/v1/appraisal-cases/:caseId/checkout-sessions",
        async ({ request }) => {
          requests.push(await request.json());
          return HttpResponse.json(embeddedSession());
        },
      ),
    );
    const first = renderTestApp([`${CLAIM_BASE}/checkout`], {
      authService: authService(),
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
      ).toBeEnabled(),
    );
    first.unmount();
    renderTestApp([`${CLAIM_BASE}/checkout`], { authService: authService() });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
      ).toBeEnabled(),
    );
    expect(requests).toHaveLength(2);
    expect(stripeMock.confirm).not.toHaveBeenCalled();
  });

  it("registers completed-analysis and historical deep links", () => {
    const paths = appRoutes[0]?.children?.map((route) => route.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        ...[
          "result",
          "insurer",
          "market",
          "meaning",
          "next",
          "request",
          "sent",
        ].map((stage) => `total-loss/cases/:caseId/claim/review/${stage}`),
        ...["overview", "evidence", "request", "activity"].map(
          (section) => `total-loss/cases/:caseId/claim/${section}`,
        ),
        ...[
          "result",
          "insurer-review",
          "valuation",
          "report",
          "what-next",
          "send",
        ].map((step) => `total-loss/cases/:caseId/claim/guide/${step}`),
      ]),
    );
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
        name: "Complete your valuation review",
      }),
    ).toBeVisible();
    expect((await screen.findAllByText(/129\.00/u))[0]).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/checkout`);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
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

    expect(await screen.findByText(/Checkout was canceled/u)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Complete purchase" }),
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
        name: "Complete your valuation review",
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
        () =>
          HttpResponse.json(
            { detail: "Checkout was not found" },
            { status: 404 },
          ),
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
        name: "Complete your valuation review",
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
          name: "We need to check a detail in your case",
        }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
      expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
        "href",
        "/contact",
      );
      expect(
        screen.getByText(/does not repeat any completed payment or processing step/u),
      ).toBeVisible();
      expect(
        screen.queryByText(/preparation continues independently/u),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/could not safely move your case forward yet/u),
      ).toHaveAttribute("aria-busy", "false");
    },
  );

  afterEach(() => vi.restoreAllMocks());

  it("shows only the current educational stage without writing progress or opening request actions on visits", async () => {
    let progressWrites = 0;
    let prepareRequests = 0;
    useClaimHandler(() => claimProjection());
    server.use(
      http.put("*/api/v1/appraisal-cases/:caseId/education/:step", () => {
        progressWrites += 1;
        return HttpResponse.json({ reportVersionId: REPORT_ID, steps: educationSteps() });
      }),
      http.post("*/api/v1/appraisal-cases/:caseId/message/prepare", () => {
        prepareRequests += 1;
        return HttpResponse.json({});
      }),
    );
    renderTestApp([`${CLAIM_BASE}/review/result`], { authService: authService() });
    const completed = await screen.findByRole("region", { name: "Completed analysis" });
    expect(within(completed).getByRole("heading", { level: 1, name: "Your result" })).toBeVisible();
    for (const value of ["$18,000", "$21,000", "$3,000 below the selected median"]) {
      expect(within(completed).getByText(value, { exact: true })).toBeVisible();
    }
    expect(within(completed).getByText("$20,000 to $22,000", { exact: true })).toBeVisible();
    expect(within(completed).queryByRole("table")).not.toBeInTheDocument();
    expect(within(completed).queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(within(completed).queryByRole("button", { name: "Create my request" })).not.toBeInTheDocument();
    expect(within(completed).queryByRole("button", { name: "Download report" })).not.toBeInTheDocument();
    expect(within(completed).queryByText("Unavailable")).not.toBeInTheDocument();
    expect(progressWrites).toBe(0);
    expect(prepareRequests).toBe(0);
    expect(detailsMock.getDetails).toHaveBeenCalledWith({ caseId: CASE_ID, userId: USER_ID });
  });

  it.each([
    ["review/result", "result", ""],
    ["review/insurer", "insurer", ""],
    ["review/market", "market", ""],
    ["review/meaning", "meaning", ""],
    ["review/next", "meaning", ""],
    ["review/request", "request", ""],
    ["review/sent", "sent", ""],
    ["guide/result", "result", ""],
    ["guide/insurer-review", "insurer", ""],
    ["guide/valuation", "market", ""],
    ["guide/report", "meaning", ""],
    ["guide/what-next", "meaning", ""],
    ["guide/send", "request", ""],
    ["overview", "result", ""],
    ["evidence", "market", ""],
    ["request", "request", ""],
    ["activity", "sent", ""],
    ["evidence?evidence=insurer", "insurer", "?details=insurer"],
    ["review/result?details=market", "market", "?details=market"],
    ["review/market?details=insurer", "insurer", "?details=insurer"],
    ["review/request?details=report", "request", "?details=report"],
    ["review/request?details=unknown", "request", "?details=unknown"],
  ])("maps %s into one canonical %s stage", async (suffix, stage, search) => {
    const progress = completedEducationSteps();
    if (stage === "sent") progress.send.completedAt = NOW;
    useClaimHandler(() => claimProjection({ progress, journey: stage === "sent" ? "awaiting_insurer_response" : "prepare_request" }));
    const { router } = renderTestApp([`${CLAIM_BASE}/${suffix}`], { authService: authService() });
    const completed = await screen.findByRole("region", { name: "Completed analysis" });
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/${stage}`);
    expect(router.state.location.search).toBe(search);
    expect(within(completed).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    if (stage !== "request") {
      expect(within(completed).queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    }
  });

  it("preserves deep-link history, query focus, and the saved draft through refetch and refresh", async () => {
    let resolverCalls = 0;
    useClaimHandler(() => {
      resolverCalls += 1;
      return claimProjection({ journey: "prepare_request", progress: completedEducationSteps(), withDraft: true });
    });
    const rendered = renderTestApp([`${CLAIM_BASE}/evidence?evidence=insurer`], {
      authService: authService(),
    });
    await screen.findByRole("region", { name: "Completed analysis" });
    expect(rendered.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/insurer`);
    await act(async () => {
      await rendered.router.navigate(`${CLAIM_BASE}/review/market?details=report`);
    });
    expect(rendered.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/request`);
    await act(async () => { await rendered.router.navigate(-1); });
    expect(rendered.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/insurer`);
    expect(rendered.router.state.location.search).toBe("?details=insurer");
    expect(rendered.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/insurer`);
    await act(async () => { await rendered.router.navigate(1); });
    expect(rendered.router.state.location.search).toBe("?details=report");
    expect(rendered.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/request`);
    await act(async () => {
      await rendered.router.navigate(`${CLAIM_BASE}/review/request?source=saved`);
    });
    expect(rendered.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/request`);
    const requestStage = await screen.findByRole("region", { name: "Completed analysis" });
    const recipient = await within(requestStage).findByRole("textbox", { name: "Recipient" });
    recipient.focus();
    await act(async () => {
      await rendered.queryClient.invalidateQueries({
        queryKey: totalLossClaimQueryKeys.detail(USER_ID, CASE_ID),
      });
    });
    expect(resolverCalls).toBeGreaterThanOrEqual(2);
    expect(recipient).toHaveFocus();
    expect(recipient).toHaveValue(draft().recipient);
    expect(within(requestStage).getByRole("textbox", { name: "Subject" })).toHaveValue(draft().subject);
    expect(within(requestStage).getByRole("textbox", { name: "Message" })).toHaveValue(draft().body);
    const refreshedUrl = `${rendered.router.state.location.pathname}${rendered.router.state.location.search}`;
    rendered.unmount();
    const refreshed = renderTestApp([refreshedUrl], { authService: authService() });
    const restored = await screen.findByRole("region", { name: "Completed analysis" });
    expect(refreshed.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/request`);
    expect(refreshed.router.state.location.search).toBe("?source=saved");
    expect(within(restored).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(restored).getByRole("textbox", { name: "Message" })).toHaveValue(draft().body);
    expect(within(restored).getByRole("button", { name: "Copy email" })).toBeEnabled();
    expect(within(within(restored).getByRole("navigation", { name: "Review navigation" })).getByRole("button", { name: "Open email app" })).toBeEnabled();
  });

  it("does not normalize or save legacy drafts until request actions are explicitly opened", async () => {
    const originalBody = `I have attached ${report().suggestedFilename}.`;
    let savedDraft = { ...draft(), body: originalBody };
    const writes: Array<{ body: string; expectedRevision: number }> = [];
    useClaimHandler(() => ({ ...claimProjection({ journey: "prepare_request", progress: completedEducationSteps(), withDraft: true }), messageDraft: savedDraft }));
    server.use(
      http.patch("*/api/v1/appraisal-cases/:caseId/message-draft", async ({ request }) => {
        const update = await request.json() as { body: string; expectedRevision: number };
        writes.push(update);
        savedDraft = { ...savedDraft, body: update.body, revision: savedDraft.revision + 1 };
        return HttpResponse.json(savedDraft);
      }),
    );
    const first = renderTestApp([`${CLAIM_BASE}/review/result`], { authService: authService() });
    await screen.findByRole("region", { name: "Completed analysis" });
    for (const suffix of ["evidence", "guide/report"]) {
      await act(async () => { await first.router.navigate(`${CLAIM_BASE}/${suffix}`); });
    }
    await act(async () => {
      await first.queryClient.invalidateQueries({ queryKey: totalLossClaimQueryKeys.detail(USER_ID, CASE_ID) });
      await new Promise((resolve) => window.setTimeout(resolve, 725));
    });
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(writes).toHaveLength(0);
    first.unmount();
    expect(writes).toHaveLength(0);

    renderTestApp([`${CLAIM_BASE}/review/request`], { authService: authService() });
    const completed = await screen.findByRole("region", { name: "Completed analysis" });
    expect(await within(completed).findByRole("textbox", { name: "Message" })).toHaveValue("I have attached the market evidence report.");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ body: "I have attached the market evidence report.", expectedRevision: 1 });
  });

  it("replaces report-specific request state when a newer published report appears", async () => {
    const nextReportId = "66666666-6666-4666-8666-666666666666";
    const nextDraftId = "77777777-7777-4777-8777-777777777777";
    let newerReport = false;
    let draftWrites = 0;
    useClaimHandler(() => {
      const projection = claimProjection({
        journey: "prepare_request",
        progress: completedEducationSteps(),
        withDraft: true,
      });
      return {
        ...projection,
        education: {
          reportVersionId: newerReport ? nextReportId : REPORT_ID,
          steps: completedEducationSteps(),
        },
        messageDraft: {
          ...draft(),
          body: newerReport ? "Please review the updated evidence." : draft().body,
          draftId: newerReport ? nextDraftId : DRAFT_ID,
          reportVersionId: newerReport ? nextReportId : REPORT_ID,
          revision: newerReport ? 1 : 9,
        },
        report: {
          ...report(),
          reportId: newerReport ? nextReportId : REPORT_ID,
          versionLabel: newerReport ? "v2" : "v1",
          versionNumber: newerReport ? 2 : 1,
        },
      };
    });
    server.use(
      http.patch("*/api/v1/appraisal-cases/:caseId/message-draft", () => {
        draftWrites += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const rendered = renderTestApp([`${CLAIM_BASE}/review/request`], {
      authService: authService(),
    });
    const oldMessage = await screen.findByRole("textbox", { name: "Message" });
    expect(oldMessage).toHaveValue(draft().body);
    newerReport = true;
    await act(async () => {
      await rendered.queryClient.invalidateQueries({
        queryKey: totalLossClaimQueryKeys.detail(USER_ID, CASE_ID),
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
        "Please review the updated evidence.",
      );
    });
    expect(oldMessage).not.toBeInTheDocument();
    expect(draftWrites).toBe(0);
  });

  it.each(["suspended", "revoked"] as const)(
    "does not expose a report through a completed-analysis URL with %s access",
    async (entitlementStatus) => {
      useClaimHandler(() =>
        claimProjection({ entitlementStatus, journey: "needs_attention" }),
      );
      const { router } = renderTestApp([`${CLAIM_BASE}/review/market`], {
        authService: authService(),
      });
      expect(
        await screen.findByRole("heading", {
          name: "We need to check a detail in your case",
        }),
      ).toBeVisible();
      expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/processing`);
      expect(
        screen.queryByRole("navigation", { name: "Case sections" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Download report" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps a wrong-account deep link neutral without exposing completed evidence", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          caseId: CASE_ID,
          commerce: null,
          contactEmail: null,
          education: null,
          journey: null,
          messageDraft: null,
          report: null,
          sendingDetails: null,
          state: "account_switch_required",
          workflow: null,
        }),
      ),
    );
    const { router } = renderTestApp([`${CLAIM_BASE}/review/request`], {
      authService: authService(),
    });
    expect(
      await screen.findByRole("heading", {
        name: "Use the account associated with this claim",
      }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(CLAIM_BASE);
    expect(
      screen.queryByRole("navigation", { name: "Case sections" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("2022 Example Sedan")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Recipient" }),
    ).not.toBeInTheDocument();
  });

  it("rejects an invalid case link before requesting private data", async () => {
    let resolverCalls = 0;
    useClaimHandler(() => {
      resolverCalls += 1;
      return claimProjection();
    });
    renderTestApp(["/total-loss/cases/not-a-case/claim/review/result"], {
      authService: authService(),
    });
    expect(await screen.findByRole("heading", { name: "This claim link is invalid" })).toBeVisible();
    expect(resolverCalls).toBe(0);
    expect(screen.queryByRole("region", { name: "Completed analysis" })).not.toBeInTheDocument();
  });

  it("returns signed-out completed-analysis links to neutral claim recovery", async () => {
    const signedOut = authService();
    vi.mocked(signedOut.getSession).mockResolvedValue(null);
    let resolverCalls = 0;
    useClaimHandler(() => {
      resolverCalls += 1;
      return claimProjection();
    });
    const { router } = renderTestApp([`${CLAIM_BASE}/review/request`], {
      authService: signedOut,
    });
    expect(await screen.findByRole("heading", { name: "Request a secure claim link" })).toBeVisible();
    expect(router.state.location.pathname).toBe(CLAIM_BASE);
    expect(resolverCalls).toBe(0);
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Completed analysis" })).not.toBeInTheDocument();
  });

  it("does not expose completed evidence to an anonymous session even with a secured response", async () => {
    const guest = authService();
    const guestSession = session();
    guestSession.user.is_anonymous = true;
    vi.mocked(guest.getSession).mockResolvedValue(guestSession);
    useClaimHandler(() => claimProjection());
    const { router } = renderTestApp([`${CLAIM_BASE}/guide/report`], { authService: guest });
    expect(await screen.findByRole("heading", { name: "We couldn’t verify permanent claim access" })).toBeVisible();
    expect(router.state.location.pathname).toBe(CLAIM_BASE);
    expect(screen.queryByText("2022 Example Sedan")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download report" })).not.toBeInTheDocument();
  });

  it("does not render completed actions when the published report is missing", async () => {
    useClaimHandler(() => ({
      ...claimProjection(),
      education: null,
      report: null,
      sendingDetails: null,
    }));
    const { router } = renderTestApp([`${CLAIM_BASE}/review/result`], { authService: authService() });
    expect(await screen.findByRole("heading", { name: "This part of your claim is not ready" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/result`);
    expect(screen.queryByRole("region", { name: "Completed analysis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create request draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download report" })).not.toBeInTheDocument();
  });

  it("uses the existing owner-authorized download endpoint for viewing and downloading the report", async () => {
    useClaimHandler(() => claimProjection());
    const requestedReports: string[] = [];
    const clicked: Array<{ download: string; href: string; target: string }> =
      [];
    const signedUrl =
      "https://files.example.test/evidence.pdf?token=synthetic&download=Vehicle_Valuation_Report.pdf";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        download: this.download,
        href: this.href,
        target: this.target,
      });
    });
    server.use(
      http.get(
        "*/api/v1/appraisal-cases/:caseId/reports/:reportId/download",
        ({ params, request }) => {
          expect(params.caseId).toBe(CASE_ID);
          expect(request.headers.get("Authorization")).toBe(
            "Bearer workflow-access-token",
          );
          requestedReports.push(String(params.reportId));
          return HttpResponse.json({
            downloadUrl: signedUrl,
            expiresAt: "2026-08-29T19:00:00.000Z",
            suggestedFilename: "Vehicle_Valuation_Report.pdf",
          });
        },
      ),
    );
    const user = userEvent.setup();
    renderTestApp([`${CLAIM_BASE}/review/next?details=report`], {
      authService: authService(),
    });
    const reportSection = await screen.findByRole("region", { name: "Valuation report" });
    await user.click(
      within(reportSection).getByRole("button", { name: /^View(?: report)?$/u }),
    );
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]).toEqual({
      download: "",
      href: "https://files.example.test/evidence.pdf?token=synthetic",
      target: "_blank",
    });
    await user.click(
      within(reportSection).getByRole("button", {
        name: /^Download(?: report)?$/u,
      }),
    );
    await waitFor(() => expect(clicked).toHaveLength(2));
    expect(clicked[1]).toEqual({
      download: "Vehicle_Valuation_Report.pdf",
      href: signedUrl,
      target: "",
    });
    expect(requestedReports).toEqual([REPORT_ID, REPORT_ID]);
  });

  it.each([
    ["guide_result", "result"],
    ["guide_insurer_review", "market"],
    ["guide_valuation", "market"],
    ["guide_report", "meaning"],
    ["guide_what_next", "meaning"],
    ["prepare_request", "request"],
    ["awaiting_insurer_response", "sent"],
  ] as const)("resumes manual %s at %s using the saved owner-scoped intake mode", async (journey, stage) => {
    detailsMock.getDetails.mockResolvedValue({ caseId: CASE_ID, intakeMode: "manual" });
    const progress = completedEducationSteps();
    if (stage === "sent") progress.send.completedAt = NOW;
    useClaimHandler(() => claimProjection({ journey, progress }));
    const { router } = renderTestApp([CLAIM_BASE], { authService: authService() });
    await screen.findByRole("region", { name: "Completed analysis" });
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/${stage}`);
    expect(screen.queryByRole("heading", { name: "How your insurer reached its value" })).not.toBeInTheDocument();
    expect(detailsMock.getDetails).toHaveBeenCalledWith({ caseId: CASE_ID, userId: USER_ID });
  });

  it.each(["review/insurer", "guide/insurer-review", "evidence?evidence=insurer", "review/result?details=insurer"])(
    "redirects manual %s safely to Market without rendering an insurer stage",
    async (suffix) => {
      detailsMock.getDetails.mockResolvedValue({ caseId: CASE_ID, intakeMode: "manual" });
      useClaimHandler(() => claimProjection());
      const { router } = renderTestApp([`${CLAIM_BASE}/${suffix}`], { authService: authService() });
      await screen.findByRole("region", { name: "Completed analysis" });
      expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/market`);
      expect(router.state.location.search).toBe("");
      expect(screen.queryByRole("heading", { name: "How your insurer reached its value" })).not.toBeInTheDocument();
      expect(screen.queryByRole("table", { name: "Insurer comparables" })).not.toBeInTheDocument();
    },
  );

  it.each([CLAIM_BASE, `${CLAIM_BASE}/review/result`])("fails closed and retries missing intake mode at %s", async (path) => {
    detailsMock.getDetails.mockResolvedValueOnce(null).mockResolvedValue({ caseId: CASE_ID, intakeMode: "manual" });
    useClaimHandler(() => claimProjection());
    const { router } = renderTestApp([path], { authService: authService() });
    expect(await screen.findByRole("heading", { name: "We couldn’t load your review details" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Completed analysis" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("region", { name: "Completed analysis" });
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/result`);
  });

  it("does not read intake details before ownership and entitlement are verified", async () => {
    useClaimHandler(() => claimProjection({ entitlementStatus: "revoked", journey: "needs_attention" }));
    renderTestApp([`${CLAIM_BASE}/review/result`], { authService: authService() });
    await screen.findByRole("heading", { name: "We need to check a detail in your case" });
    expect(detailsMock.getDetails).not.toHaveBeenCalled();
  });

  it("keeps report errors inline and retries without changing the completed-analysis URL", async () => {
    useClaimHandler(() => claimProjection());
    let downloadRequests = 0;
    server.use(
      http.get(
        "*/api/v1/appraisal-cases/:caseId/reports/:reportId/download",
        () => {
          downloadRequests += 1;
          return HttpResponse.json(
            { detail: "Temporarily unavailable" },
            { status: 503 },
          );
        },
      ),
    );
    const user = userEvent.setup();
    const { router } = renderTestApp(
      [`${CLAIM_BASE}/review/market?details=report`],
      { authService: authService() },
    );
    const reportSection = await screen.findByRole("region", { name: "Valuation report" });
    await user.click(
      within(reportSection).getByRole("button", { name: /^View(?: report)?$/u }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t open the report. Please try again.",
    );
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/request`);
    expect(router.state.location.search).toBe("?details=report");
    await user.click(
      within(reportSection).getByRole("button", { name: /^View(?: report)?$/u }),
    );
    await waitFor(() => expect(downloadRequests).toBe(2));
  });

  it("disables report actions while retrieving a URL and ignores repeated clicks", async () => {
    useClaimHandler(() => claimProjection());
    let downloadRequests = 0;
    let releaseDownload!: () => void;
    const pendingDownload = new Promise<void>((resolve) => { releaseDownload = resolve; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/reports/:reportId/download", async () => {
        downloadRequests += 1;
        await pendingDownload;
        return HttpResponse.json({
          downloadUrl: "https://files.example.test/evidence.pdf?token=synthetic",
          expiresAt: "2026-08-29T19:00:00.000Z",
          suggestedFilename: "Vehicle_Valuation_Report.pdf",
        });
      }),
    );
    renderTestApp([`${CLAIM_BASE}/guide/report?details=report`], { authService: authService() });
    const reportSection = await screen.findByRole("region", { name: "Valuation report" });
    await userEvent.setup().dblClick(within(reportSection).getByRole("button", { name: "View report" }));
    await waitFor(() => expect(downloadRequests).toBe(1));
    expect(within(reportSection).getByRole("button", { name: "Opening…" })).toBeDisabled();
    expect(within(reportSection).getByRole("button", { name: "Download report" })).toBeDisabled();
    expect(within(reportSection).getByRole("status")).toHaveTextContent("Preparing your report");
    await act(async () => { releaseDownload(); });
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(within(reportSection).getByRole("button", { name: "View report" })).toBeEnabled();
    expect(within(reportSection).getByRole("button", { name: "Download report" })).toBeEnabled();
  });

  it("keeps reports accessible for a refunded no-dispute result without creating a request", async () => {
    useClaimHandler(() =>
      claimProjection({
        continuingSupported: false,
        entitlementStatus: "refunded_access_retained",
        journey: "no_dispute",
      }),
    );
    const { router } = renderTestApp([`${CLAIM_BASE}/review/request`], {
      authService: authService(),
    });
    await screen.findByRole("region", { name: "Completed analysis" });
    await waitFor(() => expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/meaning`));
    expect(
      screen.queryByRole("button", { name: "Create request draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Recipient" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("keeps report access for unsupported results without request creation", async () => {
    useClaimHandler(() => claimProjection({ continuingSupported: false, journey: "no_dispute" }));
    renderTestApp([`${CLAIM_BASE}/review/next`], { authService: authService() });
    const completed = await screen.findByRole("region", { name: "Completed analysis" });
    expect(within(completed).queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
    expect(within(completed).queryByRole("button", { name: "Create request draft" })).not.toBeInTheDocument();
    expect(within(completed).getByRole("button", { name: "View report" })).toBeEnabled();
    expect(within(completed).getByRole("button", { name: "Download report" })).toBeEnabled();
    expect(within(completed).getByText(/does not support a higher valuation request/u)).toBeVisible();
  });

  it("continues polling a no-dispute refund while preserving report access", async () => {
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
    expect(await screen.findByText(/^Your refund is in progress/u)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "View report" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`${CLAIM_BASE}/review/result`);
    expect(
      await screen.findByText(/^Your payment was refunded/u, {}, { timeout: 4_000 }),
    ).toBeVisible();
    expect(resolverCalls).toBeGreaterThanOrEqual(2);
  });

  it("restores persisted sent confirmation and timestamp when the case is reopened", async () => {
    const progress = educationSteps(true);
    progress.send.completedAt = NOW;
    useClaimHandler(() => claimProjection({ journey: "awaiting_insurer_response", progress, withDraft: true }));
    const initial = renderTestApp([CLAIM_BASE], { authService: authService() });
    const completed = await screen.findByRole("region", { name: "Completed analysis" });
    expect(initial.router.state.location.pathname).toBe(`${CLAIM_BASE}/review/sent`);
    const status = completed;
    expect(within(status).getByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(status).toHaveAttribute("data-stage", "sent");
    expect(status.querySelector("time")).toHaveAttribute("datetime", NOW);
    expect(status.querySelector("time")).toHaveTextContent("Aug 29, 2026");
    expect(within(completed).queryByRole("button", { name: "Create request draft" })).not.toBeInTheDocument();
    expect(within(completed).queryByRole("textbox", { name: "Recipient" })).not.toBeInTheDocument();
    const reopenedUrl = initial.router.state.location.pathname;
    initial.unmount();
    renderTestApp([reopenedUrl], { authService: authService() });
    const restored = await screen.findByRole("region", { name: "Completed analysis" });
    expect(within(restored).getByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(restored.querySelector("time")).toHaveAttribute("datetime", NOW);
    expect(restored.querySelector("time")).toHaveTextContent("Aug 29, 2026");
    expect(within(restored).queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
    expect(within(restored).queryByRole("button", { name: "Upload insurer response" })).not.toBeInTheDocument();
  });

  it("keeps the unsent route neutral and does not offer unsupported request preparation", async () => {
    useClaimHandler(() =>
      claimProjection({ continuingSupported: false, journey: "no_dispute" }),
    );
    renderTestApp([`${CLAIM_BASE}/review/sent`], {
      authService: authService(),
    });
    await screen.findByRole("region", { name: "Completed analysis" });
    expect(
      screen.queryByRole("heading", {
        name: "Waiting for the insurer’s response",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Your request is recorded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Prepare request" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Request marked as sent" }),
    ).not.toBeInTheDocument();
  });
});
