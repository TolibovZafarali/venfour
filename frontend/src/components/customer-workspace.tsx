import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { useAppraisalCaseService } from "@/features/cases/service-context";
import type { AppraisalCaseService } from "@/features/cases/service";
import { InlineValuationProcessingBoundary } from "@/features/analyses/components/free-valuation-processing";
import "./customer-workspace.css";

export function CustomerWorkspace({ children, caseId }: {
  children: ReactNode;
  caseId?: string;
}) {
  return <div className="customer-workspace" data-workspace-case={caseId}>
    <div className="customer-workspace__stage"><InlineValuationProcessingBoundary>{children}</InlineValuationProcessingBoundary></div>
  </div>;
}

export function CustomerWorkspaceIdentity({ caseId }: { caseId?: string }) {
  const { auth } = useAuth();
  const service = useAppraisalCaseService();
  return <div className="customer-workspace__context">
    {caseId && service && auth.status === "signedIn"
      ? <WorkspaceIdentity caseId={caseId} service={service} userId={auth.user.id} />
      : <div className="customer-workspace__identity"><p>Your appraisal</p></div>}
  </div>;
}

function WorkspaceIdentity({ caseId, service, userId }: { caseId: string; service: AppraisalCaseService; userId: string }) {
  const query = useQuery({
    queryKey: appraisalCaseQueryKeys.list(userId),
    queryFn: () => service.listAppraisalCases(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const item = query.data?.find(item => item.id === caseId && item.userId === userId);
  return <div className="customer-workspace__identity" aria-label="Appraisal context" data-has-vehicle={Boolean(item?.vehicleLabel?.trim()) || undefined}>
    <p title={item?.vehicleLabel?.trim() || "Your appraisal"}>{item?.vehicleLabel?.trim() || "Your appraisal"}</p>
  </div>;
}
