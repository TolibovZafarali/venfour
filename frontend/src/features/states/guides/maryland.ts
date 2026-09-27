import type { StateGuideContent } from "../guide-content";

export default {
  code: "MD",
  description: "Understand Maryland total-loss valuations, comparable vehicles, taxes, valuation disclosures, and appraisal options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Maryland’s insurance administration explains that a total-loss offer reflects the vehicle’s actual cash value immediately before the loss. Review the underlying retail valuation separately from deductions and settlement additions.", sources: ["total-loss"] }],
  rules: [
    { title: "The comparable vehicle standard is specific", paragraphs: [{ text: "Maryland’s standard calls for the same make and model, the same or newer year, at least the same major options, and similar or better condition. Mileage must be within the greater of 4,000 miles or 10%, except for limited-production, specialty, or more-than-ten-model-year-old vehicles.", sources: ["total-loss"] }] },
    { title: "Applicable taxes and registration fees belong in the offer", paragraphs: [{ text: "The administration states that a cash settlement offer must include applicable taxes and registration fees. Ask for an itemized calculation so you can distinguish those amounts from the vehicle’s value.", sources: ["total-loss"] }] },
    { title: "Request the valuation explanation in writing", paragraphs: [{ text: "You may request the offer, valuation method and calculation, option values, deductions, and condition-inspection guidelines in writing. The insurer must respond within seven business days of that request.", sources: ["total-loss"] }] },
  ],
  reconsideration: [{ text: "After receiving the written offer, you can submit a written counteroffer supported by substantially similar dealer quotes, listings, or other valuations. The administration’s guide gives the insurer five business days to accept or explain in writing why that evidence does not support a more accurate value.", sources: ["guide"] }],
  faqs: [
    { title: "Is appraisal available in Maryland?", paragraphs: [{ text: "Check your policy. The administration says many policies offer appraisal when a total-loss disagreement remains unresolved. Its guide describes separate appraisers, an umpire, and agreement by any two; you pay your independent appraiser’s fee. Confirm your policy’s requirements before using that process.", sources: ["guide"] }, { text: "Venfour provides valuation review and supporting explanations; it is separate from serving as your policy appraiser." }] },
    { title: "How can the Maryland Insurance Administration help?", paragraphs: [{ text: "The administration investigates complaints about insurance practices. Send a written account with relevant documents. Its guide cautions that some contract disputes cannot be resolved through this process; a complaint does not establish a particular vehicle value.", sources: ["guide"] }] },
  ],
  sources: [
    { id: "total-loss", title: "Maryland Insurance Administration: understanding total loss", url: "https://insurance.maryland.gov/Consumer/Pages/total-loss.aspx", locator: "Total Loss and Insurance; written information requests", checkedOn: "2026-09-26", claims: ["Retail comparables", "Tax and fees", "Valuation disclosure"], applicability: "Covered first-party losses or accepted third-party liability." },
    { id: "guide", title: "Maryland consumer guide to auto insurance", url: "https://insurance.maryland.gov/consumer/documents/publications/autoinsuranceguide.pdf#page=44", locator: "PDF pages 44–45: counteroffer and appraisal; page 47: complaints", checkedOn: "2026-09-26", claims: ["Counteroffer response", "Conditional appraisal", "Complaint process"], applicability: "Appraisal depends on the policy; complaint review has limits." },
  ],
} satisfies StateGuideContent;
