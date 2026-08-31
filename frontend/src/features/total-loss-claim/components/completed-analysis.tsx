import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import type { TotalLossClaimSecured, TotalLossPriceSummary, TotalLossPublishedReport } from "../contracts";
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

function ValueSummary({ report, intakeMode, marketOnly = false }: {
  readonly report: TotalLossPublishedReport;
  readonly intakeMode: TotalLossIntakeMode;
  readonly marketOnly?: boolean;
}) {
  const range = report.conclusion.supportedRange;
  return (
    <dl>
      {!marketOnly ? <><dt>{intakeMode === "manual" ? "Insurer offer you entered" : "Insurer valuation"}</dt><dd>{moneyLabel(report.conclusion.insurerValuation)}</dd></> : null}
      <dt>Selected advertised-price range</dt>
      <dd>{range ? `${moneyLabel(range.low)} to ${moneyLabel(range.high)}` : "No selected range provided"}</dd>
      <dt>Selected median</dt><dd>{moneyLabel(range?.median)}</dd>
      {!marketOnly && report.conclusion.indicatedDifference?.amountMinorUnits != null ? <>
        <dt>Stored difference from the insurer valuation</dt><dd>{moneyLabel(report.conclusion.indicatedDifference)}</dd>
      </> : null}
    </dl>
  );
}

function PriceSummary({ label, summary }: { readonly label: string; readonly summary: TotalLossPriceSummary | null }) {
  if (!summary || summary.count === 0) return <p>{label}: no values were provided.</p>;
  return <dl>
    <dt>{label}</dt><dd>{moneyLabel(summary.low)} to {moneyLabel(summary.high)}</dd>
    <dt>{label} median</dt><dd>{moneyLabel(summary.median)}</dd>
  </dl>;
}

