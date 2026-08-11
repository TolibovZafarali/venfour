import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Gauge,
  Info,
  MapPin,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  AnalysisPresentation,
  Assessment,
  CccComparableRow,
  EvidenceSection,
  ExternalComparable,
  Finding,
  Money,
  NonnegativeMoney,
} from "@/features/analyses/analysis-presentation.generated";
import {
  formatDate,
  formatDateTime,
  formatDistance,
  formatMileage,
  formatMileageDifference,
  formatMoneyCents,
  formatWholeNumber,
  joinPresent,
  unavailable,
} from "@/features/analyses/format";
import { cn } from "@/lib/utils";

interface AnalysisResultsProps {
  analysis: AnalysisPresentation;
}

const assessmentHeadings: Record<Assessment["classification"], string> = {
  MATERIAL_UNDERVALUE_SIGNAL:
    "Strong evidence suggests your CCC valuation may be low",
  POTENTIAL_UNDERVALUE:
    "Market evidence suggests your CCC valuation may be low",
  NO_MATERIAL_DISCREPANCY:
    "The available market evidence does not show a material gap",
  CONFLICTING_EVIDENCE: "The available market evidence is mixed",
  INSUFFICIENT_EVIDENCE:
    "There isn’t enough reliable evidence to assess the CCC valuation",
};

function displayMoney(value: Money | NonnegativeMoney) {
  return value.display ?? unavailable;
}

function displayMoneyMagnitude(value: Money | NonnegativeMoney) {
  const display = displayMoney(value);
  return display.startsWith("-$") ? `$${display.slice(2)}` : display;
}

function displayPercentageMagnitude(value: string | null) {
  return value?.replace(/^-/, "") ?? unavailable;
}

function vehicleName({
  year,
  make,
  model,
  trim,
}: Pick<ExternalComparable, "year" | "make" | "model" | "trim">) {
  return [year, make, model, trim].filter(Boolean).join(" ");
}

function cccVehicleName(row: CccComparableRow) {
  const name = [row.year, row.make, row.model, row.trim]
    .filter(Boolean)
    .join(" ");
  return name || `CCC comparable ${row.comparableNumber ?? row.index + 1}`;
}

interface SectionHeadingProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
}

