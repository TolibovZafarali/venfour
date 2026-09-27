import type { StateGuideContent } from "../guide-content";

export default {
  code: "TX",
  description: "Understand Texas total-loss valuations, salvage deductions, replacement-vehicle taxes, and dispute options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [
    {
      text: "The Texas Department of Insurance explains that actual cash value reflects replacement cost after depreciation for age and wear. Your remaining loan balance is a separate issue. Review the vehicle description and market evidence behind the offer instead of assuming the loan determines the vehicle’s value.",
      sources: ["tx-auto-guide"],
    },
  ],
  rules: [
    {
      title: "The salvage-title definition is not a guaranteed settlement formula.",
      paragraphs: [
        {
          text: "Texas’s salvage definition includes damage to, or a missing, major component when specified repair costs exceed the vehicle’s actual cash value immediately before the damage. The calculation excludes repainting materials and labor and sales tax on repairs. An out-of-state salvage title is another route into the definition.",
          sources: ["tx-salvage-code"],
        },
        {
          text: "That title definition does not mean every insurer must wait for repair costs to reach the vehicle’s full value before declaring a total loss. TDI explains that an insurer may total a vehicle even when repairs would cost less. Ask for both the repair estimate and the valuation used in the decision.",
          sources: ["tx-total-loss"],
        },
      ],
    },
    {
      title: "Keeping the damaged vehicle reduces the payment.",
      paragraphs: [
        {
          text: "TDI says the insurer subtracts the vehicle’s salvage value if you keep it. Tell the insurer early that you are considering this option, and request the deduction and resulting payment in writing. Check the title and road-use requirements before assuming the retained vehicle can be driven.",
          sources: ["tx-total-loss"],
        },
        {
          text: "Texas DMV distinguishes a rebuildable salvage vehicle from a nonrepairable vehicle that has value only as parts or scrap. A nonrepairable vehicle cannot be rebuilt for road use. Confirm the classification before spending money on repairs.",
          sources: ["tx-salvage-dmv"],
        },
      ],
    },
    {
      title: "Insurance proceeds do not reduce the replacement vehicle’s taxable price.",
      paragraphs: [
        {
          text: "The Texas Comptroller says motor vehicle tax is due when an insurer buys a replacement vehicle after a total loss or you buy one with the settlement money. The cash settlement cannot be deducted from the replacement’s taxable amount. A private-party purchase may also be subject to standard presumptive value procedures.",
          sources: ["tx-replacement-tax"],
        },
        {
          text: "This guidance concerns tax on the replacement purchase. Keep that question separate from the vehicle value and other amounts shown in your insurance settlement; ask the insurer to explain those components individually.",
          sources: ["tx-replacement-tax"],
        },
      ],
    },
  ],
  reconsideration: [
    {
      text: "TDI recommends collecting local dealer quotes, comparable advertisements, and documentation of special features when you disagree with a total-loss value. Explain which evidence is relevant to your vehicle and ask how it affects the report.",
      sources: ["tx-total-loss"],
    },
  ],
  faqs: [
    {
      title: "Does Texas require an appraisal provision?",
      paragraphs: [
        {
          text: "Texas law requires an appraisal provision in covered personal automobile policies delivered, issued for delivery, or renewed in Texas on or after January 1, 2026. Commercial policies are excluded. The process addresses disagreement between the policyholder and insurer over the amount of loss; it does not change the policy’s other terms.",
          sources: ["tx-appraisal-law"],
        },
        {
          text: "TDI explains that appraisal is not available against another person’s insurer. Ask your own insurer for the applicable clause and review the selection procedure, costs, and effect of the outcome. TDI describes each side paying its appraiser and sharing the umpire’s expenses.",
          sources: ["tx-auto-guide"],
        },
        { text: "Venfour’s valuation review is a separate service. Venfour does not act as the appraiser appointed under your policy." },
      ],
    },
    {
      title: "Can the Texas Department of Insurance resolve the value disagreement?",
      paragraphs: [
        {
          text: "You can submit a written complaint to TDI, but its auto insurance guide says it cannot decide fault or determine damage amounts. Explain the claim-handling concern and include supporting documents. TDI’s consumer help number is 800-252-3439.",
          sources: ["tx-auto-guide"],
        },
      ],
    },
  ],
  sources: [
    {
      id: "tx-auto-guide",
      title: "Texas auto insurance guide",
      url: "https://www.tdi.texas.gov/pubs/consumer/cb020.html",
      locator: "Settling claims; What if the insurance company totals my car?; Resolving problems",
      checkedOn: "2026-09-26",
      claims: ["Actual cash value and loan balance", "Appraisal scope and costs", "Complaint limits and contact"],
      applicability: "Consumer auto guidance; appraisal discussion concerns the policyholder’s own insurer.",
    },
    {
      id: "tx-appraisal-law",
      title: "Texas appraisal requirements under SB 458",
      url: "https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00458F.htm",
      locator: "Section 1: Insurance Code §§ 1813.001, 1813.003–.004; Section 2(a)",
      checkedOn: "2026-09-26",
      effectiveOn: "2025-09-01",
      claims: ["Required provision", "Policy-date applicability", "Policyholder-insurer amount-of-loss scope"],
      applicability: "Covered personal automobile policies delivered, issued for delivery, or renewed in Texas on or after January 1, 2026; excludes commercial policies.",
    },
    {
      id: "tx-salvage-code",
      title: "Texas Transportation Code § 501.091(15)",
      url: "https://tcss.legis.texas.gov/resources/TN/htm/TN.501.htm#501.091",
      locator: "Section 501.091(15)(A)–(B)",
      checkedOn: "2026-09-26",
      claims: ["Salvage definition and repair-cost exclusions"],
      applicability: "Title classification; not an insurer settlement-value formula or universal total-loss decision threshold.",
    },
    {
      id: "tx-total-loss",
      title: "Texas guidance when your car is totaled",
      url: "https://www.tdi.texas.gov/tips/car-totaled.html",
      locator: "What does ‘totaled’ mean?; What if I think my car is worth more?; Can I fix it?",
      checkedOn: "2026-09-26",
      claims: ["Insurer total-loss decision", "Retained salvage deduction", "Local evidence for reconsideration"],
      applicability: "General consumer guidance; the insurer’s decision and vehicle title requirements are separate questions.",
    },
    {
      id: "tx-salvage-dmv",
      title: "Texas DMV salvage and nonrepairable classifications",
      url: "https://www.txdmv.gov/dealers/licensing/salvage-dealer",
      locator: "Salvage Vehicles, opening paragraphs",
      checkedOn: "2026-09-26",
      claims: ["Rebuildable and nonrepairable distinction"],
      applicability: "Vehicle classification guidance; licensing instructions elsewhere on the page are not customer service requirements.",
    },
    {
      id: "tx-replacement-tax",
      title: "Texas tax treatment of insurance settlement transfers",
      url: "https://comptroller.texas.gov/taxes/publications/96-254/insurance-settlement-transfers.php",
      locator: "Replacement Motor Vehicle",
      checkedOn: "2026-09-26",
      claims: ["Replacement-purchase tax", "No settlement deduction from taxable amount", "Private-party valuation procedures"],
      applicability: "Motor vehicle tax on a replacement purchase; does not establish which amounts an insurer owes in a settlement.",
    },
  ],
} satisfies StateGuideContent;
