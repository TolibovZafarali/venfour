import { useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  isAnonymousAuthState,
  isPermanentAuthState,
  useAuth,
} from "@/features/auth";
import {
  CheckoutReturnScreen,
  CheckoutScreen,
  ProcessingScreen,
} from "@/features/total-loss-claim/components/checkout-experience";
import { ClaimStateCard } from "@/features/total-loss-claim/components/claim-state-card";
import { CompletedAnalysis } from "@/features/total-loss-claim/components/completed-analysis";
import { CompletedAnalysisModeGate } from "@/features/total-loss-claim/components/completed-analysis-mode-gate";
import type { TotalLossClaimSecured } from "@/features/total-loss-claim/contracts";
import { useTotalLossClaimQuery } from "@/features/total-loss-claim/queries";
import {
  authoritativeTotalLossClaimPath,
  canonicalCompletedAnalysisPath,
  isCompletedAnalysisView,
  totalLossClaimBasePath,
  type TotalLossClaimWorkflowView,
} from "@/features/total-loss-claim/workflow-route";
import { ApiError } from "@/lib/api/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function completedAnalysisIsAvailable(claim: TotalLossClaimSecured) {
  return (
    claim.report?.status === "published" &&
    (claim.commerce?.entitlementStatus === "active" ||
      claim.commerce?.entitlementStatus === "refunded_access_retained")
  );
}

function WorkflowContent({
  accessToken,
  caseId,
  claim,
  refetch,
  userId,
  view,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly refetch: () => Promise<unknown>;
  readonly userId: string;
  readonly view: TotalLossClaimWorkflowView;
}) {
  const [searchParameters] = useSearchParams();
  const location = useLocation();
  const authoritativePath = authoritativeTotalLossClaimPath(claim);
  const nextState = claim.journey?.nextState;

  if (view === "checkout") {
    const canCheckout =
      nextState === "checkout" ||
      nextState === "checkout_confirmation" ||
      (!claim.journey && claim.commerce?.nextTask === "checkout");
    if (!canCheckout && authoritativePath) {
      return <Navigate replace to={authoritativePath} />;
    }
    return (
      <CheckoutScreen
        accessToken={accessToken}
        canceled={searchParameters.get("checkout") === "canceled"}
        caseId={caseId}
        claim={claim}
        onRefresh={refetch}
        userId={userId}
      />
    );
  }

  if (view === "checkout_return") {
    const sessionId = searchParameters.get("session_id");
    const canConfirm =
      nextState === "checkout_confirmation" ||
      nextState === "checkout" ||
      (!claim.journey && claim.commerce?.paymentStatus === "pending");
    if (!canConfirm && authoritativePath) {
      return <Navigate replace to={authoritativePath} />;
    }
    return (
      <CheckoutReturnScreen
        accessToken={accessToken}
        caseId={caseId}
        checkoutSessionId={sessionId}
        claim={claim}
        onRefresh={refetch}
        userId={userId}
      />
    );
  }

  if (view === "processing") {
    const canProcess =
      nextState === "processing" ||
      nextState === "needs_attention" ||
      (!claim.journey &&
        ["purchase_complete", "finalizing", "exception_review"].includes(
          claim.commerce?.nextTask ?? claim.workflow?.currentTask ?? "",
        ));
    if (!canProcess && authoritativePath) {
      return <Navigate replace to={authoritativePath} />;
    }
    return <ProcessingScreen claim={claim} onRefresh={refetch} />;
  }

  if (!isCompletedAnalysisView(view) || !completedAnalysisIsAvailable(claim) || !claim.report) {
    if (authoritativePath && !authoritativePath.includes("/review/"))
      return <Navigate replace to={authoritativePath} />;
    return (
      <ClaimStateCard
        kind="error"
        heading="This part of your claim is not ready"
        description="Venfour couldn’t confirm that your completed report is available on this page. No case information has been changed."
      >
        <Button asChild variant="outline">
          <Link to="/appraisals">View my appraisals</Link>
        </Button>
      </ClaimStateCard>
    );
  }

  const report = claim.report;
  return (
    <CompletedAnalysisModeGate caseId={caseId} userId={userId}>
      {(intakeMode) => {
        const canonicalPath = canonicalCompletedAnalysisPath(caseId, view, searchParameters, intakeMode);
        if (`${location.pathname}${location.search}` !== canonicalPath) {
          return <Navigate replace to={canonicalPath} />;
        }
        return (
          <CompletedAnalysis
            accessToken={accessToken}
            caseId={caseId}
            claim={claim}
            intakeMode={intakeMode}
            key={report.reportId}
            onRefresh={refetch}
            report={report}
            userId={userId}
            view={view}
          />
        );
      }}
    </CompletedAnalysisModeGate>
  );
}

