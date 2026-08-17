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
      introduction="These terms describe the current Venfour vehicle-valuation review service and the important limits on what its results mean."
      updated="Last updated August 17, 2026"
    >
      <PublicPageSection title="The service">
        <p>
          By using Venfour, you agree to use the service within the boundaries
          described on this page.
        </p>
        <p>
          Venfour provides informational vehicle-market analysis for people
          reviewing a CCC total-loss valuation report. It organizes information
          from the report, reviews relevant market evidence, and explains how
          that evidence compares with the CCC adjusted vehicle value.
        </p>
        <p>
          Venfour is not an insurer, law firm, or government agency. The current
          review is not legal advice and should not be represented as a formal
          appraisal or a determination of legal entitlement.
        </p>
      </PublicPageSection>

      <PublicPageSection title="What the result does—and does not—mean">
        <p>
          A Venfour result is an evidence review, not a guaranteed settlement
          amount. An observed difference does not establish that an insurer owes
          a particular additional amount, acted improperly, or must change its
          valuation.
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
          Upload only reports you are authorized to use. Review the resulting
          evidence and limitations before relying on it or sharing it. You
          remain responsible for decisions, communications, deadlines, and
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
          Report processing and market research depend on outside services,
          including model-processing and market-data providers. Venfour may be
          delayed, unavailable, or unable to complete a review when those
          services or the information they supply are unavailable.
        </p>
        <p>
          The service may change as supported report formats, evidence sources,
          and product capabilities develop. Venfour does not promise
          uninterrupted access or that every report can be analyzed.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Privacy and questions">
        <p>
          The{" "}
          <Link to="/privacy" className={publicTextLinkClassName}>
            Privacy Policy
          </Link>{" "}
          explains how the current service processes report and analysis data.
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
