import {
  PublicPage,
  PublicPageSection,
} from "@/pages/public-page";

export function CookiePolicyPage() {
  return (
    <PublicPage
      eyebrow="Cookie policy"
      title="Cookies and browser storage at Venfour"
      introduction="This page describes the site’s current use of cookies and similar browser storage."
      updated="Last updated September 24, 2026"
      tone="cookies"
    >
      <PublicPageSection title="Current use">
        <p>
          Venfour uses essential browser storage to operate the site and
          remember your privacy preference. If you sign in, essential storage
          also preserves your Supabase session and the safe in-app location to
          return to after authentication. If you begin a total-loss review or
          diminished-value request, essential storage also keeps the intake
          step and entered information needed to restore that draft in the same
          browser. It does not store an uploaded report or supporting-document
          bytes. Essential storage cannot be turned off through the preference
          controls.
        </p>
        <p>
          Optional analytics and advertising measurement are off until you allow
          them. Advertising measurement remembers validated campaign and click
          identifiers in a first-party cookie for up to 30 days across the public
          site and customer application. Google tags load only when configured
          and allowed. Consent preferences last up to 180 days.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Your controls">
        <p>
          You can accept or reject non-essential purposes and change that choice
          later through “Cookie preferences” in the site footer. Venfour also
          respects Global Privacy Control by keeping analytics and advertising measurement off when
          that browser signal is active.
        </p>
      </PublicPageSection>
    </PublicPage>
  );
}
