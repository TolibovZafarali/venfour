import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { supportEmail } from "@/config/support";
import {
  PublicPage,
  PublicPageSection,
  publicTextLinkClassName,
} from "@/pages/public-page";

export function ContactPage() {
  return (
    <PublicPage
      eyebrow="Contact"
      title="Questions about Venfour"
      introduction="Use this page for help with the current CCC valuation-review experience or questions about how Venfour handles a report."
    >
      <PublicPageSection title="Contact support">
        {supportEmail ? (
          <>
            <p>
              Email is the current support channel. Describe what you were
              trying to do and what happened. Avoid sending another copy of your
              valuation report or additional sensitive documents unless they are
              specifically needed.
            </p>
            <Button asChild className="mt-2" size="lg">
              <a href={`mailto:${supportEmail}`}>Email {supportEmail}</a>
            </Button>
          </>
        ) : (
          <div className="border-l-2 border-neutral-300 pl-5">
            <p className="font-medium text-neutral-900">
              Direct email support is not currently available through this site.
            </p>
            <p className="mt-2">
              Venfour has not yet published a support address here. Do not send
              a valuation report to an address that is not published by Venfour.
            </p>
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
