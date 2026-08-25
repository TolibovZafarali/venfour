import {
  ArrowRight,
  CarFront,
  ChartNoAxesCombined,
  CheckCircle2,
  FileSearch,
  LoaderCircle,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import type {
  AnalysisPresentation,
  Assessment,
  Money,
  NonnegativeMoney,
} from "@/features/analyses/analysis-presentation.generated";
import { cn } from "@/lib/utils";

const analysisActivities = [
  {
    title: "Reviewing the insurer’s valuation information",
    description:
      "Checking the insurer’s stated valuation when available, together with the saved claim information.",
    icon: FileSearch,
  },
  {
    title: "Analyzing the vehicle and market evidence",
    description:
      "Comparing the vehicle with relevant, defensible market evidence.",
    icon: ChartNoAxesCombined,
  },
  {
    title: "Determining whether the insurer’s valuation appears fair",
    description:
      "Weighing the available evidence without overstating what it proves.",
    icon: Scale,
  },
] as const;

export interface TotalLossAnalysisProgressProps {
  readonly className?: string;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly heading?: string;
  readonly headingLevel?: "h1" | "h2";
}

export function TotalLossAnalysisProgress({
  className,
  description =
    "Venfour is examining the saved information now. You can safely leave this page and return later.",
  eyebrow = "Reviewing & analyzing",
  heading = "We’re reviewing and analyzing your claim.",
  headingLevel = "h1",
}: TotalLossAnalysisProgressProps = {}) {
  const headingId = useId();
  const Heading = headingLevel;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] border border-line/80 bg-white shadow-[0_32px_90px_-56px_rgba(11,31,51,0.55)]",
        className,
      )}
      aria-labelledby={headingId}
      aria-busy="true"
      data-total-loss-analysis-progress
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Venfour is reviewing the insurer valuation information available for
        this case, analyzing the vehicle and market evidence, and determining
        whether the valuation appears fair.
      </p>

      <span
        className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-brand-soft/80 blur-3xl"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-28 -left-24 size-72 rounded-full bg-market-soft/75 blur-3xl"
        aria-hidden
      />

      <div className="relative grid lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
        <div className="flex flex-col justify-between border-b border-line/80 p-6 sm:p-8 lg:border-r lg:border-b-0 lg:p-10 xl:p-12">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              {eyebrow}
            </p>
            <Heading
              id={headingId}
              className="mt-3 max-w-xl text-3xl leading-[1.08] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-4xl xl:text-[2.8rem]"
            >
              {heading}
            </Heading>
            <p className="mt-5 max-w-xl text-base leading-7 text-copy">
              {description}
            </p>
          </div>

          <div className="mt-9 flex items-center gap-4 sm:mt-12">
            <div
              className="relative flex size-24 shrink-0 items-center justify-center sm:size-28"
              aria-hidden
            >
              <span className="absolute inset-0 rounded-full border border-brand/15 bg-brand-soft/35" />
              <span className="absolute inset-2 animate-spin rounded-full border border-transparent border-t-brand/80 border-r-brand/20 [animation-duration:2.8s] motion-reduce:animate-none" />
              <span className="absolute inset-4 animate-pulse rounded-full border border-brand/15 bg-white/90 shadow-[0_18px_46px_-24px_rgba(21,94,239,0.65)] motion-reduce:animate-none" />
              <span className="relative flex size-12 items-center justify-center rounded-full bg-brand text-white shadow-sm">
                <LoaderCircle className="size-6 animate-spin [animation-duration:1.8s] motion-reduce:animate-none" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Analysis in progress</p>
              <p className="mt-1 text-sm leading-6 text-copy">
                This page updates automatically when the review is complete.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-surface/45 p-6 sm:p-8 lg:p-10 xl:p-12">
          <p className="text-xs font-semibold tracking-[0.13em] text-copy uppercase">
            What Venfour is checking
          </p>
          <ol className="mt-5 space-y-3" aria-label="Analysis activities">
            {analysisActivities.map((activity) => {
              const Icon = activity.icon;
              return (
                <li
                  key={activity.title}
                  className="group flex items-start gap-4 rounded-2xl border border-line/80 bg-white/90 p-4 shadow-[0_14px_36px_-30px_rgba(11,31,51,0.52)] transition-colors motion-reduce:transition-none"
                >
                  <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <span className="absolute top-1.5 right-1.5 size-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-6 text-ink">
                      {activity.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-copy">
                      {activity.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 flex items-start gap-3 rounded-xl bg-brand-soft/75 px-4 py-3.5">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-brand"
              aria-hidden
            />
            <p className="text-xs leading-5 text-copy">
              Your appraisal remains private and saved while the review runs.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

type ResultTone = "amber" | "market" | "neutral";

interface ResultPresentation {
  readonly eyebrow: string;
  readonly heading: string;
  readonly worthwhileHeading: string;
  readonly worthwhileSummary: string;
  readonly showContinue: boolean;
  readonly tone: ResultTone;
}

const resultPresentationByClassification: Record<
  Assessment["classification"],
  ResultPresentation
> = {
  MATERIAL_UNDERVALUE_SIGNAL: {
    eyebrow: "Potentially too low",
    heading:
      "Strong evidence suggests the insurer’s valuation may be too low.",
    worthwhileHeading: "Continuing appears worthwhile.",
    worthwhileSummary:
      "The selected evidence shows a material valuation signal worth examining more closely. It does not guarantee a settlement increase or determine what the insurer owes.",
    showContinue: true,
    tone: "amber",
  },
  POTENTIAL_UNDERVALUE: {
    eyebrow: "Potentially too low",
    heading: "The insurer’s valuation may be too low.",
    worthwhileHeading: "A closer review appears worthwhile.",
    worthwhileSummary:
      "The available evidence identifies a potential valuation gap worth reviewing, while leaving room for differences in vehicle facts and market evidence.",
    showContinue: true,
    tone: "amber",
  },
  NO_MATERIAL_DISCREPANCY: {
    eyebrow: "Appears fair",
    heading:
      "The insurer’s valuation appears fair based on the available evidence.",
    worthwhileHeading: "Pursuing this further may not be worthwhile.",
    worthwhileSummary:
      "The available evidence does not show a material valuation gap. You can still check the insurer’s report for factual errors or missing information.",
    showContinue: false,
    tone: "market",
  },
  CONFLICTING_EVIDENCE: {
    eyebrow: "Evidence is mixed",
    heading: "The available evidence points in different directions.",
    worthwhileHeading: "It’s too soon to decide whether to continue.",
    worthwhileSummary:
      "No single price signal is reliable enough to determine whether the insurer’s valuation appears fair or too low.",
    showContinue: false,
    tone: "neutral",
  },
  INSUFFICIENT_EVIDENCE: {
    eyebrow: "More evidence needed",
    heading:
      "There isn’t enough reliable evidence to assess the insurer’s valuation.",
    worthwhileHeading: "Venfour can’t yet determine whether to continue.",
    worthwhileSummary:
      "The available information does not support a reliable fairness comparison. That does not establish that the insurer’s valuation is correct or incorrect.",
    showContinue: false,
    tone: "neutral",
  },
};

export interface TotalLossAnalysisResultProps {
  readonly analysis: AnalysisPresentation;
  readonly className?: string;
}

export function TotalLossAnalysisResult({
  analysis,
  className,
}: TotalLossAnalysisResultProps) {
  const headingId = useId();
  const presentation =
    resultPresentationByClassification[analysis.assessment.classification];
  const primaryEvidence = analysis.primaryExternalEvidence;
  const priceSummary = primaryEvidence?.prices;
  const minimum = displayMoney(priceSummary?.minimumPrice);
  const maximum = displayMoney(priceSummary?.maximumPrice);
  const median = displayMoney(priceSummary?.medianPrice);
  const rangeAvailable = Boolean(minimum && maximum && median);
  const vehicle = [
    analysis.vehicle.year,
    analysis.vehicle.make,
    analysis.vehicle.model,
    analysis.vehicle.trim,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] border border-line/80 bg-white shadow-[0_32px_90px_-56px_rgba(11,31,51,0.55)]",
        className,
      )}
      aria-labelledby={headingId}
      data-analysis-classification={analysis.assessment.classification}
      data-total-loss-analysis-result
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Analysis complete. {presentation.heading}
      </p>

      <span
        className={cn(
          "pointer-events-none absolute -top-28 -right-24 size-80 rounded-full blur-3xl",
          presentation.tone === "market"
            ? "bg-market-soft/90"
            : presentation.tone === "amber"
              ? "bg-amber-soft/90"
              : "bg-surface",
        )}
        aria-hidden
      />

      <div className="relative p-6 sm:p-8 lg:p-10 xl:p-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase",
                toneClasses[presentation.tone].badge,
              )}
            >
              <CheckCircle2 className="size-4" aria-hidden />
              {presentation.eyebrow}
            </span>
            <h1
              id={headingId}
              className="mt-5 text-3xl leading-[1.08] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-4xl xl:text-[3rem]"
            >
              {presentation.heading}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-copy">
              {analysis.assessment.summary}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-line/80 bg-surface/70 px-4 py-3 lg:max-w-64">
            <CarFront className="size-5 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-medium text-copy">Vehicle reviewed</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">{vehicle}</p>
            </div>
          </div>
        </div>

        <div className="mt-9 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)] lg:gap-6">
          <section
            className="overflow-hidden rounded-2xl bg-ink p-6 text-white sm:p-7 lg:p-8"
            aria-labelledby={`${headingId}-range`}
          >
            <p className="text-xs font-semibold tracking-[0.13em] text-white/60 uppercase">
              Evidence-supported market range
            </p>
            <h2
              id={`${headingId}-range`}
              className="mt-3 text-3xl font-semibold tracking-[-0.04em] tabular-nums sm:text-4xl"
            >
              {rangeAvailable ? `${minimum} – ${maximum}` : "Unavailable"}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">
              {rangeAvailable
                ? primaryEvidence?.evidenceBasis === "LOSS_DATE_HISTORICAL"
                  ? "Selected advertised-price evidence verified around the date of loss."
                  : "Selected advertised-price evidence from the current market."
                : "The available evidence did not support a reliable market range."}
            </p>

            <dl className="mt-7 grid gap-4 border-t border-white/15 pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-white/55">Evidence median</dt>
                <dd className="mt-1 text-xl font-semibold tracking-[-0.025em] tabular-nums">
                  {rangeAvailable ? median : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-white/55">Evidence strength</dt>
                <dd className="mt-1 text-xl font-semibold tracking-[-0.025em]">
                  {analysis.assessment.evidenceStrengthLabel}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className={cn(
              "flex flex-col rounded-2xl border p-6 sm:p-7",
              toneClasses[presentation.tone].panel,
            )}
            aria-labelledby={`${headingId}-worthwhile`}
          >
            <p className="text-xs font-semibold tracking-[0.13em] text-copy uppercase">
              Is it worth pursuing?
            </p>
            <h2
              id={`${headingId}-worthwhile`}
              className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink"
            >
              {presentation.worthwhileHeading}
            </h2>
            <p className="mt-3 text-sm leading-6 text-copy">
              {presentation.worthwhileSummary}
            </p>

            {presentation.showContinue ? (
              <Button
                type="button"
                size="lg"
                className="mt-7 w-full bg-brand text-white hover:bg-brand-strong sm:w-auto"
                data-future-next-step
              >
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : null}
          </section>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-line/80 bg-surface/60 px-4 py-3.5">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-copy"
            aria-hidden
          />
          <p className="text-xs leading-5 text-copy">
            Advertised prices are evidence, not guaranteed transaction prices.
            This result is not a settlement calculation or a statement of money
            owed.
          </p>
        </div>
      </div>
    </section>
  );
}

const toneClasses: Record<
  ResultTone,
  { readonly badge: string; readonly panel: string }
> = {
  market: {
    badge: "bg-market-soft text-market-strong",
    panel: "border-market/20 bg-market-soft/55",
  },
  amber: {
    badge: "bg-amber-soft text-amber-strong",
    panel: "border-amber/25 bg-amber-soft/55",
  },
  neutral: {
    badge: "bg-surface text-ink",
    panel: "border-line bg-surface/55",
  },
};

function displayMoney(value?: Money | NonnegativeMoney) {
  return value?.display?.replace(/\.00$/u, "") ?? null;
}