function rangePosition(report: TotalLossPublishedReport) {
  const value = report.conclusion.insurerValuation;
  const range = report.conclusion.supportedRange;
  if (!range || value.amountMinorUnits === null || range.low.amountMinorUnits === null || range.high.amountMinorUnits === null) return null;
  if (![value, range.low, range.high].every((money) => Number.isSafeInteger(money.amountMinorUnits) && money.currency === value.currency)) return null;
  if (range.low.amountMinorUnits > range.high.amountMinorUnits) return null;
  if (value.amountMinorUnits < range.low.amountMinorUnits) return "The insurer valuation is below the selected advertised-price range.";
  if (value.amountMinorUnits > range.high.amountMinorUnits) return "The insurer valuation is above the selected advertised-price range.";
  return "The insurer valuation is within the selected advertised-price range.";
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

  useEffect(() => {
    navigationEpoch.current += 1;
    root.current?.focus({ preventScroll: true });
    root.current?.scrollIntoView?.({ block: "start" });
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
    if (await progression.complete(stage) && epoch === navigationEpoch.current) navigate(path(next));
  };

  return (
    <section className="completed-analysis" aria-label="Completed analysis" ref={root} tabIndex={-1} data-stage={stage}>
      {stage !== "sent" ? <p aria-label="Review progress">Step {index} of {total}</p> : null}
      {claim.journey?.fulfillmentState === "refund_pending" || claim.commerce?.entitlementStatus === "refunded_access_retained" ? (
        <p role="status">{claim.commerce?.entitlementStatus === "refunded_access_retained" ? "Refunded" : "Refund in progress"}. Your completed report remains available.</p>
      ) : null}
      {stage === "result" ? <>
        <h1>Your result</h1>
        <p>{displayed(report.subjectVehicle.description, "Your vehicle")}</p>
        <h2>{reportText(report.conclusion.classificationLabel)}</h2>
        <p>{reportText(report.conclusion.summary)}</p>
        <ValueSummary {...props} />
        {manual ? <p>Because you did not provide the insurer’s valuation report, this analysis does not review the insurer’s comparable vehicles or adjustments.</p> : null}
        <p>Advertised listings are supporting market evidence, not guaranteed sale prices or settlement values.</p>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "insurer" ? <>
        <h1>How your insurer reached its value</h1>
        <p>Insurers may start with comparable vehicles and apply adjustments. Here is what was disclosed in the report provided for this review.</p>
        <dl><dt>Insurer valuation</dt><dd>{moneyLabel(report.conclusion.insurerValuation)}</dd></dl>
        <p>{report.insurerEvidence.comparableCount.toLocaleString("en-US")} insurer comparable rows are available in the reviewed evidence.</p>
        <PriceSummary label="Advertised comparable values" summary={report.insurerEvidence.summary.advertisedPrices} />
        <PriceSummary label="Adjusted comparable values" summary={report.insurerEvidence.summary.adjustedValues} />
        <p>Detailed adjustment information was disclosed for {report.insurerEvidence.summary.fullyDisclosedAdjustmentCount.toLocaleString("en-US")} comparables; {report.insurerEvidence.summary.partiallyDisclosedAdjustmentCount.toLocaleString("en-US")} had partial disclosure.</p>
        <p>For {report.insurerEvidence.summary.undisclosedAdjustmentCount.toLocaleString("en-US")} comparables, adjustments were not disclosed. Adjustment information was not provided for {report.insurerEvidence.summary.unavailableAdjustmentCount.toLocaleString("en-US")}.</p>
        <p>Missing details limit what can be explained. They do not, by themselves, show that the valuation or an adjustment was wrong.</p>
        <InsurerEvidenceDetails report={report} open={search.get("details") === "insurer"} />
      </> : null}
      {stage === "market" ? <>
        <h1>What the market evidence showed</h1>
        <p>The completed review includes {report.marketEvidence.comparables.length.toLocaleString("en-US")} selected market listings.</p>
        <ValueSummary {...props} marketOnly />
        {report.conclusion.supportedRange?.evidenceBasis ? <p>{reportText(report.conclusion.supportedRange.evidenceBasis)}</p> : null}
        {(["primary", "secondary"] as const).map((role) => {
          const group = report.marketEvidence[role];
          return group ? <div key={role}>
            <h2>{role === "primary" ? "Evidence used for the comparison" : "Additional market context"}</h2>
            {group.label ? <p>{reportText(group.label)}</p> : null}
            <p>{group.selectedCount.toLocaleString("en-US")} selected listings{group.evidenceDate ? ` · Evidence date: ${dateLabel(group.evidenceDate)}` : ""}</p>
            {group.description ? <p>{reportText(group.description)}</p> : null}
          </div> : null;
        })}
        <p>Advertised prices are not completed-sale prices. Current listings describe the market when collected and are not automatically observations from the date of loss.</p>
        <MarketEvidenceDetails report={report} open={search.get("details") === "market"} />
        <MethodologyDisclosure report={report} intakeMode={intakeMode} />
      </> : null}
      {stage === "meaning" ? <>
        <h1>What the comparison means</h1>
        <ValueSummary {...props} />
        {rangePosition(report) ? <p>{rangePosition(report)}</p> : null}
        <h2>{reportText(report.conclusion.classificationLabel)}</h2>
        <p>{reportText(report.conclusion.summary)}</p>
        {report.conclusion.continuingSupported ? <p>The available evidence gives you a reasonable basis to ask the insurer to review its valuation. It does not establish a legally owed amount or guarantee an increase.</p> : <p>The completed result does not support a higher valuation request. Your evidence package remains available.</p>}
        {manual ? <p>Without the insurer’s valuation report, Venfour cannot review which comparable vehicles or adjustments the insurer used.</p> : null}
        {report.conclusion.limitations.length ? <>
          <h2>Limitations to keep in mind</h2>
          <ul>{report.conclusion.limitations.slice(0, 2).map((value, index) => <li key={index}>{reportText(value)}</li>)}</ul>
        </> : null}
        <p>The evidence package records the full limitations. If you request reconsideration, you will attach it and ask for a written response.</p>
        {!report.conclusion.continuingSupported ? <ReportFileRow {...props} /> : null}
      </> : null}
      {stage === "request" ? (
        canPrepare && report.conclusion.continuingSupported ? <MessagePreparation {...props} onDraftStateChange={setHasDraft} onSent={() => navigate(path("sent"), { replace: true })} /> : <>
          <h1>Prepare your request</h1>
          {report.conclusion.continuingSupported ? <p>Finish reviewing the result and comparison before creating your request.</p> : <p>The completed result does not support a higher valuation request. Your report remains available.</p>}
          <ReportFileRow {...props} />
        </>
      ) : null}
      {stage === "sent" ? <>
        <h1>Waiting for the insurer’s response</h1>
        <p role="status">You reported sending your reconsideration request with the evidence package attached.</p>
        {claim.education?.reportVersionId === report.reportId && claim.education.steps.send.completedAt ? <p>Recorded: <time dateTime={claim.education.steps.send.completedAt}>{claim.education.steps.send.completedAt}</time></p> : null}
        <p>Venfour cannot verify email delivery or receipt. The next step is waiting for the insurer’s response.</p>
        <p>Keep your sent email, attached package, and the insurer’s written reply. The insurer may revise its valuation, maintain it with an explanation, or ask for more information.</p>
        <ReportFileRow {...props} />
      </> : null}
      {prerequisite ? <p><Link to={path(prerequisite)}>Continue your review</Link> before proceeding from this stage.</p> : null}
      {progression.error ? <p role="alert">{progression.error}</p> : null}
      <nav aria-label="Review navigation">
        <Link to={previous} onClick={(event) => { if (progression.pending) event.preventDefault(); }}>Back</Link>
        {stage !== "request" && stage !== "sent" && (stage !== "meaning" || report.conclusion.continuingSupported) ? <button type="button" disabled={progression.pending || Boolean(prerequisite)} onClick={() => void continueReview()}>{progression.pending ? "Saving progress…" : action}</button> : null}
      </nav>
    </section>
  );
}
