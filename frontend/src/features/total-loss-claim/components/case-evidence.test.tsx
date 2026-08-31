import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CaseEvidence,
  MethodologyDisclosure,
  ValueRangeComparison,
} from "@/features/total-loss-claim/components/case-evidence";
import type {
  TotalLossMoney,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";

const money = (amountMinorUnits: number | null): TotalLossMoney => ({
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
});

function report(): TotalLossPublishedReport {
  return {
    conclusion: {
      classificationLabel: "Potential undervaluation signal",
      continuingSupported: true,
      indicatedDifference: money(300_000),
      insurerValuation: money(1_800_000),
      limitations: ["Equipment details are limited for some listings."],
      preliminaryComparison: null,
      summary:
        "The selected listings support a closer review of the insurer’s valuation.",
      supportedRange: {
        evidenceBasis: "CURRENT_MARKET",
        high: money(2_200_000),
        low: money(2_000_000),
        median: money(2_100_000),
      },
    },
    insurerEvidence: {
      adjustmentContext:
        "Adjustments are shown as disclosed in the reviewed report.",
      comparableCount: 12,
      comparables: Array.from({ length: 7 }, (_, index) => ({
        adjustedValue: "$18,000",
        adjustmentDisclosure:
          index === 0
            ? "undisclosed"
            : index === 1
              ? "unavailable"
              : "Fully disclosed",
        adjustments: {
          condition: null,
          mileage: "$200",
          options: null,
          package: null,
        },
        advertisedPrice: "$18,500",
        contributionPercent: index === 0 ? 25 : null,
        mileage: 30_000 + index,
        netAdjustment: index === 0 ? null : "-$500",
        vehicle: `2022 Insurer Vehicle ${index + 1}`,
      })),
      insurerName: "Example Insurance",
      methodologyStatement: "Insurer comparables are reviewed descriptively.",
      summary: {
        adjustedValueMissingCount: 0,
        adjustedValues: null,
        advertisedPriceMissingCount: 0,
        advertisedPrices: null,
        fullyDisclosedAdjustmentCount: 6,
        partiallyDisclosedAdjustmentCount: 0,
        totalCount: 12,
        unavailableAdjustmentCount: 1,
        undisclosedAdjustmentCount: 5,
      },
    },
    issueDate: "2026-08-29",
    marketEvidence: {
      comparables: Array.from({ length: 7 }, (_, index) => ({
        advertisedPrice: "$21,000",
        dealer: `Dealer ${index + 1}`,
        distanceMiles: 12.5,
        evidenceDate: "2026-08-28",
        location: "Chicago, IL",
        mileage: 31_500,
        role: "PRIMARY",
        temporalBasis: "CURRENT_MARKET",
        vehicle: `2022 Market Vehicle ${index + 1}`,
      })),
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement:
        "Only selected evidence from the completed review is shown.",
      primary: {
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        label: "Current market evidence",
        prices: null,
        selectedCount: 7,
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

describe("value range comparison", () => {
  it("shows stored prices with an explicit median and a separate legend", () => {
    render(<ValueRangeComparison report={report()} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Insurer value $18,000; selected listing range $20,000 to $22,000; median $21,000.",
    );
    expect(
      screen.getByText("$3,000 below the selected listing median"),
    ).toBeVisible();
    expect(
      screen.getByText("Selected listing prices").parentElement,
    ).not.toHaveAttribute("role", "img");
    expect(screen.queryByText(/midpoint/iu)).not.toBeInTheDocument();
  });

  it.each([
    [1_800_000, "below"],
    [2_050_000, "within"],
    [2_500_000, "above"],
  ])(
    "positions the insurer marker correctly for a %s valuation",
    (valuation, relation) => {
      const data = report();
      const { container } = render(
        <ValueRangeComparison
          report={{
            ...data,
            conclusion: {
              ...data.conclusion,
              insurerValuation: money(valuation),
            },
          }}
        />,
      );
      const plot = container.querySelector<HTMLElement>(".case-range-plot")!;
      expect(plot).toHaveAttribute("data-position", relation);
      const insurerPosition = parseFloat(
        plot.style.getPropertyValue("--case-range-insurer"),
      );
      const lowPosition = parseFloat(
        plot.style.getPropertyValue("--case-range-low"),
      );
      const highPosition = parseFloat(
        plot.style.getPropertyValue("--case-range-high"),
      );
      if (relation === "below")
        expect(insurerPosition).toBeLessThan(lowPosition);
      else if (relation === "above")
        expect(insurerPosition).toBeGreaterThan(highPosition);
      else {
        expect(insurerPosition).toBeGreaterThan(lowPosition);
        expect(insurerPosition).toBeLessThan(highPosition);
      }
    },
  );

  it("does not invent an insurer marker or difference when the valuation is absent", () => {
    const data = report();
    const { container } = render(
      <ValueRangeComparison
        report={{
          ...data,
          conclusion: { ...data.conclusion, insurerValuation: money(null) },
        }}
      />,
    );
    expect(screen.getByText("Insurer valuation not stated")).toBeVisible();
    expect(container.querySelector(".case-range-insurer")).toBeNull();
    expect(container.querySelector(".case-comparison-difference")).toBeNull();
    expect(screen.queryByText(/Unavailable/u)).not.toBeInTheDocument();
  });

  it("keeps equal range markers finite and centered", () => {
    const data = report();
    const { container } = render(
      <ValueRangeComparison
        report={{
          ...data,
          conclusion: {
            ...data.conclusion,
            insurerValuation: money(2_100_000),
            supportedRange: {
              low: money(2_100_000),
              high: money(2_100_000),
              median: money(2_100_000),
            },
          },
        }}
      />,
    );
    const plot = container.querySelector<HTMLElement>(".case-range-plot")!;
    expect(plot.style.getPropertyValue("--case-range-insurer")).toBe("50%");
    expect(
      screen.getByText(
        "The insurer’s value matches the selected listing median.",
      ),
    ).toBeVisible();
  });

  it("handles an absent range without fabricated values", () => {
    const data = report();
    render(
      <ValueRangeComparison
        report={{
          ...data,
          conclusion: {
            ...data.conclusion,
            supportedRange: null,
            indicatedDifference: null,
          },
        }}
      />,
    );
    expect(
      screen.getByText(
        "A selected market range is not available for this result.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$3,000/u)).not.toBeInTheDocument();
  });
});

describe("evidence methodology", () => {
  it("keeps detailed limitations collapsed with accurate evidence dates", async () => {
    render(<MethodologyDisclosure report={report()} />);
    expect(
      screen.getByText("Equipment details are limited for some listings."),
    ).not.toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByText("Methodology and limitations"));
    expect(
      screen.getByText("Equipment details are limited for some listings."),
    ).toBeVisible();
    expect(screen.getByText("Aug 1, 2026")).toBeVisible();
    expect(screen.getByText("Aug 28, 2026")).toBeVisible();
    expect(screen.getByText("No historical date provided")).toBeVisible();
  });

  it("translates legacy codes within stored source descriptions", async () => {
    const data = report();
    render(
      <MethodologyDisclosure
        report={{
          ...data,
          marketEvidence: {
            ...data.marketEvidence,
            methodologyStatement:
              "The result is POTENTIAL_UNDERVALUE, with CURRENT_MARKET evidence showing BELOW_OBSERVED_RANGE.",
          },
        }}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByText("Methodology and limitations"));
    expect(
      screen.getByText(
        "The result is Potential undervaluation signal, with current market evidence showing below the selected range.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        /POTENTIAL_UNDERVALUE|CURRENT_MARKET|BELOW_OBSERVED_RANGE/u,
      ),
    ).not.toBeInTheDocument();
  });
});

describe("completed case evidence", () => {
  it("uses a secondary heading when opened alongside a guided stage", () => {
    render(<CaseEvidence report={report()} headingLevel={2} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Evidence" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
  it("opens the insurer view when requested by a legacy deep link", () => {
    render(<CaseEvidence report={report()} initialView="insurer" />);
    expect(
      screen.getByRole("tab", { name: "Insurer comparables" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("table", { name: "Insurer comparables" }),
    ).toBeVisible();
  });

  it("renders a semantic comparison table, expands source details, and shows all rows", async () => {
    const user = userEvent.setup();
    render(<CaseEvidence report={report()} />);
    const table = screen.getByRole("table", {
      name: "Selected market listings",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Vehicle", "Mileage", "Advertised price", "Distance"]);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(5);
    expect(screen.queryByText("2022 Market Vehicle 7")).not.toBeInTheDocument();
    const details = screen.getByRole("button", {
      name: "Show details for 2022 Market Vehicle 1",
    });
    await user.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Dealer 1")).toBeVisible();
    expect(screen.getByText("Primary comparison evidence")).toBeVisible();
    expect(screen.getByText("Current listing")).toBeVisible();
    expect(screen.queryByText("PRIMARY")).not.toBeInTheDocument();
    expect(screen.queryByText("CURRENT_MARKET")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(within(table).getAllByRole("rowheader")).toHaveLength(7);
    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(within(table).getAllByRole("rowheader")).toHaveLength(5);
  });

  it("preserves disclosed adjustment details and distinguishes non-disclosure from unavailability", async () => {
    const user = userEvent.setup();
    render(<CaseEvidence report={report()} />);
    await user.click(screen.getByRole("tab", { name: "Insurer comparables" }));
    const table = screen.getByRole("table", { name: "Insurer comparables" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    expect(
      screen.getByText(
        "The insurer used 12 comparable vehicles. Detailed adjustment information was available for 6.",
      ),
    ).toBeVisible();
    expect(within(table).getAllByText("Not disclosed")).toHaveLength(2);
    expect(within(table).getByText("Details unavailable")).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Show details for 2022 Insurer Vehicle 1",
      }),
    );
    expect(within(table).getByText("$200")).toBeVisible();
    expect(within(table).getByText("Reported contribution")).toBeVisible();
    expect(within(table).getByText("25%")).toBeVisible();
  });

  it("supports arrow, Home, and End keys for evidence tabs", async () => {
    const user = userEvent.setup();
    render(<CaseEvidence report={report()} />);
    const market = screen.getByRole("tab", {
      name: "Selected market listings",
    });
    const insurer = screen.getByRole("tab", { name: "Insurer comparables" });
    market.focus();
    await user.keyboard("{ArrowRight}");
    expect(insurer).toHaveFocus();
    expect(insurer).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "Insurer comparables",
    );
    await user.keyboard("{Home}");
    expect(market).toHaveFocus();
    expect(market).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(insurer).toHaveFocus();
  });

  it("reports mouse and keyboard view changes for URL persistence", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<CaseEvidence report={report()} onViewChange={onViewChange} />);
    expect(onViewChange).not.toHaveBeenCalled();
    const insurer = screen.getByRole("tab", { name: "Insurer comparables" });
    await user.click(insurer);
    expect(onViewChange).toHaveBeenLastCalledWith("insurer");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "Insurer comparables",
    );
    await user.keyboard("{ArrowLeft}");
    expect(onViewChange).toHaveBeenLastCalledWith("market");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "Selected market listings",
    );
    expect(
      screen.getByRole("tab", { name: "Selected market listings" }),
    ).toHaveFocus();
    expect(onViewChange).toHaveBeenCalledTimes(2);
  });

  it("accepts controlled URL state without remounting the focused tab", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    const data = report();
    const { rerender } = render(
      <CaseEvidence report={data} view="market" onViewChange={onViewChange} />,
    );
    const market = screen.getByRole("tab", {
      name: "Selected market listings",
    });
    const insurer = screen.getByRole("tab", { name: "Insurer comparables" });
    market.focus();
    await user.keyboard("{ArrowRight}");
    expect(onViewChange).toHaveBeenLastCalledWith("insurer");
    expect(insurer).toHaveFocus();
    rerender(
      <CaseEvidence report={data} view="insurer" onViewChange={onViewChange} />,
    );
    expect(screen.getByRole("tab", { name: "Insurer comparables" })).toBe(
      insurer,
    );
    expect(insurer).toHaveFocus();
    expect(insurer).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "Insurer comparables",
    );
    rerender(
      <CaseEvidence report={data} view="market" onViewChange={onViewChange} />,
    );
    expect(market).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "Selected market listings",
    );
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it("shows intentional empty states for each evidence view", async () => {
    const data = report();
    render(
      <CaseEvidence
        report={{
          ...data,
          insurerEvidence: {
            ...data.insurerEvidence,
            comparableCount: 0,
            comparables: [],
          },
          marketEvidence: {
            ...data.marketEvidence,
            comparables: [],
            primary: null,
          },
        }}
      />,
    );
    expect(
      screen.getByText("No selected market listings to display"),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "Insurer comparables" }));
    expect(screen.getByText("No insurer comparables to display")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
