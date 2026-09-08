import { useState, type FormEvent } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";

import { useDocumentMetadata } from "@/app/document-metadata";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { formatEmailOtp, rawEmailOtp } from "@/features/auth/email-otp-input";

import { AgreementText, PartnerBusinessSummary, PartnerError, PartnerField, PartnerHistory, PartnerState, RevisionNotice, SignatureForm } from "./components";
import { formatPartnerDate, formatPartnerMoney, partnerDeliveryLabel, partnerStatusLabel } from "./presentation";
import { useReferralClock, useReferralAccess, useReferralDraft, useReferralIdentity, useReferralMutation, useReferralQuery } from "./hooks";
import { parsePartner, parsePartnerDetail, parsePartnerList, type AgreementTemplate, type PartnerDetail, type PartnerInvitation, type PartnerProfile, type ReferralPartner } from "./service";

export function ReferralManagerGate() {
  const access = useReferralAccess("staff");
  if (access.isPending) return <PartnerState title="Checking partner-management access…" />;
  if (access.isError) return <PartnerState title="Partner management is unavailable"><PartnerError error={access.error} /><Button variant="outline" onClick={() => void access.refetch()}>Try again</Button></PartnerState>;
  if (!access.allowed) return <PartnerState title="This workspace is not available"><p>Referral partners are managed by designated Venfour partner managers.</p></PartnerState>;
  return <Outlet />;
}

export function PartnerWorkspace() {
  const { auth, userId } = useReferralIdentity();
  const { signOut } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  useDocumentMetadata({ title: "Referral Partner Workspace | Venfour", description: "Private referral partner onboarding and agreements." });
  const exit = async () => { setPending(true); setError(null); try { await signOut(); } catch (failure) { setError(failure); } finally { setPending(false); } };
  return <div className="partner-workspace"><header className="partner-topbar"><Link to="/referral-partners">Venfour</Link><nav aria-label="Partner navigation"><Link to="/partners">Partner workspace</Link>{userId && <Button variant="outline" disabled={pending} onClick={() => void exit()}>{pending ? "Signing out…" : "Sign out"}</Button>}</nav></header><main className="partner-page" id="main-content"><PartnerError error={error} />{auth.status === "loading" ? <PartnerState title="Checking your sign-in…" /> : auth.status === "unavailable" ? <PartnerState title="Sign in is temporarily unavailable"><p>Please try again later.</p></PartnerState> : !userId ? <PartnerEmailSignIn /> : <Outlet key={userId} />}</main></div>;
}

function PartnerEmailSignIn() {
  const { sendEmailCode, completeEmailCode } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const send = async () => {
    if (pending) return;
    if (resendAt > Date.now()) { setError("Wait one minute before requesting another code."); return; }
    setPending(true); setError(null);
    try { await sendEmailCode(email.trim().toLowerCase(), { returnTo: location.pathname }); setEmail(email.trim().toLowerCase()); setSent(true); setCode(""); setResendAt(Date.now() + 60_000); }
    catch (failure) { setError(getFriendlyAuthError(failure, "send-code")); } finally { setPending(false); }
  };
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!sent) { await send(); return; } setPending(true); setError(null); try { await completeEmailCode(email, rawEmailOtp(code)); } catch (failure) { setError(getFriendlyAuthError(failure, "verify-code")); } finally { setPending(false); } };
  return <PartnerState title="Sign in to your partner workspace"><p>Use the email address that received your Venfour invitation. We’ll send a six-digit sign-in code.</p><form className="partner-card partner-form" onSubmit={(event) => void submit(event)}><PartnerField label="Invited email address" type="email" required value={email} onChange={setEmail} disabled={sent || pending} />{sent && <label className="partner-field"><span>Six-digit code</span><input autoComplete="one-time-code" inputMode="numeric" value={formatEmailOtp(code)} onChange={(event) => setCode(rawEmailOtp(event.target.value))} required maxLength={7} /></label>}{error && <p role="alert" className="partner-error">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "Please wait…" : sent ? "Verify and continue" : "Send sign-in code"}</Button>{sent && <div className="partner-actions"><button type="button" className="partner-text-button" disabled={pending} onClick={() => void send()}>Resend code</button><button type="button" className="partner-text-button" disabled={pending} onClick={() => { setSent(false); setCode(""); setError(null); setResendAt(0); }}>Use another email</button></div>}</form></PartnerState>;
}

