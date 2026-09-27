import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NV",
  "description": "Understand Nevada comparable values, written deductions, settlement taxes and fees, and salvage exceptions. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Nevada’s total-loss rule bases a cash settlement on the cost of a comparable vehicle. Permitted methods include local comparable prices, local dealer quotations, and a statistically valid valuation method. Where local comparables are unavailable, the search may expand only as necessary.",
      "sources": [
        "nv-rule"
      ]
    },
    {
      "text": "Check the report’s location, timing, mileage, equipment, and condition against your vehicle. A price difference is most useful when you can explain why the other vehicle is a closer match."
    }
  ],
  "rules": [
    {
      "title": "Separate taxes and fees from the vehicle price.",
      "paragraphs": [
        {
          "text": "The comparable-vehicle settlement includes applicable taxes, license fees, and other ownership-transfer fees, less the policy deductible. For an insurer-provided replacement, license fees may be prorated for the unused registration period. Ask for those components as separate lines in the offer.",
          "sources": [
            "nv-rule"
          ]
        }
      ]
    },
    {
      "title": "Deductions require written support.",
      "paragraphs": [
        {
          "text": "Deductions, including salvage deductions, must be measurable, itemized, appropriate, and supported by a written basis disclosed to the claimant and retained in the claim file. Betterment or depreciation information also must be retained and disclosed in writing.",
          "sources": [
            "nv-rule"
          ]
        }
      ]
    },
    {
      "title": "The salvage threshold excludes painting costs.",
      "paragraphs": [
        {
          "text": "Nevada DMV describes a total loss for title purposes as damage with estimated repair costs exceeding 65% of pre-damage fair market value, excluding painting. An exception applies to vehicles at least 10 model years old when repairs are limited to the hood, trunk lid, and up to two of the specified door, grille, bumper, headlight, or taillight assemblies. Additional repairs can remove that exception. Other salvage categories, including flood damage and nonrepairable vehicles, also exist.",
          "sources": [
            "nv-title"
          ]
        },
        {
          "text": "An orange salvage title does not permit driving or registration. Rebuilding and inspection are required; vehicles five model years old or newer need DMV authorization before repairs begin. Confirm the process before agreeing to keep the vehicle.",
          "sources": [
            "nv-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask the adjuster to identify the valuation method and the local evidence used. If the search extends farther away, explain any transport, market, equipment, or condition differences that make a listed vehicle a poor comparison."
    },
    {
      "text": "Request the written basis for any disputed deduction. Keep the amount owed on a loan separate from your evidence of the vehicle’s market value."
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
      "title": "Does a total-loss payment eliminate my loan?",
      "paragraphs": [
        {
          "text": "Not necessarily. Nevada’s insurance division explains that GAP coverage can address the difference between actual cash value and the loan balance, subject to the contract. A dealer’s GAP waiver is a different product; review which agreement you bought.",
          "sources": [
            "nv-gap"
          ]
        }
      ]
    },
    {
      "title": "Where can I raise a claim-handling concern?",
      "paragraphs": [
        {
          "text": "Nevada’s Division of Insurance can clarify policies and investigate complaints after efforts to resolve the issue with the insurer. Filing a complaint does not extend policy or legal deadlines. The division does not provide legal representation.",
          "sources": [
            "nv-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "nv-rule",
      "title": "Nevada total-loss settlement regulation",
      "url": "https://www.leg.state.nv.us/NAC/NAC-686A.html",
      "locator": "NAC 686A.680(1)–(6)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Comparable methods",
        "Taxes and fees",
        "Written deductions"
      ],
      "applicability": "Automobile total-loss settlements; policy deductible applies."
    },
    {
      "id": "nv-title",
      "title": "Nevada DMV salvage vehicles",
      "url": "https://dmv.nv.gov/salvage.htm",
      "locator": "Total Loss; Older Vehicles; Critical Rules; Vehicle Restoration",
      "checkedOn": "2026-09-26",
      "claims": [
        "Exceeds 65% excluding painting",
        "Older-vehicle exception",
        "Rebuilding and authorization"
      ],
      "applicability": "Title and restoration rules; other salvage categories can independently apply."
    },
    {
      "id": "nv-gap",
      "title": "Nevada GAP insurance guidance",
      "url": "https://doi.nv.gov/Consumers/Automobile-Insurance/Gap-Insurance/",
      "locator": "GAP insurance versus GAP waiver",
      "checkedOn": "2026-09-26",
      "claims": [
        "Loan/value distinction",
        "Contract-dependent GAP protection"
      ],
      "applicability": "Loan deficiency protection depends on the purchased agreement."
    },
    {
      "id": "nv-complaint",
      "title": "Nevada insurance complaint process",
      "url": "https://doi.nv.gov/Consumers/File-A-Complaint/",
      "locator": "Consumer Complaint Process",
      "checkedOn": "2026-09-26",
      "claims": [
        "Complaint assistance",
        "Deadlines not extended"
      ],
      "applicability": "Insurance issues within division jurisdiction; pending legal representation or proceedings may limit assistance."
    }
  ]
} satisfies StateGuideContent;
