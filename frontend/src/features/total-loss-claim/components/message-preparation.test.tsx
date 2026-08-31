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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessagePreparation } from "@/features/total-loss-claim/components/message-preparation";
import { openDefaultEmailApp } from "@/features/total-loss-claim/browser-actions";
import type * as RequestBrowserActions from "@/features/total-loss-claim/browser-actions";
import { TOTAL_LOSS_EDUCATION_STEPS } from "@/features/total-loss-claim/contracts";
import type {
  TotalLossClaimSecured,
  TotalLossEducationProjection,
  TotalLossMessageDraft,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import { server } from "@/test/mocks/server";
import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";

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
    readonly onDraftStateChange?: (hasDraft: boolean) => void;
    readonly onSent?: () => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const view = (current: TotalLossClaimSecured) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessagePreparation
          {...callbacks}
          accessToken="request-test-token"
          caseId={CASE_ID}
          claim={current}
          onRefresh={onRefresh}
          report={report()}
          userId={USER_ID}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view(initial));
  return {
    ...result,
    refresh: (current: TotalLossClaimSecured) => result.rerender(view(current)),
    onRefresh,
  };
}

beforeEach(() => {
  vi.mocked(openDefaultEmailApp).mockReset();
});

describe("case request preparation", () => {
  it("requires only missing sending details after completed review without changing education", async () => {
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
    renderRequest({ ...initial, sendingDetails: details }, undefined, {
      onDraftStateChange,
    });
    expect(
      screen.getByRole("heading", { name: "Prepare your request" }),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(onDraftStateChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(operations).toEqual([]);
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
      await screen.findByRole("heading", { level: 1, name: "Review and send" }),
    ).toBeVisible();
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);
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
    expect(await screen.findByRole("heading", { name: "Review and send" })).toBeVisible();
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
    expect(screen.queryByRole("heading", { name: "Review and send" })).not.toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "Review and send" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  it("reuses confirmed case facts without asking for them again", () => {
    renderRequest(claim({ messageDraft: null }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("adjuster@example.com")).toBeVisible();
    expect(screen.getByText("CLM-42")).toBeVisible();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
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
        <MemoryRouter>
          <RequestMountHarness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "Saved while away" },
    });
    await waitFor(() => expect(saveStarted).toBe(true), { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Leave request" }));
    await user.click(screen.getByRole("button", { name: "Return to request" }));
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
      draft().subject,
    );
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
        "Saved while away",
      ),
    );
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("flushes the latest edit before copying and marks only the exact copied version as sent", async () => {
    let saved = draft();
    const order: string[] = [];
    let sentPayload: Record<string, unknown> | null = null;
    let sentCalls = 0;
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
        return HttpResponse.json(sentResult());
      }),
    );
    const user = userEvent.setup();
    const copied = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const onSent = vi.fn();
    renderRequest(undefined, undefined, { onSent });
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
    expect(
      await screen.findByText("Sent the email with the report attached?"),
    ).toBeVisible();
    expect(order).toEqual(["save", "prepare"]);
    expect(copied).toHaveBeenCalledWith(
      "Subject: Updated subject\n\nMy exact updated request.",
    );
    expect(sentCalls).toBe(0);
    expect(onSent).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Open email" }),
    ).toBeVisible();
    await user.dblClick(screen.getByRole("button", { name: "Mark as sent" }));
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

  it("opens the email app without marking sent and lets the customer choose Not yet", async () => {
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
    renderRequest();
    await user.click(screen.getByRole("button", { name: "Open email" }));
    expect(
      await screen.findByRole("button", { name: "Mark as sent" }),
    ).toBeVisible();
    expect(openDefaultEmailApp).toHaveBeenCalledWith(
      expect.stringContaining("mailto:adjuster%40example.com?"),
    );
    await waitFor(() => expect(opened).toBe(1));
    expect(sentCalls).toBe(0);
    await user.click(screen.getByRole("button", { name: "Not yet" }));
    expect(
      screen.queryByRole("button", { name: "Mark as sent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open email" }),
    ).toBeVisible();
  });

  it("invalidates sent confirmation when the customer changes the copied draft", async () => {
    server.use(
      http.post(`${API}/message/prepare`, () =>
        HttpResponse.json(prepared(draft())),
      ),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderRequest();
    await user.click(screen.getByRole("button", { name: "Copy email" }));
    expect(
      await screen.findByRole("button", { name: "Mark as sent" }),
    ).toBeVisible();
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
    await user.click(await screen.findByRole("button", { name: "Mark as sent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t record that the request was sent.",
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Review and send" })).toBeVisible();
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
    await user.click(await screen.findByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(sentCalls).toBe(1));
    rendered.unmount();
    await act(async () => release());
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onSent).not.toHaveBeenCalled();
  });
});