export function PartnerInvitationPage() {
  const { invitationId = "" } = useParams();
  const navigate = useNavigate();
  const now = useReferralClock();
  const query = useReferralQuery("partner", "invitation_get", { invitation_id: invitationId }, (value) => {
    const row = value as { invitation: PartnerInvitation; partner: unknown };
    if (!row.invitation || typeof row.invitation.id !== "string") throw new Error("Invalid invitation");
    return { invitation: row.invitation, partner: parsePartner(row.partner) };
  });
  const mutation = useReferralMutation("partner");
  if (query.isPending) return <PartnerState title="Checking your invitation…" />;
  if (query.isError) return <PartnerState title="This invitation is not available"><PartnerError error={query.error} /><p>Use the email address invited by Venfour. If this invitation expired or was replaced, ask your Venfour contact for a new invitation.</p><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  const { invitation, partner } = query.data;
  const accept = async () => { const result = await mutation.run("invitation_accept", { invitation_id: invitationId }); if (result !== undefined) void navigate(`/partners/${partner.id}`, { replace: true }); };
  const expired = Date.parse(invitation.expires_at) <= now;
  return <><div className="partner-page-header"><div><h1>You’re invited to partner with Venfour</h1><p>{partner.business_name}</p></div></div><section className="partner-card"><h2>Continue your onboarding</h2><p>Confirm your business details, review your agreement, and sign electronically. Venfour will then review and countersign it.</p><dl className="partner-summary"><div><dt>Invited email</dt><dd>{partner.contact_email}</dd></div><div><dt>Proposed commission per qualifying purchase</dt><dd>{formatPartnerMoney(partner.commission_amount_minor_units)}</dd></div><div><dt>Invitation expires</dt><dd>{formatPartnerDate(invitation.expires_at)}</dd></div></dl>{invitation.accepted_at ? <Button asChild><Link to={`/partners/${partner.id}`}>Open partner workspace</Link></Button> : expired || invitation.revoked_at || ["revoked", "superseded", "expired"].includes(invitation.status) ? <p className="partner-note">This invitation is no longer available. Ask your Venfour contact for a new invitation.</p> : <Button disabled={mutation.pending} onClick={() => void accept()}>{mutation.pending ? "Continuing…" : "Accept invitation and continue"}</Button>}<PartnerError error={mutation.error} /></section></>;
}

export function PartnerDashboardPage() {
  const query = useReferralQuery("partner", "partner_list", { page: 1, page_size: 25 }, parsePartnerList);
  if (query.isPending) return <PartnerState title="Opening your partner workspace…" />;
  if (query.isError) return <PartnerState title="Your partner workspace could not be opened"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  return <><div className="partner-page-header"><h1>Your partner workspace</h1></div>{query.data.items.length ? query.data.items.map((partner) => <section className="partner-card" key={partner.id}><h2>{partner.business_name}</h2><p>{partnerStatusLabel(partner.status)}</p><Button asChild className="mt-4"><Link to={`/partners/${partner.id}`}>View business and agreement</Link></Button></section>) : <section className="partner-card"><h2>Open your invitation to begin</h2><p>Use the invitation link Venfour emailed you. If you were invited at a different email address, sign out and use that address.</p></section>}</>;
}

export function PartnerDetailPage() {
  const { partnerId = "" } = useParams();
  const query = useReferralQuery("partner", "partner_get", { partner_id: partnerId }, parsePartnerDetail);
  if (query.isPending) return <PartnerState title="Loading your agreement…" />;
  if (query.isError) return <PartnerState title="This partner record is unavailable"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  const detail = query.data;
  const current = detail.agreements.find((agreement) => agreement.status === "prepared");
  return <><div className="partner-page-header"><div><h1>{detail.partner.business_name}</h1><p>{partnerStatusLabel(detail.partner.status)}</p></div><Link to="/partners" className="partner-text-button">Your workspace</Link></div>{detail.partner.status !== "onboarding" && <PartnerBusinessSummary detail={detail} />}{detail.partner.status === "onboarding" && <ProfileForm key={detail.partner.id} partner={detail.partner} />}{!current && detail.partner.status === "onboarding" && <PreparePartnerAgreement partner={detail.partner} />}{current && detail.partner.status === "onboarding" && <><section className="partner-card"><AgreementText agreement={current} /></section><SignatureForm key={current.id} audience="partner" agreement={current} partnerId={partnerId} /></>}{detail.partner.status === "awaiting_approval" && <p className="partner-note">Your signature is saved. Venfour will review and countersign your agreement. You can read your signed agreement below.</p>}{detail.partner.status === "active" && <p className="partner-note">Your partner onboarding is complete. Your completed agreement is available below, and its PDF copy is sent by email. Referral links, tracking, and payouts will be added in a later release.</p>}<PartnerHistory detail={detail} audience="partner" /></>;
}

