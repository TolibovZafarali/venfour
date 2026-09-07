import { Activity, ArrowUpRight, BriefcaseBusiness, CircleAlert, UsersRound, Workflow } from "lucide-react";
import { Link, useParams } from "react-router";

import { formatCaseOperationDateTime, formatCaseOperationReference } from "@/features/admin/case-operations/format";
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
  return <section className="admin-page"><AdminPageHeader title="Overview" description="Your customer cases, current processing, and the records that need a closer look." refreshing={query.isFetching} onRefresh={() => void query.refetch()} />
    {query.isPending ? <AdminLoadingState label="Loading operations overview…" /> : query.isError && !query.data ? <AdminErrorState onRetry={() => void query.refetch()} /> : <>
      {query.isError ? <AdminRefreshNotice /> : null}
      <div className="admin-metric-grid">{[
        { label: "Active cases", value: query.data.activeCases, icon: BriefcaseBusiness, href: "/admin/cases?active=true" },
        { label: "Needs attention", value: query.data.attentionCases, icon: CircleAlert, href: "/admin/cases?view=attention" },
        { label: "Processing jobs", value: query.data.processingJobs, icon: Workflow, href: "/admin/processing?active=true" },
        { label: "Registered accounts", value: query.data.registeredAccounts, icon: UsersRound, href: "/admin/customers" },
      ].map(metric => <Link className="admin-metric" key={metric.label} to={metric.href}><div><metric.icon className="size-5" aria-hidden /><ArrowUpRight className="size-4" aria-hidden /></div><strong>{metric.value.toLocaleString("en-US")}</strong><span>{metric.label}</span></Link>)}</div>
      <div className="admin-overview-grid"><AdminPanel title="Needs attention" description="Recorded issues across the case journey." action={<Link className="admin-row-link" to="/admin/cases?view=attention">View all<ArrowUpRight className="size-4" aria-hidden /></Link>}>
        {query.data.attention.length ? <ul className="admin-summary-list">{query.data.attention.map(item => <li key={item.id}><Link to={item.caseId ? adminCaseHref(item.caseId, "overview", "/admin/cases?view=attention") : "/admin/cases?view=attention"}><div><strong>{item.title}</strong>{item.subtitle ? <p>{item.subtitle}</p> : null}<span>{item.attentionReasons.map(humanizeAdminCode).join(" · ") || humanizeAdminCode(item.status)}</span></div><ArrowUpRight className="size-4 shrink-0" aria-hidden /></Link></li>)}</ul> : <AdminEmptyState title="No cases need attention" description="There are no recorded case issues to investigate." />}
      </AdminPanel><AdminPanel title="Recent case activity" description="Recorded events after a customer continues their review." action={<Link className="admin-row-link" to="/admin/activity">View all<ArrowUpRight className="size-4" aria-hidden /></Link>}>
        {query.data.activity.length ? <ol className="admin-activity-list">{query.data.activity.map(item => <li key={item.id}><Activity className="size-4" aria-hidden /><div><strong>{adminActivityTitle(item.title)}</strong>{item.caseId ? <Link to={adminCaseHref(item.caseId, "activity")}>Case #{formatCaseOperationReference(item.caseId)}</Link> : null}<p>{formatCaseOperationDateTime(item.createdAt)}</p></div></li>)}</ol> : <AdminEmptyState title="No case activity yet" description="Workflow events will appear here as customers continue their cases." />}
      </AdminPanel></div><p className="admin-results-count">Updated {formatCaseOperationDateTime(query.data.asOf)}</p>
    </>}
  </section>;
}

const customerFilters: readonly AdminFilterDefinition[] = [
  { key: "identity", label: "Identity type", options: [{ value: "account", label: "Registered accounts" }, { value: "guest", label: "Guest sessions" }] },
  { key: "verified", label: "Email verification", options: [{ value: "", label: "Any verification" }, { value: "true", label: "Verified email" }, { value: "false", label: "Unverified email" }] },
  { key: "hasCases", label: "Customer cases", options: [{ value: "", label: "Any case count" }, { value: "true", label: "Has cases" }, { value: "false", label: "No cases" }] },
];

export function AdminCustomersPage() { return <AdminCollection resource="customers" title="Customers" description="Registered accounts, including customers who have not started a case. Guest sessions are available in the identity filter." searchPlaceholder="Search name, email, or customer ID" filters={customerFilters} defaultFilters={{ identity: "account" }} />; }

export function AdminCustomerPage() {
  const { customerId = "" } = useParams();
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(customerId) ? customerId.toLowerCase() : "";
  const query = useAdminCustomer(validId);
  const dependencies = useAdminCaseOperationsDependencies();
  if (!dependencies?.operationsService) return <section className="admin-page"><AdminEmptyState title="Operations unavailable" description="The staff operations service is not configured for this environment." /></section>;
  if (!validId) return <section className="admin-page"><AdminBackLink to="/admin/customers">Back to customers</AdminBackLink><AdminEmptyState title="Customer unavailable" description="This record could not be found or is not available to your staff account." /></section>;
  return <section className="admin-page"><AdminBackLink to="/admin/customers">Back to customers</AdminBackLink>{query.isPending ? <AdminLoadingState label="Loading customer…" /> : query.isError && !query.data ? <AdminErrorState onRetry={() => void query.refetch()} /> : !query.data ? <AdminEmptyState title="Customer unavailable" description="This record could not be found or is not available to your staff account." /> : <>
    {query.isError ? <AdminRefreshNotice /> : null}<AdminPageHeader title={query.data.title} description={query.data.subtitle ?? "Customer account details and associated cases."} eyebrow="Customer record" refreshing={query.isFetching} onRefresh={() => void query.refetch()} actions={<AdminBadge tone={adminStatusTone(query.data.status)}>{query.data.identity === "guest" ? "Guest session" : "Registered account"}</AdminBadge>} />
    <AdminPanel title="Account details"><RecordFacts item={query.data} /></AdminPanel>
    <AdminCollection resource="cases" title="Customer cases" description="Total-loss cases associated with this identity." fixedFilters={{ customerId: validId }} embedded />
  </>}</section>;
}

export function AdminReportsPage() { return <AdminCollection resource="reports" title="Reports" description="Uploaded insurer reports and generated customer reports. Inspect status, versions, and metadata." searchPlaceholder="Search report or case" filters={reportFilters} />; }
export function AdminProcessingPage() { return <AdminCollection resource="processing" title="Processing" description="Free valuations, paid reviews, and insurer-response analysis. Status and retry information reflect recorded processing facts." searchPlaceholder="Search case or processing record" filters={processingFilters} />; }
export function AdminPaymentsPage() { return <AdminCollection resource="payments" title="Payments" description="Recorded orders, checkout attempts, refunds, and access status. Inspect individual records for their currency and test or live mode." searchPlaceholder="Search customer, case, or order" filters={paymentFilters} />; }
export function AdminActivityPage() { return <AdminCollection resource="activity" title="Activity" description="Recorded case workflow events after the customer continues their review. Payment history is available under Payments." searchPlaceholder="Search activity or case" filters={activityFilters} />; }
