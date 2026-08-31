import type { TotalLossMoney } from "./contracts";

const REPORT_LABELS: Readonly<Record<string, string>> = {
  MATERIAL_UNDERVALUE_SIGNAL: "Material undervaluation signal",
  MATERIAL_UNDERVALUATION_SIGNAL: "Material undervaluation signal",
  POTENTIAL_UNDERVALUE: "Potential undervaluation signal",
  POTENTIAL_UNDERVALUATION_SIGNAL: "Potential undervaluation signal",
  NO_MATERIAL_DISCREPANCY: "No material discrepancy identified",
  NO_MATERIAL_DISCREPANCY_IDENTIFIED: "No material discrepancy identified",
  NO_MATERIAL_DISCREPANCY_DETECTED: "No material discrepancy identified",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  CONFLICTING_EVIDENCE: "Conflicting market evidence",
  CONFLICTING_MARKET_EVIDENCE: "Conflicting market evidence",
  CURRENT_MARKET: "current market",
  LOSS_DATE_HISTORICAL: "historical evidence from around the loss date",
  BELOW_OBSERVED_RANGE: "below the selected range",
  WITHIN_OBSERVED_RANGE: "within the selected range",
  ABOVE_OBSERVED_RANGE: "above the selected range",
};

export function reportText(value: string) {
  return value
    .replace(
      /\b[A-Z]+(?:_[A-Z]+)+\b/gu,
      (code) => REPORT_LABELS[code] ?? "details in the evidence package",
    )
    .replace(/The deterministic assessment/gu, "The completed review")
    .replace(/\bunavailable\b/giu, "not provided");
}

export function displayed(
  value: string | null | undefined,
  fallback = "—",
) {
  return value && !/^(unavailable|unknown|not available)$/iu.test(value.trim())
    ? reportText(value)
    : fallback;
}

export function moneyLabel(value: TotalLossMoney | null | undefined) {
  return value?.amountMinorUnits === null
    ? "Not stated"
    : displayed(value?.formatted, "Not stated");
}

export function dateLabel(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? "Not stated"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

export function numeric(value: number | null, suffix = "") {
  return value === null
    ? "—"
    : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`;
}

export function disclosureLabel(value: string | null) {
  if (value === null) return "Not stated";
  const key = value.toLowerCase().replace(/_/gu, " ");
  if (["none", "undisclosed", "not disclosed"].includes(key))
    return "Not disclosed";
  if (["partial", "partially disclosed"].includes(key))
    return "Partially disclosed";
  if (["full", "fully disclosed"].includes(key)) return "Fully disclosed";
  if (key === "unavailable") return "Details not provided";
  return /^[A-Z][A-Z_]+$/u.test(value) ? "Not stated" : reportText(value);
}

export function temporalLabel(value: string | null) {
  if (!value) return "Not stated";
  if (/historical|loss.date/iu.test(value)) return "Historical listing";
  if (/current/iu.test(value)) return "Current listing";
  return /^[A-Z][A-Z_]+$/u.test(value) ? "See evidence package" : reportText(value);
}

export function roleLabel(value: string | null) {
  if (!value) return "Not stated";
  if (/primary/iu.test(value)) return "Primary comparison evidence";
  if (/secondary/iu.test(value)) return "Additional context evidence";
  return /^[A-Z][A-Z_]+$/u.test(value) ? "Selected evidence" : reportText(value);
}
