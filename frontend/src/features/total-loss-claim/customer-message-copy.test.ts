import { describe, expect, it } from "vitest";

import { normalizeCustomerRequestBody } from "@/features/total-loss-claim/customer-message-copy";
import type { TotalLossPublishedReport } from "@/features/total-loss-claim/contracts";

const report = {
  conclusion: {
    insurerValuation: { amountMinorUnits: 1904600, formatted: "$19,046" },
    supportedRange: {
      low: { amountMinorUnits: 1980000, formatted: "$19,800" },
      high: { amountMinorUnits: 2226300, formatted: "$22,263" },
    },
  },
  suggestedFilename: "Venfour_Valuation_Evidence_Example_v1.pdf",
} as TotalLossPublishedReport;

const generated = [
  "Hello Claims Representative,",
  "I am requesting that Unavailable provide written reconsideration of the vehicle valuation for claim CLM-42 involving my vehicle.",
  "The insurer valuation reviewed was $19,046. The enclosed Venfour Total-Loss Valuation Evidence Package supports an advertised-price range of $19,800 to $22,263, subject to the assumptions and limitations stated in the report.",
  "I have attached Venfour_Valuation_Evidence_Example_v1.pdf. Please review the evidence and reconsider the valuation in writing.",
  "Thank you,\nCase Owner",
].join("\n\n");

describe("customer request copy", () => {
  it("turns only the generated language into an owner-voiced evidence request", () => {
    const normalized = normalizeCustomerRequestBody(generated, report);
    expect(normalized).not.toMatch(/Venfour|Unavailable/u);
    expect(normalized).toContain(
      "I am requesting written reconsideration of the vehicle valuation for claim CLM-42",
    );
    expect(normalized).toContain("The insurer’s valuation was $19,046.");
    expect(normalized).toContain(
      "The attached market evidence includes advertised prices from $19,800 to $22,263, subject to the assumptions and limitations stated in the report.",
    );
    expect(normalized).toContain("I have attached the market evidence report.");
    expect(normalized).not.toContain("I found");
  });

  it("preserves customer-written mentions of the company and changed evidence paragraphs", () => {
    const custom =
      "I chose Venfour to help organize my evidence.\n\nThe enclosed Venfour Total-Loss Valuation Evidence Package helped me compare the mileage differences.\n\nPlease reference Venfour_Valuation_Evidence_Example_v1.pdf in your reply.";
    expect(normalizeCustomerRequestBody(custom, report)).toBe(custom);
  });

  it("preserves added customer paragraphs and is safe to apply again", () => {
    const body = `Please also correct the recorded mileage.\n\n${generated}\n\nCall me if you need a clearer photo.`;
    const normalized = normalizeCustomerRequestBody(body, report);
    expect(normalized).toContain("Please also correct the recorded mileage.");
    expect(normalized).toContain("Call me if you need a clearer photo.");
    expect(normalizeCustomerRequestBody(normalized, report)).toBe(normalized);
  });

  it.each(["insurer", "low", "high"] as const)(
    "omits prices from the exact generated paragraph when the %s fact is missing",
    (missingFact) => {
      const incomplete = structuredClone(report);
      const value =
        missingFact === "insurer"
          ? incomplete.conclusion.insurerValuation
          : incomplete.conclusion.supportedRange![missingFact];
      const originalDisplay = value.formatted;
      Object.assign(
        value,
        missingFact === "low"
          ? { formatted: "Unavailable" }
          : missingFact === "insurer"
            ? { amountMinorUnits: null }
            : { amountMinorUnits: null, formatted: "Unavailable" },
      );
      const body = `My opening note.\n\n${generated.replaceAll(originalDisplay, value.formatted)}\n\nMy closing note.`;
      const normalized = normalizeCustomerRequestBody(body, incomplete);
      expect(normalized).toContain(
        "I reviewed the insurer’s valuation alongside the attached market evidence. The report explains the comparison and its limitations.",
      );
      expect(normalized).not.toMatch(/Unavailable|\$19,046|\$19,800|\$22,263/u);
      expect(normalized).toContain("My opening note.");
      expect(normalized).toContain("My closing note.");
      const custom =
        "My revised valuation paragraph: I am still checking these prices.";
      expect(normalizeCustomerRequestBody(custom, incomplete)).toBe(custom);
    },
  );

  it("never supplies range figures when the current report has none", () => {
    const withoutRange = {
      ...report,
      conclusion: { ...report.conclusion, supportedRange: null },
    };
    expect(
      normalizeCustomerRequestBody(
        "Please reconsider the valuation.",
        withoutRange,
      ),
    ).toBe("Please reconsider the valuation.");
  });
});
