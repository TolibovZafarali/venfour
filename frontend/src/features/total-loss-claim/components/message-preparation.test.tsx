import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessagePreparation } from "@/features/total-loss-claim/components/message-preparation";
import { FollowUpPreparation } from "@/features/total-loss-claim/components/follow-up-preparation";
import { openDefaultEmailApp } from "@/features/total-loss-claim/browser-actions";
import type * as RequestBrowserActions from "@/features/total-loss-claim/browser-actions";
import { TOTAL_LOSS_EDUCATION_STEPS } from "@/features/total-loss-claim/contracts";
import type {
  TotalLossClaimSecured,
  TotalLossEducationProjection,
  TotalLossFollowUp,
  TotalLossMessageDraft,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import { server } from "@/test/mocks/server";
import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";
import { preserveRequestDraft, requestDraftRecoveryKey } from "@/features/total-loss-claim/request-draft-recovery";
import type { TotalLossIntakeMode } from "@/features/total-loss/types";

vi.mock(
  "@/features/total-loss-claim/browser-actions",
  async (importOriginal) => {
    const original = await importOriginal<typeof RequestBrowserActions>();
    return { ...original, openDefaultEmailApp: vi.fn() };
  },
);

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "66666666-6666-4666-8666-666666666666";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SENT_ACKNOWLEDGEMENT = "I sent the email with this PDF attached.";
const NOW = "2026-08-29T18:00:00.000Z";
const API = "*/api/v1/appraisal-cases/:caseId";
const amount = (value: number) => ({
  amountMinorUnits: value,
  currency: "USD",
  formatted: `$${value / 100}`,
});

function report(): TotalLossPublishedReport {
  return {
    conclusion: {
      classificationLabel: "Potential undervaluation",
      continuingSupported: true,
      indicatedDifference: amount(144400),
      insurerValuation: amount(1904600),
      limitations: ["Advertised prices are not completed-sale prices."],
      preliminaryComparison: null,
      summary:
        "The completed evidence supports a written reconsideration request.",
      supportedRange: {
        low: amount(1980000),
        median: amount(2049000),
        high: amount(2226300),
        evidenceBasis: "Current listings",
      },
    },
    insurerEvidence: {
      adjustmentContext: null,
      comparableCount: 0,
      comparables: [],
      insurerName: null,
      methodologyStatement: null,
      summary: {
        adjustedValueMissingCount: 0,
        adjustedValues: null,
        advertisedPriceMissingCount: 0,
        advertisedPrices: null,
        fullyDisclosedAdjustmentCount: 0,
        partiallyDisclosedAdjustmentCount: 0,
        totalCount: 0,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 0,
      },
    },
    marketEvidence: {
      comparables: [],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-07-12",
      },
      methodologyStatement: null,
      primary: null,
      secondary: null,
    },
    issueDate: "2026-08-29",
    reportId: REPORT_ID,
    status: "published",
    subjectVehicle: { description: "2024 Hyundai Elantra SEL" },
    suggestedFilename: "Venfour_Valuation_Evidence_Synthetic_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function draft(
  overrides: Partial<TotalLossMessageDraft> = {},
): TotalLossMessageDraft {
  return {
    body: "Please review the attached evidence package.",
    draftId: DRAFT_ID,
    purpose: "initial_reconsideration",
    recipient: "adjuster@example.com",
    reportVersionId: REPORT_ID,
    revision: 1,
    subject: "Valuation reconsideration - Claim CLM-42",
    updatedAt: NOW,
    ...overrides,
  };
}

function education(completed = true): TotalLossEducationProjection {
  return {
    reportVersionId: REPORT_ID,
    steps: Object.fromEntries(
      TOTAL_LOSS_EDUCATION_STEPS.map((step) => [
        step,
        {
          completedAt: completed && step !== "send" ? NOW : null,
          skippedAt: null,
          viewedAt: completed && step !== "send" ? NOW : null,
        },
      ]),
    ) as TotalLossEducationProjection["steps"],
  };
}

function claim(
  overrides: Partial<TotalLossClaimSecured> = {},
): TotalLossClaimSecured {
  return {
    caseId: CASE_ID,
    commerce: null,
    contactEmail: "owner@example.com",
    education: education(),
    journey: {
      fulfillmentState: "report_ready",
      nextState: "prepare_request",
      retryable: false,
    },
    messageDraft: draft(),
    report: report(),
    sendingDetails: {
      adjusterEmail: "adjuster@example.com",
      adjusterEmailConfirmed: true,
      adjusterName: null,
      claimReference: "CLM-42",
      claimReferenceConfirmed: true,
      customerName: "Case Owner",
      insurerName: null,
      revision: 1,
      vehicleDescription: "2024 Hyundai Elantra SEL",
    },
    state: "secured",
    workflow: {
      currentTask: "prepare_request",
      phase: "initial_request",
      revision: 7,
    },
    ...overrides,
  };
}

function prepared(saved: TotalLossMessageDraft, revision = 8) {
  return {
    draft: saved,
    messageVersion: {
      body: saved.body,
      createdAt: NOW,
      messageVersionId: VERSION_ID,
      recipient: saved.recipient,
      reportVersionId: REPORT_ID,
      state: "prepared",
      subject: saved.subject,
      versionNumber: 1,
    },
    workflowRevision: revision,
  };
}

function sentResult() {
  return {
    communicationId: "77777777-7777-4777-8777-777777777777",
    customerReportedSentAt: NOW,
    messageVersionId: VERSION_ID,
    negotiationRoundId: "88888888-8888-4888-8888-888888888888",
    state: "awaiting_insurer_response",
    workflowRevision: 9,
  };
}

function renderRequest(
  initial = claim(),
  onRefresh: () => Promise<unknown> = vi.fn(async () => undefined),
  callbacks: {
    readonly followUp?: boolean;
    readonly actionContainer?: HTMLElement;
    readonly intakeMode?: TotalLossIntakeMode;
    readonly onDraftStateChange?: (hasDraft: boolean) => void;
    readonly onSent?: () => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  let currentClaim = initial;
  let updateClaim: (current: TotalLossClaimSecured) => void;
  function RequestRoute() {
    const [current, setCurrent] = useState(currentClaim);
    updateClaim = setCurrent;
    return callbacks.followUp ? <FollowUpPreparation
          accessToken="request-test-token" caseId={current.caseId} claim={current}
          onRefresh={onRefresh} report={report()} userId={USER_ID}
          onSent={callbacks.onSent ?? (() => undefined)}
        /> : <MessagePreparation
          {...callbacks}
          accessToken="request-test-token"
          caseId={current.caseId}
          claim={current}
          onRefresh={onRefresh}
          report={report()}
          userId={USER_ID}
        />;
  }
  const router = createMemoryRouter([
    { path: "/request", element: <RequestRoute /> },
    { path: "/section", element: <h1>Another review section</h1> },
  ], { initialEntries: ["/request"] });
  const result = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return {
    ...result,
    refresh: (current: TotalLossClaimSecured) => {
      currentClaim = current;
      act(() => updateClaim(current));
    },
    navigate: async (path: string) => { await act(async () => { await router.navigate(path); }); },
    router,
    onRefresh,
  };
}

function renderRequestFooter() {
  render(<nav aria-label="Request footer" />);
  return screen.getByRole("navigation", { name: "Request footer" });
}

function followUpProjection(state: TotalLossFollowUp["state"] = "draft"): TotalLossFollowUp {
  const current = draft({ purpose: "follow_up_reconsideration", subject: "Follow-up - Claim CLM-42", body: "Thank you for your response. Please explain how you considered the listings in my previous request." });
  return {
    state, decisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    responseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", analysisResultId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", reportVersionId: REPORT_ID,
    draft: state === "draft" || state === "sent" ? current : null,
    preparedMessage: null,
    sentMessage: state === "sent" ? { ...prepared(current).messageVersion, recipient: current.recipient!, ...sentResult(), state: "sent" } : null,
    reasonCode: state === "unavailable" ? "NO_SUPPORTED_UNRESOLVED_ISSUE" : null,
  };
}

function followUpClaim(state: TotalLossFollowUp["state"] = "draft"): TotalLossClaimSecured {
  const followUp = followUpProjection(state);
  return claim({
    journey: { fulfillmentState: "follow_up_preparation", nextState: "follow_up_preparation", retryable: false },
    followUp,
    insurerResponse: {
      analysis: null, analysisEvidence: null, clientRequestId: USER_ID, document: null, failureReason: null,
      recommendation: null, usableOffer: null, processingState: "completed", receivedAt: NOW,
      responseId: followUp.responseId, revisedOffer: null, sourceType: "pasted_message", supersedesResponseId: null, text: "The original comparable set remains appropriate.",
      decision: { decisionId: followUp.decisionId, analysisResultId: followUp.analysisResultId, clientRequestId: USER_ID, recommendationId: VERSION_ID, choice: "CONTINUE_CHALLENGING", offerId: null, amountMinorUnits: null, currency: null, recordedAt: NOW },
    },
  });
}

describe("follow-up preparation with the shared request editor", () => {
  it("creates only after the customer action and resumes the same saved draft on return", async () => {
    const writes: unknown[] = [];
    const current = followUpClaim("available");
    server.use(http.post(`${API}/follow-up`, async ({ request }) => {
      writes.push(await request.json());
      return HttpResponse.json(followUpProjection());
    }));
    const view = renderRequest(current, undefined, { followUp: true });
    expect(writes).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Prepare your follow-up" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Prepare my follow-up" }));
    expect(await screen.findByRole("heading", { name: "Review and send your follow-up" })).toBeVisible();
    expect(writes).toEqual([{ decisionId: current.followUp!.decisionId }]);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(followUpProjection().draft!.body);
    view.unmount();
    renderRequest(followUpClaim(), undefined, { followUp: true });
    expect(screen.getByRole("heading", { name: "Review and send your follow-up" })).toBeVisible();
    expect(writes).toHaveLength(1);
  });

  it("leaves an Accept decision without follow-up controls or generation", () => {
    const current = followUpClaim("available");
    renderRequest({ ...current, followUp: null, insurerResponse: { ...current.insurerResponse!, decision: { ...current.insurerResponse!.decision!, choice: "ACCEPT_OFFER" } } }, undefined, { followUp: true });
    expect(screen.queryByRole("button", { name: "Prepare my follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });

  it.each(["copy", "open"] as const)("saves exact edits before %s and confirms a distinct prepared follow-up without changing the original", async (kind) => {
    const current = followUpClaim();
    const original = structuredClone(current.messageDraft);
    let saved = current.followUp!.draft!;
    const calls: string[] = [];
    const sentInputs: unknown[] = [];
    server.use(
      http.patch(`${API}/follow-up/draft`, async ({ request }) => {
        const input = await request.json() as { body: string; recipient: string; subject: string; expectedRevision: number; draftId: string };
        expect(input.draftId).toBe(saved.draftId);
        expect(input.expectedRevision).toBe(saved.revision);
        calls.push("save"); saved = { ...saved, ...input, revision: saved.revision + 1 };
        return HttpResponse.json(saved);
      }),
      http.post(`${API}/follow-up/prepare`, async ({ request }) => {
        expect(await request.json()).toMatchObject({ draftId: saved.draftId, expectedDraftRevision: saved.revision, expectedWorkflowRevision: 7 });
        calls.push("prepare"); return HttpResponse.json(prepared(saved));
      }),
      http.post(`${API}/follow-up/opened`, () => HttpResponse.json({})),
      http.post(`${API}/follow-up/sent`, async ({ request }) => {
        sentInputs.push(await request.json()); return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const onSent = vi.fn();
    renderRequest(current, undefined, { followUp: true, onSent });
    await user.clear(screen.getByRole("textbox", { name: "Subject" }));
    await user.type(screen.getByRole("textbox", { name: "Subject" }), "My reviewed follow-up");
    await user.click(screen.getByRole("button", { name: kind === "copy" ? "Copy email" : "Open email app" }));
    await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT });
    expect(calls).toEqual(["save", "prepare"]);
    if (kind === "copy") expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("Subject: My reviewed follow-up"));
    else expect(new URL(vi.mocked(openDefaultEmailApp).mock.calls[0]![0]).searchParams.get("subject")).toBe("My reviewed follow-up");
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    expect(sentInputs).toEqual([{ clientRequestId: expect.any(String), expectedWorkflowRevision: 8, messageVersionId: VERSION_ID, confirmedReportAttached: true }]);
    expect(current.messageDraft).toEqual(original);
  });

  it.each(["copy", "open"] as const)("revalidates stale follow-up authority before every %s action", async (kind) => {
    const current = followUpClaim();
    const draftId = current.followUp!.draft!.draftId;
    const prepareInputs: Array<Record<string, unknown>> = [];
    let currentAuthority = true;
    server.use(
      http.post(`${API}/follow-up/prepare`, async ({ request }) => {
        prepareInputs.push((await request.json()) as Record<string, unknown>);
        return currentAuthority
          ? HttpResponse.json(prepared(current.followUp!.draft!))
          : HttpResponse.json({ error: { code: "FOLLOW_UP_NOT_CURRENT", message: "The follow-up draft is no longer current." } }, { status: 409 });
      }),
      http.post(`${API}/follow-up/opened`, () => HttpResponse.json({ accepted: true })),
    );
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderRequest(current, undefined, { followUp: true });
    const actionName = kind === "copy" ? "Copy email" : "Open email app";

    await user.click(screen.getByRole("button", { name: actionName }));
    await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT });
    expect(prepareInputs).toHaveLength(1);
    expect(prepareInputs[0]).toMatchObject({ draftId, expectedDraftRevision: 1 });
    if (kind === "copy") expect(clipboard).toHaveBeenCalledTimes(1);
    else expect(openDefaultEmailApp).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Not yet" }));

    currentAuthority = false;
    await user.click(screen.getByRole("button", { name: actionName }));
    expect(await screen.findByRole("alert")).toHaveTextContent(kind === "copy" ? "We couldn’t copy the email" : "We couldn’t open your email app");
    expect(prepareInputs).toHaveLength(2);
    expect(prepareInputs[1]).toMatchObject({ draftId, expectedDraftRevision: 1 });
    expect(prepareInputs[1]!.clientRequestId).toBe(prepareInputs[0]!.clientRequestId);
    if (kind === "copy") expect(clipboard).toHaveBeenCalledTimes(1);
    else expect(openDefaultEmailApp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT })).not.toBeInTheDocument();
  });

  it("autosaves follow-up edits and restores them after returning", async () => {
    let current = followUpClaim();
    const writes = vi.fn();
    server.use(http.patch(`${API}/follow-up/draft`, async ({ request }) => {
      const input = await request.json() as { body: string; recipient: string; subject: string };
      const saved = { ...current.followUp!.draft!, ...input, revision: 2 };
      current = { ...current, followUp: { ...current.followUp!, draft: saved } };
      writes(); return HttpResponse.json(saved);
    }));
    const first = renderRequest(current, undefined, { followUp: true });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message" }), " Thank you for reviewing it again.");
    await waitFor(() => expect(writes).toHaveBeenCalledOnce(), { timeout: 2000 });
    first.unmount();
    renderRequest(current, undefined, { followUp: true });
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(current.followUp!.draft!.body);
    expect(current.messageDraft!.body).toBe("Please review the attached evidence package.");
  });

  it("shows a recoverable evidence limitation without fabricating an editable message", () => {
    renderRequest(followUpClaim("unavailable"), undefined, { followUp: true });
    expect(screen.getByText(/does not identify a remaining issue/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry preparation" })).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });

  it("hides a generated editor when the current case can no longer verify its sources", async () => {
    server.use(http.post(`${API}/follow-up`, () => HttpResponse.json(followUpProjection())));
    const view = renderRequest(followUpClaim("available"), undefined, { followUp: true });
    await userEvent.click(screen.getByRole("button", { name: "Prepare my follow-up" }));
    await screen.findByRole("textbox", { name: "Message" });
    view.refresh(followUpClaim("unavailable"));
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(screen.getByText(/does not identify a remaining issue/u)).toBeVisible();
  });

  it("shows the immutable sent version instead of a newer or different draft", () => {
    const current = followUpClaim("sent");
    renderRequest({ ...current, followUp: { ...current.followUp!, draft: { ...current.followUp!.draft!, body: "Different draft body" } } }, undefined, { followUp: true });
    expect(screen.getByRole("heading", { name: "Your sent follow-up" })).toBeVisible();
    expect(screen.getByLabelText("Follow-up message")).toHaveTextContent(current.followUp!.sentMessage!.body);
    expect(screen.queryByText("Different draft body")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });
});

describe("request edits across section navigation", () => {
  it.each([false, true])("restores invalid subject and authored body across navigation and refresh (follow-up: %s)", async (followUp) => {
    const current = followUp ? followUpClaim() : claim();
    const writes = vi.fn();
    server.use(http.patch(`${API}/${followUp ? "follow-up/draft" : "message-draft"}`, () => {
      writes(); return HttpResponse.json({ detail: "Invalid subject" }, { status: 422 });
    }));
    const view = renderRequest(current, undefined, { followUp });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "My unfinished rewrite survives another section." } });
    await view.navigate("/section");
    expect(screen.getByRole("heading", { name: "Another review section" })).toBeVisible();
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("My unfinished rewrite survives another section.");
    expect(screen.getByText(/Your unfinished edits were restored/u)).toBeVisible();
    view.unmount();
    renderRequest(current, undefined, { followUp });
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("My unfinished rewrite survives another section.");
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([false, true])("retains failed edits and the visible retry state after returning (follow-up: %s)", async (followUp) => {
    const current = followUp ? followUpClaim() : claim();
    const writes = vi.fn();
    server.use(http.patch(`${API}/${followUp ? "follow-up/draft" : "message-draft"}`, () => {
      writes(); return HttpResponse.json({ detail: "Unavailable" }, { status: 503 });
    }));
    const view = renderRequest(current, undefined, { followUp });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "My authored work when saving fails." } });
    await screen.findByRole("button", { name: "Retry save" }, { timeout: 2000 });
    await view.navigate("/section");
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("My authored work when saving fails.");
    expect(screen.getByRole("button", { name: "Retry save" })).toBeVisible();
    expect(screen.getByText("Changes not saved")).toBeVisible();
    expect(writes).toHaveBeenCalledOnce();
  });

  it("keeps initial, different-case, and different-round follow-up drafts isolated", () => {
    const first = renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Initial request work" } });
    first.unmount();
    const otherCase = renderRequest(claim({ caseId: "99999999-9999-4999-8999-999999999999" }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(draft().body);
    otherCase.unmount();
    const second = renderRequest(followUpClaim(), undefined, { followUp: true });
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(followUpProjection().draft!.body);
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Round two work" } });
    second.unmount();
    const roundTwo = followUpClaim();
    const roundThree = { ...roundTwo, followUp: { ...roundTwo.followUp!, draft: { ...roundTwo.followUp!.draft!, draftId: "aaaaaaaa-1111-4111-8111-111111111111" } } };
    const third = renderRequest(roundThree, undefined, { followUp: true });
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(followUpProjection().draft!.body);
    third.unmount();
    const returned = renderRequest(followUpClaim(), undefined, { followUp: true });
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Round two work");
    returned.unmount();
    renderRequest();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Initial request work");
  });

  it("preserves newer invalid work when a previous editor's pending save finishes", async () => {
    let release!: () => void;
    let started = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let saved = draft();
    server.use(http.patch(`${API}/message-draft`, async ({ request }) => {
      const input = await request.json() as { recipient: string; subject: string; body: string };
      started = true;
      await held;
      saved = { ...saved, ...input, revision: 2 };
      return HttpResponse.json(saved);
    }));
    const view = renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "First edit" } });
    await waitFor(() => expect(started).toBe(true), { timeout: 2000 });
    await view.navigate("/section");
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("First edit");
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "New work after return" } });
    await act(async () => release());
    await waitFor(() => expect(saved.revision).toBe(2));
    await view.navigate("/section");
    view.refresh(claim({ messageDraft: saved }));
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("New work after return");
    expect(screen.queryByRole("button", { name: "Load saved draft" })).not.toBeInTheDocument();
  });

  it("preserves an acknowledged save when the resolver refresh remains stale", async () => {
    const saved = draft({ subject: "Saved although refresh failed", revision: 2 });
    server.use(http.patch(`${API}/message-draft`, () => HttpResponse.json(saved)));
    const view = renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: saved.subject } });
    await screen.findByText("Saved", {}, { timeout: 2000 });
    await view.navigate("/section");
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(saved.subject);
    expect(screen.queryByRole("button", { name: "Load saved draft" })).not.toBeInTheDocument();
    view.refresh(claim({ messageDraft: saved }));
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([false, true])("preserves edits that could not be stored before an in-flight save completes (follow-up: %s)", async (followUp) => {
    const current = followUp ? followUpClaim() : claim();
    const currentDraft = followUp ? current.followUp!.draft! : current.messageDraft!;
    let release!: () => void;
    let started = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.patch(`${API}/${followUp ? "follow-up/draft" : "message-draft"}`, async ({ request }) => {
      const input = await request.json() as { recipient: string; subject: string; body: string };
      started = true;
      await held;
      return HttpResponse.json({ ...currentDraft, ...input, revision: 2 });
    }));
    const view = renderRequest(current, undefined, { followUp });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "Earlier saved subject" } });
    await waitFor(() => expect(started).toBe(true), { timeout: 2000 });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Latest rewrite during the storage interruption" } });
    expect(screen.getByText(/This browser couldn’t preserve your latest edits/u)).toBeVisible();
    storage.mockRestore();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
    await view.navigate("/section");
    expect(screen.getByRole("heading", { name: "Another review section" })).toBeVisible();
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Latest rewrite during the storage interruption");
    expect(screen.queryByRole("button", { name: "Load saved draft" })).not.toBeInTheDocument();
  });

  it.each([false, true])("retains acknowledged work after undoing edits while the resolver is stale (follow-up: %s)", async (followUp) => {
    const current = followUp ? followUpClaim() : claim();
    const currentDraft = followUp ? current.followUp!.draft! : current.messageDraft!;
    const saved = { ...currentDraft, subject: "Acknowledged customer subject", revision: 2 };
    server.use(http.patch(`${API}/${followUp ? "follow-up/draft" : "message-draft"}`, () => HttpResponse.json(saved)));
    const view = renderRequest(current, undefined, { followUp });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: saved.subject } });
    await screen.findByText("Saved", {}, { timeout: 2000 });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: saved.subject } });
    await view.navigate("/section");
    expect(screen.getByRole("heading", { name: "Another review section" })).toBeVisible();
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(saved.subject);
    view.refresh(followUp
      ? { ...current, followUp: { ...current.followUp!, draft: saved } }
      : claim({ messageDraft: saved }));
    expect(window.sessionStorage.length).toBe(0);
  });

  it("persists a reversion made while an older save is pending", async () => {
    let release!: () => void;
    let writes = 0;
    let saved = draft();
    const held = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.patch(`${API}/message-draft`, async ({ request }) => {
      const input = await request.json() as { recipient: string; subject: string; body: string; expectedRevision: number };
      writes += 1;
      if (writes === 1) await held;
      saved = { ...saved, ...input, revision: input.expectedRevision + 1 };
      return HttpResponse.json(saved);
    }));
    const view = renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "Pending change" } });
    await waitFor(() => expect(writes).toBe(1), { timeout: 2000 });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: draft().subject } });
    await view.navigate("/section");
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(draft().subject);
    await act(async () => release());
    await waitFor(() => expect(writes).toBe(2), { timeout: 2000 });
    await waitFor(() => expect(saved.subject).toBe(draft().subject));
    expect(saved.revision).toBe(3);
    view.refresh(claim({ messageDraft: saved }));
    await view.navigate("/section");
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(draft().subject);
    expect(screen.queryByRole("button", { name: "Load saved draft" })).not.toBeInTheDocument();
  });

  it("keeps a restored rewrite when a save interrupted by refresh later appears in the resolver", () => {
    const current = draft();
    const pending = { recipient: current.recipient!, subject: "Earlier pending subject", body: current.body };
    const local = { ...pending, subject: "", body: "Latest rewrite after the pending snapshot" };
    const recoveryKey = requestDraftRecoveryKey({ userId: USER_ID, caseId: CASE_ID, draft: current });
    preserveRequestDraft(recoveryKey, local, current, false, pending);
    const view = renderRequest();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(local.body);
    view.refresh(claim({ messageDraft: { ...current, ...pending, revision: 2 } }));
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(local.body);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Load saved draft" })).not.toBeInTheDocument();
  });

  it("blocks section navigation when the latest work cannot be stored", async () => {
    const view = renderRequest();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Work held only in the editor" } });
    await view.navigate("/section");
    expect(screen.getByRole("alertdialog", { name: "Leave your unsaved changes?" })).toBeVisible();
    expect(view.router.state.location.pathname).toBe("/request");
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    storage.mockRestore();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Work safely preserved now" } });
    await view.navigate("/section");
    await view.navigate("/request");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Work safely preserved now");
  });

  it("restores concurrent edits behind revision conflict protection", async () => {
    const first = renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "My preserved work" } });
    first.unmount();
    const remote = draft({ subject: "Other tab's saved subject", revision: 2 });
    server.use(http.get(`${API}/message-draft`, () => HttpResponse.json(remote)));
    renderRequest(claim({ messageDraft: remote }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("My preserved work");
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy email" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Load saved draft" }));
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(remote.subject);
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([false, true])("clears obsolete recovery after a successful sent confirmation (follow-up: %s)", async (followUp) => {
    const current = followUp ? followUpClaim() : claim();
    const currentDraft = followUp ? current.followUp!.draft! : current.messageDraft!;
    const recoveryKey = requestDraftRecoveryKey({ userId: USER_ID, caseId: CASE_ID, draft: currentDraft, followUpDraftId: followUp ? currentDraft.draftId : undefined });
    server.use(
      http.post(`${API}/${followUp ? "follow-up" : "message"}/prepare`, () => HttpResponse.json(prepared(currentDraft))),
      http.post(`${API}/${followUp ? "follow-up" : "message"}/sent`, () => HttpResponse.json(sentResult())),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderRequest(current, undefined, { followUp });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT });
    preserveRequestDraft(recoveryKey, { recipient: currentDraft.recipient!, subject: "", body: "Obsolete local recovery" }, currentDraft, true);
    await user.click(screen.getByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await screen.findByRole("heading", { name: "Request marked as sent" });
    expect(window.sessionStorage.getItem(recoveryKey)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });
});

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(openDefaultEmailApp).mockReset();
});

