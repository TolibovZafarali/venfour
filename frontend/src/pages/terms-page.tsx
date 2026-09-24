import { Link } from "react-router";

import {
  PublicPage,
  PublicPageSection,
  publicTextLinkClassName,
} from "@/pages/public-page";

export function TermsPage() {
  return (
    <PublicPage
      eyebrow="Terms of use"
      title="Terms for using Venfour"
      introduction="These terms describe Venfour’s current supported total-loss review and the present availability of its diminished-value service, including the important limits on what either service means."
      updated="Last updated September 15, 2026"
      tone="terms"
    >
      <PublicPageSection title="The service">
        <p>
          Venfour is operated by Venfour LLC. The full Total-Loss Review Package costs $199 per eligible case. By using Venfour, you agree to use the service within the boundaries
          described on this page.
        </p>
        <p>
          The automated total-loss service accepts supported insurer valuation
          reports from different providers or customer-confirmed vehicle and
          claim details without a report. It organizes available report facts,
          reviews relevant market evidence, and explains how that evidence
          compares with an insurer valuation or stated offer when one is
          available. A no-report result does not claim to review report-specific
          comparables or adjustments.
        </p>
        <p>
          Diminished Value remains part of Venfour, but new customer intake is
          currently paused while Venfour completes the Total Loss experience.
          Previously submitted requests and their supporting information remain
          stored for the manual-review purpose described when they were
          submitted. A diminished-value request does not generate an automated
          appraisal, complete an appraisal, schedule an appointment, or
          guarantee that a review will be available.
        </p>
        <p>
          Venfour is not an insurer, law firm, or government agency. Current
          results and review requests are not legal advice, a determination of
          legal entitlement, or a substitute for a formal appraisal when one is
          required.
        </p>
      </PublicPageSection>

      <PublicPageSection title="What the result does—and does not—mean">
        <p>
          A Venfour total-loss result is an evidence review, not a guaranteed
          settlement amount. An observed difference does not establish that an
          insurer owes a particular additional amount, acted improperly, or
          must change its valuation. Any previously submitted diminished-value
          request is a request for manual review, not a completed valuation
          result.
        </p>
        <p>
          Market listings usually show advertised prices rather than completed
          transaction prices. Listings, vehicle histories, report data, and
          other third-party information can be incomplete, delayed, changed, or
          inaccurate. Venfour does not guarantee that an insurer will accept any
          listing, analysis, or conclusion.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Refund protection">
        <p>
          The Total-Loss Review Package includes two separate refund protections.
          If our completed review finds no reasonable support for a valuation
          dispute, your purchase is refunded automatically and you retain access
          to the completed review and report. You do not need to submit a
          reconsideration request or obtain a final insurer response for that refund.
        </p>
        <p>
          As an additional right, if our review supports a dispute and you follow
          the Venfour-supported reconsideration process, you may request a full
          refund when your insurer’s final verified vehicle valuation increase is
          less than $1,000 compared with the valuation at purchase. This manual
          path requires supporting documentation and a request within 30 days
          after receiving the insurer’s final written response. You only need to
          satisfy the applicable path. See the{" "}
          <Link to="/refund-policy" className={`${publicTextLinkClassName} inline-block`}>
            Fair-Result Refund Policy
          </Link>{" "}
          for the eligibility requirements and request process. Neither
          protection guarantees a higher insurer valuation or settlement.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Your responsibilities">
        <p>
          Upload only reports, repair records, images, and other documents you
          are authorized to use. Provide accurate information and review any
          resulting evidence and limitations before relying on or sharing it.
          You remain responsible for decisions, communications, deadlines, and
          materials submitted to an insurer or another party.
        </p>
        <p>
          Do not use Venfour to upload unlawful or malicious material, interfere
          with the service, attempt unauthorized access, or consume service
          resources abusively.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Availability and outside services">
        <p>
          Authentication, report processing, market research, vehicle lookup,
          data storage, and email delivery can depend on outside services.
          Venfour may be delayed, unavailable, or unable to complete a supported
          review when those services or the information they supply are
          unavailable.
        </p>
        <p>
          The service may change as supported report formats, evidence sources,
          and product capabilities develop. Venfour does not promise
          uninterrupted access, that every valuation report can be analyzed, when
          diminished-value intake will reopen, or that every previously
          submitted diminished-value request will proceed to a completed
          appraisal.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Privacy and questions">
        <p>
          The{" "}
          <Link to="/privacy" className={publicTextLinkClassName}>
            Privacy Policy
          </Link>{" "}
          explains how the current service processes account, report,
          diminished-value, document, and analysis data.
          Questions about these terms can be raised through the{" "}
          <Link to="/contact" className={publicTextLinkClassName}>
            contact page
          </Link>
          . Venfour may revise these terms as the service changes; the date at
          the top identifies the latest published version.
        </p>
      </PublicPageSection>
    </PublicPage>
  );
}
