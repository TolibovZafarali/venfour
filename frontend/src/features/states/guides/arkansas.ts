import type { StateGuideContent } from "../guide-content";

export default {
  "code": "AR",
  "description": "Understand Arkansas total-loss comparisons, transfer costs, salvage-title qualifications, and dispute options. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Arkansas Rule 43 treats a first-party actual-cash-value or like-kind total loss as a comparable replacement or a cash settlement based on a comparable vehicle’s actual cost. Locally available vehicles come first; when unavailable, the cash method permits quotes from two or more qualified dealers or appraisal services.",
      "sources": [
        "ar-rule"
      ]
    },
    {
      "text": "Review what the comparables actually represent: configuration, mileage, equipment, condition, and availability. A useful correction explains both the incorrect input and the evidence supporting the replacement input."
    }
  ],
  "rules": [
    {
      "title": "Separate transfer costs from the vehicle value.",
      "paragraphs": [
        {
          "text": "Under Rule 43’s first-party provisions, a comparable replacement includes applicable taxes, license fees, and ownership-transfer fees. A cash settlement includes taxes and transfer-related fees actually incurred, less the deductible. Ask what documentation the insurer needs for costs not yet included.",
          "sources": [
            "ar-rule"
          ]
        }
      ]
    },
    {
      "title": "Deductions should be measurable and explained.",
      "paragraphs": [
        {
          "text": "If an insurer departs from the rule’s settlement methods, it must document vehicle condition. Deductions, including salvage, must be appropriate, measurable, itemized in dollars, and fully explained to a first-party claimant. Request the calculation behind a disputed deduction rather than only asking for a higher final number.",
          "sources": [
            "ar-rule"
          ]
        }
      ]
    },
    {
      "title": "The salvage test has an age qualification.",
      "paragraphs": [
        {
          "text": "Arkansas’s Attorney General explains that salvage branding can follow water damage above the dashboard or damage equal to or exceeding 70% of average retail value. The described damage-branding law excludes vehicles more than seven model years old before the calendar year of the damage. This title test is separate from the amount a particular insurance claim should pay.",
          "sources": [
            "ar-salvage"
          ]
        },
        {
          "text": "A repaired salvage vehicle carries a rebuilt brand under the guidance. Before retaining a vehicle or importing one already branded elsewhere, confirm the applicable title requirements with the Department of Finance and Administration; do not assume the age qualification removes an existing brand.",
          "sources": [
            "ar-salvage"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask the adjuster to identify the local comparisons or the dealer/appraisal-service quotes supporting the offer. Attach a concise correction list, and keep tax or title-cost questions separate from disputed vehicle specifications."
    },
    {
      "text": "If a proposed dispute process is described as binding, ask for its policy wording and have the department explain how it fits Arkansas’s guidance on voluntary, nonbinding appraisal.",
      "sources": [
        "ar-appraisal"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Is an appraisal clause binding in Arkansas?",
      "paragraphs": [
        {
          "text": "Arkansas Insurance Department Bulletin 19-89 directs that policy arbitration or appraisal provisions be voluntary and nonbinding. Do not assume a clause works like a binding appraisal process described for another state. Ask the insurer and department to clarify the proposed procedure before appointing an appraiser or agreeing to costs.",
          "sources": [
            "ar-appraisal"
          ]
        },
        {
          "text": "Venfour provides a valuation review; it does not act as your appointed policy appraiser."
        }
      ]
    },
    {
      "title": "Where can I request regulator help?",
      "paragraphs": [
        {
          "text": "The Arkansas Insurance Department’s Consumer Services complaint page provides the official route for an insurance complaint. Include the policy and claim identifiers, the disputed valuation, your supporting evidence, and the response you received.",
          "sources": [
            "ar-complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "ar-rule",
      "title": "Arkansas Insurance Department Rule 43",
      "url": "https://portal.insurance.arkansas.gov/LegalPubsPublic/Documents/Rules/rule_43.pdf#page=7",
      "locator": "Section 10(a), PDF pages 7–8",
      "checkedOn": "2026-09-26",
      "claims": [
        "First-party settlement methods",
        "Actually incurred cash-settlement transfer costs",
        "Itemized deductions"
      ],
      "applicability": "First-party actual-cash-value or like-kind total-loss settlements; no assertion that every third-party claim follows these provisions."
    },
    {
      "id": "ar-salvage",
      "title": "Arkansas Attorney General salvage-title guidance",
      "url": "https://arkansasag.gov/divisions/public-protection/automobile/salvage-titles/",
      "locator": "Damage, water, age, and rebuilt-brand explanations",
      "checkedOn": "2026-09-26",
      "claims": [
        "70% or greater damage",
        "Dashboard-level water damage",
        "Seven-model-year qualification"
      ],
      "applicability": "Arkansas damage-based title guidance; existing out-of-state title brands require separate DFA confirmation."
    },
    {
      "id": "ar-appraisal",
      "title": "Arkansas Insurance Department Bulletin 19-89",
      "url": "https://portal.insurance.arkansas.gov/LegalPubsPublic/Documents/Bulletins/bulletin_19-89.pdf",
      "locator": "Page 1: arbitration and appraisal clauses",
      "checkedOn": "2026-09-26",
      "claims": [
        "Voluntary and nonbinding policy procedures"
      ],
      "applicability": "Department direction on arbitration/appraisal policy clauses, not a guarantee of settlement."
    },
    {
      "id": "ar-complaints",
      "title": "Arkansas insurance consumer complaint page",
      "url": "https://insurance.arkansas.gov/consumer-assistance/consumer-services/file-a-complaint/",
      "locator": "File A Complaint",
      "checkedOn": "2026-09-26",
      "claims": [
        "Official complaint route"
      ],
      "applicability": "Consumer insurance complaints."
    }
  ]
} satisfies StateGuideContent;
