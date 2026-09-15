import {
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { formatCommercePrice } from "@/features/total-loss-claim/browser-actions";
import {
  ClaimWorkflowFrame,
  WorkflowError,
} from "@/features/total-loss-claim/components/claim-workflow-shell";
import { EmbeddedPayment } from "@/features/total-loss-claim/components/embedded-payment";
import { maskedClaimEmail } from "@/features/total-loss-claim/claim-email";
import { ApiError } from "@/lib/api/client";
import { SecureClaimPanel } from "@/features/total-loss-claim/components/secure-claim-panel";
import type { TotalLossClaimSecureRequired, TotalLossClaimSecured } from "@/features/total-loss-claim/contracts";
import {
  useTotalLossCheckoutQuoteQuery,
  useTotalLossCheckoutReconciliationMutation,
} from "@/features/total-loss-claim/queries";
import { resolvedTotalLossClaimJourneyState } from "@/features/total-loss-claim/workflow-route";
import "./checkout-experience.css";

export function CheckoutScreen({
  accessToken,
  canceled,
  caseId,
  claim,
  onRefresh,
  onVerificationPendingChange,
  userId,
}: {
  readonly accessToken: string;
  readonly canceled: boolean;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured | TotalLossClaimSecureRequired;
  readonly onRefresh: () => Promise<unknown>;
  readonly onVerificationPendingChange?: (pending: boolean) => void;
  readonly userId: string;
}) {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const verified = claim.state === "secured";
  const nextState = resolvedTotalLossClaimJourneyState(claim);
  const quote = useTotalLossCheckoutQuoteQuery({ accessToken, caseId, userId, enabled: true });
  const currency = quote.data?.currency;
  const confirming = verified && (searchParameters.get("payment") === "confirming" || Boolean(searchParameters.get("session_id")) || nextState === "checkout_confirmation");
  const price = formatCommercePrice(quote.data?.amountMinorUnits, currency, null);
  const summaryPrice = quote.isPending ? "Loading…" : (price ?? "Unavailable");
  const paymentReady = verified && claim.commerce?.checkoutAvailable && quote.data?.availability === "available" && Boolean(price);
  const onConfirm = useCallback((sessionId: string | null) => {
    const parameters = new URLSearchParams();
    parameters.set("payment", "confirming");
    if (sessionId) parameters.set("session_id", sessionId);
    setSearchParameters(parameters, { replace: true });
  }, [setSearchParameters]);

  const onResume = useCallback(() => setSearchParameters({}, { replace: true }), [setSearchParameters]);

  return (
    <div className="checkout-page">
    <ClaimWorkflowFrame>
      <div className="checkout-introduction">
        <p className="checkout-eyebrow"><LockKeyhole size={13} aria-hidden />Secure checkout</p>
        <h1>Complete your purchase</h1>
        <p>An independent review of your insurer’s vehicle valuation.</p>
      </div>
      {canceled ? <p className="checkout-notice" role="status">Checkout was canceled. Your claim and purchase progress are saved.</p> : null}
      <div className="checkout-columns">
        <div className="checkout-form-column">
          <section aria-labelledby="secure-claim-heading" className="checkout-account">
            <h2 id="secure-claim-heading" className="checkout-section-heading">Your account</h2>
            <div className="checkout-account-content">
              {verified ? (
                <div>
                  <p className="checkout-account-identity"><span>{claim.contactEmail ? maskedClaimEmail(claim.contactEmail) : "Your saved email"}</span><span className="checkout-verified">Verified</span></p>
                  <p className="checkout-account-note">Your claim is securely tied to this verified account.</p>
                </div>
              ) : <SecureClaimPanel accessToken={accessToken} claim={claim} onAccessStateChanged={onRefresh} onVerificationPendingChange={onVerificationPendingChange} userId={userId} />}
            </div>
          </section>
          <section aria-labelledby="payment-heading" className="checkout-payment">
            <h2 id="payment-heading" className="checkout-section-heading">{confirming ? "Payment processing" : "Payment details"}</h2>
            <div className="checkout-payment-content">
              {!verified ? (
                <>
                  <p className="checkout-notice">Verify your email above to continue with payment.</p>
                  <Button disabled className="checkout-submit" type="button">Complete purchase</Button>
                </>
              ) : confirming ? (
                <PaymentConfirmation accessToken={accessToken} caseId={caseId} checkoutSessionId={searchParameters.get("session_id")} onRefresh={onRefresh} onResume={onResume} userId={userId} />
              ) : paymentReady ? (
                <EmbeddedPayment key={`${caseId}:${userId}`} accessToken={accessToken} caseId={caseId} onConfirm={onConfirm} priceLabel={price} userId={userId} />
              ) : quote.isPending ? <p className="py-5 text-sm text-copy" role="status">Loading your purchase details…</p> : (
                <div><Button asChild className="mb-4" variant="outline"><Link to={`/total-loss/cases/${caseId}/review-report`}>Check your insurer valuation report</Link></Button><WorkflowError>Payment is not available right now. Your claim is saved, and no payment has been taken on this page.</WorkflowError><Button className="mt-4" variant="outline" type="button" onClick={() => { void quote.refetch(); void onRefresh(); }}>Check availability</Button></div>
              )}
              <p className="checkout-payment-security">Secure payment powered by Stripe</p>
            </div>
          </section>
        </div>
        <aside aria-label="Purchase summary" className="checkout-summary">
          <h2 className="checkout-section-heading">Order summary</h2>
          <div className="checkout-order-item"><h3>Valuation Evidence Review</h3><span>{summaryPrice}</span></div>
          <ul className="checkout-inclusions">
            {["Review of the insurer’s valuation and relevant market evidence", "Venfour Total-Loss Valuation Evidence Package", "Guided reconsideration request preparation when supported"].map((item) => <li key={item}>{item}</li>)}
          </ul>
          <dl className="checkout-summary-total"><div><dt>Total</dt><dd>{summaryPrice}</dd></div></dl>
          <p className="checkout-payment-terms">{currency ? `${currency.toUpperCase()} · ` : ""}One-time payment · No subscription</p>
          <div className="checkout-policy"><h3>Fair-result policy</h3><p>If our completed review does not identify reasonable support for a valuation dispute, we’ll explain the result and refund the purchase under our fair-result policy.</p><p className="checkout-disclaimer">Payment does not guarantee a higher insurance settlement.</p></div>
        </aside>
      </div>
    </ClaimWorkflowFrame>
    </div>
  );
}

function PaymentConfirmation({
  accessToken, caseId, checkoutSessionId, onRefresh, onResume, userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly checkoutSessionId: string | null;
  readonly onRefresh: () => Promise<unknown>;
  readonly onResume: () => void;
  readonly userId: string;
}) {
  const { mutateAsync } = useTotalLossCheckoutReconciliationMutation({ accessToken, caseId, userId });
  const [delayed, setDelayed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const check = async () => {
      try {
        if (checkoutSessionId) {
          const result = await mutateAsync({ checkoutSessionId });
          if (["open", "expired", "failed"].includes(result.checkoutStatus ?? "") && result.orderStatus === "pending") {
            await onRefresh();
            if (active) onResume();
            return;
          }
        }
        const refreshed = await onRefresh();
        if (!checkoutSessionId && refreshed && typeof refreshed === "object" && "data" in refreshed) {
          const currentClaim = refreshed.data as TotalLossClaimSecured | undefined;
          const checkoutStillRequired = currentClaim?.state === "secured" && (
            currentClaim.journey?.nextState === "checkout" ||
            (!currentClaim.journey && currentClaim.commerce?.nextTask === "checkout")
          );
          if (checkoutStillRequired && active) {
            onResume();
            return;
          }
        }
      } catch (error) {
        if (error instanceof ApiError && [400, 404].includes(error.status)) {
          await onRefresh().catch(() => undefined);
          if (active) onResume();
          return;
        }
        // A browser result never replaces the server's payment record.
      }
      if (!active) return;
      attempts += 1;
      if (attempts >= 15) { setDelayed(true); return; }
      timeout = setTimeout(() => void check(), 2_000);
    };
    void check();
    return () => { active = false; clearTimeout(timeout); };
  }, [checkoutSessionId, mutateAsync, onRefresh, onResume, retry]);
  return (
    <div className="rounded-xl border border-brand/20 bg-brand-soft/50 p-5" aria-live="polite">
      <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />Confirming your payment</h3>
      <p className="mt-3 text-sm leading-6 text-copy">We’re waiting for secure payment confirmation before preparing your package. You can safely refresh or close this page and return to your saved claim.</p>
      {delayed ? <><p className="mt-3 text-sm leading-6 text-copy">Confirmation is taking a little longer. Please don’t start another purchase.</p><Button className="mt-4" variant="outline" type="button" onClick={() => { setDelayed(false); setRetry((value) => value + 1); }}>Check payment again</Button></> : null}
    </div>
  );
}
