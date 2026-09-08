import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { storeAuthReturnLocation } from '@/features/auth/return-location';
import { Button } from '@/components/ui/button';
import { PartnerError } from '@/features/referral-partners/components';
import { referralDraftPrefix, referralQueryRoot, useReferralQuery } from '@/features/referral-partners/hooks';
import { parsePartnerDetail, parsePartnerList } from '@/features/referral-partners/service';
import { resetSyntheticReferralPartners } from './referral-fixtures';
import { businessExamples, type createBusinessPreview } from './business-fixtures';

type BusinessPreviewRuntime = ReturnType<typeof createBusinessPreview>;

export function BusinessPreview({ preview }: { preview: BusinessPreviewRuntime }) {
  const [signedIn, setSignedIn] = useState(preview.initiallySignedIn);
  const client = useQueryClient();
  const location = useLocation();
  const signIn = async (email: string, code?: string) => {
    if (email.trim().toLowerCase() !== preview.business.email) throw new Error(`Use the fictional email ${preview.business.email}.`);
    if (code !== undefined) {
      if (code !== '123456') throw new Error('Use the synthetic sign-in code 123456.');
      preview.setSignedIn(true); setSignedIn(true);
    }
  };
  const unavailable = async (): Promise<never> => { throw new Error('Use the simulated email sign-in in this preview.'); };
  const auth: AuthContextValue = {
    auth: signedIn ? { status: 'signedIn', identity: 'permanent', session: preview.session, user: preview.session.user } : { status: 'signedOut', session: null, user: null },
    ensureGuestSession: unavailable, restoreSession: unavailable,
    runTurnstileChallenge: async (_action, run) => run('synthetic-token'),
    signInWithGoogle: unavailable, signInWithApple: unavailable, sendMagicLink: unavailable,
    sendEmailCode: async (email, options) => { await signIn(email); storeAuthReturnLocation(options?.returnTo); },
    completeEmailCode: async (email, code) => { await signIn(email, code); return preview.session; },
    completeAuthCallback: unavailable, completeEmailAuthCallback: unavailable,
    signOut: async () => { preview.setSignedIn(false); setSignedIn(false); client.clear(); },
  };
  const restart = () => {
    resetSyntheticReferralPartners('populated', preview.storage);
    try {
      const users = Object.values(businessExamples).map(item => item.userId);
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key && users.some(id => key.startsWith(`${referralDraftPrefix}${id}.`))) sessionStorage.removeItem(key);
      }
      for (const id of users) preview.storage.removeItem(`signed-in.${id}`);
    } catch { /* The preview can restart without draft storage. */ }
    window.location.href = '/_local/businesses?example=journey';
  };
  return <AuthContext.Provider value={auth}>
    <div className="business-preview-bar">
      <strong>Synthetic business preview · fictional data · no email sent</strong>
      <nav aria-label="Business preview shortcuts">
        <a href="/admin/referral-partners">Admin preview</a>
        <a href="/_local/businesses?example=journey">Resume journey</a>
        <a href="/_local/businesses?example=active">Dashboard with referrals</a>
        <button type="button" onClick={restart}>Restart journey</button>
      </nav>
      <label>Preview screen <select value={preview.example} onChange={event => { window.location.href = `/_local/businesses?example=${encodeURIComponent(event.target.value)}`; }}>
        {Object.entries(businessExamples).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
      </select></label>
      {!signedIn && <p>Simulated sign-in: <strong>{preview.business.email}</strong> · code <strong>123456</strong>. Nothing is sent.</p>}
    </div>
    {signedIn && <BusinessApproval preview={preview} />}
    {location.pathname === '/_local/businesses' ? <Navigate to={preview.home} replace /> : <Outlet />}
  </AuthContext.Provider>;
}

function BusinessApproval({ preview }: { preview: BusinessPreviewRuntime }) {
  const client = useQueryClient();
  const query = useReferralQuery('partner', 'partner_list', { page: 1, page_size: 25 }, parsePartnerList);
  const owned = query.data?.items.some(item => item.id === preview.business.partnerId) === true;
  const detail = useReferralQuery('partner', 'partner_get', { partner_id: preview.business.partnerId }, parsePartnerDetail, owned);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (detail.data?.partner.status !== 'awaiting_approval') return null;
  const approve = async () => {
    setPending(true); setError(null);
    try { await preview.approve(); await client.invalidateQueries({ queryKey: referralQueryRoot }); }
    catch (failure) { setError(failure); }
    finally { setPending(false); }
  };
  return <aside className="business-preview-approval" aria-label="Synthetic approval controls">
    <div><strong>Preview the next step</strong><p>In the real process, Venfour reviews and countersigns. This control simulates that step for your fictional business.</p></div>
    <Button variant="outline" disabled={pending} onClick={() => void approve()}>{pending ? 'Simulating approval…' : 'Simulate Venfour approval'}</Button>
    <Link to={`/partners/${preview.business.partnerId}`}>Open business</Link>
    <PartnerError error={error} />
  </aside>;
}
