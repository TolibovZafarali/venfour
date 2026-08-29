import { useQuery } from "@tanstack/react-query";

import { isAnonymousAuthState, useAuth } from "@/features/auth";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { useAppraisalCaseService } from "@/features/cases/service-context";
import type { AppraisalCase } from "@/features/cases/types";

export function selectGuestAnalysisReturn(cases: readonly AppraisalCase[], userId: string) {
  if (cases.some((appraisalCase) => appraisalCase.userId !== userId)) return null;
  const latest = cases
    .filter((appraisalCase) =>
      appraisalCase.serviceType === "total_loss" &&
      appraisalCase.status !== "closed" &&
      (appraisalCase.caseStage
        ? ["analysis_complete", "analysis_processing", "analysis_failed"].includes(appraisalCase.caseStage)
        : ["checking", "check_complete", "completed"].includes(appraisalCase.status) || appraisalCase.analysisStatus === "failed"),
    )
    .sort((first, second) =>
      second.lastActivityAt.localeCompare(first.lastActivityAt) || second.id.localeCompare(first.id),
    )[0];
  if (!latest) return null;
  const failed = latest.caseStage === "analysis_failed" || latest.analysisStatus === "failed";
  const processing = latest.caseStage === "analysis_processing" || latest.status === "checking";
  return {
    href: `/total-loss/cases/${encodeURIComponent(latest.id)}/analysis`,
    label: failed ? "Return to my review" : processing ? "View analysis progress" : "View my result",
    compactLabel: failed ? "Return to review" : processing ? "View progress" : "View my result",
  };
}

export function useGuestAnalysisReturn(enabled = true) {
  const { auth } = useAuth();
  const service = useAppraisalCaseService();
  const userId = enabled && isAnonymousAuthState(auth) ? auth.user.id : null;
  const query = useQuery({
    queryKey: appraisalCaseQueryKeys.list(userId),
    queryFn: () => {
      if (!service || !userId) throw new Error("Guest case access is unavailable.");
      return service.listAppraisalCases(userId);
    },
    enabled: Boolean(userId && service),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.data?.some(
      (appraisalCase) => appraisalCase.analysisStatus === "processing" || appraisalCase.status === "checking",
    ) ? 5_000 : false,
    retry: false,
  });
  return {
    action: userId && query.isSuccess ? selectGuestAnalysisReturn(query.data, userId) : null,
    pending: enabled && (auth.status === "loading" || Boolean(userId && service && query.isPending)),
  };
}
