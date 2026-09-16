import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { confirmTotalLossMessageSent, getTotalLossClaim, getTotalLossReportDownload, prepareTotalLossMessage, recordTotalLossInsurerResponse, updateTotalLossMessageDraft, updateTotalLossSendingDetails } from "@/features/total-loss-claim/api";
import { CASE_ID, REPORT_ID } from "./claim-fixtures";
import { messageCasePath, messagePreview, resetMessagePreview } from "./message-flow";
import type { MessageScenario } from "./message-flow";

let phase: MessageScenario;
beforeEach(() => {
  sessionStorage.clear();
  phase = "message";
  resetMessagePreview(phase);
  server.use(http.all(`*${messageCasePath}/*`, async ({ request }) => {
    const body = request.method === "GET" ? {} : await request.json();
    const path = new URL(request.url).pathname.slice(messageCasePath.length);
    const reply = messagePreview(phase).handle(path, request.method, body as Record<string, unknown>);
    return HttpResponse.json(reply?.data ?? {}, { status: reply?.status ?? 404 });
  }));
});

describe("interactive message preview", () => {
  it("uses the vehicle subject when no claim number is available", async () => {
    phase = "message-details";
    resetMessagePreview(phase);
    const initial = messagePreview(phase).claim;
    const details = await updateTotalLossSendingDetails(CASE_ID, "preview", {
      adjusterName: null, adjusterEmail: "claims@example.com", adjusterEmailConfirmed: true,
      claimReference: null, claimReferenceConfirmed: false,
      expectedRevision: initial.sendingDetails!.revision, expectedWorkflowRevision: initial.workflow!.revision,
    });
    expect(details.sendingDetails.claimReferenceConfirmed).toBe(false);
    const generated = await prepareTotalLossMessage(CASE_ID, "preview", crypto.randomUUID(), details.workflowRevision);
    expect(generated.draft.subject).toBe("Vehicle valuation review — 2026 Hyundai Kona");
    expect(generated.messageVersion.body).toBe(generated.draft.body);
  });

  it("saves an inline response once, preserves its original text, and keeps corrections linked", async () => {
    phase = "waiting";
    resetMessagePreview(phase);
    const waiting = messagePreview(phase).claim;
    const input = {
      clientRequestId: crypto.randomUUID(), documentId: null, retainedDocumentId: null, supersedesResponseId: null,
      expectedWorkflowRevision: waiting.workflow!.revision, outboundCommunicationId: waiting.responseIntake!.outboundCommunicationId,
      responseText: "  Our fictional revised offer is $20,500.\n", revisedOfferMinorUnits: 2050000,
    };
    const result = await recordTotalLossInsurerResponse(CASE_ID, "preview", input);
    const retry = await recordTotalLossInsurerResponse(CASE_ID, "preview", input);
    expect(retry).toEqual(result);
    expect(result.response.text).toBe(input.responseText);
    const saved = await getTotalLossClaim(CASE_ID, "preview");
    if (saved.state !== "secured") throw new Error("Expected a secured example");
    expect(saved.responseIntake).toBeNull();
    expect(saved.journey?.nextState).toBe("insurer_response_received");
    expect(saved.negotiationHistory![0].responses).toHaveLength(1);
    expect(saved.insurerResponse?.revisedOffer?.amountMinorUnits).toBe(2050000);
    await expect(recordTotalLossInsurerResponse(CASE_ID, "preview", { ...input, clientRequestId: crypto.randomUUID() })).rejects.toThrow();
    const corrected = await recordTotalLossInsurerResponse(CASE_ID, "preview", {
      ...input, clientRequestId: crypto.randomUUID(), expectedWorkflowRevision: result.workflowRevision,
      supersedesResponseId: result.response.responseId, revisedOfferMinorUnits: 2100000,
    });
    expect(corrected.response.supersedesResponseId).toBe(result.response.responseId);
    const history = messagePreview(phase).claim.negotiationHistory![0].responses;
    expect(history).toHaveLength(2);
    expect(history[0].text).toBe(input.responseText);
    expect(history[0].canCorrect).toBe(false);
  });

  it("opens waiting with a saved fictional message and report, survives reload, and restarts cleanly", async () => {
    phase = "waiting";
    resetMessagePreview(phase);
    const saved = await getTotalLossClaim(CASE_ID, "preview");
    if (saved.state !== "secured") throw new Error("Expected a secured example");
    const message = saved.negotiationHistory![0].outbound;
    expect(saved.journey?.nextState).toBe("awaiting_insurer_response");
    expect(message.body).toBe(saved.messageDraft!.body);
    expect(message.state).toBe("sent");
    expect(saved.responseIntake?.outboundCommunicationId).toBe(message.communicationId);
    expect(messagePreview(phase).claim.negotiationHistory![0].outbound).toEqual(message);
    expect((await getTotalLossReportDownload(CASE_ID, REPORT_ID, "preview")).suggestedFilename).toBe("Sample_Valuation_Report.pdf");
    resetMessagePreview(phase);
    expect(messagePreview(phase).claim.journey?.nextState).toBe("awaiting_insurer_response");
    expect(messagePreview(phase).claim.negotiationHistory![0].outbound.communicationId).not.toBe(message.communicationId);
    const restarted = await getTotalLossClaim(CASE_ID, "preview");
    if (restarted.state !== "secured") throw new Error("Expected a secured example");
    expect(restarted.insurerResponse ?? null).toBeNull();
  });

  it("creates, edits, reloads, and confirms the exact message through the customer API contracts", async () => {
    const initial = await getTotalLossClaim(CASE_ID, "preview");
    expect(initial.state).toBe("secured");
    if (initial.state !== "secured") throw new Error("Expected a secured example");
    expect(initial.messageDraft).toBeNull();
    const report = await getTotalLossReportDownload(CASE_ID, REPORT_ID, "preview");
    expect(report.downloadUrl).toContain("/fixtures/message-preview-report.pdf");
    expect(report.suggestedFilename).toBe("Sample_Valuation_Report.pdf");
    const requestId = crypto.randomUUID();
    const generated = await prepareTotalLossMessage(CASE_ID, "preview", requestId, initial.workflow!.revision);
    const retry = await prepareTotalLossMessage(CASE_ID, "preview", requestId, initial.workflow!.revision);
    expect(retry.messageVersion.messageVersionId).toBe(generated.messageVersion.messageVersionId);
    const reopened = await prepareTotalLossMessage(CASE_ID, "preview", requestId, generated.workflowRevision);
    expect(reopened.messageVersion.messageVersionId).toBe(generated.messageVersion.messageVersionId);
    const edited = await updateTotalLossMessageDraft(CASE_ID, "preview", {
      subject: "Please check this example", body: "My edited fictional message.", recipient: "adjuster@example.com", expectedRevision: generated.draft.revision,
    });
    expect(messagePreview(phase).claim.messageDraft).toEqual(edited);
    const prepared = await prepareTotalLossMessage(CASE_ID, "preview", crypto.randomUUID(), generated.workflowRevision);
    const sent = await confirmTotalLossMessageSent(CASE_ID, "preview", {
      clientRequestId: crypto.randomUUID(), expectedWorkflowRevision: prepared.workflowRevision, messageVersionId: prepared.messageVersion.messageVersionId,
    });
    const saved = await getTotalLossClaim(CASE_ID, "preview");
    if (saved.state !== "secured") throw new Error("Expected a secured example");
    expect(saved.journey?.nextState).toBe("awaiting_insurer_response");
    expect(saved.negotiationHistory?.[0].outbound.body).toBe(edited.body);
    expect(saved.responseIntake?.outboundCommunicationId).toBe(sent.communicationId);
    expect(messagePreview(phase).handle("/message-draft", "PATCH", { ...edited, expectedRevision: edited.revision })?.status).toBe(409);
  });

  it("requires missing details and resets the local draft", async () => {
    phase = "message-details";
    resetMessagePreview(phase);
    const initial = messagePreview(phase).claim;
    expect(initial.sendingDetails?.adjusterEmail).toBeNull();
    await expect(prepareTotalLossMessage(CASE_ID, "preview", crypto.randomUUID(), initial.workflow!.revision)).rejects.toThrow();
    const details = await updateTotalLossSendingDetails(CASE_ID, "preview", {
      adjusterName: null, adjusterEmail: "claims@example.com", adjusterEmailConfirmed: true, claimReference: "DEMO-123", claimReferenceConfirmed: true,
      expectedRevision: initial.sendingDetails!.revision, expectedWorkflowRevision: initial.workflow!.revision,
    });
    const generated = await prepareTotalLossMessage(CASE_ID, "preview", crypto.randomUUID(), details.workflowRevision);
    expect(generated.draft.recipient).toBe("claims@example.com");
    expect(generated.draft.subject).toContain("DEMO-123");
    resetMessagePreview("message");
    expect(messagePreview("message").claim.messageDraft).toBeNull();
    expect(messagePreview("message").claim.sendingDetails?.claimReference).toBe("CLM-42");
  });

  it("rejects stale edits, stale message versions, and missing attachment confirmation", async () => {
    resetMessagePreview("send");
    const current = messagePreview("send").claim;
    const prepared = await prepareTotalLossMessage(CASE_ID, "preview", crypto.randomUUID(), current.workflow!.revision);
    const input = { clientRequestId: crypto.randomUUID(), expectedWorkflowRevision: prepared.workflowRevision, messageVersionId: prepared.messageVersion.messageVersionId };
    expect(messagePreview("send").handle("/message/sent", "POST", input)?.status).toBe(409);
    const content = { recipient: "adjuster@example.com", subject: "Updated subject", body: "Updated message", expectedRevision: prepared.draft.revision };
    await updateTotalLossMessageDraft(CASE_ID, "preview", content);
    await expect(updateTotalLossMessageDraft(CASE_ID, "preview", content)).rejects.toThrow();
    await expect(confirmTotalLossMessageSent(CASE_ID, "preview", input)).rejects.toThrow();
    expect(messagePreview("send").claim.education?.steps.send.completedAt).toBeNull();
  });
});
