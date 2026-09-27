import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "the-hartford",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "The Hartford’s personal auto claims page separates policyholder and non-policyholder pathways. Policyholders can track an existing claim and payment status online; people involved in an accident with a Hartford policyholder have a separate reporting route. Use the route matching your claim.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "The Hartford’s total-loss article describes a representative reviewing vehicle damage and explaining the offer. Ask your representative for the complete valuation and a written settlement breakdown, including the vehicle details and supporting comparisons, rather than relying on a payment status alone.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Keep the claim number, representative’s contact details and offer date with the documents. If an earlier inspection generated a repair estimate, retain it separately. Ask which report and version are now being used to support the total-loss value."
    }
  ],
  "valuation": [
    {
      "text": "The Hartford’s article identifies mileage, age, wear and comparable vehicles as value considerations. Check the report’s actual inputs against your vehicle records, including trim and equipment. Ask for the basis of a condition adjustment if its description does not match the vehicle before the incident.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Attach evidence to a particular correction. For example, a dated interior photograph may address a condition description, while a purchase record may identify installed options. A receipt’s amount is not automatically a dollar-for-dollar increase in vehicle value."
    },
    {
      "text": "When choosing comparable listings, preserve the location, seller, date, trim and mileage. Explain relevant differences instead of selecting only the highest prices. Keep advertised asking prices distinct from known sale prices, and ask how differences are reflected in the report."
    }
  ],
  "reconsideration": [
    {
      "text": "The Hartford’s total-loss guidance says customers can present supporting evidence to their representative when questioning the offer. Make that evidence easy to review: identify the report page, the proposed correction and the attachment that supports it.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Ask for a response to each item and an updated report if a correction changes the calculation. If the issue is a lender payment, deductible or policy feature, list it separately from vehicle facts so the representative can explain both the value and payment."
    }
  ],
  "faqs": [
    {
      "title": "Can I contact The Hartford if I do not hold the policy?",
      "paragraphs": [
        {
          "text": "Yes. Its personal auto claims page has a non-policyholder route for an accident involving a Hartford policyholder or someone reporting on their behalf. Use the official pathway and keep the claim reference for follow-up.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Does the amount owed on my loan establish the vehicle’s value?",
      "paragraphs": [
        {
          "text": "No. The Hartford’s article separates the loan balance from the vehicle’s value. Ask the representative and lender to explain payment allocation and any remaining balance, and verify any separate gap coverage from its terms.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Do the AARP and non-AARP contact routes differ?",
      "paragraphs": [
        {
          "text": "The personal auto claims page lists separate AARP and non-AARP customer contacts. Use the current listing and your policy or claim correspondence to reach the appropriate team.",
          "sources": [
            "claims"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "The Hartford personal auto claims",
      "url": "https://www.thehartford.com/car-insurance/claims",
      "locator": "For Policyholders; For Non-Policyholders; Want to Talk?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Policyholder claim tracking",
        "Non-policyholder pathway",
        "Separate AARP and non-AARP contacts"
      ],
      "applicability": "Personal auto claims access instructions, not commercial insurance procedures."
    },
    {
      "id": "total-loss",
      "title": "The Hartford: What Happens When Your Car Is Totaled?",
      "url": "https://www.thehartford.com/aarp/car-insurance/totaled-car",
      "locator": "How much insurance pays; total-loss process; questioning the offer",
      "checkedOn": "2026-09-26",
      "claims": [
        "Valuation factors",
        "Presenting supporting evidence",
        "Loan balance distinct from value"
      ],
      "applicability": "General educational article updated September 10, 2025. No state threshold, payment timetable or guaranteed coverage is adopted."
    }
  ]
} satisfies InsurerGuideContent;
