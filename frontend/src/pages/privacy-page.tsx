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
      introduction="This page describes the current Venfour service in practical terms: what is stored when you use an account, start a supported total-loss review, or submit a diminished-value request, and what controls are not yet available."
      updated="Last updated August 21, 2026"
    >
      <PublicPageSection title="Information you provide">
        <p>
          To begin the currently supported total-loss review, you provide a ZIP
          code and an original CCC valuation report PDF. The report can include
          a vehicle identification number, vehicle and mileage information,
          claim or report references, loss and report dates, valuation amounts,
          condition information, dealer information, comparable vehicles, and
          adjustment details. Please review your document before uploading it.
        </p>
        <p>
          A diminished-value request can include the accident state and date,
          repair status, VIN or selected year, make, and model, mileage,
          responsibility and insurer information, repair cost and facility,
          structural or airbag involvement, repair details, your name, email,
          phone number, preferred contact method, availability, notes, and any
          supporting PDF or image documents you choose to provide.
        </p>
        <p>
          You may sign in with Google or a passwordless email link so Venfour
          can restore your session and support saved case records. A total-loss
          analysis or diminished-value request created from the current intake
          is linked to the saved case and can be loaded only after Venfour
          verifies the signed-in account owns it. A case or results identifier
          by itself is not authorization to view private information.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Account and case information">
        <p>
          Venfour uses Supabase to authenticate customers and store limited
          account, profile, and vehicle-review case information. Depending on how
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
          Total-loss reports and diminished-value supporting documents are kept
          in private case-file storage. When you start a total-loss value check,
          Venfour also stores case-owned processing state and the resulting
          analysis record. Authorized Venfour staff can access submitted
          diminished-value requests and their supporting documents for manual
          review.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Total-loss report and analysis handling">
        <p>
          An original CCC report uploaded through the authenticated total-loss
          intake is kept in private case-file storage. When you choose to start
          the value check, Venfour verifies the signed-in case owner, retrieves
          the report through a server-controlled path, validates the PDF, and
          uses a temporary server copy while processing it.
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

      <PublicPageSection title="Diminished-value request handling">
        <p>
          Before submission, the same browser can keep a diminished-value draft
          in essential browser storage. After sign-in, Venfour stores the saved
          request with the customer-owned case and stores selected supporting
          documents in private case-file storage. A submitted request becomes
          read-only to the customer so the reviewed record is not silently
          changed afterward.
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
          Total-loss reports and diminished-value supporting documents remain
          in private case-file storage with their saved cases. Before sign-in,
          intake information may be kept in essential browser storage so the
          same browser can restore a draft; document bytes are not stored there.
          During a total-loss value check, the server-generated temporary PDF
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
