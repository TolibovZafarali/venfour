import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader } from "@/features/admin/operations/page-ui";
import { formatCaseOperationDateTime, formatCaseOperationReference } from "@/features/admin/case-operations/format";
import { isPermanentAuthState, useAuth } from "@/features/auth";

import { communicationsService } from "./service";

function label(value: string | null) {
  if (!value) return "Not recorded";
  const readable = value.replaceAll("_", " ").replaceAll(".", " ");
  return readable[0].toUpperCase() + readable.slice(1);
}

export function AdminEmailHistoryPage() {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ["staff-email-history", isPermanentAuthState(auth) ? auth.user.id : null],
    enabled: isPermanentAuthState(auth),
    queryFn: ({ signal }) => communicationsService.history((auth as Extract<typeof auth, { status: "signedIn" }>).session.access_token, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (!isPermanentAuthState(auth)) return <section className="admin-page"><AdminEmptyState title="Email history unavailable" description="Sign in to your staff account." /></section>;
  return <section className="admin-page">
    <AdminPageHeader title="Email history" description="Recorded outgoing-email deliveries. Message bodies and template designs are not shown here." refreshing={query.isFetching} onRefresh={() => void query.refetch()} />
    <p className="admin-secondary-text">Sign-in emails sent directly by the authentication provider may not appear here.</p>
    {query.isPending ? <AdminLoadingState label="Loading email history…" /> : query.isError || !query.data ? <AdminErrorState description="Email history could not be loaded. Try again." onRetry={() => void query.refetch()} /> : query.data.items.length === 0 ? <AdminEmptyState title="No recorded outgoing email" description="No delivery records are available from the connected email sources." /> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Email</th><th>Recipient</th><th>Delivery</th><th>Provider accepted</th><th>Case</th></tr></thead><tbody>{query.data.items.map(item => <tr key={item.id}><td><p className="admin-primary-text">{item.subject ?? label(item.templateKey)}</p><p className="admin-secondary-text">{label(item.source)}</p></td><td>{item.recipient ?? <span className="admin-secondary-text">Not retained for this delivery</span>}</td><td><p className="admin-primary-text">{label(item.deliveryStatus ?? item.status)}</p><p className="admin-secondary-text">{item.attempts === null ? "Attempts not recorded" : `${item.attempts} ${item.attempts === 1 ? "attempt" : "attempts"}`}</p></td><td>{item.acceptedAt ? formatCaseOperationDateTime(item.acceptedAt) : "Not recorded"}</td><td>{item.caseId ? <Link className="admin-case-reference" to={`/admin/cases/${encodeURIComponent(item.caseId)}?tab=reports`}>#{formatCaseOperationReference(item.caseId)}</Link> : <span className="admin-secondary-text">Not linked</span>}</td></tr>)}</tbody></table></div>}
  </section>;
}
