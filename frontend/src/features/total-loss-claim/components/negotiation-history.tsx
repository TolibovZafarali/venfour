import { Link } from "react-router";

import type { TotalLossNegotiationHistoryRound, TotalLossSentCommunication } from "../contracts";
import { totalLossClaimViewPath } from "../workflow-route";
import { RecordedTime } from "./completed-analysis-visuals";
import "./negotiation-history.css";

function SentHistoryMessage({ message, label }: {
  readonly message: TotalLossSentCommunication;
  readonly label: string;
}) {
  return <details className="case-history-message">
    <summary>{label} <span>Sent <RecordedTime value={message.customerReportedSentAt} /> · Version {message.versionNumber}</span></summary>
    <dl className="sent-request-details">
      <div><dt>To</dt><dd>{message.recipient}</dd></div>
      <div><dt>Subject</dt><dd>{message.subject}</dd></div>
    </dl>
    <p className="sent-request-body">{message.body}</p>
  </details>;
}

export function NegotiationHistory({ caseId, history }: {
  readonly caseId: string;
  readonly history: readonly TotalLossNegotiationHistoryRound[];
}) {
  if (!history.length) return null;
  const sentIds = new Set<string>();
  return <details className="case-history">
    <summary>Case history <span>Your saved requests, responses, reviews, and decisions</span></summary>
    <ol>
      {history.map((round) => {
        const showOutbound = !sentIds.has(round.outbound.communicationId);
        sentIds.add(round.outbound.communicationId);
        if (round.followUp) sentIds.add(round.followUp.communicationId);
        return <li key={round.negotiationRoundId}>
          {showOutbound ? <SentHistoryMessage message={round.outbound} label={round.roundNumber === 1 ? "Initial request" : "Follow-up"} /> : null}
          {round.responses.map((response) => <article className="case-history-response" key={response.responseId}>
            <h3>{response.supersedesResponseId ? "Corrected insurer response" : "Insurer response"}</h3>
            <p>Recorded <RecordedTime value={response.receivedAt} /></p>
            <div className="case-history-links">
              <Link to={`${totalLossClaimViewPath(caseId, "review_response_received")}?view=saved&response=${encodeURIComponent(response.responseId)}`}>View response</Link>
              {response.analysis && response.analysisEvidence ? <Link to={`${totalLossClaimViewPath(caseId, "review_response_reviewed")}?response=${encodeURIComponent(response.responseId)}`}>Venfour review{response.decision ? " and decision" : ""}</Link> : <span>{response.processingState === "pending" || response.processingState === "processing" ? "Review in progress" : "Review unavailable"}</span>}
            </div>
            {response.decision ? <p className="case-history-decision">Your decision: {response.decision.choice === "ACCEPT_OFFER" ? "Accept offer" : "Continue challenging"} · <RecordedTime value={response.decision.recordedAt} /></p> : null}
          </article>)}
          {round.followUp ? <SentHistoryMessage message={round.followUp} label="Follow-up" /> : null}
        </li>;
      })}
    </ol>
  </details>;
}
