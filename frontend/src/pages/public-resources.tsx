import { useState } from "react";
import { Link } from "react-router";
import { applicationHref } from "@/app/site-boundary";
import { Button } from "@/components/ui/button";
import { publicIntakeClosed } from "@/config/public-site";
import { PublicPage, PublicPageSection, publicTextLinkClassName } from "@/pages/public-page";

function ReviewEntry() {
  return <div className="resource-next-step">
    <h2>Put your own report in context.</h2>
    <p>Venfour independently examines the available insurer report and market evidence, then explains the findings and their limits.</p>
    <Button asChild size="lg"><Link to={publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss")}>
      {publicIntakeClosed ? "Contact Venfour" : "Start a Total Loss review"}
    </Link></Button>
  </div>;
}

function RelatedResources({ current }: { current: string }) {
  const resources = [
    ["/resources/understanding-your-report", "Understanding your report", "A guided look at the details behind a valuation."],
    ["/resources/valuation-review-checklist", "Valuation review checklist", "Organize what to check and what to ask."],
    ["/methodology", "Our methodology", "How Venfour reviews the available evidence."],
  ];
  return <nav className="resource-related" aria-label="Related resources">
    <h2>Keep exploring</h2>
    {resources.filter(([path]) => path !== current).map(([path, title, description]) =>
      <Link key={path} to={path}><span>{title}</span><span>{description}</span><span aria-hidden>↗</span></Link>,
    )}
  </nav>;
}

export function AboutPage() {
  return <PublicPage eyebrow="About Venfour" title="A clearer view of your vehicle’s value."
    introduction="After a total loss, a valuation can leave you with more questions than answers. Venfour helps you understand the evidence and prepare for the conversation ahead."
    tone="methodology" className="resource-content">
    <PublicPageSection title="Why Venfour exists">
      <p>A number on a report is only part of the story. The vehicle details, comparisons, adjustments, and dates behind it deserve an explanation you can follow.</p>
      <p>Venfour is a self-service vehicle valuation advisor built around that need: making complex valuation evidence easier to understand and use when speaking with your insurer.</p>
    </PublicPageSection>
    <PublicPageSection title="What we help you do">
      <ul className="resource-bullets">
        <li>Understand the details recorded in your insurer’s valuation report.</li>
        <li>See how available market evidence compares with the vehicle and valuation being reviewed.</li>
        <li>Identify supported questions to raise with your adjuster.</li>
        <li>Understand when the evidence is limited or does not support a different conclusion.</li>
      </ul>
      <p>You can begin a Total Loss review with or without an insurer report. Uploading the report lets Venfour independently examine the insurer’s recorded details, comparisons, and adjustments.</p>
    </PublicPageSection>
    <PublicPageSection title="Evidence first. Clear explanations throughout.">
      <p>We distinguish advertised asking prices from completed sale prices, and current listings from evidence verified for the date of loss. When information is missing or comparisons are weak, those limits belong alongside the findings.</p>
      <p><Link to="/methodology" className={publicTextLinkClassName}>Read how our review works</Link></p>
    </PublicPageSection>
    <PublicPageSection title="You stay in control of the conversation">
      <p>Venfour helps you understand and present evidence. You decide what to send and discuss with your insurer. Venfour does not negotiate on your behalf, determine legal entitlement, or guarantee a settlement increase.</p>
      <p>The review is not a substitute for an independent appraisal or legal advice when your situation calls for one.</p>
    </PublicPageSection>
    <PublicPageSection title="Get to know the service">
      <p>Venfour LLC provides the service described on this website. For questions about a report or your review, <Link to="/contact" className={publicTextLinkClassName}>contact Venfour</Link>.</p>
      <p>Learn how we handle your information in our <Link to="/privacy" className={publicTextLinkClassName}>Privacy Policy</Link>, or explore our <Link to="/referral-partners" className={publicTextLinkClassName}>referral partner program</Link>.</p>
    </PublicPageSection>
    <ReviewEntry />
    <RelatedResources current="/about" />
  </PublicPage>;
}

const reportSections = [
  {
    title: "Your vehicle and the date of loss",
    label: "Vehicle details",
    facts: [["Vehicle", "2022 Example Sedan · Touring"], ["Mileage", "42,000 miles"], ["Date of loss", "August 15, 2026"]],
    explanation: "Start with the vehicle being valued. Check the VIN, year, model, trim, mileage, drivetrain, and equipment against your own records. Confirm the loss date as well as the report date; they describe different events.",
    question: "Does the report describe my vehicle as it was immediately before the loss?",
  },
  {
    title: "The vehicles used for comparison",
    label: "One comparable vehicle",
    facts: [["Vehicle", "2022 Example Sedan · Touring"], ["Mileage", "48,000 miles"], ["Advertised price", "$20,500"], ["Listing date", "August 12, 2026"]],
    explanation: "Look at each comparison, including its source, location, date, and vehicle details. A similar model name does not make two vehicles identical. An advertised price records what a seller asked; it does not establish what a buyer paid.",
    question: "How similar is this vehicle, and was this evidence available near the date of loss?",
  },
  {
    title: "The adjustments between vehicles",
    label: "Illustrative comparison adjustment",
    facts: [["Advertised price", "$20,500"], ["Mileage adjustment", "+$300"], ["Equipment adjustment", "−$200"], ["Adjusted comparison", "$20,600"]],
    explanation: "Read the labels and direction of each adjustment. Some entries adjust a comparable vehicle; others adjust the loss vehicle. This example only shows how arithmetic fits together. It is not a recommended mileage rate, equipment value, or valuation method.",
    question: "Which vehicle is being adjusted, and what supports this amount?",
  },
  {
    title: "The valuation and the payment breakdown",
    label: "Illustrative summary",
    facts: [["Vehicle valuation", "$20,000"], ["Payment breakdown", "Shown separately"]],
    explanation: "Find the report’s final vehicle value and trace how the comparisons and adjustments feed into it. Then read the separate payment breakdown. Ask how any taxes, fees, deductible, or other entries apply to your claim; do not assume the vehicle value is the amount you will receive.",
    question: "Can you walk me from the vehicle valuation to the proposed payment?",
  },
];

export function UnderstandingReportPage() {
  return <PublicPage eyebrow="Resources / Report guide" title="Understand the report behind the number."
    introduction="Read your insurer’s valuation one section at a time. Start with your vehicle, follow the comparisons, and see how the report arrives at its conclusion."
    tone="methodology" className="resource-content max-w-none">
    <div className="resource-note"><strong>A fictional example, explained.</strong><p>The excerpts below are invented for learning. They are not an insurer’s report, a real vehicle valuation, or a Venfour customer result. Report layouts and terminology vary by provider.</p></div>
    <ol className="report-guide" aria-label="Annotated valuation report">
      {reportSections.map((section, index) => <li key={section.title}>
        <div className="report-guide__excerpt">
          <p className="resource-eyebrow">Example · {section.label}</p>
          <dl>{section.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </div>
        <div className="report-guide__annotation">
          <span className="resource-eyebrow">{String(index + 1).padStart(2, "0")} / What to look for</span>
          <h2>{section.title}</h2><p>{section.explanation}</p>
          <div className="report-guide__question"><strong>A useful question</strong><p>“{section.question}”</p></div>
        </div>
      </li>)}
    </ol>
    <div className="resource-reading-width">
      <PublicPageSection title="Turn a concern into a specific question">
        <p>Keep a copy of the report. Note the page, the detail you want explained, and any document that supports your question. For example: “Page 3 lists the base trim. My original window sticker lists Touring. Could you check whether the equipment is recorded correctly?”</p>
        <p>A difference is a reason to investigate. It does not, by itself, prove the valuation is wrong or that a higher payment is due.</p>
        <Link to="/resources/valuation-review-checklist" className={publicTextLinkClassName}>Use the valuation review checklist</Link>
      </PublicPageSection>
      <PublicPageSection title="Further reading">
        <p>For a regulator’s explanation of requesting a valuation report, see the <a className={publicTextLinkClassName} href="https://www.insurance.wa.gov/insurance-resources/auto-insurance/auto-insurance-claims/what-happens-after-your-car-gets-totaled">Washington Office of the Insurance Commissioner’s total-loss guide</a>. Its requirements are specific to Washington; your policy and state rules may differ.</p>
        <p>This resource explains how to read and organize information. It does not determine your rights or the outcome of a claim.</p>
      </PublicPageSection>
      <ReviewEntry /><RelatedResources current="/resources/understanding-your-report" />
    </div>
  </PublicPage>;
}

const checklistGroups = [
  { title: "Gather your documents", items: [
    ["report", "Keep the full valuation report", "Ask for all pages, including comparable vehicles, adjustments, and explanatory notes."],
    ["offer", "Keep the proposed payment breakdown", "Keep the vehicle valuation and proposed payment clearly identified in your notes."],
    ["records", "Collect your vehicle records", "Have your VIN, mileage record, equipment information, and relevant pre-loss photos ready."],
  ] },
  { title: "Check what the report describes", items: [
    ["identity", "Check vehicle identity and equipment", "Compare the year, make, model, trim, drivetrain, and listed options with your records."],
    ["condition", "Review mileage and condition", "Flag anything you cannot reconcile with the vehicle before the loss. Note the supporting page or photo."],
    ["dates", "Check the dates", "Distinguish the date of loss, report date, and dates attached to comparable vehicles."],
  ] },
  { title: "Understand the comparisons", items: [
    ["comparables", "Read each comparable vehicle", "Review its source, location, mileage, trim, and equipment. Record the differences that need explanation."],
    ["adjustments", "Follow the adjustments", "Identify which vehicle each adjustment applies to, its direction, and the explanation provided."],
    ["prices", "Identify what each price represents", "Keep asking prices, adjusted comparison values, and any verified sale prices distinct."],
  ] },
  { title: "Prepare your questions", items: [
    ["questions", "Write a short list of specific questions", "For each concern, include the report page, the recorded detail, and what you would like checked."],
    ["evidence", "Attach the relevant evidence", "Use labeled documents or photos. Keep a copy of what you send and when you send it."],
    ["next", "Confirm the next step with your adjuster", "Ask how to submit questions, which deadlines apply, and when to expect a response."],
  ] },
];

export function ValuationChecklistPage() {
  const [checked, setChecked] = useState<string[]>([]);
  const total = checklistGroups.reduce((count, group) => count + group.items.length, 0);
  return <div className="review-checklist-page w-full">
    <PublicPage eyebrow="Resources / Practical checklist" title="Review your valuation, step by step."
      introduction="Use this checklist alongside your insurer’s report to organize your documents, check the details, and prepare clear questions."
      tone="methodology" className="resource-content">
      <div className="checklist-tools">
        <div><p role="status">{checked.length} of {total} checked</p><p>Checks stay on this page only. Print a copy to keep them.</p></div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setChecked([])} disabled={checked.length === 0}>Reset checks</Button>
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
      <div className="resource-note"><p>Checking every item means you have worked through this list. It does not certify the report’s accuracy or establish a settlement amount. Policy terms and state requirements vary.</p></div>
      <div className="resource-print-notes"><h2>Questions for my adjuster</h2><div /><div /><div /></div>
      <div className="resource-screen-only"><ReviewEntry /><RelatedResources current="/resources/valuation-review-checklist" /></div>
    </PublicPage>
  </div>;
}
