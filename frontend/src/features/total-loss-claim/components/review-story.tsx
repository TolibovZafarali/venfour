import { ArrowUpRight } from "lucide-react";

import { ValueRangeComparison } from "@/features/total-loss-claim/components/case-evidence";
import type {
  TotalLossMoney,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";

export type ReviewStoryStage =
  "result" | "insurer" | "market" | "meaning" | "next";

interface ReviewStoryProps {
  readonly report: TotalLossPublishedReport;
  readonly stage: ReviewStoryStage;
  readonly onEvidence: (view: "market" | "insurer") => void;
  readonly onReport: () => void;
}

type ConclusionKind =
  "undervalue" | "supported" | "insufficient" | "conflicting" | "other";

function conclusionKind(report: TotalLossPublishedReport): ConclusionKind {
  const label = report.conclusion.classificationLabel
    .toLowerCase()
    .replace(/_/gu, " ");
  if (label.includes("insufficient")) return "insufficient";
  if (label.includes("conflicting")) return "conflicting";
  if (label.includes("undervalue") || label.includes("undervaluation"))
    return "undervalue";
  if (
    label.includes("no material discrepancy") ||
    label.includes("reasonably supported")
  )
    return "supported";
  return "other";
}

function money(value: TotalLossMoney | null | undefined) {
  return value?.amountMinorUnits === null ||
    !value?.formatted ||
    /^(unavailable|not available)$/iu.test(value.formatted)
    ? null
    : value.formatted;
}

function selectedCount(report: TotalLossPublishedReport) {
  return (
    (report.marketEvidence.primary?.selectedCount ?? 0) +
    (report.marketEvidence.secondary?.selectedCount ?? 0)
  );
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function evidenceTiming(report: TotalLossPublishedReport) {
  const basis =
    report.conclusion.supportedRange?.evidenceBasis ??
    report.marketEvidence.primary?.label ??
    "";
  if (/historical|loss.date/iu.test(basis)) return "historical";
  if (/current/iu.test(basis)) return "current";
  return "unspecified";
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function belowSelectedRange(report: TotalLossPublishedReport) {
  const insurer = report.conclusion.insurerValuation.amountMinorUnits;
  const low = report.conclusion.supportedRange?.low.amountMinorUnits;
  return insurer !== null && low !== null && low !== undefined && insurer < low;
}

function DetailButton({
  children,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button className="review-detail-button" onClick={onClick} type="button">
      {children}
      <ArrowUpRight aria-hidden="true" />
    </button>
  );
}

function ResultStory({ report }: Pick<ReviewStoryProps, "report">) {
  const kind = conclusionKind(report);
  const insurerValue = money(report.conclusion.insurerValuation);
  const title =
    kind === "insufficient"
      ? "There isn’t enough evidence for a clear comparison."
      : kind === "conflicting"
        ? "The evidence gives mixed signals."
        : kind === "supported"
          ? "The review found no meaningful valuation gap."
          : kind === "undervalue"
            ? belowSelectedRange(report)
              ? "The insurer’s value is below the selected range."
              : "The valuation deserves a closer look."
            : "Your valuation review is ready.";
  const explanation =
    kind === "insufficient"
      ? "There isn’t enough evidence to reliably tell whether the insurer’s valuation is low."
      : kind === "conflicting"
        ? "The selected evidence gives mixed signals. It does not support one clear valuation conclusion."
        : kind === "supported"
          ? "The completed review did not find a meaningful gap in the insurer’s valuation."
          : kind === "undervalue"
            ? `${/material/iu.test(report.conclusion.classificationLabel) ? "The review found a meaningful gap" : "The review found a possible gap"} between the insurer’s valuation and the selected advertised prices.`
            : "Your completed report brings together the insurer’s valuation and the available market evidence.";

  return (
    <section
      className="review-stage review-result-stage"
      aria-labelledby="review-story-title"
    >
      <div className="review-editorial">
        <h1 className="review-title" id="review-story-title">
          {title}
        </h1>
        <p className="review-lead">{explanation}</p>
      </div>
      <div className="review-result-reference">
        <span className="review-summary-label">Insurer valuation reviewed</span>
        <strong className="review-reference-value">
          {insurerValue ?? "Not stated in the review"}
        </strong>
      </div>
    </section>
  );
}

function InsurerStory({
  report,
  onEvidence,
}: Pick<ReviewStoryProps, "report" | "onEvidence">) {
  const insurer = report.insurerEvidence;
  const valuation = money(report.conclusion.insurerValuation);
  const hasComparables = insurer.comparableCount > 0;

  return (
    <section
      className="review-stage review-insurer-stage"
      aria-labelledby="review-story-title"
    >
      <div className="review-editorial">
        <h1 className="review-title" id="review-story-title">
          The insurer’s valuation
        </h1>
        <p className="review-lead">
          {hasComparables
            ? "The insurer used comparable vehicles as reference points, with adjustments for differences between vehicles."
            : "The available review does not include a breakdown of the insurer’s comparable vehicles."}
        </p>
      </div>
      <div className="review-number-block">
        <p className="review-summary-label">Your insurer’s valuation</p>
        <p className="review-number">{valuation ?? "Not stated"}</p>
        {hasComparables ? (
          <p className="review-metric-caption">
            {countLabel(
              insurer.comparableCount,
              "comparable vehicle",
              "comparable vehicles",
            )}{" "}
            reviewed; full adjustment details disclosed for{" "}
            {insurer.summary.fullyDisclosedAdjustmentCount.toLocaleString(
              "en-US",
            )}{" "}
            of {insurer.comparableCount.toLocaleString("en-US")}.
          </p>
        ) : null}
      </div>
      <p className="review-note">
        {hasComparables
          ? "A listed price can differ from the adjusted value. The evidence view shows only the adjustments the insurer disclosed."
          : "Missing comparable details limit this explanation. They do not, by themselves, prove the valuation is wrong."}
      </p>
      {hasComparables ? (
        <div className="review-secondary-actions">
          <DetailButton onClick={() => onEvidence("insurer")}>
            See the insurer’s comparables
          </DetailButton>
        </div>
      ) : null}
    </section>
  );
}

function MarketStory({
  report,
  onEvidence,
}: Pick<ReviewStoryProps, "report" | "onEvidence">) {
  const range = report.conclusion.supportedRange;
  const median = money(range?.median);
  const count =
    report.marketEvidence.primary?.selectedCount ?? selectedCount(report);
  const timing = evidenceTiming(report);
  const collectionDate =
    timing === "historical"
      ? report.marketEvidence.evidenceDateContext.historicalEvidenceDate
      : timing === "current"
        ? report.marketEvidence.evidenceDateContext.currentObservedDate
        : (report.marketEvidence.primary?.evidenceDate ?? null);
  const date = dateLabel(collectionDate);
  const listingDescription =
    timing === "historical"
      ? "historical advertised listings"
      : timing === "current"
        ? "current advertised listings"
        : "advertised listings";

  return (
    <section
      className="review-stage review-market-stage"
      aria-labelledby="review-story-title"
    >
      <div className="review-editorial">
        <h1 className="review-title" id="review-story-title">
          {median
            ? `The selected listing median is ${median}.`
            : "The available listings do not establish a reliable range."}
        </h1>
        <p className="review-lead">
          {median
            ? `${countLabel(count, "selected listing has", "selected listings have")} a median advertised price of ${median}. The median describes the center of the selected prices.`
            : "The available listings do not establish a reliable range. The report explains the evidence and its limits."}
        </p>
      </div>
      {range && median ? (
        <div className="review-visual review-market-visual">
          <ValueRangeComparison report={report} showDifference={false} />
          <p className="review-visual-caption">
            {countLabel(count, "selected listing", "selected listings")} ·{" "}
            {listingDescription}
            {date ? ` · ${date}` : ""}
          </p>
        </div>
      ) : null}
      <p className="review-note">
        {timing === "current"
          ? "These are current asking prices, not completed-sale prices or observations from the date of your loss."
          : timing === "historical"
            ? "These are historical asking prices, not completed-sale prices. The report explains their connection to the date of loss."
            : "Advertised prices show what sellers asked, not what buyers paid. Evidence dates are available in the report."}
      </p>
      {selectedCount(report) > 0 ? (
        <div className="review-secondary-actions">
          <DetailButton onClick={() => onEvidence("market")}>
            Explore the selected listings
          </DetailButton>
        </div>
      ) : null}
    </section>
  );
}

function MeaningStory({
  report,
  onReport,
}: Pick<ReviewStoryProps, "report" | "onReport">) {
  const kind = conclusionKind(report);
  const continuing = report.conclusion.continuingSupported;
  const difference = money(report.conclusion.indicatedDifference);
  const insurer = report.conclusion.insurerValuation.amountMinorUnits;
  const median = report.conclusion.supportedRange?.median.amountMinorUnits;
  const canCompare =
    insurer !== null && median !== null && median !== undefined;
  const showDifference = Boolean(
    difference &&
    canCompare &&
    kind !== "insufficient" &&
    kind !== "conflicting",
  );
  const magnitude = difference
    ?.replace(/[−-]/gu, "")
    .replace(/^\((.*)\)$/u, "$1");
  const comparison =
    canCompare && insurer! < median!
      ? "below"
      : canCompare && insurer! > median!
        ? "above"
        : "at";
  const explanation =
    kind === "insufficient"
      ? "More evidence is needed for a reliable conclusion. A price difference alone does not fill those gaps."
      : kind === "conflicting"
        ? "The evidence contains mixed signals. Higher listings alone do not support a clear conclusion."
        : kind === "supported"
          ? "The review did not find a meaningful difference that supports asking for a higher valuation."
          : continuing && belowSelectedRange(report)
            ? "The insurer’s value is below the selected range. The completed review supports asking the insurer to reconsider its valuation."
            : continuing
              ? "The completed review supports asking the insurer to reconsider the valuation and explain its reasoning in writing."
              : "The completed review does not support a higher valuation request. The report explains its limits.";

  return (
    <section
      className="review-stage review-meaning-stage"
      aria-labelledby="review-story-title"
    >
      <div className="review-editorial">
        <h1 className="review-title" id="review-story-title">
          What the difference means
        </h1>
        <p className="review-lead">{explanation}</p>
      </div>
      {showDifference ? (
        <div className="review-meaning-comparison">
          {comparison === "at" ? (
            <p className="review-meaning-statement">
              The insurer’s value matches the selected median.
            </p>
          ) : (
            <>
              <p className="review-number">{magnitude}</p>
              <p className="review-metric-caption">
                {comparison} the selected listing median
              </p>
            </>
          )}
        </div>
      ) : null}
      <p className="review-note">
        {continuing
          ? "This difference is not a guaranteed settlement or an amount the insurer legally owes. Your request asks for a review of the evidence."
          : "This conclusion reflects the available evidence. It is not a legal determination or a guaranteed settlement value."}
      </p>
      <div className="review-secondary-actions">
        <DetailButton onClick={onReport}>
          Read the supporting report
        </DetailButton>
      </div>
    </section>
  );
}

function NextStory({
  report,
  onReport,
}: Pick<ReviewStoryProps, "report" | "onReport">) {
  const continuing = report.conclusion.continuingSupported;
  const date = dateLabel(report.issueDate);
  return (
    <section
      className="review-stage review-next-stage"
      aria-labelledby="review-story-title"
    >
      <div className="review-editorial">
        <h1 className="review-title" id="review-story-title">
          {continuing ? "Requesting reconsideration" : "Your completed review"}
        </h1>
        <p className="review-lead">
          {continuing
            ? "Ask your insurer to reconsider the valuation in writing. You’ll send the request from your own email account."
            : "The review does not support asking for a higher valuation. Keep the report with your claim records."}
        </p>
      </div>
      {continuing ? (
        <ol
          className="review-request-sequence"
          aria-label="How the reconsideration request works"
        >
          <li>
            <p>
              <strong>Review the draft.</strong> Check the recipient, subject,
              and message.
            </p>
          </li>
          <li>
            <p>
              <strong>Attach the report.</strong> Download the PDF and attach it
              to the email before sending.
            </p>
          </li>
          <li>
            <p>
              <strong>Keep the written reply.</strong> The insurer may explain
              its value, ask for information, or revise its offer.
            </p>
          </li>
        </ol>
      ) : null}
      <p className="review-note">
        Valuation evidence package · PDF · {report.versionLabel}
        {date ? ` · ${date}` : ""}
      </p>
      <div className="review-secondary-actions">
        <DetailButton onClick={onReport}>View your report</DetailButton>
      </div>
    </section>
  );
}

export function ReviewStory({
  report,
  stage,
  onEvidence,
  onReport,
}: ReviewStoryProps) {
  if (stage === "result") return <ResultStory report={report} />;
  if (stage === "insurer")
    return <InsurerStory report={report} onEvidence={onEvidence} />;
  if (stage === "market")
    return <MarketStory report={report} onEvidence={onEvidence} />;
  if (stage === "meaning")
    return <MeaningStory report={report} onReport={onReport} />;
  return <NextStory report={report} onReport={onReport} />;
}
