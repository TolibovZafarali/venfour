import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type {
  AnalysisPresentation,
  AnalysisPresentationBase,
  Assessment,
} from "@/features/analyses/analysis-presentation.generated";
import {
  TotalLossAnalysisProgress,
  TotalLossAnalysisResult,
} from "@/features/analyses/components/total-loss-analysis-experience";
import { materialUndervalueAnalysis } from "@/test/fixtures/analysis-presentation";

vi.mock("./valuation-signal-field", () => ({
  ValuationSignalField: () => <canvas aria-hidden="true" />,
}));

function analysisFor(
  classification: Assessment["classification"],
): AnalysisPresentation {
  return {
    ...materialUndervalueAnalysis,
    assessment: {
      ...materialUndervalueAnalysis.assessment,
      classification,
    },
  } as AnalysisPresentation;
}

function manualAnalysisWithoutOffer(): AnalysisPresentationBase {
  const analysis: AnalysisPresentationBase = structuredClone(
    analysisFor("INSUFFICIENT_EVIDENCE"),
  );
  analysis.analysisScope = {
    ...analysis.analysisScope,
    inputMode: "MANUAL",
    reportAvailable: false,
    insurerValuationAvailable: false,
    insurerValuationComparisonPerformed: false,
    offerComparisonPerformed: false,
  };
  analysis.insurerValuation = {
    ...analysis.insurerValuation,
    source: "NONE",
    value: { cents: null, display: null },
    comparisonToPrimaryEvidence: null,
  };
  analysis.findings = [{
    code: "MISSING_CCC_VEHICLE_VALUATION",
    label: "Insurer valuation or offer unavailable",
    description: "No insurer valuation or stated offer is available.",
  }];
  return analysis;
}

