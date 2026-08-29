import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  formatCommercePrice,
  openHostedCheckout,
} from "@/features/total-loss-claim/browser-actions";
import {
  ClaimWorkflowCard,
  ClaimWorkflowFrame,
  WorkflowError,
} from "@/features/total-loss-claim/components/claim-workflow-shell";
import type { TotalLossClaimSecured } from "@/features/total-loss-claim/contracts";
import {
  useTotalLossCheckoutMutation,
  useTotalLossCheckoutQuoteQuery,
  useTotalLossCheckoutReconciliationMutation,
} from "@/features/total-loss-claim/queries";
import { totalLossClaimViewPath } from "@/features/total-loss-claim/workflow-route";

function requestId() {
  return globalThis.crypto.randomUUID();
}

export function CheckoutScreen({
  accessToken,
  canceled,
  caseId,
  claim,
  onRefresh,
  userId,
}: {
  readonly accessToken: string;
  readonly canceled: boolean;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly userId: string;
}) {
  const checkout = useTotalLossCheckoutMutation({ accessToken, caseId, userId });
  const quote = useTotalLossCheckoutQuoteQuery({ accessToken, caseId, userId });
  const clientRequestId = useRef(requestId());
  const [error, setError] = useState<string | null>(null);
  const commerce = claim.commerce;
  const price = formatCommercePrice(
    quote.data?.amountMinorUnits,
    quote.data?.currency,
    null,
  );
  const checkoutReady = Boolean(
    commerce?.checkoutAvailable &&
      quote.data?.availability === "available" &&
      price,
  );

  const continueToCheckout = async () => {
    if (!checkoutReady || checkout.isPending) return;
    setError(null);
    try {
      const result = await checkout.mutateAsync({
        clientRequestId: clientRequestId.current,
      });
      if (result.state === "checkout_ready" && result.checkoutUrl) {
        openHostedCheckout(result.checkoutUrl);
        return;
      }
      await onRefresh();
      if (result.state === "payment_pending") return;
      if (result.state === "already_fulfilled" || result.state === "reconciled") {
        return;
      }
      setError(
        "Secure checkout is temporarily unavailable. Try again; no duplicate purchase will be created.",
      );
    } catch {
      setError(
        "We couldn’t open secure checkout. Try again; your case and any existing checkout remain saved.",
      );
    }
  };

  return (
    <ClaimWorkflowFrame>
      <ClaimWorkflowCard>
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <CreditCard className="size-6" aria-hidden />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Secure checkout
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl">
          Your valuation evidence package
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-copy sm:text-lg">
          Venfour will complete the evidence review, prepare your valuation
          package, and guide you through a written reconsideration request when
          the final evidence supports one.
        </p>

        {canceled ? (
          <div
            className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            role="status"
          >
            Checkout was canceled. You have not lost your case progress and can
            return to secure checkout when you’re ready.
          </div>
        ) : null}

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-ink">What’s included</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-copy">
              <li className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                Completed review of the insurer valuation and relevant market evidence
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                Venfour Total-Loss Valuation Evidence Package
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                Guided preparation of a neutral reconsideration request when supported
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <p className="text-sm font-medium text-copy">Total</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-ink">
              {quote.isPending ? "Loading…" : (price ?? "Unavailable")}
            </p>
            {quote.data?.currency ? (
              <p className="mt-1 text-xs font-semibold tracking-wide text-copy uppercase">
                {quote.data.currency}
              </p>
            ) : null}
            <Button
              className="mt-6 min-h-12 w-full"
              disabled={!checkoutReady || checkout.isPending}
              onClick={() => void continueToCheckout()}
              type="button"
            >
              <ShieldCheck className="size-4" aria-hidden />
              {checkout.isPending
                ? "Opening secure checkout…"
                : "Continue to secure checkout"}
            </Button>
          </div>
        </div>

        {!quote.isPending && !checkoutReady ? (
          <WorkflowError>
            {quote.isError
              ? "We couldn’t load the server-validated checkout price. No payment has been taken. Try again later or contact support."
              : "Secure checkout is not available for this case right now. No payment has been taken. Try again later or contact support."}
          </WorkflowError>
        ) : null}
        {error ? <WorkflowError>{error}</WorkflowError> : null}

        <div className="mt-8 border-t border-line pt-6">
          <h2 className="text-base font-semibold text-ink">Fair-result policy</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-copy">
            Payment does not guarantee a higher settlement. The completed review
            may conclude that the insurer’s valuation is reasonably supported. If
            a dispute is not supportable, Venfour will explain the result, refund
            the purchase under the fair-result policy, and retain report access
            for your records.
          </p>
        </div>
      </ClaimWorkflowCard>
    </ClaimWorkflowFrame>
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
            You can close this browser and return from My appraisals. Package
            preparation continues independently of this page.
          </p>
        </div>
      </ClaimWorkflowCard>
    </ClaimWorkflowFrame>
  );
}
