import { Mail, ShieldCheck, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Dialog } from "radix-ui";

import appleLogo from "@/assets/apple-logo-white.svg";
import {
  completeCaseClaim,
  completedAuthReturnLocation,
} from "@/features/auth/auth-completion";
import {
  emailOtpCaretOffset,
  formatEmailOtp,
  rawEmailOtp,
} from "@/features/auth/email-otp-input";
import {
  getAuthCallbackUrl,
  readCaseClaimCallbackParameter,
} from "@/features/auth/return-location";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";

import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { isAnonymousAuthState, useAuth } from "@/features/auth/auth-context";
import type { AuthActionOptions } from "@/features/auth/auth-context";
import type { SignInIntent } from "@/features/auth/sign-in-dialog-context";

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const actionClassName =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidSignInEmail(email: string) {
  return emailPattern.test(email.trim());
}

type PendingAction = "email" | "verify" | "google" | "apple" | null;

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignInComplete?: () => void;
  restoreFocusElement?: HTMLElement | null;
  returnTo?: string;
  callbackParameters?: AuthActionOptions["callbackParameters"];
  intent?: SignInIntent;
}

const intentDescriptions: Record<SignInIntent, string> = {
  default:
    "Sign in to securely save your supported review or diminished-value request.",
  "secure-report-upload":
    "Sign in to open a saved Total Loss case and its private valuation report.",
  "continue-total-loss":
    "Sign in to securely save your total-loss information and continue to the free value check.",
  "continue-diminished-value":
    "Sign in to securely save your diminished-value request and supporting documents.",
  "staff-review":
    "Sign in with an authorized Venfour staff account to open the secure review workspace.",
};

