import { ArrowRight, CarFront, Check, Plus, Wrench } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

import { isPermanentAuthState, useAuth } from "@/features/auth";
import { useGuestAnalysisReturn } from "@/features/cases/guest-analysis-return";
import { ValuationComparisonVisual } from "@/pages/home-visuals";
import { SignedInJourneyEntry } from "@/pages/signed-in-journey-entry";
import { useHomeEntranceMotion } from "@/pages/use-home-entrance-motion";

const primaryActionClassName =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const textLinkClassName =
  "inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const sectionHeadingClassName =
  "text-[2rem] leading-[1.1] font-semibold tracking-[-0.04em] text-balance text-ink sm:text-[2.65rem] lg:text-[3rem]";

const processSteps = [
  {
    number: "01",
    title: "Add your valuation details",
    description:
      "Upload your insurer’s report, or enter your vehicle and claim details yourself.",
  },
  {
    number: "02",
    title: "Venfour checks the market",
    description:
      "We look at similar vehicles and the details that affect the comparison.",
  },
  {
    number: "03",
    title: "See the evidence review",
    description:
      "Understand the findings and what you can discuss with your adjuster.",
  },
] as const;

const frequentlyAskedQuestions = [
  {
    question: "Do I need an insurance report?",
    answer: "No. You can upload your insurer’s valuation report or enter your vehicle and claim details yourself. A report lets us also review its specific comparisons and adjustments.",
  },
  {
    question: "What does Venfour compare?",
    answer: "We review relevant vehicle listings, considering details such as model, trim, mileage, and distance. Your review explains how the available market evidence compares with the insurer value you provide, and where the evidence is limited.",
  },
  {
    question: "Does a higher asking price mean a higher settlement?",
    answer: "No. An advertised price is one piece of evidence, not a final sale price or a guaranteed settlement. Venfour explains whether the available evidence supports taking a closer look.",
  },
  {
    question: "Will Venfour speak to my insurer?",
    answer: "You stay in control of communicating with your insurer. Venfour helps you understand the valuation and organize the evidence for that discussion.",
  },
  {
    question: "Can I return to my review later?",
    answer: <>Yes. Return from the same browser, or use <Link to="/find-review" className="font-semibold text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">review recovery</Link> with the email you supplied.</>,
  },
  {
    question: "Is Diminished Value available?",
    answer: <>Customer intake is currently paused while we complete the Total Loss experience. You can <Link to="/start?service=diminished-value" className="font-semibold text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">view the service update</Link> for its current availability.</>,
  },
];

