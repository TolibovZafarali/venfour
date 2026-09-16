import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  InsurerEvidenceDetails,
  MarketEvidenceDetails,
  MethodologyDisclosure,
} from "@/features/total-loss-claim/components/case-evidence";
import { moneyLabel } from "@/features/total-loss-claim/report-format";
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

function CaseEvidence({ report }: { report: TotalLossPublishedReport }) {
  return <>
    <InsurerEvidenceDetails report={report} open />
    <MarketEvidenceDetails report={report} open />
    <MethodologyDisclosure report={report} />
  </>;
}

describe("evidence methodology", () => {
  it("keeps methodology collapsed and leaves the complete limitations in the PDF", async () => {
    render(<MethodologyDisclosure report={report()} />);
    expect(
      screen.queryByText("Equipment details are limited for some listings."),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByText("Evidence dates and methodology"));
    expect(
      screen.getByText("Your valuation report contains the complete methodology, limitations, and technical evidence."),
    ).toBeVisible();
    expect(screen.getByText("Aug 1, 2026")).toBeVisible();
    expect(screen.getByText("Aug 28, 2026")).toBeVisible();
    expect(screen.getByText("Not stated")).toBeVisible();
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
      .click(screen.getByText("Evidence dates and methodology"));
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
  it("keeps a Take Price distinct from advertised evidence", () => {
    const data = report();
    const comparable = data.insurerEvidence.comparables[0];
    render(<InsurerEvidenceDetails open report={{ ...data, insurerEvidence: {
      ...data.insurerEvidence,
      comparables: [{ ...comparable, advertisedPrice: null, sourcePrice: {
        amount: "$25,541", type: "TAKE", typeLabel: "Take Price", label: "Take Price",
      } }],
    } }} />);
    const vehicle = screen.getByRole("group", { name: "2022 Insurer Vehicle 1" });
    expect(within(vehicle).getByText("Take Price")).toBeVisible();
    expect(within(vehicle).getByText("$25,541")).toBeVisible();
    expect(within(vehicle).queryByText("Asking price")).not.toBeInTheDocument();
  });

  it("keeps every selected market listing and source detail in backend order", () => {
    render(<CaseEvidence report={report()} />);
    const listings = screen.getByRole("region", { name: "Vehicle listings" });
    const rows = within(listings).getAllByRole("group");
    expect(rows.map(row => row.getAttribute("aria-label"))).toEqual(Array.from({ length: 7 }, (_, index) => `2022 Market Vehicle ${index + 1}`));
    const first = rows[0];
    for (const value of ["$21,000", "12.5 miles", "Dealer 1", "Aug 28, 2026", "Current listing", "Used in this comparison"]) {
      expect(within(first).getByText(value)).toBeVisible();
    }
    expect(within(first).getByText("31,500 miles · Chicago, IL")).toBeVisible();
    expect(screen.getByText("Dealer 7")).toBeVisible();
    expect(screen.queryByText("PRIMARY")).not.toBeInTheDocument();
    expect(screen.queryByText("CURRENT_MARKET")).not.toBeInTheDocument();
  });

  it("preserves every insurer adjustment and distinguishes non-disclosure from unavailability", async () => {
    const data = report();
    render(<CaseEvidence report={{
      ...data,
      insurerEvidence: {
        ...data.insurerEvidence,
        comparables: data.insurerEvidence.comparables.map((comparable, index) => index === 0 ? {
          ...comparable,
          adjustments: { condition: "-$120", mileage: "$200", options: "$0", package: "$450" },
        } : comparable),
      },
    }} />);
    const vehicles = screen.getAllByRole("group");
    expect(vehicles.filter(row => row.classList.contains("insurer-vehicle"))).toHaveLength(7);
    const first = screen.getByRole("group", { name: "2022 Insurer Vehicle 1" });
    await userEvent.setup().click(within(first).getByText("2022 Insurer Vehicle 1"));
    for (const value of ["30,000 miles", "$18,500", "$18,000", "-$120", "$200", "$0", "$450", "25%", "Not disclosed"]) {
      expect(within(first).getByText(value)).toBeVisible();
    }
    expect(within(first).getByText("Adjustment details: not disclosed.")).toBeVisible();
    const second = screen.getByRole("group", { name: "2022 Insurer Vehicle 2" });
    await userEvent.setup().click(within(second).getByText("2022 Insurer Vehicle 2"));
    expect(within(second).getByText("Adjustment details: details not provided.")).toBeVisible();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("preserves unknown fields without fabricating zero values", () => {
    const data = report();
    render(<CaseEvidence report={{
      ...data,
      marketEvidence: {
        ...data.marketEvidence,
        comparables: [{
          vehicle: null,
          mileage: null,
          advertisedPrice: "Unavailable",
          distanceMiles: 0,
          dealer: "unknown",
          location: null,
          evidenceDate: null,
          temporalBasis: null,
          role: null,
        }],
      },
    }} />);
    const row = screen.getByRole("group", { name: "Vehicle listing 1" });
    expect(within(row).getByText("Mileage not provided · Location not provided")).toBeVisible();
    expect(within(row).getByText("0 miles")).toBeVisible();
    expect(within(row).getAllByText("Not provided")).toHaveLength(2);
    expect(within(row).getByText("Comparison role not specified")).toBeVisible();
    expect(within(row).queryByText("$0")).not.toBeInTheDocument();

  });

  it("opens each evidence source only through explicit inspection", async () => {
    render(<><InsurerEvidenceDetails report={report()} /><MarketEvidenceDetails report={report()} /></>);
    expect(screen.getByText("Dealer 7")).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("2022 Market Vehicle 7"));
    expect(screen.getByText("Dealer 7")).toBeVisible();
    expect(screen.getByText("2022 Insurer Vehicle 1")).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("See the vehicles they used"));
    expect(screen.getByText("2022 Insurer Vehicle 1")).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("shows empty states for both evidence sources without hiding the methodology", async () => {
    const data = report();
    render(<CaseEvidence report={{
      ...data,
      insurerEvidence: { ...data.insurerEvidence, comparableCount: 0, comparables: [] },
      marketEvidence: { ...data.marketEvidence, comparables: [], primary: null },
    }} />);
    expect(screen.getByText("No vehicle listings were available to show.")).toBeVisible();
    expect(screen.getByText("Vehicle details weren’t available in the report.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("Evidence dates and methodology"));
    expect(screen.getByText("Your valuation report contains the complete methodology, limitations, and technical evidence.")).toBeVisible();
  });

  it("keeps missing money distinct from a stored zero amount", () => {
    expect(moneyLabel(money(null))).toBe("Not stated");
    expect(moneyLabel({ ...money(null), formatted: "$0" })).toBe("Not stated");
    expect(moneyLabel(money(0))).toBe("$0");
    expect(moneyLabel(undefined)).toBe("Not stated");
  });

  it("keeps deeper insurer ranges in optional details and omits incomplete ranges", async () => {
    const data = report();
    render(<InsurerEvidenceDetails report={{
      ...data,
      insurerEvidence: {
        ...data.insurerEvidence,
        summary: {
          ...data.insurerEvidence.summary,
          advertisedPrices: { count: 2, low: money(1800000), high: money(2000000), median: money(1900000) },
          adjustedValues: { count: 2, low: null, high: money(1800000), median: money(1800000) },
        },
      },
    }} />);
    expect(screen.getByText("Disclosed advertised prices ranged from $18,000 to $20,000.")).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("See the vehicles they used"));
    expect(screen.getByText("Disclosed advertised prices ranged from $18,000 to $20,000.")).toBeVisible();
    expect(screen.queryByText(/Disclosed adjusted values ranged/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unavailable|Not stated to/u)).not.toBeInTheDocument();
  });
});
