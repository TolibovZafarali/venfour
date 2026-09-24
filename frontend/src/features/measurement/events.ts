import { hasAnalyticsConsent, hasAdvertisingConsent } from "@/features/privacy/consent";
import { readAttribution } from "./attribution";

export const businessEventNames = ["landing_view", "review_started", "valuation_report_uploaded", "review_eligible", "checkout_started", "purchase_completed", "refund_issued"] as const;
export type BusinessEventName = typeof businessEventNames[number];
export interface BusinessEvent {
  event_name: BusinessEventName;
  timestamp: string;
  event_id: string;
  session_id?: string;
  case_id?: string;
  transaction_id?: string;
  value?: number;
  currency?: "USD";
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seen = new Set<string>();

export function emitBusinessEvent(event: BusinessEvent) {
  if (!hasAnalyticsConsent() && !hasAdvertisingConsent()) return;
  // Construct a new object; never spread a product response into measurement.
  const safe: BusinessEvent = { event_name: event.event_name, event_id: event.event_id, timestamp: event.timestamp };
  if (!businessEventNames.includes(safe.event_name) || !UUID.test(safe.event_id) || !Number.isFinite(Date.parse(safe.timestamp))) return;
  if (event.case_id && UUID.test(event.case_id)) safe.case_id = event.case_id;
  if (event.transaction_id && UUID.test(event.transaction_id)) safe.transaction_id = event.transaction_id;
  if (event.currency === "USD" && typeof event.value === "number" && Number.isFinite(event.value) && event.value > 0) { safe.currency = "USD"; safe.value = event.value; }
  const identity = safe.transaction_id ? `${safe.event_name}:${safe.event_id}` : safe.case_id ? `${safe.event_name}:${safe.case_id}` : safe.event_id;
  if (seen.has(identity)) return;
  if (safe.transaction_id) {
    try {
      const key = `venfour.financial-event:${identity}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "emitted");
    } catch { /* The stable ledger event ID remains available for consumer deduplication. */ }
  }
  seen.add(identity);
  try {
    let session = sessionStorage.getItem("venfour.measurement-session");
    if (!session || !UUID.test(session)) { session = crypto.randomUUID(); sessionStorage.setItem("venfour.measurement-session", session); }
    safe.session_id = session;
  } catch { /* Measurement is optional. */ }
  window.dispatchEvent(new CustomEvent("venfour:business-event", { detail: { ...safe, attribution: readAttribution() } }));
}
