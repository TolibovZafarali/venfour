import type { StateGuideContent } from "../guide-content";

export default {
  code: "WY",
  description: "Understand Wyoming total-loss claim documentation, coverage terms, rental limits, and salvage titles. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Wyoming’s Department of Insurance says it can check that an insurer reasonably investigates a claim and bases a damaged vehicle’s value on an appraisal. Request the valuation and its supporting vehicle details so you can identify the specific basis for the offer.", sources: ["help"] }],
  rules: [
    { title: "Coverage and deductible come from the policy", paragraphs: [{ text: "Wyoming’s consumer guidance distinguishes collision coverage from comprehensive coverage for other losses, such as theft or hail. Your declarations identify the covered vehicles, limits, and deductibles; the policy form explains conditions and exclusions.", sources: ["policy"] }] },
    { title: "Check rental limits while value is under review", paragraphs: [{ text: "The Department describes rental reimbursement as coverage for a rental after a covered loss, usually subject to both daily and total limits. Ask the insurer for the remaining allowance and its expected end date.", sources: ["policy"] }] },
    { title: "The salvage definition has important exceptions", paragraphs: [{ text: "WYDOT describes salvage as a vehicle declared a total loss by an insurer, or—without insurer involvement—damage exceeding 75% of actual retail cash value. Its salvage-title requirement excludes Wyoming-titled vehicles with more than eight years of service, commercial vehicles, and trailers. The percentage is not a universal settlement formula.", sources: ["title"] }] },
    { title: "A rebuilt vehicle requires additional paperwork", paragraphs: [{ text: "WYDOT’s rebuilt process starts with a Wyoming salvage title, followed by a decal application and law-enforcement VIN inspection. An out-of-state salvage vehicle needs a Wyoming salvage title and rebuilt decal before registration. A seller must disclose an existing title brand to the buyer.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Wyoming’s Department recommends first raising the dispute with the insurer, asking what documentation it needs, and keeping correspondence and notes of calls. Send copies of supporting records and retain the originals.", sources: ["help"] }],
  faqs: [
    { title: "How do I check whether policy appraisal is an option?", paragraphs: [{ text: "Ask your insurer to identify any appraisal clause in your policy and explain how it applies to your disagreement. Wyoming’s consumer guide directs readers to the policy form for its specific coverage, conditions, and exclusions.", sources: ["policy"] }, { text: "An insurer’s initial valuation and a separately invoked policy appraisal are different steps. Venfour’s review does not appoint a policy appraiser." }] },
    { title: "Can the Wyoming Department of Insurance decide my settlement?", paragraphs: [{ text: "The Department investigates complaints and answers policy questions, but says it cannot determine property value, decide the amount of loss, or force payment of a claim. You can complain if the insurer’s response leaves a claim-handling concern unresolved.", sources: ["help"] }] },
  ],
  sources: [
    { id: "help", title: "Wyoming Department of Insurance: consumer information", url: "https://doi.wyo.gov/consumers/information", locator: "Things the Department Can Do; Cannot Do; Filing a Complaint", checkedOn: "2026-09-26", claims: ["Valuation investigation", "Dispute records", "Complaint limits"], applicability: "Consumer assistance; references to an appraisal do not establish a contractual appraisal right." },
    { id: "policy", title: "Wyoming Department of Insurance: insurance topics", url: "https://doi.wyo.gov/consumers/insurance-topics", locator: "Auto: Components of an auto policy; Coverage options; Determine your deductible", checkedOn: "2026-09-26", claims: ["Policy scope", "Coverage types", "Rental limits"], applicability: "Consumer policy guidance; actual terms control." },
    { id: "title", title: "WYDOT: salvage vehicles", url: "https://www.dot.state.wy.us/home/titles_plates_registration/salvage_vehicles.html", locator: "Salvage definition and exceptions; To Obtain a Rebuilt Salvage Decal", checkedOn: "2026-09-26", claims: ["Qualified salvage definition", "Title exceptions", "Rebuilt process", "Disclosure"], applicability: "Titling and registration, with age, vehicle-type, and out-of-state distinctions preserved." },
  ],
} satisfies StateGuideContent;
