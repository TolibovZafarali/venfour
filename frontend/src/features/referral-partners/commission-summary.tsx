import { useId } from "react";

export function CommissionSummary() {
  const headingId = useId();
  return <section className="partner-commission-summary" aria-labelledby={headingId}>
    <h2 id={headingId}>How your commission works</h2>
    <div className="partner-commission-tiers">
      <div><strong>$50</strong><span>Successful cases 1–9 each month</span></div>
      <div><strong>$75</strong><span>Successful case 10 and onward</span></div>
    </div>
    <p>A successful case requires a paid total-loss review, completed reconsideration, and insurer documents confirming a final accepted vehicle-value increase <strong>greater than $1,000</strong>, verified by Venfour. Exactly $1,000 does not qualify.</p>
    <p>We compare equivalent vehicle values against the latest written offer received before paid service begins, excluding taxes, fees, deductions, and other non-vehicle amounts. The increase is measured before Venfour’s fee.</p>
    <p>Cases count when their successful outcomes are verified, using America/Chicago calendar months. The first nine keep their $50 rate. <strong>15 successful cases = $900.</strong></p>
    <p>Payment eligibility starts after both success verification and 30 days from customer payment. Payments are initiated by the 15th of the following month, or the next banking business day. No minimum payout.</p>
    <p>Refund rights remain intact. Refunds, reversals, unresolved disputes, and refund eligibility can prevent or reverse a commission. A documented, purely discretionary goodwill refund does not remove an otherwise earned commission.</p>
    <p className="partner-muted">The complete agreement below governs attribution, evidence, payment onboarding, corrections, and the goodwill exception. Regulated partners need separate compliance approval before paid referrals.</p>
  </section>;
}
