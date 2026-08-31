import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import type { TotalLossClaimSecured, TotalLossMoney, TotalLossPublishedReport } from "../contracts";
import { dateLabel, displayed, moneyLabel, reportText } from "../report-format";
import { requestIsSent, requestReviewComplete } from "../request-state";
import { reviewPrerequisite, useReviewProgression } from "../use-review-progression";
import {
  authoritativeTotalLossClaimPath,
  completedAnalysisStage,
  totalLossClaimBasePath,
  type TotalLossClaimWorkflowView,
} from "../workflow-route";
import { InsurerEvidenceDetails, MarketEvidenceDetails, MethodologyDisclosure } from "./case-evidence";
import { MessagePreparation } from "./message-preparation";
import { ReportFileRow } from "./published-report-actions";
import { InsurerValueBridge, RecordedTime, RepresentativeListings, ReviewProgress, ValueRangeTrack } from "./completed-analysis-visuals";
import { supportsReviewTransition, useReviewStageMotion } from "./use-review-stage-motion";
import "./completed-analysis.css";

interface CompletedAnalysisProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly intakeMode: TotalLossIntakeMode;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly view: TotalLossClaimWorkflowView;
}

function hasMoney(value: TotalLossMoney | null | undefined): value is TotalLossMoney & { amountMinorUnits: number } {
  return value?.amountMinorUnits != null && Number.isSafeInteger(value.amountMinorUnits) && Boolean(displayed(value.formatted, ""));
}

function amountLabel(amountMinorUnits: number, currency: string) {
  if (!Number.isSafeInteger(amountMinorUnits)) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinorUnits / 100);
  } catch {
    return null;
  }
}

function medianComparison(report: TotalLossPublishedReport) {
  const difference = report.conclusion.indicatedDifference;
  const median = report.conclusion.supportedRange?.median;
  const value = report.conclusion.insurerValuation;
  if (!hasMoney(difference) || !hasMoney(median) || !hasMoney(value) || difference.currency !== median.currency || value.currency !== median.currency) return null;
  if (difference.amountMinorUnits === 0) return "Matches the selected median";
  const amount = difference.amountMinorUnits > 0 ? moneyLabel(difference) : amountLabel(-difference.amountMinorUnits, difference.currency);
  return amount ? `${amount} ${difference.amountMinorUnits > 0 ? "below" : "above"} the selected median` : null;
}

function ValueSummary({ report, intakeMode, marketOnly = false }: {
  readonly report: TotalLossPublishedReport;
  readonly intakeMode: TotalLossIntakeMode;
  readonly marketOnly?: boolean;
}) {
  const range = report.conclusion.supportedRange;
  const comparison = medianComparison(report);
  const showOffer = !marketOnly && hasMoney(report.conclusion.insurerValuation);
  const showRange = Boolean(range && hasMoney(range.low) && hasMoney(range.high));
  const showMedian = hasMoney(range?.median);
  if (!showOffer && !showRange && !showMedian) return null;
  return (
    <div className={`value-summary${marketOnly ? " value-summary-market" : ""}`} data-has-offer={showOffer} data-has-range={showRange} data-has-median={showMedian}>
      <dl className="value-summary-grid">
        {!marketOnly && hasMoney(report.conclusion.insurerValuation) ? <div className="value-summary-offer"><dt>{intakeMode === "manual" ? "Insurer offer you entered" : "Insurer valuation"}</dt><dd>{moneyLabel(report.conclusion.insurerValuation)}</dd></div> : null}
        {range && hasMoney(range.low) && hasMoney(range.high) ? <div className="value-summary-range">
          <dt>Selected advertised-price range</dt><dd>{range.low.currency === range.high.currency && range.low.amountMinorUnits === range.high.amountMinorUnits ? moneyLabel(range.low) : `${moneyLabel(range.low)} to ${moneyLabel(range.high)}`}</dd>
        </div> : null}
        {hasMoney(range?.median) ? <div className="value-summary-median"><dt>Selected median</dt><dd>{moneyLabel(range?.median)}</dd></div> : null}
        {!marketOnly && comparison ? <div className="value-summary-comparison">
          <dt>{intakeMode === "manual" ? "How your offer compares" : "How the insurer’s value compares"}</dt><dd>{comparison}</dd>
        </div> : null}
      </dl>
      {!marketOnly ? <ValueRangeTrack report={report} /> : null}
    </div>
  );
}

