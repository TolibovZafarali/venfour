import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import { useAdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies";
import { AdminDetailField, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminPanel } from "@/features/admin/operations/page-ui";
import type { PaymentApprovalCase, PaymentApprovalDecision } from "./service";

const labels: Record<string, string> = { awaiting_approval: "Awaiting approval", held: "On hold", declined: "Declined",
  POTENTIAL_UNDERVALUE: "Potential undervalue", MATERIAL_UNDERVALUE_SIGNAL: "Material undervalue signal",
  MODERATE: "Moderate", STRONG: "Strong", CLEAR_MARKET_VALUE_GAP: "Clear market value gap",
  POSSIBLE_MARKET_VALUE_GAP: "Possible market value gap", LISTING_CONTEXT: "Listing context", INSUFFICIENT_EVIDENCE: "Insufficient evidence" };

export function AdminPaymentApprovalsPage() {
  const { auth } = useAuth();
  const service = useAdminCaseOperationsDependencies()?.paymentApprovalService;
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const query = useQuery({ queryKey: ["staff-payment-approvals", userId], queryFn: () => service!.list(),
    enabled: !!service && !!userId, retry: false, staleTime: 0 });
  const busy = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function decide(item: PaymentApprovalCase, decision: PaymentApprovalDecision) {
    if (!service || busy.current || query.isError || query.isFetching) return;
    busy.current = true; setPending(item.caseId); setMessage(null); setFailed(false);
    try {
      await service.decide(item, decision, crypto.randomUUID());
      setMessage(decision === "approved" ? "Payment approved for this exact review. The customer can continue to secure checkout." : "Your decision is saved. Payment remains unavailable.");
    } catch {
      setFailed(true); setMessage("The decision could not be confirmed. Refresh and review the current case before trying again.");
    } finally { await query.refetch(); busy.current = false; setPending(null); }
  }
  return <section className="admin-page">
    <AdminPageHeader title="Awaiting payment approval" description="Review qualifying cases before the $199 checkout becomes available." refreshing={query.isFetching} onRefresh={() => void query.refetch()} />
    {message ? <p role={failed ? "alert" : "status"} className="admin-notice">{message}</p> : null}
    {!service || !userId ? <AdminEmptyState title="Payment review unavailable" description="A signed-in staff account is required." />
      : query.isPending ? <AdminLoadingState label="Loading payment approvals…" />
        : query.isError ? <AdminErrorState onRetry={() => void query.refetch()} />
          : query.data?.length === 0 ? <AdminEmptyState title="No cases awaiting review" description="Cases appear here only after the strict evidence and report checks pass." />
            : query.data?.map(item => <AdminPanel key={item.caseId} title={item.vehicle} description={labels[item.status]} action={<Link className="admin-row-link" to={`/admin/cases/${item.caseId}`}>Open case</Link>}>
              <div className="p-5">
                <dl className="grid gap-5 sm:grid-cols-2">
                  <AdminDetailField label="Customer" value={item.customerName ?? item.customerId} />
                  <AdminDetailField label="Contact" value={item.customerEmail} />
                  <AdminDetailField label="Insurer valuation" value={item.insurerValuation === null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.insurerValuation)} />
                  <AdminDetailField label="Preliminary outcome" value={labels[item.preliminaryOutcome ?? ""] ?? item.preliminaryOutcome} />
                  <AdminDetailField label="Strict classification" value={labels[item.classification]} />
                  <AdminDetailField label="Evidence strength" value={labels[item.evidenceStrength]} />
                  <AdminDetailField label="Strict eligible comparables" value={`${item.eligibleComparables.historical} historical · ${item.eligibleComparables.current} current`} />
                  <AdminDetailField label="Insurer report" value="Ready; material facts resolved" />
                </dl>
                <h3 className="mt-6 font-medium">Important limitations</h3>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-copy">{item.limitations.map((limitation, index) => <li key={index}><strong>{limitation.label}.</strong> {limitation.description}</li>)}</ul>
                <details className="mt-6 text-sm"><summary className="cursor-pointer font-medium">Exact case and review lineage</summary><dl className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries(item.lineage).map(([key, value]) => <AdminDetailField key={key} label={key.replace(/([A-Z])/gu, " $1")} value={String(value)} mono />)}</dl></details>
                <p className="mt-6 text-sm leading-6 text-copy">Approve only after reviewing the report, qualifying comparisons, and limitations. Any change to this review requires a new approval.</p>
                {!item.canApprove ? <p className="mt-3 text-sm" role="status">You cannot approve payment for your own case.</p> : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button disabled={!item.canApprove || pending !== null || query.isFetching} onClick={() => void decide(item, "approved")}>Approve payment</Button>
                  <Button variant="outline" disabled={!item.canApprove || pending !== null || query.isFetching} onClick={() => void decide(item, "held")}>Keep on hold</Button>
                  <Button variant="outline" disabled={!item.canApprove || pending !== null || query.isFetching} onClick={() => void decide(item, "declined")}>Decline</Button>
                </div>
              </div>
            </AdminPanel>)}
  </section>;
}
