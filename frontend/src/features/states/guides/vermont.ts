import type { StateGuideContent } from "../guide-content";

export default {
  code: "VT",
  description: "Understand Vermont total-loss valuation methods, taxes, condition deductions, and valuation disclosures. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Vermont’s total-loss cash method uses at least the average of the applicable NADA retail value at the loss date and a qualifying vendor’s comparable-vehicle retail value. Vehicles absent from the guide require a reasonable, verifiable method, including local-market evidence.", sources: ["rules"] }],
  rules: [
    { title: "Local evidence and special equipment matter", paragraphs: [{ text: "The rule defines the local market within 75 miles of the garaging ZIP code. Qualifying vendor methods prioritize local comparisons and adjust credible geographic price differences. Value-enhancing special equipment is added after the base average, subject to policy limits.", sources: ["rules"] }] },
    { title: "The settlement includes applicable taxes and fees", paragraphs: [{ text: "For qualifying property-damage liability or physical-damage total losses, the cash method includes applicable taxes, registration, and ownership-transfer fees for a comparable vehicle, less any policy deductible.", sources: ["rules"] }] },
    { title: "Valuation documents arrive with the offer", paragraphs: [{ text: "By the settlement-offer date, the insurer must provide its detailed calculation, nonpublic valuation reports, and written notice of the option to contact Vermont’s Insurance Division about a dispute.", sources: ["rules"] }] },
    { title: "Condition deductions need documented support", paragraphs: [{ text: "DFR’s virtual-adjusting advisory says reconditioning deductions require a detailed justification based on an in-person inspection. Condition deductions must reflect more than normal age-and-mileage wear, with the details documented in the valuation report.", sources: ["inspection"] }] },
    { title: "Rebuilding requires records and inspection", paragraphs: [{ text: "Vermont’s rebuilt-title process requires inspection before a rebuilt vehicle can be titled or registered. Keep repair-part bills and ownership records: the inspection checks identification, major-component documentation, and safety standards, and the new title carries a rebuilt brand.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Compare the report’s vehicle description, local comparisons, and condition findings with your records. Ask the adjuster to explain any difference between the base valuation and the final offer." }],
  faqs: [
    { title: "How does appraisal fit a Vermont dispute?", paragraphs: [{ text: "DFR’s December 2025 report explains that a policy appraisal clause lets either the policyholder or insurer invoke a separate valuation process, with independent appraisers and an umpire if needed. Ask for your policy’s clause and cost requirements before proceeding.", sources: ["appraisal"] }, { text: "Venfour’s review is separate from serving as your policy appraiser." }] },
    { title: "Can Vermont DFR help with a valuation concern?", paragraphs: [{ text: "DFR’s Insurance Division provides consumer assistance and a complaint route. Include your offer, valuation report, and explanation of any disputed inspection or deduction when contacting the Division.", sources: ["inspection"] }] },
  ],
  sources: [
    { id: "rules", title: "Vermont DFR: fair claims practices", url: "https://dfr.vermont.gov/reg-bul-ord/fair-claims-practices", locator: "Regulation I-1979-02 (Revised), section 8(B)(2)(a)–(g)", checkedOn: "2026-09-26", claims: ["Valuation method", "Local market", "Taxes and fees", "Offer disclosures"], applicability: "Property-damage liability or physical-damage total losses settled on actual cash value or like-kind replacement." },
    { id: "inspection", title: "Vermont DFR: virtual claims adjusting advisory", url: "https://dfr.vermont.gov/consumer-alert/consumer-advisory-understanding-virtual-claims-adjusting", locator: "Auto Claims Specifics; Need Help?", checkedOn: "2026-09-26", claims: ["Inspection and condition deductions", "Consumer assistance"], applicability: "Consumer guidance on virtual claims adjusting." },
    { id: "title", title: "Vermont DMV: salvage or rebuilt title", url: "https://dmv.vermont.gov/tax-title/vehicle-title/salvage-or-rebuilt-title", locator: "Rebuild the Vehicle; Complete the Rebuilt Vehicle Inspection", checkedOn: "2026-09-26", claims: ["Rebuilt inspection", "Documentation", "Title brand"], applicability: "Rebuilt-vehicle titling; separate from valuation." },
    { id: "appraisal", title: "Vermont DFR: automobile insurance study", url: "https://legislature.vermont.gov/assets/Legislative-Reports/DFR-Act-32-of-2023-Section-12a-Report.pdf#page=24", locator: "Page 24, section 6: Appraisal Clauses", checkedOn: "2026-09-26", claims: ["Policy appraisal process"], applicability: "December 31, 2025 report explaining existing appraisal practice, not its proposed reforms." },
  ],
} satisfies StateGuideContent;
