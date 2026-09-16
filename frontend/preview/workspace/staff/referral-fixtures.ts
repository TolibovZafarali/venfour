import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ApiError } from '@/lib/api/client';
import {
  parsePartnerDetail, parsePartnerList, parseReferralAccess, parsePartnerReferralList, parsePartnerReferralSummary,
  type AgreementTemplate, type PartnerAgreement, type PartnerAudience,
  type PartnerDelivery, type PartnerDetail, type PartnerInvitation, type PartnerProfile,
  type ReferralPartner, type PartnerReferral, type PartnerReferralLink, type createReferralPartnerService,
} from '@/features/referral-partners/service';

export const SYNTHETIC_REFERRAL_STORAGE_PREFIX = 'venfour.synthetic-referral.v1.';
type PreviewStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface SyntheticReferralOptions {
  storage?: PreviewStorage | null;
  now?: () => number;
  emailConfigured?: boolean;
  identity?: { id: string; email: string };
}
const fixtureId = (value: number) => `${String(value).padStart(8, '0')}-7000-4000-8000-000000000001`;
export const referralScenarioIds = {
  pending: fixtureId(61001), onboarding: fixtureId(61002), awaitingApproval: fixtureId(61003),
  active: fixtureId(61004), pdfFailure: fixtureId(61005), emailReview: fixtureId(61006),
  invitation: fixtureId(62001), publishedTemplate: fixtureId(63001), draftTemplate: fixtureId(63002),
} as const;
const defaultIdentity = { id: '11111111-1111-4111-8111-111111111111', email: 'staff@example.com' };
const modes = ['populated', 'large', 'empty', 'loading', 'error', 'denied', 'staff-only', 'save-error', 'email-disabled'];
const modeKey = (mode: string) => modes.includes(mode) ? mode : 'populated';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
}
function browserStorage(): PreviewStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
export function resetSyntheticReferralPartners(mode = 'populated', storage: PreviewStorage | null = browserStorage()) {
  try { storage?.removeItem(`${SYNTHETIC_REFERRAL_STORAGE_PREFIX}${modeKey(mode)}`); } catch { /* An unavailable browser store does not prevent a fresh preview. */ }
}
interface PreviewState {
  version: 1; partners: PartnerDetail[]; templates: AgreementTemplate[];
  requests: Record<string, { fingerprint: string; response: unknown }>;
  pdfs: Record<string, number[]>;
  links: Record<string, PartnerReferralLink>;
  referrals: Record<string, PartnerReferral[]>;
}
function addTracking(state: PreviewState, mode: string) {
  const upgrading = !state.links || !state.referrals;
  state.links ??= {}; state.referrals ??= {};
  for (const [index, detail] of state.partners.entries()) {
    const partner = detail.partner;
    if (partner.status !== 'active' || state.links[partner.id]) continue;
    state.links[partner.id] = { id: crypto.randomUUID(), code: `${partner.id.replaceAll('-', '')}${'a'.repeat(16)}`, status: 'active', revision: 1, created_at: partner.updated_at };
    state.referrals[partner.id] ??= [];
    if (!upgrading || !partner.id.startsWith('000610')) continue;
    const statuses: PartnerReferral['status'][] = ['submitted', 'purchased', 'refunded', 'under_review', 'submitted', 'purchased'];
    state.referrals[partner.id] = Array.from({ length: mode === 'large' ? 57 : 6 }, (_, offset) => {
      const status = statuses[offset % statuses.length];
      const submitted = Date.parse(partner.created_at) + offset * 60_000;
      return { id: fixtureId(76001 + index * 100 + offset), submitted_at: new Date(submitted).toISOString(), purchased_at: status === 'submitted' ? null : new Date(submitted + 3_600_000).toISOString(), status };
    });
  }
  return state;
}
const required = (payload: Record<string, unknown>, key: string, max = 200) => {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(`Provide ${key}.`, 422);
  return value.trim();
};
const conflict = (message = 'The synthetic record changed. Review it again.') => { throw new ApiError(message, 409); };
function revision(row: { revision: number }, payload: Record<string, unknown>) {
  if (payload.expected_revision !== row.revision) conflict();
}
const stateCodes = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
function proposed(payload: Record<string, unknown>, current?: ReferralPartner) {
  const business_name = required(payload, 'business_name');
  const contact_email = (payload.contact_email === undefined && current ? current.contact_email : required(payload, 'contact_email', 320)).toLowerCase();
  const state = required(payload, 'state', 2).toUpperCase();
  const amount = payload.commission_amount_minor_units;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email) || !stateCodes.has(state) || !Number.isSafeInteger(amount) || Number(amount) < 1) throw new ApiError('Check the business details and positive commission amount.', 422);
  if (current?.user_id && current.contact_email !== contact_email) conflict('The accepted contact cannot be replaced.');
  return { business_name, contact_email, state, commission_amount_minor_units: Number(amount) };
}
function snapshot(partner: ReferralPartner, template: AgreementTemplate): PartnerAgreement['snapshot'] {
  return {
    title: template.title, sections: clone(template.sections), template_id: template.id, template_version: template.revision,
    business_name: partner.business_name, legal_business_name: partner.legal_business_name,
    contact_email: partner.contact_email, contact_name: partner.contact_name, contact_title: partner.contact_title,
    address_line1: partner.address_line1, address_line2: partner.address_line2 ?? '', city: partner.city,
    state: partner.state, postal_code: partner.postal_code, country: 'US',
    commission_amount_minor_units: partner.commission_amount_minor_units, currency: 'USD',
    signing_statement: 'SYNTHETIC PREVIEW ONLY. These simulated signatures demonstrate the website and do not create a partnership or payment obligation.',
  };
}
const demonstrationSections = [
  { heading: 'Non-binding demonstration', body: 'This fictional template exists only in the synthetic website preview. It is not an agreement, legal advice, or an offer to any business. All names, commissions, signatures, and delivery states shown here are demonstration data.' },
  { heading: 'Referral introduction example', body: 'This section demonstrates where reviewed wording about introducing vehicle owners to Venfour would appear. Referral links and activity in this preview are fictional and stay in this browser. No real customers are referred.' },
  { heading: 'Commission and retained copy example', body: 'The fictional commission displayed with this demonstration is not payable. Actual eligibility, qualifying purchases, adjustments, and payout schedules belong in separately reviewed agreement wording. Simulated email actions update this browser only; no email is sent.' },
];
async function seed(mode: string, now: number): Promise<PreviewState> {
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  const templates: AgreementTemplate[] = mode === 'empty' ? [] : [
    { id: referralScenarioIds.publishedTemplate, revision: 2, title: 'NON-BINDING demonstration partner agreement', sections: clone(demonstrationSections), status: 'published', created_at: at(-72), published_at: at(-60) },
    { id: referralScenarioIds.draftTemplate, revision: 1, title: 'NON-BINDING demonstration draft', sections: clone(demonstrationSections), status: 'draft', created_at: at(-12) },
  ];
  const names = ['Prairie Example Collision', 'Riverbend Example Auto', 'Gateway Example Vehicle Care', 'Ozark Example Motor Services', 'Maple Example Body Shop', 'Summit Example Auto Care'];
  const partners: PartnerDetail[] = [];
  for (let index = 0; index < (mode === 'empty' ? 0 : mode === 'large' ? 57 : 6); index++) {
    const scenario = index % 6;
    const partner: ReferralPartner = {
      id: fixtureId(61001 + index), revision: scenario < 2 ? 2 : scenario === 2 ? 5 : 6,
      business_name: `${index < 6 ? names[index] : `Example Missouri Business ${index + 1}`} (fictional)`,
      contact_email: `demonstration-${index + 1}@example.test`, state: 'MO',
      commission_amount_minor_units: 1000 + scenario * 250, currency: 'USD',
      status: scenario < 2 ? 'onboarding' : scenario === 2 ? 'awaiting_approval' : 'active',
      created_at: at(-48 - index), updated_at: at(-index),
      user_id: scenario === 0 ? null : fixtureId(65001 + index), current_agreement_id: null,
      ...(scenario > 0 ? {
        legal_business_name: `${names[scenario]} Demonstration LLC`, address_line1: `${100 + index} Fictional Avenue`, address_line2: '',
        city: scenario % 2 ? 'Kansas City' : 'St. Louis', postal_code: scenario % 2 ? '64106' : '63101', country: 'US',
        contact_name: ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley'][scenario] + ' Example', contact_title: 'Owner',
      } : {}),
    };
    const invitation: PartnerInvitation = { id: fixtureId(62001 + index), status: scenario === 0 ? 'pending' : 'accepted', created_at: at(-24), expires_at: at(6 * 24), ...(scenario > 0 ? { accepted_at: at(-20) } : {}) };
    const detail: PartnerDetail = { partner, invitations: [invitation], agreements: [], events: [{ id: fixtureId(67001 + index), event_type: 'partner.created', created_at: partner.created_at }], invitation_deliveries: [{ id: fixtureId(68001 + index), invitation_id: invitation.id, kind: 'email', status: 'completed', attempts: 1, created_at: at(-24), finished_at: at(-24) }] };
    if (scenario > 1) {
      const frozen = snapshot(partner, templates[0]);
      const agreement: PartnerAgreement = {
        id: fixtureId(64001 + index), revision: scenario === 2 ? 2 : 3, snapshot: frozen,
        agreement_digest: await digest(frozen), status: scenario === 2 ? 'partner_signed' : 'countersigned',
        created_at: at(-18), partner_signature: { typed_legal_name: partner.contact_name!, typed_title: partner.contact_title, signed_at: at(-15) },
        ...(scenario > 2 ? { manager_signature: { typed_legal_name: 'Avery Example', typed_title: 'Demonstration manager', signed_at: at(-12) } } : {}),
        document_status: scenario === 2 ? 'pending' : scenario === 4 ? 'failed' : 'ready', document_available: scenario > 2 && scenario !== 4,
        deliveries: scenario > 2 && scenario !== 4 ? [{ id: fixtureId(69001 + index), kind: 'email', status: scenario === 5 ? 'review' : 'completed', attempts: scenario === 5 ? 5 : 1, created_at: at(-12), ...(scenario === 5 ? { error_code: 'SYNTHETIC_PROVIDER_UNCERTAIN' } : { finished_at: at(-12) }) }] : [],
      };
      partner.current_agreement_id = agreement.id;
      detail.agreements.push(agreement);
      detail.events.unshift({ id: fixtureId(70001 + index), event_type: scenario === 2 ? 'agreement.partner_signed' : 'partner.activated', created_at: at(-12) });
    }
    partners.push(parsePartnerDetail(detail));
  }
  return addTracking({ version: 1, partners, templates, requests: {}, pdfs: {} } as PreviewState, mode);
}

