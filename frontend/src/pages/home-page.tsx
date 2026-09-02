import { ArrowRight, Check } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

import heroRoadsideAssistanceAvif from "@/assets/hero-roadside-assistance.avif";
import heroRoadsideAssistanceJpeg from "@/assets/hero-roadside-assistance.jpg";
import { isPermanentAuthState, useAuth } from "@/features/auth";
import { useGuestAnalysisReturn } from "@/features/cases/guest-analysis-return";
import {
  AnnotatedInsuranceReportVisual,
  AppraisalReportVisual,
  DiminishedValueExplainerVisual,
  ProcessIllustration,
  RepairedVehicleServiceVisual,
  TotalLossServiceVisual,
} from "@/pages/home-visuals";
import { SignedInJourneyEntry } from "@/pages/signed-in-journey-entry";
import { useHomeEntranceMotion } from "@/pages/use-home-entrance-motion";

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
    detail: "The review explains what the evidence can and cannot establish.",
  },
  {
    title: "Consumer-friendly explanation",
    detail: "Important numbers are translated into ordinary language.",
  },
] as const;

const processSteps = [
  {
    number: "01",
    title: "Add your valuation details",
    description:
      "Upload your insurer’s valuation report from any provider, or enter the details yourself.",
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
    title: "See the evidence review",
    description: "Read the comparison, supporting evidence, and limitations.",
    visual: "result" as const,
  },
] as const;

