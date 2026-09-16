import { ChevronDown } from "lucide-react";
import type { TotalLossFollowUp } from "../contracts";
import { RecordedTime } from "./completed-analysis-visuals";
import { MessageStepHeading } from "./message-step-heading";

export function FollowUpHeading() {
  return <header className="request-heading" data-review-entrance="primary">
    <h1>Prepare your follow-up</h1>
    <p>Ask your insurer about the points still unanswered. Review your message, then send it from your email app.</p>
  </header>;
}

export function SentFollowUp({ followUp }: { readonly followUp: TotalLossFollowUp }) {
  const message = followUp.sentMessage;
  if (!message) return null;
  return (
    <section className="sent-request" aria-label="Sent follow-up">
      <FollowUpHeading />
      <div className="message-flow" role="list" aria-label="Follow-up steps">
        <section className="message-flow-step" role="listitem" data-state="complete">
          <MessageStepHeading number={1} title="Create your follow-up" state="complete" description="Your draft is ready to review." />
        </section>
        <section className="message-flow-step" role="listitem" data-state="complete">
          <MessageStepHeading number={2} title="Review and send your message" state="complete" description={message.subject} />
          <details className="message-sent-copy">
            <summary>View your sent message <ChevronDown aria-hidden="true" size={16} /></summary>
            <dl className="sent-request-details"><div><dt>To</dt><dd>{message.recipient}</dd></div></dl>
            <p className="sent-request-body" aria-label="Follow-up message">{message.body}</p>
          </details>
        </section>
        <section className="message-flow-step" role="listitem" data-state="complete">
          <MessageStepHeading number={3} title="Mark as sent" state="complete" />
          <div className="message-flow-content">
            <p className="message-send-instructions" role="status">You marked your follow-up as sent. Keep a copy of your email and the attached report.</p>
            <p className="sent-request-recorded">Sent · Recorded <RecordedTime value={message.customerReportedSentAt} /> · Version {message.versionNumber}</p>
            <p className="request-attachment-note">Venfour cannot verify email delivery or receipt.</p>
          </div>
        </section>
      </div>
    </section>
  );
}

