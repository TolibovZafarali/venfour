import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { supportEmail } from "@/config/support";
import {
  PublicPage,
  PublicPageSection,
  publicTextLinkClassName,
} from "@/pages/public-page";

function contactContentFor(topic: string | null) {
  switch (topic) {
    case "report-format":
      return {
        eyebrow: "Report format inquiry",
        title: "Ask about another valuation report",
        introduction:
          "The automated review currently supports original CCC valuation report PDFs. Use this page to ask about another format or an unfamiliar report.",
        sectionTitle: "Request report help",
        emailCopy:
          "Email is the current inquiry channel. Include the report provider shown on the cover and a short description. Do not attach the report unless Venfour asks for it.",
        emailSubject: "Valuation report format inquiry",
        unavailableCopy:
          "Venfour has not yet published a support address for report-format inquiries. Do not send a valuation report to an address that is not published by Venfour.",
      };
    case "vehicle-value":
      return {
        eyebrow: "No-report total-loss inquiry",
        title: "Ask about a total-loss review without a CCC report",
        introduction:
          "No-report total-loss review is not available in the current tester release. Use this page to ask about future manual-review availability rather than entering an unfinished intake.",
        sectionTitle: "Ask about current availability",
        emailCopy:
          "Email is the current inquiry channel. Briefly say that you do not have the original CCC valuation report. Do not include claim details or attach sensitive documents unless Venfour asks for them.",
        emailSubject: "No-report total-loss review inquiry",
        unavailableCopy:
          "Venfour has not yet published a support address for vehicle-value inquiries. Do not send vehicle information or documents to an address that is not published by Venfour.",
      };
    case "diminished-value":
      return {
        eyebrow: "Diminished-value support",
        title: "Get help with a diminished-value request",
        introduction:
          "The current form securely submits accident, repair, vehicle, contact, and document information for future manual review. It does not create an automated appraisal or schedule an appointment.",
        sectionTitle: "Ask about a request",
        emailCopy:
          "Email is the current support channel. Describe the step or submitted request you need help with. Do not attach repair records or other sensitive documents unless Venfour asks for them.",
        emailSubject: "Diminished-value request support",
        unavailableCopy:
          "Venfour has not yet published a support address for diminished-value inquiries. Do not send vehicle or repair documents to an address that is not published by Venfour.",
      };
    default:
      return {
        eyebrow: "Contact",
        title: "Questions about Venfour",
        introduction:
          "Use this page for help with a supported CCC total-loss review, a diminished-value request, or Venfour’s handling of your information.",
        sectionTitle: "Contact support",
        emailCopy:
          "Email is the current support channel. Describe what you were trying to do and what happened. Avoid sending another copy of your valuation report or additional sensitive documents unless they are specifically needed.",
        emailSubject: "Venfour support question",
        unavailableCopy:
          "Venfour has not yet published a support address here. Do not send a valuation report to an address that is not published by Venfour.",
      };
  }
}

export function ContactPage() {
  const [searchParams] = useSearchParams();
  const content = contactContentFor(searchParams.get("topic"));

  return (
    <PublicPage
      eyebrow={content.eyebrow}
      title={content.title}
      introduction={content.introduction}
    >
      <PublicPageSection title={content.sectionTitle}>
        {supportEmail ? (
          <>
            <p>{content.emailCopy}</p>
            <Button asChild className="mt-2" size="lg">
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent(content.emailSubject)}`}
              >
                Email {supportEmail}
              </a>
            </Button>
          </>
        ) : (
          <div className="border-l-2 border-neutral-300 pl-5">
            <p className="font-medium text-neutral-900">
              Direct email support is not currently available through this site.
            </p>
            <p className="mt-2">{content.unavailableCopy}</p>
          </div>
        )}
      </PublicPageSection>

      <PublicPageSection title="Current service entry points">
        <p>
          If you have the original CCC valuation report PDF, start the{" "}
          <Link
            to="/start?service=total-loss"
            className={publicTextLinkClassName}
          >
            supported total-loss review
          </Link>
          . If your vehicle was repaired after an accident, you can submit a{" "}
          <Link
            to="/start?service=diminished-value"
            className={publicTextLinkClassName}
          >
            diminished-value request for future manual review
          </Link>
          .
        </p>
      </PublicPageSection>

      <PublicPageSection title="Before you rely on a result">
        <p>
          Venfour support cannot monitor insurance deadlines, communicate with
          an insurer on your behalf, or provide legal advice. If a claim or
          legal deadline may apply, consult an appropriate qualified
          professional promptly rather than waiting for a support response.
        </p>
      </PublicPageSection>

      <PublicPageSection title="About the review">
        <p>
          For an explanation of how report extraction, external evidence, and
          the final assessment fit together, read the{" "}
          <Link to="/methodology" className={publicTextLinkClassName}>
            methodology
          </Link>
          . Information about document processing and retained analysis data is
          available in the{" "}
          <Link to="/privacy" className={publicTextLinkClassName}>
            Privacy Policy
          </Link>
          .
        </p>
      </PublicPageSection>
    </PublicPage>
  );
}
