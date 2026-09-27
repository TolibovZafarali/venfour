import type { StateGuideContent } from "../guide-content";

export default {
  "code": "AL",
  "description": "Understand Alabama total-loss valuation, itemized deductions, settlement taxes and fees, and salvage titles. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Alabama’s insurance department explains that a total-loss payment generally reflects the vehicle’s actual cash value at the time of loss. An outstanding loan can be higher than that value; the loan balance alone does not establish the vehicle’s worth.",
      "sources": [
        "al-faq"
      ]
    },
    {
      "text": "Use the valuation report to identify the vehicle the insurer priced. Then compare its year, trim, mileage, equipment, and condition with your own records. Alabama’s consumer guidance recommends local listings and other valuation guides when questioning the offer.",
      "sources": [
        "al-faq"
      ]
    }
  ],
  "rules": [
    {
      "title": "Check taxes and transfer fees in a first-party settlement.",
      "paragraphs": [
        {
          "text": "For a first-party total loss under actual-cash-value or like-kind coverage, Alabama’s rule permits a comparable replacement or a cash settlement based on a comparable vehicle. The cash calculation includes applicable taxes, license fees, and transfer fees, less the deductible. Those additions are limited to what would have been paid on the insured vehicle at settlement.",
          "sources": [
            "al-rule"
          ]
        }
      ]
    },
    {
      "title": "Deductions need a specific basis.",
      "paragraphs": [
        {
          "text": "Departures from the rule’s valuation methods require documented vehicle condition. Deductions, including salvage, must be measurable and itemized in dollars, and the settlement basis fully explained. Betterment or depreciation support belongs in the claim file; that recordkeeping requirement is distinct from your request for an explanation.",
          "sources": [
            "al-rule"
          ]
        },
        {
          "text": "The rule also ties betterment deductions to a measurable reduction in market value from poorer condition or prior damage, considering the vehicle’s age. A missing-part deduction cannot exceed the part’s replacement cost.",
          "sources": [
            "al-rule"
          ]
        }
      ]
    },
    {
      "title": "The 75% salvage definition does not price the vehicle.",
      "paragraphs": [
        {
          "text": "Alabama Revenue describes a salvage vehicle as one for which a monetary damage settlement is made and the damage equals or exceeds 75% of its pre-damage fair retail value, using a recognized retail-value compilation. A salvage vehicle cannot be registered or operated on public roads until a rebuilt title is obtained. This title classification is separate from reviewing the settlement’s market-value calculation.",
          "sources": [
            "al-salvage"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send a short list of factual corrections with the supporting page, photograph, or comparable listing for each one. Separate a disagreement about the base vehicle value from a missing tax line or a disputed salvage deduction."
    },
    {
      "text": "Ask for the revised calculation in writing so you can see which changes were accepted. Keep the original offer and every later version together."
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
      "title": "Will the insurance department decide what my car is worth?",
      "paragraphs": [
        {
          "text": "The Alabama Department of Insurance can review an insurer’s response and compliance with the policy. It cannot determine a claim’s value or the amount owed. Contact the insurer first; if the issue remains unresolved, the department’s complaint page explains how to submit your policy number, claim number, and concerns.",
          "sources": [
            "al-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "al-faq",
      "title": "Alabama automobile insurance questions",
      "url": "https://aldoi.gov/consumers/AutoFAQ.aspx",
      "locator": "Total-loss value, loan balance, and disagreement with valuation",
      "checkedOn": "2026-09-26",
      "claims": [
        "Actual cash value",
        "Loan balance distinction",
        "Local valuation evidence"
      ],
      "applicability": "Consumer automobile-claim guidance; coverage and liability depend on the claim."
    },
    {
      "id": "al-rule",
      "title": "Alabama Rule 482-1-125-.08",
      "url": "https://admincode.legislature.state.al.us/api/rule/482-1-125-.08",
      "locator": "Paragraphs (1), (2), and (8)",
      "checkedOn": "2026-09-26",
      "claims": [
        "First-party comparable settlement",
        "Taxes and fees",
        "Documented and itemized deductions"
      ],
      "applicability": "Paragraph (1) addresses first-party total losses under actual-cash-value or like-kind coverage; deduction provisions have their stated scope."
    },
    {
      "id": "al-salvage",
      "title": "Alabama Revenue: salvage vehicle definition",
      "url": "https://www.revenue.alabama.gov/faqs/what-is-a-salvage-vehicle-total-loss/",
      "locator": "Definition and operation restriction",
      "checkedOn": "2026-09-26",
      "claims": [
        "75% or greater damage test",
        "Rebuilt title before road use"
      ],
      "applicability": "Salvage titling and registration, not an automatic settlement amount."
    },
    {
      "id": "al-complaint",
      "title": "Alabama insurance complaint assistance",
      "url": "https://aldoi.gov/consumers/FileComplaint.aspx",
      "locator": "We Can / We Cannot; complaint preparation",
      "checkedOn": "2026-09-26",
      "claims": [
        "Complaint process",
        "Department does not set claim value"
      ],
      "applicability": "Complaints within the department’s jurisdiction; stated representation and litigation limits apply."
    }
  ]
} satisfies StateGuideContent;
