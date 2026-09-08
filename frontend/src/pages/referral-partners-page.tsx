import { Link } from "react-router";

import {
  PublicPage,
  PublicPageSection,
  publicTextLinkClassName,
} from "@/pages/public-page";

export function ReferralPartnersPage() {
  return (
    <PublicPage
      eyebrow="Referral partners"
      title="Refer customers to Venfour"
      introduction="An invitation-only referral program for businesses that help vehicle owners after a total loss, beginning in Missouri."
      tone="methodology"
    >
      <PublicPageSection title="Help customers understand their valuation">
        <p>
          Venfour helps vehicle owners understand their insurer’s total-loss
          valuation, review independent market evidence, and prepare for a more
          informed discussion with their adjuster. As a referral partner, your
          role is to introduce customers who could benefit from that review.
        </p>
        <p>
          <Link to="/methodology" className={publicTextLinkClassName}>
            Learn how Venfour reviews valuations
          </Link>
          .
        </p>
      </PublicPageSection>

      <PublicPageSection title="Earn on qualifying purchases">
        <p>
          Your partner agreement provides the terms for earning a commission when a
          customer you refer completes a qualifying purchase. It specifies
          the commission amount, eligibility, and adjustments for refunds.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Receive manual payouts">
        <p>
          Eligible commissions will accumulate, and Venfour will pay you manually
          according to the schedule in your partner agreement.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Join by invitation">
        <p>
          Venfour invites selected businesses directly, beginning in Missouri.
          Open the invitation in your email to verify your contact address,
          provide your business details, and review your agreement.
        </p>
        <p>
          Once Venfour countersigns and activates your partnership, your workspace
          includes a referral link you can copy and share. Submitted reviews and
          purchase status appear there using private referral references.
        </p>
        <p>
          An active referral link automatically associates a newly created review
          with your business. Existing reviews keep their original referral
          status. A referral appears in your workspace after the customer submits
          their review details.
        </p>
        <p><Link to="/partners" className={publicTextLinkClassName}>Partner sign in</Link></p>
      </PublicPageSection>

      <PublicPageSection title="Your agreement and information">
        <p>This page explains the program. Your signed partner agreement sets the terms of your participation.</p>
        <p>Your signed agreement stays available in your partner workspace. After both parties sign, a completed PDF copy is also sent to your verified email address.</p>
        <p>Venfour uses your business and contact information to administer the partnership. Partners do not receive access to customers’ valuation reports, private documents, or claim details. Read our <Link to="/privacy" className={publicTextLinkClassName}>Privacy Policy</Link> for more information.</p>
      </PublicPageSection>
    </PublicPage>
  );
}
