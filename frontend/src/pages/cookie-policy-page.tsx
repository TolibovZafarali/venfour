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
      updated="Last updated August 18, 2026"
    >
      <PublicPageSection title="Current use">
        <p>
          Venfour uses essential browser storage to operate the site and
          remember your privacy preference. If you sign in, essential storage
          also preserves your Supabase session and the safe in-app location to
          return to after authentication. If you begin a total-loss appraisal,
          essential storage also keeps the intake step and manually entered
          information needed to restore that draft in the same browser. It does
          not store an uploaded PDF. Essential storage cannot be turned off
          through the preference controls.
        </p>
        <p>
          Venfour does not currently use optional analytics, advertising, or
          cross-site tracking tools. If optional analytics are introduced, they
          will remain off unless your saved preference permits them.
        </p>
      </PublicPageSection>

      <PublicPageSection title="Your controls">
        <p>
          You can accept or reject non-essential purposes and change that choice
          later through “Cookie preferences” in the site footer. Venfour also
          respects Global Privacy Control by keeping optional analytics off when
          that browser signal is active.
        </p>
      </PublicPageSection>
    </PublicPage>
  );
}
