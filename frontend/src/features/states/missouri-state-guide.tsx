import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { publicHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { fullReviewPriceLabel } from "@/config/review-price";
import { publicTextLinkClassName } from "@/pages/public-page";
import { stateMapPaths } from "./map-paths";

const guideContents = [
  { id: "missouri-value-title", label: "Vehicle value" },
  { id: "missouri-rules-title", label: "Missouri rules" },
  { id: "missouri-offer-title", label: "Review your offer" },
  { id: "missouri-service-title", label: "How Venfour helps" },
  { id: "missouri-faq-title", label: "Common questions" },
];

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

export function MissouriStateGuide({ action }: { action: ReactNode }) {
  return (
    <article className="state-page state-page--guide">
      <div className="state-page__inner">
        <nav className="state-guide__breadcrumb" aria-label="Breadcrumb">
          <Link to={publicHref("/#states")}><ArrowLeft size={14} aria-hidden />All states</Link>
          <span aria-hidden>/</span>
          <span>Missouri</span>
        </nav>
        <div className="state-guide__hero">
          <header className="state-page__header">
            <span className="states-eyebrow">Missouri total-loss guide</span>
            <h1><span>Understand your</span>{" "}<span>total-loss offer</span>{" "}<span className="state-guide__location">in Missouri.</span></h1>
            <p className="state-guide__lede">When your insurer declares your vehicle a total loss, it can be difficult to know whether the offer reflects what you lost. Start with the vehicle details, the comparisons, and the adjustments behind the number.</p>
            <div className="state-guide__hero-action">
              {action}
              <p>{publicIntakeClosed ? "Online reviews are opening soon." : "Start free. No payment required for your preliminary valuation."}</p>
            </div>
          </header>
          <figure className="state-guide__geography">
            <svg viewBox="496 253 132 117" role="img" aria-label="Outline of Missouri">
              <path d={stateMapPaths.MO} />
            </svg>
            <figcaption><span>MO</span><span>Missouri, United States</span></figcaption>
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
              <GuideSection id="missouri-value-title" number="01" title="How is your vehicle’s value determined?">
                <p>A total-loss valuation generally looks at your vehicle’s value immediately before the loss. Its mileage, equipment, and condition matter, along with evidence about comparable vehicles.</p>
                <p>Missouri’s insurance department explains that book values and dealer quotes can help establish value. When that value is disputed, similar vehicles available in the market become especially relevant. <a href="https://insurance.mo.gov/consumer-faqs/auto-insurance-faqs" className={publicTextLinkClassName}>Missouri auto insurance FAQs</a>.</p>
                <p>The most useful starting point is your insurer’s complete valuation report. Ask for the pages showing the vehicle description, comparable vehicles, adjustments, and calculation behind the offer.</p>

                <h3 id="missouri-checklist-title">Four things to check in your report</h3>
                <table className="state-guide__checklist" aria-labelledby="missouri-checklist-title">
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

              <GuideSection id="missouri-rules-title" number="02" title="Missouri rules worth understanding">
                <div className="state-guide__rule">
                  <h3>Depreciation deductions should have an explanation.</h3>
                  <p>Missouri’s automobile claims regulation requires reductions for betterment or depreciation to be itemized and appropriate in amount. Information supporting the reduction must be kept in the claim file. <a href="https://s1.sos.mo.gov/cmsimages/adrules/csr/current/20csr/20c100-1.pdf#page=4" className={publicTextLinkClassName}>20 CSR 100-1.050(2)(E)</a>.</p>
                  <p>If a deduction is unclear, ask your adjuster what it represents, how it was calculated, and what information supports it. Photographs, maintenance records, or documentation of your vehicle’s equipment may help clarify a disagreement.</p>
                </div>

                <div className="state-guide__rule">
                  <h3>The 80% figure needs context.</h3>
                  <p>Missouri’s salvage-vehicle definition includes a test under which the cost of specified repairs <strong>exceeds 80%</strong> of the vehicle’s pre-loss fair market value. That provision applies to vehicles damaged during a year no more than six years after their model-year designation. It also excludes certain repair costs, including hail damage and inflatable safety restraints.</p>
                  <p>The statute includes other ways a vehicle can be classified as salvage. The percentage is therefore not a universal rule for every total-loss decision, and it does not determine your settlement amount. <a href="https://revisor.mo.gov/main/OneSection.aspx?section=301.010" className={publicTextLinkClassName}>Missouri Revised Statutes § 301.010(55)</a>.</p>
                  <p>Ask your insurer to explain the basis for its decision and provide the repair estimate and vehicle valuation it used.</p>
                </div>

                <div className="state-guide__rule">
                  <h3>A replacement vehicle may qualify for a sales-tax allowance.</h3>
                  <p>Missouri’s Department of Revenue allows qualifying buyers to deduct the insurance settlement amount plus the owner’s deductible from the purchase price used to calculate tax on a replacement vehicle of the same general type.</p>
                  <p>The replacement must be purchased or contracted for after the loss and no later than <strong>180 days after the total-loss payment</strong>. At least one owner of the totaled vehicle must also be listed on the replacement vehicle’s title application.</p>
                  <p>Ask your insurer for a total-loss statement with the vehicle details, payment date, settlement amount, and deductible. The statement must be notarized unless the insurance agent certifies that the information is true and accurate.</p>
                  <p>Check the requirements before titling your replacement vehicle. This allowance concerns the replacement purchase’s taxable price; it does not increase the underlying valuation of your totaled vehicle. <a href="https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13" className={publicTextLinkClassName}>Missouri sales-tax allowance requirements</a>.</p>
                </div>
              </GuideSection>

              <GuideSection id="missouri-offer-title" number="03" title="What to do if the offer seems low">
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
                <p>Keep a record of what you submitted and the response you received. Missouri’s insurance department also recommends documenting calls and retaining written communications. <a href="https://insurance.mo.gov/consumer-complaints/insurance-complaints" className={publicTextLinkClassName}>Consumer complaint guidance</a>.</p>
              </GuideSection>

              <GuideSection id="missouri-service-title" number="04" title="How Venfour helps">
                <p>Venfour helps you understand your insurer’s valuation, review available market evidence, and prepare a clearer conversation with your adjuster.</p>
                <div className="state-guide__service-stage">
                  <p className="state-guide__eyebrow">Your starting point</p>
                  <h3>Begin with a free preliminary valuation.</h3>
                  <p>Upload your insurer’s report, or start with your vehicle details if you do not have the report yet. Confirm your mileage and location, then review the preliminary findings before deciding whether to continue.</p>
                </div>

                <div className="state-guide__service-stage">
                  <p className="state-guide__eyebrow">If you choose to continue</p>
                  <h3>Choose a full review for a one-time payment of <span className="state-guide__price">{fullReviewPriceLabel}</span>.</h3>
                  <p>When the full review is available for your case, <strong>Get my full review</strong> includes examination of your insurer’s report and available vehicle comparisons, an explanation of what the evidence supports, and help preparing a message to your adjuster.</p>
                  <p>A complete insurer valuation report is required for the paid review. You review the price and terms before paying.</p>
                  <p>You decide what to send and remain in control of the conversation. Venfour does not negotiate directly with your insurer or act as your appointed appraiser under an appraisal clause.</p>
                </div>

                <div className="state-guide__protection">
                  <h3>Your purchase includes two refund protections.</h3>
                  <ul>
                    <li><strong>If the completed review does not support a dispute:</strong> your fee is refunded automatically. You keep access to your completed review and report.</li>
                    <li><strong>If the review supports a dispute but the final verified vehicle-value increase is under $1,000:</strong> you may request a full refund after completing the Venfour-supported reconsideration process and providing the required documentation. The request must be made within 30 days after receiving the insurer’s final written response.</li>
                  </ul>
                  <p>The second protection measures the change in vehicle valuation, rather than the total settlement check. Eligibility conditions apply. <Link to={publicHref("/refund-policy")} className={publicTextLinkClassName}>Read the Fair-Result Refund Policy</Link>.</p>
                </div>
              </GuideSection>

              <GuideSection id="missouri-faq-title" number="05" title="Common questions">
                <div className="state-guide__faq-item">
                  <h3>Can I start without my insurer’s valuation report?</h3>
                  <p>Yes. You can begin your free preliminary valuation with your vehicle details. You will need the complete insurer report before purchasing the full review.</p>
                </div>

                <div className="state-guide__faq-item">
                  <h3>Can an appraisal clause help resolve a disagreement?</h3>
                  <p>If your policy includes an appraisal clause, review it and any endorsements for the appointment requirements, costs, and effect of the outcome. Ask your insurer to identify the applicable wording before deciding whether to proceed. Missouri’s <a href="https://insurance.mo.gov/understanding-your-automobile-insurance-policy" className={publicTextLinkClassName}>guide to understanding your automobile insurance policy</a> explains how to review your policy’s terms.</p>
                  <p>Venfour’s valuation review is a separate service from that formal appraisal process.</p>
                </div>

                <div className="state-guide__faq-item">
                  <h3>Can Missouri’s insurance department help?</h3>
                  <p>The Missouri Department of Commerce and Insurance can investigate complaints and review an insurer’s response for compliance with applicable law and policy requirements. It cannot determine the value of your claim or the amount owed to you.</p>
                  <p>You can contact the consumer hotline at <a href="tel:8007267390" className={publicTextLinkClassName}>800-726-7390</a> or use the department’s <a href="https://insurance.mo.gov/consumer-complaints/insurance-complaints" className={publicTextLinkClassName}>insurance complaint process</a>.</p>
                </div>

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
              <p>General educational information. Your policy, claim circumstances, and applicable law determine your rights and coverage. For advice about a specific legal dispute, consult a Missouri-licensed attorney.</p>
              <p>Sources checked <time dateTime="2026-09-26">September 26, 2026</time>.</p>
            </footer>
          </div>
        </div>
      </div>
    </article>
  );
}
