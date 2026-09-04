import { fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  TotalLossInsurerResponse,
  TotalLossMessageDraft,
  TotalLossNegotiationHistoryRound,
  TotalLossSentCommunication,
} from "../contracts";
import { preserveRequestDraft, requestDraftRecoveryKey } from "../request-draft-recovery";
import { contentOf } from "../request-state";
import { NegotiationHistory } from "./negotiation-history";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_RESPONSE_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ANALYSIS_ID = "66666666-6666-4666-8666-666666666666";
const SOURCE_DECISION_ID = "77777777-7777-4777-8777-777777777777";

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

function historicalResponse(
  responseId: string,
  supersedesResponseId: string | null,
  decided: boolean,
): TotalLossInsurerResponse {
  return {
    negotiationRoundId: "round-1",
    outboundCommunicationId: "communication-1",
    canCorrect: false,
    analysis: null,
    analysisEvidence: null,
    clientRequestId: `${responseId}-request`,
    document: null,
    failureReason: null,
    recommendation: null,
    usableOffer: null,
    decision: decided ? {
      decisionId: SOURCE_DECISION_ID,
      clientRequestId: "88888888-8888-4888-8888-888888888888",
      recommendationId: "99999999-9999-4999-8999-999999999999",
      analysisResultId: SOURCE_ANALYSIS_ID,
      choice: "CONTINUE_CHALLENGING",
      offerId: null,
      amountMinorUnits: null,
      currency: null,
      recordedAt: "2026-08-02T15:00:00.000Z",
    } : null,
    processingState: "completed",
    receivedAt: "2026-08-02T14:00:00.000Z",
    responseId,
    revisedOffer: null,
    sourceType: "pasted_message",
    supersedesResponseId,
    text: "Saved insurer reply",
  };
}

