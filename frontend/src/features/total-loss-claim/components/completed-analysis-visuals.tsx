import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

import { useCompletedReviewProgressHost } from "@/components/completed-review-progress-host";
import type { TotalLossCaseJourneyProgress } from "../case-journey";
import type { CaseWorkspaceSection } from "../case-workspace";
import type { TotalLossMoney, TotalLossPublishedReport } from "../contracts";
import { displayed, moneyLabel, numeric, roleLabel } from "../report-format";

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

export function InsurerValueBridge({ report }: { readonly report: TotalLossPublishedReport }) {
  const { advertisedPrices, adjustedValues } = report.insurerEvidence.summary;
  const before = advertisedPrices?.count && available(advertisedPrices.median) ? advertisedPrices.median : null;
  const after = adjustedValues?.count && available(adjustedValues.median) ? adjustedValues.median : null;
  const sameSet = before && after && advertisedPrices?.count === report.insurerEvidence.comparableCount && adjustedValues?.count === report.insurerEvidence.comparableCount && before.currency === after.currency;
  if (!before && !after) return null;
  return (
    <div className="insurer-value-bridge" data-connected={Boolean(sameSet)}>
      {before ? <div data-review-entrance="secondary" data-review-order="0"><span>Advertised-price median</span><strong>{moneyLabel(before)}</strong></div> : null}
      {sameSet ? <div className="insurer-adjustment-link" data-review-entrance="secondary" data-review-order="1"><ArrowRight aria-hidden="true" /><span>Insurer adjustments</span></div> : null}
      {after ? <div data-review-entrance="secondary" data-review-order="2"><span>Adjusted-value median</span><strong>{moneyLabel(after)}</strong></div> : null}
    </div>
  );
}

export function RepresentativeListings({ report }: { readonly report: TotalLossPublishedReport }) {
  const rows = report.marketEvidence.comparables.slice(0, 3);
  if (!rows.length) return null;
  return (
    <section className="market-listing-preview" aria-label="A closer look at the listings">
      <div className="listing-preview-heading" data-review-entrance="supporting" data-review-order="0"><h2>A closer look at the listings</h2><span>Advertised prices</span></div>
      <div className="listing-preview-rows">
        {rows.map((row, index) => <article key={`${index}:${row.vehicle}`} className="listing-preview-row" data-review-entrance="supporting" data-review-order={index + 1}>
          <div className="listing-preview-identity"><span className="listing-preview-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h3>{displayed(row.vehicle, `Selected listing ${index + 1}`)}</h3><p>{numeric(row.mileage, " mi")}<span aria-hidden="true"> · </span>{displayed(row.location)}</p></div></div>
          <div className="listing-preview-source"><p>{displayed(row.dealer)}</p><span>{roleLabel(row.role)}</span></div>
          <strong className="listing-preview-price">{displayed(row.advertisedPrice)}</strong>
        </article>)}
      </div>
    </section>
  );
}

export function RecordedTime({ value }: { readonly value: string }) {
  const date = new Date(value);
  const label = Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
  return <time dateTime={value}>{label}</time>;
}
