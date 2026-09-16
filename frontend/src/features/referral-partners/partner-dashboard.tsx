import { PartnerEarnings } from "./earnings";
import type { Ref } from "react";

import { AgreementDownload, AgreementText, PartnerHistory } from "./components";
import { formatPartnerDate } from "./presentation";
import { ReferralTracking } from "./referral-tracking";
import type { PartnerDetail } from "./service";

export function PartnerDashboard({ detail, headingRef }: { detail: PartnerDetail; headingRef: Ref<HTMLHeadingElement> }) {
  const agreement = detail.agreements.find((item) => item.id === detail.partner.current_agreement_id && item.status === "countersigned");
  const previousAgreements = detail.agreements.filter((item) => item.id !== agreement?.id);

  return <div className="partner-dashboard">
    <header className="partner-dashboard-intro">
      <div className="partner-dashboard-identity"><p>{detail.partner.business_name}</p><span>Partnership active</span></div>
      <h1 ref={headingRef} tabIndex={-1}>You’re ready to refer customers.</h1>
      <p>Help customers understand their insurer’s total-loss valuation with an independent review from Venfour.</p>
    </header>

    <PartnerEarnings partnerId={detail.partner.id} />

    <ReferralTracking partnerId={detail.partner.id} audience="partner" presentation="dashboard" />

    <section className="partner-dashboard-agreement" aria-labelledby="partner-dashboard-agreement-title">
      <div className="partner-dashboard-agreement-heading">
        <div><h2 id="partner-dashboard-agreement-title">Your agreement</h2>
          <p>{agreement?.manager_signature ? <>Completed {formatPartnerDate(agreement.manager_signature.signed_at)}</> : "Your partnership terms and signed documents."}</p>
        </div>
        {agreement && (agreement.document_status === "ready" || agreement.document_available) && <div className="partner-dashboard-download"><AgreementDownload audience="partner" agreement={agreement} /></div>}
      </div>
      {agreement ? <>
        {agreement.document_status !== "ready" && !agreement.document_available && <p className="partner-dashboard-document-status">{agreement.document_status === "failed" ? "The PDF could not be prepared. Venfour can retry its preparation." : "Your signed PDF is being prepared."} You can still read your completed agreement below.</p>}
        <details className="partner-dashboard-disclosure">
          <summary>Read completed agreement</summary>
          <AgreementText agreement={agreement} />
        </details>
      </> : <p className="partner-dashboard-document-status">Your completed agreement is unavailable. Reload this page or contact your Venfour representative.</p>}
      {previousAgreements.length > 0 && <details className="partner-agreement-history-disclosure partner-dashboard-disclosure">
        <summary>Agreement history</summary>
        <PartnerHistory detail={{ ...detail, agreements: previousAgreements }} audience="partner" showHeading={false} />
      </details>}
    </section>
  </div>;
}
