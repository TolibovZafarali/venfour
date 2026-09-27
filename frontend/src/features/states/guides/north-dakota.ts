import type { StateGuideContent } from "../guide-content";

export default {
  "code": "ND",
  "description": "Understand North Dakota total-loss values, salvage deductions, replacement excise-tax credits, and title rules. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "North Dakota’s insurance department describes actual cash value as the open-market value immediately before the accident. The original purchase price and loan balance are different figures. Methods can include at least two local comparables, at least two dealer quotations, or a service using local pricing information.",
      "sources": [
        "nd-guide"
      ]
    },
    {
      "text": "Review the report’s exact vehicle, mileage, equipment, and condition. Then separate the market-value question from salvage retention, policy deductions, and the replacement-purchase tax paperwork."
    }
  ],
  "rules": [
    {
      "title": "Compare the gross value with the net payment.",
      "paragraphs": [
        {
          "text": "The department’s guide describes a total-loss payment as actual cash value less the deductible. Keeping the vehicle also reduces payment by its salvage value. Unrepaired damage from a prior occurrence can affect the valuation. Request a separate amount and explanation for each adjustment.",
          "sources": [
            "nd-guide"
          ]
        }
      ]
    },
    {
      "title": "Replacement excise-tax credit needs a notarized statement.",
      "paragraphs": [
        {
          "text": "For an owner’s stolen or totally destroyed vehicle, North Dakota allows a credit against one or more replacement purchases, cumulatively limited to insurance compensation plus the deductible. The insurer’s notarized statement must verify the loss and amounts, accompany the replacement title application, and be provided within three years from the statement’s issuance. For a leased vehicle, the credit cannot exceed motor vehicle excise tax paid. Unused credit can remain available with the appropriately marked original statement.",
          "sources": [
            "nd-tax"
          ]
        }
      ]
    },
    {
      "title": "The salvage test excludes glass and hail damage.",
      "paragraphs": [
        {
          "text": "The title statute requires a salvage certificate when damage exceeds 75% of retail value determined through the specified NADA guide, excluding glass and hail damage. This title calculation is separate from the insurer’s settlement valuation. For reconstruction, the inspection certificate must come from an eligible repair business other than the business that reconstructed the vehicle; subsequent titles carry a “previously salvaged” notation. Confirm the title process before keeping the car.",
          "sources": [
            "nd-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask for the report and write down the errors that could change value. Pair each correction with a photograph, equipment record, or local comparable, and request a written recalculation."
    },
    {
      "text": "Ask the insurer for the notarized tax statement early and keep the original with your replacement-purchase records. A settlement correction and a tax-credit application require different evidence."
    }
  ],
  "faqs": [
    {
      "title": "Can I use an appraisal clause?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, ask your insurer for its requirements, costs, and effect before choosing that process. Check whether the disagreement concerns the vehicle’s value or a separate coverage issue."
        },
        {
          "text": "Venfour’s valuation review is separate from a formal policy appraisal. Venfour does not act as your appointed appraiser."
        }
      ]
    },
    {
      "title": "What can North Dakota’s insurance department review?",
      "paragraphs": [
        {
          "text": "After discussing the issue with your agent or insurer, you can contact the department about a claim or policy concern. Its role is to review compliance with state insurance law and the policy’s coverage. Provide the valuation and correspondence with your request.",
          "sources": [
            "nd-guide"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "nd-guide",
      "title": "North Dakota auto-insurance consumer guidance",
      "url": "https://www.insurance.nd.gov/consumers/insurance/auto",
      "locator": "Claims: actual cash value, total loss, prior damage; department role",
      "checkedOn": "2026-09-26",
      "claims": [
        "Local pre-loss value",
        "Deductible and salvage",
        "Prior damage",
        "Regulator assistance"
      ],
      "applicability": "Consumer guidance for auto claims; policy coverage affects payment."
    },
    {
      "id": "nd-tax",
      "title": "North Dakota motor vehicle excise-tax statute",
      "url": "https://ndlegis.gov/cencode/t57c40-3.pdf#page=1",
      "locator": "§ 57-40.3-01(5), PDF page 1",
      "checkedOn": "2026-09-26",
      "claims": [
        "Compensation plus deductible credit",
        "Three years from statement issuance",
        "Lease cap",
        "Unused credit"
      ],
      "applicability": "Replacement-purchase credit with insurer notarization; leased vehicles have a separate cap."
    },
    {
      "id": "nd-title",
      "title": "North Dakota salvage certificate statute",
      "url": "https://ndlegis.gov/cencode/t39c05.pdf#page=8",
      "locator": "§ 39-05-20.2(1)–(3), PDF page 8",
      "checkedOn": "2026-09-26",
      "claims": [
        "Exceeds 75%",
        "Glass and hail exclusions",
        "Independent repair-business inspection"
      ],
      "applicability": "Title and reconstruction requirements, separate from settlement valuation and damage-disclosure provisions."
    }
  ]
} satisfies StateGuideContent;
