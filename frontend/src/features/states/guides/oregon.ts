import type { StateGuideContent } from "../guide-content";

export default {
  "code": "OR",
  "description": "Review Oregon total-loss valuations, undisputed payments, salvage titles, and appraisal options before responding to an offer.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Oregon’s insurance regulator describes the settlement starting point as the vehicle’s value immediately before the loss. The insurer must provide the evaluation report; check its equipment, mileage, condition, and market comparisons.",
      "sources": [
        "notice"
      ]
    },
    {
      "text": "Build your response around the vehicle that was lost. Separate corrections to its description from disagreements about comparable vehicles, and keep the proposed vehicle value separate from the final payment."
    }
  ],
  "rules": [
    {
      "title": "Receiving the undisputed amount",
      "paragraphs": [
        {
          "text": "When you agree to transfer ownership and complete the necessary documents, the insurer must pay the undisputed amount without ending negotiations over value. This procedure does not apply if you keep the vehicle. After taking possession, the insurer may sell it after 14 calendar days, so preserve evidence first.",
          "sources": [
            "notice"
          ]
        }
      ]
    },
    {
      "title": "Keeping the vehicle changes the calculation",
      "paragraphs": [
        {
          "text": "If you retain the vehicle, the insurer can subtract its salvage value from the settlement. A lender may not allow you to keep it. Ask for the deduction, lender requirements, and expected repair and title costs before choosing retention.",
          "sources": [
            "consumer"
          ]
        }
      ]
    },
    {
      "title": "An 80% figure has a specific meaning",
      "paragraphs": [
        {
          "text": "Oregon’s DMV definition includes vehicles an insurer declares totaled or takes ownership of. Its separate repair-cost threshold—at least 80% of pre-damage retail market value—applies to damage not covered by insurance. It is not a universal threshold for every insured vehicle or the amount of a settlement.",
          "sources": [
            "dmv"
          ]
        },
        {
          "text": "For a vehicle totaled by damage, the owner must surrender the title within 30 days of the date the vehicle became totaled. Salvage and rebuilt-title requirements depend on what happens next; use DMV’s instructions before repairing, transferring, or returning the vehicle to the road.",
          "sources": [
            "dmv"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Oregon’s regulator recommends documenting errors in the evaluation and checking comparable vehicles in your area. Record dealer contacts, dates, equipment, and availability; ask about the actual cash price because an advertised price may differ.",
      "sources": [
        "consumer"
      ]
    },
    {
      "text": "Before releasing the vehicle, save photos, equipment records, maintenance receipts, the valuation report, and your written request. Identify which amount remains disputed and ask the adjuster to confirm the next review step."
    }
  ],
  "faqs": [
    {
      "title": "Can I use an appraisal clause in Oregon?",
      "paragraphs": [
        {
          "text": "If your own policy includes an appraisal provision, ask how to invoke it and what costs apply. Oregon’s notice says the insurer must reimburse reasonable appraisal costs when the final appraised value exceeds its last offer. A valuation review is separate from this policy procedure.",
          "sources": [
            "notice"
          ]
        }
      ]
    },
    {
      "title": "Who can help with an Oregon claim-handling concern?",
      "paragraphs": [
        {
          "text": "The Oregon Division of Financial Regulation provides consumer help and an insurance complaint route. Send the report, correspondence, and a concise description of the unresolved issue.",
          "sources": [
            "consumer"
          ],
          "contact": {
            "label": "Call 888-877-4894",
            "href": "tel:8888774894"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "notice",
      "title": "Oregon DFR: Total Loss Notice",
      "url": "https://dfr.oregon.gov/laws-rules/Documents/OAR/div80-0240_ex1.pdf",
      "locator": "Pages 1–2: value, evaluation report, undisputed payment, and appraisal",
      "claims": [
        "Pre-loss value and report",
        "Undisputed payment conditions",
        "Conditional appraisal-cost reimbursement"
      ],
      "applicability": "Total-loss consumer notice; appraisal is under the insured’s policy.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "consumer",
      "title": "Oregon DFR: Totaled vehicle",
      "url": "https://dfr.oregon.gov/insure/auto/accident/pages/totaled-vehicle.aspx",
      "locator": "Sections on valuation, retaining the vehicle, and consumer help",
      "claims": [
        "Comparable-vehicle research",
        "Owner retention and lenders",
        "Consumer assistance"
      ],
      "applicability": "Consumer guidance; coverage and liability facts still matter.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "dmv",
      "title": "Oregon DMV: Damaged/Totaled Vehicles",
      "url": "https://www.oregon.gov/odot/dmv/docs/chapter_j.pdf",
      "locator": "September 1, 2026 handbook, Chapter J, pages J1–J5",
      "claims": [
        "Definition and uninsured 80% threshold",
        "Title surrender and salvage procedures"
      ],
      "applicability": "Title classification, not a guaranteed settlement percentage.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