async function renderPdf(agreement: PartnerAgreement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const created = new Date(agreement.manager_signature?.signed_at ?? agreement.created_at);
  doc.setTitle('SYNTHETIC - Non-binding referral partner demonstration');
  doc.setAuthor('Venfour synthetic preview'); doc.setCreator('Venfour synthetic preview');
  doc.setProducer('Venfour synthetic preview'); doc.setCreationDate(created); doc.setModificationDate(created);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]); let y = 740;
  const ascii = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '?');
  const line = (value: string, emphasis = false) => {
    if (y < 62) { page = doc.addPage([612, 792]); y = 740; }
    page.drawText(value, { x: 48, y, size: emphasis ? 12 : 10, font: emphasis ? bold : font, color: rgb(0.12, 0.17, 0.22) }); y -= emphasis ? 22 : 15;
  };
  const paragraph = (value: unknown, emphasis = false) => {
    const activeFont = emphasis ? bold : font;
    const size = emphasis ? 12 : 10;
    const fits = (text: string) => activeFont.widthOfTextAtSize(text, size) <= 510;
    for (const block of ascii(value).split('\n')) {
      let current = '';
      for (const word of block.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (!fits(candidate) && current) { line(current, emphasis); current = ''; }
        if (!fits(word)) {
          for (const character of word) {
            if (!fits(current + character)) { line(current, emphasis); current = ''; }
            current += character;
          }
        } else current = current ? `${current} ${word}` : word;
      }
      if (current) line(current, emphasis);
    }
    y -= 8;
  };
  paragraph('SYNTHETIC PREVIEW - NON-BINDING', true);
  paragraph(agreement.snapshot.title, true);
  paragraph('Fictional records and simulated signatures. No real partnership, payment, or email delivery.');
  const s = agreement.snapshot;
  paragraph(`Business: ${s.legal_business_name ?? s.business_name}`);
  paragraph(`Contact: ${s.contact_name}, ${s.contact_title} | ${s.contact_email}`);
  paragraph(`Address: ${[s.address_line1, s.address_line2, s.city, s.state, s.postal_code, s.country].filter(Boolean).join(', ')}`);
  paragraph(`Fictional commission per qualifying purchase: USD ${(Number(s.commission_amount_minor_units) / 100).toFixed(2)}`);
  for (const section of s.sections) { paragraph(section.heading, true); paragraph(section.body); }
  paragraph(s.signing_statement);
  paragraph('Simulated signatures', true);
  for (const [role, signature] of [['Partner', agreement.partner_signature], ['Venfour manager', agreement.manager_signature]] as const) paragraph(`${role}: ${signature?.typed_legal_name} | ${signature?.typed_title} | ${signature?.signed_at}`);
  paragraph(`Frozen agreement identifier: ${agreement.id}`);
  paragraph(`Content digest: ${agreement.agreement_digest}`);
  doc.getPages().forEach((item, index) => item.drawText(`SYNTHETIC / NON-BINDING | Page ${index + 1} of ${doc.getPageCount()}`, { x: 48, y: 32, size: 8, font }));
  return doc.save({ useObjectStreams: false });
}

