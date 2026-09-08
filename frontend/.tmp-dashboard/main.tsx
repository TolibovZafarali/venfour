import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, Link } from 'react-router';

import { adminRoute } from '@/features/admin/admin-routes';
import { BlueButtonHover } from '@/components/ui/blue-button-hover';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { CookieConsentContext, type CookieConsentContextValue } from '@/features/privacy/cookie-consent-context';
import { AdminCaseOperationsDependenciesProvider } from '@/features/admin/case-operations/dependencies';
import { AdminDiminishedValueDependenciesProvider } from '@/features/admin/diminished-value/dependencies';
import { referralPartnerService } from '@/features/referral-partners/service';
import { referralDraftPrefix } from '@/features/referral-partners/hooks';
import { PartnerDashboardPage, PartnerDetailPage, PartnerInvitationPage, PartnerWorkspace } from '@/features/referral-partners/pages';
import { BusinessPreview } from './business-preview';
import { createBusinessPreview } from './business-fixtures';

import { createSyntheticOperationsService } from './operations-fixtures';
import { createSyntheticReferralPartnerService, resetSyntheticReferralPartners } from './referral-fixtures';
import { session, cases, detail } from './fixtures';
import './styles.css';

const noop = async () => {};
const modes = ['populated', 'large', 'empty', 'loading', 'error', 'denied', 'staff-only', 'email-disabled', 'save-error'];
const modeKey = 'venfour.synthetic-dashboard.mode';
let savedMode: string | null = null;
try { savedMode = sessionStorage.getItem(modeKey); } catch { /* The preview also works without browser storage. */ }
const requestedMode = new URLSearchParams(location.search).get('state') ?? savedMode ?? 'populated';
const mode = modes.includes(requestedMode) ? requestedMode : 'populated';
try { sessionStorage.setItem(modeKey, mode); } catch { /* Keep the selected state for this page load. */ }

// This standalone preview replaces the service before rendering the shared application routes.
const businessPreview = /^(\/partners(?:\/|$)|\/_local\/businesses(?:\/|$)|\/referral-partners$)/.test(location.pathname) ? createBusinessPreview() : null;
Object.assign(referralPartnerService, businessPreview?.service ?? createSyntheticReferralPartnerService(mode));

const result = async <T,>(value: T): Promise<T> => {
  if (mode === 'loading') return new Promise(() => {});
  if (mode === 'error') throw new Error('Synthetic connection failure');
  return value;
};
const auth: AuthContextValue = {
  auth: { status: 'signedIn', identity: 'permanent', session, user: session.user },
  ensureGuestSession: async () => session,
  restoreSession: async () => session,
  runTurnstileChallenge: async (_action, run) => run('synthetic-token'),
  signInWithGoogle: noop, signInWithApple: noop, sendMagicLink: noop, sendEmailCode: noop,
  completeEmailCode: async () => session, completeAuthCallback: async () => session,
  completeEmailAuthCallback: async () => session,
  signOut: async () => { location.href = '/admin/cases?state=denied'; },
};
const consent: CookieConsentContextValue = {
  consent: null, globalPrivacyControl: false, bannerVisible: false, preferencesOpen: false,
  acceptAll: noop, rejectNonEssential: noop, savePreferences: noop, openPreferences: noop, setPreferencesOpen: noop,
};
const ops = {
  operationsService: createSyntheticOperationsService(mode),
  caseService: {
    isStaff: async () => mode !== 'denied',
    listCases: () => result(mode === 'empty' ? [] : cases),
    getTotalLossCase: (id: string) => result(detail(id)),
  },
};
const dv = {
  caseService: { isStaff: async () => mode !== 'denied', listSubmittedCases: async () => [], getSubmittedCase: async () => null },
  documentService: { listDocuments: async () => [], downloadDocument: async () => { throw new Error('No documents in this synthetic preview'); } },
};

function resetPartners() {
  resetSyntheticReferralPartners(mode);
  try {
    const prefix = `${referralDraftPrefix}${session.user.id}.`;
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Resetting the service still works if draft storage is unavailable. */ }
  location.href = `/admin/referral-partners?state=${encodeURIComponent(mode)}`;
}

export function Preview() {
  return <>
    <div className="preview-bar">
      <strong title="Fictional records only. Invitations and email delivery are simulated.">Synthetic staff preview · no email sent</strong>
      <nav aria-label="Preview shortcuts"><Link to="/admin">Overview</Link><Link to="/admin/referral-partners">Referral partners</Link><a href="/_local/businesses">Business journey</a></nav>
      <button type="button" onClick={resetPartners}>Reset partners</button>
      <label><span>Preview state</span><select aria-label="Preview state" value={mode} onChange={(event) => {
        const url = new URL(location.href); url.searchParams.set('state', event.target.value); location.href = url.href;
      }}>{modes.map((state) => <option key={state}>{state}</option>)}</select></label>
    </div>
    <Outlet />
  </>;
}

const router = createBrowserRouter(businessPreview ? [{ element: <BusinessPreview preview={businessPreview} />, children: [
  { path: '/_local/businesses', element: null },
  { path: '/referral-partners', element: <Navigate to="/partners" replace /> },
  { path: '/partners', element: <PartnerWorkspace />, children: [
    { index: true, element: <PartnerDashboardPage /> },
    { path: 'invitations/:invitationId', element: <PartnerInvitationPage /> },
    { path: ':partnerId', element: <PartnerDetailPage /> },
  ] },
] }] : [{ element: <Preview />, children: [
  adminRoute,
  { path: '/', element: <Navigate to="/admin" replace /> },
  { path: '/admin/diminished-value/*', element: <Navigate to="/admin/cases" replace /> },
] }]);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => { root.unmount(); queryClient.clear(); router.dispose(); });
root.render(
  <QueryClientProvider client={queryClient}>
    <BlueButtonHover />
    <AuthContext.Provider value={auth}><CookieConsentContext.Provider value={consent}>
      <AdminCaseOperationsDependenciesProvider dependencies={ops}>
        <AdminDiminishedValueDependenciesProvider dependencies={dv}><RouterProvider router={router} /></AdminDiminishedValueDependenciesProvider>
      </AdminCaseOperationsDependenciesProvider>
    </CookieConsentContext.Provider></AuthContext.Provider>
  </QueryClientProvider>,
);
