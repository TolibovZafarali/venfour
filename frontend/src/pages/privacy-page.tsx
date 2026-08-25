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
      introduction="This page describes the current Venfour service in practical terms: what is stored when you use an account, start a supported total-loss review, or have a previously saved diminished-value request, and what controls are not yet available."
      updated="Last updated August 23, 2026"
      tone="privacy"
    >
      <PublicPageSection title="Information you provide">
        <p>
          For a total-loss review, you provide vehicle, mileage, location,
          condition, options, insurer, and loss information. You may also upload
          an insurer valuation report as a PDF or as ordered JPG/JPEG or PNG
          scan pages. A report can include claim or report references, dates,
          valuation amounts, dealer information, comparable vehicles, and
          adjustment details. Please review your document before uploading it.
        </p>
        <p>
          Diminished-value customer intake is currently paused. A request saved
          before that pause can include the accident state and date, repair
          status, VIN or selected year, make, and model, mileage,
          responsibility and insurer information, repair cost and facility,
          structural or airbag involvement, repair details, name, email, phone
          number, preferred contact method, availability, notes, and submitted
          supporting PDF or image documents.
        </p>
        <p>
          Venfour can create a hidden anonymous Supabase Auth session when you
          begin Total Loss intake so a private draft and upload have an isolated
          database owner without showing account setup first. Near the end,
          Venfour asks for your full name and email, the current Terms and
          Privacy acknowledgements, and a separate optional follow-up choice.
          The entered email is not treated as verified until you use the secure
          access link. After verification, the case is transferred to the
          matching authenticated account. A case or results identifier by
          itself is not authorization to view private information.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Account and case information">
        <p>
          Venfour uses Supabase to authenticate customers and store limited
          account, profile, and vehicle-review case information. Depending on
          how you sign in, Supabase may process your email address and basic
          Google account information. Your verified Supabase Auth email remains
          the account email identity. The application profile stores your
          confirmed full name, the versions and times of required
          acknowledgements, and your separately recorded optional operational
          follow-up preference.
        </p>
        <p>
          If you allow optional operational follow-up, Venfour may contact you
          about your case or service follow-up. That choice is separate from
          service-critical communication needed to provide something you
          request, and this notice does not treat it as SMS consent. Venfour
          does not collect a phone number through the current Total Loss
          profile flow.
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
          Total-loss reports and diminished-value supporting documents are kept
          in private case-file storage. When you start a total-loss value check,
          Venfour also stores case-owned processing state and the resulting
          analysis record. Authorized Venfour staff can inspect bounded
          customer identity, intake, report metadata, processing state,
          failures, and completed-run summary information for Total Loss cases.
          The operations workspace does not provide source-PDF viewing or
          download. Authorized staff can also access submitted diminished-value
          requests and their supporting documents for manual review; unrelated
          diminished-value drafts are not included in that staff scope.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Total-loss report and analysis handling">
        <p>
          A valuation report uploaded through the secure total-loss intake is
          normalized to an internal PDF and kept in private case-file storage.
          Venfour verifies the current case owner, retrieves the report through
          a server-controlled path, validates the PDF, and uses a temporary
          server copy while processing it.
        </p>
        <p>
          Provider detection and a known-provider or generic extraction path
          structure the report with help from a third-party model provider;
          Venfour then validates the normalized result and asks the customer to
          confirm or correct analysis-critical facts. A market-data provider is used to
          obtain market-listing and vehicle-history evidence before Venfour
          applies its deterministic analysis rules. The resulting validated
          analysis is linked to the appraisal case. The retired public web
          upload screen is not part of this customer path.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Diminished-value request handling">
        <p>
          New diminished-value customer intake is currently paused. Existing
          drafts, submitted requests, and supporting documents have not been
          deleted or changed solely because of that pause. A submitted request
          remains read-only to the customer so the reviewed record is not
          silently changed afterward.
        </p>
        <p>
          Authorized Venfour staff can list and read submitted
          diminished-value requests and download their submitted supporting
          documents for manual review. Draft requests are not included in that
          staff queue. The current form does not create an automated appraisal
          or schedule an appointment.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Analysis records">
        <p>
          Analysis-derived records can include the vehicle and ZIP code used
          for the search, an available insurer valuation or stated offer,
          report comparable details when supplied, selected external listings,
          evidence dates, calculations,
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
          Total-loss reports and diminished-value supporting documents remain
          in private case-file storage with their saved cases. Limited
          in-progress intake state may be kept in essential browser storage for
          recovery, but the authoritative Total Loss case belongs first to the
          isolated anonymous or permanent authenticated identity and is created
          or recovered before report selection or upload. A verified claim can
          transfer case ownership without moving or exposing the private file;
          document bytes are not stored in browser draft
          storage. During a total-loss value check, the server-generated temporary PDF
          copy is removed when processing ends, and removal of the uploaded
          model-provider copy is requested after extraction. The private
          case-file copy remains with the saved case.
        </p>
        <p>
          Venfour retains case-owned total-loss analysis records and submitted
          diminished-value requests so the current service can display or
          review them. Saved case information and private case files are
          retained to support these flows. Account sessions and draft
          information may be retained in essential browser storage. The current
          service does not publish or enforce a fixed automatic deletion
          schedule and does not yet provide self-service account, case, file,
          request, or retained-analysis deletion controls. If you are not
          comfortable with that current limitation, do not upload a report or
          supporting document.
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
          Do not upload documents unrelated to a supported vehicle review. Keep
          your sign-in methods and saved case links private.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Questions and updates">
        <p>
          {supportEmail ? (
            <>
              Questions about this notice or the handling of a report or
              diminished-value request can be
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
