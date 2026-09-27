import type { StateGuideContent } from "../guide-content";

export default {
  code: "MA",
  description: "Understand Massachusetts total-loss valuations, rental coverage, retained vehicles, and salvage titles. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Massachusetts guidance describes actual cash value at the accident date using comparable retail value, condition, purchase price, improvements, prior damage, and the cost of an available similar vehicle. Ask which valuation sources support the offer.", sources: ["claims"] }],
  rules: [
    { title: "Rental coverage can end while value remains disputed", paragraphs: [{ text: "The Division of Insurance explains that rental payments may stop after a total-loss offer. A disagreement over value does not itself extend coverage. Review the Substitute Transportation terms and get the last covered rental day in writing.", sources: ["claims"] }] },
    { title: "Keeping the vehicle requires an agreement", paragraphs: [{ text: "The insurer has the option to take title when paying the claim and is entitled to the salvage value. If you want to keep the vehicle, the Division recommends negotiating an agreed salvage purchase value with the insurer.", sources: ["claims"] }] },
    { title: "Salvage titles affect future registration", paragraphs: [{ text: "The Registry describes salvage as a stolen, unrecovered vehicle or one considered uneconomical to repair. Subject to exemptions, a salvage title is required after a total loss. Passenger vehicles at least ten years old are among the exemptions. A repairable salvage vehicle needs inspection before registration, and its salvage history remains branded.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "Prepare a short list of corrections with photographs, option records, and comparable listings. Ask for the adjusted value and the retained-salvage figure separately, and confirm the rental cutoff while the review is underway." }],
  faqs: [
    { title: "Should I ask about an appraisal clause in Massachusetts?", paragraphs: [{ text: "Yes—ask the insurer to identify any appraisal or dispute provision in your policy and explain its costs and requirements. Massachusetts permits different approved auto policy forms, so start with your own contract.", sources: ["claims"] }, { text: "Venfour’s review is separate from a policy appraisal appointment." }] },
    { title: "Can the Massachusetts Division of Insurance set my car’s value?", paragraphs: [{ text: "Consumer Services reviews policy and insurance-law compliance and can help communication with the insurer. It cannot determine claim value or fault. Its complaint service also excludes matters where you have an attorney or litigation is underway; check the filing guidance for your situation.", sources: ["help"] }] },
  ],
  sources: [
    { id: "claims", title: "Massachusetts Division of Insurance: auto claims FAQs", url: "https://www.mass.gov/info-details/frequently-asked-questions-about-auto-insurance-claims", locator: "Total loss, rental, retained vehicle, and policy-form FAQs", checkedOn: "2026-09-26", claims: ["Valuation factors", "Rental limits", "Salvage retention", "Policy differences"], applicability: "Consumer policy guidance; coverage depends on the contract." },
    { id: "title", title: "Massachusetts Registry: total loss and salvage vehicles", url: "https://www.mass.gov/info-details/total-loss-and-salvage-vehicles", locator: "What to know; Exemptions to salvage", checkedOn: "2026-09-26", claims: ["Title classification", "Exemptions", "Inspection and branding"], applicability: "Salvage title and registration requirements, distinct from valuation." },
    { id: "help", title: "Massachusetts: filing an insurance complaint", url: "https://www.mass.gov/how-to/filing-an-insurance-complaint", locator: "What you need: We can and We cannot", checkedOn: "2026-09-26", claims: ["Regulator assistance and limits"], applicability: "Consumer Services complaint jurisdiction." },
  ],
} satisfies StateGuideContent;
