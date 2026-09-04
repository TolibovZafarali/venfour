import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  TotalLossClaimSecured,
  TotalLossEducationProjection,
  TotalLossSentCommunication,
} from "../contracts";
import { SentRequest } from "./sent-request";

const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const RECORDED_AT = "2026-09-01T14:30:00.000Z";
const BODY = "Hello <Claims Team>,\n\n  Please review the evidence.\n\nThank you,\nVehicle owner\n";
const report = { reportId: REPORT_ID };
const sentMessage: TotalLossSentCommunication = {
  body: BODY,
  communicationId: "66666666-6666-4666-8666-666666666666",
  createdAt: "2026-08-31T12:00:00.000Z",
  customerReportedSentAt: RECORDED_AT,
  messageVersionId: "77777777-7777-4777-8777-777777777777",
  negotiationRoundId: "88888888-8888-4888-8888-888888888888",
  recipient: "adjuster@example.test",
  reportVersionId: REPORT_ID,
  state: "sent",
  subject: "Valuation reconsideration — Claim CLM-42",
  versionNumber: 3,
};

function education(reportVersionId = REPORT_ID): TotalLossEducationProjection {
  const completed = { completedAt: RECORDED_AT, skippedAt: null, viewedAt: RECORDED_AT };
  return {
    reportVersionId,
    steps: {
      result: completed,
      insurer_review: completed,
      valuation: completed,
      report: completed,
      what_next: completed,
      send: completed,
    },
  };
}