export function SignInDialog({
  open,
  onOpenChange,
  onSignInComplete,
  restoreFocusElement,
  returnTo,
  callbackParameters,
  intent = "default",
}: SignInDialogProps) {
  const {
    auth,
    sendEmailCode,
    completeEmailCode,
    restoreSession,
    signInWithGoogle,
    signInWithApple,
  } = useAuth();
  const navigate = useNavigate();
  const dependencies = useTotalLossDependencies();
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [code, setCode] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const resendSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const googleButtonRef = useRef<HTMLButtonElement>(null);
  const pending = pendingAction !== null;

  useEffect(() => {
    const resetOAuthPending = () => {
      setPendingAction((action) =>
        action === "google" || action === "apple" ? null : action,
      );
    };
    window.addEventListener("pageshow", resetOAuthPending);
    return () => window.removeEventListener("pageshow", resetOAuthPending);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    if (emailSent) inputRef.current?.focus();
  }, [emailSent]);

  useLayoutEffect(() => {
    if (caretRef.current !== null) {
      inputRef.current?.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [code]);

  const startOAuthSignIn = async (provider: "google" | "apple") => {
    setError(null);
    setPendingAction(provider);

    try {
      const signIn = provider === "apple" ? signInWithApple : signInWithGoogle;
      await signIn({ returnTo, callbackParameters });
    } catch (signInError) {
      setError(getFriendlyAuthError(signInError, provider));
      setPendingAction(null);
    }
  };

  const sendCode = async () => {
    if (busyRef.current || retryAt > Date.now()) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidSignInEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setPendingAction("email");
    try {
      await sendEmailCode(normalizedEmail, { returnTo });
      if (!mountedRef.current) return;
      setEmail(normalizedEmail);
      setEmailSent(true);
      setCode("");
      setRetryAt(Date.now() + 60_000);
      setNow(Date.now());
    } catch (signInError) {
      if (mountedRef.current)
        setError(getFriendlyAuthError(signInError, "send-code"));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPendingAction(null);
    }
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    const token = rawEmailOtp(code);
    if (token.length !== 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setPendingAction("verify");
    const recoverySession = isAnonymousAuthState(auth) ? auth.session : null;
    try {
      const caseClaim = readCaseClaimCallbackParameter(
        new URL(getAuthCallbackUrl(callbackParameters)),
      );
      const session = await completeEmailCode(email, token);
      let completedClaim = null;
      if (caseClaim.kind === "claim") {
        try {
          completedClaim = await completeCaseClaim(
            dependencies?.totalLossIdentityService,
            caseClaim.claimId,
            session.user.id,
          );
        } catch (claimError) {
          if (recoverySession) {
            try {
              await restoreSession(recoverySession);
            } catch {
              // Keep the original case-access error if the guest session expired.
            }
          }
          throw claimError;
        }
      }
      if (!mountedRef.current) return;
      const destination = completedAuthReturnLocation(
        caseClaim,
        completedClaim,
      );
      onSignInComplete?.();
      onOpenChange(false);
      void navigate(destination, { replace: true });
    } catch (signInError) {
      if (mountedRef.current)
        setError(getFriendlyAuthError(signInError, "verify-code"));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPendingAction(null);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (pendingAction !== "verify") onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/32 backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-[71] max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/80 bg-white p-5 shadow-[0_28px_80px_-28px_rgba(11,31,51,0.58)] focus:outline-none sm:p-6"
          onOpenAutoFocus={(event) => {
            if (auth.status !== "unavailable" && !emailSent) {
              event.preventDefault();
              googleButtonRef.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (restoreFocusElement) {
              event.preventDefault();
              queueMicrotask(() => restoreFocusElement.focus());
            }
          }}
        >
          <div className="pr-10">
            <Dialog.Title className="text-xl font-semibold tracking-[-0.025em] text-ink">
              {emailSent ? "Check your email" : "Sign in to Venfour"}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-copy">
              {emailSent
                ? "Enter the six-digit code below to finish signing in."
                : intentDescriptions[intent]}
            </Dialog.Description>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className={`absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-lg text-copy transition-colors hover:bg-surface hover:text-ink ${focusRingClassName}`}
              aria-label="Close sign in"
              disabled={pendingAction === "verify"}
            >
              <X className="size-4" aria-hidden />
            </button>
          </Dialog.Close>

          {auth.status === "unavailable" ? (
            <div
              className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
              role="alert"
            >
              Sign in is temporarily unavailable. Please try again later.
            </div>
          ) : emailSent ? (
            <div className="mt-6">
              <div
                className="rounded-xl border border-brand/15 bg-brand-soft/55 p-4"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-start gap-3">
                  <Mail
                    className="mt-0.5 size-5 shrink-0 text-brand"
                    aria-hidden
                  />
                  <p className="min-w-0 text-sm leading-6 text-ink">
                    We sent a sign-in code to{" "}
                    <span className="font-semibold break-all">{email}</span>.
                  </p>
                </div>
              </div>
              <form
                className="mt-5"
                onSubmit={(event) => void submitCode(event)}
                noValidate
              >
                <label
                  htmlFor="sign-in-code"
                  className="text-sm font-semibold text-ink"
                >
                  Sign-in code
                </label>
                <input
                  ref={inputRef}
                  id="sign-in-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123-456"
                  value={code}
                  disabled={pending}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "sign-in-code-error" : undefined}
                  className={`mt-2 min-h-12 w-full rounded-lg border border-line px-3 text-center font-mono text-2xl tracking-[0.15em] text-ink disabled:bg-surface ${focusRingClassName}`}
                  onChange={(event) => {
                    const value = event.target.value;
                    caretRef.current = emailOtpCaretOffset(
                      rawEmailOtp(
                        value.slice(
                          0,
                          event.target.selectionStart ?? value.length,
                        ),
                      ).length,
                    );
                    setCode(formatEmailOtp(value));
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    const input = event.currentTarget;
                    const caret = input.selectionStart;
                    if (
                      event.key === "Backspace" &&
                      caret === 4 &&
                      input.selectionEnd === 4 &&
                      code[3] === "-"
                    ) {
                      event.preventDefault();
                      setCode(
                        formatEmailOtp(
                          rawEmailOtp(code).slice(0, 2) +
                            rawEmailOtp(code).slice(3),
                        ),
                      );
                      caretRef.current = 2;
                    } else if (
                      event.key === "Delete" &&
                      caret === 3 &&
                      input.selectionEnd === 3 &&
                      code[3] === "-"
                    ) {
                      event.preventDefault();
                      caretRef.current = 3;
                      setCode(formatEmailOtp(code.slice(0, 3) + code.slice(5)));
                    }
                  }}
                />
                {error ? (
                  <p
                    id="sign-in-code-error"
                    className="mt-3 text-sm leading-5 text-red-700"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={pending}
                  className={`${actionClassName} ${focusRingClassName} mt-4 bg-brand text-white hover:bg-brand-strong`}
                >
                  {pendingAction === "verify"
                    ? "Signing in…"
                    : "Verify and sign in"}
                </button>
              </form>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={pending || resendSeconds > 0}
                  className={`min-h-11 rounded text-sm font-medium text-brand disabled:text-copy/60 ${focusRingClassName}`}
                  onClick={() => void sendCode()}
                >
                  {pendingAction === "email"
                    ? "Sending code…"
                    : resendSeconds > 0
                      ? `Resend code in ${resendSeconds}s`
                      : "Resend code"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={`min-h-11 rounded text-sm font-medium text-copy ${focusRingClassName}`}
                  onClick={() => {
                    setEmailSent(false);
                    setCode("");
                    setError(null);
                    setRetryAt(0);
                  }}
                >
                  Change email
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <button
                ref={googleButtonRef}
                type="button"
                className={`${actionClassName} ${focusRingClassName} border border-line bg-white text-ink hover:border-line-strong hover:bg-surface`}
                disabled={pending}
                onClick={() => void startOAuthSignIn("google")}
              >
                <svg
                  className="size-5 shrink-0"
                  viewBox="0 0 18 18"
                  aria-hidden
                >
                  <path
                    fill="#4285F4"
                    d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.615Z"
                  />
                  <path
                    fill="#34A853"
                    d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.329-1.586-5.037-3.717H.956v2.333A8.997 8.997 0 0 0 9 18Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M3.963 10.704A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.281-1.704V4.963H.956A8.997 8.997 0 0 0 0 9c0 1.453.348 2.827.956 4.037l3.007-2.333Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M9 3.579c1.321 0 2.508.455 3.442 1.346l2.582-2.581C13.464.892 11.426 0 9 0A8.997 8.997 0 0 0 .956 4.963l3.007 2.333C4.671 5.166 6.656 3.579 9 3.579Z"
                  />
                </svg>
                {pendingAction === "google"
                  ? "Connecting to Google…"
                  : "Continue with Google"}
              </button>

              <button
                type="button"
                className={`${actionClassName} ${focusRingClassName} mt-3 h-11 gap-0 bg-black pr-6 pl-2 text-white hover:ring-2 hover:ring-black/15`}
                disabled={pending}
                aria-busy={pendingAction === "apple"}
                onClick={() => void startOAuthSignIn("apple")}
              >
                <img
                  src={appleLogo}
                  className="h-11 w-auto shrink-0"
                  alt=""
                  aria-hidden
                />
                Continue with Apple
              </button>
              {pendingAction === "apple" ? (
                <p className="sr-only" role="status">
                  Connecting to Apple…
                </p>
              ) : null}
              {isAnonymousAuthState(auth) ? (
                <p className="mt-3 text-xs leading-5 text-copy">
                  Already started a case? Open the secure link we emailed you to
                  access it.
                </p>
              ) : null}

              <div className="my-5 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                <span className="text-[0.6875rem] font-semibold tracking-[0.1em] text-copy/75 uppercase">
                  Or
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendCode();
                }}
                noValidate
              >
                <label
                  htmlFor="sign-in-email"
                  className="text-sm font-semibold text-ink"
                >
                  Email address
                </label>
                <input
                  id="sign-in-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  disabled={pending}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "sign-in-error" : undefined}
                  className={`mt-2 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink shadow-sm transition-colors placeholder:text-copy/55 hover:border-line-strong disabled:cursor-not-allowed disabled:bg-surface ${focusRingClassName}`}
                  placeholder="you@example.com"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError(null);
                  }}
                />
                <button
                  type="submit"
                  className={`${actionClassName} ${focusRingClassName} mt-3 bg-brand text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-brand-strong`}
                  disabled={pending}
                >
                  <Mail className="size-4" aria-hidden />
                  {pendingAction === "email"
                    ? "Sending code…"
                    : "Continue with Email"}
                </button>
              </form>

              {error ? (
                <p
                  id="sign-in-error"
                  className="mt-3 text-sm leading-5 text-red-700"
                  role="alert"
                >
                  {error}
                </p>
              ) : (
                <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-copy">
                  <ShieldCheck
                    className="mt-0.5 size-3.5 shrink-0 text-market-strong"
                    aria-hidden
                  />
                  No password needed. We’ll email you a one-time sign-in code.
                </p>
              )}

              <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-copy">
                Venfour will ask you to confirm its{" "}
                <Link
                  to="/terms"
                  className={`rounded-sm font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:text-brand ${focusRingClassName}`}
                  onClick={() => onOpenChange(false)}
                >
                  Terms of Use
                </Link>{" "}
                and acknowledge its{" "}
                <Link
                  to="/privacy"
                  className={`rounded-sm font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:text-brand ${focusRingClassName}`}
                  onClick={() => onOpenChange(false)}
                >
                  Privacy Policy
                </Link>{" "}
                after sign-in. You can also review the{" "}
                <Link
                  to="/cookies"
                  className={`rounded-sm font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:text-brand ${focusRingClassName}`}
                  onClick={() => onOpenChange(false)}
                >
                  Cookie Policy
                </Link>
                .
              </p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
