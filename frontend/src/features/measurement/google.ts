import { hasAdvertisingConsent, hasAnalyticsConsent } from "@/features/privacy/consent";
import { googleConfiguration } from "./config";
import { readAttribution, type Attribution } from "./attribution";
import { UUID, type BusinessEvent } from "./events";

type GoogleWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
const googleWindow = () => window as GoogleWindow;
const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
let loading: Promise<boolean> | null = null;
const sending = new Set<string>();

export function updateGoogleConsent() {
  googleWindow().gtag?.("consent", "update", {
    analytics_storage: hasAnalyticsConsent() ? "granted" : "denied",
    ad_storage: hasAdvertisingConsent() ? "granted" : "denied",
    ad_user_data: hasAdvertisingConsent() ? "granted" : "denied",
    ad_personalization: "denied",
  });
}

export function googlePageLocation(attribution = readAttribution()) {
  const url = new URL("https://venfour.com/total-loss-review");
  for (const key of ["gclid", "gbraid", "wbraid"] as const) if (attribution?.[key]) url.searchParams.set(key, attribution[key]);
  return url.href;
}

export async function loadGoogleTag() {
  const config = googleConfiguration();
  if (!config || !hasAdvertisingConsent()) return false;
  // Only the public site and customer host can activate the live adapter.
  if (!["venfour.com", "www.venfour.com", "app.venfour.com"].includes(window.location.hostname)) return false;
  if (loading) return loading;
  const w = googleWindow();
  w.dataLayer ??= [];
  // eslint-disable-next-line prefer-rest-params -- The documented tag queue consumes an arguments object.
  w.gtag ??= function () { w.dataLayer?.push(arguments); };
  w.gtag("consent", "default", denied);
  updateGoogleConsent();
  w.gtag("set", "ads_data_redaction", true);
  w.gtag("set", "url_passthrough", false);
  w.gtag("js", new Date());
  w.gtag("config", config.id, {
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    allow_enhanced_conversions: config.enhanced, page_location: googlePageLocation(), page_referrer: "", page_title: "Venfour",
    cookie_domain: "venfour.com", cookie_flags: "SameSite=Lax;Secure",
  });
  loading = new Promise<boolean>(resolve => {
    const script = document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.id)}`;
    const finish = (ok: boolean) => { window.clearTimeout(timer); if (!ok) { script.remove(); loading = null; } resolve(ok); };
    const timer = window.setTimeout(() => finish(false), 8000);
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  });
  return loading;
}

export function purchaseParameters(event: BusinessEvent, destination: string, attribution?: Attribution | null) {
  if (event.event_name !== "purchase_completed" || !event.transaction_id || !UUID.test(event.transaction_id)
    || event.currency !== "USD" || typeof event.value !== "number" || !Number.isFinite(event.value) || event.value <= 0) return null;
  return { send_to: destination, transaction_id: event.transaction_id, value: event.value, currency: "USD", page_location: googlePageLocation(attribution), page_referrer: "", page_title: "Venfour" };
}

export async function sendGooglePurchase(event: BusinessEvent, live: boolean, email: string | null = null, attribution?: Attribution | null) {
  const config = googleConfiguration();
  if (!config || !live || !hasAdvertisingConsent()) return;
  const parameters = purchaseParameters(event, `${config.id}/${config.label}`, attribution);
  if (!parameters) return;
  const key = `venfour.google-purchase:${config.id}:${config.label}:${parameters.transaction_id}`;
  try { if (localStorage.getItem(key)) return; } catch { /* Google also deduplicates transaction IDs. */ }
  if (sending.has(key)) return;
  sending.add(key);
  if (!await loadGoogleTag() || !hasAdvertisingConsent()) { sending.delete(key); return; }
  const gtag = googleWindow().gtag;
  if (!gtag) { sending.delete(key); return; }
  // Google's tag performs the documented normalization and SHA-256 hashing.
  // This field comes only from the owner-authorized order receipt, never the DOM.
  if (config.enhanced && email && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) gtag("set", "user_data", { email });
  gtag("event", "conversion", { ...parameters, event_callback: () => {
    if (!hasAdvertisingConsent()) return;
    try { localStorage.setItem(key, "sent"); } catch { /* The stable transaction ID remains the remote deduplication key. */ }
  } });
  gtag("set", "user_data", null);
}
