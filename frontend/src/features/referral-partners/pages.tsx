import { PartnerLinkSettings } from "./link-settings";
import { PartnerEarnings } from "./earnings";
import { adminPartnerPath, partnerWorkspacePath } from "./urls";
import { OutcomeReviewQueue } from "./outcome-review";
import { isOutcomeCommissionPolicy } from "./commission-policy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import venfourMark from "../../../../assets/brand/venfour-mark.svg";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";

import { useDocumentMetadata } from "@/app/document-metadata";
import { Button } from "@/components/ui/button";
import { SignInDialogProvider, useAuth } from "@/features/auth";
import { SignInPanel } from "@/features/auth/sign-in-dialog";

import { PartnerApproval } from "./partner-approval";
import { PartnerDashboard } from "./partner-dashboard";
import { BusinessProfileForm } from "./business-profile-form";
import { AgreementBusinessDetails, AgreementText, PartnerBusinessSummary, PartnerError, PartnerField, PartnerHistory, PartnerOnboardingProgress, PartnerState, RevisionNotice, SignatureForm } from "./components";
import { formatPartnerDate, formatPartnerMoney, partnerDeliveryLabel, partnerStatusLabel } from "./presentation";
import { ReferralTracking } from "./referral-tracking";
import { useReferralClock, useReferralAccess, useReferralDraft, useReferralIdentity, useReferralMutation, useReferralQuery } from "./hooks";
import { parsePartner, parsePartnerDetail, parsePartnerList, type AgreementTemplate, type PartnerDetail, type PartnerInvitation, type ReferralPartner } from "./service";

export function ReferralManagerGate() {
  const access = useReferralAccess("staff");
  if (access.isPending) return <PartnerState title="Checking partner-management access…" />;
  if (access.isError) return <PartnerState title="Partner management is unavailable"><PartnerError error={access.error} /><Button variant="outline" onClick={() => void access.refetch()}>Try again</Button></PartnerState>;
  if (!access.allowed) return <PartnerState title="This workspace is not available"><p>Referral partners are managed by designated Venfour partner managers.</p></PartnerState>;
  return <Outlet />;
}

export function PartnerWorkspace() {
  return <SignInDialogProvider><PartnerWorkspaceContent /></SignInDialogProvider>;
}

function PartnerWorkspaceContent() {
  const { auth, userId } = useReferralIdentity();
  const location = useLocation();
  const { signOut } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const requiresSignIn = location.pathname.replace(/\/$/u, "") !== partnerWorkspacePath().replace(/\/$/u, "");
  useDocumentMetadata({
    title: !userId && !requiresSignIn ? "Partner with Venfour | Venfour" : "Referral Partner Workspace | Venfour",
    description: !userId && !requiresSignIn ? "Learn how Venfour’s invitation-only referral partnership works." : "Private referral partner onboarding and agreements.",
  });
  const exit = async () => { setPending(true); setError(null); try { await signOut(); } catch (failure) { setError(failure); } finally { setPending(false); } };
  return <div className="partner-workspace"><header data-site-header className="partner-topbar"><Link to={partnerWorkspacePath()} className="partner-brand notranslate" aria-label="Venfour home" translate="no"><img src={venfourMark} width={28} height={28} alt="" aria-hidden data-brand-logo="venfour" /><span className="font-brand" data-brand-wordmark="venfour">Venfour</span></Link><nav aria-label="Partner navigation">{userId && <><Link className="partner-text-button" to={partnerWorkspacePath()}>Dashboard</Link><Link className="partner-text-button" to={partnerWorkspacePath("earnings")}>Earnings</Link></>}{userId && <Button variant="outline" disabled={pending} onClick={() => void exit()}>{pending ? "Signing out…" : "Sign out"}</Button>}</nav></header><main className="partner-page" id="main-content"><PartnerError error={error} />{auth.status === "loading" ? <PartnerState title="Checking your sign-in…" /> : auth.status === "unavailable" ? <PartnerState title="Sign in is temporarily unavailable"><p>Please try again later.</p></PartnerState> : !userId ? requiresSignIn ? <PartnerSignIn /> : <PartnerLandingPage /> : <Outlet key={userId} />}</main></div>;
}

