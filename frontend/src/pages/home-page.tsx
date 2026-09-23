import { ArrowRight, Check, Plus } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

import { ValuationComparisonVisual } from "@/pages/home-visuals";
import { applicationHref, hostAudience } from "@/app/site-boundary";
import { Navigate } from "react-router";
import { useHomeEntranceMotion } from "@/pages/use-home-entrance-motion";
import { publicIntakeClosed } from "@/config/public-site";

const reviewLabel = publicIntakeClosed ? "Contact Venfour" : "Start Total Loss review";

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
      "Start with your insurer’s report, or enter details for a preliminary estimate. The paid report requires your insurer’s valuation report.",
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
    answer: "You can start a preliminary estimate without one. The paid Total-Loss Valuation Report requires a complete insurer valuation report so we can review its vehicle details, comparisons, and adjustments.",
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
    answer: publicIntakeClosed ? <>Online reviews are opening soon. For help with an existing review, <Link to="/contact" className="font-semibold text-brand underline underline-offset-4">contact Venfour</Link>.</> : <>Yes. Return from the same browser, or use <Link to={applicationHref("/find-review")} className="font-semibold text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">review recovery</Link> with the email you supplied.</>,
  },
  {
    id: "diminished-value",
    question: "Is Diminished Value available?",
    answer: publicIntakeClosed ? "Diminished Value intake is currently paused while we prepare the Total Loss experience." : <>Customer intake is currently paused while we complete the Total Loss experience. You can <Link to={applicationHref("/start?service=diminished-value")} className="font-semibold text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">view the service update</Link> for its current availability.</>,
  },
];

export function PublicHomePage() {
  const reviewHref = publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss");
  const motionRoot = useRef<HTMLDivElement>(null);
  useHomeEntranceMotion(motionRoot);

  return (
    <div ref={motionRoot} data-home-motion className="home-page -mt-16 w-full overflow-clip bg-white text-ink">
      <div className="home-intro-gradient bg-canvas">
        <section id="total-loss" aria-labelledby="home-title" tabIndex={-1} className="home-hero-gradient section-anchor relative isolate overflow-hidden pt-16">
          <div
            className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[90rem] items-center justify-center px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20 xl:py-24"
            data-hero-content
          >
            <div className="w-full max-w-4xl text-center">
              <h1
                id="home-title"
                data-anchor-heading
                data-home-entrance="heading"
                aria-label="Your Vehicle’s Value, Made Clear."
                className="w-full font-hero text-[clamp(1rem,9.75vw,2.875rem)] leading-[0.98] font-bold tracking-[-0.035em] whitespace-nowrap text-ink sm:text-[3.25rem] lg:text-[4rem] xl:text-[4.75rem] 2xl:text-[5rem]"
              >
                <span className="block">Your Vehicle’s Value,</span>
                <span className="block">Made Clear.</span>
              </h1>
              <p data-home-entrance="copy" data-home-order="1" className="mx-auto mt-6 max-w-xl text-base leading-7 text-copy sm:text-lg sm:leading-8">
                Understand your total-loss valuation, see how it compares with the market,
                and know what to discuss with your adjuster.
              </p>
              <div data-home-entrance="supporting" data-home-order="2" className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
                <Link to={reviewHref} className={primaryActionClassName}>
                  {reviewLabel} <ArrowRight className="size-4 shrink-0" aria-hidden />
                </Link>
              </div>
              <p data-home-entrance="supporting" data-home-order="3" className="mt-5 min-h-11 text-sm text-copy">
                {publicIntakeClosed ? "Online reviews are opening soon." : <>
                  Already started?{" "}
                  <Link to={applicationHref("/find-review")} className={textLinkClassName}>Find my review</Link>
                </>}
              </p>
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

      <div className="home-report-gradient bg-white">
        <section id="example" className="section-anchor scroll-mt-24" aria-labelledby="example-title" tabIndex={-1}>
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

        <section id="faq" className="section-anchor scroll-mt-24" aria-labelledby="faq-title" tabIndex={-1}>
          <div className="home-section">
            <div data-home-entrance="heading" className="mx-auto max-w-3xl text-center">
              <p className="home-eyebrow">Frequently asked questions</p>
              <h2 id="faq-title" data-anchor-heading className={`${sectionHeadingClassName} mx-auto mt-3`}>A few things you might be wondering.</h2>
            </div>
            <div className="home-faq mx-auto mt-9 max-w-3xl lg:mt-12">
              {frequentlyAskedQuestions.map((item) => (
                <details key={item.question} id={"id" in item ? item.id : undefined} tabIndex={"id" in item ? -1 : undefined} data-home-entrance="supporting" className="group section-anchor scroll-mt-24 border-b border-line first:border-t">
                  <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-5 py-5 text-base leading-6 font-medium text-ink transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset motion-reduce:transition-none">
                    <span data-anchor-heading>{item.question}</span>
                    <Plus className="size-5 shrink-0 text-copy transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" strokeWidth={1.5} aria-hidden />
                  </summary>
                  <div className="max-w-xl pr-7 pb-6 text-sm leading-7 text-copy sm:text-base">{item.answer}</div>
                </details>
              ))}
            </div>
            <div data-home-entrance="supporting" className="mx-auto mt-8 max-w-3xl text-center">
              <p className="text-base leading-7 text-copy">Still have a question?</p>
              <Link to="/contact" className={textLinkClassName}>Get in touch <ArrowRight className="size-4" aria-hidden /></Link>
            </div>
          </div>
        </section>
      </div>

      <section className="home-trust-gradient bg-ink text-white" aria-labelledby="get-started-title">
        <div className="home-section flex flex-col items-center gap-7 text-center">
          <div data-home-entrance="copy" className="max-w-2xl">
            <h2 id="get-started-title" className="text-3xl leading-[1.15] font-semibold tracking-[-0.035em] text-balance sm:text-4xl">Go into the conversation informed.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">{publicIntakeClosed ? "Online reviews are opening soon. Contact us with questions." : "Start with your vehicle details. We’ll help make sense of the evidence."}</p>
          </div>
          <Link to={reviewHref} data-home-entrance="supporting" data-home-order="1" className={`${primaryActionClassName} shrink-0 focus-visible:ring-offset-ink`}>
            {reviewLabel} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

export function HomePage() {
  return hostAudience() === "application" ? <Navigate replace to="/app" /> : <PublicHomePage />;
}