function supersededHistory() {
  const draft: TotalLossMessageDraft = {
    body: "Exact last-saved follow-up.\n\nKeep this spacing. ",
    draftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    purpose: "follow_up_reconsideration",
    recipient: "adjuster@example.test",
    reportVersionId: REPORT_ID,
    revision: 7,
    subject: "Exact last-saved subject",
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
  const history: TotalLossNegotiationHistoryRound[] = [{
    negotiationRoundId: "round-1",
    roundNumber: 1,
    outbound: communication(1),
    responses: [
      historicalResponse(SOURCE_RESPONSE_ID, null, true),
      historicalResponse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", SOURCE_RESPONSE_ID, false),
    ],
    followUp: null,
    supersededFollowUpDrafts: [{
      state: "superseded",
      sourceResponseId: SOURCE_RESPONSE_ID,
      sourceAnalysisResultId: SOURCE_ANALYSIS_ID,
      sourceDecisionId: SOURCE_DECISION_ID,
      draft,
    }],
  }];
  return { draft, history };
}

beforeEach(() => window.sessionStorage.clear());

describe("immutable negotiation history", () => {
  it("retains the initial request and every follow-up with their own exact sent record", () => {
    const messages = [communication(1), communication(2), communication(3)];
    const history: TotalLossNegotiationHistoryRound[] = messages.map((outbound, index) => ({
      negotiationRoundId: outbound.negotiationRoundId,
      roundNumber: index + 1,
      outbound,
      responses: [],
      followUp: messages[index + 1] ?? null,
      supersededFollowUpDrafts: [],
    }));
    const before = structuredClone(history);
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={history} userId={USER_ID} />
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
    expect(container).not.toHaveTextContent("Draft follow-up — superseded");
    expect(history).toEqual(before);
  });

  it("shows the exact saved superseded draft beside its source response without actions", () => {
    const { draft, history } = supersededHistory();
    const before = structuredClone(history);
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={history} userId={USER_ID} />
      </MemoryRouter>,
    );

    fireEvent.click(container.querySelector(".case-history > summary")!);
    const record = container.querySelector(".case-history-superseded-draft") as HTMLElement;
    expect(record).toHaveTextContent("Draft follow-up — superseded");
    expect(record).toHaveTextContent("insurer response this draft was based on was corrected");
    fireEvent.click(record.querySelector("summary")!);
    expect(within(record).getByRole("region", { name: "Last saved draft" })).toBeVisible();
    expect(within(record).getByText(draft.subject)).toBeVisible();
    expect(record.querySelector(".case-history-draft-body")?.textContent).toBe(draft.body);
    expect(record.querySelector("input, textarea, button, a, [contenteditable]")).toBeNull();
    expect(history).toEqual(before);
  });

  it("shows differing same-tab edits separately and does not claim they were saved", () => {
    const { draft, history } = supersededHistory();
    const recovered = {
      ...contentOf(draft),
      subject: "Browser-only subject",
      body: "Browser-only body\nwith exact spacing. ",
    };
    const recoveryKey = requestDraftRecoveryKey({
      userId: USER_ID,
      caseId: CASE_ID,
      draft,
      followUpDraftId: draft.draftId,
    });
    preserveRequestDraft(recoveryKey, recovered, draft, false);
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={history} userId={USER_ID} />
      </MemoryRouter>,
    );

    fireEvent.click(container.querySelector(".case-history > summary")!);
    const record = container.querySelector(".case-history-superseded-draft") as HTMLElement;
    fireEvent.click(record.querySelector("summary")!);
    const versions = record.querySelectorAll(".case-history-draft-version");
    expect(versions).toHaveLength(2);
    expect(versions[0]).toHaveTextContent(draft.subject);
    expect(versions[0]?.querySelector(".case-history-draft-body")?.textContent).toBe(draft.body);
    expect(versions[1]).toHaveTextContent(recovered.subject);
    expect(versions[1]?.querySelector(".case-history-draft-body")?.textContent).toBe(recovered.body);
    expect(within(record).getByText(/recovered from this browser.*may not have finished saving/iu)).toBeVisible();
    expect(within(record).getByRole("region", { name: "Browser-recovered edits — not confirmed saved" })).toBeVisible();
    expect(record.querySelector("input, textarea, button, a, [contenteditable]")).toBeNull();
  });

  it("labels browser work from a different saved baseline as uncertain", () => {
    const { draft, history } = supersededHistory();
    const earlier = { ...draft, revision: draft.revision - 1, subject: "Earlier saved subject" };
    const recovered = {
      ...contentOf(earlier),
      subject: "Edits based on the earlier version",
      body: "Keep this work, but do not claim its saved state is known.",
    };
    const recoveryKey = requestDraftRecoveryKey({
      userId: USER_ID,
      caseId: CASE_ID,
      draft,
      followUpDraftId: draft.draftId,
    });
    preserveRequestDraft(recoveryKey, recovered, earlier, false);
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={history} userId={USER_ID} />
      </MemoryRouter>,
    );

    fireEvent.click(container.querySelector(".case-history > summary")!);
    const record = container.querySelector(".case-history-superseded-draft") as HTMLElement;
    fireEvent.click(record.querySelector("summary")!);
    expect(within(record).getByRole("region", { name: "Browser-recovered version — saved status uncertain" })).toBeVisible();
    expect(within(record).getByText(/can’t be safely matched to the last saved draft/iu)).toBeVisible();
    expect(record.querySelectorAll(".case-history-draft-version")).toHaveLength(2);
    expect(record.querySelector("input, textarea, button, a, [contenteditable]")).toBeNull();
  });

  it("keeps the last saved draft visible when browser recovery storage cannot be read", () => {
    const { draft, history } = supersededHistory();
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    let container: HTMLElement;
    try {
      ({ container } = render(
        <MemoryRouter>
          <NegotiationHistory caseId={CASE_ID} history={history} userId={USER_ID} />
        </MemoryRouter>,
      ));
    } finally {
      read.mockRestore();
    }

    fireEvent.click(container!.querySelector(".case-history > summary")!);
    const record = container!.querySelector(".case-history-superseded-draft") as HTMLElement;
    fireEvent.click(record.querySelector("summary")!);
    expect(within(record).getByRole("region", { name: "Last saved draft" })).toBeVisible();
    expect(record.querySelector(".case-history-draft-body")?.textContent).toBe(draft.body);
    expect(within(record).getByText(/draft recovery could not be checked/iu)).toBeVisible();
    expect(record.querySelectorAll(".case-history-draft-version")).toHaveLength(1);
  });

  it("does not invent sent history for an unsent draft", () => {
    const { container } = render(
      <MemoryRouter>
        <NegotiationHistory caseId={CASE_ID} history={[]} userId={USER_ID} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
