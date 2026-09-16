import { Download, LoaderCircle } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Link, useLocation } from "react-router";
import { isPermanentAuthState, useAuth } from "@/features/auth/auth-context";
import type { TotalLossClaimSecured } from "../contracts";
import { useTotalLossClaimQuery } from "../queries";
import { canCloseCase } from "../resolution";
import { usePublishedReport } from "../use-published-report";

export function CaseAccountMenuActions() {
  const { auth } = useAuth();
  const location = useLocation();
  const caseId = location.pathname.match(/^\/total-loss\/cases\/([^/]+)\/claim\/review\//)?.[1];
  if (!caseId || !isPermanentAuthState(auth)) return null;
  return <ResolvedCaseMenu caseId={caseId} accessToken={auth.session.access_token} userId={auth.user.id} />;
}

function ResolvedCaseMenu(props: { caseId: string; accessToken: string; userId: string }) {
  const query = useTotalLossClaimQuery(props);
  const claim = query.data;
  if (claim?.state !== "secured" || !claim.report) return null;
  return <SavedCaseMenu {...props} claim={claim} reportId={claim.report.reportId} />;
}

function SavedCaseMenu({ claim, reportId, ...identity }: {
  claim: TotalLossClaimSecured; reportId: string; caseId: string; accessToken: string; userId: string;
}) {
  const location = useLocation();
  const { open, pendingAction, error } = usePublishedReport({ ...identity, reportVersionId: reportId });
  const search = new URLSearchParams(location.search);
  search.set("close", "case");
  return <DropdownMenu.Group aria-label="Current case">
    <DropdownMenu.Separator className="my-1 h-px bg-line" />
    <DropdownMenu.Item disabled={pendingAction !== null} onSelect={(event) => { event.preventDefault(); void open(false); }}
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink outline-none data-[highlighted]:bg-surface data-[disabled]:opacity-60">
      {pendingAction ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="size-4" aria-hidden />}
      {pendingAction ? "Preparing PDF…" : "Download PDF report"}
    </DropdownMenu.Item>
    {error ? <p className="px-2.5 py-2 text-xs text-red-700" role="alert">{error}</p> : null}
    {canCloseCase(claim) ? <DropdownMenu.Item asChild>
      <Link to={`${location.pathname}?${search.toString()}`} className="flex min-h-11 items-center rounded-lg px-2.5 text-xs text-copy outline-none data-[highlighted]:bg-surface focus:bg-surface">Close case</Link>
    </DropdownMenu.Item> : null}
  </DropdownMenu.Group>;
}
