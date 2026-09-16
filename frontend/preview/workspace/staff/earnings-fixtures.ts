import { parsePartnerEarnings, type PartnerCommission, type PartnerReferral } from '@/features/referral-partners/service';

export function earningsMonth(at: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).formatToParts(new Date(at));
  return `${parts.find(item => item.type === 'year')!.value}-${parts.find(item => item.type === 'month')!.value}`;
}

export function seedEarnings(rows: PartnerReferral[], now: string): PartnerCommission[] {
  let purchases = 0;
  return rows.filter(row => row.purchased_at).map(row => {
    const eligible = new Date(Math.max(Date.parse(now), Date.parse(row.purchased_at!) + 30 * 86400_000)).toISOString();
    const status = row.status === 'refunded' ? 'reversed' : row.status === 'under_review' ? 'held' : eligible > now ? 'waiting' : purchases++ === 0 ? 'paid' : 'ready';
    return { reference: row.id, amount_minor: 5000, verified_at: now, eligible_at: eligible, status, paid_at: status === 'paid' ? now : null };
  });
}

export function earningsFixture(rows: PartnerReferral[], awards: PartnerCommission[], now: string, page: number, pageSize: number) {
  const period = earningsMonth(now);
  const monthAwards = awards.filter(item => earningsMonth(item.verified_at!) === period);
  const unpaid = awards.filter(item => item.paid_at === null && item.status !== 'reversed');
  const sum = (items: PartnerCommission[]) => items.reduce((total, item) => total + item.amount_minor!, 0);
  return parsePartnerEarnings({ availability: 'enabled', currency: 'USD', period, as_of: now,
    summary: { earned_month_minor: sum(monthAwards.filter(item => item.status !== 'reversed')), awaiting_payout_minor: sum(unpaid), held_minor: sum(unpaid.filter(item => item.status === 'held')), paid_minor: sum(awards.filter(item => item.paid_at)), verified_month_count: monthAwards.length },
    items: [...rows].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || a.id.localeCompare(b.id)).slice((page - 1) * pageSize, page * pageSize).map(row => awards.find(item => item.reference === row.id) ?? { reference: row.id, amount_minor: null, verified_at: null, eligible_at: null, paid_at: null, status: 'unverified' }),
    total: rows.length, page, page_size: pageSize,
  });
}
