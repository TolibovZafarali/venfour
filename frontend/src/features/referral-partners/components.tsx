import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { useReferralDraft, useReferralIdentity, useReferralMutation } from "./hooks";
import { referralErrorMessage, referralPartnerService, type PartnerAgreement, type PartnerAudience, type PartnerDetail } from "./service";
import "./referral-partners.css";

import { formatPartnerDate, formatPartnerMoney, partnerDeliveryLabel, partnerEventLabel, partnerStatusLabel } from "./presentation";

export function PartnerState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="partner-state"><h1>{title}</h1>{children}</div>;
}
export function PartnerError({ error }: { error: unknown }) {
  return error ? <p role="alert" className="partner-error">{referralErrorMessage(error)}</p> : null;
}
export function RevisionNotice({ changed, children, onUseLatest }: { changed: boolean; children?: ReactNode; onUseLatest: () => void }) {
  return changed ? <div className="partner-note" role="status"><p>The saved record changed while this form was open. Your entries are preserved.</p>{children}<button type="button" className="partner-text-button" onClick={onUseLatest}>Keep my entries and use the latest record version</button></div> : null;
}
export function PartnerBusinessSummary({ detail }: { detail: PartnerDetail }) {
  const agreement = detail.agreements.find((item) => item.id === detail.partner.current_agreement_id)
    ?? detail.agreements.find((item) => item.status === (detail.partner.status === "active" ? "countersigned" : "partner_signed"));
  if (!agreement) return null;
  const snapshot = agreement.snapshot;
  return <section className="partner-card" aria-label="Agreed business details"><h2>Your partnership details</h2><dl className="partner-summary"><div><dt>Legal business name</dt><dd>{String(snapshot.legal_business_name ?? snapshot.business_name ?? "")}</dd></div><div><dt>Agreed commission per qualifying purchase</dt><dd>{typeof snapshot.commission_amount_minor_units === "number" ? formatPartnerMoney(snapshot.commission_amount_minor_units) : "See agreement"}</dd></div><div><dt>Verified contact email</dt><dd>{String(snapshot.contact_email ?? "")}</dd></div><div><dt>Contact</dt><dd>{String(snapshot.contact_name ?? "")}<br />{String(snapshot.contact_title ?? "")}</dd></div><div><dt>Business address</dt><dd>{[snapshot.address_line1, snapshot.address_line2, snapshot.city, snapshot.state, snapshot.postal_code, snapshot.country].filter((value) => typeof value === "string" && value).join(", ")}</dd></div></dl></section>;
}
export function PartnerField({ label, value, onChange, required, type = "text", disabled, maxLength = 200 }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; disabled?: boolean; maxLength?: number }) {
  return <label className="partner-field"><span>{label}{required ? " *" : ""}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} maxLength={maxLength} /></label>;
}
export function AgreementText({ agreement }: { agreement: PartnerAgreement }) {
  return <article className="partner-agreement" aria-label="Agreement for review">
    <h2>{agreement.snapshot.title}</h2>
    <dl className="partner-summary"><div><dt>Legal business name</dt><dd>{String(agreement.snapshot.legal_business_name ?? agreement.snapshot.business_name ?? "")}</dd></div><div><dt>Contact</dt><dd>{String(agreement.snapshot.contact_name ?? "")}<br />{String(agreement.snapshot.contact_title ?? "")}<br />{String(agreement.snapshot.contact_email ?? "")}</dd></div><div><dt>Business address</dt><dd>{[agreement.snapshot.address_line1, agreement.snapshot.address_line2, agreement.snapshot.city, agreement.snapshot.state, agreement.snapshot.postal_code, agreement.snapshot.country].filter((value) => typeof value === "string" && value).join(", ")}</dd></div>{typeof agreement.snapshot.commission_amount_minor_units === "number" && <div><dt>Commission per qualifying purchase</dt><dd>{formatPartnerMoney(agreement.snapshot.commission_amount_minor_units)}</dd></div>}</dl>
    {agreement.snapshot.sections.map((section, index) => <section key={index}><h3>{section.heading}</h3><p>{section.body}</p></section>)}
    {typeof agreement.snapshot.signing_statement === "string" && <p>{agreement.snapshot.signing_statement}</p>}
    <dl className="partner-summary">
      <div><dt>Agreement status</dt><dd>{partnerStatusLabel(agreement.status)}</dd></div>
      {agreement.partner_signature && <div><dt>Partner signature</dt><dd>{agreement.partner_signature.typed_legal_name}<br />{formatPartnerDate(agreement.partner_signature.signed_at)}</dd></div>}
      {agreement.manager_signature && <div><dt>Venfour signature</dt><dd>{agreement.manager_signature.typed_legal_name}<br />{formatPartnerDate(agreement.manager_signature.signed_at)}</dd></div>}
    </dl>
  </article>;
}

