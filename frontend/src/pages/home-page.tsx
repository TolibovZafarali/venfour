import { ArrowRight, Check } from "lucide-react";
import { Link } from "react-router";

import { supportEmail } from "@/config/support";
import {
  AnnotatedInsuranceReportVisual,
  AppraisalReportVisual,
  DiminishedValueExplainerVisual,
  ExampleAppraisalVisual,
  ProcessIllustration,
  RepairedVehicleServiceVisual,
  TotalLossServiceVisual,
} from "@/pages/home-visuals";

const primaryActionClassName =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const secondaryActionClassName =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold whitespace-nowrap text-ink transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const sectionHeadingClassName =
  "text-[2rem] leading-[1.08] font-semibold tracking-[-0.04em] text-balance text-ink sm:text-[2.65rem] lg:text-[3rem]";

const trustItems = [
  {
    title: "Similar vehicles reviewed",
    detail: "Relevant listings are organized for a clearer comparison.",
  },
  {
    title: "Local market considered",
    detail: "Distance and the vehicle’s location stay part of the picture.",
  },
  {
    title: "Clear limitations shown",
    detail: "The appraisal explains what the evidence can and cannot establish.",
  },
  {
    title: "Consumer-friendly explanation",
    detail: "Important numbers are translated into ordinary language.",
  },
] as const;

const processSteps = [
  {
    number: "01",
    title: "Upload your insurance report",
    description: "Use the vehicle value report your insurer sent you.",
    visual: "upload" as const,
  },
  {
    number: "02",
    title: "Venfour checks the market",
    description: "We review similar vehicles and the details that affect value.",
    visual: "market" as const,
  },
  {
    number: "03",
    title: "See the appraisal",
    description: "Get a clear result you can understand and use.",
    visual: "result" as const,
  },
] as const;

