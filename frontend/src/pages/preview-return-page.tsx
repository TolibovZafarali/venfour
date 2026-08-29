import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useCaseAnalysisQuery } from "@/features/analyses/case-analysis-queries";
import { isAnonymousAuthState, isPermanentUser, useAuth } from "@/features/auth";
import { readAuthCallbackParameters } from "@/features/auth/return-location";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import { PreviewRecoveryForm } from "@/features/total-loss/preview-recovery-form";
import { ClaimStateCard } from "@/features/total-loss-claim/components/claim-state-card";
import { ApiError } from "@/lib/api/client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function FindReviewPage() {
  return (
    <ClaimStateCard eyebrow="Your saved review" heading="Find your review"
      description="Enter the email you used in Contact Details. We’ll help you return securely.">
      <PreviewRecoveryForm />
    </ClaimStateCard>
  );
}

export function PreviewReturnPage() {
  const { caseId = "", claimId } = useParams();
  if (!UUID_PATTERN.test(caseId) || (claimId !== undefined && !UUID_PATTERN.test(claimId))) {
    return (
      <ClaimStateCard eyebrow="Your saved review" heading="Let’s find your review" description="This return link is incomplete. You can request a new link using your email.">
        <Button asChild><Link to="/find-review">Find my review</Link></Button>
      </ClaimStateCard>
    );
  }
  return <PreviewReturnContent key={`${caseId}:${claimId ?? ""}`} caseId={caseId} claimId={claimId} />;
}

function PreviewReturnContent({ caseId, claimId }: { readonly caseId: string; readonly claimId?: string }) {
  const location = useLocation();
  const { auth, completeEmailAuthCallback, completeAuthCallback, restoreSession } = useAuth();
  const dependencies = useTotalLossDependencies();
  const [verified, setVerified] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const verificationRef = useRef<Promise<void> | null>(null);
  const callback = useMemo(() => readAuthCallbackParameters(location), [location]);
  const access = useCaseAnalysisQuery({
    caseId,
    userId: auth.status === "signedIn" ? auth.user.id : null,
    accessToken: auth.status === "signedIn" ? auth.session.access_token : null,
  });
  const authorized = auth.status === "signedIn" && access.isSuccess && access.data.status !== "not_submitted";
  const denied = auth.status === "signedOut" || (
    access.isError && access.error instanceof ApiError && [401, 404].includes(access.error.status)
  );
  const canVerify = Boolean(claimId && denied && (callback.kind === "email" || callback.kind === "code"));

  useEffect(() => {
    if (!canVerify || !claimId || authorized || verificationFailed) return;
    if (!verificationRef.current) {
      const originalGuest = isAnonymousAuthState(auth) ? auth.session : null;
      verificationRef.current = (async () => {
        try {
          const identityService = dependencies?.totalLossIdentityService;
          if (!identityService) throw new Error("Secure access is unavailable.");
          const session = callback.kind === "email"
            ? await completeEmailAuthCallback(callback.tokenHash)
            : callback.kind === "code"
              ? await completeAuthCallback(callback.code, callback.flowId ?? undefined)
              : null;
          if (!session || !isPermanentUser(session.user)) throw new Error("Email verification was not completed.");
          const claim = await identityService.completeIdentityClaim(claimId);
          if (!claim || claim.caseId !== caseId || claim.ownerUserId !== session.user.id) {
            throw new Error("The return link did not match this review.");
          }
        } catch (error) {
          if (originalGuest) {
            try { await restoreSession(originalGuest); } catch { /* The recovery form remains available. */ }
          }
          throw error;
        }
      })();
    }
    // Identity changes during verification must not discard the completion.
    void verificationRef.current.then(() => setVerified(true), () => setVerificationFailed(true));
  }, [auth, authorized, callback, canVerify, caseId, claimId, completeAuthCallback,
    completeEmailAuthCallback, dependencies, restoreSession, verificationFailed]);

  if (verified || authorized) return <Navigate replace to={`/total-loss/cases/${caseId}/analysis`} />;

  if (auth.status === "loading" || (auth.status === "signedIn" && access.isPending) ||
    (canVerify && !verificationFailed)) {
    return <ClaimStateCard eyebrow="Your saved review" kind="loading" heading="Opening your review…"
      description="We’re checking secure access to your saved result." />;
  }

  if (auth.status === "unavailable" || (access.isError && !denied && !verificationFailed)) {
    return (
      <ClaimStateCard eyebrow="Your saved review" kind="error" heading="We couldn’t check access right now"
        description="Your saved review has not changed. Please try again in a moment.">
        <Button onClick={() => void access.refetch()}>Try again</Button>
      </ClaimStateCard>
    );
  }

  return (
    <ClaimStateCard eyebrow="Your saved review" heading="Return to your review"
      description={verificationFailed || callback.kind === "error" || callback.kind === "invalid"
        ? "This verification link can’t be used anymore. Request a fresh link below to continue securely."
        : "Enter the email you used in Contact Details to receive a secure return link."}>
      <PreviewRecoveryForm caseId={caseId} />
    </ClaimStateCard>
  );
}
