import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NE",
  "description": "Understand Nebraska total-loss values, replacement-tax guidance, registration refunds, and qualified salvage rules. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Start with the vehicle’s condition and market evidence immediately before the loss. Ask for the valuation report, the vehicles used as comparisons, and a separate explanation of every adjustment. Keep the value discussion separate from the timing of replacement-related reimbursements."
    },
    {
      "text": "Nebraska’s insurance department addresses replacement taxes in separate claims guidance. A vehicle-value offer and a later supplemental request for replacement costs can therefore involve different documents. Keep the purchase agreement and tax receipt with your claim records.",
      "sources": [
        "ne-tax"
      ]
    }
  ],
  "rules": [
    {
      "title": "Replacement taxes can require a supplemental request.",
      "paragraphs": [
        {
          "text": "Nebraska’s department guidance applies to first-party and third-party property claims. It says applicable taxes and surcharges should be paid when the property is replaced, based on the lower of its pre-loss value or replacement cost. The insurer need not pay those amounts before replacement. For a stated-value policy, payment need not exceed the stated amount when the actual-cash-value settlement has already reached it.",
          "sources": [
            "ne-tax"
          ]
        }
      ]
    },
    {
      "title": "Unused registration amounts have their own application.",
      "paragraphs": [
        {
          "text": "When the insurer acquires the vehicle through a total-loss settlement and a salvage-branded title is issued, the prior owner who was a party to that settlement can apply to the county treasurer within 60 days after the settlement date. Return the registration, plates, and decals or provide the required unavailability affidavit. The statute provides credits or refunds for qualifying unused registration amounts; the calculation and choice of credit depend on the replacement and registration circumstances.",
          "sources": [
            "ne-refund"
          ]
        }
      ]
    },
    {
      "title": "The 75% salvage test has a late-model qualification.",
      "paragraphs": [
        {
          "text": "Nebraska’s salvage definition covers a late-model vehicle when estimated retail repair costs meet or exceed 75% of its retail value when damaged. “Late model” includes the loss model year and six preceding model years, plus a separate value-based category with indexed thresholds. The calculation uses retail parts and customary, reasonable labor. The statute also permits voluntary salvage classification. This title definition does not establish the amount of your insurance payment.",
          "sources": [
            "ne-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send corrections to the vehicle description and the most relevant local listings together. Ask the adjuster to explain whether an amount is part of the vehicle valuation, a policy deduction, or a replacement expense awaiting a receipt."
    },
    {
      "text": "Keep the settlement date and replacement documents in a separate checklist so a valuation dispute does not obscure a registration application or supplemental reimbursement request."
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
      "title": "Will Nebraska’s insurance department decide my vehicle’s value?",
      "paragraphs": [
        {
          "text": "The department can review insurance handling concerns, but its complaint brochure says it cannot determine a vehicle’s value, decide disputed facts, or order a company to pay a claim. Include the valuation, your written objections, and the response when asking for a compliance review.",
          "sources": [
            "ne-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "ne-tax",
      "title": "Nebraska guidance on special costs in property losses",
      "url": "https://doi.nebraska.gov/sites/default/files/doc/IGD%20-%20-%20C4.pdf#page=1",
      "locator": "IGD--C4, issued October 20, 2022, page 1",
      "checkedOn": "2026-09-26",
      "claims": [
        "Replacement-dependent taxes",
        "Lower-value limitation",
        "Stated-value qualification"
      ],
      "applicability": "Department guidance for first-party and third-party property claims; stated-value and tax-exempt property qualifications apply."
    },
    {
      "id": "ne-refund",
      "title": "Nebraska registration credits and refunds",
      "url": "https://nebraskalegislature.gov/laws/statutes.php?statute=60-397",
      "locator": "§ 60-397(1)–(3)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Insurer-acquired salvage vehicle",
        "60 days after settlement",
        "Unused registration application"
      ],
      "applicability": "Prior owner who was party to settlement, when insurer acquires vehicle and salvage title is issued."
    },
    {
      "id": "ne-title",
      "title": "Nebraska salvage and late-model definitions",
      "url": "https://nebraskalegislature.gov/laws/statutes.php?statute=60-171",
      "locator": "§ 60-171(1), (3), (6), (7)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Qualified 75% threshold",
        "Model-year and value categories"
      ],
      "applicability": "Title definitions; not an insurance-payment formula."
    },
    {
      "id": "ne-complaint",
      "title": "Nebraska insurance complaint brochure",
      "url": "https://doi.nebraska.gov/sites/default/files/doc/FilingAnInsuranceComplaint_0.pdf#page=1",
      "locator": "Pages 1–2, department authority and filing instructions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Complaint assistance and limits"
      ],
      "applicability": "Insurance complaints within department jurisdiction."
    }
  ]
} satisfies StateGuideContent;
