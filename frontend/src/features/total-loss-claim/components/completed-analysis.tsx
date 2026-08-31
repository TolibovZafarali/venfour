import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { TotalLossClaimSecured, TotalLossPublishedReport } from "../contracts";
import { moneyLabel, reportText } from "../report-format";
import { requestIsSent } from "../request-state";
import { completedAnalysisSection, type TotalLossClaimWorkflowView } from "../workflow-route";
import { CaseEvidence } from "./case-evidence";
import { MessagePreparation } from "./message-preparation";
import { ReportFileRow } from "./published-report-actions";
import "./completed-analysis.css";

interface CompletedAnalysisProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly view: TotalLossClaimWorkflowView;
}

export function CompletedAnalysis(props: CompletedAnalysisProps) {
  const { claim, report, view } = props;
  const [search] = useSearchParams();
  const root = useRef<HTMLElement>(null);
  const section = completedAnalysisSection(view, search);
  // Opening the editor can normalize and autosave a legacy draft.
  const [requestActivated, setRequestActivated] = useState(false);
  const sent = requestIsSent(claim);
  const range = report.conclusion.supportedRange;
  const sentAt = claim.education?.steps.send.completedAt;

  useEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(`#${section}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [section, view]);

  return (
    <section className="completed-analysis" aria-label="Completed analysis" ref={root}>
      <h1>Completed analysis</h1>
      <p>Temporary view of the saved result, evidence, and request actions.</p>
      <p>{report.subjectVehicle.description ?? "Your vehicle"}</p>
      {claim.journey?.fulfillmentState === "refund_pending" ||
      claim.commerce?.entitlementStatus === "refunded_access_retained" ? (
        <p role="status">
          {claim.commerce?.entitlementStatus === "refunded_access_retained" ? "Refunded" : "Refund in progress"}.
          {" "}Your completed report remains available.
        </p>
      ) : null}
      <section id="result" tabIndex={-1}>
        <h2>Result data</h2>
        <p>{reportText(report.conclusion.classificationLabel)}</p>
        <p>{reportText(report.conclusion.summary)}</p>
        <dl>
          <dt>Insurer valuation</dt>
          <dd>{moneyLabel(report.conclusion.insurerValuation)}</dd>
          <dt>Selected range low</dt>
          <dd>{moneyLabel(range?.low)}</dd>
          <dt>Selected listing median</dt>
          <dd>{moneyLabel(range?.median)}</dd>
          <dt>Selected range high</dt>
          <dd>{moneyLabel(range?.high)}</dd>
          <dt>Indicated difference</dt>
          <dd>{moneyLabel(report.conclusion.indicatedDifference)}</dd>
          <dt>Evidence basis</dt>
          <dd>{range?.evidenceBasis ? reportText(range.evidenceBasis) : "Not stated"}</dd>
        </dl>
      </section>
      <CaseEvidence report={report} />
      <section id="report" tabIndex={-1}>
        <h2>Published report</h2>
        <ReportFileRow {...props} />
      </section>
      <section id="sent" tabIndex={-1}>
        <h2>Request status</h2>
        <p>{sent ? "Request marked as sent" : "Request has not been marked as sent."}</p>
        {sentAt && sent ? <p>Recorded: <time dateTime={sentAt}>{sentAt}</time></p> : null}
        <p>Venfour cannot verify email delivery or receipt.</p>
      </section>
      <section id="request" tabIndex={-1}>
        {report.conclusion.continuingSupported || sent ? (
          <details
            open={section === "request" || undefined}
            onToggle={(event) => {
              if (event.currentTarget.open) setRequestActivated(true);
            }}
          >
            <summary>Request details and email</summary>
            {requestActivated || section === "request" ? (
              <MessagePreparation {...props} />
            ) : null}
          </details>
        ) : (
          <>
            <h2>Request preparation</h2>
            <p>The completed evidence does not support a higher valuation request. Your report remains available.</p>
          </>
        )}
      </section>
    </section>
  );
}
