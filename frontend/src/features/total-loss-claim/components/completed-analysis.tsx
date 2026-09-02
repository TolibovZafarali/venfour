import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { totalLossCaseJourneyProgress } from "../case-journey";
import { createCaseWorkspace } from "../case-workspace";
import type { TotalLossClaimSecured, TotalLossMoney, TotalLossPublishedReport } from "../contracts";
import { dateLabel, displayed, moneyLabel, reportText } from "../report-format";
import { requestIsSent, requestReviewComplete } from "../request-state";
import { reviewPrerequisite, useReviewProgression } from "../use-review-progression";
import {
  authoritativeTotalLossClaimPath,
  completedAnalysisStage,
  resolvedTotalLossClaimJourneyState,
  routeForJourneyState,
  totalLossClaimBasePath,
  type TotalLossClaimWorkflowView,
} from "../workflow-route";
import { InsurerEvidenceDetails, MarketEvidenceDetails, MethodologyDisclosure } from "./case-evidence";
import { MessagePreparation } from "./message-preparation";
import { FollowUpPreparation } from "./follow-up-preparation";
import {
  InsurerResponseForm,
  InsurerResponseReceived,
  InsurerResponseReviewed,
  InsurerResponseReviewing,
} from "./insurer-response";
import { ReportFileRow } from "./published-report-actions";
import { CaseWorkspaceNavigation } from "./case-workspace-navigation";
import { SentRequest } from "./sent-request";
import { CaseJourneyProgress, InsurerValueBridge, RecordedTime, RepresentativeListings, ValueRangeTrack } from "./completed-analysis-visuals";
import { useReviewStageMotion } from "./use-review-stage-motion";
import "./completed-analysis.css";
import "./completed-review-motion.css";

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
    const exactDollars = amountMinorUnits % 100 === 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: exactDollars ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountMinorUnits / 100);
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
        {!marketOnly && hasMoney(report.conclusion.insurerValuation) ? <div className="value-summary-offer" data-review-entrance="secondary" data-review-order="0"><dt>{intakeMode === "manual" ? "Insurer offer you entered" : "Insurer valuation"}</dt><dd>{moneyLabel(report.conclusion.insurerValuation)}</dd></div> : null}
        {range && hasMoney(range.low) && hasMoney(range.high) ? <div className="value-summary-range" data-review-entrance="secondary" data-review-order="1">
          <dt>Selected advertised-price range</dt><dd>{range.low.currency === range.high.currency && range.low.amountMinorUnits === range.high.amountMinorUnits ? moneyLabel(range.low) : `${moneyLabel(range.low)} to ${moneyLabel(range.high)}`}</dd>
        </div> : null}
        {hasMoney(range?.median) ? <div className="value-summary-median" data-review-entrance="secondary" data-review-order="2"><dt>Selected median</dt><dd>{moneyLabel(range?.median)}</dd></div> : null}
        {!marketOnly && comparison ? <div className="value-summary-comparison" data-review-entrance="secondary" data-review-order="3">
          <dt>{intakeMode === "manual" ? "How your offer compares" : "How the insurer’s value compares"}</dt><dd>{comparison}</dd>
        </div> : null}
      </dl>
      {!marketOnly ? <ValueRangeTrack report={report} valueLabel={intakeMode === "manual" ? "Offer" : "Insurer"} /> : null}
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
  const [navigationActions, setNavigationActions] = useState<HTMLElement | null>(null);
  const navigationEpoch = useRef(0);
  const requestedStage = completedAnalysisStage(view, search, intakeMode);
  const sent = requestIsSent(claim);
  const journeyState = resolvedTotalLossClaimJourneyState(claim);
  const followUpSent = claim.followUp?.state === "sent";
  const continued = claim.insurerResponse?.decision?.choice === "CONTINUE_CHALLENGING";
  const responseStage = claim.insurerResponse
    ? journeyState === "insurer_response_reviewed" || (claim.insurerResponse.processingState === "completed" && Boolean(claim.insurerResponse.analysis && claim.insurerResponse.analysisEvidence))
      ? "response_reviewed"
      : journeyState === "insurer_response_reviewing" ||
          journeyState === "insurer_response_review_unavailable"
        ? "response_reviewing"
        : journeyState === "insurer_response_received"
          ? "response_received"
          : null
    : null;
  const stage = requestedStage;
  const [preparedDraft, setHasDraft] = useState(false);
  const hasDraft = preparedDraft || claim.messageDraft?.reportVersionId === report.reportId;
  const progression = useReviewProgression({ ...props, reportId: report.reportId });
  const base = totalLossClaimBasePath(caseId);
  const path = (next: string) => `${base}/review/${next}`;
  const prerequisite = reviewPrerequisite(claim, report.reportId, intakeMode, stage);
  const canPrepare = requestReviewComplete(claim, report.reportId);
  const manual = intakeMode === "manual";
  const continuing = report.conclusion.continuingSupported;
  const workspace = createCaseWorkspace({ claim, report, intakeMode, hasDraft });
  const viewedProgress = totalLossCaseJourneyProgress({
    continuingSupported: continuing,
    hasDraft,
    intakeMode,
    stage,
    hasFollowUp: Boolean(claim.followUp),
    followUpSent,
  });
  const responsePath = responseStage === "response_reviewed"
    ? "response-reviewed"
    : responseStage === "response_reviewing"
      ? "response-reviewing"
      : responseStage === "response_received"
        ? "response-received"
        : "waiting";
  const previous = stage === "result" || stage === "response_received" || stage === "response_reviewing" || stage === "response_reviewed" ? null : stage === "follow_up" ? path("response-reviewed") : stage === "insurer" ? path("result") : stage === "market" ? path(manual ? "result" : "insurer") : stage === "meaning" ? path("market") : stage === "response" ? path(responsePath) : path("meaning");
  const next = stage === "result" ? manual ? "market" : "insurer" : stage === "insurer" ? "market" : stage === "market" ? "meaning" : stage === "meaning" && sent ? responsePath : "request";
  const requestAction = sent ? "Return to case status" : hasDraft ? "Review my request" : "Prepare my request";
  const action = stage === "result" && !manual ? "See how the insurer reached its value" : stage === "result" || stage === "insurer" ? "See the market evidence" : stage === "market" ? "Compare the values" : requestAction;
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
  const hasMarketListings = report.marketEvidence.comparables.length > 0 || Boolean(primary?.selectedCount) || Boolean(secondary?.selectedCount);
  const comparison = medianComparison(report);
  const position = rangePosition(report, intakeMode);
  const limitations = decisionLimitations(report);
  const disclosure = report.insurerEvidence.summary;
  const insurerCount = report.insurerEvidence.comparableCount;

  useReviewStageMotion({ root, stage, index: viewedProgress.position, reportId: report.reportId });

  useEffect(() => {
    navigationEpoch.current += 1;
    return () => { navigationEpoch.current += 1; };
  }, [stage, hasDraft, location.key, report.reportId]);

  if (stage === "waiting" && !sent) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("waiting") ? resume : path("result")} />;
  }
  if (stage === "response" && (!sent || followUpSent)) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume ?? path("result")} />;
  }
  if (stage === "follow_up" && !continued) {
    return <Navigate replace to={authoritativeTotalLossClaimPath(claim, intakeMode) ?? path("result")} />;
  }
  if (stage === "response_received" && (
    !claim.insurerResponse || (search.get("view") !== "saved" && responseStage !== "response_received")
  )) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("response-received") ? resume : path("waiting")} />;
  }
  if (stage === "response_reviewing" && responseStage !== "response_reviewing") {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("response-reviewing") ? resume : path("waiting")} />;
  }
  if (
    stage === "response_reviewed" &&
    (responseStage !== "response_reviewed" ||
      !claim.insurerResponse?.analysis ||
      claim.insurerResponse.processingState !== "completed")
  ) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("response-reviewed") ? resume : path("waiting")} />;
  }
  if (stage === "request" && !continuing && !sent) {
    return <Navigate replace to={path("meaning")} />;
  }

  const continueReview = async () => {
    if (stage === "request" || stage === "follow_up" || stage === "waiting" || stage === "response" || stage === "response_received" || stage === "response_reviewing" || stage === "response_reviewed") return;
    const epoch = navigationEpoch.current;
    if (await progression.complete(stage) && epoch === navigationEpoch.current) navigate(path(next));
  };

  return (
    <section className="completed-analysis" aria-label="Completed analysis" ref={root} tabIndex={-1} data-stage={stage}>
      <CaseJourneyProgress progress={workspace.progress} sections={workspace.sections} />
      <CaseWorkspaceNavigation workspace={workspace} stage={stage} pending={progression.pending} />
      <div className="review-stage-content" data-view={stage}>
      {claim.journey?.fulfillmentState === "refund_pending" || claim.commerce?.entitlementStatus === "refunded_access_retained" ? (
        <p className="review-refund-status" role="status">{claim.commerce?.entitlementStatus === "refunded_access_retained" ? "Your payment was refunded. Your completed report remains available." : "Your refund is in progress. Your completed report remains available while it is processed."}</p>
      ) : null}
      {stage === "result" ? <>
        <div className="result-heading" data-review-entrance="secondary"><h1>Your result</h1><p className="review-vehicle">{displayed(report.subjectVehicle.description, "Your vehicle")}</p></div>
        <h2 className="result-conclusion" data-review-entrance="primary" data-review-order="1">{classification}</h2>
        <p className="review-lead" data-review-entrance="secondary" data-review-order="2">{resultExplanation}</p>
        <ValueSummary {...props} />
        {manual ? <p className="review-note" data-review-entrance="supporting">Because you did not provide the insurer’s valuation report, Venfour did not review the insurer’s comparable vehicles or adjustments.</p> : null}
        <p className="review-note" data-review-entrance="supporting">Advertised prices are not guaranteed sale prices or settlement values.</p>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "insurer" ? <>
        <h1 data-review-entrance="primary">How your insurer reached its value</h1>
        <p className="review-lead" data-review-entrance="primary" data-review-order="1">Insurers may start with prices for similar vehicles, then adjust those values for differences such as mileage or equipment. Venfour shows only the adjustments disclosed in your report.</p>
        {hasMoney(report.conclusion.insurerValuation) ? <dl className="insurer-reference" data-review-entrance="secondary"><dt>Insurer valuation</dt><dd>{moneyLabel(report.conclusion.insurerValuation)}</dd></dl> : null}
        <InsurerValueBridge report={report} />
        <div className="insurer-explanation">
        <p data-review-entrance="supporting" data-review-order="0">{insurerCount ? `Your insurer’s report includes ${insurerCount.toLocaleString("en-US")} comparable ${insurerCount === 1 ? "vehicle" : "vehicles"}.` : "No insurer comparables were available in the report for this review."}</p>
        {insurerMedianExplanation(report) ? <p data-review-entrance="supporting" data-review-order="1">{insurerMedianExplanation(report)}</p> : null}
        {disclosure.fullyDisclosedAdjustmentCount > 0 ? <p data-review-entrance="supporting" data-review-order="2">{insurerCount === 1 ? "Detailed adjustment information was available for this comparable." : `Detailed adjustment information was available for ${disclosure.fullyDisclosedAdjustmentCount.toLocaleString("en-US")} of the ${insurerCount.toLocaleString("en-US")} comparables.`}</p> : null}
        {disclosure.partiallyDisclosedAdjustmentCount > 0 ? <p data-review-entrance="supporting" data-review-order="3">Some adjustment details were only partially disclosed, so not every adjustment could be reviewed in the same detail.</p> : null}
        {disclosure.undisclosedAdjustmentCount > 0 || disclosure.unavailableAdjustmentCount > 0 ? <p data-review-entrance="supporting" data-review-order="3">{insurerCount === 1 ? "This comparable had" : "Some comparables had"} no adjustment details, so Venfour could not explain all of the report’s adjustments.</p> : null}
        {insurerCount > 0 && (disclosure.partiallyDisclosedAdjustmentCount > 0 || disclosure.undisclosedAdjustmentCount > 0 || disclosure.unavailableAdjustmentCount > 0) ? <p data-review-entrance="supporting" data-review-order="3">Missing details do not, by themselves, mean the valuation or an adjustment was wrong.</p> : null}
        </div>
        <InsurerEvidenceDetails report={report} open={search.get("details") === "insurer"} />
      </> : null}
      {stage === "market" ? <>
        <h1 data-review-entrance="primary">What the market evidence showed</h1>
        <p className="review-lead" data-review-entrance="primary" data-review-order="1">{primary?.selectedCount ? `Venfour selected ${primary.selectedCount.toLocaleString("en-US")} ${primaryTiming === "current" ? "current " : primaryTiming === "historical" ? "historical " : ""}${primary.selectedCount === 1 ? "listing for a similar vehicle" : "listings for similar vehicles"}.` : report.marketEvidence.comparables.length ? "The listing details show the market information available for this comparison." : "No comparable market listings were available for this comparison."}</p>
        <ValueSummary {...props} marketOnly />
        <div className="market-evidence-context">
        {primary && primary.selectedCount > 0 ? primaryTiming === "current" ? <p data-review-entrance="supporting" data-review-order="0">{primaryDate !== "Not stated" ? `${primary.selectedCount === 1 ? "This listing was" : "These listings were"} collected on ${primaryDate}. ` : ""}{primary.selectedCount === 1 ? "It shows" : "They show"} the market when collected, not necessarily on the date of loss.</p> : primaryTiming === "historical" ? <p data-review-entrance="supporting" data-review-order="0">{primary.selectedCount === 1 ? "This listing was" : "These listings were"} verified as active {primaryDate !== "Not stated" ? `on ${primaryDate}, the date used for this comparison` : "on the date of loss"}.</p> : <p data-review-entrance="supporting" data-review-order="0">The listing details explain when each price was observed.</p> : null}
        {secondary && secondary.selectedCount > 0 ? <p data-review-entrance="supporting" data-review-order="1">A further {secondary.selectedCount.toLocaleString("en-US")} {secondaryTiming === "current" ? "current " : ""}{secondary.selectedCount === 1 ? "listing provides" : "listings provide"} additional context{secondaryTiming === "current" && secondaryDate !== "Not stated" ? ` from ${secondaryDate}` : ""}. {secondary.selectedCount === 1 ? "It is" : "They are"} not included in the range above.{secondaryTiming === "current" ? " Current listings do not establish prices on the date of loss." : ""}</p> : null}
        {report.conclusion.limitations.some((value) => /out.of.provider.range/iu.test(value)) ? <p data-review-entrance="supporting" data-review-order="2">The market-data source had limited historical coverage. This does not mean no comparable vehicles existed at the time of loss.</p> : null}
        {hasMarketListings ? <p data-review-entrance="supporting" data-review-order="3">These are advertised prices, not confirmed sale prices.</p> : null}
        </div>
        <RepresentativeListings report={report} />
        <MarketEvidenceDetails report={report} open={search.get("details") === "market"} />
        <MethodologyDisclosure report={report} intakeMode={intakeMode} />
      </> : null}
      {stage === "meaning" ? <>
        <h1 data-review-entrance="secondary">What the comparison means</h1>
        <div className="meaning-interpretation">
        {hasMoney(report.conclusion.insurerValuation) ? <p className="meaning-value" data-review-entrance="primary" data-review-order="0">{manual ? "The insurer offer you entered was" : "Your insurer valued the vehicle at"} {moneyLabel(report.conclusion.insurerValuation)}.</p> : null}
        {position ? <p className="meaning-position" data-review-entrance="primary" data-review-order="1">{position}</p> : null}
        {comparison ? <p className="meaning-comparison" data-review-entrance="primary" data-review-order="2">{manual ? "The offer" : "The valuation"} {comparison.startsWith("Matches") ? "matches the selected median" : `is ${comparison}`}{hasMoney(report.conclusion.supportedRange?.median) ? ` of ${moneyLabel(report.conclusion.supportedRange?.median)}` : ""}.</p> : null}
        </div>
        {report.conclusion.continuingSupported ? <p className="meaning-takeaway" data-review-entrance="secondary">Based on the available evidence, you have a reasonable basis to ask the insurer to review {manual ? "the offer" : "its valuation"}.</p> : <p data-review-entrance="secondary">The result does not support a higher valuation request. Your valuation report remains available.</p>}
        <div className="meaning-limitations">
        <p data-review-entrance="secondary" data-review-order="0">{hasMarketListings ? "This does not mean you are automatically owed the selected median or another specific amount. These are advertised listings, not confirmed sale prices, and the insurer may respond with additional evidence." : "This result does not establish that you are owed a higher amount. The insurer may respond with additional evidence."}</p>
        {manual ? <p data-review-entrance="secondary" data-review-order="1">Without the insurer’s valuation report, Venfour cannot review which comparable vehicles or adjustments the insurer used.</p> : null}
        {limitations.length ? <>
          <h2 data-review-entrance="secondary" data-review-order="2">Limitations to keep in mind</h2>
          <ul>{limitations.map((value) => <li key={value} data-review-entrance="secondary" data-review-order="3">{value}</li>)}</ul>
        </> : null}
        <p data-review-entrance="secondary" data-review-order="3">Your valuation report explains the comparison and its limitations in more detail.</p>
        </div>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "request" ? (
        sent ? <><SentRequest claim={claim} report={report} /><ReportFileRow {...props} /></> : canPrepare && report.conclusion.continuingSupported ? <MessagePreparation {...props} actionContainer={navigationActions} onDraftStateChange={setHasDraft} onSent={() => navigate(path("waiting"), { replace: true })} /> : <>
          <h1 data-review-entrance="primary">Prepare your request</h1>
          {report.conclusion.continuingSupported ? <p data-review-entrance="secondary">Finish reviewing the result and comparison before creating your request.</p> : <p data-review-entrance="secondary">The result does not support a higher valuation request. Your report remains available.</p>}
          <ReportFileRow {...props} />
        </>
      ) : null}
      {stage === "follow_up" ? <FollowUpPreparation {...props} actionContainer={navigationActions} onSent={() => navigate(path("waiting"), { replace: true })} /> : null}
      {stage === "waiting" ? <>
        <div className="sent-heading" data-review-entrance="primary"><h1>{followUpSent || !claim.insurerResponse ? "Waiting for the insurer’s response" : "Insurer response recorded"}</h1>
        <p className="review-lead" role="status">{followUpSent ? "Based on your confirmation, Venfour recorded that you sent your follow-up with the valuation report attached." : "Based on your confirmation, Venfour recorded that you sent your reconsideration request with the valuation report attached."}</p>
        </div>
        {followUpSent && claim.followUp?.sentMessage ? <div className="sent-next-steps"><p className="sent-recorded">Follow-up recorded: <RecordedTime value={claim.followUp.sentMessage.customerReportedSentAt} />. <Link to={path("follow-up")}>View your sent follow-up</Link></p><p>Your case remains active. Venfour does not monitor your email and cannot verify delivery or receipt. Keep any further reply with your records; adding another insurer response is not available yet.</p></div> : claim.education?.reportVersionId === report.reportId && claim.education.steps.send.completedAt ? <p className="sent-recorded" data-review-entrance="supporting">Request recorded: <RecordedTime value={claim.education.steps.send.completedAt} /></p> : null}
        {claim.insurerResponse ? <p className="review-note" data-review-entrance="supporting">You recorded the insurer’s response on <RecordedTime value={claim.insurerResponse.receivedAt} />. <Link to={`${path("response-received")}?view=saved`}>View the insurer’s response</Link></p> : <div className="sent-next-steps">
        <h2 data-review-entrance="supporting" data-review-order="0">What happens now</h2>
        <p data-review-entrance="supporting" data-review-order="1">Your case remains active while you wait. Venfour does not monitor your email or the insurer, so it cannot verify delivery, receipt, or detect a response automatically.</p>
        <p data-review-entrance="supporting" data-review-order="2">Keep your sent email, attached report, and the insurer’s written reply. When the insurer responds, return to this case and choose “I received a response” to continue.</p>
        </div>}
        <ReportFileRow {...props} />
      </> : null}
      {stage === "response" ? <InsurerResponseForm {...props} actionContainer={navigationActions} onRecorded={(state) => navigate(routeForJourneyState(caseId, state), { replace: true })} /> : null}
      {stage === "response_received" && claim.insurerResponse ? <>
        <InsurerResponseReceived {...props} response={claim.insurerResponse} onCorrect={followUpSent ? undefined : () => navigate(path("response"))} />
        <ReportFileRow {...props} />
      </> : null}
      {stage === "response_reviewing" && claim.insurerResponse ? <>
        <InsurerResponseReviewing {...props} response={claim.insurerResponse} onCorrect={() => navigate(path("response"))} />
        <ReportFileRow {...props} />
      </> : null}
      {stage === "response_reviewed" && claim.insurerResponse?.analysis && claim.insurerResponse.analysisEvidence ? <>
        <InsurerResponseReviewed
          {...props}
          onCorrect={followUpSent ? undefined : () => navigate(path("response"))}
          priorValuation={report.conclusion.insurerValuation}
          response={{
            ...claim.insurerResponse,
            analysis: claim.insurerResponse.analysis,
            analysisEvidence: claim.insurerResponse.analysisEvidence,
          }}
        />
        <ReportFileRow {...props} />
      </> : null}
        {prerequisite ? <p className="review-prerequisite"><Link to={path(prerequisite)}>Continue your review</Link> before proceeding from this stage.</p> : null}
        {progression.error ? <p className="review-error" role="alert">{progression.error}</p> : null}
        <nav className="review-actions" aria-label="Review navigation" ref={setNavigationActions}>
          {previous ? <Link aria-disabled={progression.pending || undefined} className="review-back" data-review-entrance="supporting" data-review-order="0" to={previous} onClick={(event) => {
            if (progression.pending) event.preventDefault();
          }}><ArrowLeft aria-hidden="true" />Back</Link> : null}
          {stage === "waiting" && !claim.insurerResponse ? <button className="review-primary" data-review-entrance="secondary" data-review-order="1" type="button" onClick={() => navigate(path("response"))}><span className="review-action-label"><span className="review-action-reserve" aria-hidden="true">I received a response</span><span>I received a response</span></span><span className="review-action-icon"><ArrowRight aria-hidden="true" /></span></button> : null}
          {stage !== "request" && stage !== "follow_up" && stage !== "waiting" && stage !== "response" && stage !== "response_received" && stage !== "response_reviewing" && stage !== "response_reviewed" && (stage !== "meaning" || report.conclusion.continuingSupported) ? <button className="review-primary" data-review-entrance="secondary" data-review-order="1" type="button" disabled={progression.pending || Boolean(prerequisite)} onClick={() => void continueReview()}><span className="review-action-label"><span className="review-action-reserve" aria-hidden="true">{action}</span><span>{progression.pending ? "Saving progress…" : action}</span></span><span className="review-action-icon">{progression.pending ? <LoaderCircle className="review-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</span></button> : null}
        </nav>
      </div>
    </section>
  );
}
