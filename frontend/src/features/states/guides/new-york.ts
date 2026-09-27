import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NY",
  "description": "Understand New York total-loss values, sales tax, the qualified right of recourse, and salvage branding. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "New York DFS explains that total-loss valuation may use several methods. An average of approved guide values is one option; a market survey or a qualifying dealer quotation can also be used. A single book value does not resolve every disagreement.",
      "sources": [
        "ny-faq"
      ]
    },
    {
      "text": "Check the vehicle specifications and the actual replacement examples in the report. Focus on whether the evidence represents a substantially similar vehicle in a useful market, and document any differences before asking for recalculation."
    }
  ],
  "rules": [
    {
      "title": "Review the retail value, tax, and deductions separately.",
      "paragraphs": [
        {
          "text": "For a total loss under your own collision or comprehensive coverage, DFS describes actual cash value as retail value plus sales tax, subject to depreciation and applicable deductions. A substantially similar replacement is another permitted settlement route. Ask for an itemized explanation of the net offer.",
          "sources": [
            "ny-claims"
          ]
        }
      ]
    },
    {
      "title": "The recourse clock starts with mailing the check.",
      "paragraphs": [
        {
          "text": "DFS describes a right of recourse for most total-loss valuations: deliver a letter within 35 days from the date the settlement check was mailed if you cannot find a comparable vehicle for the offer. The process involves finding an available, substantially similar vehicle and addressing the difference or, with the insured’s permission, purchasing it. Confirm that the route applies to your settlement and preserve proof of mailing and delivery.",
          "sources": [
            "ny-faq"
          ]
        }
      ]
    },
    {
      "title": "Title branding is separate from the valuation dispute.",
      "paragraphs": [
        {
          "text": "DMV’s owner-disclosure branding guidance applies to vehicles eight model years old or newer when the owner reports destruction or damage of 75% or more of retail value at the time of damage. This branding rule does not mean your settlement equals 75% of the vehicle’s value. Other salvage documents can also trigger examination requirements.",
          "sources": [
            "ny-title"
          ]
        },
        {
          "text": "A rebuilt salvage vehicle must undergo DMV examination before a new title or registration is issued. That examination checks for theft and stolen parts; it is separate from a safety inspection. Confirm both requirements before choosing to retain and repair the vehicle.",
          "sources": [
            "ny-inspection"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Keep the envelope or other evidence of when the settlement check was mailed. If you need to use the recourse procedure, send a clear written notice and the strongest available replacement evidence rather than relying on a telephone conversation."
    },
    {
      "text": "Ask the insurer to explain the report’s valuation method and each disputed adjustment. A correction request is easier to review when it identifies the precise field or comparable being challenged."
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
      "title": "When is an agreed settlement paid?",
      "paragraphs": [
        {
          "text": "DFS guidance for claims under your own policy says payment must be made within five business days after you and the insurer agree on the settlement. That event differs from reporting the loss or receiving an initial offer.",
          "sources": [
            "ny-claims"
          ]
        }
      ]
    },
    {
      "title": "How do I raise an insurance complaint?",
      "paragraphs": [
        {
          "text": "DFS accepts insurance-company complaints through its consumer complaint application. You can add documents and check status. Include your valuation, written corrections, and the response, and explain the handling issue you want reviewed.",
          "sources": [
            "ny-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "ny-faq",
      "title": "New York automobile insurance FAQ",
      "url": "https://www.dfs.ny.gov/faqs/consumer_faqs/automobile?page=1",
      "locator": "Valuing a total loss; right of recourse",
      "checkedOn": "2026-09-26",
      "claims": [
        "Multiple valuation methods",
        "35 days from mailing check"
      ],
      "applicability": "DFS describes recourse for most total-loss valuations; applicability should be confirmed for the settlement."
    },
    {
      "id": "ny-claims",
      "title": "New York claims under your own policy",
      "url": "https://www.dfs.ny.gov/consumers/auto_insurance/filing_claims_under_your_own_policy",
      "locator": "Regulation 64 standards for collision and comprehensive claims",
      "checkedOn": "2026-09-26",
      "claims": [
        "Retail value plus tax",
        "Applicable deductions",
        "Five business days after agreement"
      ],
      "applicability": "First-party collision/comprehensive guidance; not a promise that an initial offer resolves the claim."
    },
    {
      "id": "ny-title",
      "title": "New York DMV salvage branding",
      "url": "https://dmv.ny.gov/salvage/buying-a-salvage-vehicle",
      "locator": "What is Salvage Branding?; Apply for a New Title",
      "checkedOn": "2026-09-26",
      "claims": [
        "Eight-model-year qualification",
        "75% or more damage disclosure"
      ],
      "applicability": "Owner-disclosure title branding; other salvage documents have separate requirements."
    },
    {
      "id": "ny-inspection",
      "title": "New York salvage examination",
      "url": "https://dmv.ny.gov/salvage/the-salvage-vehicle-examination",
      "locator": "About the Examination",
      "checkedOn": "2026-09-26",
      "claims": [
        "Examination before title/registration",
        "Theft examination distinct from safety inspection"
      ],
      "applicability": "Rebuilt salvage vehicles subject to the DMV examination program."
    },
    {
      "id": "ny-complaint",
      "title": "New York DFS consumer complaints",
      "url": "https://www.dfs.ny.gov/complaint",
      "locator": "Consumer Complaints",
      "checkedOn": "2026-09-26",
      "claims": [
        "Insurance complaint application"
      ],
      "applicability": "Insurance complaints within DFS jurisdiction."
    }
  ]
} satisfies StateGuideContent;
