import { act, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';
import { describe, expect, test, vi } from 'vitest';
import type { AuthService } from '@/features/auth';
import { server } from '@/test/mocks/server';
import { renderTestApp } from '@/test/render';
import { referralQueryRoot } from './hooks';
import { parsePartnerEarnings, type PartnerEarningsData } from './service';

const USER = '11111111-1111-4111-8111-111111111111', PARTNER = '22222222-2222-4222-8222-222222222222', REF = '33333333-3333-4333-8333-333333333333';
const at = '2026-09-16T12:00:00Z';
const session = { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, user: { id: USER, email: 'partner@example.test', email_confirmed_at: at, created_at: at, aud: 'authenticated', app_metadata: {}, user_metadata: {} } } as Session;
const authService: AuthService = { getSession: async () => session, onAuthStateChange: () => () => {}, signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), sendMagicLink: vi.fn(), sendEmailCode: vi.fn(), verifyEmailCode: async () => session, exchangeCodeForSession: async () => session, verifyEmailOtp: async () => session, signOut: vi.fn() };
function fixture(): PartnerEarningsData {
  return { availability: 'enabled', currency: 'USD', period: '2026-09', as_of: at, summary: { earned_month_minor: 15000, awaiting_payout_minor: 10000, held_minor: 5000, paid_minor: 5000, verified_month_count: 3 }, items: [{ reference: REF, amount_minor: 5000, verified_at: at, eligible_at: at, status: 'held', paid_at: null }], total: 1, page: 1, page_size: 25 };
}
function harness() {
  let value = fixture(), failed = false, allowed = true;
  server.use(http.get('*/api/v1/partners/access', () => HttpResponse.json({ is_partner: allowed, is_partner_manager: false, email_configured: true })),
    http.post('*/api/v1/partners/operations', async ({ request }) => {
      const { action } = await request.json() as { action: string };
      if (!allowed) return HttpResponse.json({}, { status: 403 });
      if (action === 'earnings') return failed ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(value);
      if (action === 'referral_summary') return HttpResponse.json({ link: null, summary: { submitted_count: 1, purchased_count: 1, refunded_count: 0, under_review_count: 0 } });
      if (action === 'referral_list') return HttpResponse.json({ items: [{ id: REF, submitted_at: at, purchased_at: at, status: 'purchased' }], total: 1, page: 1, page_size: 25 });
      return HttpResponse.json({ partner: { id: PARTNER, user_id: USER, revision: 1, business_name: 'Example Business', contact_email: 'partner@example.test', commission_amount_minor_units: 5000, currency: 'USD', status: 'active', created_at: at, updated_at: at }, agreements: [], invitations: [], events: [] });
    }));
  return { set: (next: PartnerEarningsData) => { value = next; }, fail: (next: boolean) => { failed = next; }, revoke: () => { allowed = false; } };
}

describe('partner earnings', () => {
  test('shows server balances and each referral commission without deriving earnings from purchases', async () => {
    harness(); renderTestApp([`/partners/${PARTNER}`], { authService });
    const earnings = within(await screen.findByRole('region', { name: 'Your earnings' }));
    expect(await earnings.findByText('$150.00')).toBeVisible();
    expect(earnings.getByText('$100.00')).toBeVisible();
    expect(earnings.getByText('$50.00')).toBeVisible();
    expect(earnings.getByText(/\$50.00 of your unpaid commissions is on hold/)).toBeVisible();
    expect(await screen.findByRole('cell', { name: /\$50\.00\s*On hold/ })).toBeVisible();
  });
  test('refreshes a saved increase and removes old balances on access revocation', async () => {
    const api = harness(), app = renderTestApp([`/partners/${PARTNER}`], { authService });
    await screen.findByText('$150.00');
    const updated = fixture(); updated.summary!.earned_month_minor = 20000; updated.summary!.awaiting_payout_minor = 15000;
    api.set(updated);
    await act(() => app.queryClient.invalidateQueries({ queryKey: referralQueryRoot }));
    expect(await screen.findByText('$200.00')).toBeVisible();
    api.revoke(); await act(() => app.queryClient.invalidateQueries({ queryKey: referralQueryRoot }));
    await waitFor(() => expect(screen.queryByText('$200.00')).not.toBeInTheDocument());
  });
  test('failed reads show an error rather than zero earnings and can retry', async () => {
    const user = userEvent.setup(), api = harness(); api.fail(true);
    renderTestApp([`/partners/${PARTNER}`], { authService });
    const retry = await screen.findByRole('button', { name: 'Try loading earnings again' });
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    api.fail(false); await user.click(retry);
    expect(await screen.findByText('$150.00')).toBeVisible();
  });
  test('disabled programs do not show a fictional zero balance', async () => {
    const api = harness(); api.set({ ...fixture(), availability: 'not_enabled', summary: null, items: [] });
    renderTestApp([`/partners/${PARTNER}`], { authService });
    expect(await screen.findByText(/Earnings tracking is not enabled/)).toBeVisible();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
  test('rejects private data, malformed amounts, duplicates, and paid states without a payment record', () => {
    for (const changes of [{ customer_name: 'private' }, { amount_minor: '5000' }, { status: 'paid' }, { status: 'unverified' }]) {
      const value = fixture(); Object.assign(value.items[0], changes);
      expect(() => parsePartnerEarnings(value)).toThrow();
    }
    const duplicate = fixture(); duplicate.items.push(duplicate.items[0]); duplicate.total = 2;
    expect(() => parsePartnerEarnings(duplicate)).toThrow();
  });
});