export function TotalLossClaimWorkflowPage({
  view,
}: {
  readonly view: TotalLossClaimWorkflowView;
}) {
  const { caseId: caseIdParameter = "" } = useParams();
  const { auth } = useAuth();

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
  const basePath = totalLossClaimBasePath(caseId);

  if (auth.status === "loading") {
    return (
      <ClaimStateCard
        kind="loading"
        heading="Checking your secure session…"
        description="Venfour is confirming access before loading this private claim."
      />
    );
  }
  if (auth.status === "unavailable") {
    return (
      <ClaimStateCard
        kind="error"
        heading="Secure claim access is unavailable"
        description={auth.reason}
      />
    );
  }
  if (
    auth.status === "signedOut" ||
    (!isPermanentAuthState(auth) &&
      !(view === "checkout" && isAnonymousAuthState(auth)))
  ) {
    return <Navigate replace to={basePath} />;
  }

  return (
    <AuthenticatedWorkflowPage
      key={`${auth.user.id}:${caseId}`}
      accessToken={auth.session.access_token}
      identity={isAnonymousAuthState(auth) ? "anonymous" : "permanent"}
      caseId={caseId}
      userId={auth.user.id}
      view={view}
    />
  );
}

function AuthenticatedWorkflowPage({
  accessToken,
  identity,
  caseId,
  userId,
  view,
}: {
  readonly identity: "anonymous" | "permanent";
  readonly accessToken: string;
  readonly caseId: string;
  readonly userId: string;
  readonly view: TotalLossClaimWorkflowView;
}) {
  const [verificationPending, setVerificationPending] = useState(false);
  const suspendRefetch =
    identity === "anonymous" && view === "checkout" && verificationPending;
  const claimQuery = useTotalLossClaimQuery({
    accessToken,
    caseId,
    suspendRefetch,
    userId,
  });

  if (
    claimQuery.data?.state === "secure_required" &&
    identity === "anonymous" &&
    view === "checkout" &&
    (!claimQuery.isError || suspendRefetch)
  ) {
    return (
      <CheckoutScreen
        accessToken={accessToken}
        canceled={false}
        caseId={caseId}
        claim={claimQuery.data}
        onRefresh={claimQuery.refetch}
        onVerificationPendingChange={setVerificationPending}
        userId={userId}
      />
    );
  }

  if (claimQuery.isPending) {
    return (
      <ClaimStateCard
        kind="loading"
        heading="Opening your claim…"
        description="Venfour is loading your saved case and completed evidence."
      />
    );
  }
  if (claimQuery.isError) {
    if (
      claimQuery.error instanceof ApiError &&
      [401, 404].includes(claimQuery.error.status)
    ) {
      return <Navigate replace to={totalLossClaimBasePath(caseId)} />;
    }
    return (
      <ClaimStateCard
        kind="error"
        heading="We couldn’t open this claim"
        description="Venfour couldn’t load the latest saved case details. No payment, report, or message information has been changed."
      >
        <Button onClick={() => void claimQuery.refetch()} type="button">
          Try again
        </Button>
      </ClaimStateCard>
    );
  }
  if (claimQuery.data.state !== "secured" || identity !== "permanent") {
    return <Navigate replace to={totalLossClaimBasePath(caseId)} />;
  }

  return (
    <WorkflowContent
      accessToken={accessToken}
      caseId={caseId}
      claim={claimQuery.data}
      refetch={claimQuery.refetch}
      userId={userId}
      view={view}
    />
  );
}
