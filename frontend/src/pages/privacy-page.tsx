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
      introduction="This page describes the current Venfour service in practical terms: what is processed when you use an account or request a valuation review, which outside services are involved, and what controls are not yet available."
      updated="Last updated August 18, 2026"
    >
      <PublicPageSection title="Information you provide">
        <p>
          To begin a total-loss appraisal, you can provide an insurance vehicle
          valuation report or manually enter vehicle and claim details such as
          the VIN, year, make, model, trim, mileage, ZIP code, date of loss,
          insurance company, and insurer vehicle valuation. Reports can include
          a vehicle identification number, claim or report references, loss and report
          dates, valuation amounts, condition information, dealer information,
          and comparable vehicle details. Please review your document before
          uploading it.
        </p>
        <p>
          You may sign in with Google or a passwordless email link so Venfour
          can restore your session and support saved appraisal cases. The
          separate legacy valuation-review upload still creates a unique
          analysis link and does not attach that analysis to your account.
          Treat the link as sensitive: anyone who obtains it may be able to
          view the analysis.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Account and case information">
        <p>
          Venfour uses Supabase to authenticate customers and store limited
          account, profile, and appraisal-case information. Depending on how
          you sign in, Supabase may process your email address and basic Google
          account information. Venfour stores only the application profile and
          case metadata needed to support the service.
        </p>
        <p>
          If you choose VIN lookup, Venfour sends the VIN to the National
          Highway Traffic Safety Administration’s vehicle-data service to
          identify the vehicle. If you prefer not to use VIN lookup, you can
          select the vehicle year, make, and model instead.
        </p>
        <p>
          Customer case records are protected by database access policies
          intended to restrict each signed-in customer to their own records.
          The authenticated total-loss start flow stores an uploaded insurance
          report in private case-file storage. The separate legacy valuation
          review flow still processes its PDF outside the saved customer case.
        </p>
      </PublicPageSection>

      <PublicPageSection title="How legacy report processing works">
        <p>
          The separate legacy valuation-review flow processes its uploaded
          report to identify and structure the vehicle, valuation, comparable,
          and adjustment information needed for the review. That document is
          sent to OpenAI, a third-party model provider, to assist with reading
          and structuring the report. Venfour then validates the resulting data
          before using it in the analysis. A report saved through the new
          authenticated total-loss start flow is not processed or analyzed yet.
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
          The authenticated total-loss start flow keeps its report in private
          case-file storage and does not analyze it yet. Before sign-in, manual
          intake information may be kept in essential browser storage so the
          same browser can restore the draft; PDF bytes are not stored there.
          The legacy valuation review instead uses a temporary local copy of the
          uploaded PDF, attempts to remove it when processing finishes, and
          requests removal of the uploaded copy from the model provider.
        </p>
        <p>
          Venfour retains the analysis-derived record so the results link can
          continue to work. Saved appraisal-case information and private case
          files are retained to support the customer flow. Account sessions and
          draft information may be retained in essential browser storage. The
          current service does not publish or enforce a fixed automatic
          deletion schedule and does not yet provide self-service account,
          case, file, or analysis deletion controls. If you are not comfortable
          with that current limitation, do not upload a report.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Security and practical limits">
        <p>
          Venfour uses technical controls intended to limit upload size, avoid
          storing the original PDF as part of the public analysis record,
          prevent credentials from being included in that record, and restrict
          account data and private case files by customer ownership. No internet
          service, transmission method, or storage system can be guaranteed
          completely secure.
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
              sent to{" "}
              <a
                href={`mailto:${supportEmail}`}
                className={publicTextLinkClassName}
              >
                {supportEmail}
              </a>
              .{" "}
            </>
          ) : (
            <>
              Venfour has not yet published a direct support address on this
              site.{" "}
            </>
          )}
          Venfour may update this notice as the service and its data practices
          change. The date at the top identifies the latest published version.
        </p>
      </PublicPageSection>
    </PublicPage>
  );
}
