import { useId } from "react";

import type {
  TotalLossClaimSecured,
  TotalLossPublishedReport,
} from "../contracts";
import { requestIsSent } from "../request-state";
import { RecordedTime } from "./completed-analysis-visuals";
import "./sent-request.css";

export interface SentRequestProps {
  readonly claim: TotalLossClaimSecured;
  readonly report: Pick<TotalLossPublishedReport, "reportId">;
}

export function SentRequest({ claim, report }: SentRequestProps) {
  const headingId = useId();
  const sent = requestIsSent(claim);
  const draft = sent && claim.messageDraft?.reportVersionId === report.reportId
    ? claim.messageDraft
    : null;
  const recordedAt = sent && claim.education?.reportVersionId === report.reportId
    ? claim.education.steps.send.completedAt
    : null;

  return (
    <section className="sent-request" aria-labelledby={headingId}>
      <header className="request-heading" data-review-entrance="primary">
        <h1 id={headingId}>Your sent request</h1>
        <p>The request you marked as sent to your insurer.</p>
      </header>
      {recordedAt ? (
        <p className="sent-request-recorded" data-review-entrance="supporting">
          Recorded <RecordedTime value={recordedAt} />
        </p>
      ) : null}
      {draft ? (
        <div className="sent-request-content" data-review-entrance="secondary">
          <dl className="sent-request-details">
            <div><dt>To</dt><dd>{draft.recipient ?? "Recipient unavailable"}</dd></div>
            <div><dt>Subject</dt><dd>{draft.subject}</dd></div>
          </dl>
          <p className="sent-request-body" aria-label="Request message">{draft.body}</p>
        </div>
      ) : (
        <p className="review-note" data-review-entrance="secondary">
          The saved request details are unavailable for this report. Refer to your sent email for the original message.
        </p>
      )}
    </section>
  );
}
