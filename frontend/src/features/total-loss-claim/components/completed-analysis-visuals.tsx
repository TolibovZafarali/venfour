import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

import { useCompletedReviewProgressHost } from "@/components/completed-review-progress-host";
import type { TotalLossCaseJourneyProgress } from "../case-journey";
import type { CaseWorkspaceSection } from "../case-workspace";
import type { TotalLossMoney, TotalLossPublishedReport } from "../contracts";
import { displayed, moneyLabel } from "../report-format";

function available(value: TotalLossMoney | null | undefined): value is TotalLossMoney & { amountMinorUnits: number } {
  return value?.amountMinorUnits != null && Number.isSafeInteger(value.amountMinorUnits) && Boolean(displayed(value.formatted, ""));
}

export function CaseJourneyProgress({
  progress,
  sections,
}: {
  readonly progress: TotalLossCaseJourneyProgress;
  readonly sections: readonly CaseWorkspaceSection[];
}) {
  const headerHost = useCompletedReviewProgressHost();
  const currentIndex = Math.max(0, sections.findIndex((section) => section.current));
  const progressValue = progress.isCaseClosed ? sections.length : currentIndex + 0.5;
  const valueText = progress.isCaseClosed ? "Case complete." : progress.isCaseActive
    ? `Current stage: ${progress.current.label}. Case active.`
    : `Step ${currentIndex + 1} of ${sections.length}: ${progress.current.label}`;
  const progressBar = (
    <div
      className="review-progress-track"
      role="progressbar"
      aria-label="Case journey"
      aria-valuemin={0}
      aria-valuemax={sections.length}
      aria-valuenow={progressValue}
      aria-valuetext={valueText}
      data-case-active={progress.isCaseActive || undefined}
      data-current-step={progress.current.id}
    >
      <span className="review-progress-fill" style={{ transform: `scaleX(${progressValue / sections.length})` }} />
    </div>
  );
  return headerHost ? createPortal(progressBar, headerHost) : progressBar;
}

export function ValueRangeTrack({ report, valueLabel = "Insurer" }: { readonly report: TotalLossPublishedReport; readonly valueLabel?: string }) {
  const value = report.conclusion.insurerValuation;
  const range = report.conclusion.supportedRange;
  if (!range || !available(value) || !available(range.low) || !available(range.high) || !available(range.median)) return null;
  if (![range.low, range.high, range.median].every((money) => money.currency === value.currency)) return null;
  const low = range.low.amountMinorUnits;
  const high = range.high.amountMinorUnits;
  const median = range.median.amountMinorUnits;
  if (low > high || median < low || median > high) return null;
  const min = Math.min(value.amountMinorUnits, low);
  const max = Math.max(value.amountMinorUnits, high);
  const span = max - min;
  const point = (amount: number) => span ? 6 + ((amount - min) / span) * 88 : 50;
  const style = {
    "--range-start": `${point(low)}%`,
    "--range-width": `${point(high) - point(low)}%`,
    "--range-median": `${point(median)}%`,
    "--range-offer": `${point(value.amountMinorUnits)}%`,
  } as CSSProperties;
  return (
    <div className="value-range-visual" data-review-entrance="supporting" data-review-order="1" aria-hidden="true" style={style}>
      <div className="value-range-legend"><span><i />Selected range</span><span><i />Median</span><span><i />{valueLabel}</span></div>
      <div className="value-range-axis"><span className="value-range-band" /><span className="value-range-median" /><span className="value-range-offer" /></div>
    </div>
  );
}

export function ResultComparisonDiagram({ report, manual, caption }: {
  readonly report: TotalLossPublishedReport;
  readonly manual: boolean;
  readonly caption?: string;
}) {
  const value = report.conclusion.insurerValuation;
  const range = report.conclusion.supportedRange;
  if (!range || !available(value) || !available(range.low) || !available(range.high)) return null;
  if (range.low.currency !== value.currency || range.high.currency !== value.currency) return null;
  const low = range.low.amountMinorUnits;
  const high = range.high.amountMinorUnits;
  if (low > high) return null;
  const min = Math.min(value.amountMinorUnits, low);
  const max = Math.max(value.amountMinorUnits, high);
  const point = (amount: number) => max === min ? 50 : 6 + ((amount - min) / (max - min)) * 88;
  const position = value.amountMinorUnits < low ? "below" : value.amountMinorUnits > high ? "above" : "within";
  const label = manual ? "The offer you entered" : "Your insurer’s value";
  const description = `${label} is ${position} this asking-price range.`;
  const style = {
    "--comparison-start": `${point(low)}%`,
    "--comparison-width": `${point(high) - point(low)}%`,
    "--comparison-value": `${point(value.amountMinorUnits)}%`,
  } as CSSProperties;
  return <figure className="result-comparison" style={style}>
    <div className="result-comparison-legend" aria-hidden="true">
      <span><i className="result-comparison-key-value" />{manual ? "Offer you entered" : "Insurer’s value"}</span>
      <span><i className="result-comparison-key-range" />Similar vehicles’ asking prices</span>
    </div>
    <div className="result-comparison-chart" data-single-price={low === high || undefined} role="img" aria-label={`${description} ${label}: ${moneyLabel(value)}. Asking prices: ${moneyLabel(range.low)} to ${moneyLabel(range.high)}.`}>
      <span className="result-comparison-range" />
      <span className="result-comparison-point" />
    </div>
    <div className="result-comparison-direction" aria-hidden="true"><span>Lower prices</span><span>Higher prices</span></div>
    <figcaption>{caption ?? description}</figcaption>
  </figure>;
}

export function InsurerValueBridge({ report }: { readonly report: TotalLossPublishedReport }) {
  const count = report.insurerEvidence.comparableCount;
  const summary = report.insurerEvidence.summary;
  const hasChanges = summary.fullyDisclosedAdjustmentCount > 0 || summary.partiallyDisclosedAdjustmentCount > 0;
  const value = report.conclusion.insurerValuation;
  return <div className="insurer-calculation">
    {count > 0 ? <ol aria-label="How to read your insurer’s calculation">
      <li data-review-entrance="secondary" data-review-order="0"><span className="insurer-calculation-label">Vehicles in their report</span><strong>{count.toLocaleString("en-US")} {count === 1 ? "vehicle" : "vehicles"}</strong><span>Used for comparison</span><ArrowRight aria-hidden="true" /></li>
      <li data-review-entrance="secondary" data-review-order="1"><span className="insurer-calculation-label">Changes for differences</span><strong>{hasChanges ? "Price changes" : "Details unavailable"}</strong><span>{hasChanges ? "See the changes listed below" : "Not available for this review"}</span><ArrowRight aria-hidden="true" /></li>
      <li data-review-entrance="secondary" data-review-order="2"><span className="insurer-calculation-label">Your vehicle’s value</span><strong>{available(value) ? moneyLabel(value) : "Not provided"}</strong><span>Original value in their report</span></li>
    </ol> : <div className="insurer-calculation-value" data-review-entrance="secondary"><span>Your insurer’s original value</span><strong>{available(value) ? moneyLabel(value) : "Not provided"}</strong></div>}
  </div>;
}

export function RecordedTime({ value, dateOnly = false }: { readonly value: string; readonly dateOnly?: boolean }) {
  const date = new Date(value);
  const label = Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", ...(dateOnly ? {} : { timeStyle: "short" as const }) }).format(date);
  return <time dateTime={value}>{label}</time>;
}