describe("total-loss analysis experience", () => {
  it("presents an open loading state without invented stages or a progress percentage", () => {
    const { container } = render(<TotalLossAnalysisProgress />);
    expect(screen.getByRole("region", {name: "We’re reviewing your vehicle."})).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Valuation review")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(container.querySelector("[data-valuation-status]")).not.toHaveClass("border");
  });

  it.each([
    {
      classification: "MATERIAL_UNDERVALUE_SIGNAL" as const,
      heading: "Your insurer’s valuation may be too low.",
      worthwhile: "This looks worth pursuing.",
      continueVisible: true,
    },
    {
      classification: "POTENTIAL_UNDERVALUE" as const,
      heading: "Your insurer’s valuation may be too low.",
      worthwhile: "This looks worth pursuing.",
      continueVisible: true,
    },
    {
      classification: "NO_MATERIAL_DISCREPANCY" as const,
      heading: "Your insurer’s valuation appears fair.",
      worthwhile: "There may be little to pursue here.",
      continueVisible: false,
    },
    {
      classification: "CONFLICTING_EVIDENCE" as const,
      heading: "The picture isn’t clear yet.",
      worthwhile: "It’s too soon to say.",
      continueVisible: false,
    },
    {
      classification: "INSUFFICIENT_EVIDENCE" as const,
      heading: "We need more information to be sure.",
      worthwhile: "More evidence is needed.",
      continueVisible: false,
    },
  ])(
    "maps $classification to its deterministic result",
    ({ classification, continueVisible, heading, worthwhile }) => {
      render(<TotalLossAnalysisResult analysis={analysisFor(classification)} />);

      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      expect(screen.getByRole("heading", { name: worthwhile })).toBeVisible();
      if (continueVisible) {
        expect(
          screen.getByRole("button", { name: "Continue my review" }),
        ).toHaveAttribute("type", "button");
      } else {
        expect(
          screen.queryByRole("button", { name: "Continue my review" }),
        ).not.toBeInTheDocument();
      }
      expect(
        screen.queryByRole("link", { name: "Review your details" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps intake correction secondary to the existing continuation action", () => {
    const reviewIntakePath =
      "/start?service=total-loss&caseId=saved-case&intent=correct-intake";
    render(
      <MemoryRouter>
        <TotalLossAnalysisResult
          analysis={materialUndervalueAnalysis}
          reviewIntakePath={reviewIntakePath}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Continue my review" }),
    ).toHaveAttribute("data-variant", "default");
    expect(screen.getByRole("link", { name: "Review your details" })).toHaveAttribute(
      "href",
      reviewIntakePath,
    );
    expect(screen.getByRole("link", { name: "Review your details" })).toHaveAttribute(
      "data-variant",
      "link",
    );
  });

  it("shows the saved range and insurer valuation without technical detail or changing the action", async () => {
    const user = userEvent.setup();
    const analysis = structuredClone(materialUndervalueAnalysis);
    render(<TotalLossAnalysisResult analysis={analysis} />);

    expect(
      screen.getByRole("region", { name: "Estimated market range" }),
    ).toHaveTextContent("$21,800–$22,600");
    expect(
      screen.getByRole("figure", {
        name: "Insurer’s valuation: $20,000. Estimated market range: $21,800 to $22,600.",
      }),
    ).toBeVisible();
    expect(screen.queryByText("$22,200")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /Evidence median|Evidence strength|Evidence-supported market range/u,
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(analysis.assessment.summary)).not.toBeInTheDocument();
    expect(
      screen.getByText(/does not determine what your insurer owes/u),
    ).toBeVisible();
    const continueButton = screen.getByRole("button", {
      name: "Continue my review",
    });
    await user.click(continueButton);
    expect(continueButton).toBeVisible();
    expect(analysis).toEqual(materialUndervalueAnalysis);
  });

  it("uses a truthful unavailable state when no primary range exists", () => {
    const analysis = {
      ...analysisFor("INSUFFICIENT_EVIDENCE"),
      primaryExternalEvidence: null,
    } as AnalysisPresentation;

    render(<TotalLossAnalysisResult analysis={analysis} />);

    expect(screen.getByRole("heading", { name: "We need more information to be sure." })).toBeVisible();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByText("$20,000")).toBeVisible();
    expect(screen.getByText("We couldn’t find enough reliable market evidence to assess your insurer’s valuation.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Estimated market range" })).not.toBeInTheDocument();
  });

  it.each([true, false])(
    "does not claim undervaluation without an insurer value (range available: %s)",
    (rangeAvailable) => {
      const analysis: AnalysisPresentationBase = structuredClone(
        analysisFor("INSUFFICIENT_EVIDENCE"),
      );
      analysis.analysisScope.insurerValuationAvailable = false;
      analysis.insurerValuation = {
        ...analysis.insurerValuation,
        source: "NONE",
        value: { cents: null, display: null },
        comparisonToPrimaryEvidence: null,
      };
      if (!rangeAvailable) analysis.primaryExternalEvidence = null;

      render(
        <TotalLossAnalysisResult analysis={analysis as AnalysisPresentation} />,
      );

      expect(
        screen.getByRole("heading", {
          name: rangeAvailable
            ? "Here’s what we found for your vehicle."
            : "We need more information to be sure.",
        }),
      ).toBeVisible();
      expect(screen.queryByRole("figure")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Continue my review" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          /valuation is right or wrong|assess your insurer’s valuation/u,
        ),
      ).not.toBeInTheDocument();
    },
  );

  it("distinguishes a customer-entered offer from an insurer report valuation", () => {
    const analysis: AnalysisPresentationBase = structuredClone(
      materialUndervalueAnalysis,
    );
    analysis.insurerValuation.source = "CUSTOMER_ENTERED";
    analysis.primaryExternalEvidence!.evidenceBasis = "CURRENT_MARKET";

    render(<TotalLossAnalysisResult analysis={analysis as AnalysisPresentation} />);

    expect(
      screen.getByRole("figure", { name: /^Insurer’s offer: \$20,000/u }),
    ).toBeVisible();
    expect(screen.getByText("Based on current advertised prices.")).toBeVisible();
    expect(screen.queryByText("Insurer’s valuation")).not.toBeInTheDocument();
  });

  it("offers intake correction when the missing manual offer alone blocks comparison", () => {
    const correctionPath = "/start?service=total-loss&caseId=saved-case&intent=correct-intake&focus=insurer-offer";
    const reviewIntakePath =
      "/start?service=total-loss&caseId=saved-case&intent=correct-intake";
    render(
      <MemoryRouter>
        <TotalLossAnalysisResult
          analysis={manualAnalysisWithoutOffer() as AnalysisPresentation}
          addInsurerOfferPath={correctionPath}
          reviewIntakePath={reviewIntakePath}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Your insurer’s offer completes the picture." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Add insurer offer" })).toHaveAttribute(
      "href",
      correctionPath,
    );
    expect(screen.getByRole("link", { name: "Review your details" })).toHaveAttribute(
      "href",
      reviewIntakePath,
    );
    expect(screen.queryByRole("button", { name: "Continue my review" })).not.toBeInTheDocument();
  });

  it.each([
    "report intake",
    "existing offer",
    "missing market range",
    "unavailable market evidence",
    "insufficient independent evidence",
    "zero market median",
    "missing authoritative reason",
    "unrelated classification",
  ])("does not offer missing-offer recovery for %s", (scenario) => {
    const analysis = manualAnalysisWithoutOffer();
    if (scenario === "report intake") {
      analysis.analysisScope.inputMode = "REPORT";
      analysis.analysisScope.reportAvailable = true;
    } else if (scenario === "existing offer") {
      analysis.analysisScope.insurerValuationAvailable = true;
      analysis.insurerValuation.source = "CUSTOMER_ENTERED";
      analysis.insurerValuation.value = { cents: 2_000_000, display: "$20,000.00" };
    } else if (scenario === "missing market range") {
      analysis.primaryExternalEvidence = null;
    } else if (scenario === "unavailable market evidence") {
      analysis.analysisScope.marketEvidenceAvailable = false;
    } else if (scenario === "insufficient independent evidence" || scenario === "zero market median") {
      analysis.findings.push({
        code: scenario === "insufficient independent evidence"
          ? "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE"
          : "EXTERNAL_MEDIAN_ZERO",
        label: "External evidence is not sufficient",
        description: "The available market evidence cannot support a comparison.",
      });
    } else if (scenario === "missing authoritative reason") {
      analysis.findings = [];
    } else {
      analysis.assessment.classification = "CONFLICTING_EVIDENCE";
    }

    render(
      <MemoryRouter>
        <TotalLossAnalysisResult
          analysis={analysis as AnalysisPresentation}
          addInsurerOfferPath="/start?service=total-loss&caseId=saved-case&intent=correct-intake&focus=insurer-offer"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Add insurer offer" })).not.toBeInTheDocument();
  });

  it("does not invent an intake destination without the saved case context", () => {
    render(
      <TotalLossAnalysisResult analysis={manualAnalysisWithoutOffer() as AnalysisPresentation} />,
    );

    expect(screen.queryByRole("link", { name: "Add insurer offer" })).not.toBeInTheDocument();
  });

  it.each([
    { offer: 0, minimum: 21800, maximum: 22600, position: "below" },
    { offer: 22200, minimum: 21800, maximum: 22600, position: "within" },
    { offer: 25000, minimum: 21800, maximum: 22600, position: "above" },
    { offer: 22200, minimum: 22200, maximum: 22200, position: "equal" },
  ])(
    "plots an offer $position the range without changing the backend verdict",
    ({ offer, minimum, maximum, position }) => {
      const analysis: AnalysisPresentationBase = structuredClone(
        analysisFor("NO_MATERIAL_DISCREPANCY"),
      );
      const money = (dollars: number) => ({
        cents: dollars * 100,
        display: `$${dollars.toLocaleString("en-US")}.00`,
      });
      analysis.insurerValuation.value = money(offer);
      analysis.primaryExternalEvidence!.prices.minimumPrice = money(minimum);
      analysis.primaryExternalEvidence!.prices.maximumPrice = money(maximum);

      render(
        <TotalLossAnalysisResult analysis={analysis as AnalysisPresentation} />,
      );

      const figure = screen.getByRole("figure");
      const band = figure.querySelector<HTMLDivElement>("div[style]")!;
      const marker = figure.querySelector<HTMLSpanElement>("span[style]")!;
      const markerPosition = parseFloat(marker.style.left);
      const rangeStart = parseFloat(band.style.left);
      const rangeEnd = rangeStart + parseFloat(band.style.width);
      if (position === "below") expect(markerPosition).toBeLessThan(rangeStart);
      if (position === "within") {
        expect(markerPosition).toBeGreaterThan(rangeStart);
        expect(markerPosition).toBeLessThan(rangeEnd);
      }
      if (position === "above") expect(markerPosition).toBeGreaterThan(rangeEnd);
      if (position === "equal") expect(markerPosition).toBe(rangeStart);
      expect(Number.isFinite(markerPosition)).toBe(true);
      expect(
        screen.getByRole("heading", {
          name: "Your insurer’s valuation appears fair.",
        }),
      ).toBeVisible();
    },
  );
});

