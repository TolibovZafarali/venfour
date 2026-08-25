import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type {
  AnalysisPresentation,
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
      heading:
        "Strong evidence suggests the insurer’s valuation may be too low.",
      worthwhile: "Continuing appears worthwhile.",
      continueVisible: true,
    },
    {
      classification: "POTENTIAL_UNDERVALUE" as const,
      heading: "The insurer’s valuation may be too low.",
      worthwhile: "A closer review appears worthwhile.",
      continueVisible: true,
    },
    {
      classification: "NO_MATERIAL_DISCREPANCY" as const,
      heading:
        "The insurer’s valuation appears fair based on the available evidence.",
      worthwhile: "Pursuing this further may not be worthwhile.",
      continueVisible: false,
    },
    {
      classification: "CONFLICTING_EVIDENCE" as const,
      heading: "The available evidence points in different directions.",
      worthwhile: "It’s too soon to decide whether to continue.",
      continueVisible: false,
    },
    {
      classification: "INSUFFICIENT_EVIDENCE" as const,
      heading:
        "There isn’t enough reliable evidence to assess the insurer’s valuation.",
      worthwhile: "Venfour can’t yet determine whether to continue.",
      continueVisible: false,
    },
  ])(
    "maps $classification to its deterministic result",
    ({ classification, continueVisible, heading, worthwhile }) => {
      render(<TotalLossAnalysisResult analysis={analysisFor(classification)} />);

      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      expect(
        screen.getByRole("heading", { name: worthwhile }),
      ).toBeVisible();
      if (continueVisible) {
        expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute(
          "type",
          "button",
        );
      } else {
        expect(
          screen.queryByRole("button", { name: "Continue" }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it("shows the evidence-supported range and leaves Continue inert", async () => {
    const user = userEvent.setup();
    render(<TotalLossAnalysisResult analysis={materialUndervalueAnalysis} />);

    expect(screen.getByText("$21,800 – $22,600")).toBeVisible();
    expect(screen.getByText("$22,200")).toBeVisible();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    await user.click(continueButton);
    expect(continueButton).toBeVisible();
  });

  it("uses a truthful unavailable state when no primary range exists", () => {
    const analysis = {
      ...analysisFor("INSUFFICIENT_EVIDENCE"),
      primaryExternalEvidence: null,
    } as AnalysisPresentation;

    render(<TotalLossAnalysisResult analysis={analysis} />);

    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(
      screen.getByText(
        "The available evidence did not support a reliable market range.",
      ),
    ).toBeVisible();
  });
});