export function SignatureForm({ audience, agreement, onSuccess }: { audience: PartnerAudience; agreement: PartnerAgreement; partnerId: string; onSuccess?: () => void }) {
  const mutation = useReferralMutation(audience);
  const { draft, update, clear } = useReferralDraft(`signature.${audience}.${agreement.id}`, { typed_legal_name: "", typed_title: "", expected_revision: agreement.revision, agreement_digest: agreement.agreement_digest });
  const [consents, setConsents] = useState({ electronic_consent: false, pdf_email_consent: false, authority_confirmed: false });
  const stale = draft.agreement_digest !== agreement.agreement_digest || draft.expected_revision !== agreement.revision;
  const titleMatches = audience === "staff" || draft.typed_title.trim() === agreement.snapshot.contact_title;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stale || !titleMatches || !Object.values(consents).every(Boolean)) return;
    const { typed_title, ...signature } = draft;
    const result = await mutation.run(audience === "staff" ? "countersign" : "sign", { ...signature, ...(audience === "staff" ? { typed_title } : {}), ...consents, agreement_id: agreement.id });
    if (result !== undefined) { clear(); onSuccess?.(); }
  };
  return <form className="partner-card partner-form" onSubmit={(event) => void submit(event)}>
    <h2>{audience === "staff" ? "Countersign for Venfour" : "Sign your agreement"}</h2>
    <p>Review the complete agreement above. Your signature will be recorded with this version.</p>
    <div className="partner-form-grid"><PartnerField label="Full legal name" required value={draft.typed_legal_name} onChange={(typed_legal_name) => update({ ...draft, typed_legal_name })} /><PartnerField label="Title / capacity" required value={draft.typed_title} onChange={(typed_title) => update({ ...draft, typed_title })} /></div>
    {audience === "partner" && <p>Enter the title shown in your agreement: <strong>{String(agreement.snapshot.contact_title ?? "")}</strong>. Ask Venfour to revise the agreement if this is incorrect.</p>}
    {([
      ["electronic_consent", "I consent to use electronic records and signatures for this agreement."],
      ["pdf_email_consent", audience === "staff" ? "I confirm that the partner will receive the completed PDF by email and Venfour will retain a copy." : "I agree to receive a PDF copy of the completed agreement by email."],
      ["authority_confirmed", audience === "staff" ? "I am authorized to sign this agreement on behalf of Venfour." : "I am authorized to sign this agreement on behalf of this business."],
    ] as const).map(([key, label]) => <label className="partner-consent" key={key}><input type="checkbox" checked={consents[key]} onChange={(event) => setConsents({ ...consents, [key]: event.target.checked })} required /><span>{label}</span></label>)}
    {stale && <p role="alert" className="partner-error">The agreement changed. Review the latest version, then <button type="button" className="partner-text-button" onClick={() => { update({ ...draft, expected_revision: agreement.revision, agreement_digest: agreement.agreement_digest }); setConsents({ electronic_consent: false, pdf_email_consent: false, authority_confirmed: false }); }}>use this version</button>. Your entered name and title are preserved.</p>}
    <PartnerError error={mutation.error} />
    <Button disabled={mutation.pending || stale || !titleMatches || !Object.values(consents).every(Boolean)} type="submit">{mutation.pending ? "Saving signature…" : audience === "staff" ? "Countersign and activate" : "Agree and sign"}</Button>
  </form>;
}

function AgreementDownload({ audience, agreement }: { audience: PartnerAudience; agreement: PartnerAgreement }) {
  const { token, userId } = useReferralIdentity();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const activeIdentity = useRef(userId);
  useEffect(() => { activeIdentity.current = userId; return () => { activeIdentity.current = null; }; }, [userId]);
  const download = async () => {
    setPending(true); setError(null);
    try {
      const blob = await referralPartnerService.download(audience, token, agreement.id);
      if (!userId || activeIdentity.current !== userId) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "Referral_Partner_Agreement.pdf"; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (activeIdentity.current === userId) setError(failure); } finally { if (activeIdentity.current === userId) setPending(false); }
  };
  return <><Button variant="outline" disabled={pending} onClick={() => void download()}>{pending ? "Preparing download…" : "Download signed PDF"}</Button><PartnerError error={error} /></>;
}

export function PartnerHistory({ detail, audience }: { detail: PartnerDetail; audience: PartnerAudience }) {
  const mutation = useReferralMutation(audience);
  return <div className="partner-history">
    <section className="partner-card"><h2>Agreement history</h2>{detail.agreements.length === 0 ? <p>No agreement has been prepared yet.</p> : detail.agreements.map((agreement) => <details key={agreement.id} className="partner-history-row"><summary>{agreement.snapshot.title} · {partnerStatusLabel(agreement.status)}<span>{formatPartnerDate(agreement.created_at)}</span></summary><AgreementText agreement={agreement} />{agreement.status === "countersigned" && (agreement.document_status === "ready" || agreement.document_available ? <AgreementDownload audience={audience} agreement={agreement} /> : <p>{agreement.document_status === "failed" ? "The PDF could not be prepared. Venfour can retry its preparation." : "Your signed PDF is being prepared."} The signed agreement above remains available.</p>)}{audience === "staff" && agreement.document_status === "failed" && <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run("document_retry", { agreement_id: agreement.id, expected_revision: agreement.revision })}>Retry PDF preparation</Button>}{audience === "staff" && agreement.document_status === "ready" && <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run("email_retry", { agreement_id: agreement.id, expected_revision: agreement.revision })}>Email another PDF copy</Button>}{(agreement.deliveries ?? []).map((delivery) => <div key={delivery.id} className="partner-delivery"><p>Agreement email: {partnerDeliveryLabel(delivery.status)} · {formatPartnerDate(delivery.finished_at ?? delivery.created_at)}</p>{audience === "staff" && ["failed", "review"].includes(delivery.status) && <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run("email_retry", { agreement_id: agreement.id, expected_revision: agreement.revision })}>Retry email delivery</Button>}</div>)}</details>)}</section>
    {audience === "staff" && <section className="partner-card"><h2>Activity</h2>{detail.events.length ? <ul className="partner-activity">{detail.events.map((event) => <li key={event.id}><span>{partnerEventLabel(event.action ?? event.event_type ?? "")}</span><time>{formatPartnerDate(event.created_at)}</time></li>)}</ul> : <p>No activity yet.</p>}</section>}
    <PartnerError error={mutation.error} />
  </div>;
}
