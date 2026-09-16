import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { PartnerError, PartnerOnboardingProgress, RevisionNotice } from "./components";
import { useReferralDraft, useReferralMutation } from "./hooks";
import type { PartnerDetail, PartnerProfile, ReferralPartner } from "./service";

function businessProfile(partner: ReferralPartner): PartnerProfile {
  return {
    legal_business_name: partner.legal_business_name ?? partner.business_name,
    address_line1: partner.address_line1 ?? "", address_line2: partner.address_line2 ?? "",
    city: partner.city ?? "", state: partner.state ?? "MO", postal_code: partner.postal_code ?? "", country: "US",
    contact_name: partner.contact_name ?? "", contact_title: partner.contact_title ?? "",
  };
}

const fields = {
  legal_business_name: { label: "Legal business name", maxLength: 200, autoComplete: "organization" },
  address_line1: { label: "Street address", maxLength: 200, autoComplete: "address-line1" },
  address_line2: { label: "Suite / unit", maxLength: 200, autoComplete: "address-line2" },
  city: { label: "City", maxLength: 100, autoComplete: "address-level2" },
  state: { label: "State", maxLength: 2, autoComplete: "address-level1" },
  postal_code: { label: "ZIP code", maxLength: 10, autoComplete: "postal-code" },
  contact_name: { label: "Full name", maxLength: 160, autoComplete: "name" },
  contact_title: { label: "Your role", maxLength: 160, autoComplete: "organization-title" },
} as const;
type ProfileField = keyof typeof fields;

export function BusinessProfileForm({ partner, onPrepared, onCancel }: {
  partner: ReferralPartner;
  onPrepared: () => void;
  onCancel?: () => void;
}) {
  const save = useReferralMutation("partner");
  const prepare = useReferralMutation("partner");
  const savedProfile = businessProfile(partner);
  const { draft, update, clear } = useReferralDraft(`profile.${partner.id}`, {
    ...savedProfile, baseline: savedProfile, expected_revision: partner.revision,
  });
  const changed = draft.expected_revision !== partner.revision && JSON.stringify(draft.baseline) !== JSON.stringify(savedProfile);
  const expectedRevision = changed ? draft.expected_revision : partner.revision;
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [phase, setPhase] = useState<"saving" | "preparing" | null>(null);
  const checkpoint = useRef<{ profile: string; revision: number } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || changed) return;
    const profile = Object.fromEntries(Object.keys(savedProfile).map((key) => [key, draft[key as keyof PartnerProfile].trim()])) as unknown as PartnerProfile;
    const nextErrors: Partial<Record<ProfileField, string>> = {};
    for (const field of Object.keys(fields) as ProfileField[]) {
      if (field !== "address_line2" && !profile[field]) nextErrors[field] = `Enter ${fields[field].label.toLowerCase()}.`;
      else if (profile[field].length > fields[field].maxLength) nextErrors[field] = `Use ${fields[field].maxLength} characters or fewer.`;
    }
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      (form.current?.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus();
      return;
    }
    busy.current = true;
    try {
      const fingerprint = JSON.stringify(profile);
      let revision = checkpoint.current?.profile === fingerprint && checkpoint.current.revision === partner.revision
        ? checkpoint.current.revision : null;
      if (revision === null) {
        setPhase("saving");
        const result = await save.run<PartnerDetail>("profile_save", { ...profile, expected_revision: expectedRevision, partner_id: partner.id });
        if (!result || !mounted.current) return;
        const saved = businessProfile(result.partner);
        revision = result.partner.revision;
        clear({ ...saved, baseline: saved, expected_revision: revision });
        checkpoint.current = { profile: JSON.stringify(saved), revision };
      }
      setPhase("preparing");
      const result = await prepare.run<PartnerDetail>("agreement_prepare", { partner_id: partner.id, expected_revision: revision });
      if (result && mounted.current) onPrepared();
    } finally {
      busy.current = false;
      if (mounted.current) setPhase(null);
    }
  };

  const field = (name: ProfileField) => {
    const config = fields[name];
    const id = `business-${name}`;
    const error = errors[name];
    return <div className="partner-field">
      <label htmlFor={id}>{config.label}{name === "address_line2" ? <span className="business-profile-optional"> (optional)</span> : " *"}</label>
      <input id={id} name={name} value={draft[name]} required={name !== "address_line2"} maxLength={config.maxLength}
        autoComplete={config.autoComplete} disabled={phase !== null} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : name === "contact_title" ? `${id}-hint` : undefined}
        onChange={(event) => {
          update({ ...draft, [name]: name === "state" ? event.target.value.toUpperCase() : event.target.value });
          setErrors((previous) => ({ ...previous, [name]: undefined }));
        }} />
      {error && <p id={`${id}-error`} className="partner-error">{error}</p>}
      {name === "contact_title" && <p id={`${id}-hint`} className="business-profile-hint">For example, Owner or Manager.</p>}
    </div>;
  };

  return <section className="business-profile" aria-labelledby="business-profile-title">
    <PartnerOnboardingProgress current={1} />
    <header className="business-profile-intro">
      <p className="partner-invitation-eyebrow">Step 1 of 3 · Business details</p>
      <h1 id="business-profile-title">Confirm your business</h1>
      <p>These details will appear in your partnership agreement.</p>
    </header>
    <form ref={form} onSubmit={(event) => void submit(event)} noValidate aria-busy={phase !== null}>
      <fieldset><legend>Business name</legend>{field("legal_business_name")}</fieldset>
      <fieldset><legend>Business address</legend>
        {field("address_line1")}{field("address_line2")}
        <div className="business-profile-address">{field("city")}{field("state")}{field("postal_code")}</div>
      </fieldset>
      <fieldset><legend>Your details</legend>
        <div className="business-profile-contact">{field("contact_name")}{field("contact_title")}</div>
        <p className="business-profile-email">Verified email <span>{partner.contact_email}</span></p>
      </fieldset>
      <RevisionNotice changed={changed} onUseLatest={() => update({ ...draft, baseline: savedProfile, expected_revision: partner.revision })}>
        <p>Saved business: {partner.legal_business_name ?? partner.business_name}. Saved contact: {partner.contact_name ?? "Not provided"}.</p>
      </RevisionNotice>
      <div className="business-profile-feedback" aria-live="polite">
        <PartnerError error={save.error} />
        {Boolean(prepare.error) && <p>Your business details are saved. We couldn’t prepare your agreement. Try again below.</p>}
        <PartnerError error={prepare.error} />
      </div>
      <div className="business-profile-actions">
        <Button disabled={phase !== null || changed} type="submit">{phase === "saving" ? "Saving details…" : phase === "preparing" ? "Preparing agreement…" : "Save and review agreement"}</Button>
        {onCancel && <Button variant="ghost" disabled={phase !== null} type="button" onClick={onCancel}>Back to agreement</Button>}
      </div>
    </form>
  </section>;
}
