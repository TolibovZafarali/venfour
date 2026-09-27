import type { StateGuideContent } from "../guide-content";

export default {
  code: "WA",
  description: "Understand Washington total-loss values, valuation reports, taxes, salvage deductions, and appraisal rights. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Washington’s cash-settlement rule bases the offer on a comparable vehicle’s actual cash value, less any applicable policy deductible. The rule provides several permitted valuation methods.", sources: ["settlement"] }],
  rules: [
    { title: "The report should let you check the comparisons", paragraphs: [{ text: "Washington’s valuation-report rule calls for inspection details, equipment, mileage, and valuation information. Comparable entries include their source, date, asking price, available sold price, location, and identifying information. A computerized search using more than 30 comparisons may list only 30; weighting must be explained.", sources: ["report"] }] },
    { title: "Applicable taxes and fees are part of the settlement", paragraphs: [{ text: "The settlement includes applicable government taxes and fees you would have incurred buying the loss vehicle immediately before the loss. This applies whether you retain the vehicle or later transfer ownership.", sources: ["settlement"] }] },
    { title: "Adjustments must be itemized and explained", paragraphs: [{ text: "Additions and deductions require specific dollar amounts and an explanation. Offers must use verifiable amounts and appropriate equipment, mileage, or condition adjustments. The insurer must consider relevant information you supply.", sources: ["settlement"] }] },
    { title: "Keeping the vehicle can mean a salvage deduction", paragraphs: [{ text: "If you keep the vehicle, the insurer may deduct salvage value. On request, it must identify a buyer willing to pay that amount without an additional charge; the rule sets conditions for that purchase option.", sources: ["settlement"] }] },
  ],
  reconsideration: [{ text: "Request an accurate copy of the valuation report, then identify the specific comparisons or adjustments your evidence challenges.", sources: ["settlement"] }],
  faqs: [
    { title: "Do Washington policies have to offer appraisal?", paragraphs: [{ text: "Auto policies with first-party physical-damage coverage issued or renewed effective on or after January 1, 2026 must include appraisal rights for disputes over actual cash value and loss amount. Either party can make a written demand under the required clause; each pays its appraisal expenses and shares the umpire’s cost. Check your policy’s applicable terms.", sources: ["appraisal"] }, { text: "Venfour’s review is separate from serving as your policy appraiser." }] },
    { title: "Where can I raise a claim-handling concern?", paragraphs: [{ text: "Washington’s Office of the Insurance Commissioner accepts complaints about insurers and can request a response. Its consumer team also answers insurance questions and can refer matters outside its jurisdiction.", sources: ["help"] }] },
  ],
  sources: [
    { id: "settlement", title: "Washington WAC 284-30-391: total-loss settlements", url: "https://apps.leg.wa.gov/wac/default.aspx?cite=284-30-391", locator: "Version effective before October 18, 2026: subsections (2), (4), and (5)", checkedOn: "2026-09-26", claims: ["Cash valuation", "Taxes and fees", "Adjustments", "Retained salvage", "Requested report"], applicability: "Current total-loss settlement standards; later-effective text on the same page is not used." },
    { id: "report", title: "Washington WAC 284-30-392: valuation reports", url: "https://apps.leg.wa.gov/wac/default.aspx?cite=284-30-392", locator: "Version effective before October 18, 2026: subsections (1)–(4)", checkedOn: "2026-09-26", claims: ["Report contents", "Comparable details", "Weighting"], applicability: "Current report requirements; later-effective text on the same page is not used." },
    { id: "appraisal", title: "Washington RCW 48.18.620: automobile appraisal clauses", url: "https://app6.leg.wa.gov/rcw/default.aspx?cite=48.18.620", locator: "Subsection (1)", checkedOn: "2026-09-26", claims: ["Appraisal provision requirement", "Policy date and coverage scope", "Costs"], applicability: "First-party physical-damage auto policies issued or renewed effective on or after January 1, 2026." },
    { id: "help", title: "Washington OIC: complaints", url: "https://www.insurance.wa.gov/complaints-appeals-fraud/complaints", locator: "Introduction; Online services; Get help", checkedOn: "2026-09-26", claims: ["Complaint process", "Consumer assistance"], applicability: "Insurance consumer assistance." },
  ],
} satisfies StateGuideContent;