export function PublicHomePage() {
  const guestReturn = useGuestAnalysisReturn();
  const motionRoot = useRef<HTMLDivElement>(null);
  useHomeEntranceMotion(motionRoot);

  return (
    <div ref={motionRoot} data-home-motion className="home-page -mt-16 w-full overflow-clip bg-white text-ink">
      <div className="home-intro-gradient bg-canvas">
        <section className="relative isolate overflow-hidden pt-16">
          <div
            className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[90rem] items-center justify-center px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20 xl:py-24"
            data-hero-content
          >
            <div className="w-full max-w-4xl text-center">
              <h1
                data-home-entrance="heading"
                aria-label="Your Vehicle’s Value, Made Clear."
                className="font-hero text-[2.875rem] leading-[0.98] font-bold tracking-[-0.035em] text-ink sm:text-[3.25rem] lg:text-[4rem] xl:text-[4.75rem] 2xl:text-[5rem]"
              >
                <span className="block sm:whitespace-nowrap">Your Vehicle’s Value,</span>
                <span className="block">Made Clear.</span>
              </h1>
              <p data-home-entrance="copy" data-home-order="1" className="mx-auto mt-6 max-w-xl text-base leading-7 text-copy sm:text-lg sm:leading-8">
                Understand your total-loss valuation, see how it compares with the market,
                and know what to discuss with your adjuster.
              </p>
              <div data-home-entrance="supporting" data-home-order="2" className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
                {guestReturn.pending ? (
                  <span className={`${primaryActionClassName} pointer-events-none min-w-52 opacity-60`} role="status">
                    Checking your saved review…
                  </span>
                ) : (
                  <Link to={guestReturn.action?.href ?? "/start?service=total-loss"} className={primaryActionClassName}>
                    {guestReturn.action?.label ?? "Start Total Loss review"}
                    <ArrowRight className="size-4 shrink-0" aria-hidden />
                  </Link>
                )}
              </div>
              <p data-home-entrance="supporting" data-home-order="3" className="mt-5 min-h-11 text-sm text-copy">
                {!guestReturn.pending && !guestReturn.action ? <>
                  Already started?{" "}
                  <Link to="/find-review" className={textLinkClassName}>Find my review</Link>
                </> : null}
              </p>
            </div>
          </div>
        </section>

        <section id="services" className="section-anchor scroll-mt-24" aria-labelledby="services-title" tabIndex={-1}>
          <div className="home-section pt-4 sm:pt-4 lg:pt-4">
            <div data-home-entrance="heading" className="mx-auto mb-8 max-w-3xl text-center sm:mb-10">
              <p className="home-eyebrow">Here to help you understand</p>
              <h2 id="services-title" data-anchor-heading className={`${sectionHeadingClassName} mx-auto mt-3`}>Start with your situation.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-[1.12fr_1fr] sm:gap-5">
              <article id="total-loss" className="home-service home-service-active section-anchor scroll-mt-24" aria-labelledby="total-loss-title" tabIndex={-1}>
                <div data-home-entrance="supporting" className="flex items-center justify-between gap-4">
                  <span className="home-service-icon"><CarFront className="size-6" strokeWidth={1.5} aria-hidden /></span>
                  <span className="flex items-center gap-2 text-xs font-medium text-market-strong"><span className="size-1.5 rounded-full bg-market" aria-hidden />Available now</span>
                </div>
                <div data-home-entrance="copy" data-home-order="1" className="mt-6">
                  <p className="home-eyebrow">Total Loss Valuation Review</p>
                  <h3 id="total-loss-title" data-anchor-heading className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-[1.75rem]">Your vehicle was totaled</h3>
                  <p className="mt-3 max-w-md text-base leading-7 text-copy">Get a clearer view of your vehicle’s valuation and the market evidence behind it. Start with or without an insurer report.</p>
                </div>
                <Link to="/start?service=total-loss" data-home-entrance="supporting" data-home-order="2" className={`${textLinkClassName} mt-5 self-start`}>
                  Start Total Loss review <ArrowRight className="size-4" aria-hidden />
                </Link>
              </article>
              <article id="diminished-value" className="home-service section-anchor scroll-mt-24 border-ink/10 bg-white/45" aria-labelledby="diminished-value-title" tabIndex={-1}>
                <div data-home-entrance="supporting" className="flex items-center justify-between gap-4">
                  <span className="home-service-icon bg-white/80 text-copy"><Wrench className="size-5" strokeWidth={1.5} aria-hidden /></span>
                  <span className="text-xs font-medium text-copy">Intake paused</span>
                </div>
                <div data-home-entrance="copy" data-home-order="1" className="mt-6">
                  <p className="home-eyebrow text-copy">Diminished Value</p>
                  <h3 id="diminished-value-title" data-anchor-heading className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-[1.75rem]">Your vehicle was repaired</h3>
                  <p className="mt-3 max-w-md text-base leading-7 text-copy">Accident history can affect resale value, even after repairs. Customer intake is paused while we focus on Total Loss.</p>
                </div>
                <Link to="/start?service=diminished-value" data-home-entrance="supporting" data-home-order="2" className={`${textLinkClassName} mt-5 self-start text-copy`}>
                  View service update <ArrowRight className="size-4" aria-hidden />
                </Link>
              </article>
            </div>
          </div>
        </section>
      </div>

      <section id="how-it-works" className="home-process-gradient section-anchor scroll-mt-24 bg-ink text-white" aria-labelledby="process-title" tabIndex={-1}>
        <div className="home-section">
          <div data-home-entrance="heading" className="mx-auto max-w-2xl text-center">
            <p className="home-eyebrow text-blue-300">How it works</p>
            <h2 id="process-title" data-anchor-heading className="mx-auto mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.04em] text-balance sm:text-[2.65rem] lg:text-[3rem]">Start online in a few steps</h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">From the details you have to a review you can understand.</p>
          </div>
          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10 lg:mt-12">
            {processSteps.map((step, index) => (
              <li key={step.number} data-home-entrance="copy" data-home-order={index}>
                <div className="flex items-center gap-5" aria-hidden>
                  <span className="text-sm font-medium text-blue-300 tabular-nums">{step.number}</span>
                  <span className="h-px flex-1 bg-white/20" />
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-[-0.025em] sm:text-xl">{step.title}</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="example" className="home-report-gradient section-anchor scroll-mt-24 bg-white" aria-labelledby="example-title" tabIndex={-1}>
        <div className="home-section grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-16">
          <div>
            <p data-home-entrance="supporting" className="home-eyebrow">A simple example</p>
            <h2 id="example-title" data-home-entrance="heading" data-anchor-heading aria-label="Two numbers. A clearer picture." className={`${sectionHeadingClassName} mt-3`}>
              <span className="block">Two numbers.</span>
              <span className="block">A clearer picture.</span>
            </h2>
            <p data-home-entrance="copy" data-home-order="1" className="mt-5 max-w-md text-base leading-7 text-copy sm:text-lg sm:leading-8">
              See the insurer’s valuation alongside a similar vehicle’s asking price.
              We put the difference in context.
            </p>
            <ul data-home-entrance="supporting" data-home-order="2" className="mt-6 space-y-3 text-sm text-ink">
              {["Relevant vehicle comparisons", "Findings in plain language", "The limitations, clearly explained"].map((item) => (
                <li key={item} className="flex items-center gap-3"><Check className="size-4 shrink-0 text-market" aria-hidden />{item}</li>
              ))}
            </ul>
            <Link to="/methodology" data-home-entrance="supporting" data-home-order="3" className={`${textLinkClassName} mt-6`}>
              How we review the evidence <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <ValuationComparisonVisual />
        </div>
      </section>

      <section id="faq" className="section-anchor scroll-mt-24 border-t border-line/70 bg-white" aria-labelledby="faq-title" tabIndex={-1}>
        <div className="home-section">
          <div data-home-entrance="heading" className="mx-auto max-w-3xl text-center">
            <p className="home-eyebrow">Frequently asked questions</p>
            <h2 id="faq-title" data-anchor-heading className={`${sectionHeadingClassName} mx-auto mt-3`}>A few things you might be wondering.</h2>
          </div>
          <div className="home-faq mx-auto mt-9 max-w-3xl lg:mt-12">
            {frequentlyAskedQuestions.map(({ question, answer }) => (
              <details key={question} data-home-entrance="supporting" className="group border-b border-line first:border-t">
                <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-5 py-5 text-base leading-6 font-medium text-ink transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset motion-reduce:transition-none">
                  <span>{question}</span>
                  <Plus className="size-5 shrink-0 text-copy transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" strokeWidth={1.5} aria-hidden />
                </summary>
                <div className="max-w-xl pr-7 pb-6 text-sm leading-7 text-copy sm:text-base">{answer}</div>
              </details>
            ))}
          </div>
          <div data-home-entrance="supporting" className="mx-auto mt-8 max-w-3xl text-center">
            <p className="text-base leading-7 text-copy">Still have a question?</p>
            <Link to="/contact" className={textLinkClassName}>Get in touch <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
        </div>
      </section>

      <section className="home-trust-gradient bg-ink text-white" aria-labelledby="get-started-title">
        <div className="home-section flex flex-col items-center gap-7 text-center">
          <div data-home-entrance="copy" className="max-w-2xl">
            <h2 id="get-started-title" className="text-3xl leading-[1.15] font-semibold tracking-[-0.035em] text-balance sm:text-4xl">Go into the conversation informed.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Start with your vehicle details. We’ll help make sense of the evidence.</p>
          </div>
          <Link to="/start?service=total-loss" data-home-entrance="supporting" data-home-order="1" className={`${primaryActionClassName} shrink-0 focus-visible:ring-offset-ink`}>
            Start Total Loss review <ArrowRight className="size-4" aria-hidden />
          </Link>
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
