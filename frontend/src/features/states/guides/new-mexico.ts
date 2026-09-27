import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NM",
  "description": "Understand New Mexico total-loss disputes, policy deductions, replacement excise tax, and salvage-title distinctions. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Ask the insurer to show the vehicle details, market evidence, adjustments, and final calculation behind its offer. Check trim, equipment, mileage, and pre-loss condition before deciding which comparisons best support your position."
    },
    {
      "text": "New Mexico’s insurance office recommends asking the adjuster for a written explanation when you disagree with a claim decision. Keep notes and dates of conversations, then identify whether the disagreement is about value, coverage, or the handling of the claim.",
      "sources": [
        "nm-guide"
      ]
    }
  ],
  "rules": [
    {
      "title": "Identify the coverage and deductible being used.",
      "paragraphs": [
        {
          "text": "New Mexico’s consumer guide distinguishes liability coverage for damage to other parties from collision and comprehensive coverage for your own vehicle. Ask which coverage is responding and how any applicable deductible appears in the offer; do not infer your coverage from another driver’s policy.",
          "sources": [
            "nm-guide"
          ]
        }
      ]
    },
    {
      "title": "Replacement-purchase tax is a separate calculation.",
      "paragraphs": [
        {
          "text": "New Mexico’s Motor Vehicle Excise Tax generally applies at 4% of the purchase price less any trade-in allowance and is paid when applying for title. Nondealer purchases can involve a statutory valuation floor. These are purchase-tax rules; they do not by themselves establish what an insurer owes in your settlement. Ask the insurer to explain its treatment of replacement taxes and fees separately, and confirm the tax calculation with MVD.",
          "sources": [
            "nm-tax"
          ]
        }
      ]
    },
    {
      "title": "Salvage depends on the statutory category.",
      "paragraphs": [
        {
          "text": "New Mexico’s definition includes an uneconomical-to-repair vehicle, other than a nonrepairable vehicle, that is not subsequently repaired by or for its owner at the time of damage; a rule-based hail exclusion applies to that branch. Another branch covers an insurer’s total-loss payment for an uneconomical repair even if later repaired, when the insurer obtained agreement to the settlement amount and gave the required branding notice before or with payment. Do not substitute a generic percentage threshold for those conditions.",
          "sources": [
            "nm-definition"
          ]
        },
        {
          "text": "A nonrepairable certificate is different: MVD will not issue further ownership certificates after one is issued. If the insurer takes title and the original owner later buys the salvage vehicle back, MVD says taxes and title fees apply to that title change. Confirm the exact proposed document before accepting owner retention.",
          "sources": [
            "nm-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Organize your request around the report’s factual errors and the closest useful market evidence. Ask for a written response to each correction and keep replacement-purchase questions in a separate part of the same message."
    },
    {
      "text": "Before agreeing to retain the vehicle, request the salvage deduction and proposed title classification in writing. Compare the net payment with the costs and practical requirements of keeping it."
    }
  ],
  "faqs": [
    {
      "title": "Can I request a formal appraisal?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, review it before invoking that process. New Mexico’s insurance office identifies policy appraisal as an option for a disagreement about claim value. Ask about appointments, costs, and the decision’s effect. Venfour’s review is separate from a formal appraisal.",
          "sources": [
            "nm-guide"
          ]
        }
      ]
    },
    {
      "title": "Where can I get help with claim handling?",
      "paragraphs": [
        {
          "text": "The Office of Superintendent of Insurance’s Consumer Assistance Bureau helps with insurance disputes, claims, and policy questions, including personal and commercial auto insurance. Provide the valuation, your correction request, and the insurer’s response so the bureau can identify the concern.",
          "sources": [
            "nm-assistance"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "nm-guide",
      "title": "New Mexico auto-insurance consumer guide",
      "url": "https://osi.state.nm.us/en/wp-content/uploads/2022-april-insurance-tip-of-the-month-auto-insurance.pdf#page=5",
      "locator": "April 2022 guide: pages 1–3 coverage/deductibles; page 5 disputes",
      "checkedOn": "2026-09-26",
      "claims": [
        "Coverage distinction",
        "Deductibles",
        "Written explanation and policy appraisal"
      ],
      "applicability": "General consumer guidance; applicable policy controls coverage and appraisal."
    },
    {
      "id": "nm-tax",
      "title": "New Mexico Motor Vehicle Excise Tax",
      "url": "https://www.tax.newmexico.gov/all-nm-taxes/2020/10/22/motor-vehicle-excise-tax/",
      "locator": "Motor Vehicle Excise Tax, rate and payment paragraphs",
      "checkedOn": "2026-09-26",
      "claims": [
        "4% purchase tax",
        "Title application payment",
        "Nondealer valuation qualification"
      ],
      "applicability": "Replacement-purchase taxation; not an insurance-settlement entitlement."
    },
    {
      "id": "nm-definition",
      "title": "New Mexico vehicle definitions",
      "url": "https://www.mvd.newmexico.gov/vehicles/vehicle-definitions/",
      "locator": "Salvage vehicle",
      "checkedOn": "2026-09-26",
      "claims": [
        "Economic-repair classification",
        "Hail and owner-repair qualifications",
        "Settlement agreement and branding notice"
      ],
      "applicability": "Separate statutory salvage categories; nonrepairable vehicles have a distinct classification."
    },
    {
      "id": "nm-title",
      "title": "New Mexico salvage and nonrepairable title procedures",
      "url": "https://www.mvd.newmexico.gov/chapter-9-reconstructed-rebuilt-salvage-and-nonrepairable-vehicles/",
      "locator": "Section E: nonrepairable certificates and insurance-company requirements",
      "checkedOn": "2026-09-26",
      "claims": [
        "Nonrepairable certificate consequences",
        "Owner buyback taxes and fees"
      ],
      "applicability": "Title transactions; buyback rule concerns insurer taking title before sale back to original owner."
    },
    {
      "id": "nm-assistance",
      "title": "New Mexico insurance Consumer Assistance Bureau",
      "url": "https://www.osi.state.nm.us/en/divisions/",
      "locator": "Consumer Assistance Bureau",
      "checkedOn": "2026-09-26",
      "claims": [
        "Auto claim and policy assistance"
      ],
      "applicability": "Personal and commercial insurance disputes within OSI jurisdiction."
    }
  ]
} satisfies StateGuideContent;