function ProfileForm({ partner }: { partner: ReferralPartner }) {
  const mutation = useReferralMutation("partner");
  const savedProfile = {
    legal_business_name: partner.legal_business_name ?? partner.business_name,
    address_line1: partner.address_line1 ?? "", address_line2: partner.address_line2 ?? "",
    city: partner.city ?? "", state: partner.state ?? "MO", postal_code: partner.postal_code ?? "", country: "US",
    contact_name: partner.contact_name ?? "", contact_title: partner.contact_title ?? "",
  };
  const { draft, update, clear } = useReferralDraft(`profile.${partner.id}`, { ...savedProfile, baseline: savedProfile, expected_revision: partner.revision });
  const changed = draft.expected_revision !== partner.revision && JSON.stringify(draft.baseline) !== JSON.stringify(savedProfile);
  const expectedRevision = changed ? draft.expected_revision : partner.revision;
  const [saved, setSaved] = useState(false);
  const fields: [keyof PartnerProfile, string, boolean][] = [["legal_business_name", "Legal business name", true], ["contact_name", "Contact full name", true], ["contact_title", "Title / capacity", true], ["address_line1", "Street address", true], ["address_line2", "Suite / unit", false], ["city", "City", true], ["state", "State", true], ["postal_code", "ZIP code", true]];
  const submit = async (event: FormEvent) => { event.preventDefault(); const profile = Object.fromEntries(Object.keys(savedProfile).map((key) => [key, draft[key as keyof typeof savedProfile]])); const result = await mutation.run<PartnerDetail>("profile_save", { ...profile, expected_revision: expectedRevision, partner_id: partner.id }); if (result) { clear({ ...draft, baseline: { ...savedProfile, ...profile } as typeof savedProfile, expected_revision: result.partner.revision }); setSaved(true); } };
  return <form className="partner-card partner-form" onSubmit={(event) => void submit(event)}><h2>Your business details</h2><p>Your verified contact email is {partner.contact_email}. These details will be included in your agreement.</p><div className="partner-form-grid">{fields.map(([field, label, required]) => <PartnerField key={field} label={label} value={draft[field]} required={required} onChange={(value) => { setSaved(false); update({ ...draft, [field]: value }); }} />)}</div><RevisionNotice changed={changed} onUseLatest={() => update({ ...draft, baseline: savedProfile, expected_revision: partner.revision })}><p>Saved business: {partner.legal_business_name ?? partner.business_name}. Saved contact: {partner.contact_name ?? "Not provided"}.</p></RevisionNotice><PartnerError error={mutation.error} />{saved && <p role="status">Business details saved. You can now review your agreement.</p>}<Button disabled={mutation.pending || changed} type="submit">{mutation.pending ? "Saving…" : "Save business details"}</Button></form>;
}

export function AdminReferralPartnersPage() {
  const { userId } = useReferralIdentity();
  const access = useReferralAccess("staff");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useReferralQuery("staff", "staff_list", { page, page_size: 25, search }, parsePartnerList, access.allowed);
  return <div className="partner-page"><div className="partner-page-header"><div><h1>Referral partners</h1><p>Invite businesses, review their details, and complete their agreements.</p></div><Link to="/admin/referral-partners/templates" className="partner-text-button">Agreement templates</Link></div>{access.data && !access.data.email_configured && <p className="partner-note">Partner email delivery is not configured. You can prepare business records and templates; invitations cannot be sent yet.</p>}<CreatePartnerForm key={userId} /><section className="partner-card"><PartnerField label="Search businesses" value={search} onChange={(value) => { setSearch(value); setPage(1); }} /><PartnerError error={query.error} />{query.isPending ? <p>Loading partners…</p> : query.data && <><div className="partner-table-wrap"><table className="partner-table"><thead><tr><th>Business</th><th>Status</th><th>Commission</th><th>Updated</th></tr></thead><tbody>{query.data.items.map((partner) => <tr key={partner.id}><td><Link to={`/admin/referral-partners/${partner.id}`}>{partner.business_name}</Link><small>{partner.contact_email}</small></td><td>{partnerStatusLabel(partner.status)}</td><td>{formatPartnerMoney(partner.commission_amount_minor_units)}</td><td>{formatPartnerDate(partner.updated_at)}</td></tr>)}</tbody></table></div>{!query.data.items.length && <p>No partners match this view.</p>}<div className="partner-actions mt-5"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={page * 25 >= query.data.total} onClick={() => setPage(page + 1)}>Next</Button></div></>}</section></div>;
}

function commissionCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [dollars, cents = ""] = value.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function CreatePartnerForm() {
  const { draft, update, clear } = useReferralDraft("create", { business_name: "", contact_email: "", state: "MO", commission: "" });
  const mutation = useReferralMutation("staff");
  const navigate = useNavigate();
  const [validation, setValidation] = useState<string | null>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); const cents = commissionCents(draft.commission); if (cents === null) { setValidation("Enter a positive USD amount with at most two decimal places."); return; } setValidation(null); const result = await mutation.run<PartnerDetail>("staff_create", { business_name: draft.business_name, contact_email: draft.contact_email, state: draft.state, commission_amount_minor_units: cents }); if (result) { clear(); void navigate(`/admin/referral-partners/${result.partner.id}`); } };
  return <details className="partner-card"><summary className="partner-text-button">Add a referral partner</summary><form className="partner-form mt-5" onSubmit={(event) => void submit(event)}><div className="partner-form-grid"><PartnerField label="Business name" required value={draft.business_name} onChange={(business_name) => update({ ...draft, business_name })} /><PartnerField label="Contact email" type="email" required value={draft.contact_email} onChange={(contact_email) => update({ ...draft, contact_email })} /><PartnerField label="State" required value={draft.state} onChange={(state) => update({ ...draft, state: state.toUpperCase() })} maxLength={2} /><PartnerField label="Commission per qualifying purchase (USD)" required value={draft.commission} onChange={(commission) => update({ ...draft, commission })} /></div>{validation && <p role="alert" className="partner-error">{validation}</p>}<PartnerError error={mutation.error} /><Button disabled={mutation.pending} type="submit">{mutation.pending ? "Creating…" : "Create partner record"}</Button></form></details>;
}

export function AdminReferralPartnerPage() {
  const { partnerId = "" } = useParams();
  const access = useReferralAccess("staff");
  const query = useReferralQuery("staff", "staff_get", { partner_id: partnerId }, parsePartnerDetail, access.allowed);
  if (query.isPending) return <PartnerState title="Loading referral partner…" />;
  if (query.isError) return <PartnerState title="This partner record is unavailable"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  return <AdminPartnerRecord key={query.data.partner.id} detail={query.data} emailConfigured={access.data?.email_configured === true} />;
}

function AdminPartnerRecord({ detail, emailConfigured }: { detail: PartnerDetail; emailConfigured: boolean }) {
  const partner = detail.partner;
  const now = useReferralClock();
  const mutation = useReferralMutation("staff");
  const waiting = detail.agreements.find((agreement) => agreement.status === "partner_signed");
  return <div className="partner-page"><div className="partner-page-header"><div><h1>{partner.business_name}</h1><p>{partnerStatusLabel(partner.status)} · {partner.contact_email}</p></div><Link to="/admin/referral-partners" className="partner-text-button">All partners</Link></div><section className="partner-card"><dl className="partner-summary"><div><dt>Commission per qualifying purchase</dt><dd>{formatPartnerMoney(partner.commission_amount_minor_units)}</dd></div><div><dt>State</dt><dd>{partner.state}</dd></div><div><dt>Contact</dt><dd>{partner.contact_name || "Not provided"}<br />{partner.contact_title}</dd></div><div><dt>Business address</dt><dd>{[partner.address_line1, partner.address_line2, partner.city, partner.state, partner.postal_code].filter(Boolean).join(", ") || "Not provided"}</dd></div></dl></section>{partner.status !== "active" && <><EditPartnerForm partner={partner} /><section className="partner-card"><h2>Invitation</h2><p>Invitations expire after seven days. Resending replaces the previous invitation.</p>{!emailConfigured && <p className="partner-note">Configure partner email delivery before sending an invitation.</p>}<div className="partner-actions mt-4"><Button disabled={mutation.pending || !emailConfigured || Boolean(partner.user_id)} onClick={() => void mutation.run(detail.invitations.length ? "resend" : "invite", { partner_id: partner.id, expected_revision: partner.revision })}>{detail.invitations.length ? "Resend invitation" : "Send invitation"}</Button></div>{detail.invitations.map((invitation) => <div key={invitation.id} className="partner-history-row"><p>{partnerStatusLabel(invitation.status)} · expires {formatPartnerDate(invitation.expires_at)}</p>{!invitation.accepted_at && !invitation.revoked_at && Date.parse(invitation.expires_at) > now && <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run("revoke", { partner_id: partner.id, invitation_id: invitation.id, expected_revision: partner.revision })}>Revoke invitation</Button>}</div>)}<h3 className="mt-5">Invitation delivery</h3>{detail.invitation_deliveries?.length ? detail.invitation_deliveries.map((delivery) => <p key={delivery.id}>{partnerDeliveryLabel(delivery.status)} · {formatPartnerDate(delivery.finished_at ?? delivery.created_at)} · {delivery.attempts} attempts</p>) : <p>No invitation delivery yet.</p>}<PartnerError error={mutation.error} /></section></>}{waiting && <><section className="partner-card"><AgreementText agreement={waiting} /></section><SignatureForm key={waiting.id} audience="staff" agreement={waiting} partnerId={partner.id} /></>}<PartnerHistory detail={detail} audience="staff" /></div>;
}

