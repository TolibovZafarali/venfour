import { useEffect, type ReactNode } from "react";
export function CheckoutElementsProvider({ children }: { children: ReactNode }) { return children; }
export function BillingAddressElement({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return <div className="payment-preview" aria-label="Simulated billing fields">
    <label>Cardholder name<input readOnly value="Jordan Example" /></label>
    <label>Country<input readOnly value="United States" /></label>
    <label>Address line 1<input readOnly value="123 Example Street" /></label>
    <label>Address line 2<input readOnly value="Unit 4" /></label>
    <label>City<input readOnly value="St. Louis" /></label>
    <div><label>State<input readOnly value="Missouri" /></label><label>ZIP code<input readOnly value="63101" /></label></div>
  </div>;
}
export function PaymentElement({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return <div className="payment-preview" aria-label="Simulated payment fields">
    <p>Payment preview · no transaction</p>
    <label>Card number<input readOnly value="4242 4242 4242 4242" /></label>
    <div><label>Expiration<input readOnly value="12 / 30" /></label><label>Security code<input readOnly value="•••" /></label></div>
  </div>;
}
