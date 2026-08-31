import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ReviewStory,
  type ReviewStoryStage,
} from "@/features/total-loss-claim/components/review-story";
import type {
  TotalLossMoney,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";

function money(amountMinorUnits: number | null): TotalLossMoney {
  return {
    amountMinorUnits,
    currency: "USD",
    formatted:
      amountMinorUnits === null
        ? "Unavailable"
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(amountMinorUnits / 100),
  };
}

function report(): TotalLossPublishedReport {
  return {
    conclusion: {
      classificationLabel: "Potential undervaluation signal",
      continuingSupported: true,
      indicatedDifference: money(200_000),
      insurerValuation: money(1_800_000),
      limitations: ["Advertised prices are not completed-sale prices."],
      preliminaryComparison: null,
      summary:
        "The deterministic assessment identified POTENTIAL_UNDERVALUE with CURRENT_MARKET evidence.",
      supportedRange: {
        evidenceBasis: "CURRENT_MARKET",
        low: money(1_950_000),
        median: money(2_000_000),
        high: money(2_200_000),
      },
    },
    insurerEvidence: {
      adjustmentContext: null,
      comparableCount: 11,
      comparables: [],
      insurerName: null,
      methodologyStatement: null,
      summary: {
        adjustedValueMissingCount: 0,
        adjustedValues: null,
        advertisedPriceMissingCount: 0,
        advertisedPrices: null,
        fullyDisclosedAdjustmentCount: 4,
        partiallyDisclosedAdjustmentCount: 0,
        totalCount: 11,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 7,
      },
    },
    issueDate: "2026-08-29",
    marketEvidence: {
      comparables: [],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement: null,
      primary: {
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        label: "Current market evidence",
        prices: null,
        selectedCount: 8,
      },
      secondary: null,
    },
    reportId: "11111111-1111-4111-8111-111111111111",
    status: "published",
    subjectVehicle: { description: "2022 Example Sedan" },
    suggestedFilename: "Venfour_Valuation_Evidence_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function renderStory(stage: ReviewStoryStage, data = report()) {
  const onEvidence = vi.fn();
  const onReport = vi.fn();
  const rendered = render(
    <ReviewStory
      stage={stage}
      report={data}
      onEvidence={onEvidence}
      onReport={onReport}
    />,
  );
  return { ...rendered, onEvidence, onReport };
}

describe("guided valuation story", () => {
  it.each([
    ["result", "The insurer’s value is below the selected range."],
    ["insurer", "The insurer’s valuation"],
    ["market", "The selected listing median is $20,000."],
    ["meaning", "What the difference means"],
    ["next", "Requesting reconsideration"],
  ] as const)(
    "gives the %s stage one focused purpose without a dashboard",
    (stage, heading) => {
      const { container } = renderStory(stage);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        heading,
      );
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(container.querySelector(".case-action-rail")).toBeNull();
      expect(container.querySelector(".review-eyebrow")).toBeNull();
      expect(container.querySelector(".review-path-preview")).toBeNull();
      expect(container.querySelector(".review-editorial-detail")).toBeNull();
      expect(
        screen.queryByText(
          /POTENTIAL_UNDERVALUE|CURRENT_MARKET|deterministic/iu,
        ),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      "POTENTIAL_UNDERVALUE",
      "The insurer’s value is below the selected range.",
    ],
    [
      "MATERIAL_UNDERVALUE_SIGNAL",
      "The insurer’s value is below the selected range.",
    ],
    [
      "NO_MATERIAL_DISCREPANCY",
      "The review found no meaningful valuation gap.",
    ],
    [
      "INSUFFICIENT_EVIDENCE",
      "There isn’t enough evidence for a clear comparison.",
    ],
    ["CONFLICTING_EVIDENCE", "The evidence gives mixed signals."],
  ])(
    "preserves the meaning of the %s result",
    (classificationLabel, heading) => {
      const data = report();
      renderStory("result", {
        ...data,
        conclusion: { ...data.conclusion, classificationLabel },
      });
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        heading,
      );
      expect(screen.queryByText(classificationLabel)).not.toBeInTheDocument();
      if (classificationLabel === "MATERIAL_UNDERVALUE_SIGNAL")
        expect(
          screen.getByText(
            /found a meaningful gap between the insurer’s valuation and the selected advertised prices/u,
          ),
        ).toBeVisible();
      if (classificationLabel === "POTENTIAL_UNDERVALUE")
        expect(
          screen.getByText(
            /found a possible gap between the insurer’s valuation and the selected advertised prices/u,
          ),
        ).toBeVisible();
    },
  );

  it("keeps the first result focused on the conclusion, with the valuation as context", () => {
    renderStory("result");
    expect(screen.getByText("$18,000")).toBeVisible();
    expect(screen.queryByText("$20,000")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/First, we’ll explain the insurer’s number/u),
    ).not.toBeInTheDocument();
  });

  it("does not claim a below-range result when the stored value is within or above the range", () => {
    const data = report();
    renderStory("result", {
      ...data,
      conclusion: { ...data.conclusion, insurerValuation: money(2_100_000) },
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "deserves a closer look",
    );
    expect(
      screen.queryByText(/is below the selected range/u),
    ).not.toBeInTheDocument();
  });

  it("explains the insurer method using live counts and opens optional insurer details", async () => {
    const { onEvidence } = renderStory("insurer");
    expect(screen.getByText("$18,000")).toBeVisible();
    expect(
      screen.getByText(
        "11 comparable vehicles reviewed; full adjustment details disclosed for 4 of 11.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/A listed price can differ from the adjusted value/u),
    ).toBeVisible();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "See the insurer’s comparables" }),
      );
    expect(onEvidence).toHaveBeenCalledWith("insurer");
  });

  it("does not invent insurer comparables or a number when neither is available", () => {
    const data = report();
    renderStory("insurer", {
      ...data,
      conclusion: { ...data.conclusion, insurerValuation: money(null) },
      insurerEvidence: { ...data.insurerEvidence, comparableCount: 0 },
    });
    expect(screen.getByText("Not stated")).toBeVisible();
    expect(
      screen.getByText(
        /does not include a breakdown of the insurer’s comparable vehicles/u,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "See the insurer’s comparables" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("introduces the median and then illustrates selected prices, leaving the gap for the next stage", async () => {
    const { onEvidence } = renderStory("market");
    expect(
      screen.getByText(
        /8 selected listings have a median advertised price of \$20,000/u,
      ),
    ).toBeVisible();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /range \$19,500 to \$22,000; median \$20,000/u,
    );
    expect(
      screen.getByText(/current advertised listings · August 28, 2026/u),
    ).toBeVisible();
    expect(screen.queryByText(/midpoint/iu)).not.toBeInTheDocument();
    expect(
      screen.queryByText("$2,000 below the selected listing median"),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Explore the selected listings" }),
      );
    expect(onEvidence).toHaveBeenCalledWith("market");
  });

  it("distinguishes historical observations from current advertised listings", () => {
    const data = report();
    renderStory("market", {
      ...data,
      conclusion: {
        ...data.conclusion,
        supportedRange: {
          ...data.conclusion.supportedRange!,
          evidenceBasis: "LOSS_DATE_HISTORICAL",
        },
      },
      marketEvidence: {
        ...data.marketEvidence,
        evidenceDateContext: {
          ...data.marketEvidence.evidenceDateContext,
          historicalEvidenceDate: "2026-08-01",
        },
      },
    });
    expect(
      screen.getByText(/historical advertised listings · August 1, 2026/u),
    ).toBeVisible();
    expect(
      screen.getByText(/These are historical asking prices/u),
    ).toBeVisible();
    expect(
      screen.queryByText(/current advertised listings/u),
    ).not.toBeInTheDocument();
  });

  it("handles missing market prices without a fabricated chart", () => {
    const data = report();
    renderStory("market", {
      ...data,
      conclusion: { ...data.conclusion, supportedRange: null },
      marketEvidence: { ...data.marketEvidence, primary: null },
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "do not establish a reliable range",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Explore the selected listings" }),
    ).not.toBeInTheDocument();
  });

  it("uses the stored difference and separates the signal from a promised settlement", async () => {
    const { onReport } = renderStory("meaning");
    expect(screen.getByText("$2,000")).toBeVisible();
    expect(screen.getByText("below the selected listing median")).toBeVisible();
    expect(
      screen.getByText(
        /not a guaranteed settlement or an amount the insurer legally owes/u,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/%/u)).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Read the supporting report" }),
      );
    expect(onReport).toHaveBeenCalledOnce();
  });

  it.each(["INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE"])(
    "does not promote a price gap when the result is %s",
    (classificationLabel) => {
      const data = report();
      renderStory("meaning", {
        ...data,
        conclusion: {
          ...data.conclusion,
          classificationLabel,
          continuingSupported: false,
        },
      });
      expect(screen.queryByText("$2,000")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/supports asking the insurer/u),
      ).not.toBeInTheDocument();
    },
  );

  it("explains owner-led reconsideration, attachment, and response before drafting", async () => {
    const { onReport } = renderStory("next");
    expect(screen.getByText(/from your own email account/u)).toBeVisible();
    expect(
      screen.getByRole("list", {
        name: "How the reconsideration request works",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.getByText(/Download the PDF and attach it to the email/u),
    ).toBeVisible();

    expect(
      screen.queryByRole("button", { name: /Upload/u }),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "View your report" }));
    expect(onReport).toHaveBeenCalledOnce();
  });

  it("keeps unsupported results away from a promise to challenge the valuation", () => {
    const data = report();
    renderStory("next", {
      ...data,
      conclusion: {
        ...data.conclusion,
        classificationLabel: "No material discrepancy identified",
        continuingSupported: false,
      },
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your completed review",
    );
    expect(
      screen.queryByRole("list", {
        name: "How the reconsideration request works",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/help you prepare it next/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View your report" }),
    ).toBeVisible();
  });
});
