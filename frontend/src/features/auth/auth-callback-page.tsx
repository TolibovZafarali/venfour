import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Link, useLocation, useNavigate } from "react-router";

import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import {
  isAnonymousAuthState,
  isPermanentAuthState,
  isPermanentUser,
  useAuth,
} from "@/features/auth/auth-context";
import {
  consumeAuthReturnLocation,
  readAuthCallbackParameters,
  readCaseClaimCallbackParameter,
} from "@/features/auth/return-location";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";

export function AuthCallbackPage() {
  const {
    auth,
    completeAuthCallback,
    completeEmailAuthCallback,
    restoreSession,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const totalLossDependencies = useTotalLossDependencies();
  const callback = useMemo(
    () => readAuthCallbackParameters(location),
    [location],
  );
  const [completionError, setCompletionError] = useState<string | null>(null);
  const caseClaim = useMemo(
    () => readCaseClaimCallbackParameter(location),
    [location],
  );
  const completionRef = useRef<{
    key: string;
    promise: Promise<Session>;
  } | null>(null);
  const navigationStartedRef = useRef(false);
  const claimCompletionRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (
      callback.kind === "error" ||
      callback.kind === "invalid" ||
      caseClaim.kind === "invalid" ||
      auth.status === "loading" ||
      auth.status === "unavailable"
    ) {
      return;
    }

    if (callback.kind === "none") {
      if (isPermanentAuthState(auth) && !navigationStartedRef.current) {
        const claimKey =
          caseClaim.kind === "claim"
            ? `${caseClaim.claimId}:${auth.user.id}`
            : `none:${auth.user.id}`;
        if (claimCompletionRef.current?.key !== claimKey) {
          claimCompletionRef.current = {
            key: claimKey,
            promise:
              caseClaim.kind === "claim"
                ? completeCaseClaim(
                    totalLossDependencies?.totalLossIdentityService,
                    caseClaim.claimId,
                    auth.user.id,
                  )
                : Promise.resolve(),
          };
        }
        void claimCompletionRef.current.promise
          .then(() => {
            if (navigationStartedRef.current) return;
            navigationStartedRef.current = true;
            void navigate(completedAuthReturnLocation(caseClaim), {
              replace: true,
            });
          })
          .catch((error: unknown) => {
            setCompletionError(getFriendlyAuthError(error, "callback"));
          });
      }
      return;
    }

    const callbackKey =
      callback.kind === "email"
        ? `email:${callback.tokenHash}`
        : `code:${callback.code}:${callback.flowId ?? ""}`;
    const caseClaimKey =
      caseClaim.kind === "claim" ? caseClaim.claimId : "none";
    const completionKey = `${callbackKey}:case-claim:${caseClaimKey}`;

    if (completionRef.current?.key !== completionKey) {
      const recoverySession = isAnonymousAuthState(auth) ? auth.session : null;
      const verification =
        callback.kind === "email"
          ? completeEmailAuthCallback(callback.tokenHash)
          : completeAuthCallback(
              callback.code,
              callback.flowId ?? undefined,
            );
      completionRef.current = {
        key: completionKey,
        promise: verification.then(async (session) => {
          if (!isPermanentUser(session.user)) {
            throw new Error(
              "The sign-in callback did not return a permanent account.",
            );
          }
          if (caseClaim.kind === "claim") {
            try {
              await completeCaseClaim(
                totalLossDependencies?.totalLossIdentityService,
                caseClaim.claimId,
                session.user.id,
              );
            } catch (claimError: unknown) {
              if (recoverySession) {
                try {
                  await restoreSession(recoverySession);
                } catch {
                  // Preserve the original claim error when guest recovery is
                  // no longer possible (for example, after token expiry).
                }
              }
              throw claimError;
            }
          }
          return session;
        }),
      };
    }

    let active = true;
    void completionRef.current.promise
      .then(() => {
        if (!active || navigationStartedRef.current) return;
        navigationStartedRef.current = true;
        void navigate(completedAuthReturnLocation(caseClaim), {
          replace: true,
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setCompletionError(getFriendlyAuthError(error, "callback"));
        }
      });

    return () => {
      active = false;
    };
  }, [
    auth,
    caseClaim,
    callback,
    completeAuthCallback,
    completeEmailAuthCallback,
    navigate,
    restoreSession,
    totalLossDependencies?.totalLossIdentityService,
  ]);

  const error =
    completionError ??
    (callback.kind === "error" ||
    callback.kind === "invalid" ||
    caseClaim.kind === "invalid"
      ? "This sign-in link is invalid or has expired. Please request a new one."
      : callback.kind === "none" &&
          (auth.status === "signedOut" || isAnonymousAuthState(auth))
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

function completedAuthReturnLocation(
  caseClaim: ReturnType<typeof readCaseClaimCallbackParameter>,
) {
  const storedReturnLocation = consumeAuthReturnLocation();
  return caseClaim.kind === "claim" ? "/appraisals" : storedReturnLocation;
}

async function completeCaseClaim(
  identityService:
    | NonNullable<
        ReturnType<typeof useTotalLossDependencies>
      >["totalLossIdentityService"]
    | undefined,
  claimId: string,
  expectedUserId: string,
) {
  if (!identityService) {
    throw new Error("Secure case access is temporarily unavailable.");
  }
  const result = await identityService.completeIdentityClaim(claimId);
  if (!result || result.ownerUserId !== expectedUserId) {
    throw new Error("The secure case-access link could not be completed.");
  }
}
