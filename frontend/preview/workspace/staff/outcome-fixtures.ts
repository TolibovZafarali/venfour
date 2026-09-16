import type { OutcomeReview } from '@/features/referral-partners/outcome-review-service';
export const reviewExampleId = '00076999-7000-4000-8000-000000000001';
export function seedOutcomeReview(now: string): OutcomeReview {
  const at = (days: number) => new Date(Date.parse(now) + days * 86400_000).toISOString();
  return { source_digest: 'a'.repeat(64), history: [], source: { case_id: '00077999-7000-4000-8000-000000000001', agreement_digest: 'b'.repeat(64), attributed_at: at(-40), paid_at: at(-35), payment_status: 'paid', refund_policy_version: 'demonstration-v1', payment_held: false, program_enabled: true, recorded: false, revision: 0, workflow: { phase: 'resolution', task: 'resolved', resolution: 'CUSTOMER_RECORDED', revision: 1 },
    documents: ['Baseline insurer offer', 'Final insurer value', 'Customer acceptance', 'Service and refund review'].map((name, n) => ({ id: `0007800${n}-7000-4000-8000-000000000001`, name: `${name} (fictional).pdf`, kind: 'review_evidence', digest: 'c'.repeat(64), sealed_at: at(-1), media_type: 'application/pdf' })) } };
}
export function evidenceLines(index: number, review: OutcomeReview) {
  const paid = review.source.paid_at!;
  return [
    ['Latest written insurer vehicle value: $20,000.00.', `Communicated: ${review.source.attributed_at}`, 'Vehicle value only; excludes taxes, fees and deductions.'],
    ['Final insurer vehicle value: $21,500.00.', 'The same underlying vehicle-value components are used.', `Final acceptance: ${review.source.documents[0].sealed_at}`],
    ['Fictional customer accepted the final value of $21,500.00.', `Acceptance recorded: ${review.source.documents[0].sealed_at}`],
    [`Paid service began: ${paid}`, 'Applicable review and reconsideration process completed.', 'Demonstration refund-policy review: no refund entitlement.', 'No relevant outcome dispute. Business is unregulated.', 'These are fictional review facts for local interaction testing.'],
  ][index] ?? [];
}
