import { describe, expect, it } from "vitest";
import { sandboxCheckout } from "./stripe-sandbox";

const session = { publishableKey: "pk_test_preview", checkoutSessionId: "cs_test_preview", clientSecret: "cs_test_preview_secret_preview" };

describe("workspace Stripe sandbox", () => {
  it("projects only browser checkout fields", () => {
    expect(sandboxCheckout({ ...session, secretKey: "must-not-be-served" })).toEqual({
      ...session, state: "checkout_ready", uiMode: "elements", checkoutStatus: "open", checkoutUrl: null,
      entitlementStatus: null, orderStatus: "pending",
    });
  });

  it.each([
    null,
    {},
    { ...session, publishableKey: "pk_live_preview" },
    { ...session, checkoutSessionId: "cs_live_preview" },
    { ...session, clientSecret: "cs_test_other_secret_preview" },
  ])("rejects missing, live, or mismatched credentials", (value) => {
    expect(() => sandboxCheckout(value)).toThrow("test-mode Checkout Session");
  });
});
