import { useQuery } from "@tanstack/react-query";

import { isPermanentAuthState, useAuth } from "@/features/auth";
import { applicationHref, hostAudience } from "@/app/site-boundary";
import { appraisalWorkspaceHref } from "./workspace-navigation";
import { appraisalCaseQueryKeys } from "./queries";
import { useAppraisalCaseService } from "./service-context";
import type { AppraisalCase } from "./types";

export function workspaceDestination(cases: readonly AppraisalCase[], userId: string) {
  if (cases.some(item => item.userId !== userId)) throw new Error("Your appraisals could not be verified.");
  const ordered = [...cases].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || b.id.localeCompare(a.id));
  const active = ordered.find(item => item.status !== "closed" && item.caseStage !== "closed" &&
    (item.status !== "completed" || item.hasTotalLossClaimWorkflow));
  const focal = active ?? ordered[0];
  return focal ? appraisalWorkspaceHref(focal) : "/start?service=total-loss&entry=resume";
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
  const destination = hostAudience() !== "public" && userId && query.isSuccess &&
    query.data.every(item => item.userId === userId) ? workspaceDestination(query.data, userId) : "/app";
  return { href: applicationHref(destination), label: destination.startsWith("/total-loss/") || destination.startsWith("/start?") ? "Resume review" : "Open app" };
}
