import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { CompletedAnalysis } from "@/features/total-loss-claim/components/completed-analysis";
import {
  TOTAL_LOSS_EDUCATION_STEPS,
  type TotalLossClaimJourneyState,
  type TotalLossClaimSecured,
  type TotalLossEducationStep,
  type TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import { useTotalLossClaimQuery } from "@/features/total-loss-claim/queries";
import type { TotalLossClaimWorkflowView } from "@/features/total-loss-claim/workflow-route";
import { server } from "@/test/mocks/server";

const request = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/features/total-loss-claim/components/message-preparation", () => ({
  MessagePreparation: (props: { readonly claim: TotalLossClaimSecured }) => {
    request.render(props);
    return <><h1>{props.claim.messageDraft ? "Review and send" : "Prepare your request"}</h1><div data-testid="request-controls">Request controls</div></>;
  },
}));

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-29T18:00:00.000Z";
const BASE = `/total-loss/cases/${CASE_ID}/claim`;
const API = "*/api/v1/appraisal-cases/:caseId";
const BEFORE_MEANING: TotalLossEducationStep[] = [
  "result", "insurer_review", "valuation",
];
const BEFORE_REQUEST: TotalLossEducationStep[] = [
  ...BEFORE_MEANING, "report", "what_next",
];

function money(amountMinorUnits: number, formatted: string) {
  return { amountMinorUnits, currency: "USD", formatted };
}

