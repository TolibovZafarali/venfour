import { Check } from "lucide-react";
import type { TotalLossClaimSecured, TotalLossPublishedReport } from "../contracts";
import { insurerOfferProvenanceLabel, resolutionAmount, resolutionOutcome } from "../resolution";
import { RecordedTime } from "./completed-analysis-visuals";
import { NegotiationHistory } from "./negotiation-history";
import { ReportFileRow } from "./published-report-actions";
import "./case-record.css";

export function CaseRecord(props: {
  readonly claim: TotalLossClaimSecured;
  readonly report: TotalLossPublishedReport;
  readonly accessToken: string;
  readonly caseId: string;
  readonly userId: string;
}) {
  const resolution = props.claim.resolution;
  const accepted = resolution?.code === "ACCEPTED_VERIFIED_OFFER";
  const amount = resolution && ["ACCEPTED_VERIFIED_OFFER", "RESOLVED_WITH_INSURER"].includes(resolution.code) && resolution.amountMinorUnits !== null && resolution.currency
    ? resolutionAmount(resolution.amountMinorUnits, resolution.currency) : null;
  const source = resolution?.amountSource;
  const provenance = source === "CUSTOMER_RECORDED" || source === "RESPONSE_TEXT" ? insurerOfferProvenanceLabel(source) : null;
  const history = props.claim.negotiationHistory ?? [];
  return <section className="case-record" aria-label="Saved case record">
    <header className="request-heading case-record-heading" data-review-entrance="primary">
      <div><h1>Your case record</h1><span className="case-record-closed"><Check aria-hidden="true" size={14} />Closed</span></div>
      <p>Your case is closed. Your documents and history remain available.</p>
    </header>
    <section className="case-record-outcome" aria-labelledby="case-record-outcome-heading" data-review-entrance="secondary">
      <h2 id="case-record-outcome-heading">Your outcome</h2>
      <p className="case-record-outcome-title">{accepted ? "Offer accepted" : resolution ? resolutionOutcome(resolution.code) : "Case closed"}</p>
      {amount ? <p className="case-record-amount">{amount}<span>{resolution!.currency}</span></p> : null}
      {accepted ? <>
        {provenance ? <p className="case-record-source">{provenance}</p> : null}
        <p className="case-record-source">{resolution?.customerConfirmed ? "Acceptance confirmed by you" : "Acceptance recorded with your case"}</p>
      </> : resolution?.code === "CUSTOMER_STOPPED_PURSUING" ? <p className="case-record-source">You confirmed that you are no longer pursuing this case. This does not record a settlement with your insurer.</p>
        : resolution?.code === "NO_DISPUTE_SUPPORTED" ? <p className="case-record-source">The completed review did not support a valuation dispute. This does not record an accepted offer.</p>
        : resolution ? <p className="case-record-source">{amount ? "Final amount reported by you" : "Outcome confirmed by you. No final amount was recorded."}</p> : null}
      {resolution ? <p className="case-record-date">Closed <RecordedTime value={resolution.resolvedAt} /></p> : null}
    </section>
    <section className="case-record-section" aria-labelledby="case-record-documents-heading" data-review-entrance="supporting">
      <h2 id="case-record-documents-heading">Your documents</h2>
      <ReportFileRow {...props} variant="record" />
    </section>
    <section className="case-record-section" aria-labelledby="case-record-history-heading" data-review-entrance="supporting">
      <h2 id="case-record-history-heading">Your case history</h2>
      <p className="case-record-section-note">{history.length ? "Open an item to read the saved message or review." : "No messages or insurer responses were recorded in this case."}</p>
      <NegotiationHistory caseId={props.caseId} userId={props.userId} history={history} expandResponses />
    </section>

  </section>;
}
