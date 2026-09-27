import type { StateGuideContent } from "../guide-content";

export default {
  "code": "IL",
  "description": "Understand Illinois total-loss valuations, deductions, replacement taxes, owner-retention rules, and options for reviewing an offer.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "For a claim with your own insurer, Illinois consumer guidance describes a cash settlement based on the vehicle’s retail value. Insurers may use recognized guides or computerized sources; vehicles not listed can require written dealer quotations. An advertisement alone is ordinarily not sufficient evidence of market value.",
      "sources": [
        "total-loss-guide"
      ]
    },
    {
      "text": "Check whether the report accurately identifies the vehicle, then compare its market evidence with vehicles of similar configuration and condition. Present a few well-matched listings with specific explanations instead of relying on the highest asking price you can find."
    }
  ],
  "rules": [
    {
      "title": "Review deductions individually",
      "paragraphs": [
        {
          "text": "Illinois guidance allows deductions for the policy deductible, wear and tear, missing parts, and rust. The combined wear, missing-parts, and rust deductions are limited to $500; deductions for unrepaired prior collision damage are not subject to that limit. Deductions must be itemized in dollars.",
          "sources": [
            "total-loss-guide"
          ]
        }
      ]
    },
    {
      "title": "Replacement taxes depend on the purchase and documentation",
      "paragraphs": [
        {
          "text": "For your own-policy cash settlement, notify the insurer and provide proof that you bought or leased a replacement within 30 days after receiving settlement. Illinois guidance describes reimbursement of applicable sales tax, title, and transfer fees, limited to the amounts calculated for the total-loss vehicle’s value. For a cheaper replacement, reimbursement uses the actual tax incurred. The insurer must give written notice of this procedure.",
          "sources": [
            "total-loss-guide"
          ]
        }
      ]
    },
    {
      "title": "The right of recourse has conditions",
      "paragraphs": [
        {
          "text": "If you cannot buy a comparable for the settlement valuation and locate a higher-priced comparable, Illinois guidance describes a 30-day period after receiving payment to notify your insurer. Resolution can involve locating a comparable, addressing the difference or purchase, or policy appraisal. This recourse does not apply when the cash settlement followed rejection of an offered replacement vehicle.",
          "sources": [
            "own-claim-guide"
          ]
        }
      ]
    },
    {
      "title": "Keeping the totaled vehicle is restricted",
      "paragraphs": [
        {
          "text": "Illinois guidance generally allows owner retention only when the vehicle is at least nine model years old, or when hail damage does not affect operational safety. Even then, the insurer may agree to let you retain it but is not required to do so. Confirm the title requirements before deciding.",
          "sources": [
            "own-claim-guide"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send the adjuster a concise list of vehicle-description errors, disputed deductions, and comparable evidence. Keep the date you received settlement and your replacement paperwork visible in your records. The Department of Insurance recommends trying to resolve the dispute with the company and preserving written correspondence before filing a complaint.",
      "sources": [
        "complaints"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can I use an appraisal clause in Illinois?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, review its requirements and costs. Illinois guidance describes each side selecting an appraiser and sharing an umpire’s cost, with the policy determining the process. Ask for the applicable policy wording before treating appraisal as an available remedy.",
          "sources": [
            "own-claim-guide"
          ]
        }
      ]
    },
    {
      "title": "Can the Illinois Department of Insurance decide the value?",
      "paragraphs": [
        {
          "text": "The Department can review a complaint for compliance with insurance requirements, but says it cannot determine a vehicle’s value or act as your attorney. Its complaint process is useful for presenting a documented claims-handling concern; it does not guarantee a higher settlement.",
          "sources": [
            "complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "total-loss-guide",
      "title": "Illinois total-loss claims with your insurer",
      "url": "https://idoi.illinois.gov/consumers/consumerinsurance/total-loss-auto-claim.html",
      "locator": "Cash settlement, deductions, and taxes",
      "checkedOn": "2026-09-26",
      "claims": [
        "Retail valuation",
        "Deduction limit",
        "Replacement reimbursement"
      ],
      "applicability": "First-party claims."
    },
    {
      "id": "own-claim-guide",
      "title": "Illinois claims with your own insurance company",
      "url": "https://idoi.illinois.gov/consumers/consumerinsurance/auto/filing-an-auto-claim-with-your-own-insurance-company.html",
      "locator": "Right of recourse, vehicle retention, and appraisal",
      "checkedOn": "2026-09-26",
      "claims": [
        "Recourse exceptions",
        "Owner retention",
        "Policy appraisal"
      ],
      "applicability": "First-party claims; current policy controls."
    },
    {
      "id": "complaints",
      "title": "Illinois insurance complaint process",
      "url": "https://idoi.illinois.gov/consumers/understanding-complaint-process.html",
      "locator": "Before filing and Department authority",
      "checkedOn": "2026-09-26",
      "claims": [
        "Records",
        "Regulator assistance and limits"
      ],
      "applicability": "Complaints within Illinois insurance jurisdiction."
    }
  ]
} satisfies StateGuideContent;
