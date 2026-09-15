import {
  BillingAddressElement,
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkflowError } from "@/features/total-loss-claim/components/claim-workflow-shell";
import type { TotalLossCheckoutProjection } from "@/features/total-loss-claim/contracts";
import { useTotalLossCheckoutMutation } from "@/features/total-loss-claim/queries";

const stripeInstances = new Map<string, Promise<Stripe | null>>();
const PAYMENT_LOADING_TIMEOUT_MS = 20_000;

function stripeFor(publishableKey: string) {
  let instance = stripeInstances.get(publishableKey);
  if (!instance) {
    instance = loadStripe(publishableKey);
    stripeInstances.set(publishableKey, instance);
  }
  return instance;
}

function PaymentForm({
  onConfirm,
  priceLabel,
  sessionId,
}: {
  readonly onConfirm: (sessionId: string) => void;
  readonly priceLabel?: string | null;
  readonly sessionId: string;
}) {
  const checkout = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [billingReady, setBillingReady] = useState(false);
  const [loadingDelayed, setLoadingDelayed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (checkout.type !== "loading") return;
    const timeout = setTimeout(() => setLoadingDelayed(true), PAYMENT_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [checkout.type]);

  const confirm = async () => {
    if (checkout.type !== "success" || submittingRef.current || !ready || !billingReady) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await checkout.checkout.confirm({ redirect: "if_required" });
      if (result.type === "error") {
        setError(result.error.message);
      } else {
        onConfirm(sessionId);
        return;
      }
    } catch {
      setError("We couldn’t confirm payment. Your saved checkout can be retried safely.");
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
      {checkout.type === "loading" ? (
        loadingDelayed ? (
          <div>
            <WorkflowError>Payment fields are taking longer than expected. No payment has been taken on this page. Reload to reopen your saved checkout.</WorkflowError>
            <Button className="mt-4" variant="outline" type="button" onClick={() => globalThis.location.reload()}>Reload secure payment</Button>
          </div>
        ) : <p className="py-5 text-sm text-copy" role="status">Loading secure payment fields…</p>
      ) : checkout.type === "error" ? (
        <WorkflowError>Payment fields could not load. Refresh to reopen your saved checkout.</WorkflowError>
      ) : (
        <div className="checkout-field-groups">
          <div>
            <h3 className="checkout-field-heading">Cardholder name and billing address</h3>
            <BillingAddressElement
              options={{ display: { name: "full" }, fields: { phone: "never" } }}
              onReady={() => setBillingReady(true)}
              onLoadError={() => {
                setBillingReady(false);
                setError("Billing fields could not load. Refresh to reopen your saved checkout.");
              }}
            />
          </div>
          <div>
            <h3 className="checkout-field-heading">Card details</h3>
            <PaymentElement
              options={{ layout: "accordion", fields: { billingDetails: "never" }, wallets: { link: "never", applePay: "never", googlePay: "never" } }}
              onReady={() => setReady(true)}
              onLoadError={() => {
                setReady(false);
                setError("Payment fields could not load. Refresh to reopen your saved checkout.");
              }}
            />
          </div>
        </div>
      )}
      {error ? <WorkflowError>{error}</WorkflowError> : null}
      {priceLabel ? <p className="checkout-confirm-total"><span>Total due</span><strong>{priceLabel}</strong></p> : null}
      <Button className="checkout-submit" disabled={checkout.type !== "success" || !ready || !billingReady || submitting} type="submit">
        {submitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {submitting ? "Confirming payment…" : "Complete purchase"}
      </Button>
    </form>
  );
}

export function EmbeddedPayment({
  accessToken,
  caseId,
  onConfirm,
  priceLabel,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly onConfirm: (sessionId: string | null) => void;
  readonly priceLabel?: string | null;
  readonly userId: string;
}) {
  const { mutateAsync } = useTotalLossCheckoutMutation({ accessToken, caseId, userId });
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const request = useRef<Promise<TotalLossCheckoutProjection> | null>(null);
  const [checkout, setCheckout] = useState<TotalLossCheckoutProjection | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    if (!request.current) {
      request.current = mutateAsync({ clientRequestId });
    }
    void request.current.then((result) => {
      if (!active) return;
      if (result.state === "checkout_ready" && result.clientSecret && result.publishableKey && result.checkoutSessionId) {
        setCheckout(result);
      } else if (result.state === "payment_pending" || result.state === "already_fulfilled") {
        onConfirm(result.checkoutSessionId);
      } else {
        setError(true);
      }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [clientRequestId, mutateAsync, onConfirm, retry]);

  if (error) {
    return (
      <div>
        <WorkflowError>Secure payment is temporarily unavailable. Your claim is saved; retrying will reuse any existing purchase.</WorkflowError>
        <Button className="mt-4" variant="outline" type="button" onClick={() => {
          request.current = mutateAsync({ clientRequestId });
          setError(false);
          setRetry((value) => value + 1);
        }}>Retry payment setup</Button>
      </div>
    );
  }
  if (!checkout?.clientSecret || !checkout.publishableKey || !checkout.checkoutSessionId) {
    return <p className="flex items-center gap-2 py-6 text-sm text-copy" role="status"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Preparing secure payment…</p>;
  }
  // Provider frames need the resolved document color rather than a CSS reference.
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#2563eb";
  return (
    <CheckoutElementsProvider
      key={checkout.checkoutSessionId}
      stripe={stripeFor(checkout.publishableKey)}
      options={{
        clientSecret: checkout.clientSecret,
        elementsOptions: {
          syncAddressCheckbox: "none",
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: accentColor, colorText: "#1a1a1a", colorTextSecondary: "#626262",
              colorDanger: "#b91c1c", colorBackground: "#ffffff", borderRadius: "4px",
              fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
              fontSizeBase: "16px", fontSizeSm: "13px", spacingUnit: "4px", gridRowSpacing: "20px",
            },
            rules: {
              ".Input": { border: "1px solid #bfbfbf", boxShadow: "none", padding: "12px" },
              ".Input:focus": { borderColor: accentColor, boxShadow: `0 0 0 1px ${accentColor}` },
              ".Input--invalid": { borderColor: "#b91c1c" },
              ".Input--invalid:focus": { borderColor: "#b91c1c", boxShadow: "0 0 0 1px #b91c1c" },
              ".Label": { marginBottom: "8px", color: "#626262", fontWeight: "400" },
              ".Block": { borderColor: "#dedede", boxShadow: "none", borderRadius: "4px" },
            },
          },
        },
      }}
    >
      <PaymentForm sessionId={checkout.checkoutSessionId} onConfirm={onConfirm} priceLabel={priceLabel} />
    </CheckoutElementsProvider>
  );
}
