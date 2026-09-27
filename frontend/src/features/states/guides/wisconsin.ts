import type { StateGuideContent } from "../guide-content";

export default {
  code: "WI",
  description: "Understand Wisconsin total-loss market values, local comparison evidence, deductibles, and salvage titles. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Wisconsin’s Office of the Commissioner of Insurance explains actual cash value as the vehicle’s market value at the time of the accident. Its guidance notes that a guide-based offer may miss the vehicle’s exact condition, special equipment, or local market.", sources: ["auto"] }],
  rules: [
    { title: "Local comparisons can support a higher value", paragraphs: [{ text: "OCI recommends written quotations from several used-vehicle dealers and relevant advertisements when disputing the offer. Keep the distinction clear: quotations and listings are asking prices, and actual sale prices may be lower.", sources: ["auto"] }] },
    { title: "Apply the correct deductible to the occurrence", paragraphs: [{ text: "Wisconsin’s guidance describes collision and comprehensive deductibles as applying to each occurrence. Check which loss and coverage the deductible belongs to, especially when separate incidents are being handled together.", sources: ["auto"] }] },
    { title: "Salvage branding has age and damage qualifications", paragraphs: [{ text: "WisDOT’s salvage definition includes non-junk vehicles less than seven years old with non-hail damage costing more than 70% of fair market value to repair. It also includes vehicles of any model year last titled elsewhere with a salvage brand. Hail has separate branding conditions.", sources: ["title"] }] },
    { title: "Keeping salvage involves inspection before registration", paragraphs: [{ text: "A salvage vehicle must pass Wisconsin’s salvage inspection before receiving registration plates. The inspection checks identification, equipment, and safe operation. After passing, the brand becomes rebuilt salvage; a title brand remains part of the vehicle’s record.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Match your comparisons to the vehicle’s year, trim, equipment, mileage, and condition. Label asking prices accurately and explain the differences instead of treating every advertised vehicle as an equivalent replacement." }],
  faqs: [
    { title: "Can a Wisconsin policy include appraisal?", paragraphs: [{ text: "OCI’s insurance-law guide explains that a policy may contain an approved independent-appraisal provision. If your policy includes one, ask the insurer for the complete clause and its requirements and costs before using it.", sources: ["appraisal"] }, { text: "Venfour’s review is separate from a policy appraisal appointment." }] },
    { title: "How do I raise a concern with Wisconsin OCI?", paragraphs: [{ text: "OCI recommends asking the insurer to resolve the issue first. If it remains unresolved, you can file an insurance complaint and provide supporting information through OCI’s complaint process.", sources: ["help"] }] },
  ],
  sources: [
    { id: "auto", title: "Wisconsin OCI: automobile insurance FAQs", url: "https://oci.wi.gov/Pages/Consumers/PI-233.aspx", locator: "Physical Damage Coverage; The Claims Process", checkedOn: "2026-09-26", claims: ["Market value", "Local quotations", "Asking-price limitation", "Deductibles"], applicability: "Consumer auto guidance; its broad total-loss percentage summary is not used as a universal legal threshold." },
    { id: "title", title: "WisDOT: title brands", url: "https://wisconsindot.gov/Pages/dmv/vehicles/title-plates/brands.aspx", locator: "Title brand introduction; Salvage vehicle; Rebuilt salvage", checkedOn: "2026-09-26", claims: ["Qualified salvage definition", "Inspection", "Permanent brand"], applicability: "Titling rules distinguish vehicle age, damage type, and prior out-of-state brands." },
    { id: "appraisal", title: "Wisconsin OCI: guide to insurance law", url: "https://oci.wi.gov/Documents/Consumers/PI-060.pdf#page=124", locator: "Page 124: May liability policies contain appraisal or arbitration provisions?", checkedOn: "2026-09-26", claims: ["Approved policy appraisal provisions"], applicability: "August 2026 edition, citing section 631.85; availability depends on the policy." },
    { id: "help", title: "Wisconsin OCI: filing an insurance complaint", url: "https://oci.wi.gov/Pages/Consumers/Filing-a-Complaint.aspx", locator: "Before You File: Consider, Learn, and Gather", checkedOn: "2026-09-26", claims: ["Complaint route"], applicability: "Consumer assistance after contacting the insurer." },
  ],
} satisfies StateGuideContent;