function PartnerLandingPage() {
  return <section className="partner-landing" aria-labelledby="partner-landing-title">
    <p className="partner-invitation-eyebrow">Venfour for businesses</p>
    <h1 id="partner-landing-title">Help vehicle owners make sense of a total-loss valuation.</h1>
    <p className="partner-landing-lede">Give customers a clear, independent way to understand the insurer’s valuation and the evidence behind it.</p>
    <div className="partner-landing-actions"><Button asChild><Link to={partnerWorkspacePath("sign-in")}>Become a referral partner</Link></Button><Link className="partner-text-button" to={partnerWorkspacePath("sign-in")}>Already a partner? Sign in</Link></div>
    <div className="partner-landing-grid">
      <article><span>01</span><h2>Introduce</h2><p>Share Venfour with a customer who wants a clearer review of their total-loss valuation.</p></article>
      <article><span>02</span><h2>Track</h2><p>Use your private workspace to see submitted referrals and their purchase status.</p></article>
      <article><span>03</span><h2>Review terms</h2><p>Complete the invitation, business details, and agreement review before activation.</p></article>
    </div>
    <p className="partner-landing-note">The program is invitation-only and begins in Missouri. Your signed agreement controls the participation terms.</p>
  </section>;
}

function PartnerSignIn() {
  const location = useLocation();
  return <SignInPanel returnTo={`${location.pathname}${location.search}${location.hash}`} />;
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
  const accept = async () => { const result = await mutation.run("invitation_accept", { invitation_id: invitationId }); if (result !== undefined) void navigate(partnerWorkspacePath(), { replace: true }); };
  const expired = Date.parse(invitation.expires_at) <= now;
  return <section className="partner-invitation" aria-labelledby="partner-invitation-title">
    <header className="partner-invitation-intro">
      <p className="partner-invitation-eyebrow">Business partnership</p>
      <h1 id="partner-invitation-title">Welcome to Venfour.</h1>
      <p className="partner-invitation-business">{partner.business_name}</p>
      <p className="partner-invitation-description">Help your customers better understand their total-loss valuation.</p>
    </header>
    <dl className="partner-invitation-commission">
      <dt>Referral commission</dt>
      <dd><span>Review the complete commission terms before signing your agreement.</span></dd>
    </dl>
    <section className="partner-invitation-setup" aria-labelledby="partner-setup-title">
      <h2 id="partner-setup-title">Let’s set up your partnership</h2>
      <ol className="partner-invitation-steps">
        <li><span aria-hidden="true">01</span><div><h3>Confirm your business</h3><p>Add the details we’ll use in your agreement.</p></div></li>
        <li><span aria-hidden="true">02</span><div><h3>Review and sign</h3><p>Read the partnership terms and sign electronically.</p></div></li>
        <li><span aria-hidden="true">03</span><div><h3>Venfour approval</h3><p>We’ll review and countersign your agreement before activating your partnership.</p></div></li>
      </ol>
    </section>
    <div className="partner-invitation-action">
      {invitation.accepted_at ? <Button asChild><Link to={partnerWorkspacePath()}>Open partner workspace</Link></Button>
        : expired || invitation.revoked_at || ["revoked", "superseded", "expired"].includes(invitation.status)
          ? <p className="partner-note">This invitation is no longer available. Ask your Venfour contact for a new invitation.</p>
          : <Button disabled={mutation.pending} onClick={() => void accept()}>{mutation.pending ? "Continuing…" : "Accept invitation and continue"}</Button>}
      <PartnerError error={mutation.error} />
    </div>
    <dl className="partner-invitation-meta">
      <div><dt>Invited email</dt><dd>{partner.contact_email}</dd></div>
      <div><dt>Invitation expires</dt><dd>{formatPartnerDate(invitation.expires_at)}</dd></div>
    </dl>
  </section>;
}

export function PartnerDashboardPage({ earnings = false }: { earnings?: boolean }) {
  const query = useReferralQuery("partner", "partner_list", { page: 1, page_size: 25 }, parsePartnerList);
  if (query.isPending) return <PartnerState title="Opening your partner workspace…" />;
  if (query.isError) return <PartnerState title="Your partner workspace could not be opened"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  if (query.data.total === 1 && query.data.items[0]) return <PartnerRecordPage partnerId={query.data.items[0].id} earnings={earnings} />;
  return <><div className="partner-page-header"><h1>Your partner workspace</h1></div>{query.data.items.length ? query.data.items.map((partner) => <section className="partner-card" key={partner.id}><h2>{partner.business_name}</h2><p>{partnerStatusLabel(partner.status)}</p><Button asChild className="mt-4"><Link to={partner.url_slug ? partnerWorkspacePath(`businesses/${partner.url_slug}${earnings ? "/earnings" : ""}`) : `/partners/${partner.id}`}>View business and agreement</Link></Button></section>) : <section className="partner-card"><h2>Open your invitation to begin</h2><p>Use the invitation link Venfour emailed you. If you were invited at a different email address, sign out and use that address.</p></section>}</>;
}

