import { parsePartnerDetail } from '@/features/referral-partners/service';
import { createSyntheticReferralPartnerService, referralScenarioIds } from './referral-fixtures';
import { session } from './fixtures';

export const businessPreviewPrefix = 'venfour.synthetic-business.';
export const businessExamples = {
  journey: { label: 'Full onboarding journey', partnerId: referralScenarioIds.pending, email: 'demonstration-1@example.test', userId: '00065001-7000-4000-8000-000000000001' },
  onboarding: { label: 'Company details', partnerId: referralScenarioIds.onboarding, email: 'demonstration-2@example.test', userId: '00065002-7000-4000-8000-000000000001' },
  approval: { label: 'Waiting for approval', partnerId: referralScenarioIds.awaitingApproval, email: 'demonstration-3@example.test', userId: '00065003-7000-4000-8000-000000000001' },
  active: { label: 'Dashboard with referrals', partnerId: referralScenarioIds.active, email: 'demonstration-4@example.test', userId: '00065004-7000-4000-8000-000000000001' },
} as const;
export type BusinessExample = keyof typeof businessExamples;

export function createBusinessPreview() {
  const memory = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      try { return sessionStorage.getItem(businessPreviewPrefix + key) ?? memory.get(key) ?? null; }
      catch { return memory.get(key) ?? null; }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      try { sessionStorage.setItem(businessPreviewPrefix + key, value); } catch { /* Keep the open preview usable without storage. */ }
    },
    removeItem(key: string) {
      memory.delete(key);
      try { sessionStorage.removeItem(businessPreviewPrefix + key); } catch { /* In-memory state remains available. */ }
    },
  };
  const requested = new URLSearchParams(location.search).get('example') ?? storage.getItem('example') ?? 'journey';
  const example: BusinessExample = Object.hasOwn(businessExamples, requested) ? requested as BusinessExample : 'journey';
  storage.setItem('example', example);
  const business = businessExamples[example];
  const identity = { id: business.userId, email: business.email };
  const user = { ...session.user, ...identity, user_metadata: { full_name: 'Fictional business contact' } };
  const partnerSession = { ...session, user };
  const service = createSyntheticReferralPartnerService('populated', { storage, identity });
  const authKey = `signed-in.${identity.id}`;
  const home = example === 'journey' ? `/partners/invitations/${referralScenarioIds.invitation}` : `/partners/${business.partnerId}`;

  return {
    example, business, home, service, storage, session: partnerSession,
    initiallySignedIn: storage.getItem(authKey) === 'true' || (storage.getItem(authKey) === null && example !== 'journey'),
    setSignedIn(value: boolean) { storage.setItem(authKey, String(value)); },
    async approve() {
      const detail = parsePartnerDetail(await service.operation('partner', partnerSession.access_token, 'partner_get', { partner_id: business.partnerId }));
      const agreement = detail.agreements.find(item => item.id === detail.partner.current_agreement_id && item.status === 'partner_signed');
      if (!agreement) throw new Error('Sign the fictional agreement before simulating Venfour approval.');
      const manager = createSyntheticReferralPartnerService('populated', { storage });
      await manager.operation('staff', session.access_token, 'countersign', {
        agreement_id: agreement.id, expected_revision: agreement.revision, agreement_digest: agreement.agreement_digest,
        typed_legal_name: 'Avery Example', typed_title: 'Demonstration manager',
        electronic_consent: true, pdf_email_consent: true, authority_confirmed: true,
        request_id: crypto.randomUUID(),
      });
    },
  };
}
