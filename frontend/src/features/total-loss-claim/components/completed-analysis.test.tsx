import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import {
  TotalLossDependenciesProvider,
  type TotalLossDependencies,
} from "@/features/total-loss/dependencies";
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
    return <><h1>{props.claim.messageDraft ? "Review and send your request" : "Prepare your request"}</h1><div data-testid="request-controls">Request controls</div></>;
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

interface InsurerResponseWrite {
  readonly clientRequestId: string;
  readonly documentId: string | null;
  readonly expectedWorkflowRevision: number;
  readonly responseText: string | null;
  readonly retainedDocumentId: string | null;
  readonly revisedOfferMinorUnits: number | null;
  readonly supersedesResponseId: string | null;
}

interface InsurerResponseUploadWrite {
  readonly byteSize: number;
  readonly clientRequestId: string;
  readonly contentDigest: string;
  readonly expectedWorkflowRevision: number;
  readonly mediaType: string;
  readonly originalFilename: string;
}

function installClaim(initialClaim = claimProjection(), failOnce?: TotalLossEducationStep, beforeSave?: () => Promise<void>) {
  let claim = initialClaim;
  let failed = false;
  const writes: EducationWrite[] = [];
  const responseWrites: InsurerResponseWrite[] = [];
  const responseUploadWrites: InsurerResponseUploadWrite[] = [];
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
    http.post(`${API}/insurer-response`, async ({ request: update }) => {
      const body = await update.json() as InsurerResponseWrite;
      responseWrites.push(body);
      const response = {
        responseId: "99999999-9999-4999-8999-999999999999",
        clientRequestId: body.clientRequestId,
        receivedAt: NOW,
        sourceType: body.documentId ? "uploaded_document" as const : "pasted_message" as const,
        text: body.responseText,
        document: body.documentId ? {
          documentId: body.documentId,
          originalFilename: "insurer-response.png",
          mediaType: "image/png" as const,
          byteSize: 11,
        } : null,
        revisedOffer: body.revisedOfferMinorUnits ? { amountMinorUnits: body.revisedOfferMinorUnits, currency: "USD" } : null,
        processingState: "not_started" as const,
        supersedesResponseId: body.supersedesResponseId,
      };
      claim = {
        ...claim,
        insurerResponse: response,
        journey: { fulfillmentState: "insurer_response_received", nextState: "insurer_response_received", retryable: false },
        workflow: { ...claim.workflow!, currentTask: "insurer_response_received", revision: claim.workflow!.revision + 1 },
      };
      return HttpResponse.json({ state: "insurer_response_received", response, workflowRevision: claim.workflow!.revision });
    }),
    http.post(`${API}/insurer-response/upload`, async ({ request: update }) => {
      const body = await update.json() as InsurerResponseUploadWrite;
      responseUploadWrites.push(body);
      return HttpResponse.json({
        documentId: body.clientRequestId,
        uploadPath: `${USER_ID}/${CASE_ID}/insurer-responses/${body.clientRequestId}.png`,
        originalFilename: body.originalFilename,
        mediaType: body.mediaType,
        byteSize: body.byteSize,
        contentDigest: body.contentDigest,
      });
    }),
  );
  return { writes, responseWrites, responseUploadWrites, draftWrites, claim: () => claim };
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
    view={`review_${stage.replaceAll("-", "_")}` as TotalLossClaimWorkflowView}
  />;
}

function renderJourney(
  intakeMode: TotalLossIntakeMode,
  initialStage = "result",
  insurerResponseStorageService?: NonNullable<TotalLossDependencies["totalLossInsurerResponseStorageService"]>,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: `${BASE}/review/:stage`, element: <JourneyHarness intakeMode={intakeMode} /> }], {
    initialEntries: [`${BASE}/review/${initialStage}`],
  });
  const dependencies = insurerResponseStorageService ? {
    totalLossInsurerResponseStorageService: insurerResponseStorageService,
  } as unknown as TotalLossDependencies : null;
  const result = render(
    <TotalLossDependenciesProvider dependencies={dependencies}>
      <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
    </TotalLossDependenciesProvider>,
  );
  return { ...result, router, queryClient };
}

function backControl() {
  return screen.queryByRole("link", { name: /^Back$/u }) ?? screen.getByRole("button", { name: /^Back$/u });
}

