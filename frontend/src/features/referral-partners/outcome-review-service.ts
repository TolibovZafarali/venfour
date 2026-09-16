import { ApiError } from '@/lib/api/client';
export type OutcomeDecision = 'approved' | 'needs_evidence' | 'ineligible';
export interface OutcomeQueue {
  total: number;
  items: { id: string; submitted_at: string; paid_at: string | null; decision: OutcomeDecision | 'unreviewed'; document_count: number; payment_held: boolean }[];
}
export interface OutcomeReview {
  source_digest: string;
  source: { case_id: string; agreement_digest: string; attributed_at: string; paid_at: string | null; payment_status: string | null; refund_policy_version: string | null;
    payment_held: boolean; program_enabled: boolean; recorded: boolean; revision: number;
    workflow: { phase: string; task: string; resolution: string | null; revision: number } | null;
    documents: { id: string; name: string; kind: string; digest: string; sealed_at: string; media_type: string }[] };
  history: { decision: OutcomeDecision; notes: string; reviewer_id: string; reviewed_at: string; revision: number; facts: Record<string, unknown> }[];
}
const isId = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(v);
const isDigest = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export const outcomeLabels = { approved: 'Approved', needs_evidence: 'Needs evidence', ineligible: 'Ineligible', unreviewed: 'Awaiting review' };
export function parseOutcomeQueue(value: unknown): OutcomeQueue {
  const v = value as OutcomeQueue;
  if (!v || !Number.isSafeInteger(v.total) || v.total < 0 || !Array.isArray(v.items) || v.items.length > 25 || v.items.some(r => !isId(r.id) || !(r.decision in outcomeLabels) || typeof r.payment_held !== 'boolean' || !Number.isSafeInteger(r.document_count))) throw new ApiError('Review queue unavailable.', 502);
  return v;
}
export function parseOutcomeReview(value: unknown): OutcomeReview {
  const v = value as OutcomeReview, s = v?.source;
  if (!s || !isDigest(v.source_digest) || !isId(s.case_id) || !isDigest(s.agreement_digest) || typeof s.program_enabled !== 'boolean' || typeof s.payment_held !== 'boolean' || typeof s.recorded !== 'boolean' || !Number.isSafeInteger(s.revision)
    || !Array.isArray(s.documents) || s.documents.some(d => !isId(d.id) || !isDigest(d.digest) || typeof d.name !== 'string')
    || !Array.isArray(v.history) || v.history.some(h => !(h.decision in outcomeLabels) || typeof h.notes !== 'string' || !isId(h.reviewer_id))) throw new ApiError('Review evidence unavailable.', 502);
  return v;
}
