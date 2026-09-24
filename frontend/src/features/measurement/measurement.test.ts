import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAttribution, clearAttribution, parseAttribution, readAttribution } from "./attribution";
import { createCookieConsent, hasAdvertisingConsent, hasAnalyticsConsent, readStoredCookieConsent, writeStoredCookieConsent, COOKIE_CONSENT_STORAGE_KEY } from "@/features/privacy/consent";
import { googleConfiguration } from "./config";
import { loadGoogleTag, purchaseParameters, sendGooglePurchase } from "./google";
import { parseFinancialReceipt } from "./service";
import { emitBusinessEvent } from "./events";

const id = "f7000000-0000-4000-8000-000000000001";
const receipt = () => ({ event_name: "purchase_completed", event_id: crypto.randomUUID(), transaction_id: id, value: 199, currency: "USD", live: true, timestamp: new Date().toISOString() });
afterEach(() => { clearAttribution(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const allow = () => writeStoredCookieConsent(createCookieConsent(true, "preferences", true));

describe("paid acquisition", () => {
  it("captures exactly the eight supported keys with bounded values", () => {
    expect(parseAttribution("?utm_source=google&utm_medium=cpc&utm_campaign=review&utm_term=total+loss&utm_content=search&gclid=Click_1&gbraid=Braid-2&wbraid=Braid_3&vin=private&email=secret", "/total-loss-review")).toMatchObject({ utm_source: "google", utm_medium: "cpc", utm_campaign: "review", utm_term: "total loss", utm_content: "search", gclid: "Click_1", gbraid: "Braid-2", wbraid: "Braid_3", landing_page: "/total-loss-review" });
    expect(JSON.stringify(parseAttribution("?utm_source=google&vin=private&email=secret", "/case/private"))).not.toMatch(/private|secret/);
  });
  it.each(["gclid=<script>", "gclid=one&gclid=two", "utm_source=a%0Ab", "utm_term=customer%40example.com", `gclid=${"a".repeat(257)}`, `utm_campaign=${"b".repeat(121)}`])("rejects malformed input %s", query => {
    expect(parseAttribution(query, "/")).toBeNull();
  });
  it("retains an entry in memory until permission, then preserves the first paid touch", () => {
    captureAttribution("?gclid=First_click&utm_source=google", "/total-loss-review");
    expect(readAttribution()).toBeNull();
    expect(document.cookie).not.toContain("venfour.acquisition");
    allow(); captureAttribution("", "/start");
    expect(readAttribution()).toMatchObject({ gclid: "First_click", landing_page: "/total-loss-review" });
    captureAttribution("?gclid=Second_click", "/");
    expect(readAttribution()?.gclid).toBe("First_click");
  });
  it("allows the first paid source to replace an earlier organic source", () => {
    allow(); captureAttribution("?utm_source=organic", "/");
    captureAttribution("?wbraid=Paid_click", "/total-loss-review");
    expect(readAttribution()?.wbraid).toBe("Paid_click");
  });
  it("expires first-touch attribution after 30 days and does not throw for corrupt storage", () => {
    allow(); captureAttribution("?gclid=First_click", "/");
    expect(readAttribution(Date.now() + 31 * 86400000)).toBeNull();
    document.cookie = "venfour.acquisition=%broken; Path=/";
    expect(readAttribution()).toBeNull();
  });
});

describe("consent and optional configuration", () => {
  it("does not turn existing analytics permission into advertising permission", () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, essential: true, analytics: true, source: "accept-all", savedAt: new Date().toISOString() }));
    expect(readStoredCookieConsent()?.advertising).toBe(false);
    expect(hasAnalyticsConsent()).toBe(true);
    expect(hasAdvertisingConsent()).toBe(false);
  });
  it("honors GPC for both purposes", () => {
    allow();
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    try { expect(hasAdvertisingConsent()).toBe(false); expect(hasAnalyticsConsent()).toBe(false); }
    finally { Reflect.deleteProperty(navigator, "globalPrivacyControl"); }
  });
  it("keeps the service usable when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => allow()).not.toThrow();
    expect(hasAdvertisingConsent()).toBe(false);
  });
  it("does not load Google or create requests when IDs are absent or invalid", async () => {
    vi.stubEnv("VITE_GOOGLE_ADS_CONVERSION_ID", ""); vi.stubEnv("VITE_GOOGLE_ADS_PURCHASE_LABEL", "");
    allow();
    expect(googleConfiguration()).toBeNull();
    expect(googleConfiguration("invalid", "label")).toBeNull();
    expect(await loadGoogleTag()).toBe(false);
    await sendGooglePurchase(parseFinancialReceipt(receipt())!.event, true);
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });
});

describe("authoritative receipts and privacy allowlist", () => {
  it("uses the actual financial amount, USD and the stable order reference", () => {
    const event = parseFinancialReceipt({ ...receipt(), value: 149.5 })!.event;
    expect(purchaseParameters(event, "test-destination")).toMatchObject({ transaction_id: id, currency: "USD", value: 149.5 });
  });
  it.each([{ currency: "EUR" }, { value: 0 }, { value: NaN }, { transaction_id: "pi_bad" }, { event_name: "checkout_clicked" }, { live: "true" }])("rejects malformed financial data %j", override => {
    expect(parseFinancialReceipt({ ...receipt(), ...override })).toBeNull();
  });
  it("never copies private product fields, URLs, or email into a business or advertising event", () => {
    allow();
    const parsed = parseFinancialReceipt({ ...receipt(), vin: "secret-vin", insurer: "private-insurer", document: "report.pdf", claim: "narrative", email: "buyer@example.test", market: "comparable", settlement: 27000 })!;
    const listener = vi.fn(); window.addEventListener("venfour:business-event", listener);
    try {
      emitBusinessEvent(parsed.event); emitBusinessEvent(parsed.event);
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = JSON.stringify([listener.mock.calls[0][0].detail, purchaseParameters(parsed.event, "test-destination")]);
      expect(payload).not.toMatch(/secret-vin|private-insurer|report.pdf|narrative|buyer@|comparable|27000/);
      expect(parsed.email).toBe("buyer@example.test");
    } finally { window.removeEventListener("venfour:business-event", listener); }
  });
  it("does not turn a confirmed refund into a second purchase", () => {
    const parsed = parseFinancialReceipt({ ...receipt(), event_name: "refund_issued" })!;
    expect(purchaseParameters(parsed.event, "test-destination")).toBeNull();
  });
  it("does not emit the same financial event again after a page module reload", async () => {
    allow();
    const event = parseFinancialReceipt(receipt())!.event;
    const listener = vi.fn(); window.addEventListener("venfour:business-event", listener);
    try {
      emitBusinessEvent(event);
      vi.resetModules();
      (await import("./events")).emitBusinessEvent(event);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("venfour:business-event", listener); }
  });
});
