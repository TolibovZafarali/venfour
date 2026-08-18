import { ArrowLeft, Check } from "lucide-react";
import { Link } from "react-router";

import { StartAnalysisForm } from "@/features/analyses/components/start-analysis-form";

const expectations = [
  "Original PDF from your insurance company",
  "Vehicle ZIP code for the local market",
  "A few minutes to prepare the appraisal",
] as const;

export function TotalLossReviewPage() {
  return (
    <div className="w-full bg-canvas text-ink">
      <div className="border-b border-slate-300 bg-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
          <Link
            to="/#total-loss"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-copy transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 motion-reduce:transition-none"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to total loss
          </Link>
          <h1 className="mt-5 max-w-3xl text-[2.55rem] leading-[1.04] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-[3.6rem]">
            Upload your insurance value report
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-copy sm:text-lg sm:leading-8">
            Upload the report your insurance company sent you and enter the vehicle’s ZIP code.
          </p>
        </div>
      </div>

      <section
        className="mx-auto grid w-full max-w-6xl gap-9 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(17rem,0.58fr)_minmax(28rem,1fr)] lg:items-start lg:gap-16 lg:py-20"
        aria-labelledby="start-appraisal-title"
      >
        <div className="max-w-lg lg:sticky lg:top-24">
          <p className="text-xs font-semibold tracking-[0.13em] text-brand uppercase">
            Total-Loss Appraisal
          </p>
          <h2
            id="start-appraisal-title"
            className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
          >
            Start with the report you received
          </h2>
          <p className="mt-4 text-base leading-7 text-copy">
            Venfour reads the report, checks similar vehicles, and organizes the result for you.
          </p>
          <ul className="mt-7 space-y-3 border-t border-slate-300 pt-6">
            {expectations.map((expectation) => (
              <li
                key={expectation}
                className="flex items-start gap-3 text-sm leading-6 text-copy"
              >
                <Check
                  className="mt-1 size-4 shrink-0 text-market-strong"
                  aria-hidden
                />
                {expectation}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm leading-6 text-copy">
            If the report cannot be processed reliably, Venfour will explain that clearly instead of creating an appraisal.
          </p>
        </div>

        <div className="w-full max-w-[35rem] lg:justify-self-end">
          <StartAnalysisForm />
        </div>
      </section>
    </div>
  );
}
