import { ArrowUpRight, BriefcaseBusiness, CircleAlert, UsersRound, Workflow } from "lucide-react";
import { Link, useParams } from "react-router";

import { formatCaseOperationDateTime, formatCaseOperationReference } from "@/features/admin/case-operations/format";
import { AdminPersonMark, AdminRecordTime } from "@/features/admin/operations/record-presentation";
import { AdminCollection, RecordFacts, type AdminFilterDefinition } from "@/features/admin/operations/collection";
import { AdminBackLink, AdminBadge, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminRefreshNotice, AdminPageHeader, AdminPanel } from "@/features/admin/operations/page-ui";
import { adminActivityTitle, adminCaseHref, adminStatusTone, humanizeAdminCode } from "@/features/admin/operations/ui-format";
import { reportFilters, processingFilters, paymentFilters, activityFilters } from "@/features/admin/operations/page-options";
import { useAdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies";
import { useAdminCustomer, useAdminOverview } from "@/features/admin/operations/queries";

export function AdminOverviewPage() {
  const query = useAdminOverview();
  const dependencies = useAdminCaseOperationsDependencies();
  if (!dependencies?.operationsService) return <section className="admin-page"><AdminEmptyState title="Operations unavailable" description="The staff operations service is not configured for this environment." /></section>;
  return <section className="admin-page admin-overview-page"><AdminPageHeader title="Overview" description="The state of your workspace. Start with what needs your attention." refreshing={query.isFetching} onRefresh={() => void query.refetch()} />
    {query.isPending ? <AdminLoadingState label="Loading operations overview…" /> : query.isError && !query.data ? <AdminErrorState onRetry={() => void query.refetch()} /> : <>
      {query.isError ? <AdminRefreshNotice /> : null}
      <div className="admin-metric-grid">{[
        { label: "Active cases", value: query.data.activeCases, icon: BriefcaseBusiness, note: "Total-loss cases in progress", href: "/admin/cases?active=true" },
        { label: "Needs attention", value: query.data.attentionCases, icon: CircleAlert, note: "Recorded issues to investigate", href: "/admin/cases?view=attention" },
        { label: "Processing jobs", value: query.data.processingJobs, icon: Workflow, note: "Jobs currently in progress", href: "/admin/processing?active=true" },
        { label: "Registered accounts", value: query.data.registeredAccounts, icon: UsersRound, note: "Including accounts without cases", href: "/admin/customers" },
      ].map(metric => <Link className="admin-metric" data-attention={metric.label === "Needs attention" && metric.value > 0} key={metric.label} to={metric.href}><div className="admin-metric-heading"><metric.icon className="size-4" aria-hidden /><span>{metric.label}</span><ArrowUpRight className="size-4" aria-hidden /></div><strong>{metric.value.toLocaleString("en-US")}</strong><small>{metric.note}</small></Link>)}</div>
      <div className="admin-overview-grid"><AdminPanel title="Needs attention" description="The five most recently active cases with recorded issues." action={<Link className="admin-row-link" to="/admin/cases?view=attention">View all<ArrowUpRight className="size-4" aria-hidden /></Link>}>
        {query.data.attention.length ? <ul className="admin-attention-queue">{query.data.attention.map(item => <li key={item.id}><Link to={item.caseId ? adminCaseHref(item.caseId, "overview", "/admin/cases?view=attention") : "/admin/cases?view=attention"}>
          <div className="admin-queue-person"><AdminPersonMark name={item.title} /><div><strong>{item.title}</strong><p>{item.summary ?? item.subtitle ?? "Vehicle not yet provided"}</p></div><ArrowUpRight size={16} aria-hidden /></div>
          <div className="admin-queue-issue"><CircleAlert size={15} aria-hidden /><span>{item.attentionReasons.map(humanizeAdminCode).join(" · ") || humanizeAdminCode(item.status)}</span></div>
          <div className="admin-queue-footer"><span>Case #{formatCaseOperationReference(item.caseId ?? item.id)}</span><span>Review case →</span></div>
        </Link></li>)}</ul> : <AdminEmptyState title="No cases need attention" description="There are no recorded case issues to investigate." />}
      </AdminPanel><AdminPanel title="Recent case activity" description="The latest eight recorded workflow events." action={<Link className="admin-row-link" to="/admin/activity">View all<ArrowUpRight className="size-4" aria-hidden /></Link>}>
        {query.data.activity.length ? <ol className="admin-event-timeline">{query.data.activity.map(item => <li key={item.id}><span className="admin-timeline-dot" aria-hidden /><div><strong>{adminActivityTitle(item.title)}</strong><p>{item.subtitle ? <span>{item.subtitle} · </span> : null}{item.caseId ? <Link to={adminCaseHref(item.caseId, "activity")}>Case #{formatCaseOperationReference(item.caseId)}</Link> : null}</p><AdminRecordTime value={item.createdAt} /></div></li>)}</ol> : <AdminEmptyState title="No case activity yet" description="Workflow events will appear here as customers continue their cases." />}
      </AdminPanel></div><p className="admin-results-count">Updated {formatCaseOperationDateTime(query.data.asOf)}</p>
    </>}
  </section>;
}

const customerFilters: readonly AdminFilterDefinition[] = [
  { key: "identity", label: "Identity type", options: [{ value: "account", label: "Registered accounts" }, { value: "guest", label: "Guest sessions" }] },
  { key: "verified", label: "Email verification", options: [{ value: "", label: "Any verification" }, { value: "true", label: "Verified email" }, { value: "false", label: "Unverified email" }] },
  { key: "hasCases", label: "Customer cases", options: [{ value: "", label: "Any case count" }, { value: "true", label: "Has cases" }, { value: "false", label: "No cases" }] },
];

export function AdminCustomersPage() { return <AdminCollection resource="customers" title="Customers" description="Account profiles, verified contact information, and linked cases." searchPlaceholder="Search name, email, or customer ID" filters={customerFilters} defaultFilters={{ identity: "account" }} />; }

export function AdminCustomerPage() {
  const { customerId = "" } = useParams();
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(customerId) ? customerId.toLowerCase() : "";
  const query = useAdminCustomer(validId);
  const dependencies = useAdminCaseOperationsDependencies();
  if (!dependencies?.operationsService) return <section className="admin-page"><AdminEmptyState title="Operations unavailable" description="The staff operations service is not configured for this environment." /></section>;
  if (!validId) return <section className="admin-page"><AdminBackLink to="/admin/customers">Back to customers</AdminBackLink><AdminEmptyState title="Customer unavailable" description="This record could not be found or is not available to your staff account." /></section>;
  return <section className="admin-page"><AdminBackLink to="/admin/customers">Back to customers</AdminBackLink>{query.isPending ? <AdminLoadingState label="Loading customer…" /> : query.isError && !query.data ? <AdminErrorState onRetry={() => void query.refetch()} /> : !query.data ? <AdminEmptyState title="Customer unavailable" description="This record could not be found or is not available to your staff account." /> : <>
    {query.isError ? <AdminRefreshNotice /> : null}<AdminPageHeader title={query.data.title} description={query.data.subtitle ?? "Customer account details and associated cases."} eyebrow="Customer record" refreshing={query.isFetching} onRefresh={() => void query.refetch()} actions={<AdminBadge tone={adminStatusTone(query.data.status)}>{query.data.identity === "guest" ? "Guest session" : "Registered account"}</AdminBadge>} />
    <div className="admin-profile-summary"><AdminPersonMark name={query.data.title} /><div><span>Email verification</span><strong>{query.data.verified === true ? "Verified" : query.data.verified === false ? "Unverified" : "Not recorded"}</strong></div><div><span>Total-loss cases</span><strong>{query.data.caseCount ?? "Not recorded"}</strong></div><div><span>Last activity</span><AdminRecordTime value={query.data.updatedAt} /></div></div>
    <AdminPanel title="Account details" description="Profile information for this identity. Entered case contacts remain separate."><RecordFacts item={query.data} /></AdminPanel>
    <AdminCollection resource="cases" title="Customer cases" description="Total-loss cases associated with this identity." fixedFilters={{ customerId: validId }} embedded />
  </>}</section>;
}

export function AdminReportsPage() { return <AdminCollection resource="reports" title="Reports" description="Track source documents, generated versions, and what has been published." searchPlaceholder="Search report or case" filters={reportFilters} />; }
export function AdminProcessingPage() { return <AdminCollection resource="processing" title="Processing" description="Follow free valuations, paid reviews, and insurer-response jobs." searchPlaceholder="Search case or processing record" filters={processingFilters} />; }
export function AdminPaymentsPage() { return <AdminCollection resource="payments" title="Payments" description="Understand each order, its financial history, and the customer’s access." searchPlaceholder="Search customer, case, or order" filters={paymentFilters} />; }
export function AdminActivityPage() { return <AdminCollection resource="activity" title="Activity" description="See what happened in each case, when it happened, and who recorded it." searchPlaceholder="Search activity or case" filters={activityFilters} />; }
