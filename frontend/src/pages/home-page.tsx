import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { ExampleAnalysisPreview } from "@/components/example-analysis-preview";

const servicePaths = [
  {
    number: "01",
    title: "Review a total-loss valuation",
    description:
      "Compare your insurer’s valuation with relevant market evidence.",
    action: "Review my valuation",
    href: "/total-loss-review",
  },
  {
    number: "02",
    title: "Check my vehicle’s value",
    description:
      "No insurer report? Start with your VIN or vehicle details.",
    action: "Request a value check",
    href: "/contact?topic=vehicle-value",
  },
  {
    number: "03",
    title: "Get diminished-value help",
    description:
      "Your repaired vehicle may be worth less after an accident.",
    action: "Request a review",
    href: "/contact?topic=diminished-value",
  },
] as const;

const processSteps = [
  {
    number: "1",
    title: "Choose what you need",
    description: "Select the service that matches your situation.",
  },
  {
    number: "2",
    title: "Provide the details",
    description: "Upload a report or share your vehicle information.",
  },
  {
    number: "3",
    title: "Review the evidence",
    description: "Receive clear information you can understand and use.",
  },
] as const;

const primaryActionClassName =
  "inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

export function HomePage() {
  return (
    <div className="w-full bg-white text-ink">
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-11 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(31rem,1.18fr)] lg:items-center lg:gap-16 lg:py-20 xl:gap-20 xl:py-24">
          <div className="max-w-xl">
            <h1 className="max-w-[11ch] text-[2.625rem] leading-[1.04] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-[3.5rem] lg:text-[3.75rem]">
              Understand your vehicle’s value after an accident.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-copy sm:text-lg sm:leading-8">
              Review a total-loss valuation, check market value, or request
              diminished-value help.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href="#services" className={primaryActionClassName}>
                Get started
              </a>
              <a
                href="#how-it-works"
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:text-brand hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 motion-reduce:transition-none"
              >
                How it works
              </a>
            </div>
          </div>

          <ExampleAnalysisPreview />
        </div>
      </section>

      <section
        id="services"
        className="section-anchor scroll-mt-20 bg-white"
        aria-labelledby="services-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-18 lg:py-22">
          <h2
            id="services-title"
            data-anchor-heading
            className="text-3xl leading-tight font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
          >
            How can Venfour help?
          </h2>

          <ol className="mt-8 grid border-y border-line lg:grid-cols-3 lg:divide-x lg:divide-line">
            {servicePaths.map((path) => (
              <li
                key={path.number}
                className="border-b border-line last:border-b-0 lg:border-b-0"
              >
                <Link
                  to={path.href}
                  className="group flex h-full min-h-64 flex-col px-1 py-7 outline-none transition-colors hover:bg-surface focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset motion-reduce:transition-none sm:min-h-0 sm:px-5 lg:min-h-72 lg:px-7 lg:py-8"
                >
                  <span className="text-xs font-semibold tabular-nums text-brand">
                    {path.number}
                  </span>
                  <h3 className="mt-7 max-w-[17rem] text-xl leading-snug font-semibold tracking-[-0.025em] text-ink sm:text-2xl">
                    {path.title}
                  </h3>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-copy sm:text-[0.9375rem]">
                    {path.description}
                  </p>
                  <span className="mt-7 inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-brand group-hover:text-brand-strong lg:mt-auto lg:pt-8">
                    {path.action}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="how-it-works"
        className="section-anchor scroll-mt-20 border-y border-line bg-surface"
        aria-labelledby="how-it-works-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-18 lg:grid lg:grid-cols-[minmax(17rem,0.56fr)_minmax(0,1fr)] lg:gap-20 lg:py-20">
          <h2
            id="how-it-works-title"
            data-anchor-heading
            className="max-w-sm text-3xl leading-tight font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
          >
            A simpler way to get clarity
          </h2>

          <ol className="mt-9 divide-y divide-line border-y border-line lg:mt-0">
            {processSteps.map((step) => (
              <li
                key={step.number}
                className="grid gap-2 py-5 sm:grid-cols-[2.5rem_minmax(0,0.72fr)_minmax(0,1fr)] sm:items-baseline sm:gap-5"
              >
                <span className="text-xs font-semibold text-brand">
                  {step.number.padStart(2, "0")}
                </span>
                <h3 className="text-base font-semibold tracking-[-0.015em] text-ink sm:text-lg">
                  {step.title}
                </h3>
                <p className="text-sm leading-6 text-copy">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white" aria-labelledby="evidence-title">
        <div className="mx-auto grid w-full max-w-7xl gap-7 px-5 py-14 sm:px-8 sm:py-18 lg:grid-cols-[minmax(0,0.72fr)_minmax(24rem,0.58fr)] lg:items-center lg:gap-20 lg:py-20">
          <div>
            <h2
              id="evidence-title"
              className="text-3xl leading-tight font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
            >
              Built around market evidence
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-copy">
              Venfour organizes vehicle data, comparable listings, and clear
              limitations—so you can understand how the result was reached.
            </p>
          </div>
          <div className="border-t border-line pt-6 lg:border-t-0 lg:border-l lg:py-2 lg:pl-9">
            <ul
              className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-ink"
              aria-label="Methodology principles"
            >
              <li>Market-based comparisons</li>
              <li>Transparent limitations</li>
              <li>Plain-language results</li>
            </ul>
            <Link
              to="/methodology"
              className="group mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 motion-reduce:transition-none"
            >
              See our methodology
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden
              />
            </Link>
          </div>
        </div>
      </section>

      <section
        className="border-t border-line bg-surface"
        aria-labelledby="final-action-title"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-6 px-5 py-10 sm:flex-row sm:items-center sm:px-8 sm:py-12">
          <h2
            id="final-action-title"
            className="text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl"
          >
            Start with your situation
          </h2>
          <a href="#services" className={primaryActionClassName}>
            Get started
          </a>
        </div>
      </section>
    </div>
  );
}
