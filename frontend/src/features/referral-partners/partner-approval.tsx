import { useRef, type Ref } from "react";

import { Button } from "@/components/ui/button";

import { AgreementText, PartnerHistory, PartnerOnboardingProgress, PartnerState } from "./components";
import { formatPartnerDate } from "./presentation";
import type { PartnerDetail } from "./service";

export function PartnerApproval({ detail, headingRef }: { detail: PartnerDetail; headingRef: Ref<HTMLHeadingElement> }) {
  const document = useRef<HTMLDetailsElement>(null);
  const documentHeading = useRef<HTMLHeadingElement>(null);
  const agreement = detail.agreements.find((item) => item.id === detail.partner.current_agreement_id && item.status === "partner_signed");
  if (!agreement?.partner_signature) return <PartnerState title="Your signed agreement is unavailable">
    <p>Reload this page to retrieve your latest agreement. If it remains unavailable, contact your Venfour representative.</p>
  </PartnerState>;

  const signature = agreement.partner_signature;
  const previousAgreements = detail.agreements.filter((item) => item.id !== agreement.id);
  const viewAgreement = () => {
    if (document.current) document.current.open = true;
    documentHeading.current?.focus({ preventScroll: true });
    documentHeading.current?.scrollIntoView?.({ block: "start" });
  };

  return <section className="partner-approval" aria-labelledby="partner-approval-title">
    <PartnerOnboardingProgress current={3} />
    <header className="partner-approval-intro">
      <p className="partner-invitation-eyebrow">Step 3 of 3 · Venfour approval</p>
      <h1 id="partner-approval-title" ref={headingRef} tabIndex={-1}>Your agreement is with Venfour.</h1>
      <p>Your signature is saved. We’ll review your business details and countersign before activating your partnership.</p>
    </header>

    <section className="partner-approval-receipt" aria-labelledby="partner-approval-receipt-title">
      <h2 id="partner-approval-receipt-title">Signature saved</h2>
      <p>Awaiting Venfour countersignature</p>
      <dl className="partner-summary">
        <div><dt>Legal business name</dt><dd>{String(agreement.snapshot.legal_business_name ?? agreement.snapshot.business_name ?? "")}</dd></div>
        <div><dt>Signed by</dt><dd>{signature.typed_legal_name}<span>{signature.typed_title ?? String(agreement.snapshot.contact_title ?? "")}</span></dd></div>
        <div><dt>Signed on</dt><dd><time dateTime={signature.signed_at}>{formatPartnerDate(signature.signed_at)}</time></dd></div>
        <div><dt>Verified email</dt><dd>{signature.verified_email ?? String(agreement.snapshot.contact_email ?? "")}</dd></div>
      </dl>
    </section>

    <section className="partner-approval-next" aria-labelledby="partner-approval-next-title">
      <h2 id="partner-approval-next-title">What happens next</h2>
      <ol className="partner-invitation-steps">
        <li><span aria-hidden="true">01</span><div><h3>We review your details</h3><p>Venfour reviews your business details and signed agreement.</p></div></li>
        <li><span aria-hidden="true">02</span><div><h3>Your partnership is activated</h3><p>Once approved, we countersign your agreement and activate your partner workspace.</p></div></li>
        <li><span aria-hidden="true">03</span><div><h3>You receive your completed copy</h3><p>The completed agreement will be available in your dashboard and emailed to your verified address.</p></div></li>
      </ol>
    </section>

    <Button className="partner-approval-action" aria-controls="partner-approval-document" onClick={viewAgreement}>View your signed agreement</Button>
    <details id="partner-approval-document" ref={document} className="partner-agreement-history-disclosure partner-approval-document">
      <summary>Signed agreement</summary>
      <div className="partner-agreement-document">
        <h2 ref={documentHeading} tabIndex={-1}>Your signed agreement</h2>
        <AgreementText agreement={agreement} />
      </div>
    </details>
    {previousAgreements.length > 0 && <details className="partner-agreement-history-disclosure">
      <summary>Agreement history</summary>
      <PartnerHistory detail={{ ...detail, agreements: previousAgreements }} audience="partner" showHeading={false} />
    </details>}
  </section>;
}
