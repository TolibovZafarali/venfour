import { communicationsService, type EmailHistory, type CommunicationsOverview } from "@/features/admin/communications/service";
import type { PaymentApprovalCase, PaymentApprovalService } from "@/features/admin/payment-approvals/service";
import { cases } from "./fixtures";

let mode = "populated";
const approvals: PaymentApprovalCase[] = cases.slice(2, 4).map((item, index) => ({
  caseId: item.caseId, customerId: item.ownerUserId, customerName: item.contactFullName,
  customerEmail: item.contactEmail, vehicle: index ? "2020 Subaru Outback Limited" : "2023 Mazda CX-5 Touring",
  insurerValuation: 18000, preliminaryOutcome: "CLEAR_MARKET_VALUE_GAP",
  classification: "MATERIAL_UNDERVALUE_SIGNAL", evidenceStrength: "STRONG",
  eligibleComparables: { current: 6, historical: 0 }, reportReady: true,
  limitations: [{ label: "Fictional evidence", description: "Local screen example. No actual review or payment authorization." }],
  lineage: {}, status: index ? "held" : "awaiting_approval", canApprove: true,
}));
async function result<T>(value: T): Promise<T> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error" || mode === "denied") throw new Error("Preview service unavailable.");
  return structuredClone(value);
}
export const paymentApprovalService: PaymentApprovalService = {
  list: () => result(mode === "empty" ? [] : approvals),
  async decide(item, decision) {
    if (mode === "save-error") throw new Error("Simulated save failure.");
    const index = approvals.findIndex(row => row.caseId === item.caseId);
    if (index < 0) throw new Error("Refresh the preview.");
    if (decision === "approved") approvals.splice(index, 1);
    else approvals[index].status = decision;
  },
};
const overview: CommunicationsOverview = {
  settings: { mode: "disabled", enrolled_after: null, activated_at: null, revision: 1 },
  automations: [], templates: [], activity: [], partner_activity: [], preview_activity: [], suppression_count: 0,
  configuration: { provider: "local_preview", mode: "disabled", error: null, auth_hook_enabled: false,
    webhook_configured: false, test_send_configured: false, app_origin: location.origin,
    identities: [{ name: "customer", from: "preview@example.test", reply_to: "support@example.test" }] },
};
for (const [key, subject, identity] of [
  ["review_ready", "Your valuation review is ready", "customer"],
  ["email_code", "Your sign-in code", "auth"],
  ["partner_invitation", "Your business invitation", "partner"],
]) {
  const text = "Fictional email preview. No message is sent.";
  overview.templates.push({ key, subject, heading: subject, paragraphs: [text], action: "Open workspace",
    category: "transactional", identity, trigger: "Local demonstration", version: "preview", interaction: "notice",
    details: [], attachment: "None", preview: { subject, text, version: "preview",
      html: `<html><body style="margin:0;background:#f5f6f7;padding:40px;font:16px/1.6 system-ui;color:#23352e"><p>VENFOUR · LOCAL PREVIEW</p><h1>${subject}</h1><p>${text}</p></body></html>` } });
  overview.automations.push({ template_key: key, enabled: false, delay_seconds: 0, category: "transactional", revision: 1 });
}
export function installStaffPreview(selectedMode: string) {
  mode = selectedMode;
  // All network services remain disconnected in this standalone fixture runtime.
  window.fetch = async () => { throw new Error("Network requests are disabled in the staff and business preview."); };
  const history: EmailHistory = { items: [
    { id: "preview-email-review", source: "customer", templateKey: "review_ready", recipient: "preview@example.test", subject: "Your valuation review is ready", status: "completed", attempts: 1, createdAt: "2026-09-23T12:00:00Z", acceptedAt: "2026-09-23T12:00:01Z", deliveryStatus: "delivered", caseId: cases[2].caseId },
    { id: "preview-email-partner", source: "partner", templateKey: "partner_invitation", recipient: "business@example.test", subject: "Your business invitation", status: "completed", attempts: 1, createdAt: "2026-09-23T11:00:00Z", acceptedAt: "2026-09-23T11:00:01Z", deliveryStatus: "accepted", caseId: null },
    { id: "preview-email-retry", source: "customer", templateKey: "review_ready", recipient: "retry@example.test", subject: "Your valuation review is ready", status: "failed", attempts: 2, createdAt: "2026-09-23T10:00:00Z", acceptedAt: null, deliveryStatus: "failed", caseId: cases[0].caseId },
  ] };
  communicationsService.history = () => result(mode === "empty" ? { items: [] } : history);
  communicationsService.overview = () => result(mode === "empty" ? { ...overview, templates: [] } : overview);
  communicationsService.operation = async <T>(_token: string, action: string, payload: Record<string, unknown>): Promise<T> => {
    if (mode === "save-error") throw new Error("Simulated save failure.");
    if (action === "plan") return { counts: [] } as T;
    if (action === "settings" && ["disabled", "dry_run", "live"].includes(String(payload.mode))) {
      overview.settings.mode = payload.mode as CommunicationsOverview["settings"]["mode"];
      overview.settings.revision++;
      return {} as T;
    }
    if (action === "automation") {
      const entry = overview.automations.find(row => row.template_key === payload.template_key);
      if (entry) Object.assign(entry, { enabled: Boolean(payload.enabled), delay_seconds: Number(payload.delay_seconds), revision: entry.revision + 1 });
      return {} as T;
    }
    throw new Error("Email delivery is disabled in this preview.");
  };
}
