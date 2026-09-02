import { fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { TotalLossNegotiationHistoryRound, TotalLossSentCommunication } from "../contracts";
import { NegotiationHistory } from "./negotiation-history";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";

function communication(roundNumber: number): TotalLossSentCommunication {
  return {
    body: `Round ${roundNumber} message\n\n  Preserve this exact text.\n`,
    communicationId: `communication-${roundNumber}`,
    createdAt: `2026-08-0${roundNumber}T10:00:00.000Z`,
    customerReportedSentAt: `2026-08-0${roundNumber}T14:3${roundNumber}:15.123Z`,
    messageVersionId: `message-version-${roundNumber}`,
    negotiationRoundId: `round-${roundNumber}`,
    recipient: `adjuster-${roundNumber}@example.test`,
    reportVersionId: REPORT_ID,
    state: "sent",
    subject: `Request subject ${roundNumber}`,
    versionNumber: roundNumber * 2 + 1,
  };
}

describe("immutable negotiation history", () => {
  it("retains the initial request and every follow-up with their own exact sent record", () => {
    const messages = [communication(1), communication(2), communication(3)];
    const history: TotalLossNegotiationHistoryRound[] = messages.map((outbound, index) => ({
      negotiationRoundId: outbound.negotiationRoundId,
      roundNumber: index + 1,
      outbound,
      responses: [],
      followUp: messages[index + 1] ?? null,
    }));
    const before = structuredClone(history);
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={history} />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector(".case-history > summary")!);
    const records = container.querySelectorAll(".case-history-message");

    expect(records).toHaveLength(messages.length);
    messages.forEach((message, index) => {
      const record = records[index]! as HTMLElement;
      const summary = record.querySelector("summary")!;
      expect(summary).toHaveTextContent(index === 0 ? "Initial request" : "Follow-up");
      expect(summary).toHaveTextContent(`Sent`);
      expect(summary).toHaveTextContent(`Version ${message.versionNumber}`);
      expect(summary.querySelector("time")).toHaveAttribute("dateTime", message.customerReportedSentAt);
      fireEvent.click(summary);
      expect(within(record).getByText(message.subject)).toBeVisible();
      expect(within(record).getByText(message.recipient)).toBeVisible();
      expect(record.querySelector(".sent-request-body")?.textContent).toBe(message.body);
    });
    expect(container.querySelector("input, textarea, button, [contenteditable]")).toBeNull();
    expect(history).toEqual(before);
  });

  it("does not invent sent history for an unsent draft", () => {
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={[]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
