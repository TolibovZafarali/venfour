import {
  ArrowRight,
  CarFront,
  CheckCircle2,
} from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type {
  AnalysisPresentation,
  Assessment,
  Money,
  NonnegativeMoney,
} from "@/features/analyses/analysis-presentation.generated";
import { cn } from "@/lib/utils";

import { ValuationStatus, ValuationSurface } from "@/components/valuation-status";
import "./total-loss-analysis-result.css";

export interface TotalLossAnalysisProgressProps {
  readonly className?: string;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly heading?: string;
  readonly headingLevel?: "h1" | "h2";
}

export function TotalLossAnalysisProgress({
  description =
    "Venfour is examining the saved information now. You can safely leave this page and return later.",
  eyebrow = "Reviewing & analyzing",
  heading = "We’re reviewing and analyzing your claim.",
  headingLevel = "h1",
}: TotalLossAnalysisProgressProps = {}) {
  return <ValuationStatus kind="loading" heading={heading} description={description} eyebrow={eyebrow} headingLevel={headingLevel} />;
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
  readonly addInsurerOfferPath?: string;
  readonly analysis: AnalysisPresentation;
  readonly className?: string;
  readonly continueAction?: ReactNode;
  readonly reviewIntakePath?: string;
  readonly insurerReportPath?: string;
}