describe("case request preparation", () => {
  it.each(["inline", "footer"] as const)("requires only missing sending details with the %s action without changing education", async (placement) => {
    const initial = claim({ messageDraft: null });
    const details = {
      ...initial.sendingDetails!,
      adjusterEmail: null,
      adjusterEmailConfirmed: false,
      claimReference: null,
      claimReferenceConfirmed: false,
    };
    const operations: string[] = [];
    const payloads: Record<string, unknown>[] = [];
    server.use(
      http.put(`${API}/education/:step`, async ({ params, request }) => {
        const input = (await request.json()) as Record<string, unknown>;
        operations.push(`${String(params.step)}:${String(input.state)}`);
        payloads.push(input);
        return HttpResponse.json({
          education: education(),
          workflowRevision: Number(input.expectedWorkflowRevision) + 1,
        });
      }),
      http.put(`${API}/sending-details`, async ({ request }) => {
        const input = (await request.json()) as Record<string, unknown>;
        operations.push("details");
        payloads.push(input);
        return HttpResponse.json({
          sendingDetails: { ...details, ...input, revision: 2 },
          workflowRevision: 10,
        });
      }),
      http.post(`${API}/message/prepare`, async ({ request }) => {
        operations.push("prepare");
        payloads.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(prepared(draft(), 11));
      }),
    );
    const user = userEvent.setup();
    const onDraftStateChange = vi.fn();
    const actionContainer = placement === "footer"
      ? renderRequestFooter()
      : undefined;
    renderRequest({ ...initial, sendingDetails: details }, undefined, {
      actionContainer,
      onDraftStateChange,
    });
    expect(
      screen.getByRole("heading", { name: "Prepare your request" }),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(onDraftStateChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(operations).toEqual([]);
    if (actionContainer) expect(actionContainer).toContainElement(screen.getByRole("button", { name: "Create my request" }));
    await user.click(
      screen.getByRole("button", { name: "Create my request" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Adjuster or claims email" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(operations).toEqual([]);
    await user.type(
      screen.getByRole("textbox", { name: "Adjuster or claims email" }),
      "adjuster@example.com",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Claim or reference number" }),
      "CLM-42",
    );
    await user.click(
      screen.getByRole("button", { name: "Create my request" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Review and send your request" }),
    ).toBeVisible();
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("button", { name: "Create my request" })).not.toBeInTheDocument();
    expect(operations).toEqual(["details", "prepare"]);
    expect(payloads[0]).toMatchObject({
      adjusterEmailConfirmed: true,
      claimReferenceConfirmed: true,
      expectedRevision: 1,
      expectedWorkflowRevision: 7,
    });
    expect(payloads[1]).toMatchObject({ expectedWorkflowRevision: 10 });
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it.each(["result", "insurer_review", "valuation", "report", "what_next"] as const)(
    "does not create a draft or grant missing %s progress on a direct request visit",
    async (step) => {
      const progress = education();
      const operations: string[] = [];
      server.use(
        http.put(`${API}/education/:step`, () => {
          operations.push("education");
          return HttpResponse.json({ education: progress });
        }),
        http.put(`${API}/sending-details`, () => {
          operations.push("details");
          return HttpResponse.json({});
        }),
        http.post(`${API}/message/prepare`, () => {
          operations.push("prepare");
          return HttpResponse.json(prepared(draft()));
        }),
      );
      renderRequest(claim({
        messageDraft: null,
        education: {
          ...progress,
          steps: {
            ...progress.steps,
            [step]: { completedAt: null, skippedAt: null, viewedAt: null },
          },
        },
      }));
      expect(screen.getByRole("button", { name: "Create my request" })).toBeDisabled();
      const form = screen.getByRole("heading", { name: "Prepare your request" }).closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Complete the review before preparing your request.",
      );
      expect(operations).toEqual([]);
      expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    },
  );

  it("does not apply acknowledgements belonging to a different report version", () => {
    renderRequest(claim({
      messageDraft: null,
      education: { ...education(), reportVersionId: "99999999-9999-4999-8999-999999999999" },
    }));
    expect(screen.getByRole("button", { name: "Create my request" })).toBeDisabled();
  });

  it("uses refreshed review progress and the current workflow revision for preparation", async () => {
    const attempts: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API}/message/prepare`, async ({ request }) => {
        attempts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(prepared(draft(), 13));
      }),
    );
    const user = userEvent.setup();
    const rendered = renderRequest(claim({ messageDraft: null, education: education(false) }));
    expect(screen.getByRole("button", { name: "Create my request" })).toBeDisabled();
    const refreshed = claim({ messageDraft: null });
    rendered.refresh({
      ...refreshed,
      workflow: { ...refreshed.workflow!, revision: 12 },
    });
    await user.click(screen.getByRole("button", { name: "Create my request" }));
    expect(await screen.findByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ expectedWorkflowRevision: 12 });
  });

  it("never opens a stale draft belonging to another published report", () => {
    renderRequest(
      claim({
        messageDraft: draft({
          reportVersionId: "99999999-9999-4999-8999-999999999999",
          revision: 99,
        }),
      }),
    );
    expect(screen.getByRole("heading", { name: "Prepare your request" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Review and send your request" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });

  it("rejects a generated draft for another report and can retry safely", async () => {
    const staleReportId = "99999999-9999-4999-8999-999999999999";
    let attempts = 0;
    server.use(
      http.post(`${API}/message/prepare`, () => {
        attempts += 1;
        if (attempts === 1) {
          const staleDraft = draft({ reportVersionId: staleReportId });
          const response = prepared(staleDraft);
          return HttpResponse.json({
            ...response,
            messageVersion: {
              ...response.messageVersion,
              reportVersionId: staleReportId,
            },
          });
        }
        return HttpResponse.json(prepared(draft()));
      }),
    );
    const user = userEvent.setup();
    renderRequest(claim({ messageDraft: null }));
    await user.click(screen.getByRole("button", { name: "Create my request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t create your request draft.",
    );
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create my request" }));
    expect(await screen.findByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  it("reuses confirmed case facts without asking for them again", () => {
    renderRequest(claim({ messageDraft: null }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("adjuster@example.com")).toBeVisible();
    expect(screen.getByText("CLM-42")).toBeVisible();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("We’ll prepare an editable email asking the insurer to review its valuation using the market evidence and respond in writing.")).toBeVisible();
    expect(screen.queryByText("You can review and edit the email before sending it. Nothing is sent automatically.")).not.toBeInTheDocument();
  });

  it("explains both requests for a manual case without claiming an insurer report was reviewed", () => {
    renderRequest(claim({ messageDraft: null }), undefined, { intakeMode: "manual" });
    expect(screen.getByText("We’ll prepare an editable email asking the insurer to review the offer using the attached market evidence and respond in writing. If you also want the insurer’s full valuation report—including the comparable vehicles and adjustments used—add that request to the draft before sending.")).toBeVisible();
    expect(screen.queryByText("Nothing is sent automatically. You’ll send the email from your own account.")).not.toBeInTheDocument();
    expect(screen.queryByText(/review its valuation/u)).not.toBeInTheDocument();
    expect(screen.getByText("Your valuation report contains the supporting valuation information and comparable-vehicle evidence. You’ll attach it when you send the email from your email app.")).toBeVisible();
  });

  it("keeps the evidence available with one manual attachment reminder", () => {
    renderRequest();
    expect(screen.getByText("Attach this PDF in your email app before sending.")).toBeVisible();
    const evidence = screen.getByRole("region", { name: "Valuation report" });
    expect(within(evidence).getByRole("button", { name: "View report" })).toBeEnabled();
    expect(within(evidence).getByRole("button", { name: "Download report" })).toBeEnabled();
    expect(screen.queryByText(report().suggestedFilename)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  });

  it("offers an in-place retry when saved sending details are unavailable", async () => {
    const onRefresh = vi.fn(async () => undefined);
    renderRequest(claim({ messageDraft: null, sendingDetails: null }), onRefresh);

    expect(screen.getByRole("alert")).toHaveTextContent("Sending details are temporarily unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Create my request" })).toBeDisabled();
  });

  it("saves owner-voiced generated copy before preparing or copying the email", async () => {
    let saved = draft({
      body: "Hello Claims Representative,\n\nI am requesting that Unavailable provide written reconsideration of the vehicle valuation for claim CLM-42.\n\nThe insurer valuation reviewed was $19046. The enclosed Venfour Total-Loss Valuation Evidence Package supports an advertised-price range of $19800 to $22263, subject to the assumptions and limitations stated in the report.\n\nI have attached Venfour_Valuation_Evidence_Synthetic_v1.pdf.",
    });
    let patchCalls = 0;
    server.use(
      http.patch(`${API}/message-draft`, async ({ request }) => {
        const input = (await request.json()) as {
          body: string;
          subject: string;
          recipient: string;
        };
        saved = { ...saved, ...input, revision: 2 };
        patchCalls += 1;
        return HttpResponse.json(saved);
      }),
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(saved)),
      ),
    );
    const user = userEvent.setup();
    const copied = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderRequest(claim({ messageDraft: saved }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Hello Claims Representative,\n\nI am requesting written reconsideration of the vehicle valuation for claim CLM-42.\n\nThe insurer’s valuation was $19046. The attached market evidence includes advertised prices from $19800 to $22263, subject to the assumptions and limitations stated in the report.\n\nI have attached the market evidence report.",
    );
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    expect(await screen.findByText(/Email copied/u)).toBeVisible();
    expect(patchCalls).toBe(1);
    expect(copied).toHaveBeenCalledWith(
      expect.not.stringContaining("Unavailable"),
    );
    expect(copied).toHaveBeenCalledWith(expect.not.stringContaining("Venfour"));
    expect(saved.body).toContain("I have attached the market evidence report.");
  });

  it("finishes a new draft repair after an uncertain save without displaying the placeholder", async () => {
    const generated = draft({
      body: "I am requesting that Unavailable provide written reconsideration of the vehicle valuation for claim CLM-42.",
    });
    let saved = generated;
    let saves = 0;
    let reads = 0;
    const progress = education(false);
    const completed = { completedAt: NOW, viewedAt: NOW, skippedAt: null };
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(generated)),
      ),
      http.patch(`${API}/message-draft`, async ({ request }) => {
        const input = (await request.json()) as {
          body: string;
          subject: string;
          recipient: string;
        };
        saves += 1;
        saved = { ...generated, ...input, revision: 2 };
        return HttpResponse.json(
          { detail: "response unavailable" },
          { status: 503 },
        );
      }),
      http.get(`${API}/message-draft`, () => {
        reads += 1;
        return HttpResponse.json(saved);
      }),
    );
    const user = userEvent.setup();
    renderRequest(
      claim({
        messageDraft: null,
        education: {
          ...progress,
          steps: {
            ...progress.steps,
            result: completed,
            what_next: { completedAt: null, viewedAt: NOW, skippedAt: NOW },
          },
        },
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create my request" }),
    );
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveValue(
      "I am requesting written reconsideration of the vehicle valuation for claim CLM-42.",
    );
    expect(saves).toBe(1);
    expect(reads).toBe(1);
    expect(screen.queryByText(/Unavailable/u)).not.toBeInTheDocument();
  });

  it("preserves customer edits while repairing the exact generated placeholder at a later revision", () => {
    const body =
      "My opening note. I am requesting that Unavailable provide written reconsideration of the vehicle valuation. My closing note.";
    renderRequest(claim({ messageDraft: draft({ revision: 2, body }) }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "My opening note. I am requesting written reconsideration of the vehicle valuation. My closing note.",
    );
  });

  it("serializes autosaves without losing edits made while the first save is pending", async () => {
    let saved = draft();
    const requests: { subject: string; expectedRevision: number }[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(`${API}/message-draft`, async ({ request }) => {
        const input = (await request.json()) as {
          body: string;
          subject: string;
          recipient: string;
          expectedRevision: number;
        };
        requests.push(input);
        if (requests.length === 1) await held;
        saved = { ...saved, ...input, revision: saved.revision + 1 };
        return HttpResponse.json(saved);
      }),
    );
    renderRequest();
    const subject = screen.getByRole("textbox", { name: "Subject" });
    fireEvent.change(subject, { target: { value: "First edit" } });
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 2000 });
    expect(screen.getByText("Saving…")).toBeVisible();
    fireEvent.change(subject, {
      target: { value: "Latest edit while saving" },
    });
    expect(requests).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(
      requests.map(({ subject: value, expectedRevision }) => ({
        subject: value,
        expectedRevision,
      })),
    ).toEqual([
      { subject: "First edit", expectedRevision: 1 },
      { subject: "Latest edit while saving", expectedRevision: 2 },
    ]);
    expect(subject).toHaveValue("Latest edit while saving");
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("restores the completed save after leaving and remounting before its response arrives", async () => {
    let saved = draft();
    let saveStarted = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(`${API}/message-draft`, async ({ request }) => {
        const input = (await request.json()) as {
          body: string;
          subject: string;
          recipient: string;
        };
        saveStarted = true;
        await held;
        saved = { ...saved, ...input, revision: 2 };
        return HttpResponse.json(saved);
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    function RequestMountHarness() {
      const [showRequest, setShowRequest] = useState(true);
      const query = useQuery({
        queryKey: totalLossClaimQueryKeys.detail(USER_ID, CASE_ID),
        queryFn: async () => claim({ messageDraft: saved }),
        initialData: claim(),
      });
      return (
        <>
          <button onClick={() => setShowRequest(false)}>
            Leave request
          </button>
          <button onClick={() => setShowRequest(true)}>Return to request</button>
          {showRequest && (
            <MessagePreparation
              accessToken="request-test-token"
              caseId={CASE_ID}
              claim={query.data}
              onRefresh={() => query.refetch()}
              report={report()}
              userId={USER_ID}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={createMemoryRouter([{ path: "*", element: <RequestMountHarness /> }])} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "Saved while away" },
    });
    await waitFor(() => expect(saveStarted).toBe(true), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Leave request" }));
    await user.click(screen.getByRole("button", { name: "Return to request" }));
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
      "Saved while away",
    );
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
        "Saved while away",
      ),
    );
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it.each(["inline", "footer"] as const)("flushes edits before copying and confirms only the exact version with the %s action", async (placement) => {
    let saved = draft();
    const order: string[] = [];
    let sentPayload: Record<string, unknown> | null = null;
    let sentCalls = 0;
    let releaseSent!: () => void;
    const sentResponse = new Promise<void>((resolve) => {
      releaseSent = resolve;
    });
    server.use(
      http.patch(`${API}/message-draft`, async ({ request }) => {
        const input = (await request.json()) as {
          body: string;
          subject: string;
          recipient: string;
          expectedRevision: number;
        };
        expect(input.expectedRevision).toBe(1);
        order.push("save");
        saved = { ...saved, ...input, revision: 2 };
        return HttpResponse.json(saved);
      }),
      http.post(`${API}/message/prepare`, () => {
        order.push("prepare");
        return HttpResponse.json(prepared(saved));
      }),
      http.post(`${API}/message/sent`, async ({ request }) => {
        sentCalls += 1;
        sentPayload = (await request.json()) as Record<string, unknown>;
        await sentResponse;
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    const copied = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const onSent = vi.fn();
    const actionContainer = placement === "footer" ? renderRequestFooter() : undefined;
    renderRequest(undefined, undefined, { actionContainer, onSent });
    const openAction = screen.getByRole("button", { name: "Open email app" });
    if (actionContainer) {
      expect(actionContainer).toContainElement(openAction);
      expect(actionContainer).not.toContainElement(screen.getByRole("button", { name: "Copy email" }));
    }
    expect(
      screen.queryByRole("button", { name: "Mark as sent" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "Updated subject" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "My exact updated request." },
    });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    const confirmation = await screen.findByRole("heading", { level: 2, name: "Sent the email with the report attached?" });
    expect(confirmation).toBeVisible();
    expect(confirmation).toHaveFocus();
    expect(order).toEqual(["save", "prepare"]);
    expect(copied).toHaveBeenCalledWith(
      "Subject: Updated subject\n\nMy exact updated request.",
    );
    expect(sentCalls).toBe(0);
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open email app" })).not.toBeInTheDocument();
    const confirmAction = screen.getByRole("button", { name: "Mark as sent" });
    expect(confirmAction).toHaveAccessibleDescription("Sent the email with the report attached?");
    if (actionContainer) expect(actionContainer).toContainElement(confirmAction);
    const acknowledgement = screen.getByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT });
    expect(acknowledgement).not.toBeChecked();
    expect(confirmAction).toBeDisabled();
    await user.click(confirmAction);
    expect(sentCalls).toBe(0);
    await user.click(acknowledgement);
    expect(confirmAction).toBeEnabled();
    await user.dblClick(confirmAction);
    await waitFor(() => expect(sentCalls).toBe(1));
    expect(screen.getByRole("button", { name: "Recording…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy email" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    expect(acknowledgement).toBeDisabled();
    expect(onSent).not.toHaveBeenCalled();
    await act(async () => releaseSent());
    expect(
      await screen.findByRole("heading", { name: "Request marked as sent" }),
    ).toBeVisible();
    expect(sentCalls).toBe(1);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(sentPayload).toMatchObject({
      confirmedReportAttached: true,
      expectedWorkflowRevision: 8,
      messageVersionId: VERSION_ID,
    });
  });

  it.each(["inline", "footer"] as const)("opens email with the %s keyboard action and restores focus after Not yet", async (placement) => {
    let opened = 0;
    let sentCalls = 0;
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
      http.post(`${API}/message/opened`, () => {
        opened += 1;
        return HttpResponse.json({ accepted: true });
      }),
      http.post(`${API}/message/sent`, () => {
        sentCalls += 1;
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    const actionContainer = placement === "footer" ? renderRequestFooter() : undefined;
    renderRequest(undefined, undefined, { actionContainer });
    const openAction = screen.getByRole("button", { name: "Open email app" });
    if (actionContainer) expect(actionContainer).toContainElement(openAction);
    openAction.focus();
    await user.keyboard("{Enter}");
    const confirmAction = await screen.findByRole("button", { name: "Mark as sent" });
    expect(confirmAction).toBeVisible();
    expect(confirmAction).not.toHaveFocus();
    expect(screen.getByRole("heading", { name: "Sent the email with the report attached?" })).toHaveFocus();
    expect(openAction).not.toBeInTheDocument();
    if (actionContainer) expect(actionContainer).toContainElement(confirmAction);
    expect(openDefaultEmailApp).toHaveBeenCalledWith(
      expect.stringContaining("mailto:adjuster%40example.com?"),
    );
    await waitFor(() => expect(opened).toBe(1));
    expect(sentCalls).toBe(0);
    await user.tab();
    const acknowledgement = screen.getByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT });
    expect(acknowledgement).toHaveFocus();
    expect(acknowledgement).not.toBeChecked();
    expect(confirmAction).toBeDisabled();
    await user.keyboard(" ");
    expect(acknowledgement).toBeChecked();
    expect(confirmAction).toBeEnabled();
    await user.tab();
    expect(screen.getByRole("button", { name: "Not yet" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      screen.queryByRole("button", { name: "Mark as sent" }),
    ).not.toBeInTheDocument();
    const restoredOpenAction = screen.getByRole("button", { name: "Open email app" });
    expect(restoredOpenAction).toBeVisible();
    expect(restoredOpenAction).toHaveFocus();
    if (actionContainer) expect(actionContainer).toContainElement(restoredOpenAction);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
    expect(sentCalls).toBe(0);
  });

  it("locks footer actions while preparing the email and never treats a repeated click as sent", async () => {
    let prepareCalls = 0;
    let sentCalls = 0;
    let releasePrepare!: () => void;
    const prepareResponse = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    server.use(
      http.post(`${API}/message/prepare`, async () => {
        prepareCalls += 1;
        await prepareResponse;
        return HttpResponse.json(prepared(draft()));
      }),
      http.post(`${API}/message/opened`, () => HttpResponse.json({ accepted: true })),
      http.post(`${API}/message/sent`, () => {
        sentCalls += 1;
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    const actionContainer = renderRequestFooter();
    renderRequest(undefined, undefined, { actionContainer });
    const openAction = within(actionContainer).getByRole("button", { name: "Open email app" });
    await user.dblClick(openAction);
    await waitFor(() => expect(prepareCalls).toBe(1));
    expect(within(actionContainer).getByRole("button", { name: "Preparing email…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy email" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
    expect(openDefaultEmailApp).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    expect(prepareCalls).toBe(1);

    await act(async () => releasePrepare());
    const confirmAction = await within(actionContainer).findByRole("button", { name: "Mark as sent" });
    expect(confirmAction).toBeDisabled();
    expect(confirmAction).not.toHaveFocus();
    expect(screen.getByRole("heading", { name: "Sent the email with the report attached?" })).toHaveFocus();
    expect(openAction).not.toBeInTheDocument();
    expect(openDefaultEmailApp).toHaveBeenCalledTimes(1);
    expect(sentCalls).toBe(0);
  });

  it("ignores a second footer click after Open is replaced by sent confirmation", async () => {
    let sentCalls = 0;
    server.use(
      http.post(`${API}/message/prepare`, () => HttpResponse.json(prepared(draft()))),
      http.post(`${API}/message/opened`, () => HttpResponse.json({ accepted: true })),
      http.post(`${API}/message/sent`, () => {
        sentCalls += 1;
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    const actionContainer = renderRequestFooter();
    renderRequest(undefined, undefined, { actionContainer });
    await user.click(within(actionContainer).getByRole("button", { name: "Open email app" }));
    const nextAction = await within(actionContainer).findByRole("button", { name: "Mark as sent" });
    await user.dblClick(nextAction);
    expect(nextAction).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT })).not.toBeChecked();
    expect(screen.getByRole("heading", { name: "Review and send your request" })).toBeVisible();
    expect(sentCalls).toBe(0);
  });

  it("keeps the open-email action when copying fails instead of offering sent confirmation", async () => {
    server.use(
      http.post(`${API}/message/prepare`, () => HttpResponse.json(prepared(draft()))),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard unavailable"));
    const actionContainer = renderRequestFooter();
    renderRequest(undefined, undefined, { actionContainer });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t copy the email.");
    expect(within(actionContainer).getByRole("button", { name: "Open email app" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  });

  it("requires a fresh acknowledgement when the same prepared email is copied again", async () => {
    let prepareCalls = 0;
    let sentCalls = 0;
    server.use(
      http.post(`${API}/message/prepare`, () => {
        prepareCalls += 1;
        return HttpResponse.json(prepared(draft()));
      }),
      http.post(`${API}/message/sent`, () => {
        sentCalls += 1;
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const actionContainer = renderRequestFooter();
    renderRequest(undefined, undefined, { actionContainer });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    expect(within(actionContainer).getByRole("button", { name: "Mark as sent" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy email" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT })).not.toBeChecked();
    const confirmAction = within(actionContainer).getByRole("button", { name: "Mark as sent" });
    expect(confirmAction).toBeDisabled();
    await user.click(confirmAction);
    expect(prepareCalls).toBe(2);
    expect(sentCalls).toBe(0);
  });

  it("never reuses acknowledgement after editing and preparing a new message version", async () => {
    const nextVersionId = "99999999-9999-4999-8999-999999999999";
    let saved = draft();
    let prepareCalls = 0;
    const sentPayloads: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${API}/message-draft`, async ({ request }) => {
        const input = (await request.json()) as { body: string; subject: string; recipient: string };
        saved = { ...saved, ...input, revision: saved.revision + 1 };
        return HttpResponse.json(saved);
      }),
      http.post(`${API}/message/prepare`, () => {
        prepareCalls += 1;
        const response = prepared(saved, 7 + prepareCalls);
        return HttpResponse.json({
          ...response,
          messageVersion: {
            ...response.messageVersion,
            messageVersionId: prepareCalls === 1 ? VERSION_ID : nextVersionId,
          },
        });
      }),
      http.post(`${API}/message/sent`, async ({ request }) => {
        sentPayloads.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...sentResult(), messageVersionId: nextVersionId });
      }),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const actionContainer = renderRequestFooter();
    renderRequest(undefined, undefined, { actionContainer });
    const message = screen.getByRole("textbox", { name: "Message" });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    expect(within(actionContainer).getByRole("button", { name: "Mark as sent" })).toBeEnabled();

    await user.click(message);
    await user.type(message, " Revised.");
    expect(message).toHaveFocus();
    expect(screen.queryByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    const acknowledgement = await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT });
    expect(acknowledgement).not.toBeChecked();
    const confirmAction = within(actionContainer).getByRole("button", { name: "Mark as sent" });
    expect(confirmAction).toBeDisabled();
    await user.click(confirmAction);
    expect(sentPayloads).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Message" })).toBe(message);
    expect(message).toHaveValue(`${draft().body} Revised.`);

    await user.click(acknowledgement);
    await user.click(confirmAction);
    expect(await screen.findByRole("heading", { name: "Request marked as sent" })).toBeVisible();
    expect(prepareCalls).toBe(2);
    expect(sentPayloads).toEqual([expect.objectContaining({
      confirmedReportAttached: true,
      expectedWorkflowRevision: 9,
      messageVersionId: nextVersionId,
    })]);
  });

  it("invalidates sent confirmation when the customer changes the copied draft", async () => {
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const actionContainer = renderRequestFooter();
    renderRequest(undefined, undefined, { actionContainer });
    const message = screen.getByRole("textbox", { name: "Message" });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    expect(
      await screen.findByRole("button", { name: "Mark as sent" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sent the email with the report attached?" })).toHaveFocus();
    await user.click(message);
    await user.type(message, " Updated.");
    expect(screen.getByRole("textbox", { name: "Message" })).toBe(message);
    expect(message).toHaveFocus();
    expect(message).toHaveValue(`${draft().body} Updated.`);
    const restoredOpenAction = screen.getByRole("button", { name: "Open email app" });
    expect(actionContainer).toContainElement(restoredOpenAction);
    expect(restoredOpenAction).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Subject" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "" },
    });
    expect(
      screen.queryByRole("button", { name: "Mark as sent" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy email" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Subject" }),
    ).toHaveAccessibleDescription("Add an email subject.");
    fireEvent.change(screen.getByRole("textbox", { name: "Recipient" }), {
      target: { value: "invalid email" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "" },
    });
    expect(screen.getByRole("textbox", { name: "Recipient" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Recipient" }),
    ).toHaveAccessibleDescription("Enter a valid recipient email address.");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Message" }),
    ).toHaveAccessibleDescription("Add an email message.");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(
      screen.getByText(/Invalid changes won’t be saved until corrected/u),
    ).toBeVisible();
  });

  it("recovers a failed autosave through a safe read and retry", async () => {
    let attempts = 0;
    let reads = 0;
    server.use(
      http.patch(`${API}/message-draft`, async ({ request }) => {
        attempts += 1;
        if (attempts === 1)
          return HttpResponse.json(
            { detail: "private database error" },
            { status: 503 },
          );
        const input = (await request.json()) as {
          body: string;
          subject: string;
          recipient: string;
          expectedRevision: number;
        };
        expect(input.expectedRevision).toBe(1);
        return HttpResponse.json(draft({ ...input, revision: 2 }));
      }),
      http.get(`${API}/message-draft`, () => {
        reads += 1;
        return HttpResponse.json(draft());
      }),
    );
    const user = userEvent.setup();
    renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "Retry this subject" },
    });
    expect(
      await screen.findByRole(
        "button",
        { name: "Retry save" },
        { timeout: 2000 },
      ),
    ).toBeVisible();
    expect(screen.queryByText(/private database/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(reads).toBe(1);
    expect(attempts).toBe(2);
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
      "Retry this subject",
    );
  });

  it("does not overwrite a concurrently saved draft when retrying", async () => {
    let patches = 0;
    server.use(
      http.patch(`${API}/message-draft`, () => {
        patches += 1;
        return HttpResponse.json({ detail: "changed" }, { status: 409 });
      }),
      http.get(`${API}/message-draft`, () =>
        HttpResponse.json(
          draft({ subject: "Saved from another tab", revision: 2 }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderRequest();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "My local edit" },
    });
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Retry save" },
        { timeout: 2000 },
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Load saved draft" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy email" })).toBeDisabled();
    expect(patches).toBe(1);
    await user.click(screen.getByRole("button", { name: "Load saved draft" }));
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
      "Saved from another tab",
    );
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("refreshes authoritative state after an uncertain sent response", async () => {
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
      http.post(`${API}/message/sent`, () =>
        HttpResponse.json({ detail: "changed" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const onRefresh = vi.fn(async () => {
      rendered.refresh(
        claim({
          negotiationHistory: [{
            negotiationRoundId: sentResult().negotiationRoundId,
            roundNumber: 1,
            outbound: { ...prepared(draft()).messageVersion, recipient: draft().recipient!, ...sentResult(), state: "sent" },
            responses: [], followUp: null, supersededFollowUpDrafts: [],
          }],
          journey: {
            nextState: "awaiting_insurer_response",
            fulfillmentState: "awaiting_insurer_response",
            retryable: false,
          },
        }),
      );
    });
    const rendered = renderRequest(claim(), onRefresh);
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    await user.click(
      await screen.findByRole("button", { name: "Mark as sent" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Request marked as sent" }),
    ).toBeVisible();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not report sent success when confirmation fails", async () => {
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
      http.post(`${API}/message/sent`, () =>
        HttpResponse.json({ detail: "changed" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const onSent = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    renderRequest(claim(), onRefresh, { onSent });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    await user.click(await screen.findByRole("button", { name: "Mark as sent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t record that the request was sent.",
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Review and send your request" })).toBeVisible();
  });

  it("reports persisted sent success even if the following refresh is unavailable", async () => {
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
      http.post(`${API}/message/sent`, () => HttpResponse.json(sentResult())),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const onSent = vi.fn();
    const onRefresh = vi.fn(async () => {
      throw new Error("Refresh unavailable");
    });
    renderRequest(claim(), onRefresh, { onSent });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    await user.click(await screen.findByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Request marked as sent" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("finishes sent persistence without navigating after the request editor is left", async () => {
    let sentCalls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
      http.post(`${API}/message/sent`, async () => {
        sentCalls += 1;
        await pending;
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const onSent = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    const rendered = renderRequest(claim(), onRefresh, { onSent });
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    await user.click(await screen.findByRole("checkbox", { name: SENT_ACKNOWLEDGEMENT }));
    await user.click(await screen.findByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(sentCalls).toBe(1));
    rendered.unmount();
    await act(async () => release());
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onSent).not.toHaveBeenCalled();
  });
});
