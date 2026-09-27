import type { StateGuideContent } from "../guide-content";

export default {
  code: "DC",
  description: "Understand District of Columbia total-loss valuations, salvage titles, rental coverage, and dispute options. Start with Venfour’s free preliminary valuation.",
  checkedOn: "2026-09-26",
  valuation: [
    {
      text: "The District’s Department of Insurance, Securities and Banking describes total-loss value by reference to the vehicle’s worth immediately before the crash and similar vehicles in the surrounding market. It recommends researching the value independently before agreeing to a settlement.",
      sources: ["dc-auto-claims"],
    },
  ],
  rules: [
    {
      title: "The 75% salvage test has a specific scope.",
      paragraphs: [
        {
          text: "D.C.’s salvage definition includes a vehicle whose estimated or actual parts-and-labor cost to restore its pre-damage condition and legal road operation exceeds 75% of its pre-damage retail value. The value comes from a current nationally recognized compilation approved by the DMV Director. Historic motor vehicles are excluded from this definition.",
          sources: ["dc-salvage-definition"],
        },
        {
          text: "An owner can also voluntarily designate a vehicle as salvage. This is a title-classification rule, not a calculation of the settlement you should receive. Ask the insurer to explain its repair estimate, vehicle valuation, and proposed title treatment separately.",
          sources: ["dc-salvage-definition"],
        },
      ],
    },
    {
      title: "Salvage-title responsibilities can begin before payment.",
      paragraphs: [
        {
          text: "Under D.C. Code § 50-1331.02, an owner of a salvage vehicle must apply for a salvage title before repairs and within 30 days of the damage. A lessor’s deadline instead runs from notice of the damaged status. Contact DMV promptly rather than assuming every deadline starts with the insurance payment.",
          sources: ["dc-salvage-duties"],
        },
        {
          text: "When an insurer acquires the salvage vehicle through a damage settlement, its application deadline runs from delivery of the title to the insurer. Different responsibilities apply when the owner keeps the vehicle. Confirm who will complete each step before transferring the title or authorizing work.",
          sources: ["dc-salvage-duties"],
        },
      ],
    },
    {
      title: "Check rental coverage separately from the vehicle valuation.",
      paragraphs: [
        {
          text: "DISB’s auto guidance explains that rental reimbursement under your own policy depends on having that coverage and is subject to policy limits. Ask your insurer to confirm the daily allowance, maximum benefit, and last covered date before extending a rental. Those expenses are a separate question from your totaled vehicle’s value.",
          sources: ["dc-auto-claims"],
        },
      ],
    },
  ],
  reconsideration: [
    {
      text: "DISB recommends contacting the insurer first, stating the desired resolution in writing, and keeping a record of calls and correspondence. If the response does not resolve the problem, provide copies of your supporting documents with a complaint to the department.",
      sources: ["dc-complaints"],
    },
  ],
  faqs: [
    {
      title: "Can an appraisal clause help resolve a disagreement?",
      paragraphs: [
        {
          text: "The consumer auto guide published by DISB recommends checking your policy for an appraisal clause when the dispute concerns value. If your policy includes one, ask your insurer to identify its requirements, costs, and effect before deciding whether to use it. The guide does not establish an appraisal right for every D.C. claim.",
          sources: ["dc-consumer-guide"],
        },
        { text: "Venfour’s valuation review is separate from the appraisal process described in a policy. Venfour does not act as your appointed appraiser." },
      ],
    },
    {
      title: "What can the District’s insurance department do?",
      paragraphs: [
        {
          text: "DISB handles auto insurance complaints, reviews possible violations of District requirements, and requests information and explanations from financial service providers. Its Consumer Services Division can be reached at 202-727-8000. The department’s complaint page explains how to submit supporting documents and request further review of an investigator’s response.",
          sources: ["dc-complaints"],
        },
      ],
    },
  ],
  sources: [
    {
      id: "dc-auto-claims",
      title: "DISB guidance on auto claims and rental coverage",
      url: "https://disb.dc.gov/page/things-know-about-car-insurance-and-rental-cars-starting-your-road-trip",
      locator: "If Your Car Is a Total Loss; What to Expect After the Accident — Rental Cars",
      checkedOn: "2026-09-26",
      claims: ["Pre-loss value and local comparisons", "Policy-dependent rental reimbursement"],
      applicability: "Consumer guidance; the rental statement used here concerns coverage under the customer’s own policy.",
    },
    {
      id: "dc-salvage-definition",
      title: "D.C. Code § 50-1331.01(12)",
      url: "https://code.dccouncil.gov/us/dc/council/code/sections/50-1331.01",
      locator: "Paragraph (12)(A)–(B)",
      checkedOn: "2026-09-26",
      claims: ["Salvage threshold and valuation basis", "Historic-vehicle exception", "Voluntary designation"],
      applicability: "Salvage title classification, excluding historic motor vehicles as defined in Title 18 DCMR Chapter 99.",
    },
    {
      id: "dc-salvage-duties",
      title: "D.C. Code § 50-1331.02",
      url: "https://code.dccouncil.gov/us/dc/council/code/sections/50-1331.02",
      locator: "Subsections (a), (c), and (d)",
      checkedOn: "2026-09-26",
      claims: ["Owner and lessor application deadlines", "Insurer acquisition and owner-retention duties"],
      applicability: "Salvage title duties differ by owner, lessor, and insurer; deadlines have different triggering events.",
    },
    {
      id: "dc-consumer-guide",
      title: "DISB consumer guide: resolving value disputes",
      url: "https://disb.dc.gov/sites/default/files/dc/sites/disb/publication/attachments/publication-aut-pp-consumer-auto.pdf#page=15",
      locator: "PDF page 15, printed page 9, Filing a Claim",
      checkedOn: "2026-09-26",
      claims: ["Check the policy for an appraisal clause"],
      applicability: "General NAIC consumer guide published by DISB; not a District-specific appraisal entitlement.",
    },
    {
      id: "dc-complaints",
      title: "DISB insurance complaint process",
      url: "https://disb.dc.gov/service/file-complaint-or-report-fraud",
      locator: "Types of Complaints DISB Can Handle; If you have a dispute; Still have questions?",
      checkedOn: "2026-09-26",
      claims: ["Written insurer dispute and records", "Department complaint role", "Consumer Services contact"],
      applicability: "Complaint assistance for entities regulated by DISB, with referral to another regulator when appropriate.",
    },
  ],
} satisfies StateGuideContent;
