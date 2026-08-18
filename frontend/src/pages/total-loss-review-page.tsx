import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { StartAnalysisForm } from "@/features/analyses/components/start-analysis-form";

export function TotalLossReviewPage() {
  const [cccSelected, setCccSelected] = useState(false);
  const formRegionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (cccSelected) {
      const formRegion = formRegionRef.current;
      formRegion?.focus({ preventScroll: true });
      if (typeof formRegion?.scrollIntoView === "function") {
        formRegion.scrollIntoView({
          behavior:
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          block: "start",
        });
      }
    }
  }, [cccSelected]);

  return (
    <div className="w-full bg-white text-ink">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
          <Link
            to="/#services"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-copy transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 motion-reduce:transition-none"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to services
          </Link>
          <h1 className="mt-5 max-w-3xl text-[2.5rem] leading-[1.06] font-semibold tracking-[-0.04em] text-balance text-ink sm:text-[3.25rem]">
            Review your total-loss valuation
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-copy sm:text-lg sm:leading-8">
            Upload your insurer’s valuation report and enter the ZIP code where
            the vehicle was located.
          </p>
        </div>
      </div>

      <section
        className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16"
        aria-labelledby="report-format-title"
      >
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.13em] text-brand uppercase">
            Report format
          </p>
          <h2
            id="report-format-title"
            className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl"
          >
            Which report do you have?
          </h2>
        </div>

        <div className="mt-7 grid border-y border-line md:grid-cols-2 md:divide-x md:divide-line">
          <button
            type="button"
            className={`group flex min-h-52 w-full flex-col items-start px-1 py-6 text-left outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset motion-reduce:transition-none sm:px-5 md:px-7 ${
              cccSelected ? "bg-brand-soft" : "bg-white"
            }`}
            aria-pressed={cccSelected}
            aria-controls="ccc-review-form"
            onClick={() => setCccSelected(true)}
          >
            <span className="text-xs font-semibold text-brand">01</span>
            <span className="mt-6 text-xl font-semibold tracking-[-0.025em] text-ink sm:text-2xl">
              CCC valuation report
            </span>
            <span className="mt-2 text-sm leading-6 text-copy">
              Use the automated PDF review.
            </span>
            <span className="mt-auto inline-flex min-h-11 items-center gap-2 pt-5 text-sm font-semibold text-brand group-hover:text-brand-strong">
              {cccSelected ? (
                "Selected"
              ) : (
                <>
                  Choose CCC report
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden
                  />
                </>
              )}
            </span>
          </button>

          <Link
            to="/contact?topic=report-format"
            className="group flex min-h-52 flex-col items-start border-t border-line px-1 py-6 outline-none transition-colors hover:bg-surface focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset motion-reduce:transition-none sm:px-5 md:border-t-0 md:px-7"
          >
            <span className="text-xs font-semibold text-brand">02</span>
            <span className="mt-6 text-xl font-semibold tracking-[-0.025em] text-ink sm:text-2xl">
              Another report or not sure
            </span>
            <span className="mt-2 text-sm leading-6 text-copy">
              Ask about a different report format.
            </span>
            <span className="mt-auto inline-flex min-h-11 items-center gap-2 pt-5 text-sm font-semibold text-brand group-hover:text-brand-strong">
              Request help
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden
              />
            </span>
          </Link>
        </div>
      </section>

      {cccSelected ? (
        <section
          ref={formRegionRef}
          id="ccc-review-form"
          className="section-anchor scroll-mt-20 border-t border-line bg-surface"
          aria-labelledby="ccc-review-title"
          tabIndex={-1}
        >
          <div className="mx-auto grid w-full max-w-6xl gap-9 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(17rem,0.54fr)_minmax(28rem,1fr)] lg:items-start lg:gap-16 lg:py-20">
            <div className="max-w-lg lg:sticky lg:top-24">
              <p className="text-xs font-semibold tracking-[0.13em] text-brand uppercase">
                Supported online
              </p>
              <h2
                id="ccc-review-title"
                data-anchor-heading
                className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
              >
                Start your CCC review
              </h2>
              <p className="mt-4 text-base leading-7 text-copy">
                Use the original valuation PDF from your insurer. Venfour will
                organize the report and compare it with relevant market
                evidence.
              </p>
              <p className="mt-5 border-t border-line pt-5 text-sm leading-6 text-copy">
                This is informational vehicle-market analysis, not legal advice
                or a guaranteed settlement.
              </p>
            </div>

            <div className="w-full max-w-[35rem] lg:justify-self-end">
              <StartAnalysisForm />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
