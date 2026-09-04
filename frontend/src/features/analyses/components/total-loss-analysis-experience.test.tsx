import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

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
  it("presents one truthful indeterminate state with all analysis activities", () => {
    const { container } = render(<TotalLossAnalysisProgress />);

    const progress = screen.getByRole("region", {
      name: "We’re reviewing and analyzing your claim.",
    });
    expect(progress).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Reviewing & analyzing")).toBeVisible();
    expect(
      screen.getByText("Reviewing the insurer’s valuation information"),
    ).toBeVisible();
    expect(
      screen.getByText("Analyzing the vehicle and market evidence"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Determining whether the insurer’s valuation appears fair",
      ),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "insurer valuation information available for this case",
    );
    expect(screen.queryByText(/\d+%/u)).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toHaveClass(
      "motion-reduce:animate-none",
    );
  });

  it.each([
    {
      classification: "MATERIAL_UNDERVALUE_SIGNAL" as const,
      heading: "Your insurer may be undervaluing your vehicle.",
      worthwhile: "This looks worth pursuing.",
      continueVisible: true,
    },
    {
      classification: "POTENTIAL_UNDERVALUE" as const,
      heading: "Your insurer may be undervaluing your vehicle.",
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
      worthwhile: "A clearer picture comes first.",
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
    },
  );

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

    expect(screen.getByText("Not enough information yet")).toBeVisible();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByText("$20,000")).toBeVisible();
    expect(
      screen.getByText(
        "We can’t show a reliable range from the information available.",
      ),
    ).toBeVisible();
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
    render(
      <MemoryRouter>
        <TotalLossAnalysisResult
          analysis={manualAnalysisWithoutOffer() as AnalysisPresentation}
          addInsurerOfferPath={correctionPath}
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
