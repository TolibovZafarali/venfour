// @vitest-environment-options {"url":"https://app.venfour.com"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCookieConsent, writeStoredCookieConsent } from "@/features/privacy/consent";
import type { BusinessEvent } from "./events";

const tag = vi.fn();
const order = (): BusinessEvent => ({ event_name: "purchase_completed", event_id: crypto.randomUUID(), transaction_id: crypto.randomUUID(), value: 199, currency: "USD", timestamp: new Date().toISOString() });
beforeEach(() => {
  vi.resetModules(); tag.mockClear();
  // Synthetic unit-test configuration; requests are never executed.
  vi.stubEnv("VITE_GOOGLE_ADS_CONVERSION_ID", `AW-${"1".repeat(9)}`);
  vi.stubEnv("VITE_GOOGLE_ADS_PURCHASE_LABEL", "unit_test_only");
  vi.stubEnv("VITE_GOOGLE_ENHANCED_CONVERSIONS", "false");
  Object.assign(window, { gtag: tag, dataLayer: [] });
  writeStoredCookieConsent(createCookieConsent(true, "preferences", true));
});
afterEach(() => {
  document.cookie = "venfour.consent=; Domain=venfour.com; Path=/; Max-Age=0; Secure";
  document.querySelectorAll('script[src*="googletagmanager"]').forEach(node => node.remove());
  Reflect.deleteProperty(window, "gtag"); Reflect.deleteProperty(window, "dataLayer");
  vi.unstubAllEnvs();
});
const conversions = () => tag.mock.calls.filter(call => call[0] === "event" && call[1] === "conversion");
function loaded() {
  const script = document.querySelector<HTMLScriptElement>('script[src*="googletagmanager"]');
  expect(script).not.toBeNull();
  expect(script?.referrerPolicy).toBe("no-referrer");
  script!.dispatchEvent(new Event("load"));
}

describe("Google purchase adapter", () => {
  it("uses the configured production destination with the authoritative nonstandard amount", async () => {
    vi.stubEnv("VITE_GOOGLE_ADS_CONVERSION_ID", "AW-18473000475");
    vi.stubEnv("VITE_GOOGLE_ADS_PURCHASE_LABEL", "SbutCPivmYQdEJu8zuhE");
    const { sendGooglePurchase } = await import("./google");
    const event = { ...order(), value: 149.5 };
    const pending = sendGooglePurchase(event, true);
    expect(document.querySelector<HTMLScriptElement>('script[src*="googletagmanager"]')?.src)
      .toBe("https://www.googletagmanager.com/gtag/js?id=AW-18473000475");
    loaded(); await pending;
    expect(conversions()[0][2]).toMatchObject({
      send_to: "AW-18473000475/SbutCPivmYQdEJu8zuhE",
      value: 149.5, currency: "USD", transaction_id: event.transaction_id,
    });
  });
  it("shares one initialization across concurrent loads and sends no purchase on load", async () => {
    const { loadGoogleTag } = await import("./google");
    const pending = [loadGoogleTag(), loadGoogleTag(), loadGoogleTag()];
    expect(document.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1);
    loaded(); await Promise.all(pending);
    expect(tag.mock.calls.filter(call => call[0] === "config")).toHaveLength(1);
    expect(tag.mock.calls.filter(call => call[0] === "js")).toHaveLength(1);
    expect(conversions()).toHaveLength(0);
  });
  it("keeps analytics-only consent from loading the advertising tag", async () => {
    writeStoredCookieConsent(createCookieConsent(true, "preferences", false));
    const { loadGoogleTag } = await import("./google");
    expect(await loadGoogleTag()).toBe(false);
    expect(tag).not.toHaveBeenCalled();
  });
  it("denies a loaded tag after withdrawal and suppresses later purchases", async () => {
    const { loadGoogleTag, updateGoogleConsent, sendGooglePurchase } = await import("./google");
    const pending = loadGoogleTag(); loaded(); await pending;
    writeStoredCookieConsent(createCookieConsent(false, "reject-non-essential"));
    updateGoogleConsent();
    await sendGooglePurchase(order(), true, "buyer@example.test");
    expect(tag).toHaveBeenLastCalledWith("consent", "update", {
      analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    });
    expect(conversions()).toHaveLength(0);
  });
  it("honors GPC even when saved advertising consent exists", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    try {
      const { loadGoogleTag, sendGooglePurchase } = await import("./google");
      expect(await loadGoogleTag()).toBe(false);
      await sendGooglePurchase(order(), true, "buyer@example.test");
      expect(tag).not.toHaveBeenCalled();
    } finally { Reflect.deleteProperty(navigator, "globalPrivacyControl"); }
  });
  it("defaults consent before config and deduplicates retries, concurrent calls, and a refreshed module", async () => {
    const { sendGooglePurchase } = await import("./google");
    const event = order();
    const first = sendGooglePurchase(event, true);
    const second = sendGooglePurchase(event, true);
    loaded(); await Promise.all([first, second]);
    expect(tag.mock.calls[0]).toMatchObject(["consent", "default", { ad_storage: "denied", ad_user_data: "denied" }]);
    expect(conversions()).toHaveLength(1);
    expect(conversions()[0][2]).toMatchObject({ value: 199, currency: "USD", transaction_id: event.transaction_id, page_referrer: "" });
    conversions()[0][2].event_callback();
    vi.resetModules();
    await (await import("./google")).sendGooglePurchase(event, true);
    expect(conversions()).toHaveLength(1);
  });
  it("does not load with denied consent or send sandbox payments", async () => {
    const { sendGooglePurchase } = await import("./google");
    await sendGooglePurchase(order(), false);
    writeStoredCookieConsent(createCookieConsent(false, "reject-non-essential"));
    await sendGooglePurchase(order(), true);
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(conversions()).toHaveLength(0);
  });
  it("checks consent again after the script finishes loading", async () => {
    const { sendGooglePurchase } = await import("./google");
    const pending = sendGooglePurchase(order(), true);
    writeStoredCookieConsent(createCookieConsent(false, "reject-non-essential"));
    loaded(); await pending;
    expect(conversions()).toHaveLength(0);
  });
  it("keeps enhanced customer data off unless explicitly enabled", async () => {
    const { sendGooglePurchase } = await import("./google");
    const pending = sendGooglePurchase(order(), true, "buyer@example.test");
    loaded(); await pending;
    expect(JSON.stringify(tag.mock.calls)).not.toContain("buyer@example.test");
  });
  it("passes only the purchase email to Google's normalization and hashing, then clears it", async () => {
    vi.stubEnv("VITE_GOOGLE_ENHANCED_CONVERSIONS", "true");
    const { sendGooglePurchase } = await import("./google");
    const pending = sendGooglePurchase(order(), true, "buyer@example.test");
    loaded(); await pending;
    expect(tag).toHaveBeenCalledWith("set", "user_data", { email: "buyer@example.test" });
    expect(tag).toHaveBeenLastCalledWith("set", "user_data", null);
    expect(JSON.stringify(conversions())).not.toContain("buyer@example.test");
  });
  it("survives a blocked script without interrupting the customer flow", async () => {
    const { sendGooglePurchase } = await import("./google");
    const pending = sendGooglePurchase(order(), true);
    document.querySelector('script[src*="googletagmanager"]')!.dispatchEvent(new Event("error"));
    await expect(pending).resolves.toBeUndefined();
    expect(conversions()).toHaveLength(0);
  });
});
