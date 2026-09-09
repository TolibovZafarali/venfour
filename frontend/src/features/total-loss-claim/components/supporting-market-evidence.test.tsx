import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TotalLossPublishedReport } from "../contracts";
import { HigherPricedListings, MarketSearchLimitations } from "./case-evidence";

const disclosure = "These deliberately selected higher asking prices are supporting examples, not typical market prices or verified sale prices. They do not change the broader market valuation or establish a guaranteed increase.";
function report(): Pick<TotalLossPublishedReport, "marketEvidence"> {
  return {
    marketEvidence: {
      comparables: [], primary: null, secondary: null, methodologyStatement: null,
      evidenceDateContext: { currentObservedDate: null, historicalEvidenceDate: null, lossDate: null },
      marketSearchContext: {
        baselineStatus: "LIMITED", summary: "The search found limited comparable evidence. An incomplete search does not establish that the insurer's value is fair.",
        stopReasons: [{ stream: "current", code: "BUDGET_OR_QUOTA_LIMITED", description: "The search stopped at its available request allowance." }],
      },
      higherPricedComparableListings: {
        title: "Higher-priced comparable listings", disclosure, affectsBaselineValuation: false, searchStatus: "REUSED_VERIFIED_EVIDENCE",
        listings: [{
          identity: "synthetic-vin", vehicle: "2022 Synthetic Touring", mileage: 50_000,
          askingPriceCents: 2_400_000, askingPriceDisplay: "$24,000.00", distanceMiles: 20,
          relevantDate: "2026-08-01", temporalBasis: "Loss-date historical listing", source: "synthetic-provider", priceSource: "history",
          listingUrl: "https://synthetic.invalid/listing", matchingFacts: [{ label: "Engine", value: "2.0L" }], materialDifferences: [],
          limitations: ["The asking price is not a verified completed-sale price.", "Warranty benefits were not fully verified and are not used to justify this listing's premium."], reasonCodes: ["STRICT_VERIFIED_MATCH"],
        }],
      },
    },
  };
}

describe("separate supporting market evidence", () => {
  it("shows asking price, temporal source, distance and unknown benefits without a valuation claim", () => {
    render(<HigherPricedListings report={report()} />);
    const section = screen.getByRole("region", { name: "Higher-priced comparable listings" });
    expect(within(section).getByText(disclosure)).toBeVisible();
    expect(within(section).getByText("$24,000.00")).toBeVisible();
    expect(within(section).getByText(/20 miles from you/)).toBeVisible();
    expect(within(section).getByText(/Loss-date historical listing/)).toBeVisible();
    expect(within(section).getByText(/Warranty benefits were not fully verified/)).toBeVisible();
    expect(within(section).getByRole("link", { name: "View listing source" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/fair value|likely increase/i)).not.toBeInTheDocument();
  });

  it("keeps limited-search qualifications visible without declaring the offer fair", () => {
    render(<MarketSearchLimitations report={report()} />);
    expect(screen.getByText(/does not establish that the insurer's value is fair/)).toBeVisible();
    expect(screen.getByText(/available request allowance/)).toBeVisible();
  });

  it("omits unavailable optional examples from legacy reports", () => {
    const legacy = report();
    const withoutExamples = { ...legacy, marketEvidence: { ...legacy.marketEvidence, higherPricedComparableListings: undefined, marketSearchContext: undefined } };
    const { container } = render(<><HigherPricedListings report={withoutExamples} /><MarketSearchLimitations report={withoutExamples} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});
