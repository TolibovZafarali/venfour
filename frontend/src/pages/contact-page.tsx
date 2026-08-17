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
    case "vehicle-value":
      return {
        eyebrow: "Vehicle value inquiry",
        title: "Ask about your vehicle’s market value",
        introduction:
          "Venfour’s self-service vehicle-details workflow is not available yet. Use this page to ask about current options for understanding market value without an insurer’s valuation report.",
        sectionTitle: "Ask about current availability",
        emailCopy:
          "Email is the current inquiry channel. Briefly include the vehicle’s year, make, model, approximate mileage, and ZIP code. Do not attach sensitive documents unless Venfour asks for them.",
        emailSubject: "Vehicle value inquiry",
        unavailableCopy:
          "Venfour has not yet published a support address for vehicle-value inquiries. Do not send vehicle information or documents to an address that is not published by Venfour.",
      };
    case "diminished-value":
      return {
        eyebrow: "Diminished value inquiry",
        title: "Ask about diminished value after a repair",
        introduction:
          "Venfour does not currently provide an automated diminished-value appraisal. Use this page to ask whether manual follow-up is available for a repaired vehicle that may have lost resale value after an accident.",
        sectionTitle: "Ask about manual follow-up",
        emailCopy:
          "Email is the current inquiry channel. Briefly include the vehicle’s year, make, model, repair status, and state. Do not attach repair records or other sensitive documents unless Venfour asks for them.",
        emailSubject: "Diminished value inquiry",
        unavailableCopy:
          "Venfour has not yet published a support address for diminished-value inquiries. Do not send vehicle or repair documents to an address that is not published by Venfour.",
      };
    default:
      return {
        eyebrow: "Contact",
        title: "Questions about Venfour",
        introduction:
          "Use this page for help with Venfour’s current insurer valuation-review experience, vehicle-value questions, or information about how Venfour handles a report.",
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