function SectionHeading({ id, eyebrow, title, description }: SectionHeadingProps) {
  return (
    <div className="max-w-3xl">
      {eyebrow ? (
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 leading-7 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}

function Metric({ label, value, detail, emphasis = false }: MetricProps) {
  return (
    <div className="border-t border-border/80 pt-4">
      <dt className="text-sm leading-5 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-semibold tracking-tight tabular-nums",
          emphasis ? "text-3xl text-evidence" : "text-2xl",
        )}
      >
        {value}
      </dd>
      {detail ? (
        <dd className="mt-1 text-sm text-muted-foreground">{detail}</dd>
      ) : null}
    </div>
  );
}

function assessmentSummary(analysis: AnalysisPresentation) {
  const primary = analysis.primaryExternalEvidence;
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  if (!primary || !comparison) {
    return analysis.assessment.summary;
  }

  const evidenceName =
    primary.evidenceBasis === "LOSS_DATE_HISTORICAL"
      ? "loss-date market evidence"
      : "current-market evidence";
  const difference = comparison.difference.display;
  const percentage = comparison.differencePercent.display;
  const differenceCents = comparison.difference.cents;
  const relationship =
    typeof differenceCents === "number" && differenceCents > 0
      ? "above"
      : typeof differenceCents === "number" && differenceCents < 0
        ? "below"
        : "the same as";
  if (difference && percentage && relationship !== "the same as") {
    return `The strongest available ${evidenceName} had a median advertised price of ${displayMoney(
      primary.prices.medianPrice,
    )}. That is ${displayMoneyMagnitude(comparison.difference)} (${displayPercentageMagnitude(
      percentage,
    )}) ${relationship} CCC’s ${displayMoney(
      analysis.cccValuation.adjustedVehicleValue,
    )} adjusted vehicle value.`;
  }

  return `The strongest available ${evidenceName} had a median advertised price of ${displayMoney(
    primary.prices.medianPrice,
  )}, ${relationship} CCC’s ${displayMoney(
    analysis.cccValuation.adjustedVehicleValue,
  )} adjusted vehicle value.`;
}

function MarketRangeFigure({ analysis }: AnalysisResultsProps) {
  const primary = analysis.primaryExternalEvidence;
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  if (!primary || !comparison) {
    return null;
  }

  const cccValue = analysis.cccValuation.adjustedVehicleValue.cents;
  const minimum = primary.prices.minimumPrice.cents;
  const median = primary.prices.medianPrice.cents;
  const maximum = primary.prices.maximumPrice.cents;
  const numericValues = [cccValue, minimum, median, maximum];
  const hasCompleteScale = numericValues.every(
    (value): value is number => typeof value === "number",
  );
  const evidenceLabel =
    primary.evidenceBasis === "LOSS_DATE_HISTORICAL"
      ? "selected loss-date historical range"
      : "selected current-market range";
  const relationshipCopy = {
    BELOW_OBSERVED_RANGE: `CCC’s value is below the entire ${evidenceLabel}.`,
    WITHIN_OBSERVED_RANGE: `CCC’s value falls within the ${evidenceLabel}.`,
    ABOVE_OBSERVED_RANGE: `CCC’s value is above the entire ${evidenceLabel}.`,
  }[comparison.cccPositionInExternalRange];

  if (!hasCompleteScale) {
    return (
      <div className="mt-8 rounded-xl border bg-background p-5">
        <p className="font-medium">{relationshipCopy}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          A complete plotted range is unavailable for this analysis.
        </p>
      </div>
    );
  }

  const [cccNumeric, minimumNumeric, medianNumeric, maximumNumeric] =
    numericValues;
  const domainMinimum = Math.min(...numericValues);
  const domainMaximum = Math.max(...numericValues);
  if (domainMaximum === domainMinimum) {
    return (
      <div className="mt-8 rounded-xl border bg-background p-5">
        <p className="font-medium">{relationshipCopy}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Every value shown on this comparison is {displayMoney(
            analysis.cccValuation.adjustedVehicleValue,
          )}.
        </p>
      </div>
    );
  }

  const scaleIncrement = 100_000;
  const scaleMinimum = Math.max(
    0,
    Math.floor(domainMinimum / scaleIncrement) * scaleIncrement -
      scaleIncrement,
  );
  const scaleMaximum =
    Math.ceil(domainMaximum / scaleIncrement) * scaleIncrement + scaleIncrement;
  const scaleSpan = scaleMaximum - scaleMinimum;
  const position = (value: number) =>
    ((value - scaleMinimum) / scaleSpan) * 100;
  const rangeStart = position(minimumNumeric);
  const rangeEnd = position(maximumNumeric);
  const cccPosition = position(cccNumeric);
  const medianPosition = position(medianNumeric);

  return (
    <figure
      className="mt-8 rounded-xl border bg-background p-5 sm:p-6"
      aria-label={`CCC adjusted value ${displayMoney(
        analysis.cccValuation.adjustedVehicleValue,
      )}; ${evidenceLabel} ${displayMoney(
        primary.prices.minimumPrice,
      )} to ${displayMoney(
        primary.prices.maximumPrice,
      )}; median ${displayMoney(primary.prices.medianPrice)}.`}
    >
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold">Value position</p>
          <p className="mt-1 text-sm text-muted-foreground">
            All markers share the same dollar scale, extended beyond the shown
            values to $1,000 boundaries for context.
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          Scale: {formatMoneyCents(scaleMinimum)} –{" "}
          {formatMoneyCents(scaleMaximum)}
        </p>
      </div>

      <div className="relative mt-9 h-20" aria-hidden="true">
        <div className="absolute inset-x-0 top-8 h-px bg-border" />
        <div
          className="absolute top-[1.625rem] h-3 rounded-full bg-evidence/30 ring-1 ring-evidence/45"
          style={{
            left: `${rangeStart}%`,
            width: `${Math.max(rangeEnd - rangeStart, 0.8)}%`,
          }}
        />
        <div
          className="absolute top-4 h-9 w-0.5 bg-foreground"
          style={{ left: `${cccPosition}%` }}
        >
          <span
            className={cn(
              "absolute -top-5 whitespace-nowrap text-xs font-semibold text-foreground",
              cccPosition > 70
                ? "right-0"
                : cccPosition < 30
                  ? "left-0"
                  : "left-1/2 -translate-x-1/2",
            )}
          >
            CCC
          </span>
        </div>
        <div
          className="absolute top-[1.4rem] size-4 rotate-45 border-2 border-background bg-evidence shadow-sm"
          style={{
            left: `${medianPosition}%`,
            transform: "translateX(-50%) rotate(45deg)",
          }}
        />
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-0.5 bg-foreground" aria-hidden="true" />
          <span>
            CCC value{" "}
            <strong className="font-semibold tabular-nums">
              {displayMoney(analysis.cccValuation.adjustedVehicleValue)}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-6 rounded-full bg-evidence/35 ring-1 ring-evidence/50"
            aria-hidden="true"
          />
          <span>
            Range{" "}
            <strong className="font-semibold tabular-nums">
              {displayMoney(primary.prices.minimumPrice)}–
              {displayMoney(primary.prices.maximumPrice)}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="size-3 rotate-45 bg-evidence"
            aria-hidden="true"
          />
          <span>
            Median{" "}
            <strong className="font-semibold tabular-nums">
              {displayMoney(primary.prices.medianPrice)}
            </strong>
          </span>
        </div>
      </div>

      <figcaption className="mt-5 border-t pt-4 font-medium">
        {relationshipCopy}
      </figcaption>
    </figure>
  );
}

function PrimaryAssessment({ analysis }: AnalysisResultsProps) {
  const primary = analysis.primaryExternalEvidence;
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  const gapLabel =
    analysis.assessment.classification === "MATERIAL_UNDERVALUE_SIGNAL" ||
    analysis.assessment.classification === "POTENTIAL_UNDERVALUE"
      ? "Evidence gap"
      : "Difference from primary median";

  return (
    <section className="mt-10 overflow-hidden rounded-2xl border border-evidence/25 bg-card shadow-[0_18px_50px_-42px_rgba(15,23,42,0.55)]">
      <div className="border-l-4 border-evidence p-6 sm:p-8 lg:p-10">
        <div className="max-w-4xl">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-evidence/10 px-3 py-1 font-semibold text-evidence">
              {analysis.assessment.evidenceStrengthLabel} evidence
            </span>
            <span className="text-muted-foreground">
              {analysis.assessment.evidenceBasis === "LOSS_DATE_HISTORICAL"
                ? "Based primarily on verified loss-date listings"
                : analysis.assessment.evidenceBasis === "CURRENT_MARKET"
                  ? "Based primarily on current-market listings"
                  : "No primary market evidence available"}
            </span>
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl lg:text-[2.7rem] lg:leading-[1.12]">
            {assessmentHeadings[analysis.assessment.classification]}
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {assessmentSummary(analysis)}
          </p>
        </div>

        <dl className="mt-9 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="CCC adjusted vehicle value"
            value={displayMoney(analysis.cccValuation.adjustedVehicleValue)}
          />
          <Metric
            label={
              primary?.evidenceBasis === "LOSS_DATE_HISTORICAL"
                ? "Loss-date market median"
                : "Primary market median"
            }
            value={
              primary ? displayMoney(primary.prices.medianPrice) : unavailable
            }
            emphasis={Boolean(primary)}
          />
          <Metric
            label={gapLabel}
            value={
              comparison ? displayMoney(comparison.difference) : unavailable
            }
            detail={comparison?.differencePercent.display ?? undefined}
          />
          <Metric
            label="Observed market range"
            value={
              primary
                ? `${displayMoney(primary.prices.minimumPrice)}–${displayMoney(
                    primary.prices.maximumPrice,
                  )}`
                : unavailable
            }
          />
        </dl>

        <MarketRangeFigure analysis={analysis} />

        <div className="mt-6 flex gap-3 rounded-xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Market evidence is not an independent appraisal or a guaranteed
            settlement amount. Advertised prices are not completed sales, and
            this analysis does not determine what an insurer legally owes.
          </p>
        </div>
      </div>
    </section>
  );
}

interface Explanation {
  title: string;
  body: ReactNode;
}

function assessmentFindingExplanation(
  analysis: AnalysisPresentation,
  code: Finding["code"],
): Explanation | null {
  const primary = analysis.primaryExternalEvidence;
  const secondary = analysis.secondaryExternalEvidence;

  switch (code) {
    case "HISTORICAL_CURRENT_SIGNALS_CONFLICT":
      return {
        title: "Loss-date and current-market signals differ",
        body:
          primary && secondary ? (
            <>
              The primary loss-date median is{" "}
              {displayMoney(primary.prices.medianPrice)}, while the separate
              current-market median is{" "}
              {displayMoney(secondary.prices.medianPrice)}. Because those price
              sets point in different directions, the result is mixed; the
              loss-date evidence remains primary.
            </>
          ) : (
            "The available market signals point in different directions, which limits a single clear conclusion."
          ),
      };
    case "EXTERNAL_MARKET_HIGH_DISPERSION":
      return {
        title: "Selected market prices vary widely",
        body: primary ? (
          <>
            The selected primary prices range from{" "}
            {displayMoney(primary.prices.minimumPrice)} to{" "}
            {displayMoney(primary.prices.maximumPrice)}. That spread limits how
            much weight to place on one central price.
          </>
        ) : (
          "The selected market prices are spread out enough to limit confidence in one central price."
        ),
      };
    case "INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE":
      return {
        title: "Reliable external evidence is insufficient",
        body:
          "Too few independently selected comparable vehicles were available to support a reliable market comparison.",
      };
    case "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT":
      return {
        title: "CCC and the selected market evidence are broadly consistent",
        body:
          "The available primary comparison does not show a material discrepancy from CCC’s adjusted vehicle value.",
      };
    case "EXTERNAL_MEDIAN_EQUALS_CCC":
      return {
        title: "The selected market median matches CCC",
        body: primary ? (
          <>
            The selected primary median and CCC’s adjusted vehicle value are
            both {displayMoney(primary.prices.medianPrice)}.
          </>
        ) : (
          "The selected external median matches CCC’s adjusted vehicle value."
        ),
      };
    default:
      return null;
  }
}

function buildExplanations(analysis: AnalysisPresentation): Explanation[] {
  const explanations: Explanation[] = [];
  const primary = analysis.primaryExternalEvidence;
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  const findingCodes = new Set(analysis.findings.map((finding) => finding.code));

  for (const finding of analysis.findings) {
    if (
      finding.code === "CCC_AND_EXTERNAL_EVIDENCE_CONSISTENT" &&
      findingCodes.has("EXTERNAL_MEDIAN_EQUALS_CCC")
    ) {
      continue;
    }

    const explanation = assessmentFindingExplanation(analysis, finding.code);
    if (explanation) {
      explanations.push(explanation);
    }
  }

  if (primary && analysis.comparablesUsed.primary.length > 0) {
    const comparables = analysis.comparablesUsed.primary;
    const allStrong = comparables.every((comparable) => comparable.tier === "STRONG");
    const allVerifiedOnDate = comparables.every(
      (comparable) =>
        comparable.evidenceBasis === "LOSS_DATE_HISTORICAL" &&
        comparable.lifecycleEvidence?.status === "RESOLVED",
    );
    const count = primary.selectedCount;

    explanations.push({
      title:
        primary.evidenceBasis === "LOSS_DATE_HISTORICAL"
          ? `${formatWholeNumber(count)} loss-date comparables were selected`
          : `${formatWholeNumber(count)} current-market comparables were selected`,
      body: allVerifiedOnDate ? (
        <>
          Each selected listing was verified active on the loss date
          {allStrong ? " and classified as a strong match" : ""}.
        </>
      ) : allStrong ? (
        "Every selected listing was classified as a strong match."
      ) : (
        "The selected vehicles form the primary external evidence set."
      ),
    });
  }

  if (comparison && primary && findingCodes.has("CCC_BELOW_EXTERNAL_RANGE")) {
    const rangeName =
      primary.evidenceBasis === "LOSS_DATE_HISTORICAL"
        ? "historical"
        : "current-market";
    explanations.push({
      title: `CCC falls below the selected ${rangeName} range`,
      body: `CCC’s ${displayMoney(
        analysis.cccValuation.adjustedVehicleValue,
      )} adjusted value is below the lowest selected ${
        primary.evidenceBasis === "LOSS_DATE_HISTORICAL"
          ? "loss-date"
          : "current-market"
      } listing at ${displayMoney(primary.prices.minimumPrice)}.`,
    });
  }

  if (
    comparison &&
    (findingCodes.has("EXTERNAL_MEDIAN_ABOVE_CCC") ||
      findingCodes.has("EXTERNAL_MEDIAN_BELOW_CCC"))
  ) {
    const externalMedianAbove = findingCodes.has("EXTERNAL_MEDIAN_ABOVE_CCC");
    const evidenceName =
      primary?.evidenceBasis === "LOSS_DATE_HISTORICAL"
        ? "loss-date median"
        : "primary median";
    const relation = externalMedianAbove ? "above" : "below";
    explanations.push({
      title: `The ${evidenceName} is ${
        displayPercentageMagnitude(comparison.differencePercent.display)
      } ${relation} CCC`,
      body: `The selected external median differs from CCC’s adjusted vehicle value by ${displayMoneyMagnitude(
        comparison.difference,
      )}.`,
    });
  }

  const cccAdjustmentComparison =
    analysis.cccValuation.supportingComparisons
      .cccAdvertisedMedianVsAdjustedMedian;
  if (
    cccAdjustmentComparison &&
    comparison &&
    (findingCodes.has("CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES") ||
      findingCodes.has("CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES") ||
      findingCodes.has("CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE"))
  ) {
    const adjustmentDirection =
      analysis.cccComparables.summary.adjustmentDirection?.code;
    const adjustmentChange =
      adjustmentDirection === "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES"
        ? `a ${displayMoneyMagnitude(cccAdjustmentComparison.difference)} decrease`
        : adjustmentDirection === "CCC_ADJUSTMENTS_INCREASE_COMPARABLE_VALUES"
          ? `a ${displayMoneyMagnitude(cccAdjustmentComparison.difference)} increase`
          : adjustmentDirection === "CCC_ADJUSTMENTS_NO_MEDIAN_CHANGE"
            ? "no change"
            : `a ${displayMoneyMagnitude(cccAdjustmentComparison.difference)} difference`;

    explanations.push({
      title: "CCC’s comparable adjustments provide additional context",
      body: (
        <>
          CCC’s paired advertised median was{" "}
          {displayMoney(cccAdjustmentComparison.firstValue)} and its adjusted
          median was {displayMoney(cccAdjustmentComparison.secondValue)}, {" "}
          {adjustmentChange}. The external evidence gap is{" "}
          {displayMoneyMagnitude(comparison.difference)}; the direction of CCC’s
          adjustments alone does not establish that an adjustment was improper.
        </>
      ),
    });
  }

  if (explanations.length === 0) {
    explanations.push({
      title: "Assessment based on the available evidence",
      body: analysis.assessment.summary,
    });
  }

  return explanations.slice(0, 4);
}

function WhyFlagged({ analysis }: AnalysisResultsProps) {
  const explanations = buildExplanations(analysis);
  const undervalueAssessment =
    analysis.assessment.classification === "MATERIAL_UNDERVALUE_SIGNAL" ||
    analysis.assessment.classification === "POTENTIAL_UNDERVALUE";

  return (
    <section className="mt-20" aria-labelledby="why-heading">
      <SectionHeading
        id="why-heading"
        eyebrow="Assessment details"
        title={
          undervalueAssessment
            ? "Why Venfour flagged the valuation"
            : "How Venfour reached this assessment"
        }
        description="These explanations combine the supported findings into the facts that matter most for understanding the result."
      />
      <ol className="mt-9 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {explanations.map((explanation, index) => (
          <li key={`${explanation.title}-${index}`} className="flex gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-evidence/10 text-sm font-semibold text-evidence tabular-nums">
              {index + 1}
            </span>
            <div>
              <h3 className="font-semibold leading-6">{explanation.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {explanation.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}

function ComparableCard({ comparable }: { comparable: ExternalComparable }) {
  const dealerLocation = comparable.dealer
    ? joinPresent([
        comparable.dealer.city,
        comparable.dealer.state,
        comparable.dealer.postalCode,
      ])
    : unavailable;
  const verifiedOnLossDate =
    comparable.evidenceBasis === "LOSS_DATE_HISTORICAL" &&
    comparable.lifecycleEvidence?.status === "RESOLVED";

  return (
    <li className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold tracking-[0.13em] text-muted-foreground uppercase">
            Comparable {comparable.rank}
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">
            {vehicleName(comparable)}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-evidence/10 px-2.5 py-1 text-xs font-semibold text-evidence">
              {comparable.tierLabel}
            </span>
            {verifiedOnLossDate ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-evidence/25 px-2.5 py-1 text-xs font-medium text-evidence">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Verified active on loss date
              </span>
            ) : null}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Advertised price
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {displayMoney(comparable.advertisedPrice)}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid gap-4 border-t pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Gauge className="size-4" aria-hidden="true" /> Mileage
          </dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatMileage(comparable.mileage)}
          </dd>
          {comparable.mileageDifferenceFromLossVehicle !== null ? (
            <dd className="mt-1 text-xs text-muted-foreground">
              {formatMileageDifference(
                comparable.mileageDifferenceFromLossVehicle,
              )}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4" aria-hidden="true" /> Dealer
          </dt>
          <dd className="mt-1 font-medium">
            {comparable.dealer?.name ?? unavailable}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {dealerLocation}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Distance</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatDistance(comparable.distanceMiles)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" /> Evidence date
          </dt>
          <dd className="mt-1 font-medium">
            {formatDate(comparable.evidenceDate)}
          </dd>
        </div>
      </dl>

      <details className="group mt-5 border-t pt-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground transition-colors hover:text-foreground">
          Technical evidence details
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl className="mt-4 grid gap-3 rounded-lg bg-muted/55 p-4">
          <DetailRow label="VIN" value={comparable.vin ?? unavailable} />
          <DetailRow
            label="Listing ID"
            value={comparable.sourceListingId ?? unavailable}
          />
          <DetailRow label="Evidence source" value={comparable.source} />
          {comparable.lifecycleEvidence ? (
            <>
              <DetailRow
                label="Listing record first seen"
                value={formatDateTime(
                  comparable.lifecycleEvidence.recordFirstSeenAt,
                )}
              />
              <DetailRow
                label="Listing record last seen"
                value={formatDateTime(
                  comparable.lifecycleEvidence.recordLastSeenAt,
                )}
              />
              <DetailRow
                label="Source history begins"
                value={formatDateTime(
                  comparable.lifecycleEvidence.sourceFirstSeenAt,
                )}
              />
              <DetailRow
                label="Source history ends"
                value={formatDateTime(
                  comparable.lifecycleEvidence.sourceLastSeenAt,
                )}
              />
            </>
          ) : null}
        </dl>
      </details>
    </li>
  );
}

function PrimaryComparables({ analysis }: AnalysisResultsProps) {
  const comparables = analysis.comparablesUsed.primary;
  const historical =
    analysis.assessment.evidenceBasis === "LOSS_DATE_HISTORICAL";
  if (comparables.length === 0) {
    return null;
  }

  return (
    <section className="mt-20" aria-labelledby="comparables-heading">
      <SectionHeading
        id="comparables-heading"
        eyebrow="Primary evidence"
        title={
          historical
            ? "Loss-date comparable vehicles"
            : "Primary comparable vehicles"
        }
        description={
          historical
            ? "These are the selected vehicles verified as active on the loss date. Their advertised prices form the primary historical evidence set."
            : "These selected vehicles form the primary current-market evidence set because sufficient loss-date evidence was unavailable."
        }
      />
      <ol className="mt-9 grid gap-4">
        {comparables.map((comparable) => (
          <ComparableCard
            key={`${comparable.source}-${comparable.sourceListingId ?? comparable.rank}`}
            comparable={comparable}
          />
        ))}
      </ol>
    </section>
  );
}

function EvidenceContextCard({
  evidence,
  primary,
}: {
  evidence: EvidenceSection;
  primary: boolean;
}) {
  const historical = evidence.evidenceBasis === "LOSS_DATE_HISTORICAL";

  return (
    <article
      className={cn(
        "rounded-xl border p-5 sm:p-6",
        primary ? "border-evidence/30 bg-evidence/[0.035]" : "bg-muted/35",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            primary
              ? "bg-evidence/10 text-evidence"
              : "bg-background text-muted-foreground ring-1 ring-border",
          )}
        >
          {primary ? "Primary evidence" : "Secondary context"}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDate(evidence.evidenceDate)}
        </span>
      </div>
      <h3 className="mt-5 text-lg font-semibold">
        {historical ? "Loss-date market" : "Current market"}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {historical
          ? "Listings verified for the date of loss."
          : primary
            ? "Current listings used as primary evidence because sufficient loss-date evidence was unavailable."
            : "Current listings shown only as a separate point of reference."}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-5 border-t pt-5">
        <div>
          <dt className="text-xs text-muted-foreground">Median advertised price</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
            {displayMoney(evidence.prices.medianPrice)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Selected listings</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
            {formatWholeNumber(evidence.selectedCount)}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Observed range</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {displayMoney(evidence.prices.minimumPrice)}–
            {displayMoney(evidence.prices.maximumPrice)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function MarketContext({ analysis }: AnalysisResultsProps) {
  const primary = analysis.primaryExternalEvidence;
  if (!primary) {
    return null;
  }
  const secondary = analysis.secondaryExternalEvidence;
  const historicalPrimary =
    primary.evidenceBasis === "LOSS_DATE_HISTORICAL";

  return (
    <section className="mt-20" aria-labelledby="market-context-heading">
      <SectionHeading
        id="market-context-heading"
        eyebrow="Market timing"
        title={
          historicalPrimary
            ? "Loss-date and current-market evidence are kept separate"
            : "Current-market evidence is the primary available context"
        }
        description={
          historicalPrimary
            ? "Vehicle markets can change. Venfour preserves when each listing was observed so evidence from different dates is not blended into one price set."
            : "Sufficient verified loss-date evidence was unavailable for this analysis, so the selected current listings provide the primary market context."
        }
      />
      <div className="mt-9 grid gap-4 md:grid-cols-2">
        <EvidenceContextCard evidence={primary} primary />
        {secondary ? (
          <EvidenceContextCard evidence={secondary} primary={false} />
        ) : (
          <article className="rounded-xl border border-dashed bg-muted/20 p-5 sm:p-6">
            <p className="text-sm font-semibold">
              {historicalPrimary
                ? "No separate current-market set"
                : "Loss-date evidence unavailable"}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {historicalPrimary
                ? "This analysis does not include a secondary current-market price set."
                : "A sufficient set of listings verified for the loss date was not available, so current-market evidence remains primary."}
            </p>
          </article>
        )}
      </div>
      {secondary ? (
        <div className="mt-4 flex gap-3 rounded-xl border bg-background p-4 text-sm leading-6 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            The current-market median of{" "}
            <strong className="font-semibold text-foreground tabular-nums">
              {displayMoney(secondary.prices.medianPrice)}
            </strong>{" "}
            is context only. It is not combined with the loss-date median of{" "}
            <strong className="font-semibold text-foreground tabular-nums">
              {displayMoney(primary.prices.medianPrice)}
            </strong>
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CccComparableCard({ row }: { row: CccComparableRow }) {
  const adjustments = [
    ["Package", row.adjustments.package],
    ["Options", row.adjustments.options],
    ["Mileage", row.adjustments.mileage],
    ["Condition", row.adjustments.condition],
  ] as const;

  return (
    <li className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold tracking-[0.13em] text-muted-foreground uppercase">
            CCC comparable {row.comparableNumber ?? row.index + 1}
          </p>
          <h3 className="mt-2 font-semibold">{cccVehicleName(row)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.dealer ?? unavailable}
            {row.location ? ` · ${row.location}` : ""}
          </p>
        </div>
        <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {row.adjustmentDisclosureLabel}
        </span>
      </div>

      <div className="mt-6 grid items-center gap-3 rounded-lg bg-muted/45 p-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div>
          <p className="text-xs text-muted-foreground">Advertised price</p>
          <p className="mt-1 font-semibold tabular-nums">
            {displayMoney(row.advertisedPrice)}
          </p>
        </div>
        <ArrowRight
          className="hidden size-4 text-muted-foreground sm:block"
          aria-hidden="true"
        />
        <div>
          <p className="text-xs text-muted-foreground">Net adjustment</p>
          <p className="mt-1 font-semibold tabular-nums">
            {displayMoney(row.netAdjustment)}
          </p>
        </div>
        <ArrowRight
          className="hidden size-4 text-muted-foreground sm:block"
          aria-hidden="true"
        />
        <div>
          <p className="text-xs text-muted-foreground">CCC-adjusted value</p>
          <p className="mt-1 font-semibold tabular-nums">
            {displayMoney(row.cccAdjustedComparableValue)}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Mileage</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatMileage(row.mileage)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Distance</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatDistance(row.distanceMiles)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Adjustment disclosure</dt>
          <dd className="mt-1 font-medium">{row.adjustmentDisclosureLabel}</dd>
        </div>
      </dl>

      <details className="group mt-5 border-t pt-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground transition-colors hover:text-foreground">
          Adjustment breakdown
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl className="mt-4 grid gap-3 rounded-lg bg-muted/55 p-4 sm:grid-cols-2">
          {adjustments.map(([label, adjustment]) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">
                {displayMoney(adjustment)}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 sm:col-span-2 sm:border-t sm:pt-3">
            <dt className="text-muted-foreground">VIN</dt>
            <dd className="font-medium break-all">{row.vin ?? unavailable}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

function CccComparables({ analysis }: AnalysisResultsProps) {
  const { summary, rows } = analysis.cccComparables;
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="mt-20" aria-labelledby="ccc-heading">
      <SectionHeading
        id="ccc-heading"
        eyebrow="CCC report context"
        title="What CCC used in its valuation"
        description={`The CCC report includes ${formatWholeNumber(
          summary.totalCount,
        )} comparable vehicles. The values below show the report’s advertised prices and disclosed adjustments without judging whether any individual adjustment was appropriate.`}
      />

      <dl className="mt-9 grid gap-x-10 gap-y-5 rounded-xl border bg-muted/25 p-5 sm:grid-cols-3 sm:p-6">
        <Metric
          label="CCC advertised comparable median"
          value={displayMoney(summary.advertisedPrices.medianPrice)}
        />
        <Metric
          label="CCC adjusted comparable median"
          value={displayMoney(summary.adjustedValues.medianPrice)}
        />
        <Metric
          label="Median net adjustment"
          value={displayMoney(summary.netAdjustments.median)}
          detail={summary.adjustmentDirection?.label}
        />
      </dl>

      <ol className="mt-4 grid gap-4">
        {rows.map((row) => (
          <CccComparableCard key={row.index} row={row} />
        ))}
      </ol>
    </section>
  );
}

function ImportantLimitations({ analysis }: AnalysisResultsProps) {
  const diagnostics = [
    ...analysis.evidenceDiagnostics.exclusions.map((item, index) => ({
      key: `exclusion-${item.code}-${item.evidenceBasis}-${index}`,
      description: item.description,
    })),
    ...analysis.evidenceDiagnostics.historicalIssues.map(
      (item, index) => ({
        key: `historical-${item.status}-${item.reason}-${item.vin ?? "no-vin"}-${
          item.sourceListingId ?? "no-listing"
        }-${index}`,
        description: item.description,
      }),
    ),
  ];

  return (
    <section
      className="mt-20 border-t pt-8"
      aria-labelledby="limitations-heading"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Read before relying on this analysis
      </p>
      <h2
        id="limitations-heading"
        className="mt-2 text-xl font-semibold tracking-tight"
      >
        Important limitations
      </h2>
      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-lg py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <span className="font-medium">
            Review the limits and coverage notes for this analysis
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-6 rounded-xl border bg-muted/25 p-5 sm:p-7">
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            These limitations still apply when the evidence points to a
            meaningful gap. They define what this review does—and does
            not—establish.
          </p>
          <ul className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
            {analysis.limitations.map((limitation, index) => (
              <li key={`${limitation.code}-${index}`} className="flex gap-3">
                <CircleDot
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-semibold">{limitation.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {limitation.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {diagnostics.length > 0 ? (
            <div className="mt-7 border-t pt-6">
              <h3 className="text-sm font-semibold">Evidence coverage notes</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {diagnostics.map((diagnostic) => (
                  <li key={diagnostic.key} className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    <span>{diagnostic.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}

export function AnalysisResults({ analysis }: AnalysisResultsProps) {
  const vehicle = [
    analysis.vehicle.year,
    analysis.vehicle.make,
    analysis.vehicle.model,
    analysis.vehicle.trim,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className="w-full bg-report-canvas">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:py-16">
        <header>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            <Check className="size-4 text-evidence" aria-hidden="true" />
            Valuation evidence review
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl lg:text-5xl">
            {vehicle}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Gauge className="size-4" aria-hidden="true" />
              {formatMileage(analysis.vehicle.mileage)}
            </span>
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4" aria-hidden="true" />
              Loss date {formatDate(analysis.vehicle.lossDate)}
            </span>
            {analysis.vehicle.postalCode ? (
              <span className="inline-flex items-center gap-2">
                <MapPin className="size-4" aria-hidden="true" />
                {analysis.vehicle.postalCode}
              </span>
            ) : null}
          </div>
        </header>

        <PrimaryAssessment analysis={analysis} />
        <WhyFlagged analysis={analysis} />
        <PrimaryComparables analysis={analysis} />
        <MarketContext analysis={analysis} />
        <CccComparables analysis={analysis} />
        <ImportantLimitations analysis={analysis} />

        <div className="mt-14 flex items-start gap-3 border-t pt-6 text-sm leading-6 text-muted-foreground">
          <CheckCircle2
            className="mt-0.5 size-4 shrink-0 text-evidence"
            aria-hidden="true"
          />
          <p>
            This report keeps market evidence, CCC report data, and important
            limitations together so you can review the valuation with clearer
            context.
          </p>
        </div>
      </div>
    </article>
  );
}
