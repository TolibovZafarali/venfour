import { CarFront } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { homepageExampleAppraisal } from "@/pages/home-example";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function ExampleAmount({ value }: { value: number }) {
  const amountRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const amount = amountRef.current;
    const figure = amount?.closest<HTMLElement>(".home-comparison");
    const row = amount?.closest<HTMLElement>(".home-comparison-row");
    if (!amount || !figure || !row) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let started = false;
    const finish = () => {
      cancelAnimationFrame(frame);
      amount.textContent = currency.format(value);
    };
    const sync = () => {
      if (motion.matches || !figure.dataset.scrollReveal) {
        finish();
        return;
      }
      if (started) return;
      amount.textContent = currency.format(0);
      if (figure.dataset.scrollReveal !== "entering") return;
      started = true;
      const delay = Number.parseFloat(getComputedStyle(row).getPropertyValue("--comparison-delay")) || 0;
      const start = performance.now() + delay + 100;
      const tick = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - start) / 520));
        const eased = 1 - Math.pow(1 - progress, 3);
        amount.textContent = currency.format(Math.round(value * eased));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const observer = new MutationObserver(sync);
    observer.observe(figure, { attributes: true, attributeFilter: ["data-scroll-reveal"] });
    motion.addEventListener("change", sync);
    sync();
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", sync);
      finish();
    };
  }, [value]);

  return (
    <>
      <span className="sr-only">{currency.format(value)}</span>
      <span ref={amountRef} aria-hidden="true">{currency.format(value)}</span>
    </>
  );
}

export function ValuationComparisonVisual() {
  const example = homepageExampleAppraisal;

  return (
    <figure data-home-entrance="visual" data-home-order="1" className="home-comparison" aria-label="Example valuation comparison">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-5 sm:px-8">
        <span className="text-xs font-semibold tracking-[0.08em] text-copy uppercase">Valuation, in perspective</span>
        <span className="rounded-md bg-surface px-2.5 py-1 text-xs text-copy">Illustrative example</span>
      </div>
      <div className="p-5 sm:p-8">
        <div className="home-comparison-intro flex items-center gap-3">
          <CarFront className="size-5 shrink-0 text-copy" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-medium text-ink">{example.vehicle}</p>
        </div>
        <dl className="mt-8 space-y-7">
          <div className="home-comparison-row">
            <dt className="text-sm text-copy">Insurer’s valuation</dt>
            <dd className="mt-1.5 text-[2rem] leading-tight font-semibold tracking-[-0.035em] text-ink tabular-nums sm:text-4xl"><ExampleAmount value={example.insuranceValue} /></dd>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="home-comparison-bar h-full rounded-full bg-slate-400" style={{ width: `${example.insuranceValue / example.askingPrice * 100}%` }} />
            </div>
          </div>
          <div className="home-comparison-row">
            <dt className="text-sm text-copy">A similar vehicle’s asking price</dt>
            <dd className="mt-1.5 text-[2rem] leading-tight font-semibold tracking-[-0.035em] text-brand tabular-nums sm:text-4xl"><ExampleAmount value={example.askingPrice} /></dd>
            <div className="home-comparison-bar mt-3 h-2 rounded-full bg-brand" aria-hidden />
          </div>
        </dl>
        <div className="home-comparison-note mt-8 rounded-xl bg-brand-soft p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink">A difference to understand.</p>
          <p className="mt-1.5 text-sm leading-6 text-copy">A higher asking price is a starting point. Vehicle details and more evidence help explain whether the difference matters.</p>
        </div>
        <figcaption className="mt-5 text-xs leading-5 text-copy">Illustrative figures only. Asking prices are not sale prices or a promised settlement.</figcaption>
      </div>
    </figure>
  );
}
