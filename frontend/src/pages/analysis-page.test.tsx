import { delay, http, HttpResponse } from "msw";
import { screen } from "@testing-library/react";
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
    throw new Error("Representative fixture requires a CCC adjustment comparison.");
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
    expect(screen.getByText("Loss date May 19, 2026")).toBeInTheDocument();

    expect(screen.getAllByText("$20,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$22,200.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$2,200.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("11.00%").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("$21,800.00–$22,600.00").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "CCC’s value is below the entire selected loss-date historical range.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What CCC used in its valuation" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$20,100.00").length).toBeGreaterThan(0);
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

    expect(screen.queryByText("MATERIAL_UNDERVALUE_SIGNAL")).not.toBeInTheDocument();
    expect(screen.queryByText("BELOW_OBSERVED_RANGE")).not.toBeInTheDocument();
  });

  test("renders the selected loss-date comparables as verified evidence", async () => {
    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Loss-date comparable vehicles",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Comparable 1")).toBeInTheDocument();
    expect(screen.getByText("Comparable 5")).toBeInTheDocument();
    expect(
      screen.getAllByText("Verified active on loss date"),
    ).toHaveLength(5);
    expect(screen.getAllByText("Strong match")).toHaveLength(5);
    expect(screen.getByText("$21,800.00")).toBeInTheDocument();
    expect(screen.getByText("$22,600.00")).toBeInTheDocument();
    expect(screen.queryByText("99.5")).not.toBeInTheDocument();
  });

  test("keeps current-market context distinct from loss-date evidence", async () => {
    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Loss-date and current-market evidence are kept separate",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Loss-date market" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Current market" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "The current-market median of $20,000.00 is context only. It is not combined with the loss-date median of $22,200.00.",
      ),
    ).toBeInTheDocument();
  });

  test("labels current-only evidence as the primary available context", async () => {
    useAnalysisResponse(currentMarketAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByRole("heading", {
        name: "Current-market evidence is the primary available context",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Loss-date evidence unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "How Venfour reached this assessment",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Primary comparable vehicles" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No separate current-market set"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Why Venfour flagged the valuation" }),
    ).not.toBeInTheDocument();
  });

  test("uses unsigned magnitudes when prose supplies the direction", async () => {
    useAnalysisResponse(belowCccAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByText(/That is \$1,200\.00 \(6\.00%\) below CCC/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "The loss-date median is 6.00% below CCC",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/-\$1,200\.00.*below/)).not.toBeInTheDocument();
  });

  test("describes a CCC adjustment increase with the correct direction", async () => {
    useAnalysisResponse(cccAdjustmentIncreaseAnalysis());

    renderTestApp([analysisPath]);

    expect(
      await screen.findByText(
        /adjusted median was \$20,300\.00, a \$200\.00 increase/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/adjusted median was \$20,300\.00, a -\$200\.00/),
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
      screen.getByRole("heading", { name: "Selected market prices vary widely" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Phase 3D/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "How Venfour reached this assessment",
      }),
    ).toBeInTheDocument();
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
    expect(screen.getByText("Loading your valuation analysis…")).toBeInTheDocument();
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
  });
});