function insurerMedianExplanation(report: TotalLossPublishedReport) {
  const { advertisedPrices, adjustedValues } = report.insurerEvidence.summary;
  const advertised = advertisedPrices?.count && hasMoney(advertisedPrices.median) ? advertisedPrices.median : null;
  const adjusted = adjustedValues?.count && hasMoney(adjustedValues.median) ? adjustedValues.median : null;
  if (advertised && adjusted && advertisedPrices?.count === report.insurerEvidence.comparableCount && adjustedValues?.count === report.insurerEvidence.comparableCount) {
    return `The advertised-price median was ${moneyLabel(advertised)}. After the report’s adjustments, the median was ${moneyLabel(adjusted)}.`;
  }
  return [
    advertised ? `The disclosed advertised prices had a median of ${moneyLabel(advertised)}.` : null,
    adjusted ? `The disclosed adjusted values had a median of ${moneyLabel(adjusted)}.` : null,
  ].filter(Boolean).join(" ");
}

function rangePosition(report: TotalLossPublishedReport, intakeMode: TotalLossIntakeMode) {
  const value = report.conclusion.insurerValuation;
  const range = report.conclusion.supportedRange;
  if (!range || !hasMoney(value) || !hasMoney(range.low) || !hasMoney(range.high)) return null;
  if (![value, range.low, range.high].every((money) => Number.isSafeInteger(money.amountMinorUnits) && money.currency === value.currency)) return null;
  if (range.low.amountMinorUnits > range.high.amountMinorUnits) return null;
  const subject = intakeMode === "manual" ? "The offer you entered" : "Your insurer’s valuation";
  if (value.amountMinorUnits < range.low.amountMinorUnits) {
    const gap = amountLabel(range.low.amountMinorUnits - value.amountMinorUnits, value.currency);
    return `${subject} is below the selected advertised-price range.${gap ? ` Even the lowest listing used for this comparison, at ${moneyLabel(range.low)}, was ${gap} higher.` : ""}`;
  }
  if (value.amountMinorUnits > range.high.amountMinorUnits) return `${subject} is above the selected advertised-price range.`;
  return `${subject} is within the selected advertised-price range.`;
}

function listingTiming(basis: string | null | undefined, label: string | null | undefined) {
  if (basis === "Historical advertised-price evidence from around the loss date" || basis === "LOSS_DATE_HISTORICAL" || label === "Primary loss-date historical evidence") return "historical";
  if (basis === "Current advertised-price evidence" || basis === "CURRENT_MARKET" || ["Primary current market evidence", "Secondary current market evidence", "Current market evidence"].includes(label ?? "")) return "current";
  return null;
}

function decisionLimitations(report: TotalLossPublishedReport) {
  const limitations = report.conclusion.limitations.join(" ");
  const differences = [
    /no[^.]*condition.adjustment/iu.test(limitations) ? "condition" : null,
    /without an independent dollar.per.mile|applies no independent dollar.per.mile|no independent mileage adjustment/iu.test(limitations) ? "mileage" : null,
    /no[^.]*option, package, or equipment|no independent options adjustment/iu.test(limitations) ? "equipment" : null,
  ].filter((value): value is string => value !== null);
  return [
    differences.length ? `This comparison does not add dollar adjustments for differences in ${new Intl.ListFormat("en-US", { type: "conjunction" }).format(differences)}.` : null,
    /not an independent.*appraisal/iu.test(limitations) ? "This comparison is not an independent vehicle appraisal." : null,
  ].filter((value): value is string => value !== null);
}

