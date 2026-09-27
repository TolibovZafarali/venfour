import type { StateGuideContent } from "../guide-content";

export default {
  code: "MI",
  description: "Review Michigan total-loss offers, policy deductions, claim documentation, and salvage title requirements. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Michigan’s insurance guide illustrates a total-loss recovery using the car’s actual cash value less the applicable deductible. Review the vehicle valuation and policy deduction separately, then check the report’s mileage, equipment, and condition details.", sources: ["guide"] }],
  rules: [
    { title: "Check the coverage and deductible in your own policy", paragraphs: [{ text: "DIFS explains that the declarations page identifies coverage limits and deductibles, while the policy and endorsements contain the detailed terms. Use those documents when checking a deduction or asking which coverage applies to your loss.", sources: ["guide"] }] },
    { title: "Ask for an itemized settlement explanation", paragraphs: [{ text: "DIFS’s claims guidance recommends obtaining an itemized offer and asking for the exact policy language behind a disagreement. Keep copies of correspondence and records of conversations, including dates and the person you spoke with.", sources: ["claims"] }] },
    { title: "A salvage title restricts road use", paragraphs: [{ text: "A salvage-titled vehicle cannot be plated or driven on public roads until it is recertified and retitled. Michigan’s Secretary of State describes the repair documentation, inspection, and rebuilt-title process. The rebuilt-salvage brand alerts later owners to the vehicle’s history.", sources: ["title"] }] },
  ],
  reconsideration: [{ text: "DIFS recommends supplying records of improvements and seeking clarification before accepting a disputed settlement. Send a concise correction list with supporting documents, and ask which report entries the insurer changed.", sources: ["claims"] }],
  faqs: [
    { title: "How do I check whether appraisal is an option in Michigan?", paragraphs: [{ text: "Ask your insurer to identify any appraisal clause and explain its process, fees, and scope. DIFS emphasizes reading the policy and asking for the specific language involved in a claim disagreement. Have that discussion before hiring an appraiser.", sources: ["claims"] }, { text: "Venfour’s review does not appoint a policy appraiser or determine coverage." }] },
    { title: "What can DIFS do about a Michigan claim complaint?", paragraphs: [{ text: "Try resolving the issue directly with the insurer first. DIFS accepts complaints about unfair delay, denial, or other failures to follow the policy or law. It reviews your documents, obtains the company’s written response, and explains its findings and possible options.", sources: ["help"] }] },
  ],
  sources: [
    { id: "guide", title: "DIFS: guide to automobile insurance", url: "https://www.michigan.gov/difs/-/media/Project/Websites/difs/Publication/Auto/Auto_Insurance_Guide.pdf?hash=C491AAF60ED0BDB1CF5ED322D8FA922A&rev=fc722f6da32641af82c9c2dc04365eb5#page=15", locator: "PDF pages 15–17: policy documents and physical damage example", checkedOn: "2026-09-26", claims: ["Policy components", "Value and deductible distinction"], applicability: "General policy explanation; historical coverage limits elsewhere are not used." },
    { id: "claims", title: "DIFS: how to be claim smart", url: "https://www.michigan.gov/difs/-/media/Project/Websites/difs/Publication/Insurance/FIS-PUB_6120.pdf?hash=66D894551CBCB758E61CE11760C616AE&rev=251d85b9956540559f63e13f6476a3c3", locator: "Points 1, 4–7", checkedOn: "2026-09-26", claims: ["Itemized explanation", "Evidence", "Policy questions"], applicability: "Practical claims guidance; no statewide appraisal entitlement asserted." },
    { id: "title", title: "Michigan Secretary of State: titles", url: "https://www.michigan.gov/sos/vehicle/titles", locator: "Salvage vehicles; rebuilt title application", checkedOn: "2026-09-26", claims: ["Road-use restrictions", "Inspection", "Rebuilt brand"], applicability: "Vehicles already classified with a salvage title." },
    { id: "help", title: "DIFS: auto insurance complaints", url: "https://www.michigan.gov/autoinsurance/file-a-complaint", locator: "File a Complaint", checkedOn: "2026-09-26", claims: ["Complaint review process"], applicability: "Auto insurance handling and compliance concerns." },
  ],
} satisfies StateGuideContent;
