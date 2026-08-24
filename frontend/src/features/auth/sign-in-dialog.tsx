import { Mail, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { Dialog } from "radix-ui";

import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { useAuth } from "@/features/auth/auth-context";
import type { SignInIntent } from "@/features/auth/sign-in-dialog-context";

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const actionClassName =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidSignInEmail(email: string) {
  return emailPattern.test(email.trim());
}

type PendingAction = "email" | "google" | null;

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusElement?: HTMLElement | null;
  returnTo?: string;
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
  restoreFocusElement,
  returnTo,
  intent = "default",
}: SignInDialogProps) {
  const { auth, sendMagicLink, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const googleButtonRef = useRef<HTMLButtonElement>(null);
  const pending = pendingAction !== null;

  const startGoogleSignIn = async () => {
    setError(null);
    setPendingAction("google");

    try {
      await signInWithGoogle({ returnTo });
    } catch (signInError) {
      setError(getFriendlyAuthError(signInError, "google"));
      setPendingAction(null);
    }
  };

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidSignInEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setError(null);
    setPendingAction("email");

    try {
      await sendMagicLink(normalizedEmail, { returnTo });
      setEmail(normalizedEmail);
      setEmailSent(true);
      setPendingAction(null);
    } catch (signInError) {
      setError(getFriendlyAuthError(signInError, "email"));
      setPendingAction(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
                ? "Use the secure link we sent to finish signing in."
                : intentDescriptions[intent]}
            </Dialog.Description>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className={`absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-lg text-copy transition-colors hover:bg-surface hover:text-ink ${focusRingClassName}`}
              aria-label="Close sign in"
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
                    We sent a sign-in link to{" "}
                    <span className="font-semibold break-all">{email}</span>.
                    The link expires in one hour.
                  </p>
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={`${actionClassName} ${focusRingClassName} mt-5 bg-brand text-white hover:bg-brand-strong`}
                >
                  Done
                </button>
              </Dialog.Close>
            </div>
          ) : (
            <div className="mt-6">
              <button
                ref={googleButtonRef}
                type="button"
                className={`${actionClassName} ${focusRingClassName} border border-line bg-white text-ink hover:border-line-strong hover:bg-surface`}
                disabled={pending}
                onClick={() => void startGoogleSignIn()}
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

              <div className="my-5 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                <span className="text-[0.6875rem] font-semibold tracking-[0.1em] text-copy/75 uppercase">
                  Or
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={(event) => void submitEmail(event)} noValidate>
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
                    ? "Sending secure link…"
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
                  No password needed. We’ll email you a one-time secure link.
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
