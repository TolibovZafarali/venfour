import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NC",
  "description": "Understand North Carolina total-loss values, taxes, owner-retained salvage, and supporting deductions. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "North Carolina’s insurance department describes actual cash value as the vehicle’s local market value before the accident. A repair estimate that equals or exceeds 75% of that value requires total-loss treatment; this is separate from the title-branding process.",
      "sources": [
        "nc-guide"
      ]
    },
    {
      "text": "When value cannot be agreed, the settlement rule uses regional published values and retail prices of at least two substantially similar local vehicles available now or within 90 days of the accident. Qualifying dealer quotations are a fallback when local vehicles cannot be found.",
      "sources": [
        "nc-rule"
      ]
    }
  ],
  "rules": [
    {
      "title": "Taxes and registration fees have an owner-retention exception.",
      "paragraphs": [
        {
          "text": "Applicable sales tax and vehicle registration fees belong in the actual-cash-value settlement, except when the claimant keeps the salvage vehicle. Ask how that exception affects the two offers if you are comparing surrender with retention.",
          "sources": [
            "nc-rule"
          ]
        }
      ]
    },
    {
      "title": "Review adjustments and their supporting documents.",
      "paragraphs": [
        {
          "text": "Adjustments may address condition, equipment, options, mileage, and unrepaired prior damage. Deductions must be itemized in dollars, and the settlement’s supporting documentation must be shared. On request, payment must include a written statement of estimates, evaluations, deductions, and their sources.",
          "sources": [
            "nc-rule"
          ]
        }
      ]
    },
    {
      "title": "A retained vehicle can have lasting title consequences.",
      "paragraphs": [
        {
          "text": "North Carolina law requires “TOTAL LOSS CLAIM” markings when a licensed insurer declares a vehicle a total loss. Its separate salvage-branding tests distinguish vehicles up to six model years old from older vehicles and exclude airbag replacement costs in the older category. Once a branded title is issued, later titles continue to reflect it. Confirm the applicable classification and inspection process before retaining the vehicle.",
          "sources": [
            "nc-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send photographs, receipts, and records that support a better pre-loss condition. If you dispute a salvage deduction, you may request the name and address of a salvage dealer willing to pay the deducted amount.",
      "sources": [
        "nc-rule"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can appraisal help with a first-party disagreement?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, check that process before invoking it. North Carolina’s department describes each side choosing an appraiser, an umpire resolving differences, and an agreement by any two binding the parties. Each side pays its appraiser and shares other appraisal expenses. Venfour’s review is separate from that formal process.",
          "sources": [
            "nc-guide"
          ]
        }
      ]
    },
    {
      "title": "Will the department determine my claim’s value?",
      "paragraphs": [
        {
          "text": "The Department of Insurance can require an insurer’s response and review compliance with laws, rules, and the policy. It cannot establish claim value, decide fault, or resolve disputed facts. Submit the report and correspondence to identify the handling issue clearly.",
          "sources": [
            "nc-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "nc-guide",
      "title": "North Carolina insurance guidance after an accident",
      "url": "https://www.ncdoi.gov/consumers/auto-and-vehicle-insurance/after-accident",
      "locator": "Total loss and disagreement with own insurer",
      "checkedOn": "2026-09-26",
      "claims": [
        "Pre-accident local value",
        "Equals or exceeds 75%",
        "Policy appraisal"
      ],
      "applicability": "Covered motor-vehicle claims; appraisal description addresses first-party policy disputes."
    },
    {
      "id": "nc-rule",
      "title": "North Carolina approved claims-handling rules",
      "url": "https://www.ncdoi.gov/documents/consumer/administrative-rules-changes-claims-handling-2020/open#page=2",
      "locator": "11 NCAC 04 .0418(d)–(l), effective October 1, 2020, pages 1–3",
      "checkedOn": "2026-09-26",
      "claims": [
        "Local methods",
        "Retention tax exception",
        "Documented deductions",
        "Salvage purchaser request"
      ],
      "applicability": "Covered total-loss motor-vehicle claims; the rule addresses general-business-practice violations."
    },
    {
      "id": "nc-title",
      "title": "North Carolina salvage and title branding",
      "url": "https://www3.ncleg.gov/enactedlegislation/statutes/html/bysection/chapter_20/gs_20-71.3.html",
      "locator": "G.S. 20-71.3(a1), (h), (i)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Total-loss claim marking",
        "Age-based repair-cost qualification",
        "Continuing brands"
      ],
      "applicability": "Title classification and branding, distinct from insurance valuation."
    },
    {
      "id": "nc-complaint",
      "title": "North Carolina insurance complaint assistance",
      "url": "https://www.ncdoi.gov/assistance-or-file-complaint",
      "locator": "We Cannot; We Can",
      "checkedOn": "2026-09-26",
      "claims": [
        "Regulatory review",
        "No claim-value determination"
      ],
      "applicability": "Complaints within department authority; representation and pending litigation can limit assistance."
    }
  ]
} satisfies StateGuideContent;
