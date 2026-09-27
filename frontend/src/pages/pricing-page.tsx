import { Link } from "react-router";
import { fullReviewPriceLabel } from "@/config/review-price";
import { RefundProtectionDetails } from "@/features/full-review/refund-protection";
import { PublicPage, PublicPageSection, publicActionLinkClassName, publicTextLinkClassName } from "@/pages/public-page";
import { PublicPageActions, PublicReviewAction } from "@/pages/public-page-actions";

const inclusions = [
  ["Your insurer’s valuation, reviewed", "Review of the vehicle details, comparable vehicles, and adjustments in your insurer’s report."],
  ["A report you can share", "A downloadable PDF with the findings and supporting market evidence."],
  ["A request prepared for your case", "A personalized reconsideration request for you to review and send when the evidence supports it."],
  ["Guidance after the insurer replies", "Assessment of the response you share and guidance on your next step."],
] as const;

export function PricingPage() {
  return <PublicPage eyebrow="Pricing" title="Pricing & what’s included"
    introduction="Understand what your Total-Loss Valuation Report includes before you begin."
    tone="methodology">
    <section aria-label="Total-Loss Valuation Report price" className="pb-8 sm:pb-10">
      <h2 className="text-xl font-semibold tracking-tight text-neutral-950">Total-Loss Valuation Report</h2>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-neutral-950">{fullReviewPriceLabel} <span className="text-base font-normal tracking-normal text-neutral-600">USD</span></p>
      <p className="mt-2 text-sm leading-6 text-neutral-600">One-time payment · No subscription</p>
      <PublicPageActions>
        <PublicReviewAction />
        <Link to="/sample-report" className={publicActionLinkClassName}>View a sample report</Link>
      </PublicPageActions>
    </section>
    <PublicPageSection title="What’s included">
      <dl className="grid gap-6 sm:grid-cols-2 sm:gap-8">
        {inclusions.map(([title, description]) => <div key={title}>
          <dt className="font-semibold text-neutral-950">{title}</dt>
          <dd className="mt-2">{description}</dd>
        </div>)}
      </dl>
    </PublicPageSection>
    <PublicPageSection title="What you’ll need">
      <p>The paid review requires a complete insurer valuation report so we can examine its vehicle details, comparable vehicles, and adjustments.</p>
      <p>You can start a preliminary estimate without that report. The preliminary estimate is separate from the paid review and downloadable report.</p>
    </PublicPageSection>
    <PublicPageSection title="Your review fee, protected">
      <div className="space-y-4 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-medium [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4">
        <RefundProtectionDetails />
      </div>
    </PublicPageSection>
    <PublicPageSection title="You stay in control">
      <p>You review and send the reconsideration request and evidence, and communicate with your insurer. Venfour does not negotiate on your behalf.</p>
      <p>Payment does not guarantee a higher insurer valuation or settlement. Advertised vehicle prices are evidence to consider, not proof of completed sale prices or an amount you are owed.</p>
      <p><Link to="/methodology" className={publicTextLinkClassName}>Read how we review reports</Link></p>
    </PublicPageSection>
  </PublicPage>;
}
