import type { StateGuideContent } from "../guide-content";

export default {
  code: "WV",
  description: "Understand West Virginia total-loss guide values, sales tax, deductions, and salvage classifications. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "West Virginia requires insurers to use the latest edition of an official used-car guide approved by the Insurance Commissioner as a guide to the minimum value in a total-loss settlement.", sources: ["value"] }],
  rules: [
    { title: "A lower guide-based value needs documentation", paragraphs: [{ text: "The Commissioner’s auto checklist explains that downward deviations need detailed support and measurable, itemized dollar amounts. When the guide omits the vehicle’s retail value, insurers must obtain dealer quotations for similar vehicles and retain their sources in the claim file.", sources: ["checklist"] }] },
    { title: "Sales tax is added to the cash settlement", paragraphs: [{ text: "West Virginia Code section 33-6-33 requires an amount equal to the applicable consumer sales tax to be added to the cash settlement value agreed with the claimant. Ask the adjuster to show this separately in the breakdown.", sources: ["value"] }] },
    { title: "A salvage deduction should identify a buyer", paragraphs: [{ text: "For an insured vehicle’s salvage deduction, the auto checklist requires the insurer to provide a salvage dealer’s name and address who will buy it for the deducted amount. Obtain that information before agreeing to retain the vehicle.", sources: ["checklist"] }] },
    { title: "Cosmetic totals have a distinct title treatment", paragraphs: [{ text: "A retained vehicle with exclusively cosmetic damage requiring no repair for lawful, safe road use may receive a cosmetic-total-loss title instead of a salvage certificate. Flood and fire damage are excluded from that classification. The statute provides separate procedures for repairable and nonrepairable vehicles.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Ask which approved guide and edition the insurer used. Compare its vehicle details with your records, then explain each disputed adjustment and attach relevant dealer quotations or local comparisons." }],
  faqs: [
    { title: "Is appraisal available under every West Virginia auto policy?", paragraphs: [{ text: "The Commissioner’s personal-auto checklist states that appraisal provisions are not required, though included provisions must follow the prescribed standards. If your policy contains a clause, ask for its terms and costs before invoking it.", sources: ["checklist"] }, { text: "Venfour’s review is separate from a policy appraisal appointment." }] },
    { title: "Who handles insurance complaints in West Virginia?", paragraphs: [{ text: "The Offices of the Insurance Commissioner’s Property & Casualty Consumer Services Division handles complaints, including claim delays and denials. It cannot act as your lawyer or decide fault. Its complaint guidance asks for copies of correspondence and policy information.", sources: ["help"] }] },
  ],
  sources: [
    { id: "value", title: "West Virginia Code section 33-6-33", url: "https://code.wvlegislature.gov/33-6-33/", locator: "Valuation of motor vehicle involved in claim", checkedOn: "2026-09-26", claims: ["Approved guide", "Sales tax addition"], applicability: "Motor-vehicle total-loss settlements." },
    { id: "checklist", title: "West Virginia OIC: personal auto review requirements", url: "https://www.wvinsurance.gov/Portals/0/pdf/rates/Auto%202025.pdf?ver=2025-11-04-125627-453", locator: "Page 2: Arbitration and Appraisal; page 7: Adjustment of Total Losses", checkedOn: "2026-09-26", claims: ["Guide adjustments", "Dealer quotations", "Salvage deduction", "Conditional appraisal"], applicability: "Personal-auto filing checklist; quoted settlement provisions concern the insured’s vehicle." },
    { id: "title", title: "West Virginia Code section 17A-4-10", url: "https://code.wvlegislature.gov/17A-4-10/", locator: "Subsections (b)–(e), especially (d)", checkedOn: "2026-09-26", claims: ["Cosmetic-total-loss qualification", "Title classifications"], applicability: "Title procedures; cosmetic classification excludes flood and fire." },
    { id: "help", title: "West Virginia OIC: property and casualty consumer services", url: "https://www.wvinsurance.gov/Consumer-Services-P-C", locator: "How to File an Insurance Complaint; What to send", checkedOn: "2026-09-26", claims: ["Complaint assistance and limits"], applicability: "Property and casualty insurance complaints." },
  ],
} satisfies StateGuideContent;
