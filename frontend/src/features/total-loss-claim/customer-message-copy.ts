import type { TotalLossPublishedReport } from "@/features/total-loss-claim/contracts";

export function normalizeCustomerRequestBody(
  body: string,
  report: TotalLossPublishedReport,
) {
  let normalized = body.replace(
    "I am requesting that Unavailable provide written reconsideration of the vehicle valuation",
    "I am requesting written reconsideration of the vehicle valuation",
  );
  const range = report.conclusion.supportedRange;
  if (range) {
    const valuation = report.conclusion.insurerValuation.formatted;
    const original = `The insurer valuation reviewed was ${valuation}. The enclosed Venfour Total-Loss Valuation Evidence Package supports an advertised-price range of ${range.low.formatted} to ${range.high.formatted}, subject to the assumptions and limitations stated in the report.`;
    const pricesAvailable = [
      report.conclusion.insurerValuation,
      range.low,
      range.high,
    ].every(
      (value) =>
        Number.isSafeInteger(value.amountMinorUnits) &&
        Boolean(value.formatted.trim()) &&
        !/unavailable|not available|not disclosed/iu.test(value.formatted),
    );
    const replacement = pricesAvailable
      ? `The insurer’s valuation was ${valuation}. The attached market evidence includes advertised prices from ${range.low.formatted} to ${range.high.formatted}, subject to the assumptions and limitations stated in the report.`
      : "I reviewed the insurer’s valuation alongside the attached market evidence. The report explains the comparison and its limitations.";
    normalized = normalized.replace(original, replacement);
  }
  return normalized.replace(
    `I have attached ${report.suggestedFilename}.`,
    "I have attached the market evidence report.",
  );
}
