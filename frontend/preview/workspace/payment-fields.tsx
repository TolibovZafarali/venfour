import { useEffect, type ReactNode } from "react";
export function CheckoutElementsProvider({ children }: { children: ReactNode }) { return children; }
export function PaymentElement({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return <div className="payment-preview" aria-label="Simulated payment fields">
    <p>Payment preview · no transaction</p>
    <label>Card number<input readOnly value="4242 4242 4242 4242" /></label>
    <div><label>Expiration<input readOnly value="12 / 30" /></label><label>Security code<input readOnly value="•••" /></label></div>
  </div>;
}
