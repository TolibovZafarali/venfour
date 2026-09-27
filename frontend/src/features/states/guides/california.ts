import type { StateGuideContent } from "../guide-content";

export default {
  code: "CA",
  description: "Understand California total-loss valuations, settlement taxes and fees, salvage titles, and dispute options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [
    {
      text: "California’s insurance department explains that actual cash value generally means fair market value unless your policy defines it differently. Read your policy alongside the valuation report.",
      sources: ["ca-claims-guide"],
    },
  ],
  rules: [
    {
      title: "Separate vehicle value from settlement taxes and fees.",
      paragraphs: [
        {
          text: "California’s claims guidance says total-loss settlements should reflect a comparable vehicle and include taxes, license fees, and transfer fees. Ask for the value, applicable additions, and deductions separately.",
          sources: ["ca-claims-guide"],
        },
        {
          text: "If you keep the vehicle, the department says a salvage deduction must be fair and identifiable. Request its basis before accepting that option.",
          sources: ["ca-claims-guide"],
        },
      ],
    },
    {
      title: "A salvage certificate and a nonrepairable certificate have different consequences.",
      paragraphs: [
        {
          text: "California DMV can issue a salvage certificate for a damaged vehicle declared a total loss salvage. A nonrepairable certificate is different: once issued, the vehicle cannot be titled or registered again as a revived salvage vehicle. Ask which classification applies before planning repairs or deciding to keep the vehicle.",
          sources: ["ca-salvage"],
        },
        {
          text: "DMV explains that a vehicle reported as uneconomical to repair can receive a salvage-retention status when the registered owner keeps it. Keeping possession does not preserve an ordinary title. Check the DMV requirements as part of the decision, separately from whether the insurer’s valuation is accurate.",
          sources: ["ca-salvage-retention"],
        },
      ],
    },
    {
      title: "Some disputes can qualify for the department’s mediation program.",
      paragraphs: [
        {
          text: "California offers mediation for eligible disputes under personal automobile physical-damage coverage, including disagreement over a total-loss value. The department’s guide lists an overall claim above $7,500 and a disputed amount above $2,000. Commercial automobile claims and claims against another person’s insurer are excluded.",
          sources: ["ca-mediation"],
        },
        {
          text: "The department’s normal complaint process comes before a mediation referral. Coverage and other eligibility restrictions apply, so ask the department to assess your situation. Mediation seeks an agreement; the mediator does not decide a settlement amount for you.",
          sources: ["ca-mediation"],
        },
      ],
    },
  ],
  reconsideration: [
    {
      text: "California’s insurance department recommends asking your claims representative to explain unclear procedures. Keep the answer with your valuation documents.",
      sources: ["ca-claims-guide"],
    },
  ],
  faqs: [
    {
      title: "Can an appraisal clause help resolve a disagreement?",
      paragraphs: [
        {
          text: "If your policy includes an appraisal clause, ask your insurer to explain the appraiser and umpire selection, costs, and effect. California’s claims guide describes that policy process.",
          sources: ["ca-claims-guide"],
        },
        { text: "Venfour’s valuation review is separate from a formal policy appraisal. Venfour does not act as your appointed appraiser." },
      ],
    },
    {
      title: "Where can I ask California’s insurance department for help?",
      paragraphs: [
        {
          text: "The California Department of Insurance accepts consumer questions and insurance complaints through its Getting Help page. Its consumer hotline is 800-927-4357. Use the complaint route to explain your concern and provide the documents supporting it.",
          sources: ["ca-complaints"],
        },
      ],
    },
  ],
  sources: [
    {
      id: "ca-claims-guide",
      title: "California claims and total-loss guidance",
      url: "https://www.insurance.ca.gov/01-consumers/105-type/95-guides/01-auto/hadaccident.cfm",
      locator: "FAQs: actual cash value and appraisal; Important Tips; Your Rights Under the Fair Claims Settlement Practices Regulations",
      checkedOn: "2026-09-26",
      claims: ["Policy-qualified market value", "Settlement components", "Salvage deduction", "Conditional appraisal", "Questions to the insurer"],
      applicability: "Consumer guidance for automobile claims; policy terms and the circumstances of the settlement remain relevant.",
    },
    {
      id: "ca-salvage",
      title: "California DMV salvage and nonrepairable vehicles",
      url: "https://www.dmv.ca.gov/portal/vehicle-registration/new-registration/total-loss-salvage-non-repairable-vehicles/",
      locator: "Introduction and What is a Non-Repairable Vehicle?",
      checkedOn: "2026-09-26",
      claims: ["Salvage certificate", "Nonrepairable certificate restrictions"],
      applicability: "California vehicle title classifications; these classifications do not establish the settlement value.",
    },
    {
      id: "ca-salvage-retention",
      title: "California DMV salvage-retention status",
      url: "https://www.dmv.ca.gov/portal/handbook/vehicle-industry-registration-procedures-manual-2/salvage-nonrepairable-junk-vehicles/removing-salvage-retention-status/",
      locator: "19.050 Removing Salvage Retention Status, opening paragraphs",
      checkedOn: "2026-09-26",
      claims: ["Retained salvage title status"],
      applicability: "Vehicles reported by insurers as uneconomical to repair and retained by their registered owners.",
    },
    {
      id: "ca-mediation",
      title: "California automobile claims mediation",
      url: "https://www.insurance.ca.gov/01-consumers/105-type/95-guides/01-auto/AutoMediation.cfm",
      locator: "What Is Mediation?; Who Is Eligible for this Program?; The First Step – Notification",
      checkedOn: "2026-09-26",
      claims: ["Eligibility thresholds and exclusions", "Complaint prerequisite", "Mediator role"],
      applicability: "Eligible personal automobile physical-damage disputes; excludes commercial coverage and third-party liability claims.",
    },
    {
      id: "ca-complaints",
      title: "Get help from California’s insurance department",
      url: "https://www.insurance.ca.gov/01-consumers/101-help/",
      locator: "Insurance Information & Questions; File a Complaint",
      checkedOn: "2026-09-26",
      claims: ["Consumer assistance and complaint contact"],
      applicability: "California Department of Insurance consumer assistance.",
    },
  ],
} satisfies StateGuideContent;
