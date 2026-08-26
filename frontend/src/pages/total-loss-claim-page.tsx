import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  isAnonymousAuthState,
  isPermanentAuthState,
  useAuth,
} from "@/features/auth";
import { ClaimRecoveryForm } from "@/features/total-loss-claim/components/claim-recovery-form";
import { ClaimStateCard } from "@/features/total-loss-claim/components/claim-state-card";
import { SecureClaimPanel } from "@/features/total-loss-claim/components/secure-claim-panel";
import { useTotalLossClaimQuery } from "@/features/total-loss-claim/queries";
import { ApiError } from "@/lib/api/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function RecoveryState({ caseId }: { readonly caseId: string }) {
  return (
    <ClaimStateCard
      heading="Request a secure claim link"
      description="Enter the email used for this claim. If the details match an eligible claim, Venfour will send a secure link."
    >
      <ClaimRecoveryForm caseId={caseId} />
    </ClaimStateCard>
  );
}

function AuthenticatedClaimPage({
  accessToken,
  identity,
  caseId,
  signOut,
  userId,
}: {
  readonly accessToken: string;
  readonly identity: "anonymous" | "permanent";
  readonly caseId: string;
  readonly signOut: () => Promise<void>;
  readonly userId: string;
}) {
  const claimQuery = useTotalLossClaimQuery({ accessToken, caseId, userId });

  if (claimQuery.isPending) {
    return (
      <ClaimStateCard
        kind="loading"
        heading="Checking your claim access…"
        description="Venfour is securely confirming the current owner and saved claim state."
      />
    );
  }

  if (claimQuery.isError) {
    if (claimQuery.error instanceof ApiError && claimQuery.error.status === 404) {
      return <RecoveryState caseId={caseId} />;
    }
    return (
      <ClaimStateCard
        kind="error"
        heading="We couldn’t open this claim"
        description="Venfour could not verify the current claim state. No claim information has been changed."
      >
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void claimQuery.refetch()}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link to="/contact">Contact support</Link>
          </Button>
        </div>
      </ClaimStateCard>
    );
  }

  const claim = claimQuery.data;
  if (claim.state === "secure_required") {
    if (identity !== "anonymous") {
      return (
        <ClaimStateCard
          kind="error"
          heading="Use the account associated with this claim"
          description="Venfour could not safely match this signed-in account to the claim contact. No ownership information has been changed."
        >
          <Button type="button" onClick={() => void signOut()}>
            Use a different account
          </Button>
        </ClaimStateCard>
      );
    }
    return (
      <ClaimStateCard
        heading="Secure and save your claim"
        description="Verify the email already saved with this claim so you can return from another browser or device."
      >
        <SecureClaimPanel
          accessToken={accessToken}
          claim={claim}
          onAccessStateChanged={claimQuery.refetch}
          userId={userId}
        />
      </ClaimStateCard>
    );
  }

  if (claim.state === "secured") {
    if (identity !== "permanent") {
      return (
        <ClaimStateCard
          kind="error"
          heading="We couldn’t verify permanent claim access"
          description="Refresh this page after signing in through your secure claim link."
        >
          <Button type="button" onClick={() => void claimQuery.refetch()}>
            Try again
          </Button>
        </ClaimStateCard>
      );
    }
    return (
      <ClaimStateCard
        eyebrow="Claim secured"
        heading="Your claim is saved to your account"
        description="This claim is connected to your verified Venfour account. You can safely leave and return later."
      >
        <Button asChild variant="outline">
          <Link to="/appraisals">View my appraisals</Link>
        </Button>
      </ClaimStateCard>
    );
  }

  return (
    <ClaimStateCard
      kind="error"
      heading="Use the account associated with this claim"
      description="Venfour could not safely match this signed-in account to the claim contact. No ownership information has been changed."
    >
      <Button type="button" onClick={() => void signOut()}>
        Use a different account
      </Button>
    </ClaimStateCard>
  );
}

export function TotalLossClaimPage() {
  const { caseId: caseIdParameter = "" } = useParams();
  const { auth, signOut } = useAuth();

  if (!UUID_PATTERN.test(caseIdParameter)) {
    return (
      <ClaimStateCard
        kind="error"
        heading="This claim link is invalid"
        description="Check the link and try again. Venfour has not changed any claim information."
      >
        <Button asChild variant="outline">
          <Link to="/">Return home</Link>
        </Button>
      </ClaimStateCard>
    );
  }

  const caseId = caseIdParameter.toLowerCase();

  if (auth.status === "loading") {
    return (
      <ClaimStateCard
        kind="loading"
        heading="Checking your secure session…"
        description="Venfour is confirming whether this browser already has access to the claim."
      />
    );
  }

  if (auth.status === "signedOut") return <RecoveryState caseId={caseId} />;

  if (auth.status === "unavailable") {
    return (
      <ClaimStateCard
        kind="error"
        heading="Secure claim access is unavailable"
        description={auth.reason}
      >
        <Button asChild variant="outline">
          <Link to="/contact">Contact support</Link>
        </Button>
      </ClaimStateCard>
    );
  }

  const identity = isAnonymousAuthState(auth)
    ? "anonymous"
    : isPermanentAuthState(auth)
      ? "permanent"
      : null;
  if (!identity) return <RecoveryState caseId={caseId} />;

  return (
    <AuthenticatedClaimPage
      key={`${identity}:${auth.user.id}`}
      accessToken={auth.session.access_token}
      identity={identity}
      caseId={caseId}
      signOut={signOut}
      userId={auth.user.id}
    />
  );
}
