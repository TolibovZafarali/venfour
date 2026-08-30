import { LoaderCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import { maskedClaimEmail } from "@/features/total-loss-claim/claim-email";
import type {
  TotalLossClaimRenewedAccessLink,
  TotalLossClaimSecureRequired,
} from "@/features/total-loss-claim/contracts";
import {
  EMAIL_OTP_COOLDOWN_EVENT,
  emailOtpRetryAt,
  startEmailOtpCooldown,
  withEmailOtpRequestLock,
} from "@/features/total-loss-claim/email-otp-cooldown";
import {
  emailOtpCaretOffset,
  formatEmailOtp,
  rawEmailOtp,
} from "@/features/total-loss-claim/email-otp-input";
import {
  ClaimEmailOtpError,
  claimEmailOtpService,
} from "@/features/total-loss-claim/email-otp-service";
import { useRenewTotalLossClaimAccessLinkMutation } from "@/features/total-loss-claim/queries";

interface EmailOtpClaimPanelProps {
  readonly accessToken: string;
  readonly claim: TotalLossClaimSecureRequired;
  readonly onAccessStateChanged: () => Promise<unknown>;
  readonly onVerificationPendingChange?: (pending: boolean) => void;
  readonly userId: string;
}

function verificationError(error: unknown, sending: boolean) {
  if (error instanceof ClaimEmailOtpError) {
    switch (error.code) {
      case "invalid_code":
      case "expired_code":
        return "That code is incorrect or has expired. Enter the newest code, or request a new one.";
      case "rate_limited":
        return "Please wait before trying again. If you already received a code, use the newest one.";
      case "identity_changed":
      case "aborted":
        return "Your sign-in changed. Refresh this page to check your claim access.";
      case "claim_conflict":
        return "We couldn’t verify access to this claim. Refresh the page and try again.";
      case "session_install_failed":
        return "Your email was verified, but we couldn’t finish securing your claim. Select Verify again to retry.";
      case "busy":
        return "Verification is already in progress. Please wait a moment.";
    }
  }
  return sending
    ? "We couldn’t send the verification code. Please try again."
    : "We couldn’t complete verification. Check your connection and try again.";
}

export function EmailOtpClaimPanel({
  accessToken,
  claim,
  onAccessStateChanged,
  onVerificationPendingChange,
  userId,
}: EmailOtpClaimPanelProps) {
  const { runTurnstileChallenge } = useAuth();
  const accessClaim = useRenewTotalLossClaimAccessLinkMutation({
    accessToken,
    caseId: claim.caseId,
    userId,
  });
  const [pendingClaim, setPendingClaim] = useState<TotalLossClaimRenewedAccessLink | null>(null);
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);
  const [code, setCode] = useState("");
  const [operation, setOperation] = useState<"idle" | "sending" | "resuming" | "verifying" | "completing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [canRetrySession, setCanRetrySession] = useState(false);
  const [retryAt, setRetryAt] = useState(() => emailOtpRetryAt(userId));
  const [now, setNow] = useState(Date.now);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const requestControllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const busy = operation !== "idle";
  const expired = Boolean(pendingClaim && Date.parse(pendingClaim.expiresAt) <= now);
  const resendSeconds = Math.max(0, Math.ceil((retryAt - now) / 1_000));

  useEffect(() => {
    mountedRef.current = true;
    const synchronizeCooldown = () => {
      setRetryAt(emailOtpRetryAt(userId));
      setNow(Date.now());
    };
    window.addEventListener("storage", synchronizeCooldown);
    window.addEventListener(EMAIL_OTP_COOLDOWN_EVENT, synchronizeCooldown);
    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
      window.removeEventListener("storage", synchronizeCooldown);
      window.removeEventListener(EMAIL_OTP_COOLDOWN_EVENT, synchronizeCooldown);
    };
  }, [userId]);

  useEffect(() => {
    if (!pendingClaim && !retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingClaim, retryAt]);

  useEffect(() => {
    if (pendingClaim) inputRef.current?.focus({ preventScroll: true });
  }, [pendingClaim]);

  useLayoutEffect(() => {
    if (caretRef.current !== null) {
      inputRef.current?.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [code]);

  const beginCooldown = () => {
    setRetryAt(startEmailOtpCooldown(userId));
    setNow(Date.now());
  };

  const sendCode = async () => {
    if (busyRef.current || retryAt > Date.now()) return;
    busyRef.current = true;
    setOperation("sending");
    setError(null);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    let renewedClaim: TotalLossClaimRenewedAccessLink | null = null;

    try {
      await withEmailOtpRequestLock(userId, async () => {
        if (controller.signal.aborted) return;
        const otherTabRetryAt = emailOtpRetryAt(userId);
        if (otherTabRetryAt > Date.now()) {
          setRetryAt(otherTabRetryAt);
          setNow(Date.now());
          return;
        }
        const otpService = claimEmailOtpService;
        if (!otpService) throw new Error("Verification is unavailable.");
        const link = await accessClaim.mutateAsync({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (link.state !== "secure_required") {
          await onAccessStateChanged();
          return;
        }
        if (
          link.caseId !== claim.caseId ||
          link.contactEmail.trim().toLowerCase() !== claim.contactEmail.trim().toLowerCase()
        ) {
          throw new ClaimEmailOtpError("claim_conflict");
        }
        renewedClaim = link;
        await runTurnstileChallenge(
          "magic-link",
          async (captchaToken) => {
            if (controller.signal.aborted) return;
            beginCooldown();
            await otpService.sendCode({
              captchaToken,
              caseId: link.caseId,
              email: link.contactEmail,
              expectedUserId: userId,
              signal: controller.signal,
            });
          },
          controller.signal,
        );
        if (!mountedRef.current || controller.signal.aborted) return;
        beginCooldown();
        setPendingClaim(link);
        setDeliveryConfirmed(true);
        setCode("");
        setCanRetrySession(false);
      });
    } catch (failure: unknown) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (failure instanceof ClaimEmailOtpError && failure.code === "rate_limited") {
        beginCooldown();
        // A code may already be in this customer's inbox from another tab.
        if (renewedClaim) setPendingClaim(renewedClaim);
      }
      setError(verificationError(failure, true));
    } finally {
      busyRef.current = false;
      if (mountedRef.current && !controller.signal.aborted) {
        setOperation("idle");
        accessClaim.reset();
      }
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const resumeCodeEntry = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setOperation("resuming");
    setError(null);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const link = await accessClaim.mutateAsync({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      if (link.state !== "secure_required") {
        await onAccessStateChanged();
      } else if (
        link.caseId === claim.caseId &&
        link.contactEmail.trim().toLowerCase() === claim.contactEmail.trim().toLowerCase()
      ) {
        setPendingClaim(link);
        setDeliveryConfirmed(false);
      } else {
        throw new ClaimEmailOtpError("claim_conflict");
      }
    } catch (failure: unknown) {
      if (mountedRef.current && !controller.signal.aborted) setError(verificationError(failure, false));
    } finally {
      busyRef.current = false;
      if (mountedRef.current && !controller.signal.aborted) {
        setOperation("idle");
        accessClaim.reset();
      }
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const verifyCode = async () => {
    const token = rawEmailOtp(code);
    if (busyRef.current || !pendingClaim || (!canRetrySession && (token.length !== 6 || expired))) return;
    busyRef.current = true;
    setOperation("verifying");
    onVerificationPendingChange?.(true);
    setError(null);
    setCode("");
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      if (!claimEmailOtpService) throw new Error("Verification is unavailable.");
      await claimEmailOtpService.verifyCodeAndClaim({
        caseId: pendingClaim.caseId,
        claimId: pendingClaim.claimId,
        email: pendingClaim.contactEmail,
        expectedUserId: userId,
        signal: controller.signal,
        token,
      });
      // The completed transfer is published through the normal Auth listener.
      // Its new identity fetches the claim without querying with the old token.
      if (mountedRef.current && !controller.signal.aborted) setOperation("completing");
    } catch (failure: unknown) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const retryableSession = failure instanceof ClaimEmailOtpError && failure.code === "session_install_failed";
      setCanRetrySession(retryableSession);
      onVerificationPendingChange?.(retryableSession);
      setError(verificationError(failure, false));
      if (failure instanceof ClaimEmailOtpError && failure.code === "rate_limited") beginCooldown();
      setOperation("idle");
      inputRef.current?.focus({ preventScroll: true });
    } finally {
      busyRef.current = false;
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  return (
    <div>
      <p className="break-words text-base font-semibold text-ink">{maskedClaimEmail(claim.contactEmail)}</p>
      {!claimEmailOtpService ? <p className="mt-3 text-sm leading-6 text-red-700" role="alert">Secure email verification is unavailable in this browser. Reload the page or try another browser.</p> : null}
      {pendingClaim ? (
        <form
          className="mt-4"
          onSubmit={(event) => { event.preventDefault(); void verifyCode(); }}
        >
          <p className="text-sm leading-6 text-copy" role="status">
            {deliveryConfirmed ? "We sent a 6-digit code to " : "Use the newest code sent to "}{maskedClaimEmail(claim.contactEmail)}
          </p>
          <label className="mt-4 block text-sm font-medium leading-6 text-ink" htmlFor="claim-verification-code">
            Enter the 6-digit code we sent to your email
          </label>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <input
              ref={inputRef}
              id="claim-verification-code"
              name="claim-verification-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="123-456"
              value={code}
              disabled={busy || expired || canRetrySession}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "claim-verification-error" : "claim-verification-help"}
              className="min-h-12 w-44 rounded-xl border border-line bg-white px-4 text-center text-xl font-semibold tracking-[0.14em] text-ink tabular-nums outline-none placeholder:text-copy/45 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:opacity-60"
              onChange={(event) => {
                const digitsBeforeCaret = rawEmailOtp(event.target.value.slice(0, event.target.selectionStart ?? event.target.value.length)).length;
                caretRef.current = emailOtpCaretOffset(digitsBeforeCaret);
                setCode(formatEmailOtp(event.target.value));
                setError(null);
              }}
              onPaste={(event) => {
                event.preventDefault();
                const formatted = formatEmailOtp(event.clipboardData.getData("text"));
                caretRef.current = formatted.length;
                setCode(formatted);
                setError(null);
              }}
              onKeyDown={(event) => {
                const { selectionStart, selectionEnd } = event.currentTarget;
                if (selectionStart !== selectionEnd || !code.includes("-")) return;
                if (event.key === "Backspace" && selectionStart === 4) {
                  event.preventDefault();
                  caretRef.current = 2;
                  setCode(formatEmailOtp(code.slice(0, 2) + code.slice(4)));
                } else if (event.key === "Delete" && selectionStart === 3) {
                  event.preventDefault();
                  caretRef.current = 3;
                  setCode(formatEmailOtp(code.slice(0, 3) + code.slice(5)));
                }
              }}
            />
            <Button className="min-h-12 min-w-24" type="submit" disabled={busy || (!canRetrySession && (rawEmailOtp(code).length !== 6 || expired))}>
              {operation === "verifying" || operation === "completing" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {operation === "verifying" || operation === "completing" ? "Verifying…" : "Verify"}
            </Button>
          </div>
          <p id="claim-verification-help" className="mt-2 text-xs leading-5 text-copy">Use the newest code. You can paste all six digits.</p>
          {expired && !canRetrySession ? <p className="mt-3 text-sm leading-6 text-red-700" role="alert">This verification request has expired. Request a new code to continue.</p> : null}
        </form>
      ) : <p className="mt-3 max-w-xl text-sm leading-6 text-copy">Verify your saved email to securely save your report and claim progress.</p>}
      {error ? <p id="claim-verification-error" className="mt-4 text-sm leading-6 text-red-700" role="alert">{error}</p> : null}
      {!pendingClaim ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button className="w-full sm:w-auto" type="button" disabled={!claimEmailOtpService || busy || resendSeconds > 0} onClick={() => void sendCode()}>
            {operation === "sending" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {operation === "sending" ? "Sending verification code…" : "Send verification code"}
          </Button>
          <button className="min-h-11 text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:opacity-60" type="button" disabled={!claimEmailOtpService || busy} onClick={() => void resumeCodeEntry()}>
            {operation === "resuming" ? "Checking verification…" : "Already have a code?"}
          </button>
        </div>
      ) : resendSeconds === 0 && !canRetrySession ? (
        <Button className="mt-4" variant="outline" type="button" disabled={busy} onClick={() => void sendCode()}>
          {operation === "sending" ? "Sending verification code…" : "Resend code"}
        </Button>
      ) : null}
      {resendSeconds > 0 ? <p className="mt-3 text-xs leading-5 text-copy">You can resend in {resendSeconds}s.</p> : null}
    </div>
  );
}
