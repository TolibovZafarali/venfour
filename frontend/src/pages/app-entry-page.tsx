import { Navigate, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ValuationStatus } from "@/components/valuation-status";
import { clearAutomaticSubmissionRequests } from "@/features/analyses/case-analysis-queries";
import { isPermanentAuthState, useAuth, useSignInDialog } from "@/features/auth";
import { workspaceDestination } from "@/features/cases/workspace-entry";
import { appraisalCaseQueryKeys, appraisalCasesQueryOptions } from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import { useAppraisalCaseService } from "@/features/cases/service-context";

function ResolvedWorkspaceEntry({
  service,
  userId,
}: {
  readonly service: AppraisalCaseService;
  readonly userId: string;
}) {
  const roleQuery = useQuery({
    queryKey: [...appraisalCaseQueryKeys.user(userId), "workspaceRole"],
    queryFn: () => service.getWorkspaceRole?.() ?? Promise.resolve("customer"),
    retry: false,
    staleTime: 0,
  });
  const appraisalsQuery = useQuery({
    ...appraisalCasesQueryOptions({ service, userId: roleQuery.isSuccess && !roleQuery.isFetching && roleQuery.data === "customer" ? userId : null }),
    refetchOnMount: "always",
    staleTime: 0,
    retry: false,
  });

  if (roleQuery.isError) return <ValuationStatus kind="error" heading="We couldn’t open your workspace" description="Try again to securely check your account."><Button onClick={() => void roleQuery.refetch()}>Try again</Button></ValuationStatus>;
  if (roleQuery.isPending || roleQuery.isFetching) return <ValuationStatus kind="loading" heading="Opening your appraisal…" description="Checking secure access." />;
  if (roleQuery.data === "staff") return <Navigate replace to="/admin" />;
  if (roleQuery.data === "partner") return <Navigate replace to="/partners" />;

  if (appraisalsQuery.isPending || appraisalsQuery.isFetching) {
    return (
      <ValuationStatus
        kind="loading"
        heading="Opening your appraisal…"
        description="Finding where you left off."
      />
    );
  }

  const cases = appraisalsQuery.data ?? [];
  const responseOutsideOwnerScope = cases.some(
    (appraisalCase) => appraisalCase.userId !== userId,
  );
  if (appraisalsQuery.isError || responseOutsideOwnerScope) {
    return (
      <ValuationStatus
        kind="error"
        heading="We couldn’t open your appraisal"
        description="We couldn’t open your saved reviews right now."
      ><Button onClick={() => void appraisalsQuery.refetch()}>Try again</Button><Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button></ValuationStatus>
    );
  }

  return <Navigate replace to={workspaceDestination(cases, userId)} />;
}

export function WorkspaceEntry({
  userId,
}: {
  readonly userId: string;
}) {
  const service = useAppraisalCaseService();

  if (!service) {
    return (
      <ValuationStatus
        kind="error"
        heading="Your appraisal is temporarily unavailable"
        description="We couldn’t open your saved reviews right now."
      ><Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button></ValuationStatus>
    );
  }

  return (
    <ResolvedWorkspaceEntry
      service={service}
      userId={userId}
    />
  );
}

export function AppEntryPage() {
  useEffect(clearAutomaticSubmissionRequests, []);
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  if (auth.status === "loading") return <ValuationStatus kind="loading" heading="Opening your workspace" description="Finding your saved reviews." />;
  if (auth.status === "unavailable") return <ValuationStatus kind="error" heading="We couldn’t open your workspace" description={auth.reason}><Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button></ValuationStatus>;
  if (!isPermanentAuthState(auth)) return <ValuationStatus heading="Continue your appraisal" description="Sign in to pick up where you left off."><Button onClick={() => openSignIn({ returnTo: "/app" })}>Sign in</Button><Button asChild variant="outline"><Link to="/start?service=total-loss">Start new appraisal</Link></Button></ValuationStatus>;
  return <WorkspaceEntry userId={auth.user.id} />;
}
