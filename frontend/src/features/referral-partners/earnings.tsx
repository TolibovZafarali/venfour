import { Button } from '@/components/ui/button';
import { PartnerError } from './components';
import { useReferralAccess, usePartnerEarnings } from './hooks';
import { formatPartnerMoney } from './presentation';

export function PartnerEarnings({ partnerId }: { partnerId: string }) {
  const access = useReferralAccess('partner');
  const earnings = usePartnerEarnings(partnerId, 'partner', 1, access.allowed);
  const data = earnings.data;
  const summary = data?.summary;
  return <section className="partner-earnings" aria-labelledby="partner-earnings-title">
    <div className="partner-earnings-heading"><h2 id="partner-earnings-title">Your earnings</h2>
      {data && !earnings.isError && <span>{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.period}-01T12:00:00Z`))}</span>}
    </div>
    {access.isPending ? <p>Checking earnings access…</p> : !access.allowed ? <p>Your access to earnings could not be verified.</p>
      : earnings.isPending ? <p>Loading earnings…</p>
      : earnings.isError ? <><p>Earnings are temporarily unavailable. Your saved records are unchanged.</p><PartnerError error={earnings.error} /><Button variant="outline" onClick={() => void earnings.refetch()}>Try loading earnings again</Button></>
      : data?.availability === 'not_enabled' ? <p>Earnings tracking is not enabled for this agreement. Your referrals remain available below.</p>
      : summary && <>
        <dl className="partner-earnings-totals" aria-live="polite" aria-atomic="true">
          <div><dt>Earned this month</dt><dd>{formatPartnerMoney(summary.earned_month_minor)}</dd><span>Verified commissions, after reversals</span></div>
          <div><dt>Awaiting payout</dt><dd>{formatPartnerMoney(summary.awaiting_payout_minor)}</dd><span>All unpaid commissions, including holds</span></div>
          <div><dt>Paid to date</dt><dd>{formatPartnerMoney(summary.paid_minor)}</dd><span>Recorded payments to your business</span></div>
        </dl>
        <p className="partner-earnings-explanation">Earnings increase after Venfour verifies a qualifying successful case. A purchase alone does not earn a commission.</p>
        {summary.held_minor > 0 && <p className="partner-earnings-hold">{formatPartnerMoney(summary.held_minor)} of your unpaid commissions is on hold for review.</p>}
        <details className="partner-dashboard-disclosure"><summary>How earnings are counted</summary><p>Successful cases 1–9 verified each month earn $50 each. Case 10 onward earns $75 each; earlier cases keep their original rate. Months follow America/Chicago time.</p><p>The waiting period ends after both verification and 30 days from customer payment. Holds and refunds can affect payment eligibility. See your agreement for the complete terms.</p><p>Paid to date preserves completed payment records, including any later payment correction under review.</p></details>
      </>}
  </section>;
}
