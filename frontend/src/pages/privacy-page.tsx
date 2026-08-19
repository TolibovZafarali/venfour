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
      introduction="This page describes the current Venfour service in practical terms: what is stored when you use an account or start an appraisal, how separate analysis records are handled, and what controls are not yet available."
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
          retired valuation-review flow created analyses with unique results
          links that were not attached to an account. Previously created
          analyses and analyses created through Venfour’s separate API may
          remain available. Treat a saved results link as sensitive: anyone who
          obtains it may be able to view the analysis.
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
          The current total-loss intake stores an uploaded insurance report in
          private case-file storage. That intake does not currently process the
          report or create an analysis from it.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Current report and analysis handling">
        <p>
          A report uploaded through the current authenticated total-loss intake
          is kept in private case-file storage. Venfour does not currently
          extract its contents, send it to a model provider, search external
          market sources, or create an analysis from that upload.
        </p>
        <p>
          The retired web upload screen is no longer available. When an
          analysis is created through Venfour’s separate API, the submitted
          report is structured with help from a third-party model provider and
          then validated by Venfour. A market-data provider is used to obtain
          market-listing and vehicle-history evidence. Those processing steps
          are not part of the current appraisal intake.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Analysis records">
        <p>
          Analysis-derived records can include the vehicle and ZIP code used
          for the search, the CCC adjusted vehicle value and comparable
          details, selected external listings, evidence dates, calculations,
          findings, limitations, and technical information used to make the
          result reproducible.
        </p>
        <p>
          Venfour uses retained records to display saved results, check the
          integrity of a stored analysis, troubleshoot service problems, and
          maintain the reliability of the product.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Storage and retention">
        <p>
          The authenticated total-loss start flow keeps its report in private
          case-file storage and does not analyze it yet. Before sign-in, manual
          intake information may be kept in essential browser storage so the
          same browser can restore the draft; PDF bytes are not stored there.
          For reports submitted to the separate analysis API, the original PDF
          is held temporarily, removal is attempted when processing finishes,
          and removal of the uploaded copy is requested from the model provider.
        </p>
        <p>
          Venfour retains the analysis-derived record so the results link can
          continue to work. Saved appraisal-case information and private case
          files are retained to support the current customer flow. Account
          sessions and draft information may be retained in essential browser
          storage. The current service does not publish or enforce a fixed
          automatic deletion schedule and does not yet provide self-service
          account, case, file, or retained-analysis deletion controls. If you
          are not comfortable with that current limitation, do not upload a
          report.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Security and practical limits">
        <p>
          Venfour uses technical controls intended to limit upload size and
          restrict account data and private case files by customer ownership.
          Retained analysis records do not include the original PDF or service
          credentials. No internet service, transmission method, or storage
          system can be guaranteed completely secure.
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