export function CompletedAnalysis(props: CompletedAnalysisProps) {
  const { claim, report, view, intakeMode, caseId } = props;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const root = useRef<HTMLElement>(null);
  const navigationEpoch = useRef(0);
  const stage = completedAnalysisStage(view, search, intakeMode);
  const [hasDraft, setHasDraft] = useState(claim.messageDraft?.reportVersionId === report.reportId);
  const progression = useReviewProgression({ ...props, reportId: report.reportId });
  const base = totalLossClaimBasePath(caseId);
  const path = (next: string) => `${base}/review/${next}`;
  const sent = requestIsSent(claim);
  const prerequisite = reviewPrerequisite(claim, report.reportId, intakeMode, stage);
  const canPrepare = requestReviewComplete(claim, report.reportId);
  const manual = intakeMode === "manual";
  const total = manual ? 5 : 6;
  const index = stage === "result" ? 1 : stage === "insurer" ? 2 : stage === "market" ? manual ? 2 : 3 : stage === "meaning" ? manual ? 3 : 4 : hasDraft ? total : total - 1;
  const previous = stage === "result" ? "/appraisals" : stage === "insurer" ? path("result") : stage === "market" ? path(manual ? "result" : "insurer") : stage === "meaning" ? path("market") : path("meaning");
  const next = stage === "result" ? manual ? "market" : "insurer" : stage === "insurer" ? "market" : stage === "market" ? "meaning" : "request";
  const action = stage === "result" && !manual ? "See how the insurer reached its value" : stage === "result" || stage === "insurer" ? "See the market evidence" : stage === "market" ? "Compare the values" : "Prepare my request";
  const classification = reportText(report.conclusion.classificationLabel).replace(/^Potential undervaluation signal$/iu, "Potential undervaluation");
  const resultExplanation = report.conclusion.continuingSupported
    ? `${manual ? "The offer you entered" : "Your insurer’s valuation"} appears low compared with the selected market listings.`
    : /no material discrepancy/iu.test(classification)
      ? "The available market listings do not show a clear basis for a higher valuation."
      : /insufficient evidence/iu.test(classification)
        ? "There was not enough market information to draw a clear comparison."
        : "Your report explains what the available market information can support.";
  const primary = report.marketEvidence.primary;
  const secondary = report.marketEvidence.secondary;
  const primaryTiming = listingTiming(report.conclusion.supportedRange?.evidenceBasis, primary?.label);
  const secondaryTiming = listingTiming(null, secondary?.label);
  const primaryDate = dateLabel(primary?.evidenceDate ?? null);
  const secondaryDate = dateLabel(secondary?.evidenceDate ?? null);
  const comparison = medianComparison(report);
  const position = rangePosition(report, intakeMode);
  const limitations = decisionLimitations(report);
  const disclosure = report.insurerEvidence.summary;
  const insurerCount = report.insurerEvidence.comparableCount;

  useReviewStageMotion({ root, stage, index: stage === "sent" ? total + 1 : index, locationKey: location.key, pathname: location.pathname, reportId: report.reportId });

  useEffect(() => {
    navigationEpoch.current += 1;
    return () => { navigationEpoch.current += 1; };
  }, [stage, hasDraft, location.key, report.reportId]);

  if (stage === "sent" && !sent) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("sent") ? resume : path("result")} />;
  }
  if (stage === "request" && sent) return <Navigate replace to={path("sent")} />;

  const continueReview = async () => {
    if (stage === "request" || stage === "sent") return;
    const epoch = navigationEpoch.current;
    if (await progression.complete(stage) && epoch === navigationEpoch.current) navigate(path(next), { viewTransition: supportsReviewTransition() });
  };

  return (
    <section className="completed-analysis" aria-label="Completed analysis" ref={root} tabIndex={-1} data-stage={stage}>
      {stage !== "sent" ? <ReviewProgress index={index} total={total} /> : null}
      <div className="review-stage-content" data-view={stage}>
      {claim.journey?.fulfillmentState === "refund_pending" || claim.commerce?.entitlementStatus === "refunded_access_retained" ? (
        <p role="status">{claim.commerce?.entitlementStatus === "refunded_access_retained" ? "Refunded" : "Refund in progress"}. Your completed report remains available.</p>
      ) : null}
      {stage === "result" ? <>
        <div className="result-heading"><h1>Your result</h1><p className="review-vehicle">{displayed(report.subjectVehicle.description, "Your vehicle")}</p></div>
        <h2 className="result-conclusion">{classification}</h2>
        <p className="review-lead">{resultExplanation}</p>
        <ValueSummary {...props} />
        {manual ? <p className="review-note">Because you did not provide the insurer’s valuation report, Venfour did not review the insurer’s comparable vehicles or adjustments.</p> : null}
        <p className="review-note">Advertised prices are not guaranteed sale prices or settlement values.</p>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "insurer" ? <>
        <h1>How your insurer reached its value</h1>
        <p className="review-lead">Insurers may start with prices for similar vehicles, then adjust those values for differences such as mileage or equipment. Venfour shows only the adjustments disclosed in your report.</p>
        {hasMoney(report.conclusion.insurerValuation) ? <dl className="insurer-reference"><dt>Insurer valuation</dt><dd>{moneyLabel(report.conclusion.insurerValuation)}</dd></dl> : null}
        <InsurerValueBridge report={report} />
        <div className="insurer-explanation">
        <p>{insurerCount ? `Your insurer’s report includes ${insurerCount.toLocaleString("en-US")} comparable ${insurerCount === 1 ? "vehicle" : "vehicles"}.` : "No insurer comparables were available in the report for this review."}</p>
        {insurerMedianExplanation(report) ? <p>{insurerMedianExplanation(report)}</p> : null}
        {disclosure.fullyDisclosedAdjustmentCount > 0 ? <p>{insurerCount === 1 ? "Detailed adjustment information was available for this comparable." : `Detailed adjustment information was available for ${disclosure.fullyDisclosedAdjustmentCount.toLocaleString("en-US")} of the ${insurerCount.toLocaleString("en-US")} comparables.`}</p> : null}
        {disclosure.partiallyDisclosedAdjustmentCount > 0 ? <p>Some adjustment details were only partially disclosed, so not every adjustment could be reviewed in the same detail.</p> : null}
        {disclosure.undisclosedAdjustmentCount > 0 || disclosure.unavailableAdjustmentCount > 0 ? <p>{insurerCount === 1 ? "This comparable had" : "Some comparables had"} no adjustment details, so Venfour could not explain all of the report’s adjustments.</p> : null}
        {insurerCount > 0 && (disclosure.partiallyDisclosedAdjustmentCount > 0 || disclosure.undisclosedAdjustmentCount > 0 || disclosure.unavailableAdjustmentCount > 0) ? <p>Missing details do not, by themselves, mean the valuation or an adjustment was wrong.</p> : null}
        </div>
        <InsurerEvidenceDetails report={report} open={search.get("details") === "insurer"} />
      </> : null}
      {stage === "market" ? <>
        <h1>What the market evidence showed</h1>
        <p className="review-lead">{primary?.selectedCount ? `Venfour selected ${primary.selectedCount.toLocaleString("en-US")} ${primaryTiming === "current" ? "current " : primaryTiming === "historical" ? "historical " : ""}${primary.selectedCount === 1 ? "listing for a similar vehicle" : "listings for similar vehicles"}.` : report.marketEvidence.comparables.length ? "The listing details show the market information available for this comparison." : "No comparable market listings were available for this comparison."}</p>
        <ValueSummary {...props} marketOnly />
        <div className="market-evidence-context">
        {primary && primary.selectedCount > 0 ? primaryTiming === "current" ? <p>{primaryDate !== "Not stated" ? `${primary.selectedCount === 1 ? "This listing was" : "These listings were"} collected on ${primaryDate}. ` : ""}{primary.selectedCount === 1 ? "It shows" : "They show"} the market when collected, not necessarily on the date of loss.</p> : primaryTiming === "historical" ? <p>{primary.selectedCount === 1 ? "This listing was" : "These listings were"} verified as active {primaryDate !== "Not stated" ? `on ${primaryDate}, the date used for this comparison` : "on the date of loss"}.</p> : <p>The listing details explain when each price was observed.</p> : null}
        {secondary && secondary.selectedCount > 0 ? <p>A further {secondary.selectedCount.toLocaleString("en-US")} {secondaryTiming === "current" ? "current " : ""}{secondary.selectedCount === 1 ? "listing provides" : "listings provide"} additional context{secondaryTiming === "current" && secondaryDate !== "Not stated" ? ` from ${secondaryDate}` : ""}. {secondary.selectedCount === 1 ? "It is" : "They are"} not included in the range above.{secondaryTiming === "current" ? " Current listings do not establish prices on the date of loss." : ""}</p> : null}
        {report.conclusion.limitations.some((value) => /out.of.provider.range/iu.test(value)) ? <p>The market-data source had limited historical coverage. This does not mean no comparable vehicles existed at the time of loss.</p> : null}
        <p>These are advertised prices, not confirmed sale prices.</p>
        </div>
        <RepresentativeListings report={report} />
        <MarketEvidenceDetails report={report} open={search.get("details") === "market"} />
        <MethodologyDisclosure report={report} intakeMode={intakeMode} />
      </> : null}
      {stage === "meaning" ? <>
        <h1>What the comparison means</h1>
        <div className="meaning-interpretation">
        {hasMoney(report.conclusion.insurerValuation) ? <p className="meaning-value">{manual ? "The insurer offer you entered was" : "Your insurer valued the vehicle at"} {moneyLabel(report.conclusion.insurerValuation)}.</p> : null}
        {position ? <p className="meaning-position">{position}</p> : null}
        {comparison ? <p className="meaning-comparison">{manual ? "The offer" : "The valuation"} {comparison.startsWith("Matches") ? "matches the selected median" : `is ${comparison}`}{hasMoney(report.conclusion.supportedRange?.median) ? ` of ${moneyLabel(report.conclusion.supportedRange?.median)}` : ""}.</p> : null}
        </div>
        {report.conclusion.continuingSupported ? <p className="meaning-takeaway">Based on the available evidence, you have a reasonable basis to ask the insurer to review {manual ? "the offer" : "its valuation"}.</p> : <p>The result does not support a higher valuation request. Your evidence package remains available.</p>}
        <div className="meaning-limitations">
        <p>This does not mean you are automatically owed the selected median or another specific amount. These are advertised listings, not confirmed sale prices, and the insurer may respond with additional evidence.</p>
        {manual ? <p>Without the insurer’s valuation report, Venfour cannot review which comparable vehicles or adjustments the insurer used.</p> : null}
        {limitations.length ? <>
          <h2>Limitations to keep in mind</h2>
          <ul>{limitations.map((value) => <li key={value}>{value}</li>)}</ul>
        </> : null}
        <p>Your evidence package explains the comparison and its limitations in more detail.</p>
        </div>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "request" ? (
        canPrepare && report.conclusion.continuingSupported ? <MessagePreparation {...props} onDraftStateChange={setHasDraft} onSent={() => navigate(path("sent"), { replace: true, viewTransition: supportsReviewTransition() })} /> : <>
          <h1>Prepare your request</h1>
          {report.conclusion.continuingSupported ? <p>Finish reviewing the result and comparison before creating your request.</p> : <p>The result does not support a higher valuation request. Your report remains available.</p>}
          <ReportFileRow {...props} />
        </>
      ) : null}
      {stage === "sent" ? <>
        <div className="sent-confirmation-mark" aria-hidden="true"><Check /></div>
        <div className="sent-heading"><h1>Waiting for the insurer’s response</h1>
        <p className="review-lead" role="status">You reported sending your reconsideration request with the evidence package attached.</p>
        </div>
        {claim.education?.reportVersionId === report.reportId && claim.education.steps.send.completedAt ? <p className="sent-recorded">Recorded: <RecordedTime value={claim.education.steps.send.completedAt} /></p> : null}
        <div className="sent-next-steps">
        <p>Venfour cannot verify email delivery or receipt. The next step is waiting for the insurer’s response.</p>
        <p>Keep your sent email, attached package, and the insurer’s written reply. The insurer may revise its valuation, maintain it with an explanation, or ask for more information.</p>
        </div>
        <ReportFileRow {...props} />
      </> : null}
      </div>
      {prerequisite ? <p className="review-prerequisite"><Link to={path(prerequisite)}>Continue your review</Link> before proceeding from this stage.</p> : null}
      {progression.error ? <p className="review-error" role="alert">{progression.error}</p> : null}
      <nav className="review-actions" aria-label="Review navigation">
        <Link className="review-back" to={previous} viewTransition={stage !== "result" && supportsReviewTransition()} onClick={(event) => { if (progression.pending) event.preventDefault(); }}><ArrowLeft aria-hidden="true" />Back</Link>
        {stage !== "request" && stage !== "sent" && (stage !== "meaning" || report.conclusion.continuingSupported) ? <button className="review-primary" type="button" disabled={progression.pending || Boolean(prerequisite)} onClick={() => void continueReview()}>{progression.pending ? <LoaderCircle className="review-spinner" aria-hidden="true" /> : null}<span>{progression.pending ? "Saving progress…" : action}</span>{!progression.pending ? <ArrowRight aria-hidden="true" /> : null}</button> : null}
      </nav>
    </section>
  );
}
