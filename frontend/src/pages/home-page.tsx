import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { StartAnalysisForm } from "@/features/analyses/components/start-analysis-form";

const servicePaths = [
  {
    number: "01",
    status: "Online report review",
    title: "I have a valuation report",
    description:
      "Review your insurer’s vehicle valuation against relevant market evidence.",
    action: "Review my valuation",
    href: "#report-review",
  },
  {
    number: "02",
    status: "Contact inquiry",
    title: "I don’t have a valuation report",
    description:
      "Use your vehicle details and comparable vehicles to understand its current market value.",
    action: "Ask about vehicle value",
    href: "/contact?topic=vehicle-value",
  },
  {
    number: "03",
    status: "Contact inquiry",
    title: "My vehicle was repaired",
    description:
      "Understand whether an accident may have reduced your vehicle’s resale value and what options to consider.",
    action: "Ask about diminished value",
    href: "/contact?topic=diminished-value",
  },
] as const;

const processSteps = [
  {
    number: "01",
    title: "Your information",
    description:
      "Venfour reads the relevant vehicle and valuation details you provide.",
  },
  {
    number: "02",
    title: "Market evidence",
    description:
      "Comparable vehicles are evaluated using relevant market data.",
  },
  {
    number: "03",
    title: "Clear explanation",
    description:
      "The evidence is organized into an understandable valuation review.",
  },
] as const;

const actionClassName =
  "group inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4";

