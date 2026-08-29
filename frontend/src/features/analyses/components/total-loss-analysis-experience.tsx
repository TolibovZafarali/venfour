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
import type { ReactNode } from "react";

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

interface ResultPresentation {
  readonly heading: string;
  readonly summary: string;
  readonly worthwhileHeading: string;
  readonly worthwhileSummary: string;
  readonly showContinue: boolean;
}

const resultPresentationByClassification: Record<
  Assessment["classification"],
  ResultPresentation
> = {
  MATERIAL_UNDERVALUE_SIGNAL: {
    heading: "Your insurer may be undervaluing your vehicle.",
    summary:
      "We found market evidence suggesting your vehicle could be worth more.",
    worthwhileHeading: "This looks worth pursuing.",
    worthwhileSummary:
      "There appears to be enough of a difference to take a closer look.",
    showContinue: true,
  },
  POTENTIAL_UNDERVALUE: {
    heading: "Your insurer may be undervaluing your vehicle.",
    summary:
      "We found market evidence suggesting your vehicle could be worth more.",
    worthwhileHeading: "This looks worth pursuing.",
    worthwhileSummary:
      "The difference may be worth a closer look, though some uncertainty remains.",
    showContinue: true,
  },
  NO_MATERIAL_DISCREPANCY: {
    heading: "Your insurer’s valuation appears fair.",
    summary: "The market evidence we found doesn’t show a meaningful gap.",
    worthwhileHeading: "There may be little to pursue here.",
    worthwhileSummary:
      "You can still check your insurer’s report for mistakes or missing details.",
    showContinue: false,
  },
  CONFLICTING_EVIDENCE: {
    heading: "The picture isn’t clear yet.",
    summary:
      "The market evidence is mixed, so we can’t tell whether your insurer’s valuation is too low.",
    worthwhileHeading: "It’s too soon to say.",
    worthwhileSummary:
      "A closer look at the differences is needed before deciding what to do next.",
    showContinue: false,
  },
  INSUFFICIENT_EVIDENCE: {
    heading: "We need more information to be sure.",
    summary:
      "We couldn’t find enough reliable market evidence to assess your insurer’s valuation.",
    worthwhileHeading: "A clearer picture comes first.",
    worthwhileSummary:
      "This doesn’t mean your insurer’s valuation is right or wrong.",
    showContinue: false,
  },
};

export interface TotalLossAnalysisResultProps {
  readonly analysis: AnalysisPresentation;
  readonly className?: string;
  readonly continueAction?: ReactNode;
}

