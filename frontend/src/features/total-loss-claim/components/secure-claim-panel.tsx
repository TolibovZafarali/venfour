import { LoaderCircle, MailCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import type { TotalLossClaimSecureRequired } from "@/features/total-loss-claim/contracts";
import { useRenewTotalLossClaimAccessLinkMutation } from "@/features/total-loss-claim/queries";
import { ApiError } from "@/lib/api/client";

interface SecureClaimPanelProps {
  readonly accessToken: string;
  readonly claim: TotalLossClaimSecureRequired;
  readonly onAccessStateChanged: () => Promise<unknown>;
  readonly userId: string;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function deliveryErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return "We couldn’t send the secure link. Please try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "We couldn’t send the secure link. Please try again.";
}

export function SecureClaimPanel({
  accessToken,
  claim,
  onAccessStateChanged,
  userId,
}: SecureClaimPanelProps) {
  const { sendMagicLink } = useAuth();
  const accessLink = useRenewTotalLossClaimAccessLinkMutation({
    accessToken,
    caseId: claim.caseId,
    userId,
  });
  const [delivery, setDelivery] = useState<
    | { readonly status: "idle" }
    | { readonly status: "sending" }
    | { readonly status: "sent" }
    | { readonly message: string; readonly status: "error" }
  >({ status: "idle" });
  const mountedRef = useRef(true);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
    };
  }, []);

  const sendAccessLink = async () => {
    if (delivery.status === "sending") return;
    setDelivery({ status: "sending" });
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const link = await accessLink.mutateAsync({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      if (link.state !== "secure_required") {
        await onAccessStateChanged();
        if (mountedRef.current && !controller.signal.aborted) {
          setDelivery({ status: "idle" });
        }
        return;
      }
      if (
        normalizedEmail(link.contactEmail) !==
        normalizedEmail(claim.contactEmail)
      ) {
        throw new Error(
          "The secure-link email no longer matches this claim. Refresh and try again.",
        );
      }
      await sendMagicLink(link.contactEmail, {
        callbackParameters: { case_claim: link.claimId },
        returnTo: `/total-loss/cases/${encodeURIComponent(link.caseId)}/claim`,
      });
      if (mountedRef.current && !controller.signal.aborted) {
        setDelivery({ status: "sent" });
      }
    } catch (error: unknown) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setDelivery({
        message: deliveryErrorMessage(error),
        status: "error",
      });
    } finally {
      if (mountedRef.current) accessLink.reset();
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  };

  return (
    <div>
      <div className="rounded-xl border border-line bg-surface/70 px-4 py-4">
        <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
          Claim email
        </p>
        <p className="mt-1 break-words text-base font-semibold text-ink">
          {claim.contactEmail}
        </p>
      </div>
      <p className="mt-4 max-w-xl text-sm leading-6 text-copy">
        Venfour will use the email already saved with this claim. Open the link
        from that inbox to connect the claim to a permanent, recoverable account.
      </p>
      {delivery.status === "sent" ? (
        <div
          className="mt-5 rounded-xl border border-market/25 bg-market-soft/55 p-4"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <MailCheck className="size-4 text-market-strong" aria-hidden />
            Secure link sent
          </p>
          <p className="mt-1 text-sm leading-6 text-copy">
            Check the saved email and open the newest Venfour link.
          </p>
        </div>
      ) : null}
      {delivery.status === "error" ? (
        <p className="mt-4 text-sm leading-6 text-red-700" role="alert">
          {delivery.message}
        </p>
      ) : null}
      <Button
        type="button"
        className="mt-5 w-full sm:w-auto"
        disabled={delivery.status === "sending"}
        onClick={() => void sendAccessLink()}
      >
        {delivery.status === "sending" ? (
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
        {delivery.status === "sending"
          ? "Sending secure link…"
          : delivery.status === "sent"
            ? "Resend secure link"
            : "Send secure link"}
      </Button>
    </div>
  );
}
