import type { StateGuideContent } from "../guide-content";

export default {
  code: "LA",
  description: "Understand Louisiana total-loss valuations, local market evidence, salvage classifications, and review options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Louisiana’s insurance department describes a total-loss payment as the vehicle’s value immediately before the accident. Its guidance encourages checking what a similar vehicle is worth in your area before agreeing to the settlement.", sources: ["consumer"] }],
  rules: [
    { title: "Local evidence and first-party cash settlements", paragraphs: [{ text: "For qualifying first-party total-loss policies, Louisiana allows a local retail-dealer survey, a recognized industry valuation source, or an agreed expert appraisal. A dealer survey may move to the nearest reasonable market if local dealers are unavailable. The local market centers on where the vehicle is principally garaged or usually located.", sources: ["settlement"] }] },
    { title: "Database valuations and supporting documents", paragraphs: [{ text: "When the statutory database method is used, its valuation documents must be provided to the claimant. Two independent appraisals showing a higher local value through measurable factors, including pre-loss condition, require use of that local value under this method.", sources: ["settlement"] }] },
    { title: "The title definition has a hail exception", paragraphs: [{ text: "Louisiana’s title law defines total loss at damage equal to 75% or more of market value under the current NADA handbook. Qualifying cosmetic hail damage instead receives a hail-damage brand. This title classification is separate from establishing the amount of a settlement.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "The department recommends researching comparable vehicles independently and giving the insurer evidence supporting a higher value. Organize that evidence around the vehicle’s actual configuration and pre-loss condition.", sources: ["consumer"] }],
  faqs: [
    { title: "Can an appraisal help in Louisiana?", paragraphs: [{ text: "For the first-party settlements described above, one statutory option is a qualified appraiser agreed upon by both sides, producing a written, nonbinding appraisal. Ask your insurer how that option and any appraisal clause in your own policy apply before paying an appraiser.", sources: ["settlement"] }, { text: "Venfour’s valuation review is separate from appointment as your appraiser under an insurance policy." }] },
    { title: "Where can I get help with a Louisiana claim?", paragraphs: [{ text: "The Louisiana Department of Insurance accepts complaints about personal auto damage claims and answers policy questions through its consumer services office. Its auto resources page provides the complaint route and contact details.", sources: ["help"] }] },
  ],
  sources: [
    { id: "consumer", title: "Louisiana Department of Insurance: accident FAQs", url: "https://ldi.la.gov/consumers/resources-publications/consumer-advocacy/newsletters/may-2021-volume-12-issue-5", locator: "FAQs After a Car Accident: total loss", checkedOn: "2026-09-26", claims: ["Pre-loss value", "Independent local research"], applicability: "Consumer explanation; title exceptions checked against current statute." },
    { id: "settlement", title: "Louisiana R.S. 22:1892", url: "https://www.legis.la.gov/legis/Law.aspx?d=509041", locator: "B(5)(a)–(d)", checkedOn: "2026-09-26", claims: ["Valuation methods", "Database evidence", "Agreed appraisal"], applicability: "Specified first-party cash settlements under ACV or like-kind replacement policies." },
    { id: "title", title: "Louisiana R.S. 32:702", url: "https://www.legis.la.gov/legis/Law.aspx?d=88513", locator: "Definitions (13)–(14)", checkedOn: "2026-09-26", claims: ["Title threshold", "Cosmetic hail exception"], applicability: "Motor vehicle title classification." },
    { id: "help", title: "Louisiana Department of Insurance: auto resources", url: "https://www.ldi.la.gov/consumers/insurance-type/auto", locator: "Auto Insurance; complaint and consumer services links", checkedOn: "2026-09-26", claims: ["Consumer assistance"], applicability: "Policy questions and personal auto damage complaints." },
  ],
} satisfies StateGuideContent;
