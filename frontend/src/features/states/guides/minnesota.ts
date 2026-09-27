import type { StateGuideContent } from "../guide-content";

export default {
  code: "MN",
  description: "Understand Minnesota total-loss valuations, local comparables, settlement taxes and fees, and appraisal options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Minnesota’s Department of Commerce describes valuation through comparable vehicles in the insured’s local market, adjusted for mileage, condition, and options. A market survey or listing is useful only when the vehicle details make the comparison meaningful.", sources: ["claims"] }],
  rules: [
    { title: "Local replacement evidence comes first", paragraphs: [{ text: "For covered first-party ACV or like-kind total losses, excluding automobile dealers, Minnesota’s cash-settlement standard uses a comparable local vehicle if available. If unavailable, it uses one of at least two quotations from qualified local sources, with all quotation information supplied before settlement.", sources: ["settlement"] }] },
    { title: "Taxes and ownership fees are settlement components", paragraphs: [{ text: "That standard includes applicable taxes, ownership-transfer fees, and license fees at least prorated for the replaced vehicle’s unexpired license term, less the policy deductible. Ask for these items separately from the vehicle valuation.", sources: ["settlement"] }] },
    { title: "A different settlement method needs an explanation", paragraphs: [{ text: "A settlement or offer departing from the specified valuation procedure must be documented and justified in detail, and its basis explained to the insured. Ask how the report’s method fits those requirements.", sources: ["settlement"] }] },
    { title: "Title branding depends on the vehicle and transfer", paragraphs: [{ text: "When a licensed insurer acquires a vehicle through paying damages, Minnesota generally requires a salvage brand for late-model or high-value vehicles and a prior-salvage brand for other vehicles. Recovered intact vehicles are excluded from that provision. Title classification does not set the settlement value.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Separate factual errors from disagreement about adjustments. For each comparable, identify its location, mileage, configuration, asking price, and listing date; ask the insurer to explain why it is a useful match for your vehicle." }],
  faqs: [
    { title: "Can I request appraisal in Minnesota?", paragraphs: [{ text: "Commerce recommends asking your insurer whether your dispute can use the policy’s appraisal process. Its explanation involves each side hiring an appraiser and, if necessary, jointly selecting an umpire. You pay your appraiser and half the umpire’s fee.", sources: ["claims"] }, { text: "Venfour’s review is separate from serving as your policy appraiser." }] },
    { title: "Where can I raise a Minnesota insurance complaint?", paragraphs: [{ text: "The Department of Commerce’s claims page lists its complaint service at 651-539-1600, with 800-657-3602 for Greater Minnesota. Bring the valuation, your supporting evidence, and the insurer’s responses so the issue is clear.", sources: ["claims"] }] },
  ],
  sources: [
    { id: "claims", title: "Minnesota Commerce: filing an auto claim", url: "https://mn.gov/commerce/insurance/auto/file-a-claim/", locator: "Determining the market value of a totaled vehicle; Contact Us", checkedOn: "2026-09-26", claims: ["Market comparisons", "Appraisal costs", "Consumer assistance"], applicability: "Consumer claims guidance; appraisal requires checking policy availability." },
    { id: "settlement", title: "Minnesota Statutes section 72A.201", url: "https://www.revisor.mn.gov/statutes/cite/72A.201", locator: "Subdivision 6(1)", checkedOn: "2026-09-26", claims: ["First-party settlement methods", "Tax and fees", "Explanation of deviations"], applicability: "ACV or like-kind policy settlements for insureds other than automobile dealers." },
    { id: "title", title: "Minnesota Statutes section 168A.151", url: "https://www.revisor.mn.gov/statutes/cite/168A.151", locator: "Subdivision 1(a)", checkedOn: "2026-09-26", claims: ["Insurer-acquired vehicle branding"], applicability: "Excludes recovered intact vehicles; statutory vehicle categories control." },
  ],
} satisfies StateGuideContent;
