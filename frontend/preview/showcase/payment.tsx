import { useEffect, type ReactNode } from "react";
import { simulatePayment } from "./state";

// The real checkout page and purchase button are unchanged. The external SDK
// boundary has no frames, credentials, requests or payment instruments locally.
export const loadStripe = async () => ({});
export function useCheckoutElements() { return { type: "success", checkout: { confirm: async () => { simulatePayment(); return { type: "success" }; } } }; }
export function CheckoutElementsProvider({ children }: { children: ReactNode }) { return children; }
export function BillingAddressElement({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return null;
}
export const PaymentElement = BillingAddressElement;
