import { environment } from "@/config/env";
import { ApiError, createApiClient } from "@/lib/api/client";

export type PartnerAudience = "staff" | "partner";
export interface ReferralAccess { is_partner_manager: boolean; is_partner: boolean; email_configured: boolean }
export interface PartnerProfile {
  legal_business_name: string; address_line1: string; address_line2: string;
  city: string; state: string; postal_code: string; country: string;
  contact_name: string; contact_title: string;
}
export interface ReferralPartner extends Partial<PartnerProfile> {
  id: string; revision: number; business_name: string; contact_email: string;
  commission_amount_minor_units: number; currency: string;
  status: "onboarding" | "awaiting_approval" | "active";
  created_at: string; updated_at: string; user_id?: string | null;
  current_agreement_id?: string | null;
}
export interface AgreementSection { heading: string; body: string }
export interface AgreementTemplate {
  id: string; revision: number; title: string; sections: AgreementSection[];
  status: "draft" | "published"; created_at: string; published_at?: string | null;
}
export interface PartnerAgreement {
  id: string; revision: number;
  snapshot: { title: string; sections: AgreementSection[]; [key: string]: unknown };
  status: string; agreement_digest: string; created_at: string;
  partner_signature?: { typed_legal_name: string; typed_title?: string; signed_at: string } | null;
  manager_signature?: { typed_legal_name: string; typed_title?: string; signed_at: string } | null;
  partner_signed_at?: string | null; countersigned_at?: string | null;
  typed_legal_name?: string | null; typed_title?: string | null;
  manager_typed_legal_name?: string | null; manager_typed_title?: string | null;
  document_status?: string; document_available?: boolean;
  commission_amount_minor_units?: number; currency?: string;
  deliveries?: PartnerDelivery[];
}
export interface PartnerInvitation { id: string; status: string; expires_at: string; created_at: string; accepted_at?: string | null; revoked_at?: string | null }
export interface PartnerEvent { id: string; action?: string; event_type?: string; created_at: string }
export interface PartnerDelivery { id: string; kind: string; status: string; attempts: number; created_at: string; finished_at?: string | null; error_code?: string | null }
export interface PartnerDetail { partner: ReferralPartner; invitations: PartnerInvitation[]; agreements: PartnerAgreement[]; events: PartnerEvent[]; deliveries?: PartnerDelivery[]; invitation_deliveries?: (PartnerDelivery & { invitation_id: string })[] }
export interface PartnerList { items: ReferralPartner[]; total: number; page: number; page_size: number }
export interface PartnerReferralLink { id: string; code: string; status: "active" | "paused"; revision: number; created_at: string }
export interface PartnerReferralSummary {
  link: PartnerReferralLink | null;
  summary: { submitted_count: number; purchased_count: number; refunded_count: number; under_review_count: number };
}
export interface PartnerReferral {
  id: string; submitted_at: string; purchased_at: string | null;
  status: "submitted" | "purchased" | "refunded" | "under_review";
}
export interface PartnerReferralList { items: PartnerReferral[]; total: number; page: number; page_size: number }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("The partner service returned an invalid response.", 502);
  return value as Record<string, unknown>;
}
function validId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function validSections(value: unknown): value is AgreementSection[] { return Array.isArray(value) && value.length > 0 && value.every((section) => section && typeof section === "object" && typeof section.heading === "string" && typeof section.body === "string"); }
export function parseReferralAccess(value: unknown): ReferralAccess {
  const row = record(value);
  if (typeof row.is_partner_manager !== "boolean" || typeof row.is_partner !== "boolean" || typeof row.email_configured !== "boolean") throw new ApiError("Partner access could not be verified.", 502);
  return row as unknown as ReferralAccess;
}
export function parsePartner(value: unknown): ReferralPartner {
  const row = record(value);
  if (!validId(row.id) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || typeof row.business_name !== "string" || typeof row.contact_email !== "string" || !Number.isSafeInteger(row.commission_amount_minor_units) || Number(row.commission_amount_minor_units) < 1 || row.currency !== "USD" || !["onboarding", "awaiting_approval", "active"].includes(String(row.status))) throw new ApiError("The partner record could not be verified.", 502);
  return row as unknown as ReferralPartner;
}
export function parsePartnerDetail(value: unknown): PartnerDetail {
  const row = record(value);
  const partner = parsePartner(row.partner);
  if (![row.invitations, row.agreements, row.events].every(Array.isArray)) throw new ApiError("The partner history could not be verified.", 502);
  for (const value of row.agreements as unknown[]) {
    const agreement = record(value); const snapshot = record(agreement.snapshot);
    if (!validId(agreement.id) || !Number.isSafeInteger(agreement.revision) || typeof agreement.agreement_digest !== "string" || !/^[0-9a-f]{64}$/.test(agreement.agreement_digest) || !["prepared", "partner_signed", "countersigned", "superseded"].includes(String(agreement.status)) || typeof snapshot.title !== "string" || !validSections(snapshot.sections) || snapshot.currency !== "USD" || !Number.isSafeInteger(snapshot.commission_amount_minor_units)) throw new ApiError("The agreement could not be verified.", 502);
    if (agreement.partner_id !== undefined && agreement.partner_id !== partner.id) throw new ApiError("The agreement is outside this partner record.", 502);
  }
  return { ...row, partner } as unknown as PartnerDetail;
}
export function parsePartnerList(value: unknown): PartnerList {
  const row = record(value);
  if (!Array.isArray(row.items) || !Number.isSafeInteger(row.total)) throw new ApiError("The partner list could not be verified.", 502);
  return { ...row, items: row.items.map(parsePartner) } as unknown as PartnerList;
}
function exactKeys(row: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))) throw new ApiError("The referral response could not be verified.", 502);
}
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function parsePartnerReferralSummary(value: unknown): PartnerReferralSummary {
  const row = record(value); exactKeys(row, ["link", "summary"]);
  const summary = record(row.summary);
  exactKeys(summary, ["submitted_count", "purchased_count", "refunded_count", "under_review_count"]);
  if (!Object.values(summary).every(validCount) || Number(summary.purchased_count) > Number(summary.submitted_count) || Number(summary.refunded_count) + Number(summary.under_review_count) > Number(summary.purchased_count)) throw new ApiError("The referral totals could not be verified.", 502);
  if (row.link !== null) {
    const link = record(row.link); exactKeys(link, ["id", "code", "status", "revision", "created_at"]);
    if (!validId(link.id) || typeof link.code !== "string" || !/^[0-9a-f]{48}$/.test(link.code) || !["active", "paused"].includes(String(link.status)) || !Number.isSafeInteger(link.revision) || Number(link.revision) < 1 || !validDate(link.created_at)) throw new ApiError("The referral link could not be verified.", 502);
  }
  return row as unknown as PartnerReferralSummary;
}
export function parsePartnerReferralList(value: unknown): PartnerReferralList {
  const row = record(value); exactKeys(row, ["items", "total", "page", "page_size"]);
  if (!Array.isArray(row.items) || !validCount(row.total) || !Number.isSafeInteger(row.page) || Number(row.page) < 1 || !Number.isSafeInteger(row.page_size) || Number(row.page_size) < 1 || Number(row.page_size) > 100 || row.items.length > Number(row.page_size) || row.items.length > Number(row.total)) throw new ApiError("The referral list could not be verified.", 502);
  const ids = new Set<string>();
  for (const value of row.items) {
    const item = record(value); exactKeys(item, ["id", "submitted_at", "purchased_at", "status"]);
    if (!validId(item.id) || ids.has(item.id) || !validDate(item.submitted_at) || (item.purchased_at !== null && !validDate(item.purchased_at)) || !["submitted", "purchased", "refunded", "under_review"].includes(String(item.status)) || ((item.status === "submitted") !== (item.purchased_at === null))) throw new ApiError("The referral record could not be verified.", 502);
    ids.add(item.id);
  }
  return row as unknown as PartnerReferralList;
}
export function partnerApiRoot(audience: PartnerAudience) { return audience === "staff" ? "/api/v1/staff/referral-partners" : "/api/v1/partners"; }
export function referralErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if ([401, 403].includes(error.status)) return "Your access could not be verified. Sign in with an authorized account.";
    if (error.status === 404) return "This invitation or partner record is not available to your account.";
    if (error.status === 409) return "This record changed or the action is no longer available. Your entries are preserved. Refresh the record before trying again.";
    if (error.status === 400 || error.status === 422) return "Check the required fields and agreement acknowledgements, then try again.";
  }
  return "We couldn’t complete this request. Your entries are preserved. Please try again.";
}
export function createReferralPartnerService(baseUrl = environment.apiBaseUrl, fetchImplementation?: typeof fetch) {
  const client = createApiClient({ baseUrl, fetchImplementation });
  const requireToken = (token: string) => { if (!token.trim()) throw new ApiError("Sign in is required.", 401); };
  return {
    async access(audience: PartnerAudience, accessToken: string, signal?: AbortSignal) {
      requireToken(accessToken);
      return parseReferralAccess(await client.getAuthenticated(`${partnerApiRoot(audience)}/access`, { accessToken, signal }));
    },
    async operation<T = unknown>(audience: PartnerAudience, accessToken: string, action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
      requireToken(accessToken);
      return client.postJson<T>(`${partnerApiRoot(audience)}/operations`, { action, payload }, { accessToken, signal });
    },
    async download(audience: PartnerAudience, accessToken: string, agreementId: string) {
      requireToken(accessToken);
      const path = `${partnerApiRoot(audience)}/agreements/${encodeURIComponent(agreementId)}/document`;
      const response = await (fetchImplementation ?? fetch)(baseUrl ? `${baseUrl}${path}` : new URL(path, window.location.origin), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" }, cache: "no-store" });
      if (!response.ok) throw new ApiError("The agreement could not be downloaded.", response.status);
      if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new ApiError("The agreement document could not be verified.", 502);
      const blob = await response.blob();
      if (blob.size === 0) throw new ApiError("The agreement document is empty.", 502);
      return blob;
    },
  };
}
export const referralPartnerService = createReferralPartnerService();
