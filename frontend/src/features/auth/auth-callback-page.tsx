import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Link, useLocation, useNavigate } from "react-router";

import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { useAuth } from "@/features/auth/auth-context";
import {
  consumeAuthReturnLocation,
  readAuthCallbackParameters,
} from "@/features/auth/return-location";

export function AuthCallbackPage() {
  const { auth, completeAuthCallback } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const callback = useMemo(
    () => readAuthCallbackParameters(location),
    [location],
  );
  const [completionError, setCompletionError] = useState<string | null>(null);
  const completionRef = useRef<{
    code: string;
    promise: Promise<Session>;
  } | null>(null);
  const navigationStartedRef = useRef(false);

  useEffect(() => {
    if (callback.error || auth.status === "unavailable") {
      return;
    }

    if (!callback.code) {
      if (auth.status === "signedIn" && !navigationStartedRef.current) {
        navigationStartedRef.current = true;
        void navigate(consumeAuthReturnLocation(), { replace: true });
      }
      return;
    }

    if (completionRef.current?.code !== callback.code) {
      completionRef.current = {
        code: callback.code,
        promise: completeAuthCallback(callback.code),
      };
    }

    let active = true;
    void completionRef.current.promise
      .then(() => {
        if (active && !navigationStartedRef.current) {
          navigationStartedRef.current = true;
          void navigate(consumeAuthReturnLocation(), { replace: true });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCompletionError(getFriendlyAuthError(error, "callback"));
        }
      });

    return () => {
      active = false;
    };
  }, [auth.status, callback.code, callback.error, completeAuthCallback, navigate]);

  const error =
    completionError ??
    (callback.error
      ? "This sign-in link is invalid or has expired. Please request a new one."
      : !callback.code && auth.status === "signedOut"
        ? "This sign-in link is missing required information. Please request a new one."
        : auth.status === "unavailable"
          ? "Sign in is temporarily unavailable. Please try again later."
          : null);

  return (
    <section className="flex w-full items-center justify-center px-5 py-16 sm:px-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-[0_20px_60px_-36px_rgba(11,31,51,0.48)] sm:p-8">
        {error ? (
          <>
            <CircleAlert
              className="mx-auto size-9 text-red-700"
              aria-hidden
            />
            <h1 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-ink">
              We couldn’t sign you in
            </h1>
            <p className="mt-2 text-sm leading-6 text-copy" role="alert">
              {error}
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              Return home
            </Link>
          </>
        ) : (
          <>
            <LoaderCircle
              className="mx-auto size-9 animate-spin text-brand motion-reduce:animate-none"
              aria-hidden
            />
            <h1 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-ink">
              Finishing your sign in
            </h1>
            <p className="mt-2 text-sm leading-6 text-copy" aria-live="polite">
              Verifying your secure link…
            </p>
          </>
        )}
      </div>
    </section>
  );
}