describe("completed-analysis guided progression", () => {
  beforeEach(() => request.render.mockClear());

  it("waits for the acknowledgement but never for animations when moving between stable review stages", async () => {
    const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    const animationFinished = new Promise<void>(() => undefined);
    const animate = vi.fn(() => ({ finished: animationFinished, cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => { release = resolve; });
    const saved = installClaim(claimProjection(), undefined, () => pendingSave);
    const user = userEvent.setup();
    const view = renderJourney("report");

    try {
      expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
      const section = screen.getByRole("region", { name: "Completed analysis" });
      const content = section.querySelector(".review-stage-content");
      expect(content).not.toBeNull();
      expect(animate).toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
      await waitFor(() => expect(saved.writes).toHaveLength(1));
      expect(screen.getByRole("button", { name: "Saving progress…" })).toBeDisabled();
      expect(screen.getByRole("heading", { name: "Your result" })).toBeVisible();
      expect(view.router.state.location.pathname).toBe(`${BASE}/review/result`);
      expect(saved.claim().education?.steps.result.completedAt).toBeNull();

      await act(async () => { release(); await pendingSave; });
      expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
      expect(saved.claim().education?.steps.result.completedAt).toBe(NOW);
      expect(view.router.state.location.pathname).toBe(`${BASE}/review/insurer`);
      expect(screen.getByRole("region", { name: "Completed analysis" })).toBe(section);
      expect(section.querySelector(".review-stage-content")).toBe(content);
      expect(section.querySelectorAll("h1")).toHaveLength(1);

      for (let repeat = 0; repeat < 2; repeat += 1) {
        await user.click(backControl());
        expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
        expect(view.router.state.location.pathname).toBe(`${BASE}/review/result`);
        expect(section.querySelectorAll("h1")).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
        expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
        expect(view.router.state.location.pathname).toBe(`${BASE}/review/insurer`);
        expect(screen.getByRole("region", { name: "Completed analysis" })).toBe(section);
        expect(section.querySelector(".review-stage-content")).toBe(content);
        expect(section.querySelectorAll("h1")).toHaveLength(1);
      }
      expect(saved.writes).toEqual([{ step: "result", state: "completed", expectedWorkflowRevision: 7 }]);
      expect(saved.draftWrites).not.toHaveBeenCalled();
    } finally {
      release();
      view.unmount();
      if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("marks Back unavailable while an acknowledgement is being saved", async () => {
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => { release = resolve; });
    installClaim(claimProjection(["result"]), undefined, () => pendingSave);
    const user = userEvent.setup();
    renderJourney("report", "insurer");

    await user.click(await screen.findByRole("button", { name: "See the market evidence" }));
    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    await act(async () => { release(); await pendingSave; });
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
  });

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
    expect(screen.getByText("Your insurer’s valuation appears low compared with the selected market listings.")).toBeVisible();
    expect(screen.getByText("$1,444 below the selected median")).toBeVisible();
    expect(screen.queryByText(/stored difference|completed evidence/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/midpoint|evidence strength|percentage difference/iu)).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
    expect(saved.writes).toEqual([]);

    await user.click(screen.getByRole("button", { name: "See how the insurer reached its value" }));
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/insurer`);
    expect(screen.getByText("Your insurer’s report includes 1 comparable vehicle.")).toBeVisible();
    expect(screen.getByText("The advertised-price median was $19,800. After the report’s adjustments, the median was $19,500.")).toBeVisible();
    expect(screen.getByText(/Some adjustment details were only partially disclosed/u)).toBeVisible();
    expect(screen.queryByText(/available for 0|not provided for 0|0 comparables/u)).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Insurer comparables" })).not.toBeVisible();
    await user.click(screen.getByText("Insurer comparable details"));
    expect(screen.getByRole("table", { name: "Insurer comparables" })).toBeVisible();
    expect(screen.getByText("-$500")).toBeVisible();
    expect(request.render).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "See the market evidence" }));
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/market`);
    await user.click(screen.getByText("See selected market listings"));
    const marketTable = screen.getByRole("table", { name: "Selected market listings" });
    expect(within(marketTable).getByText("Example Motors")).toBeVisible();
    expect(within(marketTable).getByText("Chicago, IL")).toBeVisible();
    expect(within(marketTable).getByText("12.5 mi")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Compare the values" }));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(screen.getByText("Your insurer’s valuation is below the selected advertised-price range. Even the lowest listing used for this comparison, at $19,800, was $754 higher.")).toBeVisible();
    expect(screen.getByText("The valuation is $1,444 below the selected median of $20,490.")).toBeVisible();
    expect(screen.getByText("This comparison does not add dollar adjustments for differences in condition.")).toBeVisible();
    expect(screen.queryByText("Your insurer’s valuation appears low compared with the selected market listings.")).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
    expect(screen.queryByText("The full package records additional provider coverage limitations.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review my request" }));
    expect(await screen.findByTestId("request-controls")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(saved.writes).toEqual(BEFORE_REQUEST.map((step, index) => ({ step, state: "completed", expectedWorkflowRevision: 7 + index })));
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it("omits insurer education for manual owners and completes its compatibility marker only when leaving Market", async () => {
    const saved = installClaim();
    const user = userEvent.setup();
    const { router } = renderJourney("manual");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText("Insurer offer you entered")).toBeVisible();
    expect(screen.getByText("Offer")).toBeVisible();
    expect(screen.getByText("The offer you entered appears low compared with the selected market listings.")).toBeVisible();
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
    expect(screen.getByText("The offer you entered is below the selected advertised-price range. Even the lowest listing used for this comparison, at $19,800, was $754 higher.")).toBeVisible();
    expect(screen.getByText("The offer is $1,444 below the selected median of $20,490.")).toBeVisible();
    expect(screen.queryByText(/Your insurer valued|Your insurer’s valuation is below/u)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot review which comparable vehicles or adjustments/iu)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Review my request" }));
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
    { intakeMode: "report" as const, stage: "meaning", initial: BEFORE_MEANING, failed: "what_next" as const, action: "Review my request", first: "report", destination: "request" },
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
    expect(request.render).toHaveBeenLastCalledWith(expect.objectContaining({
      actionContainer: screen.getByRole("navigation", { name: "Review navigation" }),
    }));
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
    expect(screen.getByText("No insurer comparables were available in the report for this review.")).toBeVisible();
    expect(screen.queryByText(/\b0 (?:insurer|comparable)|available for 0|not provided for 0/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByText("Insurer comparable details"));
    expect(screen.getByText("No insurer comparables were available in the report.")).toBeVisible();
    expect(screen.getByRole("region", { name: "Completed analysis" }).textContent).not.toMatch(/\bUnavailable\b|DESCRIPTIVE_ONLY|NOT_DETERMINED_BY_V1/u);
    await act(() => router.navigate(`${BASE}/review/result`));
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Completed analysis" }).textContent).not.toMatch(/\bUnavailable\b|POTENTIAL_UNDERVALUE|CURRENT_MARKET|midpoint|evidence strength|percentage difference|%/iu);
    expect(screen.queryByText("$1,444")).not.toBeInTheDocument();
  });

  it("shows a persisted customer-reported sent state without mounting the editor or claiming delivery", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({ ...projection, journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false }, workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 } });
    renderJourney("report", "waiting");
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(screen.getByText("Case active")).toBeVisible();
    expect(screen.getByText(/Based on your confirmation.*recorded.*sent/iu)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute(
      "aria-valuetext",
      "Current stage: Waiting for insurer. Case active.",
    );
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute("aria-valuenow", "6.5");
    expect(screen.getByText(/does not monitor.*cannot verify delivery, receipt, or detect a response automatically/iu)).toBeVisible();
    expect(screen.getByText(/return to this case.*I received a response/iu)).toBeVisible();
    expect(screen.queryByText(/delivery confirmed|insurer received|response.*within \d/iu)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I received a response" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /offer|negotiat|close/iu })).not.toBeInTheDocument();
    expect(request.render).not.toHaveBeenCalled();
  });

  it("records an offer-only insurer response once and advances to the saved received state", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    const installed = installClaim({
      ...projection,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    });
    renderJourney("report", "waiting");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "I received a response" }));
    expect(await screen.findByRole("heading", { name: "Add the insurer’s response" })).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: /^Revised offer/iu }), "21125.50");
    const save = screen.getByRole("button", { name: "Save response" });
    await Promise.all([user.click(save), user.click(save)]);

    expect(await screen.findByRole("heading", { name: "The insurer’s response is saved" })).toBeVisible();
    expect(installed.responseWrites).toHaveLength(1);
    expect(installed.responseWrites[0]).toMatchObject({
      documentId: null,
      expectedWorkflowRevision: 13,
      responseText: null,
      retainedDocumentId: null,
      revisedOfferMinorUnits: 2_112_550,
      supersedesResponseId: null,
    });
    expect(screen.getByText("$21,125.50")).toBeVisible();
    expect(screen.getByText(/has not analyzed it/iu)).toBeVisible();
    expect(screen.getByRole("region", { name: "Valuation report" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Correct this response" }));
    expect(await screen.findByText("Correct saved response")).toBeVisible();
    const pasted = screen.getByRole("textbox", { name: /^Paste the response/iu });
    await user.type(pasted, "  Exact corrected reply.\n");
    await user.click(screen.getByRole("button", { name: "Save corrected response" }));

    expect(await screen.findByRole("heading", { name: "The insurer’s response is saved" })).toBeVisible();
    expect(installed.responseWrites).toHaveLength(2);
    expect(installed.responseWrites[1]).toMatchObject({
      responseText: "  Exact corrected reply.\n",
      revisedOfferMinorUnits: 2_112_550,
      supersedesResponseId: "99999999-9999-4999-8999-999999999999",
    });
    expect(installed.responseWrites[1].clientRequestId).not.toBe(installed.responseWrites[0].clientRequestId);
  });

  it("prepares, privately uploads, and records an original response file", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    const installed = installClaim({
      ...projection,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    });
    const uploadPreparedResponse = vi.fn(async () => undefined);
    renderJourney("report", "waiting", { uploadPreparedResponse });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "I received a response" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
      "insurer-response.png",
      { type: "image/png" },
    );
    await user.upload(fileInput!, file);
    expect(await screen.findByText("insurer-response.png")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save response" }));

    expect(await screen.findByRole("heading", { name: "The insurer’s response is saved" })).toBeVisible();
    expect(installed.responseUploadWrites).toHaveLength(1);
    expect(installed.responseUploadWrites[0]).toMatchObject({
      byteSize: file.size,
      expectedWorkflowRevision: 13,
      mediaType: "image/png",
      originalFilename: file.name,
    });
    expect(installed.responseUploadWrites[0].contentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(uploadPreparedResponse).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      clientRequestId: installed.responseUploadWrites[0].clientRequestId,
      file,
      preparation: expect.objectContaining({
        documentId: installed.responseUploadWrites[0].clientRequestId,
      }),
    }));
    expect(installed.responseWrites).toHaveLength(1);
    expect(installed.responseWrites[0]).toMatchObject({
      documentId: installed.responseUploadWrites[0].clientRequestId,
      responseText: null,
      retainedDocumentId: null,
      revisedOfferMinorUnits: null,
    });
  });

  it("returns a customer reviewing Meaning after sending to the saved request status", async () => {
    const projection = claimProjection([...BEFORE_REQUEST, "send"]);
    installClaim({
      ...projection,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    });
    const user = userEvent.setup();
    const { router } = renderJourney("report", "meaning");

    expect(await screen.findByRole("button", { name: "Return to case status" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Prepare my request" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return to case status" }));
    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/waiting`);
  });

  it("keeps the review frame mounted when a saved sent state replaces the request and redirects its URL", async () => {
    const saved = installClaim(claimProjection(BEFORE_REQUEST));
    const view = renderJourney("report", "request");
    expect(await screen.findByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Waiting for the insurer’s response" })).not.toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Completed analysis" });
    const content = section.querySelector(".review-stage-content");
    expect(content).not.toBeNull();

    const sent = claimProjection([...BEFORE_REQUEST, "send"]);
    server.use(http.get(`${API}/claim`, () => HttpResponse.json({
      ...sent,
      journey: { fulfillmentState: "awaiting_insurer_response", nextState: "awaiting_insurer_response", retryable: false },
      workflow: { currentTask: "awaiting_insurer_response", phase: "initial_request", revision: 13 },
    })));
    await act(() => view.queryClient.refetchQueries({ type: "active" }));

    expect(await screen.findByRole("heading", { name: "Waiting for the insurer’s response" })).toBeVisible();
    await waitFor(() => expect(view.router.state.location.pathname).toBe(`${BASE}/review/waiting`));
    expect(screen.getByRole("region", { name: "Completed analysis" })).toBe(section);
    expect(section.querySelector(".review-stage-content")).toBe(content);
    expect(section.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.queryByTestId("request-controls")).not.toBeInTheDocument();
    expect(screen.queryByText(/delivery confirmed|insurer received/u)).not.toBeInTheDocument();
    expect(saved.writes).toEqual([]);
    expect(saved.draftWrites).not.toHaveBeenCalled();
  });

  it("does not show sent confirmation from the URL without a saved sent state", async () => {
    const projection = claimProjection(BEFORE_REQUEST);
    installClaim({ ...projection, journey: { ...projection.journey!, nextState: "prepare_request" } });
    const { router } = renderJourney("report", "waiting");
    expect(await screen.findByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/request`);
    expect(screen.queryByRole("heading", { name: "Waiting for the insurer’s response" })).not.toBeInTheDocument();
  });

  it("explains current listing timing once without treating a historical query date as available historical listings", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      marketEvidence: {
        ...report.marketEvidence,
        primary: {
          ...report.marketEvidence.primary!,
          label: "Primary current market evidence",
          description: "Current listings form the primary external evidence set selected by Phase 3D; they are not labeled as loss-date observations.",
        },
        evidenceDateContext: { ...report.marketEvidence.evidenceDateContext, historicalEvidenceDate: "2026-08-01" },
      },
    } });
    renderJourney("report", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByText(/^Venfour selected 1 current listing for /u)).toBeVisible();
    expect(screen.getByText("This listing was collected on Aug 28, 2026. It shows the market when collected, not necessarily on the date of loss.")).toBeVisible();
    expect(screen.queryByText(/verified as active|historical evidence (?:was|is) unavailable|limited historical coverage/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence used for the comparison|Current advertised-price evidence/u)).not.toBeInTheDocument();
    expect(screen.getByText(/Current listings form the primary external evidence set selected by Phase 3D/u)).not.toBeVisible();
  });

  it("keeps historical comparison prices separate from additional current listings", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, supportedRange: { ...report.conclusion.supportedRange!, evidenceBasis: "Historical advertised-price evidence from around the loss date" } },
      marketEvidence: {
        ...report.marketEvidence,
        comparables: [
          ...["$19,800", "$20,490", "$22,263"].map((advertisedPrice) => ({ ...report.marketEvidence.comparables[0], advertisedPrice, evidenceDate: "2026-08-01", temporalBasis: "Verified active on the evidence date from stored lifecycle records" })),
          { ...report.marketEvidence.comparables[0], role: "SECONDARY", advertisedPrice: "$25,000" },
        ],
        primary: { ...report.marketEvidence.primary!, label: "Primary loss-date historical evidence", description: "Resolved listings active on the loss date form the primary external evidence set selected by Phase 3D.", selectedCount: 3, evidenceDate: "2026-08-01" },
        secondary: { ...report.marketEvidence.primary!, label: "Secondary current market evidence", description: "Current evidence is retained as secondary context and is not combined with the primary loss-date historical price set." },
        evidenceDateContext: { ...report.marketEvidence.evidenceDateContext, historicalEvidenceDate: "2026-08-01" },
      },
    } });
    renderJourney("report", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByText("Venfour selected 3 historical listings for similar vehicles.")).toBeVisible();
    expect(screen.getByText("$19,800 to $22,263")).toBeVisible();
    expect(screen.getByText("These listings were verified as active on Aug 1, 2026, the date used for this comparison.")).toBeVisible();
    expect(screen.getByText("A further 1 current listing provides additional context from Aug 28, 2026. It is not included in the range above. Current listings do not establish prices on the date of loss.")).toBeVisible();
    expect(screen.queryByText(/selected 4|3 current listings|additional historical/u)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("See selected market listings"));
    expect(screen.getByRole("table", { name: "Selected market listings" })).toBeVisible();
    expect(screen.getByText("$25,000")).toBeVisible();
  });

  it("uses neutral timing when the paid evidence labels do not identify a current or historical group", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, supportedRange: { ...report.conclusion.supportedRange!, evidenceBasis: null } },
      marketEvidence: { ...report.marketEvidence, primary: { ...report.marketEvidence.primary!, label: null, description: null, evidenceDate: null } },
    } });
    renderJourney("manual", "market");
    expect(await screen.findByRole("heading", { name: "What the market evidence showed" })).toBeVisible();
    expect(screen.getByText(/^Venfour selected 1 listing for /u)).toBeVisible();
    expect(screen.getByText("The listing details explain when each price was observed.")).toBeVisible();
    expect(screen.queryByText(/listing was collected on|verified as active|insurer’s comparable vehicles|insurer’s adjustments/u)).not.toBeInTheDocument();
  });

  it.each([
    { insurer: 2300000, insurerLabel: "$23,000", difference: -251000, differenceLabel: "-$2,510", result: "$2,510 above the selected median", meaning: "The valuation is $2,510 above the selected median of $20,490.", position: "above" },
    { insurer: 2049000, insurerLabel: "$20,490", difference: 0, differenceLabel: "$0", result: "Matches the selected median", meaning: "The valuation matches the selected median of $20,490.", position: "within" },
  ])("describes the signed median comparison and $position range position without implying an increase", async ({ insurer, insurerLabel, difference, differenceLabel, result, meaning, position }) => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    const saved = installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, continuingSupported: false, classificationLabel: "No material discrepancy identified", insurerValuation: money(insurer, insurerLabel), indicatedDifference: money(difference, differenceLabel) },
    } });
    const { router } = renderJourney("report", "result");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.getByText(result)).toBeVisible();
    expect(screen.queryByText(/appears low/u)).not.toBeInTheDocument();
    await act(() => router.navigate(`${BASE}/review/meaning`));
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(screen.getByText(meaning)).toBeVisible();
    expect(screen.getByText(`Your insurer’s valuation is ${position} the selected advertised-price range.`)).toBeVisible();
    expect(screen.queryByText(/Even the lowest listing|reasonable basis to ask/u)).not.toBeInTheDocument();
    expect(saved.writes).toEqual([]);
  });

  it.each([
    ["report", 4],
    ["manual", 3],
  ] as const)("ends an unsupported %s review at its final education step", async (intakeMode, total) => {
    const projection = claimProjection(BEFORE_REQUEST);
    const report = projection.report!;
    installClaim({
      ...projection,
      journey: { fulfillmentState: "no_dispute", nextState: "no_dispute", retryable: false },
      report: {
        ...report,
        conclusion: {
          ...report.conclusion,
          classificationLabel: "No material discrepancy identified",
          continuingSupported: false,
        },
      },
    });
    const { router } = renderJourney(intakeMode, "request");

    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`${BASE}/review/meaning`);
    expect(screen.getByRole("progressbar", { name: "Case journey" })).toHaveAttribute("aria-valuetext", `Step ${total} of ${total}: Understand comparison`);
    expect(screen.queryByText(report.suggestedFilename)).not.toBeInTheDocument();
    expect(screen.getByText("PDF report · Issued Aug 29, 2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: /request/iu })).not.toBeInTheDocument();
  });

  it("omits monetary comparisons when the insurer value is missing or currencies differ", async () => {
    const projection = claimProjection(BEFORE_MEANING);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, continuingSupported: false, classificationLabel: "Insufficient evidence", insurerValuation: { amountMinorUnits: null, currency: "USD", formatted: "Unavailable" }, indicatedDifference: null, supportedRange: null },
    } });
    const view = renderJourney("manual", "result");
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
    expect(screen.queryByText(/Not stated|Unavailable|selected median|Selected advertised-price range/u)).not.toBeInTheDocument();
    view.unmount();
    installClaim({ ...projection, report: {
      ...report,
      conclusion: { ...report.conclusion, insurerValuation: { ...report.conclusion.insurerValuation, currency: "CAD" } },
    } });
    renderJourney("manual", "meaning");
    expect(await screen.findByRole("heading", { name: "What the comparison means" })).toBeVisible();
    expect(screen.queryByText(/Even the lowest listing|The offer is .*selected median|offer you entered is below/u)).not.toBeInTheDocument();
  });

  it("does not describe medians from different insurer subsets as a before-and-after adjustment", async () => {
    const projection = claimProjection(["result"]);
    const report = projection.report!;
    installClaim({ ...projection, report: {
      ...report,
      insurerEvidence: {
        ...report.insurerEvidence,
        comparableCount: 2,
        summary: { ...report.insurerEvidence.summary, totalCount: 2, adjustedValueMissingCount: 1, advertisedPrices: { ...report.insurerEvidence.summary.advertisedPrices!, count: 2 } },
      },
    } });
    renderJourney("report", "insurer");
    expect(await screen.findByRole("heading", { name: "How your insurer reached its value" })).toBeVisible();
    expect(screen.getByText("Your insurer’s report includes 2 comparable vehicles.")).toBeVisible();
    expect(screen.getByText("The disclosed advertised prices had a median of $19,800. The disclosed adjusted values had a median of $19,500.")).toBeVisible();
    expect(screen.queryByText(/After the report’s adjustments/u)).not.toBeInTheDocument();
  });
});