export function TotalLossAnalysisResult({
  analysis,
  className,
  continueAction,
}: TotalLossAnalysisResultProps) {
  const headingId = useId();
  const primaryEvidence = analysis.primaryExternalEvidence;
  const priceSummary = primaryEvidence?.prices;
  const minimum = displayMoney(priceSummary?.minimumPrice);
  const maximum = displayMoney(priceSummary?.maximumPrice);
  const median = displayMoney(priceSummary?.medianPrice);
  const rangeAvailable = Boolean(minimum && maximum && median);
  const insurerValue = analysis.insurerValuation.value;
  const insurerValueAvailable =
    analysis.analysisScope.insurerValuationAvailable &&
    analysis.insurerValuation.source !== "NONE" &&
    insurerValue.cents !== null;
  const insurerLabel =
    analysis.insurerValuation.source === "CUSTOMER_ENTERED"
      ? "Insurer’s offer"
      : "Insurer’s valuation";
  const presentation: ResultPresentation = insurerValueAvailable
    ? resultPresentationByClassification[analysis.assessment.classification]
    : {
        heading: rangeAvailable
          ? "Here’s what we found for your vehicle."
          : "We need more information to be sure.",
        summary: rangeAvailable
          ? "We found market prices for similar vehicles. An insurer’s offer is needed to see how it compares."
          : "We couldn’t find enough reliable market evidence to estimate a range.",
        worthwhileHeading: rangeAvailable
          ? "Your insurer’s offer completes the picture."
          : "A clearer picture comes first.",
        worthwhileSummary: rangeAvailable
          ? "Without it, we can’t yet tell whether there’s a difference worth pursuing."
          : "We can’t yet tell whether there’s a difference worth pursuing.",
        showContinue: false,
      };
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
        "relative mx-auto max-w-4xl overflow-hidden rounded-[1.75rem] border border-line/70 bg-white shadow-[0_24px_80px_-48px_rgba(11,31,51,0.25)]",
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
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-brand-soft/50 to-transparent"
        aria-hidden
      />

      <div className="relative px-4 py-7 text-center sm:px-10 sm:py-10 lg:px-16">
        <div className="mx-auto flex max-w-xl items-center justify-center gap-2.5 text-copy">
          <CarFront className="size-5 shrink-0 text-brand" aria-hidden />
          <p className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">
            <span className="sr-only">Vehicle reviewed: </span>
            {vehicle}
          </p>
        </div>

        <h1
          id={headingId}
          className="mx-auto mt-5 max-w-2xl text-[1.9rem] leading-[1.13] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-[2.6rem] lg:text-[2.8rem]"
        >
          {presentation.heading}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[0.9375rem] leading-6 text-pretty text-copy sm:text-base sm:leading-7">
          {presentation.summary}
        </p>

        <section
          className={cn(
            "mx-auto mt-7 max-w-xl rounded-2xl border px-3 py-5 sm:mt-8 sm:px-8 sm:py-6",
            presentation.showContinue
              ? "border-market/15 bg-linear-to-br from-market-soft/80 via-market-soft/45 to-brand-soft/50"
              : "border-line/70 bg-linear-to-br from-surface to-brand-soft/35",
          )}
          aria-labelledby={`${headingId}-range`}
        >
          <h2
            id={`${headingId}-range`}
            className="text-sm font-medium text-copy"
          >
            Estimated market range
          </h2>
          {rangeAvailable ? (
            <p className="mt-2 flex flex-wrap items-baseline justify-center gap-x-2 text-[clamp(1.35rem,7vw,2.75rem)] leading-tight font-semibold tracking-[-0.05em] text-ink tabular-nums sm:gap-x-3">
              <span>{minimum}</span>
              <span className="font-normal text-copy">–</span>
              <span>{maximum}</span>
            </p>
          ) : (
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink">
              Not enough information yet
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-copy">
            {rangeAvailable
              ? primaryEvidence?.evidenceBasis === "LOSS_DATE_HISTORICAL"
                ? "Based on advertised prices around your date of loss."
                : "Based on current advertised prices."
              : "We can’t show a reliable range from the information available."}
          </p>

          {rangeAvailable && insurerValueAvailable && priceSummary ? (
            <MarketRangeComparison
              minimum={priceSummary.minimumPrice}
              maximum={priceSummary.maximumPrice}
              insurerValue={insurerValue}
              insurerLabel={insurerLabel}
              optimistic={presentation.showContinue}
            />
          ) : insurerValueAvailable ? (
            <p className="mt-4 border-t border-line/70 pt-4 text-sm text-copy">
              {insurerLabel}{" "}
              <strong className="ml-2 font-semibold text-ink tabular-nums">
                {displayMoney(insurerValue)}
              </strong>
            </p>
          ) : null}
        </section>

        <section
          className="mx-auto mt-7 max-w-lg sm:mt-8"
          aria-labelledby={`${headingId}-worthwhile`}
        >
          <div className="flex items-center justify-center gap-2">
            {presentation.showContinue ? (
              <CheckCircle2 className="size-5 shrink-0 text-market" aria-hidden />
            ) : null}
            <h2
              id={`${headingId}-worthwhile`}
              className="text-lg font-semibold tracking-[-0.025em] text-ink sm:text-xl"
            >
              {presentation.worthwhileHeading}
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-pretty text-copy">
            {presentation.worthwhileSummary}
          </p>
        </section>

        {presentation.showContinue ? continueAction ?? (
          <Button
            type="button"
            size="lg"
            className="report-action-focus mt-6 min-h-13 w-full gap-3 rounded-xl bg-brand px-7 text-base font-semibold text-white shadow-[0_8px_20px_-10px_rgba(21,94,239,0.55)] hover:bg-brand-strong sm:w-auto sm:min-w-72"
            data-future-next-step
          >
            Continue my review
            <ArrowRight className="size-5" aria-hidden />
          </Button>
        ) : null}

        <p className="mx-auto mt-5 max-w-lg text-xs leading-5 text-copy">
          Advertised prices aren’t guaranteed sale prices or settlement amounts.
          This review does not determine what your insurer owes.
        </p>
      </div>
    </section>
  );
}

function MarketRangeComparison({
  insurerLabel,
  insurerValue,
  minimum,
  maximum,
  optimistic,
}: {
  readonly insurerLabel: string;
  readonly insurerValue: NonnegativeMoney;
  readonly minimum: NonnegativeMoney;
  readonly maximum: NonnegativeMoney;
  readonly optimistic: boolean;
}) {
  if (
    insurerValue.cents === null ||
    minimum.cents === null ||
    maximum.cents === null
  ) {
    return null;
  }

  // Scale the supplied prices for display only; the verdict remains backend-owned.
  const lower = Math.min(insurerValue.cents, minimum.cents);
  const upper = Math.max(insurerValue.cents, maximum.cents);
  const position = (cents: number) =>
    upper === lower ? 50 : 8 + ((cents - lower) / (upper - lower)) * 84;
  const rangeStart = position(minimum.cents);
  const rangeEnd = position(maximum.cents);

  return (
    <figure
      className="mt-5"
      aria-label={`${insurerLabel}: ${displayMoney(insurerValue)}. Estimated market range: ${displayMoney(minimum)} to ${displayMoney(maximum)}.`}
    >
      <div className="relative h-6" aria-hidden>
        <div className="absolute inset-x-0 top-2 h-2 rounded-full bg-line/70" />
        <div
          className={cn(
            "absolute top-1 h-4 min-w-1 -translate-x-0.5 rounded-full",
            optimistic ? "bg-market" : "bg-copy",
          )}
          style={{ left: `${rangeStart}%`, width: `${rangeEnd - rangeStart}%` }}
        />
        <span
          className="absolute top-0.5 h-5 w-1.5 -translate-x-1/2 rounded-full bg-ink ring-2 ring-white"
          style={{ left: `${position(insurerValue.cents)}%` }}
        />
      </div>
      <figcaption className="mt-3 flex flex-wrap items-start justify-between gap-3 text-left text-xs leading-5 text-copy">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-1 shrink-0 rounded-full bg-ink" aria-hidden />
            <span>{insurerLabel}</span>
          </div>
          <p className="mt-0.5 pl-3 text-base font-semibold text-ink tabular-nums">
            {displayMoney(insurerValue)}
          </p>
        </div>
        <div className="flex items-start justify-end gap-2">
          <span
            className={cn(
              "mt-1.5 h-2 w-5 shrink-0 rounded-full",
              optimistic ? "bg-market" : "bg-copy",
            )}
            aria-hidden
          />
          <span>Estimated market range</span>
        </div>
      </figcaption>
    </figure>
  );
}

function displayMoney(value?: Money | NonnegativeMoney) {
  return value?.display?.replace(/\.00$/u, "") ?? null;
}
