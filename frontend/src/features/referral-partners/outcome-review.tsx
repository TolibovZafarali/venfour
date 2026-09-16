import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { PartnerError, PartnerField, PartnerState } from './components';
import { useReferralAccess, useReferralIdentity, useReferralMutation, useReferralQuery } from './hooks';
import { formatPartnerDate, formatPartnerMoney } from './presentation';
import { adminPartnerPath } from './urls';
import { parsePartnerDetail, referralPartnerService } from './service';
import { outcomeLabels, parseOutcomeQueue, parseOutcomeReview, type OutcomeDecision, type OutcomeReview } from './outcome-review-service';

export function OutcomeReviewQueue({ partnerId, businessPath = `/admin/referral-partners/${partnerId}` }: { partnerId: string; businessPath?: string }) {
  const access = useReferralAccess('staff');
  const [page, setPage] = useState(1);
  const query = useReferralQuery('staff', 'outcome_queue', { partner_id: partnerId, page }, parseOutcomeQueue, access.allowed);
  return <section className="partner-card" aria-labelledby="outcome-queue-heading"><h2 id="outcome-queue-heading">Case verification</h2><p>Review a referral’s evidence before adding earned commission.</p><PartnerError error={query.error} />
    {query.isPending ? <p>Loading reviews…</p> : query.data && <><div className="partner-table-wrap"><table className="partner-table"><thead><tr><th>Referral</th><th>Evidence</th><th>Payment</th><th>Review</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{query.data.items.map(row => <tr key={row.id}><td><span className="partner-reference">{row.id.slice(0, 8).toUpperCase()}</span><small>{formatPartnerDate(row.submitted_at)}</small></td><td>{row.document_count} documents</td><td>{!row.paid_at ? 'No purchase' : row.payment_held ? 'Needs review' : 'Retained'}</td><td>{outcomeLabels[row.decision]}</td><td><Link className="partner-text-button" to={`${businessPath}/outcomes/${row.id}`}>{row.decision === 'approved' ? 'View decision' : 'Review case'}</Link></td></tr>)}</tbody></table></div>{query.data.total === 0 && <p>No referrals to review yet.</p>}<div className="partner-actions"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={page * 25 >= query.data.total} onClick={() => setPage(page + 1)}>Next</Button></div></>}
    {query.isError && <Button variant="outline" onClick={() => void query.refetch()}>Reload reviews</Button>}
  </section>;
}

export function AdminOutcomeReviewPage() {
  const { partnerId = '', partnerSlug, attributionId = '' } = useParams();
  const access = useReferralAccess('staff');
  const business = useReferralQuery('staff', 'staff_resolve', { slug: partnerSlug }, parsePartnerDetail, access.allowed && Boolean(partnerSlug));
  if (partnerSlug) {
    if (business.isError) return <PartnerState title="Business unavailable"><PartnerError error={business.error} /></PartnerState>;
    if (!business.data) return <PartnerState title="Loading business…" />;
    return <OutcomeReviewRecord partnerId={business.data.partner.id} attributionId={attributionId} businessPath={adminPartnerPath(business.data.partner)} />;
  }
  return <OutcomeReviewRecord partnerId={partnerId} attributionId={attributionId} businessPath={`/admin/referral-partners/${partnerId}`} />;
}
function OutcomeReviewRecord({ partnerId, attributionId, businessPath }: { partnerId: string; attributionId: string; businessPath: string }) {
  const access = useReferralAccess('staff');
  const query = useReferralQuery('staff', 'outcome_get', { partner_id: partnerId, attribution_id: attributionId }, parseOutcomeReview, access.allowed);
  if (query.isPending) return <PartnerState title="Loading case review…" />;
  if (!query.data || query.isError) return <PartnerState title="Case review unavailable"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Reload review</Button></PartnerState>;
  return <ReviewForm key={`${partnerId}.${attributionId}`} partnerId={partnerId} attributionId={attributionId} review={query.data} businessPath={businessPath} reload={() => void query.refetch()} />;
}

const confirmations = [
  ['latest_written_baseline_confirmed', 'The baseline is the latest genuine written offer sent before paid service began.'],
  ['equivalent_vehicle_components_confirmed', 'Both amounts use the same vehicle-value components, excluding taxes, fees, deductions, and other compensation.'],
  ['insurer_evidence_verified', 'I reviewed the insurer’s documents and verified the final vehicle value.'],
  ['final_acceptance_verified', 'Retained evidence establishes the customer’s acceptance of the final value.'],
  ['process_completed', 'The applicable review and reconsideration process is complete.'],
  ['refund_rights_reviewed', 'I checked the applicable refund policy and retained review record. No automatic or outcome-guarantee refund is due.'],
  ['no_outcome_dispute', 'No relevant outcome dispute remains unresolved.'],
  ['unregulated_partner_confirmed', 'I checked this business’s activities. It is not a licensed or regulated referral partner.'],
] as const;
const documentFields = [['baseline_document_id', 'Baseline insurer offer'], ['final_document_id', 'Final insurer value'], ['acceptance_document_id', 'Customer acceptance'], ['review_document_id', 'Service, process, and refund review record']] as const;
const timeFields = [['baseline_communicated_at', 'Baseline communicated'], ['service_started_at', 'Paid service began'], ['accepted_at', 'Final value accepted']] as const;
function cents(value: string) { if (!/^\d+(\.\d{1,2})?$/.test(value)) return null; const [whole, part = ''] = value.split('.'); const n = Number(whole) * 100 + Number(part.padEnd(2, '0')); return Number.isSafeInteger(n) ? n : null; }