export function HomePage() {
  const diminishedValueMailto = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent("Diminished value appraisal request")}`
    : null;

  return (
    <div className="w-full overflow-clip bg-white text-ink">
      <section className="relative border-b border-slate-200 bg-canvas">
        <div className="mx-auto grid w-full max-w-[90rem] gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20 xl:grid-cols-[minmax(0,0.9fr)_minmax(34rem,1.1fr)] xl:items-center xl:gap-16 xl:py-24">
          <div className="max-w-2xl">
            <h1 className="max-w-[13ch] text-[2.8rem] leading-[0.98] font-semibold tracking-[-0.055em] text-balance text-ink sm:text-[4.15rem] lg:text-[4.1rem] xl:text-[4.5rem]">
              Independent vehicle appraisals after an accident.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-copy sm:text-lg sm:leading-8">
              Start a total-loss appraisal online or request a diminished value appraisal after repairs.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                to="/total-loss-review"
                className={`${primaryActionClassName} shrink-0`}
              >
                Start total-loss appraisal
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a
                href="#diminished-value"
                className={`${secondaryActionClassName} shrink-0`}
              >
                Request diminished value appraisal
              </a>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-2 gap-5 border-t border-slate-300 pt-5">
              <div>
                <dt className="text-[0.6875rem] font-semibold tracking-[0.1em] text-copy uppercase">
                  Total loss
                </dt>
                <dd className="mt-1 text-sm font-medium text-ink">
                  Self-service online
                </dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] font-semibold tracking-[0.1em] text-copy uppercase">
                  Diminished value
                </dt>
                <dd className="mt-1 text-sm font-medium text-ink">
                  Personally handled
                </dd>
              </div>
            </dl>
          </div>

          <div className="relative xl:pl-6">
            <ExampleAppraisalVisual />
          </div>
        </div>
      </section>

      <section
        id="services"
        className="section-anchor scroll-mt-24 bg-white"
        aria-labelledby="services-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-[84rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-28">
          <div className="max-w-3xl">
            <h2
              id="services-title"
              data-anchor-heading
              className={sectionHeadingClassName}
            >
              Two appraisals. Two different situations.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-copy sm:text-lg">
              Choose what happened to your vehicle. Each service answers a different question after an accident.
            </p>
          </div>

          <div className="mt-10 space-y-6 lg:mt-14 lg:space-y-8">
            <article
              id="total-loss"
              className="section-anchor scroll-mt-24 grid overflow-hidden rounded-2xl border border-slate-300 bg-white lg:grid-cols-[minmax(0,0.78fr)_minmax(32rem,1.22fr)] lg:items-stretch"
              aria-labelledby="total-loss-title"
              tabIndex={-1}
            >
              <div className="flex flex-col justify-center p-6 sm:p-9 lg:p-12">
                <p className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
                  Total-Loss Appraisal
                </p>
                <h3
                  id="total-loss-title"
                  data-anchor-heading
                  className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
                >
                  Your vehicle was totaled
                </h3>
                <p className="mt-4 max-w-md text-base leading-7 text-copy">
                  We check the insurance value report and compare it with similar vehicles for sale.
                </p>
                <Link
                  to="/total-loss-review"
                  className={`${primaryActionClassName} mt-7 self-start`}
                >
                  Start total-loss appraisal
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              <div className="border-t border-slate-300 bg-slate-100 p-5 sm:p-8 lg:border-t-0 lg:border-l lg:p-10">
                <TotalLossServiceVisual />
              </div>
            </article>

            <article className="grid overflow-hidden rounded-2xl border border-slate-300 bg-slate-50 lg:grid-cols-[minmax(32rem,1.18fr)_minmax(0,0.82fr)] lg:items-stretch">
              <div className="border-b border-slate-300 p-5 sm:p-8 lg:order-1 lg:border-r lg:border-b-0 lg:p-10">
                <RepairedVehicleServiceVisual />
              </div>
              <div className="flex flex-col justify-center p-6 sm:p-9 lg:order-2 lg:p-12">
                <p className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
                  Diminished Value Appraisal
                </p>
                <h3 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
                  Your vehicle was repaired
                </h3>
                <p className="mt-4 max-w-md text-base leading-7 text-copy">
                  We document how the accident history may have lowered its resale value.
                </p>
                <a
                  href="#diminished-value"
                  className={`${secondaryActionClassName} mt-7 self-start`}
                >
                  Request diminished value appraisal
                </a>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="section-anchor scroll-mt-24 border-y border-slate-200 bg-canvas"
        aria-labelledby="process-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-[84rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-28">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <h2
                id="process-title"
                data-anchor-heading
                className={sectionHeadingClassName}
              >
                Start online in a few steps
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-copy sm:text-lg">
                The total-loss appraisal begins with the report already sent by your insurance company.
              </p>
            </div>
            <Link
              to="/total-loss-review"
              className={`${secondaryActionClassName} shrink-0 self-start lg:self-auto`}
            >
              Upload your report
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <ol className="mt-10 grid overflow-hidden rounded-2xl border border-slate-300 bg-white md:grid-cols-3 lg:mt-14">
            {processSteps.map((step) => (
              <li
                key={step.number}
                className="border-b border-slate-300 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
              >
                <ProcessIllustration step={step.visual} />
                <div className="p-5 sm:p-6 lg:p-7">
                  <span className="text-xs font-semibold text-brand tabular-nums">
                    {step.number}
                  </span>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.025em] text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-copy">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white" aria-labelledby="report-gaps-title">
        <div className="mx-auto grid w-full max-w-[84rem] gap-9 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(16rem,0.58fr)_minmax(34rem,1.42fr)] lg:items-center lg:gap-14 lg:px-10 lg:py-28">
          <div className="max-w-xl">
            <h2 id="report-gaps-title" className={sectionHeadingClassName}>
              The insurance report may not tell the whole story.
            </h2>
            <p className="mt-4 text-base leading-7 text-copy sm:text-lg">
              Mileage, equipment, adjustments, distance, and local prices can sometimes make one vehicle a weaker comparison than another.
            </p>
            <p className="mt-5 border-l-2 border-amber pl-4 text-sm leading-6 text-copy">
              These are details to check—not assumptions that every insurance report is wrong.
            </p>
          </div>
          <AnnotatedInsuranceReportVisual />
        </div>
      </section>

      <section
        id="diminished-value"
        className="section-anchor scroll-mt-24 border-y border-slate-300 bg-slate-100"
        aria-labelledby="diminished-value-title"
        tabIndex={-1}
      >
        <div className="mx-auto grid w-full max-w-[84rem] gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,0.72fr)_minmax(34rem,1.28fr)] lg:items-center lg:gap-14 lg:px-10 lg:py-28">
          <div className="max-w-xl">
            <p className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
              Diminished value — value lost after repairs
            </p>
            <h2
              id="diminished-value-title"
              data-anchor-heading
              className={`${sectionHeadingClassName} mt-3`}
            >
              Repairs can fix the vehicle—not its history.
            </h2>
            <p className="mt-4 text-base leading-7 text-copy sm:text-lg">
              A repaired vehicle may sell for less because buyers can see that it was in an accident.
            </p>
            <p className="mt-4 text-sm leading-6 text-copy">
              This service is handled personally. It is not an instant or automated appraisal.
            </p>
            {diminishedValueMailto ? (
              <a
                href={diminishedValueMailto}
                className={`${primaryActionClassName} mt-7 self-start`}
              >
                Request diminished value appraisal
                <ArrowRight className="size-4" aria-hidden />
              </a>
            ) : (
              <div
                id="diminished-value-request"
                className="mt-7 border-l-2 border-brand bg-white px-4 py-3 text-sm leading-6 text-copy"
              >
                Direct requests are temporarily unavailable on this site. No request will be submitted until a support email is configured.
              </div>
            )}
          </div>
          <DiminishedValueExplainerVisual />
        </div>
      </section>

      <section className="bg-white" aria-labelledby="deliverable-title">
        <div className="mx-auto w-full max-w-[84rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-28">
          <div className="max-w-3xl">
            <h2 id="deliverable-title" className={sectionHeadingClassName}>
              A report that makes the numbers clear.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-copy sm:text-lg">
              See the insurance value, market range, similar vehicles, and important limits together in one organized appraisal.
            </p>
          </div>
          <div className="mt-10 lg:mt-14">
            <AppraisalReportVisual />
          </div>
        </div>
      </section>

      <section className="border-y border-slate-300 bg-ink text-white" aria-labelledby="trust-title">
        <div className="mx-auto w-full max-w-[84rem] px-5 py-14 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[minmax(15rem,0.55fr)_minmax(0,1.45fr)] lg:items-start lg:gap-14">
            <div>
              <h2
                id="trust-title"
                className="text-3xl leading-tight font-semibold tracking-[-0.035em] text-balance sm:text-4xl"
              >
                Built for a careful second look.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
                Product proof and transparent limits matter more than promises when thousands of dollars may be involved.
              </p>
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {trustItems.map((item) => (
                <li key={item.title} className="border-t border-white/20 pt-4">
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-market-light" aria-hidden />
                    <h3 className="text-sm font-semibold text-white">
                      {item.title}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-canvas" aria-labelledby="final-cta-title">
        <div className="mx-auto flex w-full max-w-[84rem] flex-col justify-between gap-7 px-5 py-16 sm:px-8 sm:py-20 lg:flex-row lg:items-center lg:gap-12 lg:px-10 lg:py-24">
          <h2
            id="final-cta-title"
            className="max-w-2xl text-[2.2rem] leading-[1.05] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-[3.2rem]"
          >
            Choose the appraisal that fits your situation.
          </h2>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Link to="/total-loss-review" className={primaryActionClassName}>
              Start total-loss appraisal
            </Link>
            <a href="#diminished-value" className={secondaryActionClassName}>
              Request diminished value appraisal
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
