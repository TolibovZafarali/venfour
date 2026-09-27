import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { publicHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { ValuationReviewService } from "@/components/public-guides/valuation-review-service";
import { publicTextLinkClassName } from "@/pages/public-page";
import { stateMapPaths, stateMapViewBoxes } from "./map-paths";
import type { State } from "./states";
import type { GuideParagraph, StateGuideContent } from "./guide-content";


function GuideSection({ id, number, title, children }: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return <section aria-labelledby={id}>
    <div className="state-guide__section-heading">
      <span className="state-guide__section-number" aria-hidden>{number}</span>
      <h2 id={id} tabIndex={-1}>{title}</h2>
    </div>
    {children}
  </section>;
}

export function StateGuide({ state, content, action }: { state: State; content: StateGuideContent; action: ReactNode }) {
  const locationName = state.code === "DC" ? "the District of Columbia" : state.name;
  const id = (section: string) => `${state.slug}-${section}-title`;
  const guideContents = [
    { id: id("value"), label: "Vehicle value" },
    { id: id("rules"), label: state.code === "DC" ? "D.C. rules" : `${state.name} rules` },
    { id: id("offer"), label: "Review your offer" },
    { id: id("service"), label: "How Venfour helps" },
    { id: id("faq"), label: "Common questions" },
  ];
  const sources = new Map(content.sources.map(source => [source.id, source]));
  const renderParagraphs = (paragraphs: readonly GuideParagraph[]) => paragraphs.map((paragraph, index) => <p key={index}>
    {paragraph.text}{paragraph.contact && <> <a href={paragraph.contact.href} className={publicTextLinkClassName}>{paragraph.contact.label}</a>.</>}{paragraph.sources?.map(sourceId => {
      const source = sources.get(sourceId);
      if (!source) throw new Error(`Missing guide source: ${state.code}/${sourceId}`);
      return <span key={sourceId}>{" "}<a href={source.url} className={publicTextLinkClassName}>{source.title}</a>.</span>;
    })}
  </p>);
  const checkedDate = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${content.checkedOn}T00:00:00Z`));
  return (
    <article className="state-page state-page--guide">
      <div className="state-page__inner">
        <nav className="state-guide__breadcrumb" aria-label="Breadcrumb">
          <Link to={publicHref("/#states")}><ArrowLeft size={14} aria-hidden />All states</Link>
          <span aria-hidden>/</span>
          <span>{state.name}</span>
        </nav>
        <div className="state-guide__hero">
          <header className="state-page__header">
            <span className="states-eyebrow">{state.name} total-loss guide</span>
            <h1><span>Understand your</span>{" "}<span>total-loss offer</span>{" "}<span className="state-guide__location">in {locationName}.</span></h1>
            <p className="state-guide__lede">When your insurer declares your vehicle a total loss, it can be difficult to know whether the offer reflects what you lost. Start with the vehicle details, the comparisons, and the adjustments behind the number.</p>
            <div className="state-guide__hero-action">
              {action}
              <p>{publicIntakeClosed ? "Online reviews are opening soon." : "Start free. No payment required for your preliminary valuation."}</p>
            </div>
          </header>
          <figure className="state-guide__geography">
            <svg viewBox={stateMapViewBoxes[state.code]} role="img" aria-label={`Outline of ${locationName}`}>
              <path d={stateMapPaths[state.code]} vectorEffect="non-scaling-stroke" />
            </svg>
            <figcaption><span>{state.code}</span><span>{state.name}, United States</span></figcaption>
          </figure>
        </div>

        <div className="state-guide__layout">
          <nav className="state-guide__contents" aria-label="On this page">
            <p className="state-guide__eyebrow">In this guide</p>
            <ol>
              {guideContents.map((item, index) => <li key={item.id}>
                <Link to={`#${item.id}`} preventScrollReset><span aria-hidden>0{index + 1}</span>{item.label}</Link>
              </li>)}
            </ol>
            <p className="state-guide__contents-note">State guidance, practical steps, and official sources to help you understand your offer.</p>
          </nav>
          <div className="state-guide__reading">
            <div className="state-page__sections">
              <GuideSection id={id("value")} number="01" title="How is your vehicle’s value determined?">
                <p>A total-loss valuation generally looks at your vehicle’s value immediately before the loss. Its mileage, equipment, and condition matter, along with evidence about comparable vehicles.</p>
                {renderParagraphs(content.valuation)}
                <p>The most useful starting point is your insurer’s complete valuation report. Ask for the pages showing the vehicle description, comparable vehicles, adjustments, and calculation behind the offer.</p>

                <h3 id={id("checklist")}>Four things to check in your report</h3>
                <table className="state-guide__checklist" aria-labelledby={id("checklist")}>
                  <thead>
                    <tr><th scope="col">Check</th><th scope="col">What to look for</th></tr>
                  </thead>
                  <tbody>
                    <tr><th scope="row">Vehicle details</th><td>Does the report identify the correct year, model, trim, engine, drivetrain, and equipment?</td></tr>
                    <tr><th scope="row">Mileage and condition</th><td>Is the mileage accurate? Does the condition description reflect your vehicle before the loss?</td></tr>
                    <tr><th scope="row">Comparable vehicles</th><td>How closely do they match your vehicle? Check their equipment, mileage, location, and listing dates.</td></tr>
                    <tr><th scope="row">Adjustments</th><td>Can you follow each addition or deduction and understand why it was applied?</td></tr>
                  </tbody>
                </table>
                <p className="state-guide__evidence-note">An advertised price can provide useful market evidence. It does not establish what a vehicle ultimately sold for or guarantee the amount of an insurance settlement.</p>
              </GuideSection>

              <GuideSection id={id("rules")} number="02" title={`${state.code === "DC" ? "District of Columbia" : state.name} rules worth understanding`}>
                {content.rules.map(rule => <div className="state-guide__rule" key={rule.title}>
                  <h3>{rule.title}</h3>
                  {renderParagraphs(rule.paragraphs)}
                </div>)}
              </GuideSection>

              <GuideSection id={id("offer")} number="03" title="What to do if the offer seems low">
                <p>Start with a specific question you can support with evidence.</p>
                <ol className="state-guide__steps">
                  <li><div><strong>Get the complete report.</strong><p>Keep the valuation report, settlement breakdown, and correspondence together.</p></div></li>
                  <li><div><strong>Identify the discrepancy.</strong><p>Point to the vehicle detail, comparison, or adjustment you want reviewed.</p></div></li>
                  <li><div><strong>Attach relevant evidence.</strong><p>Include clear photographs, equipment records, or comparable listings, with dates and identifying details where available.</p></div></li>
                  <li><div><strong>Request a written response.</strong><p>Ask your adjuster to explain whether the evidence changes the valuation and to provide any revised report.</p></div></li>
                </ol>
                <figure className="state-guide__message">
                  <figcaption className="state-guide__eyebrow">A simple request to your adjuster</figcaption>
                  <blockquote>
                    <p>Thank you for sending the valuation report. I noticed that [specific detail] may need correction. I’ve attached [supporting document]. Could you review this and explain whether it changes the vehicle value?</p>
                  </blockquote>
                </figure>
                {renderParagraphs(content.reconsideration)}
              </GuideSection>

              <GuideSection id={id("service")} number="04" title="How Venfour helps">
                <ValuationReviewService />
              </GuideSection>

              <GuideSection id={id("faq")} number="05" title="Common questions">
                <div className="state-guide__faq-item">
                  <h3>Can I start without my insurer’s valuation report?</h3>
                  <p>Yes. You can begin your free preliminary valuation with your vehicle details. You will need the complete insurer report before purchasing the full review.</p>
                </div>

                {content.faqs.map(faq => <div className="state-guide__faq-item" key={faq.title}>
                  <h3>{faq.title}</h3>
                  {renderParagraphs(faq.paragraphs)}
                </div>)}

                <div className="state-guide__faq-item">
                  <h3>Does Venfour guarantee a higher offer?</h3>
                  <p>No. The evidence may support your insurer’s valuation, a request for reconsideration, or a conclusion that the available information is insufficient. Your review explains those findings and their limitations.</p>
                </div>
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
              <p>General educational information. Your policy, claim circumstances, and applicable law determine your rights and coverage. For advice about a specific legal dispute, consult an attorney licensed in {locationName}.</p>
              <p>Sources checked <time dateTime={content.checkedOn}>{checkedDate}</time>.</p>
            </footer>
          </div>
        </div>
      </div>
    </article>
  );
}
