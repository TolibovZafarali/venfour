import {
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  LockKeyhole,
  LoaderCircle,
  ShieldCheck,
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
    <ClaimWorkflowFrame>
      <Link className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-copy hover:text-ink" to={`/total-loss/cases/${encodeURIComponent(caseId)}/analysis`}>
        <ArrowLeft className="size-4" aria-hidden /> Back to your valuation
      </Link>
      <div className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">Your valuation review</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl">Complete your valuation review</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-copy">Get a completed evidence review, an organized valuation package, and clear guidance for your discussion with the insurance adjuster.</p>
      </div>
      {canceled ? <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">Checkout was canceled. Your claim and purchase progress are saved.</p> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ClaimWorkflowCard className="min-w-0">
          <section aria-labelledby="secure-claim-heading">
            <h2 id="secure-claim-heading" className="flex items-center gap-3 text-lg font-semibold text-ink"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm text-brand" aria-hidden>1</span>Secure your claim</h2>
            <div className="mt-5 sm:pl-11">
              {verified ? (
                <div className="rounded-xl border border-market/25 bg-market-soft/45 px-4 py-4">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold text-ink"><span className="break-all">{claim.contactEmail ? maskedClaimEmail(claim.contactEmail) : "Your saved email"}</span><span className="inline-flex items-center gap-1.5 text-market-strong"><CheckCircle2 className="size-4" aria-hidden />Verified</span></p>
                  <p className="mt-2 text-sm leading-6 text-copy">Your claim is securely saved to your account.</p>
                </div>
              ) : <SecureClaimPanel accessToken={accessToken} claim={claim} onAccessStateChanged={onRefresh} onVerificationPendingChange={onVerificationPendingChange} userId={userId} />}
            </div>
          </section>
          <section aria-labelledby="payment-heading" className="mt-8 border-t border-line pt-8">
            <h2 id="payment-heading" className="flex items-center gap-3 text-lg font-semibold text-ink"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm text-brand" aria-hidden>2</span>Payment information</h2>
            <div className="mt-5 sm:pl-11">
              <div className="mb-5 flex items-baseline justify-between gap-3 text-sm"><span className="text-copy">Valuation evidence package</span><span className="shrink-0 font-semibold text-ink">{quote.isPending ? "Loading…" : (price ?? "Price unavailable")}</span></div>
              {!verified ? (
                <>
                  <div className="flex gap-3 rounded-xl border border-dashed border-line bg-surface/65 p-5"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-copy" aria-hidden /><p className="text-sm leading-6 text-copy">Verify your email above to continue with payment.</p></div>
                  <Button disabled className="mt-6 min-h-12 w-full" type="button">Complete purchase</Button>
                </>
              ) : confirming ? (
                <PaymentConfirmation accessToken={accessToken} caseId={caseId} checkoutSessionId={searchParameters.get("session_id")} onRefresh={onRefresh} onResume={onResume} userId={userId} />
              ) : paymentReady ? (
                <EmbeddedPayment key={`${caseId}:${userId}`} accessToken={accessToken} caseId={caseId} onConfirm={onConfirm} userId={userId} />
              ) : quote.isPending ? <p className="py-5 text-sm text-copy" role="status">Loading your purchase details…</p> : (
                <div><WorkflowError>Payment is not available right now. Your claim is saved, and no payment has been taken on this page.</WorkflowError><Button className="mt-4" variant="outline" type="button" onClick={() => { void quote.refetch(); void onRefresh(); }}>Check availability</Button></div>
              )}
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-copy"><ShieldCheck className="size-3.5" aria-hidden />Secure payment powered by Stripe</p>
              <p className="mt-2 text-center text-xs text-copy">Fair-result refund policy</p>
            </div>
          </section>
        </ClaimWorkflowCard>
        <aside aria-label="Purchase summary" className="rounded-[1.5rem] border border-line bg-surface/70 p-6 lg:sticky lg:top-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Your valuation evidence package</h2>
          <ul className="mt-5 space-y-4 text-sm leading-6 text-copy">
            {["Completed review of the insurer’s valuation and relevant market evidence", "An organized Venfour Total-Loss Valuation Evidence Package", "Guided preparation of a neutral reconsideration request when supported"].map((item) => <li key={item} className="flex gap-2.5"><CheckCircle2 className="mt-1 size-4 shrink-0 text-brand" aria-hidden />{item}</li>)}
          </ul>
          <div className="mt-6 flex items-baseline justify-between gap-3 border-t border-line pt-5"><span className="text-sm font-medium text-copy">Total</span><span className="text-3xl font-semibold tracking-[-0.035em] text-ink">{quote.isPending ? "Loading…" : (price ?? "Unavailable")}</span></div>
          {quote.data?.currency ? <p className="mt-1 text-right text-xs text-copy">{quote.data.currency.toUpperCase()} · One-time payment</p> : null}
          <div className="mt-6 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Fair-result refund policy</h3><p className="mt-2 text-xs leading-5 text-copy">If the completed review does not support a dispute, Venfour will explain the result, refund your purchase under the fair-result policy, and retain report access for your records.</p><p className="mt-3 text-xs leading-5 text-copy">Payment does not guarantee a higher settlement. The insurer’s valuation may be reasonably supported.</p></div>
        </aside>
      </div>
    </ClaimWorkflowFrame>
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
        "Payment confirmation is taking longer than expected. Your payment status remains server-controlled; try checking again.",
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
          Venfour is checking the authoritative payment record. You can safely
          refresh or close this page; fulfillment is controlled by the payment
          confirmation received by the server, not this browser link.
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
  const Icon = needsAttention ? AlertCircle : LoaderCircle;
  const heading = needsAttention
    ? "Your package needs attention"
    : exception
      ? "We’re checking a detail before your report is ready"
      : "We’re preparing your valuation package";
  const description = needsAttention
    ? "Venfour could not safely complete the package yet. Your payment and case remain recorded; retry or contact support if this continues."
    : exception
      ? "A detail needs an additional quality check before the report can be released. There’s nothing you need to do right now."
      : "Venfour is validating the evidence and preparing the customer-ready report. This may take a little time.";

  return (
    <ClaimWorkflowFrame>
      <ClaimWorkflowCard>
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon
            className={
              needsAttention
                ? "size-6"
                : "size-6 animate-spin motion-reduce:animate-none"
            }
            aria-hidden
          />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Package preparation
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
          {heading}
        </h1>
        <p
          className="mt-5 max-w-3xl text-base leading-7 text-copy"
          aria-live="polite"
          aria-busy={!needsAttention}
        >
          {description}
        </p>
        {claim.journey?.retryable || needsAttention ? (
          <Button
            className="mt-7"
            onClick={() => void onRefresh()}
            type="button"
            variant="outline"
          >
            Check again
          </Button>
        ) : null}
        <div className="mt-8 flex gap-3 rounded-2xl border border-line bg-surface/60 p-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="text-sm leading-6 text-copy">
            {needsAttention
              ? "Your case and payment remain saved. Checking again refreshes the status; it does not restart a failed package."
              : "You can close this browser and return from My appraisals. Package preparation continues independently of this page."}
          </p>
        </div>
      </ClaimWorkflowCard>
    </ClaimWorkflowFrame>
  );
}
