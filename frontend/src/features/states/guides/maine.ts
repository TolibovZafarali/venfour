import type { StateGuideContent } from "../guide-content";

export default {
  code: "ME",
  description: "Understand Maine total-loss valuations, regional comparables, sales-tax-credit coverage, and appraisal options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [{ text: "Maine’s Bureau of Insurance explains that valuation may use market surveys, guides, or valuation services. Mileage, rust, and unrepaired damage can affect the result. Check that the report describes your vehicle accurately.", sources: ["claims"] }],
  rules: [
    { title: "Comparable vehicles must follow a regional rule", paragraphs: [{ text: "When an insurer uses comparable vehicles, Maine law requires vehicles and values from Maine, New Hampshire, Vermont, Massachusetts, Connecticut, Rhode Island, or New York to the extent available. The insurer may go outside those states only after determining that comparables are unavailable within them.", sources: ["comparables"] }] },
    { title: "Coverage includes the lost sales-tax-credit value", paragraphs: [{ text: "For motor vehicle casualty policies delivered or issued for delivery in Maine covering Maine-registered vehicles, the policy must cover the sales tax credit that a trade-in would have provided at the vehicle’s highest book value when lost or destroyed. Ask the insurer to identify this component separately.", sources: ["tax"] }] },
    { title: "Keeping the vehicle involves a salvage title", paragraphs: [{ text: "The Bureau explains that an insurer applies for a salvage title after declaring a vehicle a total loss. If you keep and repair it, a new title application follows; the title remains branded according to the repairs.", sources: ["claims"] }] },
  ],
  reconsideration: [{ text: "Check the locations of the insurer’s comparables against the regional requirement. For each proposed replacement comparable, save the listing date, location, mileage, equipment, and condition. Ask how any search outside the seven-state region was justified.", sources: ["comparables"] }],
  faqs: [
    { title: "Can I use an appraisal clause in Maine?", paragraphs: [{ text: "If your policy includes appraisal, you and your insurer choose and pay separate appraisers and share an umpire’s cost if needed. The Bureau distinguishes this policy process from a dispute with another driver’s insurer, where that appraisal option is unavailable.", sources: ["claims"] }, { text: "Venfour’s review does not serve as your appointed policy appraiser." }] },
    { title: "Can Maine’s Bureau of Insurance resolve my dispute?", paragraphs: [{ text: "The Bureau can investigate unfair claims handling and insurance-law violations. It does not decide factual questions such as who caused an accident. Provide the valuation, correspondence, and a clear description of the handling issue.", sources: ["claims"] }] },
  ],
  sources: [
    { id: "claims", title: "Maine Bureau of Insurance: auto claims FAQs", url: "https://www.maine.gov/pfr/insurance/frequently-asked-questions/auto-claims", locator: "Valuation, retained vehicle, appraisal, and Bureau assistance FAQs", checkedOn: "2026-09-26", claims: ["Valuation factors", "Salvage process", "Appraisal", "Regulator limits"], applicability: "Policy-dependent claims; first-party appraisal distinguished from third-party disputes." },
    { id: "comparables", title: "Maine Title 24-A, section 2910-B", url: "https://legislature.maine.gov/statutes/24-a/title24-Asec2910-B.html", locator: "Assessment of value of motor vehicle", checkedOn: "2026-09-26", claims: ["Comparable location and availability"], applicability: "Insurer valuations using comparable motor vehicles." },
    { id: "tax", title: "Maine Title 24-A, section 2907", url: "https://legislature.maine.gov/statutes/24-A/title24-Asec2907.html", locator: "Coverage for sales tax credit", checkedOn: "2026-09-26", claims: ["Tax-credit coverage"], applicability: "Maine-issued or delivered motor vehicle casualty policies on Maine-registered vehicles." },
  ],
} satisfies StateGuideContent;