function EditPartnerForm({ partner }: { partner: ReferralPartner }) {
  const mutation = useReferralMutation("staff");
  const { draft, update, clear } = useReferralDraft(`edit.${partner.id}`, { business_name: partner.business_name, contact_email: partner.contact_email, state: partner.state ?? "MO", commission: (partner.commission_amount_minor_units / 100).toFixed(2), expected_revision: partner.revision });
  const [validation, setValidation] = useState<string | null>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); const cents = commissionCents(draft.commission); if (cents === null) { setValidation("Enter a positive USD amount with at most two decimal places."); return; } setValidation(null); const result = await mutation.run<PartnerDetail>("staff_edit", { partner_id: partner.id, expected_revision: draft.expected_revision, business_name: draft.business_name, ...(!partner.user_id ? { contact_email: draft.contact_email } : {}), state: draft.state, commission_amount_minor_units: cents }); if (result) { clear({ ...draft, expected_revision: result.partner.revision }); } };
  return <details className="partner-card"><summary className="partner-text-button">Edit proposed partner details</summary><form className="partner-form mt-5" onSubmit={(event) => void submit(event)}><div className="partner-form-grid"><PartnerField label="Business name" required value={draft.business_name} onChange={(business_name) => update({ ...draft, business_name })} /><PartnerField label="Contact email" required type="email" disabled={Boolean(partner.user_id)} value={draft.contact_email} onChange={(contact_email) => update({ ...draft, contact_email })} /><PartnerField label="State" required value={draft.state} onChange={(state) => update({ ...draft, state })} maxLength={2} /><PartnerField label="Commission (USD)" required value={draft.commission} onChange={(commission) => update({ ...draft, commission })} /></div><p>Changing proposed terms requires preparing and reviewing a new agreement before signing.</p>{validation && <p role="alert" className="partner-error">{validation}</p>}<RevisionNotice changed={draft.expected_revision !== partner.revision} onUseLatest={() => update({ ...draft, expected_revision: partner.revision })}><p>Saved business: {partner.business_name}. Saved commission: {formatPartnerMoney(partner.commission_amount_minor_units)}.</p></RevisionNotice><PartnerError error={mutation.error} /><Button disabled={mutation.pending || draft.expected_revision !== partner.revision} type="submit">Save proposed details</Button></form></details>;
}

function parseTemplates(value: unknown): { items: AgreementTemplate[] } {
  const row = value as { items?: AgreementTemplate[] };
  if (!Array.isArray(row.items) || row.items.some((item) => !item.id || typeof item.title !== "string" || !Array.isArray(item.sections))) throw new Error("Invalid agreement templates");
  return { items: row.items };
}

function PreparePartnerAgreement({ partner }: { partner: ReferralPartner }) {
  const mutation = useReferralMutation("partner");
  const complete = Boolean(partner.legal_business_name && partner.address_line1 && partner.city && partner.postal_code && partner.contact_name && partner.contact_title);
  return <section className="partner-card partner-form"><h2>Review your agreement</h2><p>Save your complete business details, then open the agreement prepared with your business details and proposed commission.</p><PartnerError error={mutation.error} /><Button disabled={!complete || mutation.pending} onClick={() => void mutation.run("agreement_prepare", { partner_id: partner.id, expected_revision: partner.revision })}>{mutation.pending ? "Preparing agreement…" : "Review agreement"}</Button></section>;
}