export function PartnerDetailPage() {
  const { partnerId = "", partnerSlug } = useParams();
  return <PartnerRecordPage partnerId={partnerId} slug={partnerSlug} />;
}

export function PartnerBusinessEarningsPage() {
  const { partnerSlug } = useParams();
  return <PartnerRecordPage slug={partnerSlug} earnings />;
}

function PartnerRecordPage({ partnerId = "", slug, earnings = false }: { partnerId?: string; slug?: string; earnings?: boolean }) {
  const query = useReferralQuery("partner", slug ? "partner_resolve" : "partner_get", slug ? { slug } : { partner_id: partnerId }, parsePartnerDetail);
  if (query.isPending) return <PartnerState title="Loading your agreement…" />;
  if (query.isError) return <PartnerState title="This partner record is unavailable"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  if (earnings && query.data.partner.status === "active") return <><div className="partner-page-header"><div><h1>Your earnings</h1><p>{query.data.partner.business_name}</p></div></div><PartnerEarnings partnerId={query.data.partner.id} /><ReferralTracking partnerId={query.data.partner.id} audience="partner" presentation="dashboard" /></>;
  return <PartnerDetailContent key={query.data.partner.id} detail={query.data} />;
}

function PartnerDetailContent({ detail }: { detail: PartnerDetail }) {
  const [editing, setEditing] = useState(false);
  const current = detail.agreements.find((agreement) => agreement.status === "prepared");
  const onboarding = detail.partner.status === "onboarding";
  const showProfile = onboarding && (!current || editing);
  const previouslyShowingProfile = useRef(showProfile);
  const previousStatus = useRef(detail.partner.status);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if ((previouslyShowingProfile.current && !showProfile) || (previousStatus.current === "onboarding" && detail.partner.status === "awaiting_approval") || (previousStatus.current === "awaiting_approval" && detail.partner.status === "active")) {
      heading.current?.focus();
      heading.current?.scrollIntoView?.({ block: "start" });
    }
    previouslyShowingProfile.current = showProfile;
    previousStatus.current = detail.partner.status;
  }, [showProfile, detail.partner.status]);
  if (showProfile) return <>
    <BusinessProfileForm key={detail.partner.id} partner={detail.partner} onPrepared={() => setEditing(false)} onCancel={current ? () => setEditing(false) : undefined} />
    {detail.agreements.length > 0 && <PartnerHistory detail={detail} audience="partner" />}
  </>;
  if (current && onboarding) return <section className="partner-agreement-review" aria-labelledby="partner-agreement-review-title">
    <PartnerOnboardingProgress current={2} />
    <header className="partner-agreement-review-intro">
      <p className="partner-invitation-eyebrow">Step 2 of 3 · Agreement</p>
      <h1 id="partner-agreement-review-title" ref={heading} tabIndex={-1}>Review your agreement</h1>
      <p>Review the terms below, then add your signature.</p>
    </header>
    <section className="partner-agreement-review-summary" aria-labelledby="partner-agreement-details-title">
      <div className="partner-agreement-review-summary-heading">
        <h2 id="partner-agreement-details-title">Business details</h2>
        <button type="button" className="partner-text-button" aria-label="Edit business details" onClick={() => setEditing(true)}>Edit details</button>
      </div>
      <AgreementBusinessDetails agreement={current} />
    </section>
    <div className="partner-agreement-document"><AgreementText agreement={current} showBusinessDetails={false} /></div>
    <SignatureForm key={current.id} audience="partner" agreement={current} partnerId={detail.partner.id} presentation="plain" />
    <details className="partner-agreement-history-disclosure">
      <summary>Agreement history</summary>
      <PartnerHistory detail={detail} audience="partner" showHeading={false} />
    </details>
  </section>;
  if (detail.partner.status === "awaiting_approval") return <PartnerApproval key={detail.partner.current_agreement_id} detail={detail} headingRef={heading} />;
  if (detail.partner.status === "active") return <PartnerDashboard detail={detail} headingRef={heading} />;
  return <>
    <div className="partner-page-header"><div><h1 ref={heading} tabIndex={-1}>{detail.partner.business_name}</h1><p>{partnerStatusLabel(detail.partner.status)}</p></div>{!onboarding && <Link to={partnerWorkspacePath()} className="partner-text-button">Your workspace</Link>}</div>
    {!onboarding && <PartnerBusinessSummary detail={detail} />}

    {detail.agreements.length > 0 && <PartnerHistory detail={detail} audience="partner" />}
  </>;
}

