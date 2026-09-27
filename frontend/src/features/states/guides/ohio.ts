import type { StateGuideContent } from "../guide-content";

export default {
  "code": "OH",
  "description": "Review Ohio total-loss valuations, replacement sales-tax reimbursement, claim documents, and owner-retained salvage.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Ohio’s cash-settlement rule uses the cost of a comparable automobile, less applicable deductions. It permits specified market comparisons, dealer quotations, or recognized valuation sources.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Check the report’s trim, options, mileage, and pre-loss condition. Ask which source and comparison area the insurer used, then support each proposed correction with vehicle records or comparable evidence."
    }
  ],
  "rules": [
    {
      "title": "Replacement sales tax has two deadlines",
      "paragraphs": [
        {
          "text": "For first- or third-party cash settlements, buy a replacement within 30 days after receiving payment and submit purchase-and-tax documentation within 33 days after receiving that payment. Reimbursement is capped at the sales tax on a vehicle worth the cash settlement; a cheaper purchase receives only actual tax. The insurer may instead pay tax upfront.",
          "sources": [
            "claims"
          ]
        },
        {
          "text": "Keep the settlement receipt date, replacement purchase agreement, and tax receipt together. Ask the adjuster to confirm the documentation needed before you buy."
        }
      ]
    },
    {
      "title": "Ask for the valuation documents",
      "paragraphs": [
        {
          "text": "Database valuation documents must be provided on request. For your own-policy cash settlement, supporting loss documentation is also available on request. The insurer must notify you of any renegotiation rights if no comparable is available within 35 days after you receive the settlement.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Keeping salvage affects when payment can occur",
      "paragraphs": [
        {
          "text": "If the insurer agrees that you may retain a vehicle it considers economically impractical to repair, Ohio law requires you to obtain a salvage title and give the insurer a copy before it pays the claim. Highway use then requires compliance with salvage/rebuilt-title rules.",
          "sources": [
            "title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Submit a short correction list with the corresponding report page and supporting record. Keep the pre-loss value, tax reimbursement, deductible, and any owner-retained salvage deduction as separate questions."
    },
    {
      "text": "Calendar replacement and document-submission dates as soon as payment arrives. For the rule’s deadlines, days are calendar days; a final day falling on a weekend or legal holiday extends to the next business day.",
      "sources": [
        "claims"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can I request an appraisal in Ohio?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, ask the insurer to explain its procedure, costs, and scope. Request the complete policy and endorsements before choosing that route. Do not assume the same policy procedure applies to another driver’s insurer."
        }
      ]
    },
    {
      "title": "Where can I get Ohio insurance help?",
      "paragraphs": [
        {
          "text": "Ohio Department of Insurance Consumer Services answers insurance questions and directs consumers to its complaint process. Its general inquiry form is not a complaint form; use the complaint link provided there when filing.",
          "sources": [
            "consumer"
          ],
          "contact": {
            "label": "Call 800-686-1526",
            "href": "tel:8006861526"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "Ohio Administrative Code 3901-1-54",
      "url": "https://codes.ohio.gov/ohio-administrative-code/rule-3901-1-54",
      "locator": "Paragraphs (C)(5), (H)(7)(d), and (H)(7)(f)–(g)",
      "claims": [
        "Comparable value",
        "Tax deadlines and cap",
        "Requested documents and recourse notice"
      ],
      "applicability": "Automobile claims; additional document/recourse protections identified as first-party.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "title",
      "title": "Ohio Revised Code § 4505.11",
      "url": "https://codes.ohio.gov/ohio-revised-code/section-4505.11",
      "locator": "Divisions (C)(4), (E), and (F)",
      "claims": [
        "Owner-retained salvage title before payment",
        "Rebuilt title and highway operation"
      ],
      "applicability": "Vehicle-title requirements, separate from valuation.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "consumer",
      "title": "Ohio Department of Insurance: Consumer Services",
      "url": "https://legacy.insurance.ohio.gov/Classic/ConsumServ/ConServComments.asp",
      "locator": "Consumer Affairs contact and Online Consumer Complaint Form link",
      "claims": [
        "Consumer help and distinct complaint route"
      ],
      "applicability": "General inquiry page directs users to complaint submission.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