export function TotalLossAnalysisResult({
  addInsurerOfferPath,
  analysis,
  className,
  continueAction,
  reviewIntakePath,
  insurerReportPath,
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
  const missingOfferBlocksComparison =
    analysis.analysisScope.inputMode === "MANUAL" &&
    !analysis.analysisScope.reportAvailable &&
    !analysis.analysisScope.insurerValuationAvailable &&
    !analysis.analysisScope.insurerValuationComparisonPerformed &&
    analysis.insurerValuation.source === "NONE" &&
    insurerValue.cents === null &&
    analysis.analysisScope.marketEvidenceAvailable &&
    rangeAvailable &&
    analysis.assessment.classification === "INSUFFICIENT_EVIDENCE" &&
    analysis.findings.some(
      ({ code }) => code === "MISSING_CCC_VEHICLE_VALUATION",
    ) &&
    !analysis.findings.some(
      ({ code }) =>
        code === "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE" ||
        code === "EXTERNAL_MEDIAN_ZERO",
    );
  const inconclusive = analysis.assessment.classification === "INSUFFICIENT_EVIDENCE" || analysis.assessment.classification === "CONFLICTING_EVIDENCE";
  const recovery = inconclusive && !missingOfferBlocksComparison ? analysis.marketSearchContext?.recovery : undefined;
  const targetedCorrectionPath = recovery?.kind === "MISSING_INFORMATION" && recovery.field && ["postalCode", "lossDate", "mileage", "year", "make", "model", "insurerOffer"].includes(recovery.field) && recovery.correctionStep && reviewIntakePath
    ? `${reviewIntakePath}&focus=${encodeURIComponent(recovery.correctionStep)}&vehicleFact=${encodeURIComponent(recovery.field)}` : undefined;
  const correctionLabel = "Review your details";
  const insurerLabel =
    analysis.insurerValuation.source === "CUSTOMER_ENTERED"
      ? "Insurer’s offer"
      : "Insurer’s valuation";
  const basePresentation: ResultPresentation = insurerValueAvailable
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

  const presentation: ResultPresentation = recovery ? {
    ...basePresentation,
    heading: recovery.kind === "MISSING_INFORMATION" ? "A few details are missing."
      : recovery.kind === "SEARCH_INTERRUPTED" ? "We couldn’t finish your estimate." : "We need more evidence to be sure.",
    summary: recovery.kind === "MISSING_INFORMATION" ? "Check the details you entered so we can continue your review."
      : recovery.kind === "SEARCH_INTERRUPTED" ? "We couldn’t complete the check right now. Your information is saved."
      : "We couldn’t establish a reliable preliminary range from the available evidence. Your insurer’s report can help us take a closer look.",
    worthwhileHeading: "Your case is saved.",
    worthwhileSummary: "You can add your insurer’s valuation report for a closer review.",
  } : basePresentation;

  return (
    <ValuationSurface
      className={cn("valuation-result", className)}
      aria-labelledby={headingId}
      data-analysis-classification={analysis.assessment.classification}
      data-total-loss-analysis-result
      data-supports-continuation={presentation.showContinue || undefined}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Analysis complete. {presentation.heading}
      </p>

      <div className="valuation-result__content">
        <div className="valuation-result__vehicle">
          <CarFront aria-hidden />
          <p>
            <span className="sr-only">Vehicle reviewed: </span>
            {vehicle}
          </p>
        </div>

        <h1
          id={headingId}
          className="valuation-result__heading"
        >
          {presentation.heading}
        </h1>
        <p className="valuation-result__summary">
          {presentation.summary}
        </p>

        <section
          className="valuation-result__range"
          aria-labelledby={`${headingId}-range`}
        >
          <h2
            id={`${headingId}-range`}
            className="valuation-result__range-label"
          >
            Estimated market range
          </h2>
          {rangeAvailable ? (
            <p className="valuation-result__amounts">
              <span>{minimum}</span>
              <span className="valuation-result__range-separator">–</span>
              <span>{maximum}</span>
            </p>
          ) : (
            <p className="valuation-result__unavailable">
              Not enough information yet
            </p>
          )}
          <p className="valuation-result__basis">
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
            <p className="valuation-result__standalone-offer">
              {insurerLabel}{" "}
              <strong className="ml-2 font-semibold text-ink tabular-nums">
                {displayMoney(insurerValue)}
              </strong>
            </p>
          ) : null}
        </section>

        <section
          className="valuation-result__conclusion"
          aria-labelledby={`${headingId}-worthwhile`}
        >
          <div className="valuation-result__conclusion-heading">
            {presentation.showContinue ? (
              <CheckCircle2 className="size-5 shrink-0 text-market" aria-hidden />
            ) : null}
            <h2
              id={`${headingId}-worthwhile`}
              className="valuation-result__next-heading"
            >
              {presentation.worthwhileHeading}
            </h2>
          </div>
          <p className="valuation-result__next-description">
            {presentation.worthwhileSummary}
          </p>
        </section>

        <div className="valuation-result__actions">
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

          {missingOfferBlocksComparison && addInsurerOfferPath ? (
            <Button
              asChild
              size="lg"
              className="report-action-focus mt-6 min-h-13 w-full gap-3 rounded-xl px-7 text-base font-semibold sm:w-auto sm:min-w-72"
            >
              <Link to={addInsurerOfferPath}>
                Add insurer offer
                <ArrowRight className="size-5" aria-hidden />
              </Link>
            </Button>
          ) : null}

          {targetedCorrectionPath ? <Button asChild size="lg" className="mt-6"><Link to={targetedCorrectionPath}>{correctionLabel}<ArrowRight className="size-5" aria-hidden /></Link></Button> : null}

          {insurerReportPath && !presentation.showContinue ? <div className="mt-6"><Button asChild size="lg" variant={targetedCorrectionPath ? "outline" : "default"}><Link to={insurerReportPath}>Upload insurer valuation PDF<ArrowRight className="size-5" aria-hidden /></Link></Button><p className="mt-3 text-sm text-copy">We’ll check the report and vehicle details before payment is available.</p></div> : null}

          {reviewIntakePath && !targetedCorrectionPath && (!recovery || recovery.kind === "MISSING_INFORMATION") ? (
            <div className="valuation-result__intake-action">
              <Button
                asChild
                variant="link"
                className="min-h-11 px-3 font-semibold text-copy hover:text-ink"
              >
                <Link to={reviewIntakePath}>Review your details</Link>
              </Button>
            </div>
          ) : null}
        </div>

        <p className="valuation-result__disclaimer">
          Advertised prices aren’t guaranteed sale prices or settlement amounts.
          This review does not determine what your insurer owes.
        </p>
      </div>
    </ValuationSurface>
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
      className="valuation-result__comparison"
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
