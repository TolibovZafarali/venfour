import { Link, Navigate, useLocation, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ValuationStatus } from "@/components/valuation-status";
import { clearAutomaticSubmissionRequests } from "@/features/analyses/case-analysis-queries";
import { useAuth, useSignInDialog } from "@/features/auth";
import { appraisalCasesQueryOptions } from "@/features/cases/queries";
import { useAppraisalCaseService } from "@/features/cases/service-context";
import type { AppraisalCaseService } from "@/features/cases/service";
import { appraisalWorkspaceHref } from "@/features/cases/workspace-navigation";

function ResolvedAppraisal({ service, userId, caseId }: { service: AppraisalCaseService; userId: string; caseId: string }) {
  const query = useQuery({ ...appraisalCasesQueryOptions({ service, userId }), refetchOnMount: "always", staleTime: 0, retry: false });
  if (query.isPending || query.isFetching) return <ValuationStatus kind="loading" heading="Opening your appraisal…" description="Finding where you left off." />;
  if (query.isError) return <ValuationStatus kind="error" heading="We couldn’t open your appraisal" description="Your saved progress is still here."><Button onClick={() => void query.refetch()}>Try again</Button></ValuationStatus>;
  const item = query.data.find(row => row.id === caseId && row.userId === userId && row.serviceType === "total_loss");
  if (!item || query.data.some(row => row.userId !== userId)) return <ValuationStatus kind="error" heading="This appraisal is unavailable" description="Sign in with the account that owns this appraisal, or use your secure return link."><Button asChild variant="outline"><Link to="/app">Return to your appraisal</Link></Button></ValuationStatus>;
  return <Navigate replace to={appraisalWorkspaceHref(item)} />;
}

export function AppraisalResumePage() {
  useEffect(clearAutomaticSubmissionRequests, []);
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const service = useAppraisalCaseService();
  const { caseId = "" } = useParams();
  const location = useLocation();
  if (auth.status === "loading") return <ValuationStatus kind="loading" heading="Opening your appraisal…" description="Checking secure access." />;
  if (auth.status !== "signedIn") return <ValuationStatus heading="Continue your appraisal" description="Sign in to pick up where you left off."><Button onClick={() => openSignIn({ returnTo: location.pathname })}>Sign in</Button></ValuationStatus>;
  if (!service) return <ValuationStatus kind="error" heading="Your appraisal is temporarily unavailable" description="Please try again later." />;
  return <ResolvedAppraisal service={service} userId={auth.user.id} caseId={caseId} />;
}
