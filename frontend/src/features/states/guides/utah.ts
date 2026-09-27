import type { StateGuideContent } from "../guide-content";

export default {
  code: "UT",
  description: "Understand Utah total-loss values, third-party deductions, transportation costs, and salvage titles. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Utah’s Insurance Department defines actual cash value as the car’s market value. Its consumer glossary describes a total loss as a situation in which repair costs approach or exceed that value.", sources: ["value"] }],
  rules: [
    { title: "Identify whose policy is handling the loss", paragraphs: [{ text: "Utah distinguishes your own coverage from a claim against another driver’s insurer. Your policy creates contractual duties; the other insurer’s primary obligation is to its policyholder. A third-party claim does not carry a deductible.", sources: ["claims"] }] },
    { title: "Prior damage deductions should be specific", paragraphs: [{ text: "For third-party claims, the Department says an insurer may reasonably deduct for old, unrepaired collision damage. It should identify each deduction and its dollar amount.", sources: ["claims"] }] },
    { title: "Transportation payments depend on liability and timing", paragraphs: [{ text: "The other driver’s insurer owes loss-of-use payments only if it accepts liability. For a timely reported total loss, Utah’s guidance describes payment from the accident until a reasonable settlement offer is made.", sources: ["claims"] }] },
    { title: "A salvage title is a separate consequence", paragraphs: [{ text: "Utah’s salvage definition includes damage whose safe-repair cost exceeds fair market value, or a salvage designation by an insurer or another jurisdiction when further registration and titling remain possible. A repaired salvage vehicle receives a rebuilt/restored brand; repairing it does not remove that history.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Identify whether you are challenging the vehicle’s market value, a specific prior-damage deduction, or a transportation payment. Send a short explanation and supporting records for each disputed item." }],
  faqs: [
    { title: "Can I use appraisal in a Utah dispute?", paragraphs: [{ text: "Ask your own insurer to identify any appraisal provision and its terms. Utah’s third-party guidance says disagreement with another driver’s offer does not create an additional appraisal requirement; it identifies using available own-policy coverage or obtaining legal advice as possible next steps.", sources: ["claims"] }, { text: "Venfour’s review is separate from a policy appraisal appointment." }] },
    { title: "Where can I get help with claim handling?", paragraphs: [{ text: "The Utah Insurance Department’s Property & Casualty Division answers auto-insurance questions, receives complaints, and performs investigations. Keep the valuation, correspondence, and disputed deductions together when requesting help.", sources: ["help"] }] },
  ],
  sources: [
    { id: "value", title: "Utah Insurance Department: auto glossary", url: "https://insurance.utah.gov/consumers/auto/auto-glossary/", locator: "Actual Cash Value; Total Loss", checkedOn: "2026-09-26", claims: ["Market value", "Total-loss explanation"], applicability: "Consumer definitions; unrelated liability-limit figures are not used." },
    { id: "claims", title: "Utah Insurance Department: filing an auto claim", url: "https://insurance.utah.gov/consumers/auto/third-party-auto-claim/", locator: "Introduction; unrepaired damage; rental; deductible; settlement disagreement", checkedOn: "2026-09-26", claims: ["Claim type", "Deductions", "Transportation", "Third-party dispute options"], applicability: "Guidance specifically about claims against another driver’s insurer." },
    { id: "title", title: "Utah DMV: salvage vehicles and branded titles", url: "https://dmv.utah.gov/titles-overview/salvage-vehicles/", locator: "Branded Titles; brand-removal FAQs", checkedOn: "2026-09-26", claims: ["Salvage definition", "Permanent title history"], applicability: "Titling classifications, not a settlement formula." },
    { id: "help", title: "Utah Insurance Department: division directory", url: "https://insurance.utah.gov/about-us/directory/", locator: "Property & Casualty Division", checkedOn: "2026-09-26", claims: ["Consumer assistance"], applicability: "Department information and complaint services." },
  ],
} satisfies StateGuideContent;
