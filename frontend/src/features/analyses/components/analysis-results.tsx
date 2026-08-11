import {
  ChevronDown,
  CircleDot,
  Info,
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

function assessmentHeading(analysis: AnalysisPresentation) {
  if (analysis.assessment.classification !== "INSUFFICIENT_EVIDENCE") {
    return assessmentHeadings[analysis.assessment.classification];
  }

  const findingCodes = new Set(analysis.findings.map((finding) => finding.code));
  if (findingCodes.has("MISSING_CCC_VEHICLE_VALUATION")) {
    return "A CCC vehicle value is needed before this valuation can be assessed";
  }
  if (findingCodes.has("NONPOSITIVE_CCC_VEHICLE_VALUATION")) {
    return "The CCC vehicle value cannot support a market comparison";
  }
  if (findingCodes.has("EXTERNAL_MEDIAN_ZERO")) {
    return "The selected market median cannot support a comparison";
  }

  return assessmentHeadings.INSUFFICIENT_EVIDENCE;
}

function displayMoney(value: Money | NonnegativeMoney) {
  return value.display?.replace(/\.00$/, "") ?? unavailable;
}

function displayMoneyMagnitude(value: Money | NonnegativeMoney) {
  const display = displayMoney(value);
  return display.startsWith("-$") ? `$${display.slice(2)}` : display;
}

function displayPercentage(value: string | null) {
  if (!value) {
    return unavailable;
  }

  return value
    .replace(/(\.\d*?[1-9])0+%$/, "$1%")
    .replace(/\.0+%$/, "%");
}

function displayPercentageMagnitude(value: string | null) {
  return displayPercentage(value).replace(/^-/, "");
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
    <div className="max-w-2xl">
      {eyebrow ? (
        <p className="text-[0.7rem] font-semibold tracking-[0.16em] text-neutral-500 uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2
        id={id}
        className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-balance sm:text-3xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-xl text-[0.95rem] leading-7 text-neutral-600">
          {description}
        </p>
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
    <div className="border-t border-neutral-200 pt-4">
      <dt className="text-xs leading-5 font-medium text-neutral-500">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 font-semibold tracking-[-0.025em] text-neutral-950 tabular-nums",
          emphasis ? "text-[2rem]" : "text-2xl",
        )}
      >
        {value}
      </dd>
      {detail ? (
        <dd className="mt-1 text-sm font-medium text-neutral-600">{detail}</dd>
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
  const evidenceTimingLabel =
    primary.evidenceBasis === "LOSS_DATE_HISTORICAL"
      ? "Loss-date"
      : "Current-market";
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
      className="mt-8 overflow-hidden rounded-2xl bg-neutral-950 px-5 py-6 text-white sm:px-7 sm:py-7 lg:px-9 lg:py-8"
      aria-label={`CCC adjusted value ${displayMoney(
        analysis.cccValuation.adjustedVehicleValue,
      )}; ${evidenceLabel} ${displayMoney(
        primary.prices.minimumPrice,
      )} to ${displayMoney(
        primary.prices.maximumPrice,
      )}; median ${displayMoney(primary.prices.medianPrice)}.`}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="max-w-2xl">
          <p className="text-[0.7rem] font-semibold tracking-[0.16em] text-neutral-400 uppercase">
            {evidenceTimingLabel} price position
          </p>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-balance sm:text-2xl">
            {relationshipCopy}
          </h3>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            CCC’s value, the selected external range, and its median share one
            consistent dollar scale.
          </p>
        </div>
        <p className="text-xs text-neutral-400 tabular-nums">
          Scale: {formatMoneyCents(scaleMinimum)} –{" "}
          {formatMoneyCents(scaleMaximum)}
        </p>
      </div>

      <div className="relative mt-12 h-16 sm:mt-14" aria-hidden="true">
        <div className="absolute inset-x-0 top-7 h-px bg-white/20" />
        <div
          className="absolute top-[1.2rem] h-4 rounded-full bg-white/25 ring-1 ring-white/45"
          style={{
            left: `${rangeStart}%`,
            width: `${Math.max(rangeEnd - rangeStart, 1.2)}%`,
          }}
        />
        <div
          className="absolute top-0 h-14 w-0.5 bg-white"
          style={{ left: `${cccPosition}%` }}
        >
          <span
            className={cn(
              "absolute -top-6 whitespace-nowrap text-xs font-semibold text-white",
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
          className="absolute top-[1rem] size-4 rotate-45 border-2 border-neutral-950 bg-white"
          style={{
            left: `${medianPosition}%`,
            transform: "translateX(-50%) rotate(45deg)",
          }}
        />
        <span
          className={cn(
            "absolute top-[-0.5rem] whitespace-nowrap text-xs font-semibold text-white",
            medianPosition > 70
              ? "-translate-x-full"
              : medianPosition < 30
                ? "translate-x-2"
                : "-translate-x-1/2",
          )}
          style={{ left: `${medianPosition}%` }}
        >
          Median
        </span>
      </div>

      <div className="grid border-t border-white/10 text-sm sm:grid-cols-3 sm:divide-x sm:divide-white/10">
        <div className="py-4 sm:pr-5">
          <p className="text-xs text-neutral-400">CCC valuation</p>
          <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">
            {displayMoney(analysis.cccValuation.adjustedVehicleValue)}
          </p>
        </div>
        <div className="border-t border-white/10 py-4 sm:border-t-0 sm:px-5">
          <p className="text-xs text-neutral-400">
            Selected {evidenceTimingLabel.toLowerCase()} range
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">
            {displayMoney(primary.prices.minimumPrice)}–
            {displayMoney(primary.prices.maximumPrice)}
          </p>
        </div>
        <div className="border-t border-white/10 py-4 sm:border-t-0 sm:pl-5">
          <p className="text-xs text-neutral-400">
            {evidenceTimingLabel} median
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">
            {displayMoney(primary.prices.medianPrice)}
          </p>
        </div>
      </div>
    </figure>
  );
}

function PrimaryAssessment({ analysis }: AnalysisResultsProps) {
  const primary = analysis.primaryExternalEvidence;
  const comparison = analysis.cccValuation.comparisonToPrimaryEvidence;
  const undervalueAssessment =
    analysis.assessment.classification === "MATERIAL_UNDERVALUE_SIGNAL" ||
    analysis.assessment.classification === "POTENTIAL_UNDERVALUE";
  const gapLabel =
    undervalueAssessment
      ? "Evidence gap"
      : "Difference from primary median";
  const gapValue = comparison
    ? displayMoneyMagnitude(comparison.difference)
    : unavailable;
  const gapPercent = comparison?.differencePercent.display
    ? displayPercentageMagnitude(comparison.differencePercent.display)
    : null;
  const differenceCents = comparison?.difference.cents;
  const gapRelationship =
    typeof differenceCents === "number" && differenceCents > 0
      ? "above CCC"
      : typeof differenceCents === "number" && differenceCents < 0
        ? "below CCC"
        : typeof differenceCents === "number"
          ? "matches CCC"
          : "comparison unavailable";

  return (
    <section
      className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white"
      aria-labelledby="primary-assessment-heading"
    >
      <div className="p-6 sm:p-8 lg:p-10 xl:p-12">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.55fr)] xl:gap-14">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-2 font-semibold text-neutral-950">
                <span className="size-2 rounded-full bg-neutral-950" />
                {analysis.assessment.evidenceStrengthLabel} evidence
              </span>
              <span className="text-neutral-500" aria-hidden="true">
                /
              </span>
              <span className="text-neutral-600">
                {analysis.assessment.evidenceBasis === "LOSS_DATE_HISTORICAL"
                  ? "Verified loss-date listings are primary"
                  : analysis.assessment.evidenceBasis === "CURRENT_MARKET"
                    ? "Current-market listings are primary"
                    : "No primary market evidence available"}
              </span>
            </div>
            <h2
              id="primary-assessment-heading"
              className="mt-6 text-[2.15rem] leading-[1.08] font-semibold tracking-[-0.045em] text-balance sm:text-[2.8rem] xl:text-[3.4rem]"
            >
              {assessmentHeading(analysis)}
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-600 sm:text-[1.05rem] sm:leading-8">
              {assessmentSummary(analysis)}
            </p>
          </div>

          <div className="rounded-xl bg-neutral-100 p-5 sm:p-6 xl:p-7">
            <p className="text-xs font-semibold tracking-[0.13em] text-neutral-500 uppercase">
              {gapLabel}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-[2.6rem] leading-none font-semibold tracking-[-0.045em] text-neutral-950 tabular-nums sm:text-5xl">
                {gapValue}
              </p>
              {comparison ? (
                <p className="pb-1 text-base font-semibold text-neutral-700 tabular-nums">
                  {gapPercent ? `${gapPercent} ` : null}
                  {gapRelationship}
                </p>
              ) : null}
            </div>
            <p className="mt-4 text-sm leading-6 text-neutral-600">
              {undervalueAssessment
                ? "This is the difference between the selected market median and CCC’s adjusted value."
                : "This comparison describes the available evidence; it is not a settlement calculation."}
            </p>
            <div className="mt-5 flex gap-3 border-t border-neutral-300 pt-5 text-sm leading-6 text-neutral-600">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Evidence of a valuation gap is not money owed or a guaranteed
                settlement increase.
              </p>
            </div>
          </div>
        </div>

        <dl className="mt-9 grid grid-cols-2 gap-x-5 gap-y-5 [&>div:last-child]:col-span-2 sm:grid-cols-3 sm:gap-x-10 sm:[&>div:last-child]:col-span-1 xl:mt-11">
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
            label="Selected market range"
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
    case "MISSING_CCC_VEHICLE_VALUATION":
      return {
        title: "The CCC vehicle value is missing",
        body:
          "A market difference cannot be calculated until the CCC report provides a vehicle valuation to compare.",
      };
    case "NONPOSITIVE_CCC_VEHICLE_VALUATION":
      return {
        title: "The CCC vehicle value cannot be compared",
        body:
          "The CCC vehicle value is zero or below zero, so a meaningful percentage comparison cannot be calculated.",
      };
    case "EXTERNAL_MEDIAN_ZERO":
      return {
        title: "The selected market median cannot be compared",
        body:
          "The selected external median is zero, so it cannot support a meaningful comparison with the CCC vehicle value.",
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
    <section
      className="mt-14 border-t border-neutral-200 pt-12 sm:mt-16 sm:pt-14"
      aria-labelledby="why-heading"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(14rem,0.55fr)_minmax(0,1.45fr)] lg:gap-14">
        <SectionHeading
          id="why-heading"
          eyebrow="Assessment details"
          title={
            undervalueAssessment
              ? "Why Venfour flagged the valuation"
              : "How Venfour reached this assessment"
          }
          description="The supported findings, organized into the facts that matter most."
        />
        <ol className="grid sm:grid-cols-2 sm:gap-x-10">
          {explanations.map((explanation, index) => (
            <li
              key={`${explanation.title}-${index}`}
              className="border-t border-neutral-200 py-5 first:pt-0 sm:[&:nth-child(-n+2)]:pt-0"
            >
              <span className="text-[0.7rem] font-semibold tracking-[0.14em] text-neutral-400 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 font-semibold leading-6 text-neutral-950">
                {explanation.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {explanation.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
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
    <li className="bg-white px-5 py-4 sm:px-6 sm:py-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 xl:grid-cols-[minmax(17rem,1.45fr)_minmax(7rem,0.6fr)_minmax(8rem,0.72fr)_minmax(10rem,0.9fr)_minmax(9rem,0.75fr)] xl:items-center xl:gap-x-6 xl:gap-y-0">
        <div className="col-span-2 flex gap-3 xl:col-span-1">
          <p className="w-6 shrink-0 pt-0.5 text-[0.7rem] font-semibold tracking-[0.13em] text-neutral-400 uppercase xl:text-neutral-500">
            {String(comparable.rank).padStart(2, "0")}
          </p>
          <div>
            <h3 className="font-semibold tracking-[-0.015em] text-neutral-950">
              {vehicleName(comparable)}
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs leading-5 text-neutral-600">
              <span>{comparable.tierLabel}</span>
              {verifiedOnLossDate ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Verified active on loss date</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs text-neutral-500 xl:sr-only">Advertised price</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-neutral-950 tabular-nums xl:mt-0">
            {displayMoney(comparable.advertisedPrice)}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-500 xl:sr-only">Mileage</p>
          <p className="mt-1 text-sm font-medium text-neutral-950 tabular-nums xl:mt-0">
            {formatMileage(comparable.mileage)}
          </p>
          {comparable.mileageDifferenceFromLossVehicle !== null ? (
            <p className="mt-1 text-xs text-neutral-500">
              {formatMileageDifference(
                comparable.mileageDifferenceFromLossVehicle,
              )}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-neutral-500 xl:sr-only">Dealer</p>
          <p className="mt-1 text-sm font-medium text-neutral-950 xl:mt-0">
            {comparable.dealer?.name ?? unavailable}
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {dealerLocation} · {formatDistance(comparable.distanceMiles)}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-500 xl:sr-only">Evidence date</p>
          <p className="mt-1 text-sm font-medium text-neutral-950 xl:mt-0">
            {formatDate(comparable.evidenceDate)}
          </p>
        </div>
      </div>

      <details className="group mt-3 border-t border-neutral-200 text-sm xl:ml-[2.25rem]">
        <summary
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm font-medium text-neutral-500 transition-colors hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
          aria-label={`Technical evidence details for comparable ${comparable.rank}: ${vehicleName(comparable)}`}
        >
          Technical evidence details
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl className="grid gap-3 rounded-lg bg-neutral-100 p-4 sm:grid-cols-2 sm:gap-x-8">
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
    <section className="mt-14 sm:mt-16" aria-labelledby="comparables-heading">
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
      <div
        className="mt-7 hidden grid-cols-[minmax(17rem,1.45fr)_minmax(7rem,0.6fr)_minmax(8rem,0.72fr)_minmax(10rem,0.9fr)_minmax(9rem,0.75fr)] gap-x-6 px-6 text-[0.68rem] font-semibold tracking-[0.11em] text-neutral-500 uppercase xl:grid"
        aria-hidden="true"
      >
        <span>Comparable vehicle</span>
        <span>Price</span>
        <span>Mileage</span>
        <span>Dealer</span>
        <span>Evidence date</span>
      </div>
      <ol className="mt-4 divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 xl:mt-3">
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
        "rounded-xl border border-neutral-200 p-5 sm:p-6",
        primary ? "bg-white" : "bg-neutral-100",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-[0.13em] text-neutral-500 uppercase">
            {primary ? "Primary available market" : "Context only"}
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-neutral-950">
            {historical ? "Loss-date market" : "Current market"}
          </h3>
        </div>
        <span className="text-xs text-neutral-500">
          {formatDate(evidence.evidenceDate)}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
        {historical
          ? "Listings verified for the date of loss."
          : primary
            ? "Current listings used as primary evidence because sufficient loss-date evidence was unavailable."
            : "Current listings shown only as a separate point of reference."}
      </p>
      <dl className="mt-5 grid gap-5 border-t border-neutral-200 pt-5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-neutral-500">Median advertised price</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-neutral-950 tabular-nums">
            {displayMoney(evidence.prices.medianPrice)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Observed range</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-neutral-950 tabular-nums">
            {displayMoney(evidence.prices.minimumPrice)}–
            {displayMoney(evidence.prices.maximumPrice)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Selected listings</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-neutral-950 tabular-nums">
            {formatWholeNumber(evidence.selectedCount)}
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
    <section
      className="mt-14 border-t border-neutral-200 pt-12 sm:mt-16 sm:pt-14"
      aria-labelledby="market-context-heading"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(14rem,0.55fr)_minmax(0,1.45fr)] lg:gap-14">
        <SectionHeading
          id="market-context-heading"
          eyebrow="Market timing"
          title={
            historicalPrimary
              ? secondary
                ? "Current prices are context, not loss-date evidence"
                : "Only loss-date market evidence is available"
              : "Current-market evidence is the primary available context"
          }
          description={
            historicalPrimary
              ? secondary
                ? "Vehicle markets can change. Venfour keeps evidence from different dates in separate price sets."
                : "The verified loss-date set remains primary; this analysis has no separate current-market price set."
              : "Sufficient verified loss-date evidence was unavailable, so selected current listings provide the primary comparison."
          }
        />
        <div className="space-y-3">
          {historicalPrimary && secondary ? (
            <EvidenceContextCard evidence={secondary} primary={false} />
          ) : historicalPrimary ? (
            <article className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5 sm:p-6">
              <p className="text-sm font-semibold">
                No separate current-market set
              </p>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                This analysis does not include a secondary current-market price
                set.
              </p>
            </article>
          ) : (
            <>
              <EvidenceContextCard evidence={primary} primary />
              <article className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5 sm:p-6">
                <p className="text-sm font-semibold">
                  Loss-date evidence unavailable
                </p>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  A sufficient set of listings verified for the loss date was
                  not available, so current-market evidence remains primary.
                </p>
              </article>
            </>
          )}
          {historicalPrimary && secondary ? (
            <div className="flex gap-3 px-1 pt-2 text-sm leading-6 text-neutral-600">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                The current-market median of{" "}
                <strong className="font-semibold text-neutral-950 tabular-nums">
                  {displayMoney(secondary.prices.medianPrice)}
                </strong>{" "}
                is not combined with the loss-date median of{" "}
                <strong className="font-semibold text-neutral-950 tabular-nums">
                  {displayMoney(primary.prices.medianPrice)}
                </strong>
                .
              </p>
            </div>
          ) : null}
        </div>
      </div>
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
    <li className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-[0.13em] text-neutral-500 uppercase">
            CCC comparable {row.comparableNumber ?? row.index + 1}
          </p>
          <h3 className="mt-2 font-semibold tracking-tight text-neutral-950">
            {cccVehicleName(row)}
          </h3>
          <p className="mt-1 text-sm leading-5 text-neutral-500">
            {row.dealer ?? unavailable}
            {row.location ? ` · ${row.location}` : ""}
          </p>
        </div>
        <span className="text-xs font-medium text-neutral-500">
          {row.adjustmentDisclosureLabel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 divide-x divide-neutral-200 border-y border-neutral-200 py-4">
        <div className="pr-3">
          <p className="text-[0.68rem] leading-4 text-neutral-500">
            Advertised
          </p>
          <p className="mt-1 text-sm font-semibold text-neutral-950 tabular-nums sm:text-base">
            {displayMoney(row.advertisedPrice)}
          </p>
        </div>
        <div className="px-3">
          <p className="text-[0.68rem] leading-4 text-neutral-500">
            Net adjustment
          </p>
          <p className="mt-1 text-sm font-semibold text-neutral-950 tabular-nums sm:text-base">
            {displayMoney(row.netAdjustment)}
          </p>
        </div>
        <div className="pl-3">
          <p className="text-[0.68rem] leading-4 text-neutral-500">
            CCC adjusted
          </p>
          <p className="mt-1 text-sm font-semibold text-neutral-950 tabular-nums sm:text-base">
            {displayMoney(row.cccAdjustedComparableValue)}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Mileage</dt>
          <dd className="mt-1 font-medium text-neutral-950 tabular-nums">
            {formatMileage(row.mileage)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Distance</dt>
          <dd className="mt-1 font-medium text-neutral-950 tabular-nums">
            {formatDistance(row.distanceMiles)}
          </dd>
        </div>
      </dl>

      <details className="group mt-4 border-t border-neutral-200 text-sm">
        <summary
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm font-medium text-neutral-500 transition-colors hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
          aria-label={`Adjustment breakdown for CCC comparable ${row.comparableNumber ?? row.index + 1}: ${cccVehicleName(row)}`}
        >
          Adjustment breakdown
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl className="grid gap-3 rounded-lg bg-neutral-100 p-4 sm:grid-cols-2">
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
    <section
      className="mt-16 rounded-2xl border border-neutral-200 bg-neutral-100 p-5 sm:mt-20 sm:p-8 lg:p-10"
      aria-labelledby="ccc-heading"
    >
      <SectionHeading
        id="ccc-heading"
        eyebrow="CCC report context"
        title="What CCC used in its valuation"
        description={`The CCC report includes ${formatWholeNumber(
          summary.totalCount,
        )} comparable vehicles. The values below show the report’s advertised prices and disclosed adjustments without judging whether any individual adjustment was appropriate.`}
      />

      <dl className="mt-7 grid gap-x-10 gap-y-5 sm:grid-cols-3">
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

      <ol className="mt-6 grid gap-3 xl:grid-cols-3">
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
      className="mt-16 border-t border-neutral-200 pt-10 sm:mt-20"
      aria-labelledby="limitations-heading"
    >
      <p className="text-[0.7rem] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
        Read before relying on this analysis
      </p>
      <h2
        id="limitations-heading"
        className="mt-2 text-xl font-semibold tracking-tight text-neutral-950"
      >
        Important limitations
      </h2>
      <details className="group mt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-950">
          <span className="font-medium">
            Review the limits and coverage notes for this analysis
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-100 p-5 sm:p-7">
          <p className="max-w-3xl text-sm leading-6 text-neutral-600">
            These limitations still apply when the evidence points to a
            meaningful gap. They define what this review does—and does
            not—establish.
          </p>
          <ul className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
            {analysis.limitations.map((limitation, index) => (
              <li key={`${limitation.code}-${index}`} className="flex gap-3">
                <CircleDot
                  className="mt-1 size-4 shrink-0 text-neutral-400"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-semibold">{limitation.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">
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
      <div className="mx-auto w-full max-w-[90rem] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
        <header className="grid gap-6 border-b border-neutral-200 pb-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-[0.7rem] font-semibold tracking-[0.15em] text-neutral-500 uppercase">
              Valuation evidence review
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-balance sm:text-3xl">
              {vehicle}
            </h1>
          </div>
          <dl className="flex flex-wrap gap-x-7 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-500">Mileage</dt>
              <dd className="mt-1 font-medium text-neutral-950 tabular-nums">
                {formatMileage(analysis.vehicle.mileage)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Loss date</dt>
              <dd className="mt-1 font-medium text-neutral-950">
                {formatDate(analysis.vehicle.lossDate)}
              </dd>
            </div>
            {analysis.vehicle.postalCode ? (
              <div>
                <dt className="text-xs text-neutral-500">Loss ZIP</dt>
                <dd className="mt-1 font-medium text-neutral-950 tabular-nums">
                  {analysis.vehicle.postalCode}
                </dd>
              </div>
            ) : null}
          </dl>
        </header>

        <PrimaryAssessment analysis={analysis} />
        <WhyFlagged analysis={analysis} />
        <PrimaryComparables analysis={analysis} />
        <MarketContext analysis={analysis} />
        <CccComparables analysis={analysis} />
        <ImportantLimitations analysis={analysis} />

        <div className="mt-12 border-t border-neutral-200 pt-6 text-sm leading-6 text-neutral-500">
          <p className="max-w-2xl">
            This report keeps market evidence, CCC report data, and important
            limitations together so you can review the valuation with clearer
            context.
          </p>
        </div>
      </div>
    </article>
  );
}
