import type { StateGuideContent } from "../guide-content";

export default {
  "code": "TN",
  "description": "Review Tennessee total-loss vehicle value, coverage questions, salvage and rebuilt titles, and options for resolving a valuation disagreement.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Tennessee’s insurance glossary describes actual cash value as replacement cost adjusted for depreciation. For a vehicle claim, ask the adjuster to identify the valuation method, vehicle details, comparison vehicles, and every adjustment behind the offer.",
      "sources": [
        "glossary"
      ]
    },
    {
      "text": "Start with the vehicle you owned immediately before the loss: trim, equipment, mileage, and condition. Ask for the valuation report and a separate payment breakdown so you can review vehicle value, deductible, taxes or fees, and any salvage deduction individually."
    }
  ],
  "rules": [
    {
      "title": "Confirm which coverage is paying",
      "paragraphs": [
        {
          "text": "Tennessee’s glossary distinguishes collision coverage from comprehensive coverage for losses such as theft, hail, and flood. Collision payment is described as repair cost or up to actual cash value, less the deductible. Confirm the policy and coverage handling your claim before comparing the offer with your expectations.",
          "sources": [
            "glossary"
          ]
        }
      ]
    },
    {
      "title": "A total loss changes title and registration",
      "paragraphs": [
        {
          "text": "Tennessee Revenue says an insurer’s total-loss determination voids the original title and registration. Its guidance directs owners of vehicles less than ten years old to the salvage-certificate process. A non-repairable certificate prevents titling or registration in Tennessee. Confirm the classification before deciding to keep a damaged vehicle.",
          "sources": [
            "revenue"
          ]
        }
      ]
    },
    {
      "title": "Rebuilding requires evidence and inspection",
      "paragraphs": [
        {
          "text": "The Revenue Department’s rebuilt-title process requires the salvage certificate, application, photos of all four damaged-vehicle quadrants, replacement-parts receipts, and a fee. An inspection and approval precede the rebuilt title and registration process. Keep the photos and receipts before work begins.",
          "sources": [
            "revenue"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Write a short list of report corrections, pairing each one with a record, photo, or comparable vehicle. Ask for a written explanation of unresolved adjustments and keep the dates of conversations and submissions.",
      "sources": [
        "guide"
      ]
    },
    {
      "text": "Confirm rental and storage arrangements while the value review is pending. Before signing title or settlement documents, ask what they do and whether the amount you dispute remains open for review."
    }
  ],
  "faqs": [
    {
      "title": "Can I use appraisal in Tennessee?",
      "paragraphs": [
        {
          "text": "If your own policy includes an appraisal clause, review its requirements, scope, and costs before invoking it. The consumer guide linked by Tennessee’s insurance department recommends checking the policy for this option when the dispute is over claim value. A Venfour review does not invoke appraisal.",
          "sources": [
            "guide"
          ]
        }
      ]
    },
    {
      "title": "Does the vehicle’s loan determine its value?",
      "paragraphs": [
        {
          "text": "Keep the valuation and loan payoff as separate questions. Tennessee’s glossary describes GAP insurance as coverage for the difference between actual cash value and the remaining loan balance. If you purchased GAP coverage, ask that provider about your contract’s terms.",
          "sources": [
            "glossary"
          ]
        }
      ]
    },
    {
      "title": "Where can I get Tennessee insurance help?",
      "paragraphs": [
        {
          "text": "Tennessee Consumer Insurance Services accepts complaints about policies written in Tennessee. If your concern involves another person’s insurer, the Department directs third-party claimants to call for available options. Send the valuation and correspondence when requesting help.",
          "sources": [
            "complaint"
          ],
          "contact": {
            "label": "Call 800-342-4029",
            "href": "tel:8003424029"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "glossary",
      "title": "Tennessee TDCI: Glossary of Insurance Terms",
      "url": "https://www.tn.gov/commerce/insurance/consumer-edu/glossary-of-insurance-terms.html",
      "locator": "Actual cash value, collision, comprehensive, and GAP entries",
      "claims": [
        "Value and coverage distinctions",
        "GAP and loan balance"
      ],
      "applicability": "Consumer definitions; specific policy terms apply.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "revenue",
      "title": "Tennessee Revenue: Salvage, Non-repairable and Rebuilt Vehicles",
      "url": "https://www.tn.gov/revenue/title-and-registration/vehicle-titling/salvage.html",
      "locator": "Salvage and Non-repairable Vehicles; Rebuilt Vehicles",
      "claims": [
        "Title and registration consequences",
        "Salvage certificate age guidance",
        "Rebuilt documentation and inspection"
      ],
      "applicability": "Title procedures; no settlement percentage or universal salvage threshold asserted.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "guide",
      "title": "NAIC: A Consumer’s Guide to Auto Insurance",
      "url": "https://content.naic.org/sites/default/files/publication-aut-pp-consumer-auto.pdf#page=15",
      "locator": "Printed page 9, Filing a Claim; linked from Tennessee Auto Insurance 101",
      "claims": [
        "Written explanation and records",
        "Conditional policy appraisal"
      ],
      "applicability": "General consumer guidance linked by Tennessee; not a state-specific appraisal entitlement.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "complaint",
      "title": "Tennessee TDCI: File an Insurance Complaint",
      "url": "https://www.tn.gov/content/tn/commerce/insurance/consumer-resources/file-a-complaint.html",
      "locator": "Complaint eligibility and third-party telephone guidance",
      "claims": [
        "Tennessee-written policy complaints",
        "Third-party assistance route"
      ],
      "applicability": "Distinct first-party and third-party assistance instructions.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
