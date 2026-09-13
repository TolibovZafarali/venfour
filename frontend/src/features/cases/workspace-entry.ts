import { useQuery } from "@tanstack/react-query";

import { isPermanentAuthState, useAuth } from "@/features/auth";
import { applicationHref, hostAudience } from "@/app/site-boundary";
import { selectWorkspaceCases } from "./workspace-selection";
import { appraisalCasePresentation } from "./presentation";
import { appraisalCaseQueryKeys } from "./queries";
import { useAppraisalCaseService } from "./service-context";
import type { AppraisalCase } from "./types";

export function workspaceDestination(cases: readonly AppraisalCase[], userId: string) {
  if (cases.some(item => item.userId !== userId)) return "/appraisals";
  const active = cases.filter(item => {
    if (item.serviceType !== "total_loss" || item.status === "closed" || item.caseStage === "closed") return false;
    const href = appraisalCasePresentation(item).action?.href;
    return href?.startsWith("/total-loss/cases/") || href?.startsWith("/start?service=total-loss");
  });
  const focal = selectWorkspaceCases(active).focalCase;
  return focal ? appraisalCasePresentation(focal).action?.href ?? "/appraisals" : "/appraisals";
}

export function useWorkspaceEntryAction(enabled = true) {
  const { auth } = useAuth();
  const service = useAppraisalCaseService();
  const userId = enabled && isPermanentAuthState(auth) ? auth.user.id : null;
  const query = useQuery({
    queryKey: appraisalCaseQueryKeys.list(userId),
    queryFn: () => {
      if (!service || !userId) throw new Error("Saved reviews are unavailable.");
      return service.listAppraisalCases(userId);
    },
    enabled: Boolean(userId && service),
    retry: false,
  });
  // Do not imply that a browser session is shared between production hosts.
  const destination = hostAudience() !== "public" && userId && query.isSuccess ? workspaceDestination(query.data, userId) : "/app";
  return { href: applicationHref(destination), label: destination.startsWith("/total-loss/") || destination.startsWith("/start?") ? "Resume review" : "Open app" };
}
