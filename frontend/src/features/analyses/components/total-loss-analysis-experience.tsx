import {
  ArrowRight,
  CarFront,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FileText,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { VEHICLE_FACT_LABELS, type VehicleFactField } from "@/features/total-loss/vehicle-facts";
import type {
  AnalysisPresentation,
  Assessment,
  Money,
  NonnegativeMoney,
} from "@/features/analyses/analysis-presentation.generated";
import {
  formatDate,
  formatDistance,
  formatMileage,
  formatMoneyCents,
} from "@/features/analyses/format";
import { cn } from "@/lib/utils";

import { ValuationStatus, ValuationSurface } from "@/components/valuation-status";
import "./total-loss-analysis-result.css";
import "./preliminary-analysis-result.css";
import "./result-review-panel.css";
import "./result-viewport.css";
import { VehicleDetailQuestion } from "./vehicle-detail-question";

export interface TotalLossAnalysisProgressProps {
  readonly className?: string;
  readonly description?: string;
  readonly eyebrow?: string;
  readonly heading?: string;
  readonly headingLevel?: "h1" | "h2";
}

export function TotalLossAnalysisProgress({
  description =
    "We’re reviewing your saved details. You can leave this page and return later.",
  eyebrow = "Valuation review",
  heading = "We’re reviewing your vehicle.",
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
    heading: "Your insurer’s valuation may be too low.",
    summary:
      "We found market evidence suggesting your vehicle could be worth more.",
    worthwhileHeading: "This looks worth pursuing.",
    worthwhileSummary:
      "The difference looks large enough to review further.",
    showContinue: true,
  },
  POTENTIAL_UNDERVALUE: {
    heading: "Your insurer’s valuation may be too low.",
    summary:
      "We found market evidence suggesting your vehicle could be worth more.",
    worthwhileHeading: "This looks worth pursuing.",
    worthwhileSummary:
      "The difference may be worth reviewing, but the evidence is not yet clear.",
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
      "We need to review the differences before suggesting a next step.",
    showContinue: false,
  },
  INSUFFICIENT_EVIDENCE: {
    heading: "We need more information to be sure.",
    summary:
      "We couldn’t find enough reliable market evidence to assess your insurer’s valuation.",
    worthwhileHeading: "More evidence is needed.",
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
  readonly reportUploadAction?: ReactNode;
  readonly onConfirmVehicleFact?: (field: VehicleFactField, value: string) => Promise<void>;
}

export function TotalLossAnalysisResult(props: TotalLossAnalysisResultProps) {
  if (props.analysis.preliminaryResult?.outcome === "INSUFFICIENT" &&
      ["MISSING_INFORMATION", "UNRESOLVED_CONFIGURATION"].includes(props.analysis.marketSearchContext?.recovery?.kind ?? "")) {
    return <SavedAnalysisResult {...props} />;
  }
  if (props.analysis.preliminaryResult) {
    return <PreliminaryAnalysisResult {...props} result={props.analysis.preliminaryResult} />;
  }
  if (props.analysis.presentationVersion === "8") {
    return <ValuationStatus kind="error" eyebrow="Your review is saved" heading="We couldn’t finish your estimate." description="We couldn’t complete the market check. Your details are saved, and you can continue with your insurer’s valuation report.">
      {props.reportUploadAction ?? (props.insurerReportPath ? <Button asChild size="lg"><Link to={props.insurerReportPath}>{props.analysis.analysisScope.reportAvailable ? "Review saved report" : "Upload valuation report"}<ArrowRight className="size-5" aria-hidden /></Link></Button> : null)}
    </ValuationStatus>;
  }

  return <SavedAnalysisResult {...props} />;
}

function PreliminaryAnalysisResult({
  analysis,
  className,
  reportUploadAction,
  insurerReportPath,
  result,
}: TotalLossAnalysisResultProps & {
  readonly result: NonNullable<AnalysisPresentation["preliminaryResult"]>;
}) {
  const headingId = useId();
  const estimate = result.outcome === "ESTIMATE";
  const context = result.outcome === "LISTING_CONTEXT";
  const range = estimate ? result.estimatedRange : context ? result.listingPriceSpan : null;
  const heading = estimate
    ? "Your preliminary value range."
    : context
      ? "Comparable listing prices"
      : "We need more market evidence.";
  const summary = estimate
    ? null
    : context
      ? "These are asking prices, not a valuation of your vehicle."
      : "Your details are saved. We need more reliable market evidence to estimate a range.";
  const insurerLabel = analysis.insurerValuation.source === "CUSTOMER_ENTERED" ? "Insurer’s offer" : "Insurer’s valuation";
  const comparison = estimate && result.evidenceBasis === "LOSS_DATE_HISTORICAL" ? result.insurerComparison : null;
  const onePrice = range?.lowCents === range?.highCents;
  const sampleLabel = estimate
    ? `${result.sampleSize} independent ${result.sampleSize === 1 ? "vehicle" : "vehicles"}`
    : `${result.sampleSize} ${result.sampleSize === 1 ? "listing" : "listings"}`;

  return <ValuationSurface
    className={cn("valuation-result preliminary-result", className)}
    aria-labelledby={headingId}
    data-total-loss-analysis-result
    data-preliminary-result={result.outcome}
    data-preliminary-result-version={result.version}
  >
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Analysis complete. {heading}</p>
    <div className="preliminary-result__content">
      <ResultReviewHeader />
      <div className="preliminary-result__overview">
        <div className="preliminary-result__finding">
          <p className="preliminary-result__eyebrow">Your result</p>
          <h1 id={headingId} className="preliminary-result__heading">{heading}</h1>
          {range ? <section className="preliminary-result__range" aria-labelledby={`${headingId}-range`}>
            <h2 id={`${headingId}-range`} className="sr-only">{estimate ? "Preliminary estimated range" : onePrice ? "Observed asking price" : "Observed asking-price span"}</h2>
            <p className="preliminary-result__amounts"><span>{formatMoneyCents(range.lowCents)}</span>{!onePrice ? <span className="preliminary-result__range-end"><span className="preliminary-result__range-separator">–</span><span>{formatMoneyCents(range.highCents)}</span></span> : null}</p>
            <p className="preliminary-result__basis">
              {result.evidenceBasis === "LOSS_DATE_HISTORICAL"
                ? `${sampleLabel} · Prices verified around your date of loss`
                : `${sampleLabel} · Current asking prices`}
            </p>
            {comparison ? <>
              <MarketRangeComparison
                minimum={{ cents: range.lowCents, display: formatMoneyCents(range.lowCents) }}
                maximum={{ cents: range.highCents, display: formatMoneyCents(range.highCents) }}
                insurerValue={{ cents: comparison.insurerValueCents, display: formatMoneyCents(comparison.insurerValueCents) }}
                insurerLabel={insurerLabel}
                optimistic={false}
              />
              <p className="preliminary-result__basis">{insurerLabel} is {comparison.position === "BELOW_RANGE" ? "below" : comparison.position === "ABOVE_RANGE" ? "above" : "within"} this preliminary range. This alone does not establish a settlement difference.</p>
            </> : null}
          </section> : null}
          {summary ? <p className="preliminary-result__summary">{summary}</p> : null}
          {range ? <div className="preliminary-result__caveats">
            {result.evidenceBasis !== "LOSS_DATE_HISTORICAL" ? <p>Not a valuation for your date of loss.</p> : null}
            <p>Asking prices aren’t guaranteed sale prices or settlement amounts.</p>
          </div> : null}
          <details className="preliminary-result__details">
            <summary>{result.limitations.length ? `Evidence details · ${result.limitations.length} ${result.limitations.length === 1 ? "limitation" : "limitations"}` : "Evidence details"}<ChevronDown aria-hidden /></summary>
            <div className="preliminary-result__details-content">
              <p>{result.evidenceBasis === "LOSS_DATE_HISTORICAL"
                ? `Based on ${sampleLabel} with advertised prices verified around your date of loss${result.evidenceDate ? `, ${formatDate(result.evidenceDate)}` : ""}.`
                : result.evidenceBasis === "CURRENT_MARKET" ? `Based on ${sampleLabel} in current advertised inventory${result.evidenceDate ? ` as of ${formatDate(result.evidenceDate)}` : ""}. This is not a valuation for your date of loss.`
                  : "There isn’t enough reliable market evidence to estimate a range."}</p>
              {context && result.listings.length > 0 ? <ul className="preliminary-result__listings" aria-label="Comparable listing examples">
                {result.listings.slice(0, 3).map(listing => <li key={listing.identity}>
                  <strong>{formatMoneyCents(listing.askingPriceCents)} asking</strong>
                  <span>{formatMileage(listing.mileage)} · {formatDistance(listing.distanceMiles)} away{listing.certified === true ? " · Certified listing" : ""}</span>
                </li>)}
              </ul> : null}
              {result.limitations.length > 0 ? <ul className="preliminary-result__limitations" aria-label="What limits this result">{result.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul> : null}
            </div>
          </details>
        <section className="preliminary-result__next result-review-panel" aria-labelledby={`${headingId}-next`}>
          <h2 id={`${headingId}-next`}>Know where your insurer’s valuation stands.</h2>
          {!reportUploadAction ? <p className="preliminary-result__next-description">{analysis.analysisScope.reportAvailable ? "Use your saved report to check the vehicle details, comparable vehicles, and adjustments." : "Upload your report to see how your insurer calculated the value."}</p> : null}
          {reportUploadAction || insurerReportPath ? <div className="preliminary-result__action">
            {reportUploadAction ?? <Button asChild size="lg" className="valuation-result__upload-action"><Link to={insurerReportPath!}>{analysis.analysisScope.reportAvailable ? "Review saved report" : "Upload valuation report"}<ArrowRight aria-hidden /></Link></Button>}
          </div> : null}
          <details className="preliminary-result__details preliminary-result__review-details">
            <summary>What does the full review include?<ChevronDown aria-hidden /></summary>
            <div className="preliminary-result__details-content">
              <InsurerReviewScope />
              <p className="preliminary-result__deliverables">Get a valuation report with our findings and guidance on discussing supported concerns with your adjuster.</p>
              <p>Get a detailed review of your vehicle details, comparable vehicles, and adjustments.</p>
              <p className="preliminary-result__purchase-note">We check your report and evidence first. You decide whether to pay for the full review.</p>
            </div>
          </details>
        </section>
        </div>
        <SavedReviewContext analysis={analysis} />
      </div>
    </div>
  </ValuationSurface>;
}

function InsurerReviewScope() {
  return <dl className="result-review-panel__scope" aria-label="What we examine">
    <div><dt><span aria-hidden>01</span>Vehicle details</dt><dd>Trim, mileage, and equipment.</dd></div>
    <div><dt><span aria-hidden>02</span>Comparable vehicles</dt><dd>How well they match your vehicle.</dd></div>
    <div><dt><span aria-hidden>03</span>Valuation adjustments</dt><dd>How adjustments affect the value.</dd></div>
  </dl>;
}

function ResultReviewHeader() {
  return <div className="result-review-header">
    <p>Your valuation review <span>Free valuation</span></p>
    <span className="result-review-header__saved"><CheckCircle2 aria-hidden />Progress saved</span>
  </div>;
}

function SavedReviewContext({ analysis, insurerValue, reviewNote }: { analysis: AnalysisPresentation; insurerValue?: string | null; reviewNote?: string }) {
  return <>
    <aside className="saved-review-context saved-review-context--desktop" aria-label="Saved case information"><SavedReviewDetails analysis={analysis} insurerValue={insurerValue} /></aside>
    <Dialog.Root>
      <Dialog.Trigger asChild><button className="result-context-trigger" type="button"><FileText aria-hidden /><span>Case details & review notes</span><ChevronDown aria-hidden /></button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="result-context-overlay" />
        <Dialog.Content className="result-context-dialog">
          <Dialog.Title>Case details</Dialog.Title>
          <Dialog.Description>Your vehicle, saved report, and review notes.</Dialog.Description>
          <div className="saved-review-context"><SavedReviewDetails analysis={analysis} insurerValue={insurerValue} /></div>
          {reviewNote ? <p className="result-context-dialog__note">{reviewNote}</p> : null}
          <p className="result-context-dialog__note">Advertised prices aren’t guaranteed sale prices or settlement amounts. This review does not determine what your insurer owes.</p>
          <Dialog.Close asChild><button className="result-context-dialog__close" aria-label="Close case details"><X aria-hidden /></button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}

function SavedReviewDetails({ analysis, insurerValue }: { analysis: AnalysisPresentation; insurerValue?: string | null }) {
  const vehicle = [analysis.vehicle.year, analysis.vehicle.make, analysis.vehicle.model].filter(Boolean).join(" ");
  const savedReport = analysis.analysisScope.reportAvailable;
  const ReportIcon = savedReport ? FileCheck2 : FileText;
  return <>
    <p className="saved-review-context__eyebrow">Case overview</p>
    <div className="saved-review-context__vehicle">
      <CarFront aria-hidden />
      <p><span className="sr-only">Vehicle reviewed: </span>{vehicle}<span>{analysis.vehicle.trim}</span></p>
    </div>
    {insurerValue ? <dl className="saved-review-context__value"><dt>{analysis.insurerValuation.source === "CUSTOMER_ENTERED" ? "Insurer’s offer" : "Insurer’s valuation"}</dt><dd>{insurerValue}</dd></dl> : null}
    <div className="saved-review-context__document">
      <ReportIcon aria-hidden />
      <div><p>Valuation report</p><span>{savedReport ? "Saved to your case" : "Not added yet"}</span></div>
      {savedReport ? <CheckCircle2 className="saved-review-context__check" aria-label="Saved" /> : null}
    </div>
    <p className="saved-review-context__note">{savedReport ? "You can return to this review at any time." : "Add your insurer’s report to keep your review details together."}</p>
  </>;
}

function SavedAnalysisResult({
  addInsurerOfferPath,
  analysis,
  className,
  continueAction,
  reviewIntakePath,
  insurerReportPath,
  reportUploadAction,
  onConfirmVehicleFact,
}: TotalLossAnalysisResultProps) {
  const headingId = useId();
  const primaryEvidence = analysis.preliminaryResult?.outcome === "INSUFFICIENT" ? null : analysis.primaryExternalEvidence;
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
  const inconclusive = analysis.preliminaryResult?.outcome === "INSUFFICIENT" || analysis.assessment.classification === "INSUFFICIENT_EVIDENCE" || analysis.assessment.classification === "CONFLICTING_EVIDENCE";
  const recovery = inconclusive && !missingOfferBlocksComparison ? analysis.marketSearchContext?.recovery : undefined;
  const correctionFieldLabel = recovery?.field ? VEHICLE_FACT_LABELS[recovery.field as VehicleFactField] : undefined;
  const targetedCorrectionPath = recovery && ["MISSING_INFORMATION", "UNRESOLVED_CONFIGURATION"].includes(recovery.kind) && recovery.field && recovery.correctionStep && reviewIntakePath
    ? `${reviewIntakePath}&focus=${encodeURIComponent(recovery.correctionStep)}&vehicleFact=${encodeURIComponent(recovery.field)}` : undefined;
  const correctionLabel = correctionFieldLabel ? `Confirm ${correctionFieldLabel.toLowerCase()}` : "Review your details";
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
          ? "We found prices for similar vehicles. Add your insurer’s offer to compare them."
          : "We couldn’t find enough reliable market evidence to estimate a range.",
        worthwhileHeading: rangeAvailable
          ? "Your insurer’s offer completes the picture."
          : "More evidence is needed.",
        worthwhileSummary: rangeAvailable
          ? "We need the offer to see whether the difference is worth reviewing."
          : "We can’t yet tell whether the difference is worth reviewing.",
        showContinue: false,
      };
  const presentation: ResultPresentation = recovery ? {
    ...basePresentation,
    showContinue: false,
    heading: targetedCorrectionPath && correctionFieldLabel ? `Confirm your ${correctionFieldLabel.toLowerCase()}.`
      : recovery.kind === "MISSING_INFORMATION" ? "A few details are missing."
      : recovery.kind === "SEARCH_INTERRUPTED" ? "We couldn’t finish your estimate."
      : recovery.kind === "UNRESOLVED_CONFIGURATION" && analysis.analysisScope.reportAvailable ? "Review your saved report."
      : "We can’t give a reliable range yet.",
    summary: recovery.message,
    worthwhileHeading: "Your case is saved.",
    worthwhileSummary: "Your information is saved for a closer review.",
  } : basePresentation;

  return (
    <ValuationSurface
      className={cn("valuation-result saved-result", targetedCorrectionPath && "saved-result--correction", className)}
      aria-labelledby={headingId}
      data-analysis-classification={analysis.assessment.classification}
      data-total-loss-analysis-result
      data-supports-continuation={presentation.showContinue || undefined}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Analysis complete. {presentation.heading}
      </p>

      <div className="valuation-result__content">
        <ResultReviewHeader />
        <div className="saved-result__layout">
        <div className="saved-result__finding">
        <p className="valuation-result__eyebrow workspace-stage__eyebrow">{targetedCorrectionPath ? "One detail to confirm" : recovery ? "Your next step" : "Your result"}</p>
        <h1
          id={headingId}
          className="valuation-result__heading"
        >
          {presentation.heading}
        </h1>
        <p className="valuation-result__summary">
          {presentation.summary}
        </p>
        {targetedCorrectionPath ? <p className="saved-result__compact-summary">Choose the {correctionFieldLabel?.toLowerCase() ?? "detail"} shown in your vehicle documents.</p> : null}

        {rangeAvailable ? <section
          className="valuation-result__range"
          aria-labelledby={`${headingId}-range`}
        >
          <h2
            id={`${headingId}-range`}
            className="valuation-result__range-label"
          >
            Estimated market range
          </h2>
          <p className="valuation-result__amounts">
            <span>{minimum}</span>
            <span className="valuation-result__range-separator">–</span>
            <span>{maximum}</span>
          </p>
          <p className="valuation-result__basis">
            {primaryEvidence?.evidenceBasis === "LOSS_DATE_HISTORICAL"
              ? "Based on advertised prices around your date of loss."
              : "Based on current advertised prices."}
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
        </section> : null}

        {!recovery ? <section
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
        </section> : null}

        {insurerReportPath || reportUploadAction || presentation.showContinue || targetedCorrectionPath || addInsurerOfferPath ? <section className={cn("valuation-result__actions result-review-panel", targetedCorrectionPath && "result-review-panel--question")} aria-labelledby={`${headingId}-next`}>
          <h2 id={`${headingId}-next`} className={recovery || targetedCorrectionPath ? "sr-only" : undefined}>{targetedCorrectionPath || missingOfferBlocksComparison ? "Complete your vehicle details" : "Continue your review"}</h2>
          {presentation.showContinue ? continueAction ?? (
            <Button
              type="button"
              size="lg"
              className="report-action-focus mt-6 min-h-13 w-full gap-3 rounded-xl bg-brand px-7 text-base font-semibold text-white shadow-sm hover:bg-brand-strong sm:w-auto sm:min-w-72"
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

          {targetedCorrectionPath && correctionFieldLabel && onConfirmVehicleFact ? <VehicleDetailQuestion key={recovery!.field} field={recovery!.field as VehicleFactField} onConfirm={onConfirmVehicleFact} />
            : targetedCorrectionPath ? <Button asChild size="lg" className="mt-6"><Link to={targetedCorrectionPath}>{correctionLabel}<ArrowRight className="size-5" aria-hidden /></Link></Button> : null}

          {insurerReportPath && !presentation.showContinue ? <div className="saved-result__report-action">{reportUploadAction ?? <Button asChild size="lg" variant={targetedCorrectionPath ? "outline" : "default"}><Link to={insurerReportPath}>{analysis.analysisScope.reportAvailable ? "Review saved report" : "Upload valuation report"}<ArrowRight className="size-5" aria-hidden /></Link></Button>}</div> : null}

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
          {!targetedCorrectionPath && (insurerReportPath || reportUploadAction) ? <details className="preliminary-result__details result-review-panel__scope-details"><summary>What we look for in your report<ChevronDown aria-hidden /></summary><InsurerReviewScope /></details> : null}
        </section> : null}
        </div>
        <SavedReviewContext analysis={analysis} insurerValue={!rangeAvailable && insurerValueAvailable ? displayMoney(insurerValue) : null} reviewNote={presentation.summary} />
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
