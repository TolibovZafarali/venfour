import type { StateGuideContent } from "../guide-content";

export default {
  "code": "PA",
  "description": "Understand Pennsylvania total-loss appraisal reports, replacement value, applicable sales tax, and owner-retained salvage.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Pennsylvania’s appraisal rule uses replacement value for a total loss. Permitted valuation methods include specified guide values, an available comparable vehicle, and dealer quotations in qualifying situations. Ask which method was used and check the vehicle-specific adjustments.",
      "sources": [
        "appraisal"
      ]
    },
    {
      "text": "Compare the report’s vehicle description with your VIN, trim, options, mileage, and pre-loss condition. Explain each correction with a record or photograph rather than relying on a single higher listing."
    }
  ],
  "rules": [
    {
      "title": "Applicable sales tax belongs in replacement cost",
      "paragraphs": [
        {
          "text": "The total-loss appraisal must include applicable sales tax in replacement cost. Request a separate tax line so you can distinguish the appraised vehicle value from the final settlement calculation.",
          "sources": [
            "appraisal"
          ]
        }
      ]
    },
    {
      "title": "You should receive the appraisal report",
      "paragraphs": [
        {
          "text": "The appraiser must give the consumer the total-loss appraisal within five working days after completion. If the insurer offers settlement before delivery, it must explain the report’s contents and advise the consumer of the right to receive it.",
          "sources": [
            "appraisal"
          ]
        }
      ]
    },
    {
      "title": "Retaining salvage requires additional information",
      "paragraphs": [
        {
          "text": "When you retain salvage, the appraiser must provide information including its value, title-filing requirements, and towing or storage costs. Any salvage bids must identify the bidder, amount, and expiration. Ask for those details before accepting a deduction or deciding to keep the vehicle.",
          "sources": [
            "appraisal"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Organize your request around the method shown in the appraisal: missing equipment, inaccurate mileage, prior-damage deductions, or a proposed replacement that does not match your vehicle. Include the relevant report page and supporting evidence for each point."
    },
    {
      "text": "Keep a dated copy of your submission and request a written response to each correction. Separately confirm the handling of rental, storage, the title, any deductible, and payment to a lender."
    }
  ],
  "faqs": [
    {
      "title": "Is the appraisal report the same as invoking my policy’s appraisal clause?",
      "paragraphs": [
        {
          "text": "Treat them as separate questions. If your own policy includes an appraisal clause, ask for its conditions, costs, and procedure before invoking it. Pennsylvania’s consumer guidance recommends reading the policy and keeping records when you need help with a claim.",
          "sources": [
            "consumer"
          ]
        }
      ]
    },
    {
      "title": "Where can I raise a Pennsylvania insurance complaint?",
      "paragraphs": [
        {
          "text": "The Pennsylvania Insurance Department’s Consumer Services Online portal accepts insurance complaints and questions. Include the appraisal, your correction request, the insurer’s response, and the specific issue you want reviewed.",
          "sources": [
            "complaint"
          ],
          "contact": {
            "label": "Call 877-881-6388",
            "href": "tel:8778816388"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "appraisal",
      "title": "Pennsylvania Code: 31 Pa. Code § 62.3",
      "url": "https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=/secure/pacode/data/031/chapter62/s62.3.html",
      "locator": "Subsections (d) and (e), especially (e)(4) and (e)(7)",
      "claims": [
        "Total-loss valuation methods",
        "Sales tax",
        "Report delivery",
        "Owner-retained salvage disclosures"
      ],
      "applicability": "Motor-vehicle physical-damage appraisals; title treatment is distinct from payment.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "consumer",
      "title": "Pennsylvania Insurance Department: Auto Insurance",
      "url": "https://www.pa.gov/agencies/insurance/consumer-help-center/learn-about-insurance/auto-insurance",
      "locator": "Auto insurance resources and consumer guidance",
      "claims": [
        "Policy review and claim assistance"
      ],
      "applicability": "General consumer guidance; no universal appraisal entitlement asserted.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "complaint",
      "title": "Pennsylvania Insurance Department: File a complaint",
      "url": "https://www.pa.gov/services/insurance/file-a-complaint-with-your-insurance-company-agent-broker-or-public-adjuster",
      "locator": "Consumer Services Online and contact information",
      "claims": [
        "Complaint and question submission"
      ],
      "applicability": "Insurance Department consumer assistance.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;

