import { Link } from "react-router";
import { PublicButton, PublicPageActions } from "@/pages/public-page-actions";
import { sampleReportPdfPath } from "@/config/public-review";
import { PublicPage, PublicPageSection, publicActionLinkClassName, publicTextLinkClassName } from "@/pages/public-page";

export function SampleReportPage() {
  return <PublicPage eyebrow="Sample report" title="See a sample Total-Loss review"
    introduction="Explore a six-page example of valuation findings, supporting market evidence, and correspondence a customer could review and send."
    tone="methodology">
    <section aria-labelledby="sample-context-heading" className="border-l-2 border-neutral-300 pl-5 text-base leading-7 text-neutral-600">
      <h2 id="sample-context-heading" className="font-semibold text-neutral-950">A fictional example for reference</h2>
      <p className="mt-2">All case details, listings, correspondence, and outcomes in this packet are fictional. They do not represent a real customer result.</p>
      <p className="mt-3">This illustrative packet combines a review with follow-up and attorney-handoff examples. It is not an exact application export. Your review’s contents and next steps depend on the available evidence.</p>
    </section>
    <PublicPageActions className="mb-8 sm:mb-10">
      <PublicButton asChild><a href={sampleReportPdfPath} target="_blank" rel="noopener noreferrer" aria-label="Open sample PDF (6 pages) (opens in a new tab)">
        Open sample PDF (6 pages)
      </a></PublicButton>
      <a href={sampleReportPdfPath} download="Venfour-Sample-Total-Loss-Review.pdf" className={publicActionLinkClassName}>Download sample PDF</a>
      <p className="w-full text-sm text-neutral-500">The sample opens in a new tab. You can also download it to read or share.</p>
    </PublicPageActions>
    <PublicPageSection title="Inside the sample">
      <ul className="list-disc space-y-3 pl-5">
        <li><strong className="font-medium text-neutral-950">Insurer valuation:</strong> vehicle details, comparable vehicles, disclosed adjustments, and questions raised by the report.</li>
        <li><strong className="font-medium text-neutral-950">Market comparison:</strong> fictional advertised listings and the limits of what those asking prices show.</li>
        <li><strong className="font-medium text-neutral-950">Customer request:</strong> an example reconsideration request for the customer to review and send.</li>
        <li><strong className="font-medium text-neutral-950">Insurer response:</strong> a hypothetical revised report, response review, and follow-up example.</li>
        <li><strong className="font-medium text-neutral-950">Attorney handoff:</strong> an overview prepared for attorney readers, with service scope and refund information.</li>
      </ul>
    </PublicPageSection>
    <PublicPageSection title="Understand what’s included">
      <p>Your review helps you understand the evidence and communicate with your insurer. A higher valuation or settlement is not guaranteed.</p>
      <p><Link to="/pricing" className={publicTextLinkClassName}>Pricing & what’s included</Link></p>
    </PublicPageSection>
  </PublicPage>;
}