export function AdminAgreementTemplatesPage() {
  const access = useReferralAccess("staff");
  const query = useReferralQuery("staff", "template_list", {}, parseTemplates, access.allowed);
  const [selectedId, setSelectedId] = useState("new");
  const selected = query.data?.items.find((template) => template.id === selectedId);
  return <div className="partner-page"><div className="partner-page-header"><div><h1>Agreement templates</h1><p>Write approved agreement wording, review the preview, then publish an immutable version.</p></div><Link to="/admin/referral-partners" className="partner-text-button">Referral partners</Link></div><section className="partner-card"><label className="partner-field"><span>Template</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="new">New template</option>{query.data?.items.map((template) => <option value={template.id} key={template.id}>{template.title} · {partnerStatusLabel(template.status)}</option>)}</select></label><PartnerError error={query.error} /></section>{(selectedId === "new" || selected) && <TemplateEditor key={selectedId} template={selected} onSaved={setSelectedId} />}</div>;
}

function TemplateEditor({ template, onSaved }: { template?: AgreementTemplate; onSaved: (id: string) => void }) {
  const mutation = useReferralMutation("staff");
  const { draft, update, clear } = useReferralDraft(`template.${template?.id ?? "new"}`, { title: template?.title ?? "", sections: template?.sections ?? [{ heading: "", body: "" }], expected_revision: template?.revision ?? 0 });
  const published = template?.status === "published";
  const dirty = template && (draft.title !== template.title || JSON.stringify(draft.sections) !== JSON.stringify(template.sections));
  const save = async (event: FormEvent) => { event.preventDefault(); const result = await mutation.run<{ template: AgreementTemplate }>("template_save", { ...draft, ...(template ? { template_id: template.id } : {}) }); if (result) { clear({ ...draft, expected_revision: result.template.revision }); onSaved(result.template.id); } };
  const publish = async () => { if (!template || dirty) return; const result = await mutation.run<{ template: AgreementTemplate }>("template_publish", { template_id: template.id, expected_revision: draft.expected_revision }); if (result) clear({ ...draft, expected_revision: result.template.revision }); };
  return <><form className="partner-card partner-form" onSubmit={(event) => void save(event)}><h2>{published ? "Published template" : "Draft agreement wording"}</h2>{published && <p>This published version is immutable. Create a new template to change future agreements.</p>}<RevisionNotice changed={Boolean(!published && template && draft.expected_revision !== template.revision)} onUseLatest={() => template && update({ ...draft, expected_revision: template.revision })}><p>Saved template: {template?.title}. Review its latest published or draft content before applying your entries.</p></RevisionNotice><PartnerField label="Agreement title" required disabled={published} value={draft.title} onChange={(title) => update({ ...draft, title })} />{draft.sections.map((section, index) => <div className="partner-template-section" key={index}><PartnerField label={`Section ${index + 1} heading`} required disabled={published} value={section.heading} onChange={(heading) => update({ ...draft, sections: draft.sections.map((item, position) => position === index ? { ...item, heading } : item) })} /><label className="partner-field"><span>Section {index + 1} wording *</span><textarea required disabled={published} value={section.body} maxLength={20000} onChange={(event) => update({ ...draft, sections: draft.sections.map((item, position) => position === index ? { ...item, body: event.target.value } : item) })} /></label>{!published && draft.sections.length > 1 && <button className="partner-text-button" type="button" onClick={() => update({ ...draft, sections: draft.sections.filter((_, position) => position !== index) })}>Remove section {index + 1}</button>}</div>)}{!published && <div className="partner-actions"><Button variant="outline" type="button" onClick={() => update({ ...draft, sections: [...draft.sections, { heading: "", body: "" }] })}>Add section</Button><Button type="submit" disabled={mutation.pending}>{mutation.pending ? "Saving…" : "Save draft"}</Button>{template && <Button variant="outline" type="button" disabled={mutation.pending || Boolean(dirty)} onClick={() => void publish()}>Publish this version</Button>}</div>}<PartnerError error={mutation.error} /></form><section className="partner-card partner-agreement" aria-label="Agreement template preview"><h2>{draft.title || "Agreement preview"}</h2>{draft.sections.map((section, index) => <section key={index}><h3>{section.heading || `Section ${index + 1}`}</h3><p>{section.body || "Add approved wording above."}</p></section>)}</section></>;
}