describe("inconclusive free-result recovery", () => {
  it("keeps saved information and review limits accessible in the compact dialog", async () => {
    const user = userEvent.setup();
    render(<TotalLossAnalysisResult analysis={analysisFor("INSUFFICIENT_EVIDENCE")} />);
    const trigger = screen.getByRole("button", { name: "Case details & review notes" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Case details" });
    expect(within(dialog).getByText("Saved to your case")).toBeVisible();
    expect(within(dialog).getByText(/This review does not determine what your insurer owes/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Close case details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("asks one question inline and saves only the confirmed fact", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn().mockResolvedValue(undefined);
    const analysis = { ...analysisFor("INSUFFICIENT_EVIDENCE"), marketSearchContext: {
      baselineStatus: "LIMITED", summary: "Limited evidence", stopReasons: [],
      recovery: { kind: "UNRESOLVED_CONFIGURATION", field: "drivetrain", correctionStep: "vehicle", message: "Confirm your vehicle’s drive type. Your report is saved." },
    } } as AnalysisPresentation;
    render(<MemoryRouter><TotalLossAnalysisResult analysis={analysis} reviewIntakePath="/start?caseId=saved" insurerReportPath="/report" onConfirmVehicleFact={confirm} /></MemoryRouter>);
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    await user.click(screen.getByRole("radio", { name: "Front-wheel drive (FWD)" }));
    expect(screen.getByRole("radio", { name: "Front-wheel drive (FWD)" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save and check again" }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith("drivetrain", "FWD");
    expect(screen.queryByText(/Upload insurer/)).not.toBeInTheDocument();
  });
  it("rechecks a saved extraction before requesting vehicle facts again", () => {
    const analysis = { ...analysisFor("INSUFFICIENT_EVIDENCE"), marketSearchContext: {
      baselineStatus: "LIMITED", summary: "Limited evidence", stopReasons: [],
      recovery: { kind: "UNRESOLVED_CONFIGURATION", field: "engine", correctionStep: null, message: "Your report is saved. We need to recheck its specifications." },
    } } as AnalysisPresentation;
    render(<MemoryRouter><TotalLossAnalysisResult analysis={analysis} reviewIntakePath="/start?caseId=saved" insurerReportPath="/report" /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Review your saved report." })).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Confirm engine" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review saved report" })).toBeVisible();
  });
  it("asks for the specific detail identified by the backend", () => {
    const analysis = { ...analysisFor("INSUFFICIENT_EVIDENCE"), marketSearchContext: {
      baselineStatus: "LIMITED", summary: "Limited evidence", stopReasons: [],
      recovery: { kind: "UNRESOLVED_CONFIGURATION", field: "engine", correctionStep: "vehicle", message: "Confirm the engine shown in your vehicle documents." },
    } } as AnalysisPresentation;
    render(<MemoryRouter><TotalLossAnalysisResult analysis={analysis} reviewIntakePath="/start?caseId=saved&intent=correct-intake" insurerReportPath="/total-loss/cases/saved/review-report" /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Confirm vehicle detail" })).not.toBeInTheDocument();
    expect(screen.getByText(/Confirm the engine/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Confirm engine" })).toHaveAttribute("href", "/start?caseId=saved&intent=correct-intake&focus=vehicle&vehicleFact=engine");
    expect(screen.getByRole("link", { name: "Review saved report" })).toHaveAttribute("href", "/total-loss/cases/saved/review-report");
    expect(screen.queryByRole("link", { name: "Review your details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /checkout|pay now/i })).not.toBeInTheDocument();
  });
  it.each(["SPARSE_EVIDENCE", "SEARCH_INTERRUPTED"] as const)("explains %s without asking for irrelevant intake edits", kind => {
    const analysis = { ...analysisFor("INSUFFICIENT_EVIDENCE"), marketSearchContext: { baselineStatus: "LIMITED", summary: "Limited evidence", stopReasons: [], recovery: { kind, field: null, correctionStep: null, message: "A reliable estimate could not be established. This does not tell us whether the offer is fair." } } } as AnalysisPresentation;
    render(<MemoryRouter><TotalLossAnalysisResult analysis={analysis} reviewIntakePath="/start?caseId=saved" insurerReportPath="/total-loss/cases/saved/review-report" /></MemoryRouter>);
    expect(screen.getByText(/A reliable estimate could not be established/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Review saved report" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Review your details" })).not.toBeInTheDocument();
  });
  it("allows the insurer-report next step on a saved result without recovery metadata", () => {
    render(<MemoryRouter><TotalLossAnalysisResult analysis={analysisFor("INSUFFICIENT_EVIDENCE")} insurerReportPath="/total-loss/cases/saved/review-report" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Review saved report" })).toBeVisible();
  });
});

describe("versioned preliminary results", () => {
  const reportPath = "/total-loss/cases/saved-case/review-report";
  const contextListings = [
    { identity: "captured-jefferson-city", year: 2026, make: "Hyundai", model: "Kona", trim: "SE", askingPriceCents: 2_307_700, mileage: 14_725, distanceMiles: 103.21, certified: true, source: "MARKETCHECK", listingUrl: null, limitations: ["Certification differs or is unresolved."] },
    { identity: "captured-danville", year: 2026, make: "Hyundai", model: "Kona", trim: "SE", askingPriceCents: 2_533_300, mileage: 18_812, distanceMiles: 183.53, certified: null, source: "MARKETCHECK", listingUrl: null, limitations: ["Mileage differences limit comparability."] },
  ];

  function preliminaryAnalysis(overrides: Partial<NonNullable<AnalysisPresentation["preliminaryResult"]>> = {}): AnalysisPresentation {
    return {
      ...analysisFor("NO_MATERIAL_DISCREPANCY"),
      presentationVersion: "8",
      preliminaryResult: {
        version: "1",
        outcome: "LISTING_CONTEXT",
        evidenceBasis: "CURRENT_MARKET",
        evidenceDate: "2026-09-14",
        sampleSize: 2,
        estimatedRange: null,
        listingPriceSpan: { lowCents: 2_307_700, highCents: 2_533_300 },
        listings: contextListings,
        limitations: ["These vehicles have substantially more miles than yours.", "One listing is certified; a certification premium has not been adjusted."],
        reasonCodes: ["CERTIFIED_PREMIUM_UNKNOWN", "WEAK_MATCH"],
        insurerComparison: null,
        ...overrides,
      },
    } as AnalysisPresentation;
  }

  function show(analysis: AnalysisPresentation) {
    return render(<MemoryRouter><TotalLossAnalysisResult
      analysis={analysis}
      insurerReportPath={reportPath}
      addInsurerOfferPath="/start?focus=insurer-offer"
      reviewIntakePath="/start?intent=correct-intake"
      continueAction={<button>Pay for review</button>}
    /></MemoryRouter>);
  }

  it("shows asking-price context without translating the strict verdict into a vehicle value or fairness claim", async () => {
    const analysis = preliminaryAnalysis();
    const saved = structuredClone(analysis);
    const { container } = show(analysis);
    expect(screen.getByRole("heading", { name: "Comparable listing prices" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Observed asking-price span" })).toHaveTextContent("$23,077–$25,333");
    expect(screen.getByText(/not a valuation of your vehicle/)).toBeVisible();
    expect(screen.getByText(/certification premium has not been adjusted/)).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("Evidence details · 2 limitations"));
    expect(screen.getByText(/2 listings in current advertised inventory as of September 14, 2026/)).toBeVisible();
    expect(screen.getByText(/14,725 miles · 103.2 miles away · Certified listing/)).toBeVisible();
    expect(screen.getByText(/18,812 miles · 183.5 miles away/)).toBeVisible();
    expect(screen.getByText(/certification premium has not been adjusted/)).toBeVisible();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.queryByText(/appears fair|worth pursuing|savings|recoverable|GOOD|WEAK|CERTIFIED_PREMIUM_UNKNOWN/)).not.toBeInTheDocument();
    expect(screen.queryByText("$20,000")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add insurer offer|Review your details/ })).not.toBeInTheDocument();
    expect(container.querySelector("[data-preliminary-result]")).toHaveAttribute("data-preliminary-result", "LISTING_CONTEXT");
    expect(analysis).toEqual(saved);
  });

  it("labels a single usable listing as one asking price, not a manufactured range", () => {
    show(preliminaryAnalysis({ sampleSize: 1, listingPriceSpan: { lowCents: 2_307_700, highCents: 2_307_700 }, listings: contextListings.slice(0, 1) }));
    const price = screen.getByRole("region", { name: "Observed asking price" });
    expect(price).toHaveTextContent("$23,077");
    expect(price).not.toHaveTextContent("–");
    expect(screen.getByText("1 listing · Current asking prices")).toBeVisible();
  });

  it("shows a supported current estimate without implying a comparable insurer shortfall", () => {
    show(preliminaryAnalysis({ outcome: "ESTIMATE", sampleSize: 4, estimatedRange: { lowCents: 2_180_000, highCents: 2_260_000 }, listingPriceSpan: null, limitations: [], insurerComparison: { insurerValueCents: 2_000_000, position: "BELOW_RANGE" } }));
    expect(screen.getByRole("heading", { name: "Your preliminary value range." })).toBeVisible();
    expect(screen.getByRole("region", { name: "Preliminary estimated range" })).toHaveTextContent("$21,800–$22,600");
    expect(screen.getByText("Not a valuation for your date of loss.")).toBeVisible();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.queryByText("$20,000")).not.toBeInTheDocument();
    expect(screen.queryByText(/undervaluing|appears fair|worth pursuing/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Comparable listing examples" })).not.toBeInTheDocument();
  });

  it("shows only the backend-authorized insurer comparison for a verified loss-date estimate", async () => {
    show(preliminaryAnalysis({ outcome: "ESTIMATE", evidenceBasis: "LOSS_DATE_HISTORICAL", evidenceDate: "2026-08-11", sampleSize: 4, estimatedRange: { lowCents: 2_180_000, highCents: 2_260_000 }, listingPriceSpan: null, limitations: [], insurerComparison: { insurerValueCents: 2_000_000, position: "BELOW_RANGE" } }));
    await userEvent.setup().click(screen.getByText("Evidence details"));
    expect(screen.getByText(/advertised prices verified around your date of loss, August 11, 2026/)).toBeVisible();
    expect(screen.getByRole("figure", { name: "Insurer’s valuation: $20,000. Estimated market range: $21,800 to $22,600." })).toBeVisible();
    expect(screen.getByText(/is below this preliminary range/)).toBeVisible();
    expect(screen.getByText(/does not establish a settlement difference/)).toBeVisible();
    expect(screen.queryByText(/\$1,800|\$2,600|appears fair/)).not.toBeInTheDocument();
  });

  it("does not reuse saved strict prices when the preliminary outcome is insufficient", () => {
    show(preliminaryAnalysis({ outcome: "INSUFFICIENT", evidenceBasis: "NONE", evidenceDate: null, sampleSize: 0, estimatedRange: null, listingPriceSpan: null, listings: [], limitations: [] }));
    expect(screen.getByRole("heading", { name: "We need more market evidence." })).toBeVisible();
    expect(screen.getByText(/Your details are saved/)).toBeVisible();
    expect(screen.queryByText(/\$21,800|\$22,600|Estimated market range|Observed asking/)).not.toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.queryByText(/technical|engine|transmission|drivetrain|certification/)).not.toBeInTheDocument();
  });

  it.each((["ESTIMATE", "LISTING_CONTEXT", "INSUFFICIENT"] as const).flatMap(outcome => [true, false].map(reportAvailable => ({ outcome, reportAvailable }))))("keeps report continuation available for $outcome (saved: $reportAvailable) without bypassing payment readiness", async ({ outcome, reportAvailable }) => {
    const analysis = structuredClone(preliminaryAnalysis({ outcome }));
    analysis.analysisScope.reportAvailable = reportAvailable;
    show(analysis);
    expect(screen.getByRole("link", { name: reportAvailable ? "Review saved report" : "Upload valuation report" })).toHaveAttribute("href", reportPath);
    expect(screen.getByText("Get a detailed review of your vehicle details, comparable vehicles, and adjustments.")).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("What does the full review include?"));
    expect(screen.getByText("Get a detailed review of your vehicle details, comparable vehicles, and adjustments.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pay for review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue my review" })).not.toBeInTheDocument();
  });

  it("uses the dedicated report action while ignoring a payment continuation on a preliminary result", async () => {
    const upload = vi.fn();
    render(<MemoryRouter><TotalLossAnalysisResult analysis={preliminaryAnalysis()}
      reportUploadAction={<button onClick={upload}>Upload valuation report</button>}
      continueAction={<button>Pay for review</button>} /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Upload valuation report" }));
    expect(upload).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Pay for review" })).not.toBeInTheDocument();
  });

  it("uses specific recovery for a versioned insufficient result without displaying an old range", () => {
    const analysis = preliminaryAnalysis({ outcome: "INSUFFICIENT", sampleSize: 0, estimatedRange: null, listingPriceSpan: null });
    analysis.marketSearchContext = { baselineStatus: "LIMITED", summary: "Limited", stopReasons: [], recovery: {
      kind: "UNRESOLVED_CONFIGURATION", field: "drivetrain", correctionStep: "vehicle", message: "Confirm your drive type.",
    } };
    render(<MemoryRouter><TotalLossAnalysisResult analysis={analysis} reviewIntakePath="/start?caseId=saved" insurerReportPath={reportPath} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Confirm drive type" })).toBeVisible();
    expect(screen.queryByText(/\$21,800|\$22,600|appears fair/)).not.toBeInTheDocument();
  });

  it("keeps a provider interruption distinct from insufficient evidence", () => {
    const analysis = { ...analysisFor("NO_MATERIAL_DISCREPANCY"), presentationVersion: "8", preliminaryResult: null, marketSearchContext: { baselineStatus: "LIMITED", summary: "Interrupted", stopReasons: [], recovery: { kind: "SEARCH_INTERRUPTED", field: null, correctionStep: null, message: "Search interrupted" } } } as AnalysisPresentation;
    show(analysis);
    expect(screen.getByRole("heading", { name: "We couldn’t finish your estimate." })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "We need more market evidence." })).not.toBeInTheDocument();
    expect(screen.queryByText(/no suitable vehicles/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$21,800|\$22,600|\$20,000|appears fair|Estimated market range/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review saved report" })).toHaveAttribute("href", reportPath);
    expect(screen.queryByRole("link", { name: "Review your details" })).not.toBeInTheDocument();
  });
});
