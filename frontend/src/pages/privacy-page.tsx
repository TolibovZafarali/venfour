import { Link } from "react-router";

import { supportEmail } from "@/config/support";
import {
  PublicPage,
  PublicPageSection,
  publicTextLinkClassName,
} from "@/pages/public-page";

export function PrivacyPage() {
  return (
    <PublicPage
      eyebrow="Privacy"
      title="How Venfour handles your information"
      introduction="This page describes the current Venfour service in practical terms: what is processed when you request a valuation review, which outside services are involved, and what controls are not yet available."
      updated="Last updated August 17, 2026"
    >
      <PublicPageSection title="Information you provide">
        <p>
          To create a review, you provide a CCC vehicle valuation report and a
          ZIP code. Reports can include vehicle details, a vehicle
          identification number, claim or report references, loss and report
          dates, valuation amounts, condition information, dealer information,
          and comparable vehicle details. Please review your document before
          uploading it.
        </p>
        <p>
          Venfour does not currently require a traditional user account. The
          service creates a unique analysis link instead. Treat that link as
          sensitive: anyone who obtains it may be able to view the analysis.
        </p>
      </PublicPageSection>

      <PublicPageSection title="How report processing works">
        <p>
          Venfour processes the uploaded report to identify and structure the
          vehicle, valuation, comparable, and adjustment information needed for
          the review. The uploaded document is sent to OpenAI, a third-party
          model provider, to assist with reading and structuring the report.
          Venfour then validates the resulting data before using it in the
          analysis.
        </p>
        <p>
          The current service uses MarketCheck to obtain market-listing and
          vehicle-history evidence. Search criteria such as vehicle attributes,
          ZIP code, relevant dates, and candidate vehicle identifiers may be
          sent to that service as needed to perform the review.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Information created by an analysis">
        <p>
          Venfour creates analysis-derived records that can include the vehicle
          and ZIP code used for the search, the CCC adjusted vehicle value and
          comparable details, selected external listings, evidence dates,
          calculations, findings, limitations, and technical information used to
          make the result reproducible.
        </p>
        <p>
          Venfour uses this information to prepare and display the requested
          review, check the integrity of a stored analysis, troubleshoot service
          problems, and maintain the reliability of the product.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Storage and retention">
        <p>
          During the current request flow, Venfour uses a temporary local copy
          of the uploaded PDF and attempts to remove that copy when processing
          finishes. Venfour also requests removal of the uploaded copy from the
          model provider after processing. A removal attempt can fail, and each
          provider may process related service data under its own terms and
          policies.
        </p>
        <p>
          Venfour retains the analysis-derived record so the results link can
          continue to work. The current service does not publish or enforce a
          fixed automatic deletion schedule and does not yet provide
          account-based or self-service deletion controls. If you are not
          comfortable with that current limitation, do not upload a report.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Security and practical limits">
        <p>
          Venfour uses technical controls intended to limit upload size, avoid
          storing the original PDF as part of the analysis record, and prevent
          credentials from being included in that record. No internet service,
          transmission method, or storage system can be guaranteed completely
          secure.
        </p>
        <p>
          Do not upload documents unrelated to a vehicle valuation review. Do
          not share an analysis link more broadly than necessary.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Questions and updates">
        <p>
          {supportEmail ? (
            <>
              Questions about this notice or the handling of a report can be
              raised through the current{" "}
              <Link to="/contact" className={publicTextLinkClassName}>
                contact page
              </Link>
              .{" "}
            </>
          ) : (
            <>
              Venfour has not yet published a direct support address on this
              site. The{" "}
              <Link to="/contact" className={publicTextLinkClassName}>
                contact page
              </Link>{" "}
              reflects the current support status.{" "}
            </>
          )}
          Venfour may update this notice as the service and its data practices
          change. The date at the top identifies the latest published version.
        </p>
      </PublicPageSection>
    </PublicPage>
  );
}
