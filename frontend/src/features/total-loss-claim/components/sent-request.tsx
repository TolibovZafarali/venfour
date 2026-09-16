import { ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";

import type {
  TotalLossClaimSecured,
  TotalLossPublishedReport,
} from "../contracts";
import { initialSentRequest } from "../request-state";
import { RecordedTime } from "./completed-analysis-visuals";
import { MessageStepHeading } from "./message-step-heading";
import "./sent-request.css";

export interface SentRequestProps {
  readonly claim: TotalLossClaimSecured;
  readonly report: Pick<TotalLossPublishedReport, "reportId">;
  readonly children?: ReactNode;
}

export function SentRequest({ claim, report, children }: SentRequestProps) {
  const headingId = useId();
  const message = initialSentRequest(claim, report.reportId);

  return (
    <section className="sent-request" aria-labelledby={headingId}>
      <header className="request-heading" data-review-entrance="primary">
        <h1 id={headingId}>{message ? "Prepare your message" : "Your saved request"}</h1>
        <p>{message ? "Review the details and message here, then send it from your email app." : "This message was not confirmed as sent for this report."}</p>
      </header>
      {message ? (
        <div className="message-flow" role="list" aria-label="Message steps" data-review-entrance="supporting">
          <section className="message-flow-step" role="listitem" data-state="complete">
            <MessageStepHeading number={1} title="Check your details" state="complete" description={message.recipient} />
          </section>
          <section className="message-flow-step" role="listitem" data-state="complete">
            <MessageStepHeading number={2} title="Review your message" state="complete" description={message.subject} />
            <details className="message-sent-copy">
              <summary>View your sent message <ChevronDown aria-hidden="true" size={16} /></summary>
              <p className="sent-request-body" aria-label="Request message">{message.body}</p>
            </details>
          </section>
          <section className="message-flow-step" role="listitem" data-state="complete">
            <MessageStepHeading number={3} title="Send with your report" state="complete" />
            <div className="message-flow-content">
              <p className="message-send-instructions" role="status">You marked your message as sent. Keep a copy of your email and the attached report.</p>
              <p className="sent-request-recorded">Sent · Recorded <RecordedTime value={message.customerReportedSentAt} /> · Version {message.versionNumber}</p>
              {children}
            </div>
          </section>
        </div>
      ) : (
        <p className="review-note" data-review-entrance="secondary">
          The saved request details are unavailable for this report. Refer to your sent email for the original message.
        </p>
      )}
      {!message ? children : null}
    </section>
  );
}
