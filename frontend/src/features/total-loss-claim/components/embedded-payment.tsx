import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkflowError } from "@/features/total-loss-claim/components/claim-workflow-shell";
import type { TotalLossCheckoutProjection } from "@/features/total-loss-claim/contracts";
import { useTotalLossCheckoutMutation } from "@/features/total-loss-claim/queries";

const stripeInstances = new Map<string, Promise<Stripe | null>>();

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
  sessionId,
}: {
  readonly onConfirm: (sessionId: string) => void;
  readonly sessionId: string;
}) {
  const checkout = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const confirm = async () => {
    if (checkout.type !== "success" || submittingRef.current || !ready) return;
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
        <p className="py-5 text-sm text-copy" role="status">Loading secure payment fields…</p>
      ) : checkout.type === "error" ? (
        <WorkflowError>Payment fields could not load. Refresh to reopen your saved checkout.</WorkflowError>
      ) : (
        <PaymentElement
          options={{ layout: "accordion", wallets: { link: "never", applePay: "never", googlePay: "never" } }}
          onReady={() => setReady(true)}
          onLoadError={() => {
            setReady(false);
            setError("Payment fields could not load. Refresh to reopen your saved checkout.");
          }}
        />
      )}
      {error ? <WorkflowError>{error}</WorkflowError> : null}
      <Button className="mt-6 min-h-12 w-full" disabled={checkout.type !== "success" || !ready || submitting} type="submit">
        {submitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <LockKeyhole className="size-4" aria-hidden />}
        {submitting ? "Confirming payment…" : "Complete purchase"}
      </Button>
    </form>
  );
}

export function EmbeddedPayment({
  accessToken,
  caseId,
  onConfirm,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly onConfirm: (sessionId: string | null) => void;
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
  return (
    <CheckoutElementsProvider
      key={checkout.checkoutSessionId}
      stripe={stripeFor(checkout.publishableKey)}
      options={{
        clientSecret: checkout.clientSecret,
        elementsOptions: {
          appearance: {
            theme: "stripe",
            variables: { colorPrimary: "#2457D6", colorText: "#0b1f33", colorDanger: "#b91c1c", borderRadius: "10px", fontFamily: "system-ui, sans-serif" },
          },
        },
      }}
    >
      <PaymentForm sessionId={checkout.checkoutSessionId} onConfirm={onConfirm} />
    </CheckoutElementsProvider>
  );
}
