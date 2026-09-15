import { Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";

import { isPermanentAuthState, useAuth } from "@/features/auth/auth-context";
import { appraisalCaseQueryKeys } from "./queries";
import { useAppraisalCaseService } from "./service-context";
import type { AppraisalCaseService } from "./service";
import { appraisalWorkspaceHref, appraisalWorkspaceLabel, appraisalWorkspaceStatus } from "./workspace-navigation";

export function AppraisalSwitcher({ menu = true, onAction }: { menu?: boolean; onAction?: () => void }) {
  const { auth } = useAuth();
  const service = useAppraisalCaseService();
  const userId = isPermanentAuthState(auth) ? auth.user.id : null;
  if (!userId) return null;
  if (!service) return <p className="px-2.5 py-3 text-sm text-copy">Appraisals are temporarily unavailable.</p>;
  return <ResolvedAppraisalSwitcher service={service} userId={userId} menu={menu} onAction={onAction} />;
}

function ResolvedAppraisalSwitcher({ service, userId, menu, onAction }: {
  service: AppraisalCaseService; userId: string; menu: boolean; onAction?: () => void;
}) {
  const location = useLocation();
  const query = useQuery({
    queryKey: appraisalCaseQueryKeys.list(userId),
    queryFn: () => {
      if (!service || !userId) throw new Error("Your appraisals are unavailable.");
      return service.listAppraisalCases(userId);
    },
    enabled: Boolean(service && userId),
    refetchOnMount: "always",
    retry: false,
  });
  const cases = query.data ?? [];
  const unavailable = !service || query.isError || cases.some(item => item.userId !== userId);
  const currentId = location.pathname.match(/^\/total-loss\/cases\/([^/]+)/)?.[1] ?? new URLSearchParams(location.search).get("caseId");
  const title = <p className="px-2.5 pt-3 pb-2 text-xs font-medium text-copy">Appraisals</p>;
  const entries = <div className="max-h-[min(22rem,45svh)] overflow-y-auto overscroll-contain" data-appraisal-switcher>
    {unavailable ? <div className="px-2.5 py-3 text-sm text-copy" role="alert">We couldn’t load your appraisals. {service ? <button className="min-h-11 font-medium text-brand underline underline-offset-4" onClick={() => void query.refetch()}>Try again</button> : null}</div>
      : query.isPending || query.isFetching ? <p className="px-2.5 py-3 text-sm text-copy" role="status">Opening your appraisals…</p>
      : cases.length === 0 ? <p className="px-2.5 py-3 text-sm text-copy">Your first appraisal starts here.</p>
      : cases.map(item => {
        const selected = currentId === item.id;
        const label = appraisalWorkspaceLabel(item);
        const duplicate = cases.some(other => other.id !== item.id && appraisalWorkspaceLabel(other) === label);
        const destination = item.serviceType === "total_loss" ? `/total-loss/cases/${encodeURIComponent(item.id)}` : appraisalWorkspaceHref(item);
        const entry = <Link to={destination} onClick={onAction} aria-current={selected ? "page" : undefined}
          className="flex min-h-16 w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm text-ink outline-none transition-colors hover:bg-surface focus-visible:bg-surface data-[highlighted]:bg-surface motion-reduce:transition-none">
          <span className="min-w-0 flex-1"><span className="block break-words font-medium">{label}</span><span className="mt-1 block text-xs text-copy">{appraisalWorkspaceStatus(item)}{duplicate ? ` · ${item.id.slice(0, 8)}` : ""}</span></span>
          {selected ? <Check className="size-4 shrink-0 text-brand" aria-hidden /> : null}
        </Link>;
        return menu ? <DropdownMenu.Item key={item.id} asChild>{entry}</DropdownMenu.Item> : <div key={item.id}>{entry}</div>;
      })}
  </div>;
  return menu ? <DropdownMenu.Group aria-label="Appraisals">{title}{entries}</DropdownMenu.Group> : <section aria-label="Appraisals">{title}{entries}</section>;
}
