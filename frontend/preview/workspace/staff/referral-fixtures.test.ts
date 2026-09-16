import type { OutcomeReview } from '@/features/referral-partners/outcome-review-service';
import { describe, expect, test } from 'vitest';
import proposal from '../../../../venfour/data/referral_partner_agreement_draft.json';
import { createSyntheticReferralPartnerService, referralScenarioIds } from './referral-fixtures';
import type { AgreementTemplate, PartnerDetail, PartnerEarningsData } from '@/features/referral-partners/service';

function fixture() {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const now = () => Date.parse('2026-09-16T12:00:00Z');
  return {
    manager: createSyntheticReferralPartnerService('populated', { storage, now }),
    partner: createSyntheticReferralPartnerService('populated', { storage, now, identity: { id: '00065002-7000-4000-8000-000000000001', email: 'demonstration-2@example.test' } }),
    stranger: createSyntheticReferralPartnerService('populated', { storage, now, identity: { id: '00065001-7000-4000-8000-000000000001', email: 'demonstration-1@example.test' } }),
  };
}
function bytes(blob: Blob) {
  return new Promise<Uint8Array>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
}

describe('owner-review signing demonstration', () => {
  test('proposal remains draft and cannot be published', async () => {
    const { manager } = fixture();
    const { items } = await manager.operation<{ items: AgreementTemplate[] }>('staff', 'fixture', 'template_list');
    expect(items.find(item => item.id === proposal.id)).toMatchObject({ status: 'draft', release_hold: true, sections: proposal.sections });
    await expect(manager.operation('staff', 'fixture', 'template_publish', { template_id: proposal.id, expected_revision: 1, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
  });

  test('synthetic signatures, both copies, immutable history, access, and delivery replay', async () => {
    const { manager, partner, stranger } = fixture();
    const prepare = { partner_id: referralScenarioIds.onboarding, expected_revision: 2, request_id: crypto.randomUUID() };
    const detail = await partner.operation<PartnerDetail>('partner', 'fixture', 'agreement_prepare', prepare);
    const agreement = detail.agreements[0];
    expect(agreement.snapshot.sections).toEqual(proposal.sections);
    expect(agreement.snapshot.commission_policy).toEqual(proposal.commission_policy);
    const sign = { agreement_id: agreement.id, expected_revision: agreement.revision, agreement_digest: agreement.agreement_digest,
      typed_legal_name: 'Jordan Example', electronic_consent: true, pdf_email_consent: true, authority_confirmed: true, request_id: crypto.randomUUID() };
    await expect(partner.operation('partner', 'fixture', 'sign', { ...sign, electronic_consent: false })).rejects.toMatchObject({ status: 422 });
    const signed = await partner.operation<PartnerDetail>('partner', 'fixture', 'sign', sign);
    expect(await partner.operation('partner', 'fixture', 'sign', sign)).toEqual(signed);
    expect(signed.agreements[0].status).toBe('partner_signed');
    const countersign = { ...sign, expected_revision: signed.agreements[0].revision, typed_legal_name: 'Avery Example', typed_title: 'Manager', request_id: crypto.randomUUID() };
    const complete = await manager.operation<PartnerDetail>('staff', 'fixture', 'countersign', countersign);
    expect(await manager.operation('staff', 'fixture', 'countersign', countersign)).toEqual(complete);
    expect(complete.agreements[0].deliveries).toHaveLength(1);
    const partnerBytes = await bytes(await partner.download('partner', 'fixture', agreement.id));
    expect(await bytes(await manager.download('staff', 'fixture', agreement.id))).toEqual(partnerBytes);
    await expect(stranger.download('partner', 'fixture', agreement.id)).rejects.toMatchObject({ status: 404 });
    const resend = { agreement_id: agreement.id, expected_revision: complete.agreements[0].revision, request_id: crypto.randomUUID() };
    const emailed = await manager.operation<PartnerDetail>('staff', 'fixture', 'email_retry', resend);
    expect(await manager.operation('staff', 'fixture', 'email_retry', resend)).toEqual(emailed);
    expect(emailed.agreements[0].deliveries).toHaveLength(2);
    await manager.operation('staff', 'fixture', 'template_save', { template_id: proposal.id, expected_revision: 1, title: 'Revised draft', sections: [{ heading: 'Changed', body: 'New draft only.' }], request_id: crypto.randomUUID() });
    const retained = await partner.operation<PartnerDetail>('partner', 'fixture', 'partner_get', { partner_id: referralScenarioIds.onboarding });
    expect(retained.agreements[0].snapshot).toEqual(agreement.snapshot);
    expect(await bytes(await partner.download('partner', 'fixture', agreement.id))).toEqual(partnerBytes);
  });
});


describe('synthetic earnings demonstration', () => {
  test('adds each fictional verification once and advances the marginal tier without changing earlier awards', async () => {
    const { manager, stranger } = fixture();
    const read = () => manager.operation<PartnerEarningsData>('staff', 'fixture', 'earnings', { partner_id: referralScenarioIds.active });
    const initial = await read();
    expect(initial.summary?.verified_month_count).toBe(4);
    const initialRows = initial.items.filter(item => item.amount_minor !== null);
    for (let count = 5; count <= 10; count++) {
      const request = { partner_id: referralScenarioIds.active, request_id: crypto.randomUUID() };
      const response = await manager.operation<PartnerEarningsData>('staff', 'fixture', 'simulate_commission', request);
      expect(await manager.operation('staff', 'fixture', 'simulate_commission', request)).toEqual(response);
      expect(response.summary?.verified_month_count).toBe(count);
    }
    const result = await read();
    expect(result.summary?.earned_month_minor).toBe(initial.summary!.earned_month_minor + 5 * 5000 + 7500);
    for (const row of initialRows) expect(result.items.find(item => item.reference === row.reference)).toEqual(row);
    await expect(stranger.operation('partner', 'fixture', 'earnings', { partner_id: referralScenarioIds.active })).rejects.toMatchObject({ status: 404 });
    await expect(stranger.operation('partner', 'fixture', 'simulate_commission', { partner_id: referralScenarioIds.active, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
  });
});

describe('manager outcome review demonstration', () => {
  test('retains decisions, adds one commission on approval, and denies partner review access', async () => {
    const { manager, partner } = fixture();
    const partnerId = referralScenarioIds.active;
    const queue = await manager.operation<{ items: { id: string; document_count: number }[] }>('staff', 'fixture', 'outcome_queue', { partner_id: partnerId, page: 1 });
    const id = queue.items.find(r => r.document_count === 4)!.id;
    const get = () => manager.operation<OutcomeReview>('staff', 'fixture', 'outcome_get', { partner_id: partnerId, attribution_id: id });
    let review = await get();
    const decision = { partner_id: partnerId, attribution_id: id, request_id: crypto.randomUUID(), source_digest: review.source_digest, decision: 'needs_evidence', notes: 'Retain and review reliable acceptance evidence before approval.', facts: {} };
    await manager.operation('staff', 'fixture', 'outcome_decide', decision);
    const prior = await manager.operation<PartnerEarningsData>('staff', 'fixture', 'earnings', { partner_id: partnerId });
    await expect(manager.operation('staff', 'fixture', 'outcome_decide', { ...decision, request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    review = await get();
    const fields = ['baseline_document_id', 'final_document_id', 'acceptance_document_id', 'review_document_id'];
    const checks = ['latest_written_baseline_confirmed', 'equivalent_vehicle_components_confirmed', 'process_completed', 'insurer_evidence_verified', 'final_acceptance_verified', 'refund_rights_reviewed', 'no_outcome_dispute', 'unregulated_partner_confirmed'];
    const approve = { ...decision, request_id: crypto.randomUUID(), source_digest: review.source_digest, decision: 'approved', facts: { ...Object.fromEntries(fields.map((k, n) => [k, review.source.documents[n].id])), ...Object.fromEntries(checks.map(k => [k, true])), baseline_vehicle_value_minor: 2000000, final_vehicle_value_minor: 2150000, baseline_communicated_at: review.source.attributed_at, service_started_at: review.source.paid_at, accepted_at: review.source.documents[0].sealed_at } };
    const saved = await manager.operation('staff', 'fixture', 'outcome_decide', approve);
    expect(await manager.operation('staff', 'fixture', 'outcome_decide', approve)).toEqual(saved);
    const after = await manager.operation<PartnerEarningsData>('staff', 'fixture', 'earnings', { partner_id: partnerId });
    expect(after.summary!.earned_month_minor - prior.summary!.earned_month_minor).toBe(5000);
    review = await get(); expect(review.source.recorded).toBe(true); expect(review.history.map(h => h.decision)).toEqual(['approved', 'needs_evidence']);
    await expect(partner.operation('partner', 'fixture', 'outcome_get', { partner_id: partnerId, attribution_id: id })).rejects.toMatchObject({ status: 403 });
    await expect(partner.downloadEvidence('fixture', partnerId, id, review.source.documents[0].id)).rejects.toMatchObject({ status: 403 });
    const pdf = await manager.downloadEvidence('fixture', partnerId, id, review.source.documents[0].id);
    expect(Array.from((await bytes(pdf)).slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
  });
});


describe('readable business aliases', () => {
  test('changes keep old aliases, reject collisions and preserve owner isolation and opaque codes', async () => {
    const { manager, partner, stranger } = fixture();
    const original = await partner.operation<PartnerDetail>('partner', 'fixture', 'partner_get', { partner_id: referralScenarioIds.onboarding });
    const request = { partner_id: original.partner.id, expected_revision: original.partner.revision, slug: 'riverbend-auto', request_id: crypto.randomUUID() };
    const changed = await manager.operation<PartnerDetail>('staff', 'fixture', 'slug_update', request);
    expect(changed.partner.url_slug).toBe('riverbend-auto');
    expect(await manager.operation('staff', 'fixture', 'slug_update', request)).toEqual(changed);
    for (const slug of [original.partner.url_slug, 'riverbend-auto']) {
      const found = await partner.operation<PartnerDetail>('partner', 'fixture', 'partner_resolve', { slug });
      expect(found.partner.id).toBe(original.partner.id);
      await expect(stranger.operation('partner', 'fixture', 'partner_resolve', { slug })).rejects.toMatchObject({ status:404 });
    }
    await expect(partner.operation('partner', 'fixture', 'slug_update', request)).rejects.toMatchObject({ status:403 });
    const other = await manager.operation<PartnerDetail>('staff', 'fixture', 'staff_get', { partner_id: referralScenarioIds.active });
    for (const slug of [original.partner.url_slug, 'riverbend-auto']) await expect(manager.operation('staff', 'fixture', 'slug_update', { ...request, partner_id: other.partner.id, expected_revision: other.partner.revision, slug, request_id: crypto.randomUUID() })).rejects.toMatchObject({ code:'PARTNER_LINK_RESERVED' });
    await expect(manager.operation('staff', 'fixture', 'slug_update', { ...request, slug:'changed-again', request_id:crypto.randomUUID() })).rejects.toMatchObject({ status:409 });
  });
});
