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
      introduction="These terms describe Venfour’s current supported total-loss review and diminished-value request intake, including the important limits on what either service means."
      updated="Last updated August 21, 2026"
    >
      <PublicPageSection title="The service">
        <p>
          By using Venfour, you agree to use the service within the boundaries
          described on this page.
        </p>
        <p>
          The automated total-loss service currently accepts an original CCC
          valuation report PDF. It organizes information from the report,
          reviews relevant market evidence, and explains how that evidence
          compares with the CCC adjusted vehicle value. Other report formats
          and no-report total-loss review are not currently supported.
        </p>
        <p>
          The diminished-value service currently accepts accident, repair,
          vehicle, contact, and supporting-document information for future
          manual review. Submitting that information does not generate an
          automated appraisal, complete an appraisal, schedule an appointment,
          or guarantee that a review will be available.
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
          must change its valuation. A diminished-value submission is a request
          for manual review, not a completed valuation result.
        </p>
        <p>
          Market listings usually show advertised prices rather than completed
          transaction prices. Listings, vehicle histories, report data, and
          other third-party information can be incomplete, delayed, changed, or
          inaccurate. Venfour does not guarantee that an insurer will accept any
          listing, analysis, or conclusion.
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
          uninterrupted access, that every CCC report can be analyzed, or that
          every diminished-value request will proceed to a completed appraisal.
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
