import { referralHref } from "./urls";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { PartnerError } from "./components";
import { useReferralAccess, useReferralMutation, useReferralQuery, usePartnerEarnings } from "./hooks";
import { formatPartnerDate, formatPartnerMoney, commissionStatusLabel } from "./presentation";
import { parsePartnerReferralList, parsePartnerReferralSummary, type PartnerAudience, type PartnerReferral } from "./service";

const referralStatus: Record<PartnerReferral["status"], string> = {
  submitted: "Review submitted", purchased: "Purchased", refunded: "Refunded", under_review: "Payment under review",
};

export function ReferralTracking({ partnerId, audience, presentation = "card" }: { partnerId: string; audience: PartnerAudience; presentation?: "card" | "dashboard" }) {
  const dashboard = presentation === "dashboard";
  const access = useReferralAccess(audience);
  const [page, setPage] = useState(1);
  const [copyResult, setCopyResult] = useState<{ url: string; copied: boolean } | null>(null);
  const [qrError, setQrError] = useState(false);
  const [qrPending, setQrPending] = useState(false);
  const summary = useReferralQuery(audience, "referral_summary", { partner_id: partnerId }, parsePartnerReferralSummary, access.allowed);
  const referrals = useReferralQuery(audience, "referral_list", { partner_id: partnerId, page, page_size: 25 }, parsePartnerReferralList, access.allowed);
  const earnings = usePartnerEarnings(partnerId, audience, page, access.allowed && dashboard);
  const mutation = useReferralMutation(audience);
  const link = summary.data?.link;
  const url = link ? referralHref(link.slug ?? link.code) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopyResult({ url, copied: true }); }
    catch { setCopyResult({ url, copied: false }); }
  };
  const downloadQr = async () => {
    if (!link || link.status === "paused") return;
    setQrPending(true);
    setQrError(false);
    try {
      const { default: QRCode } = await import("qrcode");
      const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 4, width: 512 });
      const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "venfour-referral-qr.svg";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { setQrError(true); }
    finally { setQrPending(false); }
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
          <Button variant={dashboard ? "default" : "outline"} disabled={link.status === "paused"} onClick={() => void copy()}>Copy referral link</Button>
          <Button variant="outline" disabled={link.status === "paused" || qrPending} onClick={() => void downloadQr()}>{qrPending ? "Preparing QR code…" : "Download QR code"}</Button>
        </div>
        {copyResult?.url === url && <p role="status">{copyResult.copied ? "Referral link copied." : "Copying is unavailable. Select the link above and copy it."}</p>}
        {qrError && <p role="alert">The QR code could not be downloaded. Try again or copy your referral link.</p>}
        <p className="partner-referral-link-status">{link.status === "paused" ? "Paused — this link does not attribute new reviews. Previously attributed reviews remain recorded." : "Active — customers can use this link to start a new review."}</p>
        {audience === "staff" && <Button variant="outline" disabled={mutation.pending} onClick={() => void toggle()}>{mutation.pending ? "Updating link…" : link.status === "paused" ? "Resume referral link" : "Pause referral link"}</Button>}
        <PartnerError error={mutation.error} />
      </> : <p>{dashboard ? "Your referral link is not available yet. Reload this page or contact your Venfour representative." : "A referral link becomes available when the partnership is active."}</p>}
    </section>
    <section className="partner-card" aria-label="Referral activity">
      <h2>Referral activity</h2>
      <p>Reviews appear after the customer submits their intake. Each reference identifies one referred review.</p>
      {summary.data && !summary.isError && (!dashboard || summary.data.summary.submitted_count > 0) && <>
        <dl className="partner-referral-counts">
          <div><dt>Reviews submitted</dt><dd>{summary.data.summary.submitted_count}</dd></div>
          <div><dt>Purchases</dt><dd>{summary.data.summary.purchased_count}</dd></div>
          <div><dt>Refunded</dt><dd>{summary.data.summary.refunded_count}</dd></div>
          <div><dt>Payment under review</dt><dd>{summary.data.summary.under_review_count}</dd></div>
        </dl>
        <p>Purchase totals include purchases later refunded or placed under review. Commission eligibility follows your partner agreement.</p>
      </>}
      {referrals.isPending ? <p>Loading referrals…</p> : referrals.isError ? <><PartnerError error={referrals.error} /><Button variant="outline" onClick={() => void referrals.refetch()}>Try loading referrals again</Button></> : <>
        {referrals.data.items.length ? <div className="partner-table-wrap" tabIndex={dashboard ? 0 : undefined} role={dashboard ? "region" : undefined} aria-label={dashboard ? "Submitted referral records" : undefined}><table className="partner-table partner-referral-table"><caption className="sr-only">Submitted referrals and purchase status</caption><thead><tr><th scope="col">Reference</th><th scope="col">Submitted</th><th scope="col">Purchased</th><th scope="col">Status</th>{dashboard && <th scope="col">Commission</th>}</tr></thead><tbody>{referrals.data.items.map((referral) => <tr key={referral.id}>
          <td className="partner-referral-reference">{referral.id}</td><td>{formatPartnerDate(referral.submitted_at)}</td><td>{formatPartnerDate(referral.purchased_at)}</td><td><span className={`partner-referral-status partner-referral-status-${referral.status}`}>{referralStatus[referral.status]}</span></td>{dashboard && <td className="partner-referral-commission">{(() => {
            const commission = !earnings.isError && earnings.data?.items.find(item => item.reference === referral.id);
            if (!commission) return <span>{earnings.isPending ? "Loading…" : "Unavailable"}</span>;
            return <><strong>{commission.amount_minor === null ? "—" : formatPartnerMoney(commission.amount_minor)}</strong><span>{commissionStatusLabel[commission.status]}</span>{commission.status === "waiting" && commission.eligible_at && <small>Waiting until {formatPartnerDate(commission.eligible_at)}</small>}{commission.paid_at && <small>Paid {formatPartnerDate(commission.paid_at)}</small>}</>;
          })()}</td>}
        </tr>)}</tbody></table></div> : dashboard ? <div className="partner-dashboard-empty"><h3>{referrals.data.total === 0 ? "Your first referral will appear here." : "No referrals on this page."}</h3><p>{referrals.data.total === 0 ? "Share your link with a customer. Their review will appear here after they submit their intake." : "Go back to see your submitted referrals."}</p></div> : <p>No submitted referrals yet.</p>}
        {(!dashboard || referrals.data.total > 25 || page > 1) && <div className="partner-actions mt-5" aria-label="Referral pages"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous referrals</Button><span aria-live="polite">Page {page}</span><Button variant="outline" disabled={page * 25 >= referrals.data.total} onClick={() => setPage(page + 1)}>Next referrals</Button></div>}
      </>}
    </section>
  </div>;
}
