import { useState } from "react";

import { Button } from "@/components/ui/button";

import { PartnerError } from "./components";
import { useReferralAccess, useReferralMutation, useReferralQuery } from "./hooks";
import { formatPartnerDate } from "./presentation";
import { parsePartnerReferralList, parsePartnerReferralSummary, type PartnerAudience, type PartnerReferral } from "./service";

const referralStatus: Record<PartnerReferral["status"], string> = {
  submitted: "Review submitted", purchased: "Purchased", refunded: "Refunded", under_review: "Payment under review",
};

export function ReferralTracking({ partnerId, audience }: { partnerId: string; audience: PartnerAudience }) {
  const access = useReferralAccess(audience);
  const [page, setPage] = useState(1);
  const [copyResult, setCopyResult] = useState<{ url: string; copied: boolean } | null>(null);
  const summary = useReferralQuery(audience, "referral_summary", { partner_id: partnerId }, parsePartnerReferralSummary, access.allowed);
  const referrals = useReferralQuery(audience, "referral_list", { partner_id: partnerId, page, page_size: 25 }, parsePartnerReferralList, access.allowed);
  const mutation = useReferralMutation(audience);
  const link = summary.data?.link;
  const url = link ? new URL(`/r/${link.code}`, window.location.origin).toString() : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopyResult({ url, copied: true }); }
    catch { setCopyResult({ url, copied: false }); }
  };
  const toggle = async () => {
    if (!link) return;
    setCopyResult(null);
    await mutation.run("link_state", { partner_id: partnerId, expected_revision: link.revision, enabled: link.status === "paused" });
  };
  if (access.isPending) return <section className="partner-card"><h2>Referrals</h2><p>Checking referral access…</p></section>;
  if (!access.allowed) return <section className="partner-card"><h2>Referrals are unavailable</h2><p>Your access to referral information could not be verified.</p><PartnerError error={access.error} /></section>;
  return <div className="partner-referrals">
    <section className="partner-card" aria-label="Referral link">
      <h2>Referral link</h2>
      {summary.isPending ? <p>Loading referral link…</p> : summary.isError ? <><PartnerError error={summary.error} /><Button variant="outline" onClick={() => void summary.refetch()}>Try loading the link again</Button></> : link ? <>
        <p>Share this link with customers who could benefit from a total-loss valuation review.</p>
        <div className="partner-referral-link-row">
          <label className="partner-field"><span>Your referral link</span><input value={url} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
          <Button variant="outline" disabled={link.status === "paused"} onClick={() => void copy()}>Copy referral link</Button>
        </div>
        {copyResult?.url === url && <p role="status">{copyResult.copied ? "Referral link copied." : "Copying is unavailable. Select the link above and copy it."}</p>}
        <p className="partner-referral-link-status">{link.status === "paused" ? "Paused — this link does not attribute new reviews. Previously attributed reviews remain recorded." : "Active — customers can use this link to start a new review."}</p>
        {audience === "staff" && <Button variant="outline" disabled={mutation.pending} onClick={() => void toggle()}>{mutation.pending ? "Updating link…" : link.status === "paused" ? "Resume referral link" : "Pause referral link"}</Button>}
        <PartnerError error={mutation.error} />
      </> : <p>A referral link becomes available when the partnership is active.</p>}
    </section>
    <section className="partner-card" aria-label="Referral activity">
      <h2>Referral activity</h2>
      <p>Reviews appear after the customer submits their intake. Each reference identifies one referred review.</p>
      {summary.data && !summary.isError && <>
        <dl className="partner-referral-counts">
          <div><dt>Reviews submitted</dt><dd>{summary.data.summary.submitted_count}</dd></div>
          <div><dt>Purchases</dt><dd>{summary.data.summary.purchased_count}</dd></div>
          <div><dt>Refunded</dt><dd>{summary.data.summary.refunded_count}</dd></div>
          <div><dt>Payment under review</dt><dd>{summary.data.summary.under_review_count}</dd></div>
        </dl>
        <p>Purchase totals include purchases later refunded or placed under review. Commission eligibility follows your partner agreement.</p>
      </>}
      {referrals.isPending ? <p>Loading referrals…</p> : referrals.isError ? <><PartnerError error={referrals.error} /><Button variant="outline" onClick={() => void referrals.refetch()}>Try loading referrals again</Button></> : <>
        {referrals.data.items.length ? <div className="partner-table-wrap"><table className="partner-table partner-referral-table"><caption className="sr-only">Submitted referrals and purchase status</caption><thead><tr><th scope="col">Reference</th><th scope="col">Submitted</th><th scope="col">Purchased</th><th scope="col">Status</th></tr></thead><tbody>{referrals.data.items.map((referral) => <tr key={referral.id}>
          <td className="partner-referral-reference">{referral.id}</td><td>{formatPartnerDate(referral.submitted_at)}</td><td>{formatPartnerDate(referral.purchased_at)}</td><td><span className={`partner-referral-status partner-referral-status-${referral.status}`}>{referralStatus[referral.status]}</span></td>
        </tr>)}</tbody></table></div> : <p>No submitted referrals yet.</p>}
        <div className="partner-actions mt-5" aria-label="Referral pages"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous referrals</Button><span aria-live="polite">Page {page}</span><Button variant="outline" disabled={page * 25 >= referrals.data.total} onClick={() => setPage(page + 1)}>Next referrals</Button></div>
      </>}
    </section>
  </div>;
}
