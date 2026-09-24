import { environment } from "@/config/env";
import { supabaseClientState } from "@/lib/supabase/client";
import { hasAdvertisingConsent, hasAnalyticsConsent } from "@/features/privacy/consent";
import { parseAttribution, attributionKeys, type Attribution, readAttribution } from "./attribution";
import { googleConfiguration } from "./config";
import { emitBusinessEvent, UUID, type BusinessEvent, type BusinessEventName } from "./events";
import { sendGooglePurchase } from "./google";

// This optional RPC boundary parses JSON explicitly and does not alter commerce contracts.
async function rpc(name: string, body: Record<string, unknown>) {
  if (supabaseClientState.status !== "available") return null;
  const { data } = await supabaseClientState.client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const response = await fetch(`${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: environment.supabasePublishableKey, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}

export async function syncCaseAttribution(caseId: string) {
  if (!UUID.test(caseId)) return;
  await rpc("save_case_acquisition", { p_case_id: caseId, p_attribution: readAttribution(), p_advertising_allowed: hasAdvertisingConsent() });
}

export function trackCaseEvent(eventName: Exclude<BusinessEventName, "landing_view" | "purchase_completed" | "refund_issued">, caseId: string) {
  if (!UUID.test(caseId) || (!hasAnalyticsConsent() && !hasAdvertisingConsent())) return;
  emitBusinessEvent({ event_name: eventName, event_id: crypto.randomUUID(), case_id: caseId, timestamp: new Date().toISOString() });
  void rpc("record_case_measurement", { p_case_id: caseId, p_event_name: eventName }).catch(() => {});
}

export function parseFinancialReceipt(value: unknown): { event: BusinessEvent; live: boolean; email: string | null; attribution: Attribution | null } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if ((row.event_name !== "purchase_completed" && row.event_name !== "refund_issued")
    || typeof row.event_id !== "string" || !UUID.test(row.event_id)
    || typeof row.transaction_id !== "string" || !UUID.test(row.transaction_id)
    || typeof row.timestamp !== "string" || !Number.isFinite(Date.parse(row.timestamp))
    || row.currency !== "USD" || typeof row.value !== "number" || !Number.isFinite(row.value) || row.value <= 0
    || typeof row.live !== "boolean") return null;
  let attribution: Attribution | null = null;
  if (row.attribution && typeof row.attribution === "object") {
    const source = row.attribution as Record<string, unknown>;
    const query = new URLSearchParams();
    for (const key of attributionKeys) if (typeof source[key] === "string") query.set(key, source[key]);
    attribution = parseAttribution(query.toString(), String(source.landing_page));
  }
  return { attribution, event: { event_name: row.event_name, event_id: row.event_id, transaction_id: row.transaction_id, timestamp: row.timestamp, value: row.value, currency: "USD" }, live: row.live, email: typeof row.email === "string" ? row.email : null };
}

export async function measureFinancialEvents(caseId: string) {
  if (!UUID.test(caseId) || (!hasAnalyticsConsent() && !hasAdvertisingConsent())) return;
  try {
    const rows = await rpc("get_case_measurement", { p_case_id: caseId, p_include_email: Boolean(googleConfiguration()?.enhanced && hasAdvertisingConsent()) });
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const receipt = parseFinancialReceipt(row);
      if (!receipt) continue;
      emitBusinessEvent(receipt.event);
      await sendGooglePurchase(receipt.event, receipt.live, receipt.email, receipt.attribution);
    }
  } catch { /* Measurement must never prevent checkout, recovery, or delivery. */ }
}