export function HomePage() {
  return (
    <div className="w-full bg-white">
      <section className="border-b border-brand/15 bg-brand-soft">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)] lg:items-end lg:gap-16 lg:py-24 xl:py-28">
          <div className="min-w-0">
            <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              <span className="h-px w-8 bg-brand/60" aria-hidden />
              Vehicle valuation guidance
            </p>
            <h1 className="mt-6 max-w-[14ch] text-5xl leading-[1.02] font-semibold tracking-[-0.055em] text-balance text-neutral-950 sm:text-6xl lg:text-[4.25rem]">
              Know what your vehicle is worth after an accident.
            </h1>
          </div>

          <div className="max-w-xl lg:border-l lg:border-brand/20 lg:py-2 lg:pl-9">
            <p className="text-lg leading-8 text-neutral-700">
              Review an insurer’s valuation, check your vehicle’s market value,
              or get help understanding diminished value after a repair.
            </p>
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6 lg:flex-col lg:items-start xl:flex-row xl:items-center">
              <a
                href="#service-paths"
                className="inline-flex min-h-12 w-full shrink-0 items-center justify-center rounded-md bg-brand px-5 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/35 focus-visible:ring-offset-2 sm:w-auto"
              >
                Choose what I need help with
              </a>
              <a
                href="#how-it-works"
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-neutral-700 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-brand hover:decoration-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
              >
                How it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        id="service-paths"
        className="scroll-mt-4 bg-white"
        aria-labelledby="service-paths-title"
      >
        <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
          <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-16">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                Start with your situation
              </p>
              <h2
                id="service-paths-title"
                className="mt-4 text-4xl leading-tight font-semibold tracking-[-0.04em] text-neutral-950 sm:text-5xl"
              >
                What do you need help with?
              </h2>
            </div>
            <p className="max-w-md text-base leading-7 text-neutral-600">
              Choose the path that best matches where you are now.
            </p>
          </header>

          <ol className="mt-12 border-b border-neutral-300 sm:mt-14">
            {servicePaths.map((path) => (
              <li
                key={path.number}
                className="grid gap-5 border-t border-neutral-300 py-8 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-6 sm:py-9 lg:grid-cols-[4rem_minmax(0,1fr)_minmax(13rem,0.32fr)] lg:items-center lg:gap-9"
              >
                <span className="text-sm font-semibold tabular-nums text-brand">
                  {path.number}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.6875rem] font-semibold tracking-[0.13em] text-neutral-500 uppercase">
                    {path.status}
                  </p>
                  <h3 className="mt-2 text-2xl leading-tight font-semibold tracking-[-0.03em] text-neutral-950 sm:text-3xl">
                    {path.title}
                  </h3>
                  <p className="mt-3 max-w-2xl text-[0.9375rem] leading-7 text-neutral-600 sm:text-base">
                    {path.description}
                  </p>
                </div>
                <div className="sm:col-start-2 lg:col-start-3 lg:justify-self-end">
                  {path.href.startsWith("#") ? (
                    <a href={path.href} className={actionClassName}>
                      {path.action}
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                        aria-hidden
                      />
                    </a>
                  ) : (
                    <Link to={path.href} className={actionClassName}>
                      {path.action}
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                        aria-hidden
                      />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-4 border-y border-brand/15 bg-brand-soft"
        aria-labelledby="how-it-works-title"
      >
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              How Venfour works
            </p>
            <h2
              id="how-it-works-title"
              className="mt-4 text-3xl leading-tight font-semibold tracking-[-0.035em] text-neutral-950 sm:text-4xl"
            >
              From vehicle information to a clearer review.
            </h2>
          </div>

          <ol className="mt-10 grid border-y border-brand/20 md:grid-cols-3">
            {processSteps.map((step, index) => (
              <li
                key={step.number}
                className={`py-7 md:py-8 ${
                  index === 0
                    ? "md:pr-8"
                    : "border-t border-brand/20 md:border-t-0 md:border-l md:px-8"
                }`}
              >
                <span className="text-xs font-semibold tabular-nums text-brand">
                  {step.number}
                </span>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-neutral-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white" aria-labelledby="methodology-title">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)] lg:items-start lg:gap-20 lg:py-24">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              Evidence and methodology
            </p>
            <h2
              id="methodology-title"
              className="mt-4 max-w-xl text-3xl leading-tight font-semibold tracking-[-0.04em] text-balance text-neutral-950 sm:text-4xl"
            >
              Built around market evidence, not an AI opinion.
            </h2>
          </div>
          <div className="lg:border-l lg:border-neutral-200 lg:pl-9">
            <p className="text-base leading-7 text-neutral-600">
              Documents may be read with model-assisted technology, but
              Venfour’s valuation review uses structured vehicle information,
              comparable-market evidence, and defined analysis rules.
            </p>
            <Link to="/methodology" className={`${actionClassName} mt-6`}>
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
        id="report-review"
        className="scroll-mt-4 border-t border-neutral-200 bg-neutral-50"
        aria-labelledby="report-review-title"
      >
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(28rem,1fr)] lg:items-start lg:gap-20 lg:py-24">
          <div className="max-w-xl lg:sticky lg:top-24">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              Report review
            </p>
            <h2
              id="report-review-title"
              className="mt-4 text-4xl leading-tight font-semibold tracking-[-0.04em] text-neutral-950 sm:text-5xl"
            >
              Review your insurer’s valuation.
            </h2>
            <p className="mt-5 text-base leading-7 text-neutral-600 sm:text-lg sm:leading-8">
              Add the original valuation PDF and the vehicle’s ZIP code to
              compare the report with relevant market evidence.
            </p>
            <div className="mt-8 border-y border-neutral-300 py-5">
              <p className="text-[0.6875rem] font-semibold tracking-[0.13em] text-neutral-500 uppercase">
                Currently supported online
              </p>
              <p className="mt-2 text-base font-semibold text-neutral-950">
                Original CCC valuation report (PDF)
              </p>
            </div>
            <p className="mt-4 text-sm leading-6 text-neutral-500">
              Other insurer report formats are not yet supported by this
              automated review.
            </p>
          </div>

          <div className="mx-auto w-full max-w-[35rem] lg:mx-0 lg:justify-self-end">
            <StartAnalysisForm />
          </div>
        </div>
      </section>
    </div>
  );
}