export function AdminReferralPartnersPage() {
  const { userId } = useReferralIdentity();
  const access = useReferralAccess("staff");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useReferralQuery("staff", "staff_list", { page, page_size: 25, search }, parsePartnerList, access.allowed);
  return <div className="partner-page"><div className="partner-page-header"><div><h1>Referral partners</h1><p>Invite businesses, review their details, and complete their agreements.</p></div><Link to="/admin/referral-partners/templates" className="partner-text-button">Agreement templates</Link></div>{access.data && !access.data.email_configured && <p className="partner-note">Partner email delivery is not configured. You can prepare business records and templates; invitations cannot be sent yet.</p>}<CreatePartnerForm key={userId} /><section className="partner-card"><PartnerField label="Search businesses" value={search} onChange={(value) => { setSearch(value); setPage(1); }} /><PartnerError error={query.error} />{query.isPending ? <p>Loading partners…</p> : query.data && <><div className="partner-table-wrap"><table className="partner-table"><thead><tr><th>Business</th><th>Status</th><th>Agreement terms</th><th>Updated</th></tr></thead><tbody>{query.data.items.map((partner) => <tr key={partner.id}><td><Link to={adminPartnerPath(partner)}>{partner.business_name}</Link><small>{partner.contact_email}</small></td><td>{partnerStatusLabel(partner.status)}</td><td><Link to={adminPartnerPath(partner)}>View terms</Link></td><td>{formatPartnerDate(partner.updated_at)}</td></tr>)}</tbody></table></div>{!query.data.items.length && <p>No partners match this view.</p>}<div className="partner-actions mt-5"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={page * 25 >= query.data.total} onClick={() => setPage(page + 1)}>Next</Button></div></>}</section></div>;
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
  const submit = async (event: FormEvent) => { event.preventDefault(); const cents = commissionCents(draft.commission); if (cents === null) { setValidation("Enter a positive USD amount with at most two decimal places."); return; } setValidation(null); const result = await mutation.run<PartnerDetail>("staff_create", { business_name: draft.business_name, contact_email: draft.contact_email, state: draft.state, commission_amount_minor_units: cents }); if (result) { clear(); void navigate(adminPartnerPath(result.partner)); } };
  return <details className="partner-card"><summary className="partner-text-button">Add a referral partner</summary><form className="partner-form mt-5" onSubmit={(event) => void submit(event)}><div className="partner-form-grid"><PartnerField label="Business name" required value={draft.business_name} onChange={(business_name) => update({ ...draft, business_name })} /><PartnerField label="Contact email" type="email" required value={draft.contact_email} onChange={(contact_email) => update({ ...draft, contact_email })} /><PartnerField label="State" required value={draft.state} onChange={(state) => update({ ...draft, state: state.toUpperCase() })} maxLength={2} /><PartnerField label="Commission per qualifying purchase (USD)" required value={draft.commission} onChange={(commission) => update({ ...draft, commission })} /></div>{validation && <p role="alert" className="partner-error">{validation}</p>}<PartnerError error={mutation.error} /><Button disabled={mutation.pending} type="submit">{mutation.pending ? "Creating…" : "Create partner record"}</Button></form></details>;
}

export function AdminReferralPartnerPage() {
  const { partnerId = "", partnerSlug } = useParams();
  const access = useReferralAccess("staff");
  const query = useReferralQuery("staff", partnerSlug ? "staff_resolve" : "staff_get", partnerSlug ? { slug: partnerSlug } : { partner_id: partnerId }, parsePartnerDetail, access.allowed);
  if (query.isPending) return <PartnerState title="Loading referral partner…" />;
  if (query.isError) return <PartnerState title="This partner record is unavailable"><PartnerError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></PartnerState>;
  return <AdminPartnerRecord key={query.data.partner.id} detail={query.data} emailConfigured={access.data?.email_configured === true} />;
}

