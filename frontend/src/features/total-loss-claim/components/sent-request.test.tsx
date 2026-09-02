import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  TotalLossClaimSecured,
  TotalLossEducationProjection,
} from "../contracts";
import { SentRequest } from "./sent-request";

const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const RECORDED_AT = "2026-09-01T14:30:00.000Z";
const BODY = "Hello <Claims Team>,\n\n  Please review the evidence.\n\nThank you,\nVehicle owner\n";
const report = { reportId: REPORT_ID };

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

  it.each([null, { ...claim().messageDraft!, reportVersionId: "another-report" }])(
    "does not display missing or differently versioned request details",
    (messageDraft) => {
      render(<SentRequest claim={claim({ messageDraft })} report={report} />);

      expect(screen.getByText(/saved request details are unavailable for this report/iu)).toBeVisible();
      expect(screen.queryByLabelText("Request message")).not.toBeInTheDocument();
      expect(screen.queryByText("adjuster@example.test")).not.toBeInTheDocument();
    },
  );

  it("does not substitute a stale report's confirmation time or the draft update time", () => {
    const { container } = render(
      <SentRequest claim={claim({ education: education("another-report") })} report={report} />,
    );

    expect(screen.getByLabelText("Request message").textContent).toBe(BODY);
    expect(container.querySelector("time")).toBeNull();
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

  it("does not present an unsent draft as a sent request", () => {
    const { container } = render(
      <SentRequest
        claim={claim({
          journey: { fulfillmentState: "report_ready", nextState: "prepare_request", retryable: false },
          workflow: { currentTask: "prepare_request", phase: "initial_request", revision: 4 },
        })}
        report={report}
      />,
    );

    expect(screen.queryByLabelText("Request message")).not.toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });
});