function publishedReport(): TotalLossPublishedReport {
  return {
    conclusion: {
      classificationLabel: "Potential undervaluation",
      continuingSupported: true,
      indicatedDifference: money(144400, "$1,444"),
      insurerValuation: money(1904600, "$19,046"),
      limitations: [
        "Advertised prices are not completed-sale prices.",
        "No independent condition adjustment was calculated.",
        "The full package records additional provider coverage limitations.",
      ],
      preliminaryComparison: { status: "CONFIRMED", summary: "The completed review confirmed the saved result." },
      summary: "The completed evidence supports a written reconsideration request.",
      supportedRange: {
        low: money(1980000, "$19,800"),
        median: money(2049000, "$20,490"),
        high: money(2226300, "$22,263"),
        evidenceBasis: "Current advertised-price evidence",
      },
    },
    insurerEvidence: {
      adjustmentContext: "Only adjustments disclosed in the insurer report are shown.",
      comparableCount: 1,
      comparables: [{
        vehicle: "2022 Insurer Example Sedan",
        mileage: 32000,
        advertisedPrice: "$19,800",
        adjustedValue: "$19,500",
        netAdjustment: "-$300",
        adjustments: { condition: "-$500", mileage: "$200", options: null, package: null },
        adjustmentDisclosure: "Partially disclosed",
        contributionPercent: null,
      }],
      insurerName: "Example Insurance",
      methodologyStatement: "Every insurer comparable is shown descriptively.",
      summary: {
        totalCount: 1,
        adjustedValueMissingCount: 0,
        adjustedValues: { count: 1, low: money(1950000, "$19,500"), high: money(1950000, "$19,500"), median: money(1950000, "$19,500") },
        advertisedPriceMissingCount: 0,
        advertisedPrices: { count: 1, low: money(1980000, "$19,800"), high: money(1980000, "$19,800"), median: money(1980000, "$19,800") },
        fullyDisclosedAdjustmentCount: 0,
        partiallyDisclosedAdjustmentCount: 1,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 0,
      },
    },
    marketEvidence: {
      comparables: [{
        vehicle: "2022 Market Example Sedan",
        advertisedPrice: "$20,490",
        dealer: "Example Motors",
        location: "Chicago, IL",
        distanceMiles: 12.5,
        mileage: 31500,
        role: "PRIMARY",
        evidenceDate: "2026-08-28",
        temporalBasis: "CURRENT_MARKET",
      }],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement: "Only selected advertised-price evidence is shown.",
      primary: {
        label: "Current market evidence",
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        selectedCount: 1,
        prices: null,
      },
      secondary: null,
    },
    issueDate: "2026-08-29",
    reportId: REPORT_ID,
    status: "published",
    subjectVehicle: { description: "2022 Example Sedan" },
    suggestedFilename: "Venfour_Valuation_Evidence_Synthetic_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function claimProjection(completed: readonly TotalLossEducationStep[] = []): TotalLossClaimSecured {
  return {
    caseId: CASE_ID,
    state: "secured",
    contactEmail: "owner@example.com",
    commerce: {
      checkoutAvailable: false,
      entitlementStatus: "active",
      nextTask: "report_ready",
      orderStatus: "paid",
      paymentStatus: "succeeded",
    },
    education: {
      reportVersionId: REPORT_ID,
      steps: Object.fromEntries(TOTAL_LOSS_EDUCATION_STEPS.map((step) => [step, {
        completedAt: completed.includes(step) ? NOW : null,
        viewedAt: completed.includes(step) ? NOW : null,
        skippedAt: null,
      }])) as NonNullable<TotalLossClaimSecured["education"]>["steps"],
    },
    journey: { fulfillmentState: "report_ready", nextState: "guide_result", retryable: false },
    messageDraft: {
      draftId: "55555555-5555-4555-8555-555555555555",
      purpose: "initial_reconsideration",
      recipient: "adjuster@example.com",
      reportVersionId: REPORT_ID,
      revision: 1,
      subject: "Claim CLM-42 valuation reconsideration",
      body: "Legacy saved draft that must not be normalized by an evidence visit.",
      updatedAt: NOW,
    },
    report: publishedReport(),
    sendingDetails: null,
    workflow: { currentTask: "report_ready", phase: "initial_request", revision: 7 },
  };
}

interface EducationWrite {
  readonly step: TotalLossEducationStep;
  readonly state: string;
  readonly expectedWorkflowRevision: number;
}

function installClaim(initialClaim = claimProjection(), failOnce?: TotalLossEducationStep, beforeSave?: () => Promise<void>) {
  let claim = initialClaim;
  let failed = false;
  const writes: EducationWrite[] = [];
  const draftWrites = vi.fn();
  server.use(
    http.get(`${API}/claim`, () => HttpResponse.json(claim)),
    http.put(`${API}/education/:step`, async ({ params, request: update }) => {
      const step = params.step as TotalLossEducationStep;
      const body = await update.json() as Omit<EducationWrite, "step">;
      writes.push({ step, ...body });
      expect(body.expectedWorkflowRevision).toBe(claim.workflow?.revision);
      await beforeSave?.();
      if (step === failOnce && !failed) {
        failed = true;
        return HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Please try again." } }, { status: 503 });
      }
      const steps = {
        ...claim.education!.steps,
        [step]: { completedAt: NOW, viewedAt: NOW, skippedAt: null },
      };
      const nextStates: Record<TotalLossEducationStep, TotalLossClaimJourneyState> = {
        result: "guide_result", insurer_review: "guide_insurer_review", valuation: "guide_valuation",
        report: "guide_report", what_next: "guide_what_next", send: "prepare_request",
      };
      const nextStep = TOTAL_LOSS_EDUCATION_STEPS.find((item) => !steps[item].completedAt && !steps[item].skippedAt);
      claim = {
        ...claim,
        education: { reportVersionId: REPORT_ID, steps },
        workflow: { ...claim.workflow!, revision: claim.workflow!.revision + 1 },
        journey: { fulfillmentState: "report_ready", nextState: nextStep ? nextStates[nextStep] : "awaiting_insurer_response", retryable: false },
      };
      return HttpResponse.json({ education: claim.education, workflowRevision: claim.workflow!.revision });
    }),
    http.put(`${API}/message-draft`, () => {
      draftWrites();
      return HttpResponse.json({ error: { code: "UNEXPECTED_WRITE", message: "An evidence visit must not update a draft." } }, { status: 500 });
    }),
  );
  return { writes, draftWrites, claim: () => claim };
}

function JourneyHarness({ intakeMode }: { readonly intakeMode: TotalLossIntakeMode }) {
  const { stage = "result" } = useParams();
  const query = useTotalLossClaimQuery({ accessToken: "completed-access-token", caseId: CASE_ID, userId: USER_ID });
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  if (!query.data || query.data.state !== "secured" || !query.data.report) return <p>Loading saved report</p>;
  return <CompletedAnalysis
    accessToken="completed-access-token"
    caseId={CASE_ID}
    claim={query.data}
    intakeMode={intakeMode}
    onRefresh={query.refetch}
    report={query.data.report}
    userId={USER_ID}
    view={`review_${stage}` as TotalLossClaimWorkflowView}
  />;
}

function renderJourney(intakeMode: TotalLossIntakeMode, initialStage = "result") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: `${BASE}/review/:stage`, element: <JourneyHarness intakeMode={intakeMode} /> }], {
    initialEntries: [`${BASE}/review/${initialStage}`],
  });
  const result = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  return { ...result, router };
}

function backControl() {
  return screen.queryByRole("link", { name: /^Back$/u }) ?? screen.getByRole("button", { name: /^Back$/u });
}