function AdminPartnerRecord({ detail, emailConfigured }: { detail: PartnerDetail; emailConfigured: boolean }) {
  const partner = detail.partner;
  const now = useReferralClock();
  const mutation = useReferralMutation("staff");
  const waiting = detail.agreements.find((agreement) => agreement.status === "partner_signed");
  return <div className="partner-page"><div className="partner-page-header"><div><h1>{partner.business_name}</h1><p>{partnerStatusLabel(partner.status)} · {partner.contact_email}</p></div><Link to="/admin/referral-partners" className="partner-text-button">All partners</Link></div><section className="partner-card"><dl className="partner-summary"><div><dt>Commission terms</dt><dd>{isOutcomeCommissionPolicy(detail.agreements.find((item) => item.id === partner.current_agreement_id)?.snapshot.commission_policy) ? "$50 / $75 per verified successful case" : `${formatPartnerMoney(partner.commission_amount_minor_units)} per qualifying purchase`}</dd></div><div><dt>State</dt><dd>{partner.state}</dd></div><div><dt>Contact</dt><dd>{partner.contact_name || "Not provided"}<br />{partner.contact_title}</dd></div><div><dt>Business address</dt><dd>{[partner.address_line1, partner.address_line2, partner.city, partner.state, partner.postal_code].filter(Boolean).join(", ") || "Not provided"}</dd></div></dl></section><PartnerLinkSettings key={partner.url_slug} partner={partner} />{partner.status !== "active" && <><EditPartnerForm partner={partner} outcomePolicy={isOutcomeCommissionPolicy(detail.agreements.find((item) => item.id === partner.current_agreement_id)?.snapshot.commission_policy)} /><section className="partner-card"><h2>Invitation</h2><p>Invitations expire after seven days. Resending replaces the previous invitation.</p>{!emailConfigured && <p className="partner-note">Configure partner email delivery before sending an invitation.</p>}<div className="partner-actions mt-4"><Button disabled={mutation.pending || !emailConfigured || Boolean(partner.user_id)} onClick={() => void mutation.run(detail.invitations.length ? "resend" : "invite", { partner_id: partner.id, expected_revision: partner.revision })}>{detail.invitations.length ? "Resend invitation" : "Send invitation"}</Button></div>{detail.invitations.map((invitation) => <div key={invitation.id} className="partner-history-row"><p>{partnerStatusLabel(invitation.status)} · expires {formatPartnerDate(invitation.expires_at)}</p>{!invitation.accepted_at && !invitation.revoked_at && Date.parse(invitation.expires_at) > now && <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run("revoke", { partner_id: partner.id, invitation_id: invitation.id, expected_revision: partner.revision })}>Revoke invitation</Button>}</div>)}<h3 className="mt-5">Invitation delivery</h3>{detail.invitation_deliveries?.length ? detail.invitation_deliveries.map((delivery) => <p key={delivery.id}>{partnerDeliveryLabel(delivery.status)} · {formatPartnerDate(delivery.finished_at ?? delivery.created_at)} · {delivery.attempts} attempts</p>) : <p>No invitation delivery yet.</p>}<PartnerError error={mutation.error} /></section></>}{waiting && <><section className="partner-card"><AgreementText agreement={waiting} /></section><SignatureForm key={waiting.id} audience="staff" agreement={waiting} partnerId={partner.id} /></>}{partner.status === "active" && <ReferralTracking key={partner.id} partnerId={partner.id} audience="staff" />}<OutcomeReviewQueue partnerId={partner.id} businessPath={adminPartnerPath(partner)} /><PartnerHistory detail={detail} audience="staff" /></div>;
}