export function PublicHomePage() {
  const guestReturn = useGuestAnalysisReturn();
  const motionRoot = useRef<HTMLDivElement>(null);
  useHomeEntranceMotion(motionRoot);
  return (
    <div ref={motionRoot} data-home-motion className="-mt-16 w-full overflow-clip bg-white text-ink">
      <section className="home-hero-gradient relative isolate overflow-hidden border-b border-slate-200 bg-canvas pt-16">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[64%] max-w-[72rem] xl:block"
          aria-hidden="true"
        >
          <picture className="block h-full w-full">
            <source
              srcSet={heroRoadsideAssistanceAvif}
              type="image/avif"
            />
            <img
              src={heroRoadsideAssistanceJpeg}
              alt=""
              width="2400"
              height="1600"
              fetchPriority="high"
              decoding="async"
              className="h-full w-full object-cover object-[68%_70%] brightness-90 saturate-90"
              data-hero-photo
            />
          </picture>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, var(--canvas) 0%, var(--canvas) 12%, rgb(243 246 249 / 0.72) 32%, rgb(243 246 249 / 0) 62%)",
            }}
            data-hero-photo-fade
          />
        </div>

        <div
          className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[90rem] items-center px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20 xl:py-24"
          data-hero-content
        >
          <div className="max-w-2xl xl:max-w-[42rem]">
            <h1
              data-home-entrance="heading"
              aria-label="Your Vehicle’s Value, Made Clear."
              className="font-hero text-[2.875rem] leading-[0.98] font-semibold tracking-[-0.035em] text-ink sm:text-[3.25rem] lg:text-[4rem] xl:text-[4.75rem] 2xl:text-[5rem]"
            >
              <span className="block sm:whitespace-nowrap">
                Your Vehicle’s Value,
              </span>
              <span className="block">Made Clear.</span>
            </h1>
            <p data-home-entrance="copy" data-home-order="1" className="mt-6 max-w-xl text-base leading-7 text-ink/80 sm:text-lg sm:leading-8">
              Understand a total-loss vehicle valuation with or without an
              insurer report. Diminished Value customer intake is currently
              paused.
            </p>
            <div data-home-entrance="supporting" data-home-order="2" className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              {guestReturn.pending ? (
                <span className={`${primaryActionClassName} pointer-events-none min-w-52 shrink-0 opacity-60`} role="status">
                  Checking your saved review…
                </span>
              ) : <Link
                to={guestReturn.action?.href ?? "/start?service=total-loss"}
                className={`${primaryActionClassName} shrink-0`}
              >
                {guestReturn.action?.label ?? "Start Total Loss review"}
                <ArrowRight className="size-4" aria-hidden />
              </Link>}
              <Link
                to="/start?service=diminished-value"
                className={`${secondaryActionClassName} shrink-0`}
              >
                View Diminished Value update
              </Link>
            </div>
            <p data-home-entrance="supporting" data-home-order="3" className="mt-5 min-h-11 text-sm text-copy">
              {!guestReturn.pending && !guestReturn.action ? <>
                Already started?{" "}
                <Link to="/find-review" className="inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  Find my review
                </Link>
              </> : null}
            </p>
          </div>
        </div>
      </section>

      <section
        id="services"
        className="home-services-gradient section-anchor scroll-mt-24 bg-white"
        aria-labelledby="services-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-[84rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-28">
          <div className="max-w-3xl">
            <h2
              id="services-title"
              data-home-entrance="heading"
              data-anchor-heading
              aria-label="Two services. Two different situations."
              className={sectionHeadingClassName}
            >
              <span className="block">Two services.</span>
              <span className="block">Two different situations.</span>
            </h2>
            <p data-home-entrance="copy" data-home-order="1" className="mt-4 max-w-2xl text-base leading-7 text-copy sm:text-lg">
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
                <p data-home-entrance="supporting" className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
                  Total Loss Valuation Review
                </p>
                <h3
                  id="total-loss-title"
                  data-home-entrance="heading"
                  data-home-order="1"
                  data-anchor-heading
                  className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.04em] text-ink sm:text-4xl"
                >
                  Your vehicle was totaled
                </h3>
                <p data-home-entrance="copy" data-home-order="2" className="mt-4 max-w-md text-base leading-7 text-copy">
                  Upload your insurer’s valuation report from any provider, or
                  enter the vehicle and claim details yourself. Venfour will
                  compare the available valuation with relevant market evidence.
                </p>
                <Link
                  to="/start?service=total-loss"
                  data-home-entrance="supporting"
                  data-home-order="3"
                  className={`${primaryActionClassName} mt-7 self-start`}
                >
                  Start Total Loss review
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
                <p data-home-entrance="supporting" className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
                  Diminished Value · Intake paused
                </p>
                <h3 data-home-entrance="heading" data-home-order="1" className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
                  Your vehicle was repaired
                </h3>
                <p data-home-entrance="copy" data-home-order="2" className="mt-4 max-w-md text-base leading-7 text-copy">
                  Customer intake is currently paused while Venfour focuses on
                  the Total Loss experience. The service remains part of
                  Venfour’s planned customer experience.
                </p>
                <Link
                  to="/start?service=diminished-value"
                  data-home-entrance="supporting"
                  data-home-order="3"
                  className={`${secondaryActionClassName} mt-7 self-start`}
                >
                  View service update
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="home-process-gradient section-anchor scroll-mt-24 border-y border-slate-200 bg-canvas"
        aria-labelledby="process-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-[84rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-28">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <h2
                id="process-title"
                data-home-entrance="heading"
                data-anchor-heading
                className={sectionHeadingClassName}
              >
                Start online in a few steps
              </h2>
              <p data-home-entrance="copy" data-home-order="1" className="mt-4 max-w-2xl text-base leading-7 text-copy sm:text-lg">
                Start with an insurer valuation report or enter the details
                yourself. No visible account setup is required first.
              </p>
            </div>
            <Link
              to="/start?service=total-loss"
              data-home-entrance="supporting"
              data-home-order="2"
              className={`${secondaryActionClassName} shrink-0 self-start lg:self-auto`}
            >
              Start Total Loss review
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <ol className="mt-10 grid overflow-hidden rounded-2xl border border-slate-300 bg-white md:grid-cols-3 lg:mt-14">
            {processSteps.map((step, index) => (
              <li
                key={step.number}
                className="border-b border-slate-300 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
              >
                <ProcessIllustration step={step.visual} entranceOrder={index} />
                <div data-home-entrance="copy" data-home-order={index} className="p-5 sm:p-6 lg:p-7">
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

      <section
        className="home-report-gradient bg-white"
        aria-labelledby="report-gaps-title"
      >
        <div className="mx-auto grid w-full max-w-[84rem] gap-9 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(16rem,0.58fr)_minmax(34rem,1.42fr)] lg:items-center lg:gap-14 lg:px-10 lg:py-28">
          <div className="max-w-xl">
            <h2 id="report-gaps-title" data-home-entrance="heading" className={sectionHeadingClassName}>
              The insurance report may not tell the whole story.
            </h2>
            <p data-home-entrance="copy" data-home-order="1" className="mt-4 text-base leading-7 text-copy sm:text-lg">
              Mileage, equipment, adjustments, distance, and local prices can sometimes make one vehicle a weaker comparison than another.
            </p>
            <p data-home-entrance="supporting" data-home-order="2" className="mt-5 border-l-2 border-amber pl-4 text-sm leading-6 text-copy">
              These are details to check—not assumptions that every insurance report is wrong.
            </p>
          </div>
          <AnnotatedInsuranceReportVisual />
        </div>
      </section>

      <section
        id="diminished-value"
        className="home-diminished-gradient section-anchor scroll-mt-24 border-y border-slate-300 bg-slate-100"
        aria-labelledby="diminished-value-title"
        tabIndex={-1}
      >
        <div className="mx-auto grid w-full max-w-[84rem] gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,0.72fr)_minmax(34rem,1.28fr)] lg:items-center lg:gap-14 lg:px-10 lg:py-28">
          <div className="max-w-xl">
            <p data-home-entrance="supporting" className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
              Diminished value — customer intake paused
            </p>
            <h2
              id="diminished-value-title"
              data-home-entrance="heading"
              data-home-order="1"
              data-anchor-heading
              className={`${sectionHeadingClassName} mt-3`}
            >
              Repairs can fix the vehicle—not its history.
            </h2>
            <p data-home-entrance="copy" data-home-order="2" className="mt-4 text-base leading-7 text-copy sm:text-lg">
              A repaired vehicle may sell for less because buyers can see that it was in an accident.
            </p>
            <p data-home-entrance="supporting" data-home-order="3" className="mt-4 text-sm leading-6 text-copy">
              Venfour is completing the Total Loss experience before opening
              this service to customers.
            </p>
            <Link
              to="/start?service=diminished-value"
              data-home-entrance="supporting"
              data-home-order="3"
              className={`${primaryActionClassName} mt-7 self-start`}
            >
              View Diminished Value update
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <DiminishedValueExplainerVisual />
        </div>
      </section>

      <section
        className="home-deliverable-gradient bg-white"
        aria-labelledby="deliverable-title"
      >
        <div className="mx-auto w-full max-w-[84rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-28">
          <div className="max-w-3xl">
            <h2 id="deliverable-title" data-home-entrance="heading" className={sectionHeadingClassName}>
              An analysis that makes the evidence clear.
            </h2>
            <p data-home-entrance="copy" data-home-order="1" className="mt-4 max-w-2xl text-base leading-7 text-copy sm:text-lg">
              See the insurer value, market range, similar vehicles, and
              important limits together in one organized on-screen review.
            </p>
          </div>
          <div className="mt-10 lg:mt-14">
            <AppraisalReportVisual />
          </div>
        </div>
      </section>

      <section
        className="home-trust-gradient border-y border-slate-300 bg-ink text-white"
        aria-labelledby="trust-title"
      >
        <div className="mx-auto w-full max-w-[84rem] px-5 py-14 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[minmax(15rem,0.55fr)_minmax(0,1.45fr)] lg:items-start lg:gap-14">
            <div>
              <h2
                id="trust-title"
                data-home-entrance="heading"
                className="text-3xl leading-tight font-semibold tracking-[-0.035em] text-balance sm:text-4xl"
              >
                Built for a careful second look.
              </h2>
              <p data-home-entrance="copy" data-home-order="1" className="mt-4 max-w-md text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
                Product proof and transparent limits matter more than promises when thousands of dollars may be involved.
              </p>
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {trustItems.map((item, index) => (
                <li key={item.title} data-home-entrance="supporting" data-home-order={index} className="border-t border-white/20 pt-4">
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

    </div>
  );
}

function HomePageLoading() {
  return (
    <section
      className="page-gradient-account-home w-full bg-canvas"
      aria-label="Loading Venfour"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading Venfour…</span>
      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
        <div
          className="h-32 max-w-2xl animate-pulse rounded-2xl bg-white motion-reduce:animate-none"
          aria-hidden
        />
        <div
          className="mt-8 h-72 animate-pulse rounded-2xl border border-line bg-white motion-reduce:animate-none"
          aria-hidden
        />
      </div>
    </section>
  );
}

export function HomePage() {
  const { auth } = useAuth();

  if (auth.status === "loading") {
    return <HomePageLoading />;
  }

  if (isPermanentAuthState(auth)) {
    return <SignedInJourneyEntry userId={auth.user.id} />;
  }

  return <PublicHomePage />;
}
