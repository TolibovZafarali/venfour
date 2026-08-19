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
      introduction="This page describes the current Venfour service in practical terms: what is stored when you use an account or start an appraisal, how case-owned analysis records are handled, and what controls are not yet available."
      updated="Last updated August 19, 2026"
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
          can restore your session and support saved appraisal cases. A
          total-loss analysis created from the current intake is linked to the
          saved case and can be loaded only after Venfour verifies the signed-in
          account owns it. A results identifier or link by itself is not
          authorization to view an analysis.
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
          private case-file storage. When you start a value check, Venfour also
          stores case-owned processing state and the resulting analysis record.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Current report and analysis handling">
        <p>
          A report uploaded through the current authenticated total-loss intake
          is kept in private case-file storage. When you choose to start the
          value check, Venfour verifies the signed-in case owner, retrieves the
          report through a server-controlled path, validates the PDF, and uses a
          temporary server copy while processing it.
        </p>
        <p>
          The report is structured with help from a third-party model provider
          and then validated by Venfour. A market-data provider is used to
          obtain market-listing and vehicle-history evidence before Venfour
          applies its deterministic analysis rules. The resulting validated
          analysis is linked to the appraisal case. The retired public web
          upload screen is not part of this customer path.
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
          case-file storage. Before sign-in, manual intake information may be
          kept in essential browser storage so the same browser can restore the
          draft; PDF bytes are not stored there. During a value check, the
          server-generated temporary PDF copy is removed when processing ends,
          and removal of the uploaded model-provider copy is requested after
          extraction. The private case-file copy remains with the saved case.
        </p>
        <p>
          Venfour retains the case-owned analysis-derived record so the signed-in
          customer can return to the result. Saved appraisal-case information
          and private case files are retained to support the current customer
          flow. Account sessions and draft information may be retained in
          essential browser storage. The current service does not publish or
          enforce a fixed automatic deletion schedule and does not yet provide
          self-service account, case, file, or retained-analysis deletion
          controls. If you are not comfortable with that current limitation, do
          not upload a report.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Security and practical limits">
        <p>
          Venfour uses technical controls intended to limit upload size and
          restrict account data and private case files by customer ownership.
          The retained analysis artifact does not embed the original PDF or
          service credentials; the original PDF remains separately in private
          case-file storage. No internet service, transmission method, or
          storage system can be guaranteed completely secure.
        </p>
        <p>
          Do not upload documents unrelated to a vehicle valuation review. Keep
          your sign-in methods and saved appraisal links private.
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
