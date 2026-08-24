import {
  AlertTriangle,
  ClipboardList,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useAdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies";
import {
  formatCaseOperationAnalysisStatus,
  formatCaseOperationDateTime,
  formatCaseOperationReference,
  formatCaseOperationService,
  formatCaseOperationStage,
} from "@/features/admin/case-operations/format";
import { useStaffCaseOperationsListQuery } from "@/features/admin/case-operations/queries";
import type { StaffCaseOperationListItem } from "@/features/admin/case-operations/types";
import { useAuth } from "@/features/auth";

export function AdminCaseOperationsPage() {
  const { auth } = useAuth();
  const dependencies = useAdminCaseOperationsDependencies();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const casesQuery = useStaffCaseOperationsListQuery({
    service: dependencies?.caseService ?? null,
    userId,
  });

  return (
    <section className="mx-auto w-full max-w-[90rem] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
      <div className="flex flex-col gap-4 border-b border-line pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
            Staff workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
            Customer and case operations
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-copy">
            Inspect active total-loss cases and submitted diminished-value
            requests. This workspace is read-only.
          </p>
        </div>
        {!casesQuery.isPending ? (
          <Button
            variant="outline"
            disabled={casesQuery.isFetching}
            onClick={() => void casesQuery.refetch()}
          >
            <RefreshCw
              className={
                casesQuery.isFetching
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
              aria-hidden
            />
            Refresh
          </Button>
        ) : null}
      </div>

      {casesQuery.isPending ? (
        <CasesLoadingState />
      ) : casesQuery.isError ? (
        <CasesErrorState onRetry={() => void casesQuery.refetch()} />
      ) : casesQuery.data.length === 0 ? (
        <CasesEmptyState />
      ) : (
        <ol className="mt-7 grid gap-4" aria-label="Customer cases">
          {casesQuery.data.map((item) => (
            <CaseCard key={item.caseId} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function CaseCard({ item }: { readonly item: StaffCaseOperationListItem }) {
  const detailPath =
    item.serviceType === "total_loss"
      ? `/admin/cases/${encodeURIComponent(item.caseId)}`
      : `/admin/diminished-value/${encodeURIComponent(item.caseId)}`;
  const customerName = item.contactFullName || item.customerFullName;
  const customerEmail = item.verifiedEmail || item.contactEmail;
  const customerEmailState = item.verifiedEmail
    ? "Verified email"
    : item.contactEmail
      ? "Entered email — not verified"
      : "Email unavailable";
  const accessState = item.ownerIsAnonymous
    ? "Guest session — access unclaimed"
    : item.identityClaimedAt
      ? "Access claimed"
      : "Account owner";

  return (
    <li className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <CasePill>{formatCaseOperationService(item.serviceType)}</CasePill>
        <CasePill tone={item.needsAttention ? "attention" : "neutral"}>
          {formatCaseOperationStage(item.caseStage)}
        </CasePill>
        {item.needsAttention ? (
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950">
            <AlertTriangle className="size-3.5" aria-hidden />
            Needs attention
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(14rem,1.25fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(11rem,0.9fr)_auto] lg:items-center">
        <div>
          <CardLabel>Customer</CardLabel>
          <p className="mt-1 font-semibold text-ink">
            {customerName || "Name not entered"}
          </p>
          <p className="mt-1 text-sm break-all text-copy">
            {customerEmail || "Email unavailable"}
          </p>
          <p className="mt-1 text-xs text-copy">
            {customerEmailState} · {accessState}
          </p>
        </div>

        <div>
          <CardLabel>Case</CardLabel>
          <p className="mt-1 font-mono text-sm font-semibold text-ink">
            #{formatCaseOperationReference(item.caseId)}
          </p>
          <p className="mt-1 text-sm text-copy">
            Created {formatCaseOperationDateTime(item.caseCreatedAt)}
          </p>
        </div>

        <div>
          <CardLabel>Activity</CardLabel>
          <p className="mt-1 text-sm font-semibold text-ink">
            {formatCaseOperationDateTime(item.lastActivityAt)}
          </p>
          <p className="mt-1 text-sm text-copy">
            Updated {formatCaseOperationDateTime(item.caseUpdatedAt)}
          </p>
        </div>

        <div>
          <CardLabel>Analysis</CardLabel>
          {item.serviceType === "total_loss" ? (
            <>
              <p className="mt-1 text-sm font-semibold text-ink">
                {formatCaseOperationAnalysisStatus(item.analysisStatus)}
              </p>
              <p className="mt-1 text-sm text-copy">
                {item.analysisAttemptCount === null
                  ? "No attempts"
                  : `${item.analysisAttemptCount} ${
                      item.analysisAttemptCount === 1 ? "attempt" : "attempts"
                    }`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-copy">Not applicable</p>
          )}
        </div>

        <Button asChild variant="outline">
          <Link to={detailPath}>
            {item.serviceType === "total_loss"
              ? "Open case"
              : "Open request"}
          </Link>
        </Button>
      </div>
    </li>
  );
}

function CasePill({
  children,
  tone = "brand",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "attention" | "brand" | "neutral";
}) {
  const colors =
    tone === "attention"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : tone === "neutral"
        ? "border-line bg-surface text-copy"
        : "border-brand/20 bg-brand-soft text-brand";
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${colors}`}
    >
      {children}
    </span>
  );
}

function CardLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
      {children}
    </p>
  );
}

function CasesLoadingState() {
  return (
    <div
      className="mt-7 grid animate-pulse gap-4 motion-reduce:animate-none"
      aria-label="Loading customer cases"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading customer cases…</span>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-48 rounded-2xl border border-line bg-white sm:h-36"
        />
      ))}
    </div>
  );
}

function CasesErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div
      className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-6"
      role="alert"
    >
      <h2 className="text-lg font-semibold text-red-950">
        We couldn’t load customer cases.
      </h2>
      <p className="mt-2 text-sm leading-6 text-red-900">
        A temporary connection problem interrupted the staff case list. No case
        data was changed.
      </p>
      <Button className="mt-5" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}

function CasesEmptyState() {
  return (
    <div className="mt-7 rounded-2xl border border-line bg-white p-8 text-center sm:p-12">
      <ClipboardList className="mx-auto size-10 text-copy" aria-hidden />
      <h2 className="mt-4 text-xl font-semibold text-ink">
        No customer cases
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-copy">
        Total-loss cases and submitted diminished-value requests will appear
        here. Unrelated accounts and diminished-value drafts are not included.
      </p>
    </div>
  );
}
