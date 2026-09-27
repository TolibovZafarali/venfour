import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { publicHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { ValuationReviewService } from "@/components/public-guides/valuation-review-service";
import { publicTextLinkClassName } from "@/pages/public-page";
import type { GuideParagraph } from "@/features/states/guide-content";
import type { InsurerGuideContent } from "./guide-content";
import type { Insurer } from "./insurers";

function GuideSection({ id, number, title, children }: {
  id: string; number: string; title: string; children: ReactNode;
}) {
  return <section aria-labelledby={id}>
    <div className="state-guide__section-heading">
      <span className="state-guide__section-number" aria-hidden>{number}</span>
      <h2 id={id} tabIndex={-1}>{title}</h2>
    </div>
    {children}
  </section>;
}

export function InsurerGuide({ insurer, content, action }: {
  insurer: Insurer; content: InsurerGuideContent; action: ReactNode;
}) {
  const id = (section: string) => `${insurer.slug}-${section}-title`;
  const contents = [
    { key: "documents", title: "Get your claim documents" },
    { key: "value", title: "Understand your valuation" },
    { key: "review", title: "Request a review" },
    { key: "service", title: "How Venfour helps" },
    { key: "faq", title: "Common questions" },
  ];
  const sources = new Map(content.sources.map(source => [source.id, source]));
  const paragraphs = (items: readonly GuideParagraph[]) => items.map((paragraph, index) => <p key={index}>
    {paragraph.text}{paragraph.contact && <> <a href={paragraph.contact.href} className={publicTextLinkClassName}>{paragraph.contact.label}</a>.</>}
    {paragraph.sources?.map(sourceId => {
      const source = sources.get(sourceId);
      if (!source) throw new Error(`Missing guide source: ${insurer.slug}/${sourceId}`);
      return <span key={sourceId}>{" "}<a href={source.url} className={publicTextLinkClassName}>{source.title}</a>.</span>;
    })}
  </p>);
  const checkedDate = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${content.checkedOn}T00:00:00Z`));

  return <article className="state-page state-page--guide insurer-page insurer-guide">
    <div className="state-page__inner">
      <nav className="state-guide__breadcrumb" aria-label="Breadcrumb">
        <Link to={publicHref("/insurers")}><ArrowLeft size={14} aria-hidden />All insurer guides</Link>
        <span aria-hidden>/</span><span>{insurer.name}</span>
      </nav>
      <div className="state-guide__hero">
        <header className="state-page__header">
          <span className="states-eyebrow">{insurer.name} total-loss guide</span>
          <h1>Understand your {insurer.name} total-loss offer.</h1>
          <p className="state-guide__lede">{insurer.summary}</p>
          <div className="state-guide__hero-action">
            {action}
            <p>{publicIntakeClosed ? "Online reviews are opening soon." : "Start free. No payment required for your preliminary valuation."}</p>
          </div>
          <p className="insurer-guide__independence">Venfour is independent and is not affiliated with or endorsed by {insurer.name}.</p>
        </header>
      </div>
      <div className="state-guide__layout">
        <nav className="state-guide__contents" aria-label="On this page">
          <p className="state-guide__eyebrow">In this guide</p>
          <ol>{contents.map((section, index) => <li key={section.key}>
            <Link to={`#${id(section.key)}`} preventScrollReset><span aria-hidden>0{index + 1}</span>{section.title}</Link>
          </li>)}</ol>
          <p className="state-guide__contents-note">Practical steps and official sources to help you understand the details behind your offer.</p>
        </nav>
        <div className="state-guide__reading">
          <div className="state-page__sections">
            <GuideSection id={id("documents")} number="01" title="Get your claim documents">
              {paragraphs(content.documents)}
              <p>Ask your adjuster for the complete valuation report and a separate settlement breakdown. Keep the pages showing your vehicle details, comparable vehicles, adjustments, and calculation together with the offer and correspondence.</p>
              <p>Confirm whether the claim is under your own policy or another driver’s coverage. The applicable coverage and process may differ. <Link to={publicHref("/#states")} className={publicTextLinkClassName}>Find your state guide</Link> for local context.</p>
            </GuideSection>
            <GuideSection id={id("value")} number="02" title="Understand your valuation">
              {paragraphs(content.valuation)}
              <h3 id={id("checklist")}>Four things to check in your report</h3>
              <table className="state-guide__checklist" aria-labelledby={id("checklist")}>
                <thead><tr><th scope="col">Check</th><th scope="col">What to look for</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Vehicle details</th><td>Check the year, model, trim, engine, drivetrain, and equipment against your vehicle’s records.</td></tr>
                  <tr><th scope="row">Mileage and condition</th><td>Compare the recorded mileage and condition with evidence of your vehicle before the loss.</td></tr>
                  <tr><th scope="row">Comparable vehicles</th><td>Check equipment, mileage, location, and listing dates. Note differences that may affect the comparison.</td></tr>
                  <tr><th scope="row">Adjustments</th><td>Follow each addition and deduction. Ask for an explanation when the reason or calculation is unclear.</td></tr>
                </tbody>
              </table>
              <p>Separate the vehicle valuation from the payment breakdown. Ask which taxes, fees, deductibles, lender payments, or other additions and deductions apply to your claim rather than assuming the check equals the vehicle’s value.</p>
              <p className="state-guide__evidence-note">An advertised price can provide useful market evidence. It does not establish what a vehicle ultimately sold for or guarantee the amount of an insurance settlement.</p>
              <p>Check your report for the valuation provider and methodology. Ask your adjuster if either is unclear; the insurer’s name alone does not establish which report was used for your claim.</p>
            </GuideSection>
            <GuideSection id={id("review")} number="03" title="Request a review">
              {paragraphs(content.reconsideration)}
              <ol className="state-guide__steps">
                <li><div><strong>Identify the specific detail.</strong><p>Point to the vehicle description, comparison, or adjustment you want your adjuster to review.</p></div></li>
                <li><div><strong>Attach relevant evidence.</strong><p>Include photographs, equipment records, receipts, or comparable listings with dates and identifying details. Explain what each item supports.</p></div></li>
                <li><div><strong>Ask for a written explanation.</strong><p>Request a response to the identified issue and a revised report if the valuation changes. Keep both versions with your claim documents.</p></div></li>
              </ol>
              <figure className="state-guide__message">
                <figcaption className="state-guide__eyebrow">A simple request to your adjuster</figcaption>
                <blockquote><p>Thank you for sending the valuation report. I noticed that [specific detail] may need correction. I’ve attached [supporting document]. Could you review this and explain whether it changes the vehicle value?</p></blockquote>
              </figure>
              <p>A request for reconsideration is separate from a formal policy appraisal. If you are considering that process, review your policy and ask about its availability, costs, and effect for your particular claim.</p>
            </GuideSection>
            <GuideSection id={id("service")} number="04" title="How Venfour helps"><ValuationReviewService /></GuideSection>
            <GuideSection id={id("faq")} number="05" title="Common questions">
              {content.faqs.map(faq => <div className="state-guide__faq-item" key={faq.title}><h3>{faq.title}</h3>{paragraphs(faq.paragraphs)}</div>)}
              <div className="state-guide__faq-item"><h3>Can I start without my insurer’s valuation report?</h3><p>Yes. You can begin your free preliminary valuation with your vehicle details. You will need the complete insurer report before purchasing the full review.</p></div>
              <div className="state-guide__faq-item"><h3>Does Venfour guarantee a higher offer?</h3><p>No. The evidence may support your insurer’s valuation, a request for reconsideration, or a conclusion that the available information is insufficient. Your review explains those findings and their limitations.</p></div>
            </GuideSection>
          </div>
          <div className="state-page__next">
            <p className="state-guide__eyebrow">Your next step</p>
            <h2>Start with a clearer understanding of your offer.</h2>
            <p>Bring your vehicle details and, if available, your insurer’s valuation report. See what the evidence shows before deciding whether to purchase a full review.</p>
            {action}
            {publicIntakeClosed && <p className="state-guide__availability">Online reviews are opening soon.</p>}
          </div>
          <footer className="state-guide__notes">
            <p>General educational information. Your policy, claim circumstances, and applicable law determine your rights and coverage. For advice about a specific legal dispute, consult an attorney licensed in your state.</p>
            <p>Sources checked <time dateTime={content.checkedOn}>{checkedDate}</time>.</p>
          </footer>
        </div>
      </div>
    </div>
  </article>;
}
