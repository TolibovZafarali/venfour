import type { StateGuideContent } from "../guide-content";

export default {
  code: "MS",
  description: "Understand Mississippi total-loss valuation, policy terms, salvage classifications, and consumer assistance. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Mississippi’s insurance department explains that the policy defines the measure of recovery, often pre-loss actual cash value or the amount needed for proper repair. Ask the insurer to identify the applicable provision and provide its vehicle valuation.", sources: ["claims"] }],
  rules: [
    { title: "Salvage classification includes specific exceptions", paragraphs: [{ text: "Revenue’s salvage guidance covers vehicles acquired by insurers through total-loss payments. Its definition excludes vehicles at least ten years old worth $1,500 or less, and vehicles requiring repair or replacement of five or fewer minor component parts. These title rules do not establish the amount of an insurance settlement.", sources: ["title"] }] },
    { title: "Keeping a salvage vehicle carries rebuilding duties", paragraphs: [{ text: "A salvage title prevents road use and registration. For owner-retained vehicles where the insurer does not obtain a salvage certificate, Revenue describes rebuilding and inspection, followed by a rebuilt-title and registration application through the county tax collector with the insurer’s letter and inspection forms.", sources: ["title"] }] },
    { title: "Understand any repair alternative before agreeing", paragraphs: [{ text: "Mississippi prohibits conditioning claim payment on use of a particular repair shop. If repair remains an option, the department advises resolving differences between the insurer’s estimate and the shop’s charges before work starts; choosing a more expensive shop can leave a difference for you to pay.", sources: ["claims"] }] },
  ],
  reconsideration: [{ text: "Build your request around verifiable vehicle facts and comparable listings. Ask the adjuster to distinguish the pre-loss value, policy deductions, and any amount attributed to retained salvage. Preserve the written response alongside your original request." }],
  faqs: [
    { title: "How do I check appraisal options in Mississippi?", paragraphs: [{ text: "Ask your insurer whether your policy includes an appraisal clause and request its wording, costs, and requirements before proceeding. The department’s guidance emphasizes checking the policy to understand how the company will settle the loss.", sources: ["claims"] }, { text: "Venfour’s review is separate from a formal policy appraisal appointment." }] },
    { title: "Can Mississippi’s insurance department decide the payment?", paragraphs: [{ text: "MID can assist with claim and policy questions. It explains that the Commissioner cannot decide disputed facts or order a company to pay a claim. Provide the valuation and correspondence when requesting assistance.", sources: ["claims"] }] },
  ],
  sources: [
    { id: "claims", title: "Mississippi Insurance Department: automobile physical damage claims", url: "https://www.mid.ms.gov/mississippi-insurance-department/consumers/consumer-resources/automobile-physical-damage-claims/", locator: "Measure of Damage; Steering; Amounts to be Paid; Getting Assistance", checkedOn: "2026-09-26", claims: ["Policy valuation", "Repair choice", "Consumer assistance limits"], applicability: "Policy-based physical damage guidance; no universal appraisal right asserted." },
    { id: "title", title: "Mississippi Department of Revenue: salvage vehicles", url: "https://www.dor.ms.gov/motor-vehicle/salvage-vehicles", locator: "Definitions; General Information; Owner Retained Total Loss Motor Vehicle", checkedOn: "2026-09-26", claims: ["Classification exceptions", "Road restrictions", "Owner-retained process"], applicability: "Salvage titling and rebuilding, separate from settlement valuation." },
  ],
} satisfies StateGuideContent;
