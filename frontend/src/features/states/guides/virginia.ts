import type { StateGuideContent } from "../guide-content";

export default {
  code: "VA",
  description: "Understand Virginia total-loss valuations, deduction records, storage notices, and policy appraisal options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Virginia’s Bureau of Insurance explains that collision and comprehensive coverage generally pay the current market value of similar vehicles after a total loss. Its guide distinguishes that actual cash value from the price of a brand-new replacement.", sources: ["guide"] }],
  rules: [
    { title: "Request the total-loss valuation", paragraphs: [{ text: "Virginia’s auto-claim rule requires the insurer to provide its total-loss valuation when you request it. Ask for that document before responding to the offer so you can check the vehicle details and calculation.", sources: ["claims"] }] },
    { title: "Deductions require support in the claim file", paragraphs: [{ text: "Betterment or depreciation reductions must be supported in the claim file and itemized in specific dollar amounts. Ask the adjuster to explain the disputed entries; this recordkeeping requirement is separate from a right to receive every internal claim-file document.", sources: ["claims"] }] },
    { title: "Storage payments require notice before they end", paragraphs: [{ text: "Before ending payment for vehicle storage, the insurer must give reasonable notice and allow reasonable time to remove the vehicle. Confirm the cutoff date and the pickup arrangements in writing.", sources: ["claims"] }] },
    { title: "Salvage paperwork depends on the vehicle and claim", paragraphs: [{ text: "Virginia DMV requires an insurer taking possession of a damaged late-model vehicle after paying its value to apply for a salvage certificate. The DMV also describes separate owner-retention reporting rules. Confirm your vehicle’s classification and paperwork before deciding to keep it.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Keep your valuation request, the insurer’s response, and a concise list of corrections together. Attach local vehicle comparisons and photographs that address the specific equipment or condition assumptions in dispute." }],
  faqs: [
    { title: "Can I use a policy appraisal clause in Virginia?", paragraphs: [{ text: "If your policy includes an appraisal clause, check its exact terms. The specimen personal-auto form published by the Bureau allows either party to demand appraisal over the amount of loss, with each paying its appraiser and sharing other appraisal and umpire expenses. Your policy controls.", sources: ["appraisal"] }, { text: "Venfour’s review is separate from a policy appraisal appointment." }] },
    { title: "Can the Bureau of Insurance set my vehicle’s value?", paragraphs: [{ text: "The Bureau can seek an insurer’s explanation and review compliance with Virginia law and policy provisions. It says it cannot determine the monetary value of a total loss or force payment outside the policy’s terms.", sources: ["help"] }] },
  ],
  sources: [
    { id: "guide", title: "Virginia SCC: auto insurance guide", url: "https://www.scc.virginia.gov/consumers/insurance/property-casualty-consumer/virginia-auto-insurance-guide/", locator: "Collision and Other Than Collision Coverage", checkedOn: "2026-09-26", claims: ["Actual cash value"], applicability: "Consumer explanation of collision and comprehensive coverage." },
    { id: "claims", title: "Virginia Administrative Code 14VAC5-400-80", url: "https://law.lis.virginia.gov/admincode/title14/agency5/chapter400/section80/", locator: "Subsections D, E, and G", checkedOn: "2026-09-26", claims: ["Requested valuation", "Deduction records", "Storage notice"], applicability: "Automobile claim settlement standards." },
    { id: "title", title: "Virginia DMV: declaring a vehicle salvage", url: "https://www.dmv.virginia.gov/vehicles/title/sal-veh-law-req/declar-salvage", locator: "Declaration by Insurance Company", checkedOn: "2026-09-26", claims: ["Insurer salvage application", "Owner-retention reporting"], applicability: "Qualified late-model vehicle title rules, not a universal total-loss threshold." },
    { id: "appraisal", title: "Virginia SCC: specimen personal auto policy", url: "https://www.scc.virginia.gov/media/sccvirginiagov-home/regulated-industries/insurance/insurance-companies/property-casualty-companies/personal-commercial-auto-forms/pp-00-01-09-18.pdf#page=11", locator: "PDF page 11: Appraisal", checkedOn: "2026-09-26", claims: ["Example appraisal terms"], applicability: "Specimen form PP 00 01 09 18; actual policy terms must be checked." },
    { id: "help", title: "Virginia SCC: file an insurance complaint", url: "https://www.scc.virginia.gov/consumers/insurance/file-an-insurance-complaint/", locator: "What we can do; What we can’t do", checkedOn: "2026-09-26", claims: ["Complaint assistance", "Limits on resolving value disputes"], applicability: "Bureau consumer services for Virginia-issued policies." },
  ],
} satisfies StateGuideContent;
