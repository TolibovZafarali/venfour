import { useId } from "react";

import type {
  TotalLossClaimSecured,
  TotalLossPublishedReport,
} from "../contracts";
import { initialSentRequest } from "../request-state";
import { RecordedTime } from "./completed-analysis-visuals";
import "./sent-request.css";

export interface SentRequestProps {
  readonly claim: TotalLossClaimSecured;
  readonly report: Pick<TotalLossPublishedReport, "reportId">;
}

export function SentRequest({ claim, report }: SentRequestProps) {
  const headingId = useId();
  const message = initialSentRequest(claim, report.reportId);

  return (
    <section className="sent-request" aria-labelledby={headingId}>
      <header className="request-heading" data-review-entrance="primary">
        <h1 id={headingId}>{message ? "Your sent request" : "Your saved request"}</h1>
        <p>{message ? "The request you marked as sent to your insurer." : "This message was not confirmed as sent for this report."}</p>
      </header>
      {message ? (
        <p className="sent-request-recorded" data-review-entrance="supporting">
          Sent · Recorded <RecordedTime value={message.customerReportedSentAt} /> · Version {message.versionNumber}
        </p>
      ) : null}
      {message ? (
        <div className="sent-request-content" data-review-entrance="secondary">
          <dl className="sent-request-details">
            <div><dt>To</dt><dd>{message.recipient}</dd></div>
            <div><dt>Subject</dt><dd>{message.subject}</dd></div>
          </dl>
          <p className="sent-request-body" aria-label="Request message">{message.body}</p>
        </div>
      ) : (
        <p className="review-note" data-review-entrance="secondary">
          The saved request details are unavailable for this report. Refer to your sent email for the original message.
        </p>
      )}
    </section>
  );
}