function claim(overrides: Partial<TotalLossClaimSecured> = {}): TotalLossClaimSecured {
  return {
    caseId: "33333333-3333-4333-8333-333333333333",
    commerce: null,
    contactEmail: "owner@example.test",
    education: education(),
    journey: {
      fulfillmentState: "awaiting_insurer_response",
      nextState: "awaiting_insurer_response",
      retryable: false,
    },
    messageDraft: {
      body: BODY,
      draftId: "55555555-5555-4555-8555-555555555555",
      purpose: "initial_reconsideration",
      recipient: "adjuster@example.test",
      reportVersionId: REPORT_ID,
      revision: 4,
      subject: "Valuation reconsideration — Claim CLM-42",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
    negotiationHistory: [{
      negotiationRoundId: sentMessage.negotiationRoundId,
      roundNumber: 1,
      outbound: sentMessage,
      responses: [],
      followUp: null,
      supersededFollowUpDrafts: [],
    }],
    state: "secured",
    workflow: {
      currentTask: "awaiting_insurer_response",
      phase: "negotiation",
      revision: 8,
    },
    ...overrides,
  };
}

describe("SentRequest", () => {
  it("preserves the saved message as plain text and uses the recorded confirmation time", () => {
    const { container } = render(<SentRequest claim={claim()} report={report} />);

    expect(screen.getByRole("heading", { name: "Your sent request" })).toBeVisible();
    expect(screen.getByText("adjuster@example.test")).toBeVisible();
    expect(screen.getByText("Valuation reconsideration — Claim CLM-42")).toBeVisible();
    expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
    expect(screen.getByLabelText("Request message").children).toHaveLength(0);
    expect(container.querySelector("time")).toHaveAttribute("dateTime", RECORDED_AT);
    expect(screen.getByText(/Sent · Recorded/u)).toHaveTextContent("Version 3");
  });

  it("has no editable fields or sending controls and leaves its input unchanged", () => {
    const saved = claim();
    const before = structuredClone(saved);
    const { container } = render(<SentRequest claim={saved} report={report} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("input, textarea, [contenteditable]")).toBeNull();
    expect(saved).toEqual(before);
  });

  it.each([null, { ...claim().messageDraft!, reportVersionId: "another-report", body: "Different draft content" }])(
    "preserves the immutable sent message without depending on the current draft",
    (messageDraft) => {
      render(<SentRequest claim={claim({ messageDraft })} report={report} />);

      expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
      expect(screen.getByText("adjuster@example.test")).toBeVisible();
      expect(screen.queryByText("Different draft content")).not.toBeInTheDocument();
    },
  );

  it("uses the communication confirmation time even when education belongs to another report", () => {
    const { container } = render(
      <SentRequest claim={claim({ education: education("another-report") })} report={report} />,
    );

    expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
    expect(container.querySelector("time")).toHaveAttribute("dateTime", RECORDED_AT);
  });

  it("keeps the saved request available after an insurer response is reviewed", () => {
    render(
      <SentRequest
        claim={claim({
          journey: {
            fulfillmentState: "insurer_response_reviewed",
            nextState: "insurer_response_reviewed",
            retryable: false,
          },
          workflow: { currentTask: "insurer_response_reviewed", phase: "negotiation", revision: 12 },
        })}
        report={report}
      />,
    );

    expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
  });

  it("preserves Sent, the exact timestamp, and the immutable version after closure", () => {
    const saved = claim();
    const { container, rerender } = render(<SentRequest claim={saved} report={report} />);
    const closed = claim({
      education: null,
      journey: { fulfillmentState: "resolved", nextState: "resolved", retryable: false },
      workflow: { currentTask: "resolved", phase: "resolution", revision: 18 },
      messageDraft: { ...saved.messageDraft!, body: "An obsolete editable draft", revision: 5 },
      resolution: {
        code: "CUSTOMER_STOPPED_PURSUING",
        resolvedAt: "2026-09-02T16:00:00.000Z",
        customerConfirmed: true,
        clientRequestId: "99999999-9999-4999-8999-999999999999",
        offerId: null,
        amountMinorUnits: null,
        currency: null,
        amountSource: null,
        recommendationId: null,
        decisionId: null,
        responseId: null,
      },
    });
    rerender(<SentRequest claim={closed} report={report} />);

    expect(screen.getByRole("heading", { name: "Your sent request" })).toBeVisible();
    expect(screen.getByText(/Sent · Recorded/u)).toHaveTextContent("Version 3");
    expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
    expect(container.querySelector("time")).toHaveAttribute("dateTime", RECORDED_AT);
    expect(screen.queryByText("An obsolete editable draft")).not.toBeInTheDocument();
    expect(screen.queryByText(/not confirmed as sent/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not substitute a sent request from another report version", () => {
    const { container } = render(<SentRequest claim={claim()} report={{ reportId: "another-report" }} />);

    expect(screen.getByText(/saved request details are unavailable for this report/iu)).toBeVisible();
    expect(screen.queryByLabelText("Request message")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your sent request" })).not.toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });

  it("keeps the initial communication distinct from later sent follow-ups after closure", () => {
    const laterMessage = {
      ...sentMessage,
      body: "A later follow-up with different wording",
      communicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      customerReportedSentAt: "2026-09-02T09:15:00.000Z",
      messageVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      negotiationRoundId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      subject: "Follow-up after the insurer response",
      versionNumber: 7,
    };
    const { container } = render(
      <SentRequest
        claim={claim({
          journey: { fulfillmentState: "resolved", nextState: "resolved", retryable: false },
          workflow: { currentTask: "resolved", phase: "resolution", revision: 20 },
          negotiationHistory: [
            { negotiationRoundId: laterMessage.negotiationRoundId, roundNumber: 2, outbound: laterMessage, responses: [], followUp: null, supersededFollowUpDrafts: [] },
            { negotiationRoundId: sentMessage.negotiationRoundId, roundNumber: 1, outbound: sentMessage, responses: [], followUp: laterMessage, supersededFollowUpDrafts: [] },
          ],
        })}
        report={report}
      />,
    );

    expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
    expect(screen.getByText(/Sent · Recorded/u)).toHaveTextContent("Version 3");
    expect(container.querySelector("time")).toHaveAttribute("dateTime", RECORDED_AT);
    expect(screen.queryByText(laterMessage.body)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not treat a follow-up communication as confirmation of an absent initial request", () => {
    render(
      <SentRequest
        claim={claim({
          negotiationHistory: [{
            negotiationRoundId: sentMessage.negotiationRoundId,
            roundNumber: 2,
            outbound: sentMessage,
            responses: [],
            followUp: null,
            supersededFollowUpDrafts: [],
          }],
        })}
        report={report}
      />,
    );

    expect(screen.getByText(/not confirmed as sent/u)).toBeVisible();
    expect(screen.queryByLabelText("Request message")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sent · Recorded/u)).not.toBeInTheDocument();
  });

  it.each(["prepare_request", "awaiting_insurer_response", "resolved"] as const)("does not infer Sent from the %s workflow or completed education", (nextState) => {
    const { container } = render(
      <SentRequest
        claim={claim({
          negotiationHistory: [],
          journey: { fulfillmentState: "report_ready", nextState, retryable: false },
          workflow: { currentTask: nextState, phase: "initial_request", revision: 4 },
        })}
        report={report}
      />,
    );

    expect(screen.queryByLabelText("Request message")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your sent request" })).not.toBeInTheDocument();
    expect(screen.getByText(/not confirmed as sent/u)).toBeVisible();
    expect(container.querySelector("time")).toBeNull();
  });
});