describe("completed-analysis guided progression", () => {
  beforeEach(() => request.render.mockClear());

  it("does not navigate away from a route chosen while an acknowledgement is still saving", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const saved = installClaim(claimProjection(), undefined, () => pending);
    const { router } = renderJourney("report");
    await userEvent.setup().click(await screen.findByRole("button", { name: "See how the insurer reached its value" }));
    await waitFor(() => expect(saved.writes).toHaveLength(1));
    await act(() => router.navigate(`${BASE}/review/market`));
    await act(async () => { release(); await pending; });
    await waitFor(() => expect(saved.claim().education?.steps.result.completedAt).toBe(NOW));
    expect(router.state.location.pathname).toBe(`${BASE}/review/market`);
    expect(screen.getByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
  });

  it("walks report owners through the four evidence stages with ordered revision-fenced acknowledgements before mounting request controls", async () => {
    const saved = installClaim();
    const user = userEvent.setup();
    const { router } = renderJourney("report");

    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText("$20,490")).toBeVisible();
    expect(screen.queryByText(/midpoint|evidence strength|percentage difference/iu)).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
    expect(saved.writes).toEqual([]);

    await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/insurer`);
    expect(screen.getByRole("table", { name: "Insurer comparables" })).not.toBeVisible();
    await user.click(screen.getByText("Insurer comparable details"));
    expect(screen.getByRole("table", { name: "Insurer comparables" })).toBeVisible();
    expect(screen.getByText("-$500")).toBeVisible();
    expect(request.render).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/market`);
    await user.click(screen.getByText("Selected market listing details"));
    const marketTable = screen.getByRole("table", { name: "Selected market listings" });
    expect(within(marketTable).getByText("Example Motors")).toBeVisible();
    expect(within(marketTable).getByText("Chicago, IL")).toBeVisible();
    expect(within(marketTable).getByText("12.5 mi")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(request.render).not.toHaveBeenCalled();
    expect(screen.queryByText("The full package records additional provider coverage limitations.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Prepare my request" }));
    expect(await screen.findByTestId("request-controls")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review and send" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(saved.writes).toEqual(BEFORE_REQUEST.map((step, index) => ({ step, state: "completed", expectedWorkflowRevision: 7 + index })));
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it("omits insurer education for manual owners and completes its compatibility marker only when leaving Market", async () => {
    const saved = installClaim();
    const user = userEvent.setup();
    const { router } = renderJourney("manual");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText(/did not provide the insurer.s valuation report/iu)).toBeVisible();
    expect(screen.queryByRole("button", { name: "See how the insurer reached its value" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(saved.writes.map(({ step }) => step)).toEqual(["result"]);
    expect(screen.queryByText("Insurer comparable details")).not.toBeInTheDocument();
    expect(screen.queryByText("2022 Insurer Example Sedan")).not.toBeInTheDocument();
    await user.click(backControl());
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(saved.writes.map(({ step }) => step)).toEqual(["result"]);

    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes.map(({ step }) => step)).toEqual(BEFORE_MEANING);
    expect(screen.getByText(/cannot review which comparable vehicles or adjustments/iu)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Prepare my request" }));
    expect(await screen.findByTestId("request-controls")).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(saved.writes).toEqual(BEFORE_REQUEST.map((step, index) => ({ step, state: "completed", expectedWorkflowRevision: 7 + index })));
  });

  it.each(["report", "manual"] as const)("uses route history and persisted completion when %s owners go Back, Forward, or reload", async (intakeMode) => {
    const saved = installClaim(claimProjection(BEFORE_MEANING));
    const user = userEvent.setup();
    const view = renderJourney(intakeMode, "meaning");
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    await user.click(backControl());
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    await act(() => view.router.navigate(-1));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    await act(() => view.router.navigate(1));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes).toEqual([]);
    view.unmount();
    renderJourney(intakeMode, "meaning");
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
    expect(request.render).not.toHaveBeenCalled();
  });

  it.each([
    { intakeMode: "report" as const, stage: "meaning", initial: BEFORE_MEANING, failed: "what_next" as const, action: "Prepare my request", first: "report", destination: "request" },
    { intakeMode: "manual" as const, stage: "market", initial: ["result"] as TotalLossEducationStep[], failed: "valuation" as const, action: "Compare the values", first: "insurer_review", destination: "meaning" },
  ])("retains a successful first acknowledgement when the $intakeMode $stage sequence must be retried", async ({ intakeMode, stage, initial, failed, action, first, destination }) => {
    const saved = installClaim(claimProjection(initial), failed);
    const user = userEvent.setup();
    const { router } = renderJourney(intakeMode, stage);
    await screen.findByRole("button", { name: action });
    await user.click(screen.getByRole("button", { name: action }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/${stage}`);
    expect(saved.writes.map(({ step }) => step)).toEqual([first, failed]);
    expect(request.render).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/review/${destination}`));
    expect(saved.writes.map(({ step }) => step)).toEqual([first, failed, failed]);
    expect(saved.writes.map(({ expectedWorkflowRevision }) => expectedWorkflowRevision)).toEqual([7, 8, 8]);
    expect(saved.writes.every(({ state }) => state === "completed")).toBe(true);
  });

  it.each(["report", "manual"] as const)("does not acknowledge unseen stages or activate request editing from a premature %s deep link", async (intakeMode) => {
    const saved = installClaim();
    renderJourney(intakeMode, "request");
    expect(await screen.findByRole("link", { name: "Continue your review" })).toHaveAttribute("href", `${BASE}/review/result`);
    expect(request.render).not.toHaveBeenCalled();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it("shows the request-preparation state after education completes when no draft exists yet", async () => {
    const projection = claimProjection(BEFORE_REQUEST);
    installClaim({ ...projection, messageDraft: null });
    renderJourney("report", "request");
    expect(await screen.findByRole("heading", { name: "Prepare your request" })).toBeVisible();
    expect(screen.getByTestId("request-controls")).toBeVisible();
    expect(request.render).toHaveBeenCalledTimes(1);
  });

  it("preserves an old skipped compatibility marker rather than trying to rewrite it on a later manual visit", async () => {
    const projection = claimProjection(["result"]);
    const saved = installClaim({
      ...projection,
      education: {
        ...projection.education!,
        steps: {
          ...projection.education!.steps,
          insurer_review: { viewedAt: null, completedAt: null, skippedAt: NOW },
        },
      },
    });
    const user = userEvent.setup();
    renderJourney("manual", "market");
    await user.click(await screen.findByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(saved.writes).toEqual([{ step: "valuation", state: "completed", expectedWorkflowRevision: 7 }]);
    expect(saved.claim().education!.steps.insurer_review).toEqual({ viewedAt: null, completedAt: null, skippedAt: NOW });
  });

  it("keeps missing insurer rows honest and suppresses technical codes or unavailable-value placeholders", async () => {
    const projection = claimProjection(["result"]);
    const report = projection.report!;
    installClaim({
      ...projection,
      report: {
        ...report,
        subjectVehicle: { description: "Unavailable" },
        conclusion: {
          ...report.conclusion,
          classificationLabel: "POTENTIAL_UNDERVALUE",
          summary: "The completed review compares CURRENT_MARKET evidence.",
          indicatedDifference: null,
        },
        insurerEvidence: {
          ...report.insurerEvidence,
          insurerName: "Unavailable",
          comparableCount: 0,
          comparables: [],
          methodologyStatement: "DESCRIPTIVE_ONLY and NOT_DETERMINED_BY_V1",
          summary: {
            ...report.insurerEvidence.summary,
            totalCount: 0,
            partiallyDisclosedAdjustmentCount: 0,
            adjustedValues: null,
            advertisedPrices: null,
          },
        },
      },
    });
    const user = userEvent.setup();
    const { router } = renderJourney("report", "insurer");
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(screen.getByText("0 insurer comparable rows are available in the reviewed evidence.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByText("Insurer comparable details"));
    expect(screen.getByText("No insurer comparable rows were available in the reviewed report.")).toBeVisible();
    expect(screen.getByRole("region", { name: "Completed analysis" }).textContent).not.toMatch(/\bUnavailable\b|DESCRIPTIVE_ONLY|NOT_DETERMINED_BY_V1/u);
    await act(() => router.navigate(`${BASE}/review/result`));
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Completed analysis" }).textContent).not.toMatch(/\bUnavailable\b|POTENTIAL_UNDERVALUE|CURRENT_MARKET|midpoint|evidence strength|percentage difference|%/iu);
    expect(screen.queryByText("$1,444")).not.toBeInTheDocument();
  });

  it("shows a persisted customer-reported sent state without mounting the editor or claiming delivery", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({ ...projection, journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false }, workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 } });
    renderJourney("report", "sent");
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(screen.getByText(/reported.*sen|marked.*sen/iu)).toBeVisible();
    expect(screen.queryByText(/delivery confirmed|insurer received|response.*within \d/iu)).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
  });
});
