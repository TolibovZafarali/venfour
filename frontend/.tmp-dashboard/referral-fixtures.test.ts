import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import {
  parsePartnerDetail,
  parsePartnerList,
  parseReferralAccess,
  type AgreementTemplate,
  type PartnerAgreement,
  type PartnerDetail,
  type PartnerInvitation,
} from '@/features/referral-partners/service';

import {
  createSyntheticReferralPartnerService,
  referralScenarioIds,
  resetSyntheticReferralPartners,
} from './referral-fixtures';

const currentTime = Date.parse('2026-09-07T18:00:00.000Z');
const token = 'synthetic-preview-token';
type Service = ReturnType<typeof createSyntheticReferralPartnerService>;
type StorageAdapter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function memoryStorage(): StorageAdapter {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

function fixture(mode = 'populated', storage = memoryStorage()) {
  return { storage, service: createSyntheticReferralPartnerService(mode, { storage, now: () => currentTime }) };
}

async function detail(service: Service, partnerId: string) {
  return parsePartnerDetail(await service.operation('staff', token, 'staff_get', { partner_id: partnerId }));
}

async function createPartner(service: Service, overrides: Record<string, unknown> = {}) {
  return parsePartnerDetail(await service.operation('staff', token, 'staff_create', {
    business_name: 'Fictional Cedar Referral Test',
    contact_email: 'cedar-referral@example.test',
    state: 'MO',
    commission_amount_minor_units: 1234,
    request_id: crypto.randomUUID(),
    ...overrides,
  }));
}

function identityService(storage: StorageAdapter, partner: PartnerDetail['partner']) {
  return createSyntheticReferralPartnerService('populated', {
    storage,
    now: () => currentTime,
    identity: { id: partner.user_id ?? 'aabbccdd-1111-4111-8111-112233445566', email: partner.contact_email },
  });
}

function currentAgreement(value: PartnerDetail) {
  const agreement = value.agreements.find(item => item.id === value.partner.current_agreement_id);
  expect(agreement).toBeDefined();
  return agreement as PartnerAgreement;
}

function signaturePayload(agreement: PartnerAgreement) {
  return {
    agreement_id: agreement.id,
    expected_revision: agreement.revision,
    agreement_digest: agreement.agreement_digest,
    typed_legal_name: 'Fictional Morgan Manager',
    typed_title: 'Program Manager',
    electronic_consent: true,
    pdf_email_consent: true,
    authority_confirmed: true,
    request_id: crypto.randomUUID(),
  };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe('synthetic referral partner workspace', () => {
  it('loads every onboarding and delivery scenario through the shared response contracts', async () => {
    const { service } = fixture();
    expect(parseReferralAccess(await service.access('staff', token))).toMatchObject({ is_partner_manager: true });
    const list = parsePartnerList(await service.operation('staff', token, 'staff_list', { page: 1, page_size: 100 }));
    expect(list.items.length).toBe(list.total);
    expect(new Set(list.items.map(item => item.status))).toEqual(new Set(['onboarding', 'awaiting_approval', 'active']));
    for (const id of [referralScenarioIds.pending, referralScenarioIds.onboarding, referralScenarioIds.awaitingApproval, referralScenarioIds.active, referralScenarioIds.pdfFailure, referralScenarioIds.emailReview]) {
      expect(list.items.some(item => item.id === id)).toBe(true);
      expect((await detail(service, id)).partner.id).toBe(id);
    }
    const awaiting = await detail(service, referralScenarioIds.awaitingApproval);
    expect(currentAgreement(awaiting).partner_signature).toBeTruthy();
    expect(currentAgreement(awaiting).manager_signature).toBeFalsy();
    expect(currentAgreement(await detail(service, referralScenarioIds.pdfFailure)).document_status).toBe('failed');
    expect(currentAgreement(await detail(service, referralScenarioIds.emailReview)).deliveries?.some(item => item.status === 'review')).toBe(true);
  });

  it('creates and edits searchable business records using integer cents and stable pagination', async () => {
    const { service } = fixture('empty');
    expect(parsePartnerList(await service.operation('staff', token, 'staff_list')).total).toBe(0);
    for (const invalidAmount of [0, -1, 12.34]) {
      await expect(createPartner(service, { commission_amount_minor_units: invalidAmount })).rejects.toMatchObject({ status: 422 });
    }
    const created = await createPartner(service);
    expect(created.partner).toMatchObject({ state: 'MO', currency: 'USD', commission_amount_minor_units: 1234, status: 'onboarding' });
    await expect(service.operation('staff', token, 'invite', { partner_id: created.partner.id, expected_revision: created.partner.revision, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    const edited = parsePartnerDetail(await service.operation('staff', token, 'staff_edit', {
      partner_id: created.partner.id,
      expected_revision: created.partner.revision,
      business_name: 'Fictional Cedar Revised',
      contact_email: created.partner.contact_email,
      state: 'IL',
      commission_amount_minor_units: 2345,
      request_id: crypto.randomUUID(),
    }));
    expect(edited.partner.revision).toBeGreaterThan(created.partner.revision);
    expect(edited.partner.commission_amount_minor_units).toBe(2345);
    const search = parsePartnerList(await service.operation('staff', token, 'staff_list', { search: 'CEDAR REVISED', page: 1, page_size: 1 }));
    expect(search.items.map(item => item.id)).toEqual([created.partner.id]);
    expect(search.total).toBe(1);
    expect(parsePartnerList(await service.operation('staff', token, 'staff_list', { search: 'does-not-exist' })).total).toBe(0);
    expect(parsePartnerList(await service.operation('staff', token, 'staff_list', { page: 2, page_size: 1 })).items).toEqual([]);
  });

  it('keeps published template text immutable while permitting a fresh draft', async () => {
    const { service } = fixture('empty');
    const initial = { title: 'Synthetic test agreement', sections: [{ heading: 'Demonstration only', body: 'Fictional text with no legal effect.' }] };
    const draft = await service.operation<{ template: AgreementTemplate }>('staff', token, 'template_save', { ...initial, request_id: crypto.randomUUID() });
    const published = await service.operation<{ template: AgreementTemplate }>('staff', token, 'template_publish', { template_id: draft.template.id, expected_revision: draft.template.revision, request_id: crypto.randomUUID() });
    expect(published.template).toMatchObject({ ...initial, status: 'published' });
    await expect(service.operation('staff', token, 'template_save', { ...initial, title: 'Overwritten', template_id: published.template.id, expected_revision: published.template.revision, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    const replacement = await service.operation<{ template: AgreementTemplate }>('staff', token, 'template_save', { ...initial, title: 'New demonstration draft', request_id: crypto.randomUUID() });
    expect(replacement.template.id).not.toBe(published.template.id);
    const templates = await service.operation<{ items: AgreementTemplate[] }>('staff', token, 'template_list');
    expect(templates.items.find(item => item.id === published.template.id)).toEqual(published.template);
  });

  it('replaces outstanding invitations on resend and enforces revocation and seven-day expiry', async () => {
    let now = currentTime;
    const storage = memoryStorage();
    const service = createSyntheticReferralPartnerService('populated', { storage, now: () => now });
    const created = await createPartner(service);
    const invited = parsePartnerDetail(await service.operation('staff', token, 'invite', { partner_id: created.partner.id, expected_revision: created.partner.revision, request_id: crypto.randomUUID() }));
    const original = invited.invitations.find(item => item.status === 'pending') as PartnerInvitation;
    expect(Date.parse(original.expires_at) - Date.parse(original.created_at)).toBe(7 * 24 * 60 * 60 * 1000);
    const resent = parsePartnerDetail(await service.operation('staff', token, 'resend', { partner_id: created.partner.id, expected_revision: invited.partner.revision, request_id: crypto.randomUUID() }));
    const replacement = resent.invitations.find(item => item.status === 'pending') as PartnerInvitation;
    expect(replacement.id).not.toBe(original.id);
    expect(resent.invitations.find(item => item.id === original.id)?.status).toBe('revoked');
    const contact = createSyntheticReferralPartnerService('populated', { storage, now: () => now, identity: { id: 'aabbccdd-1111-4111-8111-112233445566', email: created.partner.contact_email } });
    await expect(contact.operation('partner', token, 'invitation_get', { invitation_id: original.id })).rejects.toMatchObject({ status: 409 });
    const revoked = parsePartnerDetail(await service.operation('staff', token, 'revoke', { partner_id: created.partner.id, invitation_id: replacement.id, expected_revision: resent.partner.revision, request_id: crypto.randomUUID() }));
    expect(revoked.invitations.find(item => item.id === replacement.id)?.status).toBe('revoked');
    await expect(contact.operation('partner', token, 'invitation_accept', { invitation_id: replacement.id, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    const last = parsePartnerDetail(await service.operation('staff', token, 'resend', { partner_id: created.partner.id, expected_revision: revoked.partner.revision, request_id: crypto.randomUUID() }));
    const expiring = last.invitations.find(item => item.status === 'pending') as PartnerInvitation;
    now = Date.parse(expiring.expires_at);
    await expect(contact.operation('partner', token, 'invitation_accept', { invitation_id: expiring.id, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect((await detail(service, created.partner.id)).partner.user_id).toBeFalsy();
  });

  it('requires explicit invitation acceptance and keeps partner records isolated to the fictional contact', async () => {
    const { service, storage } = fixture();
    const pending = await detail(service, referralScenarioIds.pending);
    const invitation = pending.invitations.find(item => item.status === 'pending') as PartnerInvitation;
    const contact = identityService(storage, pending.partner);
    await contact.operation('partner', token, 'invitation_get', { invitation_id: invitation.id });
    expect((await detail(service, pending.partner.id)).partner.user_id).toBeFalsy();
    const request = { invitation_id: invitation.id, request_id: crypto.randomUUID() };
    const accepted = parsePartnerDetail(await contact.operation('partner', token, 'invitation_accept', request));
    expect(accepted.partner.user_id).toBeTruthy();
    expect(await contact.operation('partner', token, 'invitation_accept', request)).toEqual(accepted);
    expect(parsePartnerList(await contact.operation('partner', token, 'partner_list')).items.map(item => item.id)).toEqual([pending.partner.id]);
    await expect(contact.operation('partner', token, 'partner_get', { partner_id: referralScenarioIds.active })).rejects.toMatchObject({ status: 404 });
    await expect(contact.operation('partner', token, 'staff_list')).rejects.toMatchObject({ status: 403 });
    const wrongContact = createSyntheticReferralPartnerService('populated', { storage, now: () => currentTime, identity: { id: 'aabbccdd-2222-4222-8222-112233445566', email: 'different@example.test' } });
    await expect(wrongContact.operation('partner', token, 'invitation_get', { invitation_id: invitation.id })).rejects.toMatchObject({ status: 404 });
  });

  it('saves an onboarding profile, freezes its agreement, and requires explicit signature consent', async () => {
    const { service, storage } = fixture();
    const initial = await detail(service, referralScenarioIds.onboarding);
    const contact = identityService(storage, initial.partner);
    const profile = { legal_business_name: 'Fictional Cedar Legal LLC', address_line1: '100 Example Street', address_line2: 'Suite 2', city: 'Columbia', state: 'MO', postal_code: '65201', country: 'US', contact_name: 'Fictional Casey Contact', contact_title: 'Owner' };
    const saved = parsePartnerDetail(await contact.operation('partner', token, 'profile_save', { ...profile, partner_id: initial.partner.id, expected_revision: initial.partner.revision, request_id: crypto.randomUUID() }));
    expect(saved.partner).toMatchObject(profile);
    const prepared = parsePartnerDetail(await contact.operation('partner', token, 'agreement_prepare', { partner_id: saved.partner.id, expected_revision: saved.partner.revision, request_id: crypto.randomUUID() }));
    const agreement = currentAgreement(prepared);
    expect(agreement.snapshot).toMatchObject({ ...profile, commission_amount_minor_units: initial.partner.commission_amount_minor_units, contact_email: initial.partner.contact_email });
    const signedRequest: Record<string, unknown> = { ...signaturePayload(agreement), typed_legal_name: profile.contact_name };
    delete signedRequest.typed_title;
    await expect(contact.operation('partner', token, 'sign', { ...signedRequest, electronic_consent: false })).rejects.toMatchObject({ status: 422 });
    expect(currentAgreement(await detail(service, initial.partner.id)).partner_signature).toBeFalsy();
    const signed = parsePartnerDetail(await contact.operation('partner', token, 'sign', signedRequest));
    expect(signed.partner.status).toBe('awaiting_approval');
    expect(currentAgreement(signed).snapshot).toEqual(agreement.snapshot);
    expect(currentAgreement(signed).partner_signature).toMatchObject({ typed_legal_name: profile.contact_name, typed_title: profile.contact_title });
    await expect(contact.operation('partner', token, 'profile_save', { ...profile, legal_business_name: 'Replacement', partner_id: signed.partner.id, expected_revision: signed.partner.revision, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects stale countersigning and records an exact replay only once', async () => {
    const { service } = fixture();
    const awaiting = await detail(service, referralScenarioIds.awaitingApproval);
    const agreement = currentAgreement(awaiting);
    const request = signaturePayload(agreement);
    await expect(service.operation('staff', token, 'countersign', { ...request, agreement_digest: '0'.repeat(64) })).rejects.toMatchObject({ status: 409 });
    await expect(service.operation('staff', token, 'countersign', { ...request, expected_revision: agreement.revision - 1 })).rejects.toMatchObject({ status: 409 });
    await expect(service.operation('staff', token, 'countersign', { ...request, authority_confirmed: false })).rejects.toMatchObject({ status: 422 });
    const activated = parsePartnerDetail(await service.operation('staff', token, 'countersign', request));
    expect(activated.partner.status).toBe('active');
    expect(currentAgreement(activated)).toMatchObject({ status: 'countersigned', snapshot: agreement.snapshot, partner_signature: agreement.partner_signature, manager_signature: { typed_legal_name: request.typed_legal_name, typed_title: request.typed_title } });
    expect(await service.operation('staff', token, 'countersign', request)).toEqual(activated);
    await expect(service.operation('staff', token, 'countersign', { ...request, typed_legal_name: 'Conflicting request' })).rejects.toMatchObject({ status: 409 });
    expect((await detail(service, awaiting.partner.id)).events).toEqual(activated.events);
    await expect(service.operation('staff', token, 'staff_edit', { partner_id: awaiting.partner.id, expected_revision: activated.partner.revision, business_name: 'Changed active terms', contact_email: awaiting.partner.contact_email, state: 'MO', commission_amount_minor_units: 1, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
  });

  it('preserves signed history when a manager revises terms before activation', async () => {
    const { service } = fixture();
    const awaiting = await detail(service, referralScenarioIds.awaitingApproval);
    const signed = currentAgreement(awaiting);
    const edited = parsePartnerDetail(await service.operation('staff', token, 'staff_edit', { partner_id: awaiting.partner.id, expected_revision: awaiting.partner.revision, business_name: awaiting.partner.business_name, state: 'MO', commission_amount_minor_units: awaiting.partner.commission_amount_minor_units + 1, request_id: crypto.randomUUID() }));
    expect(edited.partner.status).toBe('onboarding');
    expect(edited.partner.current_agreement_id).toBeFalsy();
    expect(edited.agreements.find(item => item.id === signed.id)).toMatchObject({ status: 'superseded', snapshot: signed.snapshot, partner_signature: signed.partner_signature });
  });

  it('retains progress and exact request replay after a reload, with reset scoped to this preview mode', async () => {
    const storage = memoryStorage();
    const { service } = fixture('populated', storage);
    const request = { business_name: 'Fictional Persistence Test', contact_email: 'persistence@example.test', state: 'MO', commission_amount_minor_units: 3210, request_id: crypto.randomUUID() };
    const saved = parsePartnerDetail(await service.operation('staff', token, 'staff_create', request));
    const reloaded = createSyntheticReferralPartnerService('populated', { storage, now: () => currentTime });
    expect(await detail(reloaded, saved.partner.id)).toEqual(saved);
    expect(await reloaded.operation('staff', token, 'staff_create', request)).toEqual(saved);
    const empty = createSyntheticReferralPartnerService('empty', { storage, now: () => currentTime });
    const independent = await createPartner(empty);
    resetSyntheticReferralPartners('populated', storage);
    const reset = createSyntheticReferralPartnerService('populated', { storage, now: () => currentTime });
    expect(parsePartnerList(await reset.operation('staff', token, 'staff_list', { search: 'Persistence Test' })).total).toBe(0);
    expect((await detail(createSyntheticReferralPartnerService('empty', { storage, now: () => currentTime }), independent.partner.id)).partner.id).toBe(independent.partner.id);
  });

  it('retries a failed PDF without altering either signature and downloads matching real PDF bytes without network', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('The synthetic preview must not contact a server.'));
    const { service, storage } = fixture();
    const failed = await detail(service, referralScenarioIds.pdfFailure);
    const agreement = currentAgreement(failed);
    await expect(service.download('staff', token, agreement.id)).rejects.toMatchObject({ status: 409 });
    const retried = parsePartnerDetail(await service.operation('staff', token, 'document_retry', { agreement_id: agreement.id, expected_revision: agreement.revision, request_id: crypto.randomUUID() }));
    const ready = currentAgreement(retried);
    expect(retried.partner.status).toBe('active');
    expect(ready).toMatchObject({ document_status: 'ready', snapshot: agreement.snapshot, partner_signature: agreement.partner_signature, manager_signature: agreement.manager_signature });
    const staffBlob = await service.download('staff', token, agreement.id);
    const contact = identityService(storage, retried.partner);
    const partnerBlob = await contact.download('partner', token, agreement.id);
    const staffBytes = await blobBytes(staffBlob);
    expect(staffBlob.type).toBe('application/pdf');
    expect(await blobBytes(partnerBlob)).toEqual(staffBytes);
    expect(new TextDecoder().decode(staffBytes.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(staffBytes)).getPageCount()).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adds an explicit email retry without overwriting the uncertain attempt or regenerating the artifact', async () => {
    const { service } = fixture();
    const initial = await detail(service, referralScenarioIds.emailReview);
    const agreement = currentAgreement(initial);
    const before = await blobBytes(await service.download('staff', token, agreement.id));
    const request = { agreement_id: agreement.id, expected_revision: agreement.revision, request_id: crypto.randomUUID() };
    const retried = parsePartnerDetail(await service.operation('staff', token, 'email_retry', request));
    const next = currentAgreement(retried);
    expect(next.deliveries).toHaveLength((agreement.deliveries?.length ?? 0) + 1);
    for (const delivery of agreement.deliveries ?? []) expect(next.deliveries).toContainEqual(delivery);
    expect(next.deliveries?.some(item => item.status === 'completed')).toBe(true);
    expect(await service.operation('staff', token, 'email_retry', request)).toEqual(retried);
    expect(await blobBytes(await service.download('staff', token, agreement.id))).toEqual(before);
    expect(next.partner_signature).toEqual(agreement.partner_signature);
    expect(next.manager_signature).toEqual(agreement.manager_signature);
  });

  it('exposes an ordinary-staff permission case and a recoverable save failure without modifying saved records', async () => {
    const ordinary = fixture('staff-only').service;
    expect(parseReferralAccess(await ordinary.access('staff', token)).is_partner_manager).toBe(false);
    await expect(ordinary.operation('staff', token, 'staff_list')).rejects.toMatchObject({ status: 403 });
    const { service } = fixture('save-error');
    const before = await detail(service, referralScenarioIds.pending);
    await expect(service.operation('staff', token, 'staff_edit', { partner_id: before.partner.id, expected_revision: before.partner.revision, business_name: 'Unsaved fictional edit', state: 'MO', commission_amount_minor_units: 4321, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 503 });
    expect(await detail(service, before.partner.id)).toEqual(before);
  });
});

describe('synthetic referral link tracking', () => {
  it('returns only opaque submitted references with historical purchase totals', async () => {
    const { service } = fixture();
    const summary = await service.operation<{ link: { code: string; status: string; revision: number }; summary: Record<string, number> }>('staff', token, 'referral_summary', { partner_id: referralScenarioIds.active });
    expect(summary.link.code).toMatch(/^[0-9a-f]{48}$/);
    expect(summary.summary).toEqual({ submitted_count: 6, purchased_count: 4, refunded_count: 1, under_review_count: 1 });
    const list = await service.operation<{ items: Record<string, unknown>[]; total: number }>('staff', token, 'referral_list', { partner_id: referralScenarioIds.active });
    expect(list.total).toBe(6);
    expect(new Set(list.items.map((row) => row.status))).toEqual(new Set(['submitted', 'purchased', 'refunded', 'under_review']));
    for (const row of list.items) expect(Object.keys(row).sort()).toEqual(['id', 'purchased_at', 'status', 'submitted_at']);
    const onboarding = await service.operation<{ link: unknown }>('staff', token, 'referral_summary', { partner_id: referralScenarioIds.onboarding });
    expect(onboarding.link).toBeNull();
  });
  it('pauses and resumes one stable link without deleting prior referrals and fences stale requests', async () => {
    const { service, storage } = fixture();
    const payload = { partner_id: referralScenarioIds.active };
    const before = await service.operation<{ link: { code: string; revision: number } }>('staff', token, 'referral_summary', payload);
    const rows = await service.operation('staff', token, 'referral_list', payload);
    const request = { ...payload, enabled: false, expected_revision: before.link.revision, request_id: crypto.randomUUID() };
    const paused = await service.operation<{ link: { code: string; revision: number; status: string } }>('staff', token, 'link_state', request);
    expect(paused.link).toMatchObject({ code: before.link.code, status: 'paused' });
    expect((await detail(service, referralScenarioIds.active)).events[0].event_type).toBe('referral_link.paused');
    expect(await service.operation('staff', token, 'link_state', request)).toEqual(paused);
    await expect(service.operation('staff', token, 'link_state', { ...request, enabled: true, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect(await service.operation('staff', token, 'referral_list', payload)).toEqual(rows);
    const restored = createSyntheticReferralPartnerService('populated', { storage, now: () => currentTime });
    expect(await restored.operation('staff', token, 'referral_summary', payload)).toEqual(paused);
    const resumed = await restored.operation<{ link: { code: string; status: string } }>('staff', token, 'link_state', { ...payload, enabled: true, expected_revision: paused.link.revision, request_id: crypto.randomUUID() });
    expect(resumed.link).toMatchObject({ code: before.link.code, status: 'active' });
    expect((await detail(restored, referralScenarioIds.active)).events[0].event_type).toBe('referral_link.resumed');
  });
  it('keeps a partner scoped to its own link and prevents partner pause controls', async () => {
    const { service, storage } = fixture();
    const active = await detail(service, referralScenarioIds.active);
    const contact = identityService(storage, active.partner);
    const payload = { partner_id: active.partner.id };
    expect(await contact.operation('partner', token, 'referral_summary', payload)).toEqual(await service.operation('staff', token, 'referral_summary', payload));
    await expect(contact.operation('partner', token, 'referral_list', { partner_id: referralScenarioIds.emailReview })).rejects.toMatchObject({ status: 404 });
    await expect(contact.operation('partner', token, 'link_state', { ...payload, enabled: false, expected_revision: 1, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 403 });
  });
  it('paginates large referral fixtures and gives newly activated businesses an empty referral history', async () => {
    const { service } = fixture('large');
    const first = await service.operation<{ items: { id: string }[]; total: number }>('staff', token, 'referral_list', { partner_id: referralScenarioIds.active, page: 1, page_size: 25 });
    const last = await service.operation<{ items: { id: string }[]; total: number }>('staff', token, 'referral_list', { partner_id: referralScenarioIds.active, page: 3, page_size: 25 });
    expect(first.total).toBe(57); expect(first.items).toHaveLength(25); expect(last.items).toHaveLength(7);
    expect(last.items.some((item) => first.items.some((prior) => prior.id === item.id))).toBe(false);
    const awaiting = await detail(service, referralScenarioIds.awaitingApproval);
    await service.operation('staff', token, 'countersign', signaturePayload(currentAgreement(awaiting)));
    const activated = await service.operation<{ link: { code: string }; summary: { submitted_count: number } }>('staff', token, 'referral_summary', { partner_id: awaiting.partner.id });
    expect(activated.link.code).toMatch(/^[0-9a-f]{48}$/); expect(activated.summary.submitted_count).toBe(0);
  });
});
