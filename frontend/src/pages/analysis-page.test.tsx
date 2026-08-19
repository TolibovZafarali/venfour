import { delay, http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import type {
  AnalysisPresentation,
  AnalysisPresentationBase,
} from "@/features/analyses/analysis-presentation.generated";
import {
  materialUndervalueAnalysis,
  representativeRunId,
} from "@/test/fixtures/analysis-presentation";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

const analysisPath = `/analyses/${representativeRunId}`;

function useAnalysisResponse(analysis: AnalysisPresentation) {
  server.use(
    http.get("*/api/v1/analyses/:runId", () => HttpResponse.json(analysis)),
  );
}

function currentMarketAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  const currentEvidence = analysis.secondaryExternalEvidence;
  if (!currentEvidence) {
    throw new Error("Representative fixture requires current-market context.");
  }

  analysis.assessment = {
    ...analysis.assessment,
    classification: "NO_MATERIAL_DISCREPANCY",
    classificationLabel: "No material discrepancy",
    evidenceStrength: "MODERATE",
    evidenceStrengthLabel: "Moderate",
    evidenceBasis: "CURRENT_MARKET",
    evidenceBasisLabel: "Current market evidence",
    summary:
      "The available current-market evidence does not show a material discrepancy from the CCC value.",
  };
  analysis.primaryExternalEvidence = {
    ...currentEvidence,
    role: "PRIMARY",
    label: "Primary current market evidence",
    description:
      "Current listings provide the primary context because sufficient loss-date evidence was unavailable.",
  };
  analysis.secondaryExternalEvidence = null;
  analysis.comparablesUsed = {
    primary: analysis.comparablesUsed.secondary.map((comparable) => ({
      ...comparable,
      evidenceRole: "PRIMARY" as const,
    })),
    secondary: [],
  };
  analysis.cccValuation.comparisonToPrimaryEvidence = {
    ...analysis.cccValuation.comparisonToPrimaryEvidence!,
    evidenceBasis: "CURRENT_MARKET",
    firstValue: currentEvidence.prices.medianPrice,
    difference: { cents: 0, display: "$0.00" },
    differencePercent: { basisPoints: 0, display: "0.00%" },
    cccPositionInExternalRange: "WITHIN_OBSERVED_RANGE",
    cccPositionLabel: "Within the observed external range",
  };
  analysis.findings = [
    {
      code: "CURRENT_PRIMARY_EVIDENCE",
      label: "Current evidence is primary",
      description:
        "Current listings provide the primary external comparison because sufficient loss-date evidence was unavailable.",
    },
    {
      code: "CURRENT_MARKET_ONLY",
      label: "Current market evidence only",
      description:
        "The assessment uses current listings and does not treat them as loss-date evidence.",
    },
    {
      code: "EXTERNAL_MEDIAN_EQUALS_CCC",
      label: "External median equals CCC",
      description:
        "The selected external advertised-price median equals the CCC adjusted vehicle value.",
    },
    {
      code: "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT",
      label: "CCC and external evidence are consistent",
      description:
        "The selected current evidence is consistent with the CCC adjusted vehicle value.",
    },
  ];

  return analysis as AnalysisPresentation;
}

function belowCccAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  const primary = analysis.primaryExternalEvidence;
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  if (!primary || !comparison) {
    throw new Error("Representative fixture requires primary evidence.");
  }

  analysis.assessment = {
    ...analysis.assessment,
    classification: "NO_MATERIAL_DISCREPANCY",
    classificationLabel: "No material discrepancy",
    summary:
      "The selected external evidence is below the CCC adjusted vehicle value.",
  };
  primary.prices.minimumPrice = { cents: 1_800_000, display: "$18,000.00" };
  primary.prices.maximumPrice = { cents: 1_950_000, display: "$19,500.00" };
  primary.prices.medianPrice = { cents: 1_880_000, display: "$18,800.00" };
  comparison.firstValue = primary.prices.medianPrice;
  comparison.difference = { cents: -120_000, display: "-$1,200.00" };
  comparison.differencePercent = { basisPoints: -600, display: "-6.00%" };
  comparison.cccPositionInExternalRange = "ABOVE_OBSERVED_RANGE";
  comparison.cccPositionLabel = "Above the observed external range";
  analysis.findings = [
    {
      code: "EXTERNAL_MEDIAN_BELOW_CCC",
      label: "External median is below CCC",
      description:
        "The selected external advertised-price median is below the CCC adjusted vehicle value.",
    },
    {
      code: "CCC_ABOVE_EXTERNAL_RANGE",
      label: "CCC value is above the external range",
      description:
        "The CCC adjusted vehicle value is above the selected external advertised-price range.",
    },
  ];

  return analysis as AnalysisPresentation;
}

function cccAdjustmentIncreaseAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  const comparison =
    analysis.cccValuation.supportingComparisons
      .cccAdvertisedMedianVsAdjustedMedian;
  if (!comparison) {
    throw new Error(
      "Representative fixture requires a CCC adjustment comparison.",
    );
  }

  comparison.secondValue = { cents: 2_030_000, display: "$20,300.00" };
  comparison.difference = { cents: -20_000, display: "-$200.00" };
  comparison.differencePercent = { basisPoints: -99, display: "-0.99%" };
  analysis.cccComparables.summary.adjustmentDirection = {
    code: "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES",
    label: "CCC adjustments increase the paired median",
    description:
      "For paired CCC rows, the adjusted-value median is above the advertised-price median; this describes direction only.",
  };
  analysis.findings = analysis.findings.map((finding) =>
    finding.code === "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES"
      ? {
          code: "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES",
          label: "CCC adjustments increase the paired median",
          description:
            "For paired CCC rows, the adjusted-value median is above the advertised-price median; this describes direction only.",
        }
      : finding,
  );

  return analysis as AnalysisPresentation;
}

function conflictingAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  analysis.assessment = {
    ...analysis.assessment,
    classification: "CONFLICTING_EVIDENCE",
    classificationLabel: "Conflicting evidence",
    summary:
      "The loss-date and current-market signals differ, and selected prices vary widely.",
  };
  analysis.findings = [
    {
      code: "HISTORICAL_CURRENT_SIGNALS_CONFLICT",
      label: "Loss-date and current-market signals differ",
      description:
        "The primary loss-date evidence and secondary current-market context point in different directions.",
    },
    {
      code: "EXTERNAL_MARKET_HIGH_DISPERSION",
      label: "Selected market prices vary widely",
      description:
        "The stored robust dispersion measure meets or exceeds the Phase 3D screening-policy threshold.",
    },
  ];

  return analysis as AnalysisPresentation;
}

function currentOnlyConflictingAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    currentMarketAnalysis(),
  );
  analysis.assessment = {
    ...analysis.assessment,
    classification: "CONFLICTING_EVIDENCE",
    classificationLabel: "Conflicting evidence",
    summary: "The selected current-market prices vary too widely.",
  };
  analysis.findings = [
    {
      code: "EXTERNAL_MARKET_HIGH_DISPERSION",
      label: "Selected market prices vary widely",
      description: "The selected current-market prices have high dispersion.",
    },
  ];

  return analysis as AnalysisPresentation;
}

function insufficientEvidenceAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  analysis.assessment = {
    ...analysis.assessment,
    classification: "INSUFFICIENT_EVIDENCE",
    classificationLabel: "Insufficient evidence",
    evidenceStrength: "LOW",
    evidenceStrengthLabel: "Low",
    evidenceBasis: "NONE",
    evidenceBasisLabel: "No primary external evidence",
    summary:
      "There were not enough reliable external comparables to assess the CCC valuation.",
  };
  analysis.primaryExternalEvidence = null;
  analysis.secondaryExternalEvidence = null;
  analysis.comparablesUsed = { primary: [], secondary: [] };
  analysis.cccValuation.comparisonToPrimaryEvidence = null;
  analysis.findings = [
    {
      code: "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE",
      label: "Reliable external evidence is insufficient",
      description:
        "Too few eligible external listings were available to form a primary comparison set.",
    },
  ];

  return analysis as AnalysisPresentation;
}

function fractionalPriceAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  const firstComparable = analysis.comparablesUsed.primary[0];
  if (!firstComparable) {
    throw new Error("Representative fixture requires a primary comparable.");
  }

  firstComparable.advertisedPrice = {
    cents: 2_180_050,
    display: "$21,800.50",
  };

  return analysis as AnalysisPresentation;
}

function historicalWithoutCurrentContextAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  analysis.secondaryExternalEvidence = null;
  analysis.comparablesUsed.secondary = [];

  return analysis as AnalysisPresentation;
}

function nonpositiveCccAnalysis(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  if (!comparison) {
    throw new Error("Representative fixture requires a primary comparison.");
  }

  analysis.assessment = {
    ...analysis.assessment,
    classification: "INSUFFICIENT_EVIDENCE",
    classificationLabel: "Insufficient evidence",
    summary:
      "The CCC vehicle value is not positive, so a meaningful percentage comparison cannot be calculated.",
  };
  analysis.cccValuation.adjustedVehicleValue = { cents: 0, display: "$0.00" };
  comparison.secondValue = { cents: 0, display: "$0.00" };
  comparison.difference = { cents: 2_220_000, display: "$22,200.00" };
  comparison.differencePercent = { basisPoints: null, display: null };
  analysis.findings = [
    {
      code: "NONPOSITIVE_CCC_VEHICLE_VALUATION",
      label: "CCC vehicle value is not positive",
      description:
        "A positive CCC vehicle value is required for a meaningful percentage comparison.",
    },
  ];

  return analysis as AnalysisPresentation;
}

function analysisWithoutCccRows(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  analysis.cccComparables.rows = [];
  analysis.cccComparables.summary.totalCount = 0;

  return analysis as AnalysisPresentation;
}

function analysisWithMissingOptionalDetails(): AnalysisPresentation {
  const analysis: AnalysisPresentationBase = structuredClone(
    materialUndervalueAnalysis,
  );
  const firstComparable = analysis.comparablesUsed.primary[0];
  const secondComparable = analysis.comparablesUsed.primary[1];
  if (!firstComparable || !secondComparable) {
    throw new Error("Representative fixture requires primary comparables.");
  }

  analysis.vehicle.mileage = null;
  analysis.vehicle.lossDate = null;
  analysis.vehicle.postalCode = null;
  firstComparable.mileage = null;
  firstComparable.mileageDifferenceFromLossVehicle = null;
  firstComparable.dealer = null;
  firstComparable.distanceMiles = null;
  secondComparable.distanceMiles = null;

  return analysis as AnalysisPresentation;
}

