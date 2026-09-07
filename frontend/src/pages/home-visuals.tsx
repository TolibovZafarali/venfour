import { CarFront } from "lucide-react";

import { homepageExampleAppraisal } from "@/pages/home-example";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ValuationComparisonVisual() {
  const example = homepageExampleAppraisal;

  return (
    <figure data-home-entrance="visual" data-home-order="1" className="home-comparison" aria-label="Example valuation comparison">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-5 sm:px-8">
        <span className="text-xs font-semibold tracking-[0.08em] text-copy uppercase">Valuation, in perspective</span>
        <span className="rounded-md bg-surface px-2.5 py-1 text-xs text-copy">Illustrative example</span>
      </div>
      <div className="p-5 sm:p-8">
        <div className="flex items-center gap-3">
          <CarFront className="size-5 shrink-0 text-copy" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-medium text-ink">{example.vehicle}</p>
        </div>
        <dl className="mt-8 space-y-7">
          <div>
            <dt className="text-sm text-copy">Insurer’s valuation</dt>
            <dd className="mt-1.5 text-[2rem] leading-tight font-semibold tracking-[-0.035em] text-ink tabular-nums sm:text-4xl">{currency.format(example.insuranceValue)}</dd>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full rounded-full bg-slate-400" style={{ width: `${example.insuranceValue / example.askingPrice * 100}%` }} />
            </div>
          </div>
          <div>
            <dt className="text-sm text-copy">A similar vehicle’s asking price</dt>
            <dd className="mt-1.5 text-[2rem] leading-tight font-semibold tracking-[-0.035em] text-brand tabular-nums sm:text-4xl">{currency.format(example.askingPrice)}</dd>
            <div className="mt-3 h-2 rounded-full bg-brand" aria-hidden />
          </div>
        </dl>
        <div className="mt-8 rounded-xl bg-brand-soft p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink">A difference to understand.</p>
          <p className="mt-1.5 text-sm leading-6 text-copy">A higher asking price is a starting point. Vehicle details and more evidence help explain whether the difference matters.</p>
        </div>
        <figcaption className="mt-5 text-xs leading-5 text-copy">Illustrative figures only. Asking prices are not sale prices or a promised settlement.</figcaption>
      </div>
    </figure>
  );
}