function EditPartnerForm({ partner, outcomePolicy = false }: { partner: ReferralPartner; outcomePolicy?: boolean }) {
  const mutation = useReferralMutation("staff");
  const { draft, update, clear } = useReferralDraft(`edit.${partner.id}`, { business_name: partner.business_name, contact_email: partner.contact_email, state: partner.state ?? "MO", commission: (partner.commission_amount_minor_units / 100).toFixed(2), expected_revision: partner.revision });
  const [validation, setValidation] = useState<string | null>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); const cents = commissionCents(draft.commission); if (cents === null) { setValidation("Enter a positive USD amount with at most two decimal places."); return; } setValidation(null); const result = await mutation.run<PartnerDetail>("staff_edit", { partner_id: partner.id, expected_revision: draft.expected_revision, business_name: draft.business_name, ...(!partner.user_id ? { contact_email: draft.contact_email } : {}), state: draft.state, commission_amount_minor_units: cents }); if (result) { clear({ ...draft, expected_revision: result.partner.revision }); } };
  return <details className="partner-card"><summary className="partner-text-button">Edit proposed partner details</summary><form className="partner-form mt-5" onSubmit={(event) => void submit(event)}><div className="partner-form-grid"><PartnerField label="Business name" required value={draft.business_name} onChange={(business_name) => update({ ...draft, business_name })} /><PartnerField label="Contact email" required type="email" disabled={Boolean(partner.user_id)} value={draft.contact_email} onChange={(contact_email) => update({ ...draft, contact_email })} /><PartnerField label="State" required value={draft.state} onChange={(state) => update({ ...draft, state })} maxLength={2} />{!outcomePolicy && <PartnerField label="Commission (USD)" required value={draft.commission} onChange={(commission) => update({ ...draft, commission })} />}</div><p>{outcomePolicy ? "The tiered commission is defined by the agreement. Changing business details requires a new agreement for review." : "Changing proposed terms requires preparing and reviewing a new agreement before signing."}</p>{validation && <p role="alert" className="partner-error">{validation}</p>}<RevisionNotice changed={draft.expected_revision !== partner.revision} onUseLatest={() => update({ ...draft, expected_revision: partner.revision })}><p>Saved business: {partner.business_name}. {!outcomePolicy && <>Saved commission: {formatPartnerMoney(partner.commission_amount_minor_units)}.</>}</p></RevisionNotice><PartnerError error={mutation.error} /><Button disabled={mutation.pending || draft.expected_revision !== partner.revision} type="submit">Save proposed details</Button></form></details>;
}

function parseTemplates(value: unknown): { items: AgreementTemplate[] } {
  const row = value as { items?: AgreementTemplate[] };
  if (!Array.isArray(row.items) || row.items.some((item) => !item.id || typeof item.title !== "string" || !Array.isArray(item.sections))) throw new Error("Invalid agreement templates");
  return { items: row.items };
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
  const publish = async () => { if (!template || dirty || template.release_hold) return; const result = await mutation.run<{ template: AgreementTemplate }>("template_publish", { template_id: template.id, expected_revision: draft.expected_revision }); if (result) clear({ ...draft, expected_revision: result.template.revision }); };
  return <><form className="partner-card partner-form" onSubmit={(event) => void save(event)}><h2>{published ? "Published template" : "Draft agreement wording"}</h2>{template?.release_hold && <p role="status" className="partner-note">Owner-review draft. Publication and real signing are blocked until the commercial terms, customer-policy differences, regulated-partner approval, and commission operations have been reviewed.</p>}{published && <p>This published version is immutable. Create a new template to change future agreements.</p>}<RevisionNotice changed={Boolean(!published && template && draft.expected_revision !== template.revision)} onUseLatest={() => template && update({ ...draft, expected_revision: template.revision })}><p>Saved template: {template?.title}. Review its latest published or draft content before applying your entries.</p></RevisionNotice><PartnerField label="Agreement title" required disabled={published} value={draft.title} onChange={(title) => update({ ...draft, title })} />{draft.sections.map((section, index) => <div className="partner-template-section" key={index}><PartnerField label={`Section ${index + 1} heading`} required disabled={published} value={section.heading} onChange={(heading) => update({ ...draft, sections: draft.sections.map((item, position) => position === index ? { ...item, heading } : item) })} /><label className="partner-field"><span>Section {index + 1} wording *</span><textarea required disabled={published} value={section.body} maxLength={20000} onChange={(event) => update({ ...draft, sections: draft.sections.map((item, position) => position === index ? { ...item, body: event.target.value } : item) })} /></label>{!published && draft.sections.length > 1 && <button className="partner-text-button" type="button" onClick={() => update({ ...draft, sections: draft.sections.filter((_, position) => position !== index) })}>Remove section {index + 1}</button>}</div>)}{!published && <div className="partner-actions"><Button variant="outline" type="button" onClick={() => update({ ...draft, sections: [...draft.sections, { heading: "", body: "" }] })}>Add section</Button><Button type="submit" disabled={mutation.pending}>{mutation.pending ? "Saving…" : "Save draft"}</Button>{template && <Button variant="outline" type="button" disabled={mutation.pending || Boolean(dirty) || template.release_hold} onClick={() => void publish()}>Publish this version</Button>}</div>}<PartnerError error={mutation.error} /></form><section className="partner-card partner-agreement" aria-label="Agreement template preview"><h2>{draft.title || "Agreement preview"}</h2>{draft.sections.map((section, index) => <section key={index}><h3>{section.heading || `Section ${index + 1}`}</h3><p>{section.body || "Add approved wording above."}</p></section>)}</section></>;
}
