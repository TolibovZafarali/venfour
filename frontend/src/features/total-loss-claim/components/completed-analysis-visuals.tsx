import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";

import type { TotalLossMoney, TotalLossPublishedReport } from "../contracts";
import { displayed, moneyLabel, numeric, roleLabel } from "../report-format";

function available(value: TotalLossMoney | null | undefined): value is TotalLossMoney & { amountMinorUnits: number } {
  return value?.amountMinorUnits != null && Number.isSafeInteger(value.amountMinorUnits) && Boolean(displayed(value.formatted, ""));
}

export function ReviewProgress({ index, total }: { readonly index: number; readonly total: number }) {
  return (
    <div className="review-progress">
      <div className="review-progress-caption"><p aria-label="Review progress">Step {index} of {total}</p><span>Your valuation review</span></div>
      <div className="review-progress-track" role="progressbar" aria-label="Valuation review" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} aria-valuetext={`Step ${index} of ${total}`}>
        <span className="review-progress-fill" style={{ transform: `scaleX(${index / total})` }} />
      </div>
    </div>
  );
}

export function ValueRangeTrack({ report }: { readonly report: TotalLossPublishedReport }) {
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
    <div className="value-range-visual" aria-hidden="true" style={style}>
      <div className="value-range-legend"><span><i />Selected range</span><span><i />Median</span><span><i />Insurer</span></div>
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
      {before ? <div><span>Advertised-price median</span><strong>{moneyLabel(before)}</strong></div> : null}
      {sameSet ? <div className="insurer-adjustment-link"><ArrowRight aria-hidden="true" /><span>Insurer adjustments</span></div> : null}
      {after ? <div><span>Adjusted-value median</span><strong>{moneyLabel(after)}</strong></div> : null}
    </div>
  );
}

export function RepresentativeListings({ report }: { readonly report: TotalLossPublishedReport }) {
  const rows = report.marketEvidence.comparables.slice(0, 3);
  if (!rows.length) return null;
  return (
    <section className="market-listing-preview" aria-label="A closer look at the listings">
      <div className="listing-preview-heading"><h2>A closer look at the listings</h2><span>Advertised prices</span></div>
      <div className="listing-preview-rows">
        {rows.map((row, index) => <article key={`${index}:${row.vehicle}`} className="listing-preview-row">
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
