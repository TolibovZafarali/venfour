import { useState } from "react";
import { Link } from "react-router";
import { applicationHref } from "@/app/site-boundary";
import { Button } from "@/components/ui/button";
import { publicIntakeClosed } from "@/config/public-site";
import { PublicPage, PublicPageSection, publicTextLinkClassName } from "@/pages/public-page";

function ReviewEntry() {
  return <div className="resource-next-step">
    <h2>Get a clearer view of your valuation.</h2>
    <p>Venfour independently reviews your insurer’s report and available market evidence, with clear explanations of the findings and any gaps.</p>
    <Button asChild size="lg"><Link to={publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss")}>
      {publicIntakeClosed ? "Contact Venfour" : "Start a Total Loss review"}
    </Link></Button>
  </div>;
}

function RelatedResources({ current }: { current: string }) {
  const resources = [
    ["/resources/understanding-your-report", "Understanding your report", "Understand the details behind your insurer’s valuation."],
    ["/resources/valuation-review-checklist", "Valuation checklist", "Review the details and prepare questions for your adjuster."],
    ["/methodology", "How we review reports", "Learn how we assess the available evidence."],
  ];
  return <nav className="resource-related" aria-label="Related resources">
    <h2>Explore our resources</h2>
    {resources.filter(([path]) => path !== current).map(([path, title, description]) =>
      <Link key={path} to={path}><span>{title}</span><span>{description}</span><span aria-hidden>↗</span></Link>,
    )}
  </nav>;
}

export function AboutPage() {
  return <PublicPage eyebrow="About Venfour" title="Your vehicle’s value, clearly explained."
    introduction="After a total loss, understanding your insurer’s valuation can be difficult. Venfour helps you make sense of the report, review the evidence, and prepare for a more informed conversation."
    tone="methodology" className="resource-content">
    <PublicPageSection title="Why Venfour exists">
      <p>Your insurer’s valuation is built on vehicle details, comparisons, and adjustments. You deserve to understand how those details lead to the final value.</p>
      <p>Venfour is a self-service valuation advisor that helps vehicle owners review the evidence and ask informed questions about their insurance claim.</p>
    </PublicPageSection>
    <PublicPageSection title="What we help you do">
      <ul className="resource-bullets">
        <li>Understand the details in your insurer’s valuation report.</li>
        <li>See how your vehicle compares with similar vehicles listed for sale.</li>
        <li>Identify relevant evidence to discuss with your adjuster.</li>
        <li>Recognize when the evidence is limited or does not support a different value.</li>
      </ul>
      <p>You can start a preliminary estimate without an insurer report. The paid Total-Loss Valuation Report requires a complete insurer valuation report so Venfour can examine its vehicle details, comparisons, and adjustments.</p>
    </PublicPageSection>
    <PublicPageSection title="Clear evidence. Honest explanations.">
      <p>An advertised price may differ from the final sale price. A current listing may not reflect the market at the time of your loss. We explain these differences and make clear where information is missing or uncertain.</p>
      <p><Link to="/methodology" className={publicTextLinkClassName}>Read how our review works</Link></p>
    </PublicPageSection>
    <PublicPageSection title="You decide what to do next">
      <p>You remain in control of what you send and discuss with your insurer. Venfour helps you understand the evidence; it does not negotiate on your behalf, determine what you are legally owed, or guarantee a higher payment.</p>
      <p>Depending on your situation, you may also need an independent appraisal or legal advice.</p>
    </PublicPageSection>
    <PublicPageSection title="Have a question?">
      <p>Venfour LLC provides this service. For questions about a report or your review, <Link to="/contact" className={publicTextLinkClassName}>contact Venfour</Link>.</p>
      <p>Learn how we handle your information in our <Link to="/privacy" className={publicTextLinkClassName}>Privacy Policy</Link>, or learn about our <Link to="/referral-partners" className={publicTextLinkClassName}>referral partner program</Link>.</p>
    </PublicPageSection>
    <ReviewEntry />
    <RelatedResources current="/about" />
  </PublicPage>;
}

const reportSections = [
  {
    title: "Your vehicle’s details",
    label: "Vehicle details",
    facts: [["Vehicle", "2022 Example Sedan · Touring"], ["Mileage", "42,000 miles"], ["Date of loss", "August 15, 2026"]],
    explanation: "Compare the VIN, year, model, trim, mileage, and equipment with your records. Confirm the drive type, such as front-wheel or all-wheel drive. Check the date of loss—the date of the damage or theft—separately from the date the report was prepared.",
    question: "Does the report accurately describe my vehicle before the loss?",
  },
  {
    title: "The vehicles used for comparison",
    label: "Comparable vehicle",
    facts: [["Vehicle", "2022 Example Sedan · Touring"], ["Mileage", "48,000 miles"], ["Asking price", "$20,500"], ["Listing date", "August 12, 2026"]],
    explanation: "Review each comparable vehicle’s details, location, listing date, and source. The same model can have different equipment, mileage, and condition. An asking price shows what the seller requested, not necessarily what a buyer paid.",
    question: "How closely does this vehicle match mine, and when was it listed?",
  },
  {
    title: "How adjustments affect the comparison",
    label: "Price adjustments",
    facts: [["Asking price", "$20,500"], ["Mileage adjustment", "+$300"], ["Equipment adjustment", "−$200"], ["Adjusted price", "$20,600"]],
    explanation: "Adjustments add or subtract value to account for differences in mileage, equipment, or condition. Check which vehicle each adjustment applies to and how the amount is explained. These example amounts show the calculation only; they are not rates to use for your own vehicle.",
    question: "Which vehicle does this adjustment apply to, and how was the amount determined?",
  },
  {
    title: "The vehicle value and proposed payment",
    label: "Final value",
    facts: [["Vehicle value", "$20,000"], ["Payment details", "Listed separately"]],
    explanation: "Find the report’s final vehicle value and review how it was calculated. Then compare it with the proposed payment. Ask how any taxes, fees, deductible, or other entries affect the amount you would receive.",
    question: "Can you explain the difference between the vehicle value and the proposed payment?",
  },
];

export function UnderstandingReportPage() {
  return <PublicPage eyebrow="Resources / Report guide" title="Understanding your valuation report."
    introduction="Follow the details behind your insurer’s valuation, from the description of your vehicle to the comparisons and adjustments that shape the final value."
    tone="methodology" className="resource-content max-w-none">
    <div className="resource-note"><strong>An example for reference</strong><p>The vehicle details and figures below are fictional and provided for learning. They do not represent a real claim or customer result. Report formats and terms vary by provider.</p></div>
    <ol className="report-guide" aria-label="Valuation report example">
      {reportSections.map((section, index) => <li key={section.title}>
        <div className="report-guide__excerpt">
          <p className="resource-eyebrow">Example · {section.label}</p>
          <dl>{section.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </div>
        <div className="report-guide__annotation">
          <span className="resource-eyebrow">{String(index + 1).padStart(2, "0")} / What to check</span>
          <h2>{section.title}</h2><p>{section.explanation}</p>
          <div className="report-guide__question"><strong>What to ask</strong><p>“{section.question}”</p></div>
        </div>
      </li>)}
    </ol>
    <div className="resource-reading-width">
      <PublicPageSection title="Prepare specific questions">
        <p>Keep a copy of the report and note the page, the detail you want checked, and any supporting document. For example: “Page 3 lists the base trim, but my window sticker shows Touring. Could you confirm that the trim and equipment are recorded correctly?”</p>
        <p>A difference may be worth discussing, but it does not by itself show that the valuation is wrong or that a higher payment is owed.</p>
        <Link to="/resources/valuation-review-checklist" className={publicTextLinkClassName}>Use the valuation checklist</Link>
      </PublicPageSection>
      <PublicPageSection title="Further reading">
        <p>For guidance on requesting a valuation report, see the <a className={publicTextLinkClassName} href="https://www.insurance.wa.gov/insurance-resources/auto-insurance/auto-insurance-claims/what-happens-after-your-car-gets-totaled">Washington Office of the Insurance Commissioner’s total-loss guide</a>. This guidance applies to Washington; your policy and state requirements may differ.</p>
        <p>This guide helps you understand a report. It does not provide legal advice or determine what your insurer owes.</p>
      </PublicPageSection>
      <ReviewEntry /><RelatedResources current="/resources/understanding-your-report" />
    </div>
  </PublicPage>;
}

const checklistGroups = [
  { title: "Gather your documents", items: [
    ["report", "Keep the full valuation report", "Request all pages, including comparable vehicles, adjustments, and explanatory notes."],
    ["offer", "Keep the proposed payment details", "Record the vehicle valuation and proposed payment separately so you can see how they differ."],
    ["records", "Gather your vehicle records", "Have the vehicle identification number (VIN), mileage, equipment records, and any photos taken before the loss ready."],
  ] },
  { title: "Check your vehicle’s details", items: [
    ["identity", "Confirm the vehicle and equipment", "Compare the year, make, model, trim, drive type, and equipment with your records."],
    ["condition", "Review mileage and condition", "Note any details that do not match the vehicle before the loss, along with a record or photo that supports your concern."],
    ["dates", "Check the dates", "Review the date of loss, the report date, and the dates of the comparable vehicle listings."],
  ] },
  { title: "Review the comparisons", items: [
    ["comparables", "Review each comparable vehicle", "Check the listing source, location, mileage, trim, and equipment. Note any differences you want explained."],
    ["adjustments", "Review the adjustments", "For each amount added or deducted, identify the vehicle it applies to and the reason given."],
    ["prices", "Understand what each price represents", "Distinguish the seller’s asking price, the adjusted comparison value, and any confirmed sale price."],
  ] },
  { title: "Prepare your questions", items: [
    ["questions", "List the details you want reviewed", "Include the report page, the detail in question, and what you would like checked."],
    ["evidence", "Include supporting documents", "Label relevant documents and photos. Keep a copy of what you send and the date you sent it."],
    ["next", "Confirm the next step", "Ask your adjuster how to submit questions, which deadlines apply, and when to expect a response."],
  ] },
];

export function ValuationChecklistPage() {
  const [checked, setChecked] = useState<string[]>([]);
  const total = checklistGroups.reduce((count, group) => count + group.items.length, 0);
  return <div className="review-checklist-page w-full">
    <PublicPage eyebrow="Resources / Checklist" title="Review your valuation with confidence."
      introduction="Use this checklist alongside your insurer’s report to organize your documents, check key details, and prepare questions for your adjuster."
      tone="methodology" className="resource-content">
      <div className="checklist-tools">
        <div><p role="status">{checked.length} of {total} checked</p><p>Progress is not saved when you leave this page. Print a copy for your records.</p></div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setChecked([])} disabled={checked.length === 0}>Reset checklist</Button>
          <Button onClick={() => window.print()}>Print checklist</Button>
        </div>
      </div>
      <div className="review-checklist">
        {checklistGroups.map((group, index) => <fieldset key={group.title}>
          <legend><span>{String(index + 1).padStart(2, "0")}</span>{group.title}</legend>
          {group.items.map(([id, title, description]) => <label key={id}>
            <input type="checkbox" checked={checked.includes(id)} onChange={event => setChecked(current => event.target.checked ? [...current, id] : current.filter(item => item !== id))} />
            <span><strong>{title}</strong><span>{description}</span></span>
          </label>)}
        </fieldset>)}
      </div>
      <div className="resource-note"><p>Completing this checklist helps you prepare for a discussion. It does not confirm the report’s accuracy or determine a settlement amount. Your policy and state requirements still apply.</p></div>
      <div className="resource-print-notes"><h2>Questions for my adjuster</h2><div /><div /><div /></div>
      <div className="resource-screen-only"><ReviewEntry /><RelatedResources current="/resources/valuation-review-checklist" /></div>
    </PublicPage>
  </div>;
}