function ReviewError({ error }: { error: unknown }) {
  if (error instanceof ApiError && [400, 422].includes(error.status)) return <p role="alert" className="partner-error">Check the evidence and confirmations. The baseline must precede paid service, acceptance must follow service, and the matched vehicle-value increase must exceed $1,000.</p>;
  return <PartnerError error={error} />;
}

function ReviewForm({ partnerId, attributionId, review, reload, businessPath }: { businessPath: string; partnerId: string; attributionId: string; review: OutcomeReview; reload: () => void }) {
  const { token } = useReferralIdentity();
  const mutation = useReferralMutation('staff', false);
  const [sourceDigest, setSourceDigest] = useState(review.source_digest);
  const [decision, setDecision] = useState<OutcomeDecision>('needs_evidence');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const source = review.source, stale = sourceDigest !== review.source_digest;
  const baseline = cents(fields.baseline ?? ''), final = cents(fields.final ?? '');
  const increase = baseline !== null && final !== null ? final - baseline : null;
  const blocked = !source.program_enabled || source.payment_held || source.documents.length === 0;
  const approvalComplete = !blocked && increase !== null && increase > 100000 && confirmations.every(([k]) => checks[k]) && documentFields.every(([k]) => fields[k]) && timeFields.every(([k]) => fields[k]);
  const update = (key: string, value: string) => { setFields(old => ({ ...old, [key]: value })); setMessage(''); };
  const download = async (id: string) => {
    setDownloading(id); setDownloadError(null);
    try { const blob = await referralPartnerService.downloadEvidence(token, partnerId, attributionId, id); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Review-evidence-${id}.${blob.type === 'application/pdf' ? 'pdf' : blob.type === 'image/png' ? 'png' : 'jpg'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (error) { setDownloadError(error); } finally { setDownloading(null); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (stale || source.recorded || (decision === 'approved' && !approvalComplete)) return;
    const facts = decision === 'approved' ? { ...Object.fromEntries(documentFields.map(([k]) => [k, fields[k]])), ...Object.fromEntries(timeFields.map(([k]) => [k, new Date(fields[k]).toISOString()])), ...checks, baseline_vehicle_value_minor: baseline, final_vehicle_value_minor: final } : {};
    const result = await mutation.run<{ decision: OutcomeDecision }>('outcome_decide', { partner_id: partnerId, attribution_id: attributionId, source_digest: sourceDigest, decision, notes: notes.trim(), facts });
    if (result) { setMessage(result.decision === 'approved' ? 'Outcome approved. The commission is now recorded in the partner’s earnings.' : 'Decision saved. No commission was added.'); setNotes(''); reload(); }
  };
  return <div className="partner-page outcome-review-page"><div className="partner-page-header"><div><p className="outcome-eyebrow">CASE VERIFICATION · {attributionId.slice(0, 8).toUpperCase()}</p><h1>Review the outcome</h1><p>Establish the result from retained evidence, then record your decision.</p></div><Link className="partner-text-button" to={businessPath}>Back to business</Link></div>
    <section className="partner-card"><dl className="partner-summary"><div><dt>Payment</dt><dd>{!source.paid_at ? 'No qualifying purchase' : source.payment_held ? 'Needs review' : 'Retained'}<small>{source.paid_at && formatPartnerDate(source.paid_at)}</small></dd></div><div><dt>Commission program</dt><dd>{source.program_enabled ? 'Enabled' : 'Not enabled'}</dd></div><div><dt>Refund policy</dt><dd>{source.refund_policy_version ?? 'Unavailable'}</dd></div><div><dt>Case workflow</dt><dd>{source.workflow?.task.replaceAll('_', ' ') ?? 'Unavailable'}</dd></div></dl>{!source.program_enabled && <p className="partner-note">This agreement is not enabled for outcome-based commissions. You can retain a review decision; approval is unavailable.</p>}{source.payment_held && <p className="partner-note">A qualifying retained payment is required. Resolve payment, refund, or dispute issues before approval.</p>}</section>
    <div className="outcome-review-layout"><section className="partner-card outcome-evidence" aria-labelledby="evidence-heading"><h2 id="evidence-heading">Retained evidence</h2><p>Open the original documents. Customer statements alone do not establish a successful outcome.</p>{source.documents.length ? source.documents.map(doc => <div className="outcome-document" key={doc.id}><div><strong>{doc.name}</strong><small>{doc.kind.replaceAll('_', ' ')} · {formatPartnerDate(doc.sealed_at)}</small></div><Button variant="outline" disabled={downloading !== null} onClick={() => void download(doc.id)}>{downloading === doc.id ? 'Opening…' : 'Open document'}</Button></div>) : <p className="partner-note">No retained documents are available. Record what is missing below.</p>}<PartnerError error={downloadError} /><p className="partner-note">Evidence and review notes are private to authorized managers. Partners see only their referral and commission status.</p></section>
    <form className="partner-card partner-form" onSubmit={event => void submit(event)}><h2>{source.recorded ? 'Recorded outcome' : 'Your review'}</h2>{message && <p role="status" className="partner-note">{message}</p>}{source.recorded ? <p>This referral already has a recorded commission. Its original verification cannot be overwritten.</p> : <><label className="partner-field"><span>Decision</span><select value={decision} onChange={e => { setDecision(e.target.value as OutcomeDecision); setMessage(''); }}><option value="needs_evidence">Needs more evidence</option><option value="ineligible">Not eligible</option><option value="approved" disabled={blocked}>Approve successful outcome</option></select></label>
    {decision === 'approved' && <><div className="partner-form-grid"><PartnerField label="Baseline vehicle value (USD)" required value={fields.baseline ?? ''} onChange={v => update('baseline', v)} /><PartnerField label="Final accepted vehicle value (USD)" required value={fields.final ?? ''} onChange={v => update('final', v)} /></div><div className="outcome-increase"><span>Vehicle-value increase</span><strong>{increase === null ? 'Enter both values' : formatPartnerMoney(increase)}</strong><small>Must be greater than $1,000. Compare equivalent vehicle values.</small></div>{documentFields.map(([key, label]) => <label className="partner-field" key={key}><span>{label} *</span><select required value={fields[key] ?? ''} onChange={e => update(key, e.target.value)}><option value="">Select retained document</option>{source.documents.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>)}<p>Use the review record to support service timing, process completion, refund eligibility, and business classification.</p><div className="outcome-time-fields">{timeFields.map(([key, label]) => <PartnerField key={key} label={label} type="datetime-local" required value={fields[key] ?? ''} onChange={v => update(key, v)} />)}</div><small>Enter times in your local timezone. Approval time is recorded by the server.</small><fieldset className="outcome-checks"><legend>Evidence checks</legend>{confirmations.map(([key, label]) => <label key={key}><input type="checkbox" checked={checks[key] ?? false} onChange={e => setChecks(old => ({ ...old, [key]: e.target.checked }))} /><span>{label}</span></label>)}</fieldset><p className="partner-note">Regulated businesses need a separate compliance approval workflow. Keep those cases pending here.</p></>}
    <label className="partner-field"><span>{decision === 'needs_evidence' ? 'What evidence is missing?' : decision === 'ineligible' ? 'Why is this case ineligible?' : 'Evidence and decision rationale'} *</span><textarea required minLength={20} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder={decision === 'approved' ? 'Cite the document pages and explain timing, matched vehicle values, acceptance, refund rights, and business classification.' : 'Explain the decision and what would allow another review.'} /></label><small>This saves an internal decision. It does not send a message.</small>
    {stale && <p role="alert" className="partner-note">The record changed. Review the latest evidence above before using it. <button type="button" className="partner-text-button" onClick={() => { setSourceDigest(review.source_digest); setChecks({}); }}>Use latest record and recheck</button></p>}<ReviewError error={mutation.error} /><div className="partner-actions"><Button type="submit" disabled={mutation.pending || stale || notes.trim().length < 20 || (decision === 'approved' && !approvalComplete)}>{mutation.pending ? 'Saving…' : decision === 'approved' ? 'Approve and record commission' : 'Save review decision'}</Button><Button type="button" variant="outline" onClick={reload} disabled={mutation.pending}>Refresh record</Button></div></>}
    </form></div><section className="partner-card"><h2>Decision history</h2>{review.history.length === 0 ? <p>No review decisions yet.</p> : review.history.map(item => <div className="partner-history-row" key={item.revision}><h3>{outcomeLabels[item.decision]} · {formatPartnerDate(item.reviewed_at)}</h3><p className="outcome-notes">{item.notes}</p><small>Review {item.revision} · Reviewer {item.reviewer_id}</small>{item.decision === 'approved' && <details className="outcome-retained-facts"><summary className="partner-text-button">View verified facts</summary><dl className="partner-summary"><div><dt>Baseline vehicle value</dt><dd>{formatPartnerMoney(Number(item.facts.baseline_vehicle_value_minor))}</dd></div><div><dt>Final accepted vehicle value</dt><dd>{formatPartnerMoney(Number(item.facts.final_vehicle_value_minor))}</dd></div>{timeFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatPartnerDate(String(item.facts[key]))}</dd></div>)}{documentFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{source.documents.find(d => d.id === item.facts[key])?.name ?? String(item.facts[key])}</dd></div>)}</dl></details>}</div>)}</section></div>;
}