export function createSyntheticReferralPartnerService(mode = 'populated', options: SyntheticReferralOptions = {}): ReturnType<typeof createReferralPartnerService> {
  mode = modeKey(mode);
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? Date.now;
  const identity = options.identity ?? defaultIdentity;
  const key = `${SYNTHETIC_REFERRAL_STORAGE_PREFIX}${mode}`;
  const emailConfigured = options.emailConfigured ?? mode !== 'email-disabled';
  const manager = mode !== 'denied' && mode !== 'staff-only' && identity.id === defaultIdentity.id;
  let state: PreviewState;
  const persist = () => { try { storage?.setItem(key, JSON.stringify(state)); } catch { /* Keep the open preview usable when session storage is full or disabled. */ } };
  const ready = (async () => {
    try {
      const stored = JSON.parse(storage?.getItem(key) ?? 'null') as PreviewState | null;
      if (stored?.version === 1 && Array.isArray(stored.partners) && Array.isArray(stored.templates) && stored.requests && stored.pdfs) {
        stored.partners.forEach(parsePartnerDetail); state = addTracking(stored, mode); persist(); return;
      }
    } catch { /* Invalid or old synthetic state is replaced by fresh fixtures. */ }
    state = await seed(mode, now()); persist();
  })();
  const refresh = () => {
    try {
      const stored = JSON.parse(storage?.getItem(key) ?? 'null') as PreviewState | null;
      if (stored?.version === 1 && Array.isArray(stored.partners) && Array.isArray(stored.templates) && stored.requests && stored.pdfs) {
        stored.partners.forEach(parsePartnerDetail); state = addTracking(stored, mode);
      }
    } catch { /* Retain the open fixture if another tab has an unreadable browser store. */ }
  };
  let sequence: Promise<unknown> = ready;
  const serialized = <T,>(run: () => Promise<T>): Promise<T> => { const next = sequence.then(run); sequence = next.catch(() => undefined); return next; };
  const guard = async (audience: PartnerAudience, token: string, signal?: AbortSignal) => {
    if (!token.trim()) throw new ApiError('Synthetic sign-in required.', 401);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (mode === 'loading') await new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    if (mode === 'error') throw new ApiError('Synthetic connection failure.', 503);
    if (mode === 'denied' || (audience === 'staff' && !manager)) throw new ApiError('Synthetic partner permission denied.', 403);
    await ready;
  };
  const readActions = new Set(['staff_list', 'staff_get', 'template_list', 'partner_list', 'partner_get', 'invitation_get', 'referral_summary', 'referral_list']);
  const staffActions = new Set(['staff_list', 'staff_get', 'staff_create', 'staff_edit', 'template_list', 'template_save', 'template_publish', 'invite', 'resend', 'revoke', 'countersign', 'document_retry', 'email_retry', 'referral_summary', 'referral_list', 'link_state']);
  const partnerActions = new Set(['partner_list', 'partner_get', 'invitation_get', 'invitation_accept', 'profile_save', 'agreement_prepare', 'sign', 'referral_summary', 'referral_list']);
  return {
    async access(audience, token, signal) {
      if (mode === 'denied' || (audience === 'staff' && mode === 'staff-only')) {
        if (!token.trim()) throw new ApiError('Synthetic sign-in required.', 401);
        return parseReferralAccess({ is_partner_manager: false, is_partner: false, email_configured: emailConfigured });
      }
      await guard(audience, token, signal);
      refresh();
      return parseReferralAccess({ is_partner_manager: manager, is_partner: state.partners.some((item) => item.partner.user_id === identity.id), email_configured: emailConfigured });
    },
    async operation<T>(audience: PartnerAudience, token: string, action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
      await guard(audience, token, signal);
      if (!(audience === 'staff' ? staffActions : partnerActions).has(action)) throw new ApiError('Unsupported synthetic partner action.', 403);
      return serialized(async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        refresh();
        const read = readActions.has(action);
        if (!read && mode === 'save-error') throw new ApiError('Synthetic save failure; entries are preserved.', 503);
        const work = clone(state);
        const timestamp = new Date(now()).toISOString();
        const requestId = read ? '' : required(payload, 'request_id');
        const requestKey = `${identity.id}:${requestId}`;
        const fingerprint = canonical({ action, payload });
        if (!read && work.requests[requestKey]) {
          if (work.requests[requestKey].fingerprint !== fingerprint) conflict('This request was already used with different entries.');
          return clone(work.requests[requestKey].response) as T;
        }
        const owned = (detail: PartnerDetail) => detail.partner.user_id === identity.id && detail.partner.contact_email === identity.email.toLowerCase();
        const getDetail = (id: unknown) => {
          const detail = work.partners.find((item) => item.partner.id === id);
          if (!detail || (audience === 'partner' && !owned(detail))) throw new ApiError('This fictional business is unavailable to this identity.', 404);
          return detail;
        };
        const event = (detail: PartnerDetail, event_type: string) => detail.events.unshift({ id: crypto.randomUUID(), event_type, created_at: timestamp });
        const touch = (detail: PartnerDetail) => { detail.partner.revision++; detail.partner.updated_at = timestamp; };
        const delivery = (status = 'completed'): PartnerDelivery => ({ id: crypto.randomUUID(), kind: 'email', status, attempts: status === 'completed' ? 1 : 0, created_at: timestamp, ...(status === 'completed' ? { finished_at: timestamp } : {}) });
        const requireEmail = () => { if (!emailConfigured) throw new ApiError('Synthetic partner email is disabled.', 503); };
        const supersede = (detail: PartnerDetail) => {
          for (const agreement of detail.agreements) if (['prepared', 'partner_signed'].includes(agreement.status)) { agreement.status = 'superseded'; agreement.revision++; event(detail, 'agreement.superseded'); }
          detail.partner.current_agreement_id = null; detail.partner.status = 'onboarding';
        };
        let response: unknown;
        if (['referral_summary', 'referral_list', 'link_state'].includes(action)) {
          const detail = getDetail(payload.partner_id);
          const partnerId = detail.partner.id;
          const link = work.links[partnerId] ?? null;
          const rows = work.referrals[partnerId] ?? [];
          if (action === 'link_state') {
            if (!link || detail.partner.status !== 'active') conflict('Only active partners have referral links.');
            revision(link!, payload);
            if (typeof payload.enabled !== 'boolean') throw new ApiError('Choose a referral link state.', 422);
            link!.status = payload.enabled ? 'active' : 'paused'; link!.revision++;
            event(detail, payload.enabled ? 'referral_link.resumed' : 'referral_link.paused');
          }
          if (action === 'referral_list') {
            const page = Number(payload.page ?? 1), pageSize = Number(payload.page_size ?? 25);
            if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ApiError('Invalid referral page.', 422);
            const items = [...rows].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || a.id.localeCompare(b.id));
            response = parsePartnerReferralList({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize });
          } else response = parsePartnerReferralSummary({ link, summary: { submitted_count: rows.length, purchased_count: rows.filter((row) => row.purchased_at !== null).length, refunded_count: rows.filter((row) => row.status === 'refunded').length, under_review_count: rows.filter((row) => row.status === 'under_review').length } });
        } else if (action === 'staff_list' || action === 'partner_list') {
          const page = Number(payload.page ?? 1), pageSize = Number(payload.page_size ?? 25);
          if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ApiError('Invalid page.', 422);
          const search = String(payload.search ?? '').toLowerCase();
          const items = work.partners.map((item) => item.partner).filter((partner) => (audience === 'staff' || partner.user_id === identity.id) && (!payload.status || payload.status === partner.status) && `${partner.business_name} ${partner.contact_email}`.toLowerCase().includes(search)).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
          response = parsePartnerList({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize });
        } else if (action === 'staff_get' || action === 'partner_get') response = parsePartnerDetail(getDetail(payload.partner_id));
        else if (action === 'template_list') response = { items: work.templates };
        else if (action === 'template_save' || action === 'template_publish') {
          let template = work.templates.find((item) => item.id === payload.template_id);
          if (payload.template_id && !template) throw new ApiError('Template unavailable.', 404);
          if (template) { revision(template, payload); if (template.status !== 'draft') conflict('Published demonstration versions are immutable.'); }
          if (action === 'template_save') {
            const title = required(payload, 'title');
            if (!Array.isArray(payload.sections) || payload.sections.length < 1 || payload.sections.length > 40) throw new ApiError('Provide agreement sections.', 422);
            const sections = payload.sections.map((item: unknown) => { if (!item || typeof item !== 'object') throw new ApiError('Invalid section.', 422); return { heading: required(item as Record<string, unknown>, 'heading'), body: required(item as Record<string, unknown>, 'body', 10000) }; });
            if (template) { Object.assign(template, { title, sections }); template.revision++; }
            else { template = { id: crypto.randomUUID(), revision: 1, title, sections, status: 'draft', created_at: timestamp }; work.templates.unshift(template); }
          } else { if (!template) throw new ApiError('Template required.', 422); template.status = 'published'; template.published_at = timestamp; template.revision++; }
          response = { template };
        } else if (action === 'staff_create') {
          const values = proposed(payload);
          const partner: ReferralPartner = { ...values, id: crypto.randomUUID(), revision: 1, currency: 'USD', status: 'onboarding', created_at: timestamp, updated_at: timestamp, user_id: null, current_agreement_id: null };
          const detail: PartnerDetail = { partner, invitations: [], agreements: [], events: [], invitation_deliveries: [] };
          event(detail, 'partner.created'); work.partners.unshift(detail); response = detail;
        } else if (action === 'invitation_get' || action === 'invitation_accept') {
          const detail = work.partners.find((item) => item.invitations.some((invitation) => invitation.id === payload.invitation_id));
          const invitation = detail?.invitations.find((item) => item.id === payload.invitation_id);
          if (!detail || !invitation || detail.partner.contact_email !== identity.email.toLowerCase()) throw new ApiError('Invitation unavailable for this verified email.', 404);
          if (invitation.revoked_at || ['revoked', 'superseded', 'expired'].includes(invitation.status) || (!invitation.accepted_at && Date.parse(invitation.expires_at) <= now())) conflict('This invitation expired or was replaced.');
          if (action === 'invitation_accept') {
            if (detail.partner.user_id && detail.partner.user_id !== identity.id) conflict('Another contact accepted this invitation.');
            if (!invitation.accepted_at) { invitation.status = 'accepted'; invitation.accepted_at = timestamp; detail.partner.user_id = identity.id; touch(detail); event(detail, 'invitation.accepted'); }
            response = detail;
          } else response = { partner: detail.partner, invitation };
        } else if (['sign', 'countersign', 'document_retry', 'email_retry'].includes(action)) {
          const detail = work.partners.find((item) => item.agreements.some((agreement) => agreement.id === payload.agreement_id));
          const agreement = detail?.agreements.find((item) => item.id === payload.agreement_id);
          if (!detail || !agreement || (audience === 'partner' && !owned(detail))) throw new ApiError('Agreement unavailable.', 404);
          revision(agreement, payload);
          if (action === 'sign' || action === 'countersign') {
            if (detail.partner.current_agreement_id !== agreement.id || payload.agreement_digest !== agreement.agreement_digest) conflict('Review the current frozen agreement.');
            if (!['electronic_consent', 'pdf_email_consent', 'authority_confirmed'].every((key) => payload[key] === true)) throw new ApiError('Every signing confirmation is required.', 422);
            const signature = { typed_legal_name: required(payload, 'typed_legal_name', 160), typed_title: action === 'sign' ? String(agreement.snapshot.contact_title) : required(payload, 'typed_title', 160), signed_at: timestamp, user_id: identity.id, verified_email: identity.email, electronic_consent: true, pdf_email_consent: true, authority_confirmed: true };
            if (action === 'sign') {
              if (agreement.status !== 'prepared' || detail.partner.status !== 'onboarding' || agreement.snapshot.contact_email !== identity.email.toLowerCase()) conflict();
              if (payload.typed_title !== undefined && payload.typed_title !== agreement.snapshot.contact_title) conflict('The title changed.');
              agreement.partner_signature = signature; agreement.status = 'partner_signed'; detail.partner.status = 'awaiting_approval'; event(detail, 'agreement.partner_signed');
            } else {
              if (agreement.status !== 'partner_signed' || detail.partner.status !== 'awaiting_approval' || detail.partner.user_id === identity.id) conflict();
              agreement.manager_signature = signature; agreement.status = 'countersigned'; detail.partner.status = 'active';
              agreement.document_status = 'ready'; agreement.document_available = true;
              agreement.deliveries = [delivery(emailConfigured ? 'completed' : 'review')];
              event(detail, 'agreement.countersigned'); event(detail, 'partner.activated'); event(detail, 'document.ready');
            }
            agreement.revision++; touch(detail);
          } else if (action === 'document_retry') {
            if (agreement.status !== 'countersigned' || agreement.document_status !== 'failed') conflict('Only failed PDF preparation can be retried.');
            agreement.document_status = 'ready'; agreement.document_available = true; agreement.deliveries = [...(agreement.deliveries ?? []), delivery(emailConfigured ? 'completed' : 'review')];
            event(detail, 'document.retry_requested'); event(detail, 'document.ready');
          } else {
            requireEmail();
            if (agreement.status !== 'countersigned' || agreement.document_status !== 'ready') conflict('The completed PDF must be ready before another copy can be sent.');
            agreement.deliveries = [...(agreement.deliveries ?? []), delivery()]; event(detail, 'agreement.copy_requested');
          }
          response = detail;
        } else {
          const detail = getDetail(payload.partner_id); const partner = detail.partner;
          revision(partner, payload);
          if (action === 'staff_edit') {
            if (partner.status === 'active') conflict('Active agreements cannot be amended in this preview.');
            const values = proposed(payload, partner);
            if (values.contact_email !== partner.contact_email) for (const invitation of detail.invitations) if (invitation.status === 'pending') { invitation.status = 'revoked'; invitation.revoked_at = timestamp; }
            supersede(detail); Object.assign(partner, values); event(detail, 'partner.edited');
          } else if (['invite', 'resend', 'revoke'].includes(action)) {
            if (partner.user_id || partner.status !== 'onboarding') conflict('The invitation was already accepted.');
            if (action === 'revoke') {
              const invitation = detail.invitations.find((item) => item.id === payload.invitation_id && item.status === 'pending');
              if (!invitation) conflict('No outstanding invitation.');
              invitation!.status = 'revoked'; invitation!.revoked_at = timestamp;
            } else {
              requireEmail();
              if (!work.templates.some((item) => item.status === 'published')) conflict('Publish a demonstration template before inviting.');
              if (action === 'invite' && detail.invitations.some((item) => item.status === 'pending' && Date.parse(item.expires_at) > now())) conflict('An invitation is already pending.');
              for (const invitation of detail.invitations) if (invitation.status === 'pending') { invitation.status = 'revoked'; invitation.revoked_at = timestamp; }
              const invitation: PartnerInvitation = { id: crypto.randomUUID(), status: 'pending', created_at: timestamp, expires_at: new Date(now() + 7 * 86_400_000).toISOString() };
              detail.invitations.unshift(invitation); detail.invitation_deliveries = [{ ...delivery(), invitation_id: invitation.id }, ...(detail.invitation_deliveries ?? [])];
            }
            event(detail, `invitation.${action}`);
          } else if (action === 'profile_save') {
            if (partner.status !== 'onboarding') conflict();
            const profile = Object.fromEntries(['legal_business_name', 'address_line1', 'city', 'state', 'postal_code', 'country', 'contact_name', 'contact_title'].map((key) => [key, required(payload, key)])) as unknown as PartnerProfile;
            profile.address_line2 = String(payload.address_line2 ?? '').trim();
            if (profile.country !== 'US' || !stateCodes.has(profile.state) || !/^\d{5}(?:-\d{4})?$/.test(profile.postal_code)) throw new ApiError('Provide a U.S. business address.', 422);
            supersede(detail); Object.assign(partner, profile); event(detail, 'partner.profile_saved');
          } else if (action === 'agreement_prepare') {
            if (partner.status !== 'onboarding') conflict();
            if (!['legal_business_name', 'address_line1', 'city', 'postal_code', 'contact_name', 'contact_title'].every((key) => partner[key as keyof ReferralPartner])) conflict('Complete the business profile first.');
            const template = [...work.templates].filter((item) => item.status === 'published').sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0];
            if (!template) conflict('Publish a template first.');
            if (!partner.current_agreement_id) {
              const frozen = snapshot(partner, template);
              const agreement: PartnerAgreement = { id: crypto.randomUUID(), revision: 1, snapshot: frozen, agreement_digest: await digest(frozen), status: 'prepared', created_at: timestamp, deliveries: [], document_status: 'pending', document_available: false };
              detail.agreements.unshift(agreement); partner.current_agreement_id = agreement.id; event(detail, 'agreement.prepared');
            }
          } else throw new ApiError('Unsupported synthetic operation.', 422);
          touch(detail); response = detail;
        }
        if (!read) { work.requests[requestKey] = { fingerprint, response: clone(response) }; state = addTracking(work, mode); persist(); }
        return clone(response) as T;
      });
    },
    async download(audience, token, agreementId) {
      await guard(audience, token);
      return serialized(async () => {
        refresh();
        const detail = state.partners.find((item) => item.agreements.some((agreement) => agreement.id === agreementId));
        const agreement = detail?.agreements.find((item) => item.id === agreementId);
        if (!detail || !agreement || (audience === 'partner' && detail.partner.user_id !== identity.id)) throw new ApiError('Synthetic agreement unavailable.', 404);
        if (agreement.status !== 'countersigned' || agreement.document_status !== 'ready' || !agreement.partner_signature || !agreement.manager_signature) conflict('The synthetic PDF is not ready.');
        if (!state.pdfs[agreementId]) { state.pdfs[agreementId] = Array.from(await renderPdf(agreement)); persist(); }
        return new Blob([Uint8Array.from(state.pdfs[agreementId])], { type: 'application/pdf' });
      });
    },
  };
}
