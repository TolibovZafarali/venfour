import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { PartnerError } from "./components";
import { useReferralMutation } from "./hooks";
import { adminPartnerPath, referralHref, validPartnerSlug } from "./urls";
import type { PartnerDetail, ReferralPartner } from "./service";

export function PartnerLinkSettings({ partner }: { partner: ReferralPartner }) {
  const [slug, setSlug] = useState(partner.url_slug ?? "");
  const [saved, setSaved] = useState(false);
  const mutation = useReferralMutation("staff");
  const navigate = useNavigate();
  const valid = validPartnerSlug(slug);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!valid) return;
    const result = await mutation.run<PartnerDetail>("slug_update", { partner_id: partner.id, expected_revision: partner.revision, slug });
    if (result) { setSaved(true); void navigate(adminPartnerPath(result.partner), { replace: true }); }
  };
  return <form className="partner-card partner-form" onSubmit={event => void submit(event)}>
    <h2>Business link</h2><p>Choose a short name customers can recognize. Previous links will keep working for this business.</p>
    <label className="partner-field"><span>Link name</span><input value={slug} onChange={event => { setSlug(event.target.value); setSaved(false); }} required minLength={3} maxLength={63} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="partner-link-help" /></label>
    <p id="partner-link-help">Use lowercase letters, numbers and single hyphens. Start with a letter.</p>
    {valid && <p className="partner-link-preview">{referralHref(slug)}</p>}
    {partner.status !== "active" && <p>This link will attribute new reviews after your partnership is active.</p>}
    <PartnerError error={mutation.error} />{saved && <p role="status">Business link saved.</p>}
    <div className="partner-actions"><Button type="submit" disabled={!valid || mutation.pending || slug === partner.url_slug}>{mutation.pending ? "Saving…" : "Save link name"}</Button></div>
  </form>;
}
