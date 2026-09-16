export function sandboxCheckout(value: unknown) {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data.publishableKey !== "string" || !data.publishableKey.startsWith("pk_test_")
    || typeof data.checkoutSessionId !== "string" || !data.checkoutSessionId.startsWith("cs_test_")
    || typeof data.clientSecret !== "string" || !data.clientSecret.startsWith(`${data.checkoutSessionId}_secret_`)) {
    throw new Error("Workspace Stripe preview requires a matching test-mode Checkout Session and publishable key.");
  }
  return {
    state: "checkout_ready", uiMode: "elements", checkoutStatus: "open", checkoutUrl: null,
    entitlementStatus: null, orderStatus: "pending",
    publishableKey: data.publishableKey, checkoutSessionId: data.checkoutSessionId, clientSecret: data.clientSecret,
  };
}
