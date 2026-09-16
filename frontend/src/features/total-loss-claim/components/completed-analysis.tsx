import { ArrowLeft, ArrowRight, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { totalLossCaseJourneyProgress } from "../case-journey";
import { createCaseWorkspace } from "../case-workspace";
import type { TotalLossClaimSecured, TotalLossMoney, TotalLossPublishedReport } from "../contracts";
import { dateLabel, displayed, moneyLabel, reportText } from "../report-format";
import { initialSentRequest, requestIsSent, requestReviewComplete } from "../request-state";
import { reviewPrerequisite, useReviewProgression } from "../use-review-progression";
import { useRequestContinuation } from "../use-request-continuation";
import { useDecisionContinuation, useFollowUpContinuation, useResponseContinuation } from "../use-response-continuation";
import { caseIsClosed, currentAcceptedOffer } from "../resolution";
import {
  authoritativeTotalLossClaimPath,
  completedAnalysisStage,
  resolvedTotalLossClaimJourneyState,
  routeForJourneyState,
  totalLossClaimBasePath,
  type TotalLossClaimWorkflowView,
} from "../workflow-route";
import { HigherPricedListings, InsurerEvidenceDetails, MarketEvidenceDetails, MarketSearchLimitations, MethodologyDisclosure } from "./case-evidence";
import { MessagePreparation } from "./message-preparation";
import { FollowUpPreparation } from "./follow-up-preparation";
import { SentFollowUp } from "./follow-up-message";
import { AcceptedOfferFinalization, CaseClosureDialog, CaseResolutionBanner, ManualCaseClosure } from "./case-resolution";
import { CaseClosureCelebration } from "./case-closure-celebration";
import { CaseRecord } from "./case-record";
import { NegotiationHistoryDialog } from "./negotiation-history";
import {
  InsurerResponseForm,
  InsurerResponseReceived,
  InsurerResponseReviewed,
  InsurerResponseReviewing,
} from "./insurer-response";
import { ReportFileRow } from "./published-report-actions";
import { CaseWorkspaceNavigation } from "./case-workspace-navigation";
import { SentRequest } from "./sent-request";
import { MessageStepHeading } from "./message-step-heading";
import { CaseJourneyProgress, InsurerValueBridge, RecordedTime, ResultComparisonDiagram } from "./completed-analysis-visuals";
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

function MarketPriceRange({ report }: { readonly report: TotalLossPublishedReport }) {
  const range = report.conclusion.supportedRange;
  if (!range || !hasMoney(range.low) || !hasMoney(range.high) || range.low.currency !== range.high.currency || range.low.amountMinorUnits > range.high.amountMinorUnits) return null;
  return <dl className="market-price-range">
    <dt>Asking prices for these vehicles</dt>
    <dd>{range.low.amountMinorUnits === range.high.amountMinorUnits ? moneyLabel(range.low) : `${moneyLabel(range.low)} to ${moneyLabel(range.high)}`}</dd>
  </dl>;
}

function ResultValues({ report, intakeMode, explanation }: {
  readonly explanation?: string | null;
  readonly report: TotalLossPublishedReport;
  readonly intakeMode: TotalLossIntakeMode;
}) {
  const value = report.conclusion.insurerValuation;
  const range = report.conclusion.supportedRange;
  const showValue = hasMoney(value);
  const showRange = range && hasMoney(range.low) && hasMoney(range.high);
  if (!showValue && !showRange) return null;
  return <div className="result-values" data-review-entrance="secondary" data-review-order="3">
    <dl className="result-values-grid">
      {showValue ? <div>
        <dt>{intakeMode === "manual" ? "Original offer you entered" : "Your insurer’s original value"}</dt>
        <dd>{moneyLabel(value)}</dd>
      </div> : null}
      {showRange ? <div>
        <dt>Asking prices for similar vehicles</dt>
        <dd>{range.low.currency === range.high.currency && range.low.amountMinorUnits === range.high.amountMinorUnits
          ? moneyLabel(range.low)
          : <><span>{moneyLabel(range.low)}</span><span className="result-values-to"> to </span><span>{moneyLabel(range.high)}</span></>}</dd>
      </div> : null}
    </dl>
    <ResultComparisonDiagram report={report} manual={intakeMode === "manual"} caption={explanation ?? undefined} />
    {showRange ? <p className="result-values-note">Asking prices are not guaranteed sale prices or settlement amounts.</p> : null}
  </div>;
}

function rangePosition(report: TotalLossPublishedReport, intakeMode: TotalLossIntakeMode) {
  const value = report.conclusion.insurerValuation;
  const range = report.conclusion.supportedRange;
  if (!range || !hasMoney(value) || !hasMoney(range.low) || !hasMoney(range.high)) return null;
  if (![value, range.low, range.high].every((money) => Number.isSafeInteger(money.amountMinorUnits) && money.currency === value.currency)) return null;
  if (range.low.amountMinorUnits > range.high.amountMinorUnits) return null;
  const subject = intakeMode === "manual" ? "The offer you entered" : "Your insurer’s original value";
  if (value.amountMinorUnits < range.low.amountMinorUnits) {
    const gap = amountLabel(range.low.amountMinorUnits - value.amountMinorUnits, value.currency);
    return gap ? `The lowest asking price in this comparison was ${moneyLabel(range.low)}—${gap} above ${intakeMode === "manual" ? "the offer you entered" : "your insurer’s value"}.` : `${subject} is below the asking-price range.`;
  }
  if (value.amountMinorUnits > range.high.amountMinorUnits) return `${subject} is above the asking-price range.`;
  return `${subject} is within the asking-price range.`;
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
  const { claim, report, view, intakeMode, caseId, userId } = props;
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const root = useRef<HTMLElement>(null);
  const [celebratingClosure, setCelebratingClosure] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);
  const [navigationActions, setNavigationActions] = useState<HTMLElement | null>(null);
  const navigationEpoch = useRef(0);
  const requestedStage = completedAnalysisStage(view, search, intakeMode);
  const sent = requestIsSent(claim);
  const sentRequest = initialSentRequest(claim, report.reportId);
  const journeyState = resolvedTotalLossClaimJourneyState(claim);
  const closed = caseIsClosed(claim);
  const showAcceptanceConfirmation = requestedStage === "resolution" && claim.resolution?.code === "ACCEPTED_VERIFIED_OFFER" && search.get("view") !== "record";
  const followUpSent = claim.followUp?.state === "sent";
  const continued = claim.insurerResponse?.decision?.choice === "CONTINUE_CHALLENGING";
  const selectedResponseId = search.get("response");
  const historicalResponse = selectedResponseId
    ? claim.negotiationHistory?.flatMap((round) => round.responses).find((response) => response.responseId === selectedResponseId)
    : null;
  const response = selectedResponseId ? historicalResponse : claim.insurerResponse;
  const historical = Boolean(selectedResponseId);
  const canCorrect = Boolean(response && !closed && !historical && (response.canCorrect ?? !followUpSent));
  const correction = search.get("correct") === "true" || (!claim.responseIntake && Boolean(claim.insurerResponse));
  const canRecordResponse = !closed && Boolean(claim.responseIntake);
  const waitingResponseSaved = Boolean(claim.insurerResponse && !canRecordResponse);
  const correctResponse = canCorrect ? () => navigate(`${totalLossClaimBasePath(caseId)}/review/response?correct=true`) : undefined;
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
  const showReceivedReviewProgress = stage === "response_received" && !closed && !historical &&
    search.get("view") !== "saved" &&
    (response?.processingState === "pending" || response?.processingState === "processing");
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
  const requestContinuation = useRequestContinuation(userId, caseId, report.reportId);
  const { pendingRequestId: pendingFollowUpVersion, waitForContinue: waitForFollowUpContinue, continueToReview: continueFromFollowUp } = useFollowUpContinuation(userId, caseId, claim.followUp?.decisionId ?? "none");
  const { pendingRequestId, waitForContinue: waitForResponseContinue, continueToReview } = useResponseContinuation(userId, caseId, report.reportId);
  const { pendingRequestId: pendingDecisionId, waitForContinue: waitForDecisionContinue, continueToReview: continueFromDecision } = useDecisionContinuation(userId, caseId, response?.responseId ?? "none");
  const viewedProgress = totalLossCaseJourneyProgress({
    continuingSupported: continuing,
    hasDraft,
    intakeMode,
    stage,
    hasFollowUp: Boolean(claim.followUp),
    followUpSent,
    isClosed: closed,
  });
  const waitingForContinue = stage === "request" && workspace.currentStage === "waiting" &&
    !followUpSent && Boolean(sentRequest && sentRequest.messageVersionId === requestContinuation.pendingVersion);
  const waitingForResponseContinue = stage === "waiting" && !closed && !canRecordResponse &&
    !claim.insurerResponse?.decision && ["response_reviewing", "response_reviewed"].includes(workspace.currentStage) &&
    Boolean(pendingRequestId && claim.insurerResponse?.clientRequestId === pendingRequestId);
  const waitingForDecisionContinue = stage === "response_reviewed" && !historical && !closed && !followUpSent &&
    Boolean(pendingDecisionId && response?.decision?.clientRequestId === pendingDecisionId);
  const waitingForFollowUpContinue = stage === "follow_up" && !closed && workspace.currentStage === "waiting" &&
    Boolean(pendingFollowUpVersion && claim.followUp?.sentMessage?.messageVersionId === pendingFollowUpVersion);
  const continuationStage = waitingForFollowUpContinue ? "follow_up" : waitingForContinue ? "request" : waitingForResponseContinue ? "waiting" : waitingForDecisionContinue ? "response_reviewed" : null;
  const navigationWorkspace = continuationStage ? {
    ...workspace,
    progress: viewedProgress,
    sections: workspace.sections.filter((section) => !waitingForDecisionContinue || !["follow_up", "resolution", "case_record"].includes(section.stage)).map((section) => ({
      ...section,
      current: section.stage === continuationStage,
      complete: waitingForFollowUpContinue && section.stage === "waiting" ? true : (!waitingForDecisionContinue && section.stage === continuationStage) || (waitingForResponseContinue && section.label === "Response review") ? false : section.complete,
    })),
  } : showAcceptanceConfirmation ? {
    ...workspace,
    progress: { ...workspace.progress, isCaseClosed: false, isCaseActive: true, current: { id: "finalize_case" as const, label: "Confirm acceptance" } },
    sections: workspace.sections.map((section) => ({ ...section, current: section.stage === "resolution", complete: section.stage === "case_record" ? false : section.complete })),
  } : workspace;
  useEffect(() => {
    if (waitingForFollowUpContinue) continueButton.current?.focus({ preventScroll: true });
  }, [waitingForFollowUpContinue]);
  useEffect(() => {
    if (pendingRequestId && !historical && ["response_received", "response_reviewing", "response_reviewed"].includes(stage)) continueToReview();
  }, [pendingRequestId, historical, stage, continueToReview]);
  useEffect(() => {
    if (pendingDecisionId && !historical && ["follow_up", "resolution"].includes(stage)) continueFromDecision();
  }, [pendingDecisionId, historical, stage, continueFromDecision]);
  const responsePath = responseStage === "response_reviewed"
    ? "response-reviewed"
    : responseStage === "response_reviewing"
      ? "response-reviewing"
      : responseStage === "response_received"
        ? "response-received"
        : "waiting";
  const previous = stage === "resolution" || stage === "result" || stage === "response_received" || stage === "response_reviewing" || stage === "response_reviewed" ? null : stage === "waiting" ? path(followUpSent ? "follow-up" : "request") : stage === "follow_up" ? path("response-reviewed") : stage === "insurer" ? path("result") : stage === "market" ? path(manual ? "result" : "insurer") : stage === "meaning" ? path("market") : stage === "response" ? path(responsePath) : path("meaning");
  const next = stage === "result" ? manual ? "market" : "insurer" : stage === "insurer" ? "market" : stage === "market" ? "meaning" : "request";
  const nextPath = stage === "meaning" && sent ? workspace.currentPath : path(next);
  const requestAction = sent ? "Case status" : hasDraft ? "Review my message" : "Prepare my message";
  const action = stage === "follow_up" ? "Track your insurer’s reply" : stage === "request" ? "See what happens next" : stage === "result" ? manual ? "See similar vehicles" : "See how your insurer calculated it" : stage === "insurer" ? "See the vehicles we found" : stage === "market" ? manual ? "Compare with your insurer’s offer" : "Compare with your insurer’s value" : requestAction;
  const addingResponse = stage === "waiting" && canRecordResponse && search.get("reply") === "add";
  const showResponseReviewAction = stage === "waiting" && waitingResponseSaved;
  const showContinueAction = (stage === "follow_up" && followUpSent && !closed) || (stage === "request" && sent) || (stage !== "resolution" && stage !== "request" && stage !== "follow_up" && stage !== "waiting" && stage !== "response" && stage !== "response_received" && stage !== "response_reviewing" && stage !== "response_reviewed" && (stage !== "meaning" || sent || (!closed && report.conclusion.continuingSupported)));
  const showReviewNavigation = Boolean(previous) || showContinueAction || showResponseReviewAction;
  const classification = reportText(report.conclusion.classificationLabel).replace(/^Potential undervaluation signal$/iu, "Potential undervaluation");
  const searchLimited = report.marketEvidence.marketSearchContext?.baselineStatus === "LIMITED";
  const inconclusiveResult = searchLimited || /insufficient evidence/iu.test(classification);
  const resultHeadline = report.conclusion.continuingSupported
    ? manual ? "Your insurer’s offer may be low" : "Your insurer’s value may be low"
    : inconclusiveResult
      ? "We couldn’t make a clear comparison"
      : /no material discrepancy/iu.test(classification)
        ? "We didn’t find clear support for a higher value"
        : "Your valuation review is ready";
  const resultExplanation = report.conclusion.continuingSupported
    ? `We found similar vehicles listed for higher prices. Our findings support asking your insurance company to review its ${manual ? "offer" : "value"}.`
    : inconclusiveResult
      ? "We didn’t find enough market information to support asking for a higher value. This does not mean your insurer’s value is correct."
      : /no material discrepancy/iu.test(classification)
        ? "The similar vehicles we found do not give us a clear reason to ask your insurance company for a higher value."
        : "We’ll walk you through what we found and what it means for your next step.";
  const primary = report.marketEvidence.primary;
  const secondary = report.marketEvidence.secondary;
  const primaryTiming = listingTiming(report.conclusion.supportedRange?.evidenceBasis, primary?.label);
  const secondaryTiming = listingTiming(null, secondary?.label);
  const primaryDate = dateLabel(primary?.evidenceDate ?? null);
  const secondaryDate = dateLabel(secondary?.evidenceDate ?? null);
  const hasMarketListings = report.marketEvidence.comparables.length > 0 || Boolean(primary?.selectedCount) || Boolean(secondary?.selectedCount);
  const marketRange = report.conclusion.supportedRange;
  const hasMarketRange = marketRange && hasMoney(marketRange.low) && hasMoney(marketRange.high) &&
    marketRange.low.currency === marketRange.high.currency && marketRange.low.amountMinorUnits <= marketRange.high.amountMinorUnits;
  const comparison = medianComparison(report);
  const position = rangePosition(report, intakeMode);
  const limitations = decisionLimitations(report);
  const disclosure = report.insurerEvidence.summary;
  const insurerCount = report.insurerEvidence.comparableCount;

  const showingResponseReview = showReceivedReviewProgress || stage === "response_reviewing" || stage === "response_reviewed";
  const motionStage = stage === "resolution" && closed && !showAcceptanceConfirmation ? "case_record" : showingResponseReview ? "response_review" : stage;
  useReviewStageMotion({ root, stage: motionStage, index: showingResponseReview || stage === "request" || stage === "follow_up" || stage === "resolution" ? 0 : viewedProgress.position, reportId: report.reportId });

  useEffect(() => {
    navigationEpoch.current += 1;
    return () => { navigationEpoch.current += 1; };
  }, [stage, hasDraft, location.key, report.reportId]);

  if (closed && (stage === "response" || stage === "waiting")) return <Navigate replace to={claim.resolution?.code === "NO_DISPUTE_SUPPORTED" ? path("result") : path("resolution")} />;
  if (stage === "resolution" && !closed && !currentAcceptedOffer(claim)) return <Navigate replace to={workspace.currentPath} />;
  if (stage === "waiting" && claim.insurerResponse?.decision?.choice === "ACCEPT_OFFER") {
    return <Navigate replace to={authoritativeTotalLossClaimPath(claim, intakeMode) ?? path("response-reviewed")} />;
  }
  if (stage === "waiting" && !sent) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("waiting") ? resume : path("result")} />;
  }
  if (stage === "response" && (!sent || (correction ? !canCorrect : !canRecordResponse))) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume ?? path("result")} />;
  }
  if (stage === "follow_up" && !continued) {
    return <Navigate replace to={authoritativeTotalLossClaimPath(claim, intakeMode) ?? path("result")} />;
  }
  if (stage === "response_received" && (
    !response || (!closed && !historical && search.get("view") !== "saved" && responseStage !== "response_received")
  )) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("response-received") ? resume : path("waiting")} />;
  }
  if (stage === "response_reviewing" && ((!closed && responseStage !== "response_reviewing") || !response)) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("response-reviewing") ? resume : path("waiting")} />;
  }
  if (
    stage === "response_reviewed" &&
    ((!closed && !historical && responseStage !== "response_reviewed") ||
      !response?.analysis ||
      response.processingState !== "completed")
  ) {
    const resume = authoritativeTotalLossClaimPath(claim, intakeMode);
    return <Navigate replace to={resume && resume !== path("response-reviewed") ? resume : path("waiting")} />;
  }
  if (stage === "request" && !continuing && !sent) {
    return <Navigate replace to={path("meaning")} />;
  }

  const continueReview = async () => {
    if (stage === "follow_up" && followUpSent) { continueFromFollowUp(); navigate(workspace.currentPath); return; }
    if (stage === "request" && sent) { requestContinuation.continueFromRequest(); navigate(workspace.currentPath); return; }
    if (stage === "request" || stage === "follow_up" || stage === "waiting" || stage === "response" || stage === "response_received" || stage === "response_reviewing" || stage === "response_reviewed" || stage === "resolution") return;
    if (closed || (stage === "meaning" && sent)) { navigate(nextPath); return; }
    const epoch = navigationEpoch.current;
    if (await progression.complete(stage) && epoch === navigationEpoch.current) navigate(nextPath);
  };

  return (
    <section className="completed-analysis" aria-label="Completed analysis" ref={root} tabIndex={-1} data-stage={stage}>
      {celebratingClosure ? <CaseClosureCelebration onEnd={setCelebratingClosure} /> : null}
      {search.get("close") === "case" ? <CaseClosureDialog {...props} onDismiss={() => { const next = new URLSearchParams(search); next.delete("close"); setSearch(next, { replace: true }); }} onClosed={() => navigate(path("resolution"), { replace: true })} /> : null}
      {claim.resolution && !showAcceptanceConfirmation && stage !== "resolution" ? <CaseResolutionBanner resolution={claim.resolution} /> : null}
      <CaseJourneyProgress progress={navigationWorkspace.progress} sections={navigationWorkspace.sections} />
      <CaseWorkspaceNavigation workspace={navigationWorkspace} stage={stage === "resolution" && closed && !showAcceptanceConfirmation ? "case_record" : stage === "response_received" ? workspace.sections.find((section) => section.label === "Response review")?.stage ?? "response_reviewing" : stage} pending={progression.pending} />
      <NegotiationHistoryDialog key={`${location.pathname}:${location.search}`} caseId={caseId} history={claim.negotiationHistory ?? []} userId={userId} vehicleDescription={displayed(report.subjectVehicle.description, "Your vehicle")} />
      {historical ? <p className="case-history-view-notice">You are viewing a saved response and its review. Your current case step has not changed.<br /><Link to={workspace.currentPath}>Current case step</Link></p> : null}
      <div className="review-stage-content" data-view={stage}>
      {stage !== "result" && stage !== "response" ? <p className="completed-workspace-eyebrow workspace-stage__eyebrow">{stage === "insurer" ? "Your insurer’s report" : stage === "market" ? "Venfour’s findings" : stage === "meaning" ? "Your next step" : stage === "request" ? "Your message" : stage === "follow_up" ? "Your follow-up" : stage === "waiting" || stage === "resolution" ? "Your case" : "Full valuation review"}</p> : null}
      {stage === "resolution" ? closed && !showAcceptanceConfirmation ? <CaseRecord {...props} /> : <AcceptedOfferFinalization key={claim.workflow?.revision} {...props} onClosed={() => { setCelebratingClosure(true); navigate(path("resolution"), { replace: true }); }} /> : null}
      {claim.journey?.fulfillmentState === "refund_pending" || claim.commerce?.entitlementStatus === "refunded_access_retained" ? (
        <p className="review-refund-status" role="status">{claim.commerce?.entitlementStatus === "refunded_access_retained" ? "Your payment was refunded. Your completed report remains available." : "Your refund is in progress. Your completed report remains available while it is processed."}</p>
      ) : null}
      {stage === "result" ? <>
        <div className="result-heading" data-review-entrance="secondary"><h1>Your result</h1><p className="review-vehicle">{displayed(report.subjectVehicle.description, "Your vehicle")}</p></div>
        <h2 className="result-conclusion" data-review-entrance="primary" data-review-order="1">{resultHeadline}</h2>
        <p className="review-lead" data-review-entrance="secondary" data-review-order="2">{resultExplanation}</p>
        {searchLimited ? <p className="review-note result-limitation" data-review-entrance="supporting">Our search for similar vehicles was limited. The next steps explain what we could and couldn’t check.</p> : null}
        <ResultValues {...props} />
        {manual ? <p className="review-note" data-review-entrance="supporting">You entered an offer without an insurer’s report, so we couldn’t check how your insurance company calculated it.</p> : null}
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
        <p className="result-next" data-review-entrance="supporting">{manual
          ? "Next, take a closer look at the similar vehicles we found."
          : "Next, we’ll walk through how your insurer calculated your vehicle’s value."}</p>
      </> : null}
      {stage === "insurer" ? <>
        <h1 data-review-entrance="primary">How your insurer valued your vehicle</h1>
        <p className="review-lead" data-review-entrance="primary" data-review-order="1">{insurerCount > 0
          ? "Your insurer’s report lists vehicles used for comparison. Changes for differences such as mileage, condition, or features can affect the final value."
          : "Insurance companies often compare vehicles and adjust their values for differences. We couldn’t find those vehicle comparisons in your report."}</p>
        <InsurerValueBridge report={report} />
        <section className="insurer-checks" aria-labelledby="insurer-checks-heading" data-review-entrance="supporting">
          <h2 id="insurer-checks-heading">What we could check</h2>
          <p>{insurerCount > 0 ? `Their report includes ${insurerCount.toLocaleString("en-US")} ${insurerCount === 1 ? "vehicle" : "vehicles"} for comparison.` : "The vehicle comparisons weren’t available for us to review."}</p>
          {insurerCount > 0 && disclosure.fullyDisclosedAdjustmentCount > 0 ? <p>{disclosure.fullyDisclosedAdjustmentCount === insurerCount
            ? insurerCount === 1 ? "The report includes the full adjustment details for this vehicle." : "The report includes the full adjustment details for all of these vehicles."
            : `The report includes the full adjustment details for ${disclosure.fullyDisclosedAdjustmentCount.toLocaleString("en-US")} of them.`}</p> : null}
          {insurerCount > 0 && disclosure.partiallyDisclosedAdjustmentCount > 0 ? <p>Some adjustment details were missing, so we couldn’t check every change.</p> : null}
          {insurerCount > 0 && disclosure.undisclosedAdjustmentCount > 0 ? <p>{insurerCount === 1 ? "The report didn’t include adjustment details for this vehicle." : "The report didn’t include adjustment details for some vehicles."}</p> : null}
          {insurerCount > 0 && disclosure.unavailableAdjustmentCount > 0 ? <p>{insurerCount === 1 ? "Adjustment details for this vehicle weren’t available for us to review." : "Adjustment details for some vehicles weren’t available for us to review."}</p> : null}
          {insurerCount > 0 && (disclosure.partiallyDisclosedAdjustmentCount > 0 || disclosure.undisclosedAdjustmentCount > 0 || disclosure.unavailableAdjustmentCount > 0) ? <p className="review-note">Missing details alone do not mean the calculation is wrong.</p> : null}
        </section>
        <InsurerEvidenceDetails report={report} open={search.get("details") === "insurer"} />
        <p className="insurer-next" data-review-entrance="supporting">Next, see the similar vehicles Venfour found.</p>
      </> : null}
      {stage === "market" ? <>
        <h1 data-review-entrance="primary">Similar vehicles we found</h1>
        <p className="review-lead" data-review-entrance="primary" data-review-order="1">{primary?.selectedCount
          ? `We used ${primary.selectedCount.toLocaleString("en-US")} similar ${primary.selectedCount === 1 ? "vehicle" : "vehicles"} for this comparison.`
          : report.marketEvidence.comparables.length ? "These vehicle listings provide context for your review." : "We couldn’t find enough similar vehicles for a clear price comparison."}</p>
        {hasMarketListings || hasMarketRange ? <div className="market-price-summary" data-review-entrance="secondary">
          <MarketPriceRange report={report} />
          <p className="review-note">These are asking prices, not confirmed sale prices.</p>
          {primary && primary.selectedCount > 0 ? <p className="market-price-timing">{primaryTiming === "current"
            ? `${primaryDate !== "Not stated" ? `Prices recorded on ${primaryDate}.` : "These are current-market listings."} They may differ from prices on your date of loss.`
            : primaryTiming === "historical"
              ? primary.evidenceDate && primary.evidenceDate === report.marketEvidence.evidenceDateContext.lossDate
                ? `Listed on your date of loss, ${primaryDate}.`
                : `${primaryDate !== "Not stated" ? `Listed on ${primaryDate}, the date used for this comparison.` : "These listings were verified as active on the date of loss."}`
              : "The listing details explain when each price was recorded."}</p> : null}
        </div> : null}
        <MarketSearchLimitations report={report} />
        {report.conclusion.limitations.some((value) => /out.of.provider.range/iu.test(value)) ? <p className="market-history-note review-note" data-review-entrance="supporting">Our data source had limited information about listings from the time of your loss. This does not mean no similar vehicles were available then.</p> : null}
        {secondary && secondary.selectedCount > 0 ? <p className="market-additional-context review-note" data-review-entrance="supporting">{`We also found ${secondary.selectedCount.toLocaleString("en-US")} ${secondaryTiming === "current" ? "current " : ""}${secondary.selectedCount === 1 ? "listing" : "listings"} for additional context${secondaryDate !== "Not stated" ? ` from ${secondaryDate}` : ""}. ${secondary.selectedCount === 1 ? "It is" : "They are"} not included in the price range above.`}{secondaryTiming === "current" ? " Current listings do not establish prices on your date of loss." : ""}</p> : null}
        <MarketEvidenceDetails report={report} open={search.get("details") === "market"} />
        <HigherPricedListings report={report} />
        <MethodologyDisclosure report={report} intakeMode={intakeMode} />
        <p className="market-next" data-review-entrance="supporting">Next, see how these prices compare with your insurer’s {manual ? "offer" : "value"}.</p>
      </> : null}
      {stage === "meaning" ? <>
        <h1 data-review-entrance="primary">What this means for you</h1>
        <div className="meaning-recommendation" data-review-entrance="primary" data-review-order="1">
          <h2>{report.conclusion.continuingSupported
            ? `You have a reason to ask your insurer to review its ${manual ? "offer" : "value"}.`
            : inconclusiveResult ? "We couldn’t make a clear comparison." : "We didn’t find clear support for a higher value."}</h2>
          <p>{report.conclusion.continuingSupported
            ? `The similar vehicles we found support taking another look at ${manual ? "the offer you entered" : "your vehicle’s value"}.`
            : inconclusiveResult ? "We didn’t find enough information to support asking for a higher value. This does not mean your insurer’s value is correct."
              : "The available listings do not give us a clear reason to ask your insurance company for a higher value."}</p>
        </div>
        <ResultValues {...props} explanation={position} />
        <div className="meaning-cautions" data-review-entrance="supporting">
          <p>{report.conclusion.continuingSupported ? "These asking prices support a conversation with your insurer. They do not guarantee a higher payment." : "This review does not establish that you are owed a higher payment. Your insurer may have additional information."}</p>
          {searchLimited ? <p>Our search for similar vehicles was limited. A limited search does not confirm that your insurer’s value is correct.</p> : null}
          {primaryTiming === "current" && hasMarketListings ? <p>{primaryDate !== "Not stated" ? `These prices were recorded on ${primaryDate}.` : "These are current-market asking prices."} They may differ from prices on your date of loss.</p> : null}
          {manual ? <p>You entered an offer without an insurer’s report, so we couldn’t check how your insurer calculated it.</p> : null}
          {limitations.length ? <ul>{limitations.map((value) => <li key={value}>{value}</li>)}</ul> : null}
        </div>
        <details className="completed-evidence meaning-details" data-review-entrance="supporting">
          <summary><span>More about this comparison</span><ChevronDown aria-hidden="true" size={19} strokeWidth={1.7} /></summary>
          <div className="completed-evidence__body">
            {hasMoney(report.conclusion.supportedRange?.median) ? <>
              <dl className="meaning-median"><dt>Middle asking price (median)</dt><dd>{moneyLabel(report.conclusion.supportedRange?.median)}</dd></dl>
              <p>The median is the middle price when asking prices are ordered from lowest to highest. With an even number of prices, it is the average of the two middle prices.</p>
            </> : null}
            {comparison ? <p>{manual ? "The offer you entered" : "Your insurer’s original value"} {comparison.startsWith("Matches") ? "matches the middle asking price" : `is ${comparison.replace("the selected median", "the middle asking price")}`}.</p> : null}
            <p>Your valuation report explains the comparison and its limitations in more detail.</p>
          </div>
        </details>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
        {!closed && report.conclusion.continuingSupported && !sent ? <p className="meaning-next" data-review-entrance="supporting">{hasDraft
          ? "Next, review your message explaining the findings. You can make changes and send it to your insurance company."
          : "Next, we’ll help you prepare a message explaining the findings. You can review it, make changes, and send it to your insurance company."}</p> : null}
        {sent && !closed ? <p className="meaning-next" data-review-entrance="supporting">You’ve already confirmed sending your message. Return to your case status to continue.</p> : null}
      </> : null}
      {stage === "request" ? (
        sent ? <SentRequest claim={claim} report={report}><ReportFileRow {...props} variant="attachment" /></SentRequest> : closed ? <>
          <h1>Your saved request</h1><p>This case is closed. This message was not confirmed as sent.</p>
          {claim.messageDraft ? <><h2>{claim.messageDraft.subject}</h2><p className="sent-request-body">{claim.messageDraft.body}</p></> : null}<ReportFileRow {...props} />
        </> : canPrepare && report.conclusion.continuingSupported ? <MessagePreparation {...props} onDraftStateChange={setHasDraft} onSentAttempt={requestContinuation.waitForContinue} /> : <>
          <h1 data-review-entrance="primary">Prepare your message</h1>
          {report.conclusion.continuingSupported ? <p data-review-entrance="secondary">Finish reviewing the result and comparison before creating your message.</p> : <p data-review-entrance="secondary">The result does not support a higher valuation request. Your report remains available.</p>}
          <ReportFileRow {...props} />
        </>
      ) : null}
      {stage === "follow_up" ? closed ? <>
        {claim.followUp?.sentMessage ? <SentFollowUp followUp={claim.followUp} /> : <><h1>Your saved follow-up</h1><p>This case is closed. This message was not confirmed as sent.</p>{claim.followUp?.draft ? <><h2>{claim.followUp.draft.subject}</h2><p className="sent-request-body">{claim.followUp.draft.body}</p></> : null}</>}
        <ReportFileRow {...props} />
      </> : <FollowUpPreparation key={claim.insurerResponse?.responseId} {...props} onSentAttempt={waitForFollowUpContinue} /> : null}
      {stage === "waiting" ? <>
        <header className="waiting-heading" data-review-entrance="primary">
          <h1>Waiting for insurer</h1>
          <p className="review-lead" role="status">{waitingResponseSaved
            ? "You’ve added your insurer’s response. It’s saved with your case."
            : addingResponse ? "Add the reply you received so we can help you understand it."
            : `You marked your ${followUpSent ? "follow-up" : "message"} as sent. Come back here when your insurer replies.`}</p>
        </header>
        <div className="message-flow waiting-flow" role="list" aria-label="Response steps" data-review-entrance="supporting">
          <section className="message-flow-step" role="listitem" data-state={waitingResponseSaved || addingResponse ? "complete" : "active"} aria-current={!waitingResponseSaved && !addingResponse ? "step" : undefined}>
            <MessageStepHeading number={1} title="Wait for a reply" state={waitingResponseSaved || addingResponse ? "complete" : "active"} description={waitingResponseSaved || addingResponse ? "You’ve received a response from your insurer." : "Check your inbox for your insurer’s response."} />
            {!waitingResponseSaved && !addingResponse ? <div className="message-flow-content">
              <p className="waiting-guidance">You can leave this page and come back when you receive a reply. Your message and report will stay here.</p>
              <p className="waiting-note">Venfour doesn’t monitor your inbox or confirm email delivery.</p>
              <details className="waiting-report">
                <summary>Your valuation report <ChevronDown aria-hidden="true" size={16} /></summary>
                <ReportFileRow {...props} variant="attachment" />
              </details>
              {canRecordResponse ? <div className="message-local-actions">
                <button className="request-button request-button-primary" type="button" onClick={() => navigate(`${path("waiting")}?reply=add`, { replace: true, preventScrollReset: true })}>I received a response <ArrowRight aria-hidden="true" /></button>
              </div> : null}
            </div> : null}
          </section>
          <section className="message-flow-step" role="listitem" data-state={waitingResponseSaved ? "complete" : addingResponse ? "active" : "upcoming"} aria-current={addingResponse ? "step" : undefined}>
            <MessageStepHeading number={2} title="Add the insurer’s response" state={waitingResponseSaved ? "complete" : addingResponse ? "active" : "upcoming"} description={waitingResponseSaved ? undefined : "Add the insurer’s response here so we can help you understand it."} />
            {addingResponse ? <div className="message-flow-content">
              <InsurerResponseForm {...props} inline actionContainer={null} onRecordAttempt={waitForResponseContinue} />
            </div> : null}
            {waitingResponseSaved && claim.insurerResponse ? <div className="message-flow-content waiting-saved-response">
              <p role="status"><strong>Response saved</strong><br />Added <RecordedTime value={claim.insurerResponse.receivedAt} />. You can view it and make corrections in Response review.</p>
            </div> : null}
          </section>
        </div>
      </> : null}
      {stage === "response" ? <InsurerResponseForm {...props} correction={correction ? claim.insurerResponse : null} actionContainer={navigationActions} onRecorded={(state) => navigate(routeForJourneyState(caseId, state), { replace: true })} /> : null}
      {stage === "response_received" && response ? <>
        <InsurerResponseReceived {...props} response={response} onCorrect={correctResponse} showReviewProgress={showReceivedReviewProgress} />
        {!showReceivedReviewProgress ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "response_reviewing" && claim.insurerResponse ?
        <InsurerResponseReviewing {...props} response={claim.insurerResponse} onCorrect={correctResponse} readOnly={closed} />
      : null}
      {stage === "response_reviewed" && response?.analysis && response.analysisEvidence ?
        <InsurerResponseReviewed
          {...props}
          onCorrect={correctResponse}
          onDecisionAttempt={waitForDecisionContinue}
          onContinue={continueFromDecision}
          readOnly={historical || closed}
          originalInsurerValue={report.conclusion.insurerValuation}
          originalInsurerValueLabel={manual ? "Original insurer offer" : "Original insurer valuation"}
          response={{
            ...response,
            analysis: response.analysis,
            analysisEvidence: response.analysisEvidence,
          }}
        />
      : null}
        {prerequisite ? <p className="review-prerequisite"><Link to={path(prerequisite)}>Continue your review</Link> before proceeding from this stage.</p> : null}
        {progression.error ? <p className="review-error" role="alert">{progression.error}</p> : null}
        {showReviewNavigation ? <nav className="review-actions" aria-label="Review navigation" ref={setNavigationActions}>
          {previous ? <Link aria-disabled={progression.pending || undefined} className="review-back" data-review-entrance="supporting" data-review-order="0" to={previous} onClick={(event) => {
            if (progression.pending) event.preventDefault();
          }}><ArrowLeft aria-hidden="true" />{stage === "request" ? "Back to comparison" : stage === "waiting" ? followUpSent ? "View my follow-up" : "View my message" : "Back"}</Link> : null}
          {showContinueAction ? <button ref={continueButton} className="review-primary" data-review-entrance="secondary" data-review-order="1" type="button" disabled={progression.pending || Boolean(prerequisite)} onClick={() => void continueReview()}><span className="review-action-label"><span className="review-action-reserve" aria-hidden="true">{action}</span><span>{progression.pending ? "Saving progress…" : action}</span></span><span className="review-action-icon">{progression.pending ? <LoaderCircle className="review-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</span></button> : null}
          {showResponseReviewAction ? <button className="review-primary" type="button" onClick={() => { continueToReview(); navigate(path(responsePath)); }}>View response review <span className="review-action-icon"><ArrowRight aria-hidden="true" /></span></button> : null}
        </nav> : null}
        {!historical && !closed && stage !== "resolution" && stage === workspace.sections.at(-1)?.stage ? <ManualCaseClosure key={`${stage}:${claim.workflow?.revision}`} {...props} onClosed={() => navigate(path("resolution"), { replace: true })} /> : null}
      </div>
    </section>
  );
}
