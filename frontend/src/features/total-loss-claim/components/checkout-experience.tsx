import {
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { formatCommercePrice } from "@/features/total-loss-claim/browser-actions";
import {
  ClaimWorkflowCard,
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
import { totalLossClaimViewPath } from "@/features/total-loss-claim/workflow-route";
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
  const quote = useTotalLossCheckoutQuoteQuery({ accessToken, caseId, userId });
  const verified = claim.state === "secured";
  const confirming = verified && (searchParameters.get("payment") === "confirming" || Boolean(searchParameters.get("session_id")) || claim.journey?.nextState === "checkout_confirmation");
  const price = formatCommercePrice(quote.data?.amountMinorUnits, quote.data?.currency, null);
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
            <h2 id="payment-heading" className="checkout-section-heading">Payment details</h2>
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
          <div className="checkout-order-item"><h3>Valuation Evidence Review</h3><span>{quote.isPending ? "Loading…" : (price ?? "Unavailable")}</span></div>
          <ul className="checkout-inclusions">
            {["Review of the insurer’s valuation and relevant market evidence", "Venfour Total-Loss Valuation Evidence Package", "Guided reconsideration request preparation when supported"].map((item) => <li key={item}>{item}</li>)}
          </ul>
          <dl className="checkout-summary-total"><div><dt>Total</dt><dd>{quote.isPending ? "Loading…" : (price ?? "Unavailable")}</dd></div></dl>
          <p className="checkout-payment-terms">{quote.data?.currency ? `${quote.data.currency.toUpperCase()} · ` : ""}One-time payment · No subscription</p>
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

export function CheckoutReturnScreen({
  accessToken,
  caseId,
  checkoutSessionId,
  claim,
  onRefresh,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly checkoutSessionId: string | null;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly userId: string;
}) {
  const navigate = useNavigate();
  const reconciliation = useTotalLossCheckoutReconciliationMutation({
    accessToken,
    caseId,
    userId,
  });
  const attempted = useRef(false);
  const [attemptFinished, setAttemptFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconcile = useCallback(async () => {
    setError(null);
    if (!checkoutSessionId) {
      await onRefresh();
      setAttemptFinished(true);
      setError(
        "We couldn’t confirm this checkout return. Reopen your claim to resume from its saved payment state.",
      );
      return;
    }
    try {
      await reconciliation.mutateAsync({ checkoutSessionId });
      await onRefresh();
      setAttemptFinished(true);
    } catch {
      await onRefresh().catch(() => undefined);
      setAttemptFinished(true);
      setError(
        "Payment confirmation is taking longer than expected. We’re still waiting for secure confirmation from the payment provider; try checking again.",
      );
    }
  }, [checkoutSessionId, onRefresh, reconciliation]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void reconcile();
  }, [reconcile]);

  useEffect(() => {
    const checkoutStillRequired =
      claim.journey?.nextState === "checkout" ||
      (!claim.journey && claim.commerce?.nextTask === "checkout");
    if (!attemptFinished || !checkoutStillRequired) return;
    void navigate(totalLossClaimViewPath(caseId, "checkout"), { replace: true });
  }, [attemptFinished, caseId, claim.commerce, claim.journey, navigate]);

  return (
    <ClaimWorkflowFrame>
      <ClaimWorkflowCard>
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <LoaderCircle
            className="size-6 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Payment confirmation
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
          Confirming your payment
        </h1>
        <p
          className="mt-5 max-w-3xl text-base leading-7 text-copy"
          aria-live="polite"
          aria-busy={reconciliation.isPending}
        >
          Venfour is securely confirming your payment with the payment provider.
          You can safely refresh or close this page; this return link cannot
          complete or change the purchase on its own.
        </p>
        {error ? (
          <>
            <WorkflowError>{error}</WorkflowError>
            <Button
              className="mt-4"
              disabled={reconciliation.isPending}
              onClick={() => void reconcile()}
              type="button"
              variant="outline"
            >
              Check payment again
            </Button>
          </>
        ) : null}
      </ClaimWorkflowCard>
    </ClaimWorkflowFrame>
  );
}

export function ProcessingScreen({
  claim,
  onRefresh,
}: {
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const fulfillment = claim.journey?.fulfillmentState ?? "finalizing";
  const exception = fulfillment === "exception_review";
  const needsAttention =
    fulfillment === "needs_attention" ||
    claim.journey?.nextState === "needs_attention";
  const heading = needsAttention
    ? "We need to check a detail in your case"
    : exception
      ? "We’re checking a detail before your report is ready"
      : "We’re preparing your valuation report";
  const description = needsAttention
    ? "Venfour could not safely move your case forward yet. Your case and any completed payment remain recorded; check again or contact support if this continues."
    : exception
      ? "A detail needs an additional quality check before the report can be released. There’s nothing you need to do right now."
      : "Venfour is validating the evidence and preparing the customer-ready report. This may take a little time.";

  return (
    <section className="workspace-stage">
        <p className="workspace-stage__eyebrow">
          {needsAttention ? "Case status" : "Report preparation"}
        </p>
        <h1 className="workspace-stage__heading">
          {heading}
        </h1>
        <p
          className="workspace-stage__description"
          aria-live="polite"
          aria-busy={!needsAttention}
        >
          {description}
        </p>
        {!needsAttention ? <div className="workspace-processing__line" aria-hidden /> : null}
        {claim.journey?.retryable || needsAttention ? (
          <div className="mt-7 flex flex-wrap gap-3">
            <Button
              onClick={() => void onRefresh()}
              type="button"
              variant="outline"
            >
              Check again
            </Button>
            {needsAttention ? (
              <Button asChild variant="ghost">
                <Link to="/contact">Contact support</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
          <p className="workspace-report-status">
            {needsAttention
              ? "Your case remains saved. Checking again only refreshes its status; it does not repeat any completed payment or processing step."
              : "You can close this browser and return to your saved case. Report preparation continues independently of this page."}
          </p>
    </section>
  );
}