describe("analysis results page", () => {
  test("presents the material undervalue assessment and authoritative values", async () => {
    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Strong evidence suggests your CCC valuation may be low",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "2024 Synthetic Sedan SEL",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("50,000 miles").length).toBeGreaterThan(0);
    expect(screen.getByText("Loss date").parentElement).toHaveTextContent(
      "Loss dateMay 19, 2026",
    );

    expect(screen.getAllByText("$20,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$22,200").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$2,200").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/11% above CCC/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$21,800–$22,600").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "CCC’s value is below the entire selected loss-date historical range.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What CCC used in its valuation" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$20,100").length).toBeGreaterThan(0);
    expect(screen.getByText("Important limitations")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Important limitations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Valuation analysis loaded.",
    );
    expect(
      screen.getByRole("region", { name: "Loss-date comparable vehicles" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "What CCC used in its valuation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Strong evidence suggests your CCC valuation may be low",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("figure", {
        name: /CCC adjusted value \$20,000; selected loss-date historical range \$21,800 to \$22,600; median \$22,200/,
      }),
    ).toBeInTheDocument();

    expect(
      screen.queryByText("MATERIAL_UNDERVALUE_SIGNAL"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("BELOW_OBSERVED_RANGE")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "What you can do next" }),
    ).toHaveTextContent(
      "The selected evidence shows a material signal worth reviewing carefully",
    );
    expect(
      screen.getByRole("link", { name: "Start another appraisal" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(document.title).toBe("Vehicle Valuation Analysis | Venfour");
  });

  test("renders the selected loss-date comparables as verified evidence", async () => {
    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Loss-date comparable vehicles",
      }),
    ).toBeInTheDocument();
    const comparables = screen.getByRole("region", {
      name: "Loss-date comparable vehicles",
    });
    expect(within(comparables).getByText("01")).toBeInTheDocument();
    expect(within(comparables).getByText("05")).toBeInTheDocument();
    expect(screen.getAllByText("Verified active on loss date")).toHaveLength(5);
    expect(screen.getAllByText("Strong match")).toHaveLength(5);
    expect(screen.getByText("$21,800")).toBeInTheDocument();
    expect(screen.getByText("$22,600")).toBeInTheDocument();
    expect(screen.queryByText("99.5")).not.toBeInTheDocument();
  });

  test("keeps current-market context distinct from loss-date evidence", async () => {
    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Current-market prices remain separate from loss-date evidence",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Current-market evidence" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "The current-market median of $20,000 is not combined with the loss-date median of $22,200.",
      ),
    ).toBeInTheDocument();
  });

  test("does not imply current-market context exists when it is absent", async () => {
    useAnalysisResponse(historicalWithoutCurrentContextAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Only loss-date market evidence is available",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No separate current-market set"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Current-market prices remain separate from loss-date evidence",
      }),
    ).not.toBeInTheDocument();
  });

  test("labels current-only evidence as the primary available context", async () => {
    useAnalysisResponse(currentMarketAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Current-market evidence is the primary available context",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Loss-date evidence unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "How Venfour reached this assessment",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Current-market comparable vehicles",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No separate current-market set"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Why Venfour flagged the valuation",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Current-market price position"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Selected current-market range"),
    ).toBeInTheDocument();
    expect(screen.getByText("Current-market median")).toBeInTheDocument();
    expect(
      screen.queryByText("Loss-date price position"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Selected loss-date range"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Loss-date median")).not.toBeInTheDocument();
  });

  test("uses unsigned magnitudes when prose supplies the direction", async () => {
    useAnalysisResponse(belowCccAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByText(/That is \$1,200 \(6%\) below CCC/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "The loss-date median is 6% below CCC",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/-\$1,200.*below/)).not.toBeInTheDocument();
  });

  test("describes a CCC adjustment increase with the correct direction", async () => {
    useAnalysisResponse(cccAdjustmentIncreaseAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByText(/adjusted median was \$20,300, a \$200 increase/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/adjusted median was \$20,300, a -\$200/),
    ).not.toBeInTheDocument();
  });

  test("explains conflicting evidence without calling it an undervalue flag", async () => {
    useAnalysisResponse(conflictingAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "The available market evidence is mixed",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Loss-date and current-market signals differ",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Selected market prices vary widely",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Phase 3D/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "How Venfour reached this assessment",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "What you can do next" }),
    ).toHaveTextContent("loss-date and current-market evidence differ");
  });

  test("does not invent a timing conflict for current-only price dispersion", async () => {
    useAnalysisResponse(currentOnlyConflictingAnalysis());

    renderTestApp([analysisPath]);

    const nextSteps = await screen.findByRole("region", {
      name: "What you can do next",
    });
    expect(nextSteps).toHaveTextContent(
      "review how widely their advertised prices vary",
    );
    expect(nextSteps).not.toHaveTextContent(
      "loss-date and current-market evidence differ",
    );
  });

  test("renders an insufficient-evidence assessment without evidence sections", async () => {
    useAnalysisResponse(insufficientEvidenceAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "There isn’t enough reliable evidence to assess the CCC valuation",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Reliable external evidence is insufficient",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Market timing")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No external comparables were selected",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "What you can do next" }),
    ).toHaveTextContent(
      "That does not establish that the CCC valuation is correct or incorrect",
    );
  });

  test("explains when CCC comparable rows are unavailable", async () => {
    useAnalysisResponse(analysisWithoutCccRows());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "No CCC comparable details were available",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No CCC comparable rows were available to show how individual vehicles and adjustments contributed to the reported valuation.",
      ),
    ).toBeInTheDocument();
  });

  test("labels missing optional report and listing details", async () => {
    useAnalysisResponse(analysisWithMissingOptionalDetails());

    renderTestApp([analysisPath]);

    const comparables = await screen.findByRole("region", {
      name: "Loss-date comparable vehicles",
    });
    expect(
      within(comparables).getByText("Mileage not provided"),
    ).toBeInTheDocument();
    expect(
      within(comparables).getByText("Dealer not provided"),
    ).toBeInTheDocument();
    expect(
      within(comparables).getByText("Location and distance not available"),
    ).toBeInTheDocument();
    expect(
      within(comparables).getByText(/Distance not available$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Search ZIP").parentElement).toHaveTextContent(
      "Search ZIPNot available",
    );
  });

  test("explains a nonpositive CCC value without showing an unavailable percent", async () => {
    useAnalysisResponse(nonpositiveCccAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "The CCC vehicle value cannot support a market comparison",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "The CCC vehicle value cannot be compared",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("above CCC")).toBeInTheDocument();
    expect(
      screen.queryByText(/Not available above CCC/),
    ).not.toBeInTheDocument();
  });

  test("keeps meaningful cents while removing unnecessary precision", async () => {
    useAnalysisResponse(fractionalPriceAnalysis());

    renderTestApp([analysisPath]);

    expect(await screen.findByText("$21,800.50")).toBeInTheDocument();
    expect(screen.queryByText("$22,200.00")).not.toBeInTheDocument();
  });

  test("reveals technical evidence, CCC adjustments, and limitations", async () => {
    const user = userEvent.setup();
    renderTestApp([analysisPath]);

    const comparables = await screen.findByRole("region", {
      name: "Loss-date comparable vehicles",
    });
    await user.click(
      within(comparables).getByLabelText(
        "Technical evidence details for comparable 1: 2024 Synthetic Sedan SEL",
      ),
    );
    expect(screen.getByText("SYNTHETICVIN00001")).toBeVisible();

    const cccEvidence = screen.getByRole("region", {
      name: "What CCC used in its valuation",
    });
    await user.click(
      within(cccEvidence).getByLabelText(
        "Adjustment breakdown for CCC comparable 1: 2024 Synthetic Sedan SEL",
      ),
    );
    expect(screen.getByText("SYNTHETICCCCVIN01")).toBeVisible();

    await user.click(
      screen.getByText(
        "Review the limits and coverage notes for this analysis",
      ),
    );
    expect(
      screen.getByText(
        "This evidence comparison is not an independent vehicle appraisal.",
      ),
    ).toBeVisible();
  });

  test("shows a report-shaped loading state", () => {
    server.use(
      http.get("*/api/v1/analyses/:runId", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    renderTestApp([analysisPath]);

    expect(
      screen.getByRole("region", { name: "Loading analysis" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText("Loading your valuation analysis…"),
    ).toBeInTheDocument();
  });

  test("shows a specific not-found state for an unknown analysis", async () => {
    server.use(
      http.get("*/api/v1/analyses/:runId", () =>
        HttpResponse.json(
          {
            error: {
              code: "ANALYSIS_NOT_FOUND",
              message: "Analysis run was not found.",
            },
          },
          { status: 404 },
        ),
      ),
    );

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this analysis.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start a new appraisal" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(document.title).toBe("Analysis Not Found | Venfour");
  });

  test("rejects a malformed analysis URL without requesting it", async () => {
    let requestCount = 0;
    server.use(
      http.get("*/api/v1/analyses/:runId", () => {
        requestCount += 1;
        return HttpResponse.json(materialUndervalueAnalysis);
      }),
    );

    renderTestApp(["/analyses/not-a-valid-analysis-id"]);

    expect(
      await screen.findByRole("heading", {
        name: "This analysis link isn’t valid.",
      }),
    ).toBeInTheDocument();
    expect(requestCount).toBe(0);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start a new appraisal" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(document.title).toBe("Invalid Analysis Link | Venfour");
  });

  test("treats a backend invalid-identifier response as permanent", async () => {
    server.use(
      http.get("*/api/v1/analyses/:runId", () =>
        HttpResponse.json(
          {
            error: {
              code: "INVALID_RUN_ID",
              message: "Analysis run ID is invalid.",
            },
          },
          { status: 400 },
        ),
      ),
    );

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "This analysis link isn’t valid.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(document.title).toBe("Invalid Analysis Link | Venfour");
  });

  test("shows a retryable state for an API failure", async () => {
    server.use(
      http.get("*/api/v1/analyses/:runId", () =>
        HttpResponse.json(
          {
            error: {
              code: "ANALYSIS_UNAVAILABLE",
              message: "Analysis run is unavailable.",
            },
          },
          { status: 500 },
        ),
      ),
    );

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load your analysis.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(document.title).toBe("Analysis Temporarily Unavailable | Venfour");
  });
});
