import type { StateGuideContent } from "../guide-content";

export default {
  code: "MT",
  description: "Understand Montana total-loss valuations, local market evidence, valuation records, and retained salvage. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Montana’s insurance regulator describes actual cash value as the vehicle’s market value immediately before the accident. Comparable vehicles should account for make, model, mileage, interior, and upgrades.", sources: ["auto"] }],
  rules: [
    { title: "The market survey starts locally", paragraphs: [{ text: "CSI explains that insurers research similar vehicles in your area and may expand the survey when local comparables are unavailable. Check the location and equipment of each vehicle in the report.", sources: ["auto"] }] },
    { title: "You should receive the valuation support", paragraphs: [{ text: "CSI states that insurers must provide copies of the information used to establish actual cash value. Request those records before preparing a counteroffer so your response addresses the actual evidence.", sources: ["auto"] }] },
    { title: "Salvage road use requires inspection and retitling", paragraphs: [{ text: "Montana requires inspection before a salvage vehicle returns to public roads, with ownership and repair-part records presented for review. After inspection, the owner applies for a rebuilt-salvage title. A separate temporary permit can authorize travel to and from the inspection site.", sources: ["title"] }] },
    { title: "Check the tax rules where you buy the replacement", paragraphs: [{ text: "Montana has no general-use sales tax, but another state’s rules may apply to an out-of-state purchase. Montana’s Revenue Department directs residents to that state’s tax agency for its nonresident rules. This does not determine which fees an insurer owes in your settlement.", sources: ["tax"] }] },
  ],
  reconsideration: [{ text: "CSI recommends doing your own local market research and providing copies to the adjuster. Explain factual differences between the insurer’s comparisons and your vehicle; sentimental value does not establish market value.", sources: ["auto"] }],
  faqs: [
    { title: "Can I pursue appraisal in Montana?", paragraphs: [{ text: "The consumer guide published by CSI recommends checking your policy for an appraisal clause if you disagree about claim value. Ask the insurer to explain availability, costs, and requirements for your policy before choosing that route.", sources: ["guide"] }, { text: "Venfour’s review is separate from a policy appraisal appointment." }] },
    { title: "Can CSI decide what my vehicle is worth?", paragraphs: [{ text: "CSI answers insurance questions and accepts complaints, but it explicitly states that it lacks authority to determine a vehicle’s value. Its auto page provides consumer-assistance contacts.", sources: ["auto"] }] },
  ],
  sources: [
    { id: "auto", title: "Montana CSI: auto insurance", url: "https://csimt.gov/your-insurance/auto/", locator: "Totaled vehicle FAQ; Can the CSI determine the value of my car?", checkedOn: "2026-09-26", claims: ["Local survey", "Valuation records", "Complaint limits"], applicability: "Consumer auto claims guidance." },
    { id: "title", title: "Montana Code section 61-3-212", url: "https://mca.legmt.gov/bills/mca/title_0610/chapter_0030/part_0020/section_0120/0610-0030-0020-0120.html", locator: "Subsections (1)–(4)", checkedOn: "2026-09-26", claims: ["Inspection", "Retitling", "Temporary permit"], applicability: "Vehicles classified as salvage." },
    { id: "tax", title: "Montana Revenue: sales tax guidance", url: "https://revenue.mt.gov/taxes/general-sales-tax", locator: "Introduction; Montana Residents Shopping in Another State", checkedOn: "2026-09-26", claims: ["General sales tax", "Out-of-state purchases"], applicability: "Purchase taxation, not insurer settlement obligations." },
    { id: "guide", title: "CSI-published consumer guide to auto insurance", url: "https://csimt.gov/wp-content/uploads/2022/11/publication-aut-pp-consumer-auto.pdf#page=15", locator: "PDF page 15: Filing a Claim", checkedOn: "2026-09-26", claims: ["Checking the policy for appraisal"], applicability: "National consumer guide published by CSI; no statewide appraisal entitlement." },
  ],
} satisfies StateGuideContent;
