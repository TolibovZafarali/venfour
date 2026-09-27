import type { StateGuideContent } from "../guide-content";

export default {
  "code": "AZ",
  "description": "Understand Arizona comparable-vehicle settlements, taxes and fees, documented deductions, and salvage titles. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Arizona’s claims rule addresses first-party total losses under actual-cash-value or like-kind coverage. A settlement may use an available comparable replacement or cash based on a comparable vehicle’s actual cost. For the cash method, the rule looks to local comparables; if unavailable, it permits quotes from two or more qualified local dealers.",
      "sources": [
        "az-rule"
      ]
    },
    {
      "text": "Check the selected vehicles against your own trim, mileage, options, and pre-loss condition. Show differences directly instead of treating every advertised price as equally comparable. Keep the vehicle value, settlement additions, and deductions on separate lines."
    }
  ],
  "rules": [
    {
      "title": "Include applicable ownership-transfer costs.",
      "paragraphs": [
        {
          "text": "The first-party replacement and cash methods include applicable taxes, license fees, and other ownership-transfer fees, less the policy deductible. Ask the insurer to identify each applicable addition in the settlement worksheet.",
          "sources": [
            "az-rule"
          ]
        }
      ]
    },
    {
      "title": "Ask how condition and salvage changed the number.",
      "paragraphs": [
        {
          "text": "A different valuation approach requires documentation of vehicle condition. Deductions, including salvage, must be measurable, appropriate, itemized in dollars, and fully explained. Support for betterment or depreciation must also be retained in the claim file. Asking for the explanation is separate from the insurer’s recordkeeping duty.",
          "sources": [
            "az-rule"
          ]
        }
      ]
    },
    {
      "title": "Arizona’s salvage definition uses repair economics.",
      "paragraphs": [
        {
          "text": "Arizona defines a salvage vehicle, other than a nonrepairable vehicle, by damage or theft that makes repair uneconomical in the judgment of the owner, leasing company, financial institution, or insurer. A nonrepairable designation is a separate classification with substantial title restrictions.",
          "sources": [
            "az-title"
          ]
        },
        {
          "text": "Before keeping the vehicle, ask which title classification applies and what paperwork must precede the settlement. The statute has owner-retention requirements and exceptions for specified registrations; do not assume keeping possession preserves the existing title.",
          "sources": [
            "az-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask whether the cash figure came from locally available comparable vehicles or dealer quotes. If a listing is not the same configuration, identify the difference and ask how it affected the amount."
    },
    {
      "text": "Prepare the valuation report, policy, correspondence, and supporting records before filing a DIFI complaint. Its online form provides one opportunity to attach documents, and a complaint does not extend policy or legal time limits.",
      "sources": [
        "az-complaints"
      ]
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
      "title": "Can DIFI review a delayed or disputed claim?",
      "paragraphs": [
        {
          "text": "Arizona’s Department of Insurance and Financial Institutions can investigate claim-handling delays, denials, and unsatisfactory settlements where it has jurisdiction. It cannot provide legal advice or decide liability or fault. Use the Insurance Complaints section of its page, rather than the separate real-estate appraiser complaint route.",
          "sources": [
            "az-complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "az-rule",
      "title": "Arizona insurance claims rule R20-6-801",
      "url": "https://apps.azsos.gov/public_services/Title_20/20-06.pdf#page=60",
      "locator": "PDF page 60, printed page 58: R20-6-801(H)(1), (3), and (4); Supplement 26-1",
      "checkedOn": "2026-09-26",
      "claims": [
        "First-party comparable methods",
        "Taxes and fees",
        "Condition and deduction documentation"
      ],
      "applicability": "First-party actual-cash-value or like-kind total-loss provisions and stated deduction rules."
    },
    {
      "id": "az-title",
      "title": "Arizona Revised Statutes § 28-2091",
      "url": "https://www.azleg.gov/ars/28/02091.htm",
      "locator": "Subsections C, F, and T(2)–(3)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Uneconomical-repair definition",
        "Nonrepairable distinction",
        "Owner-retention qualifications"
      ],
      "applicability": "Arizona salvage, stolen, and nonrepairable certificates; specified registration exceptions apply."
    },
    {
      "id": "az-complaints",
      "title": "Arizona insurance complaint guidance",
      "url": "https://difi.az.gov/file-a-complaint#insurance",
      "locator": "Before You File; We Can / We Cannot; Filing an Insurance Complaint",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claim-handling review",
        "Complaint does not extend deadlines",
        "Attachment preparation"
      ],
      "applicability": "Insurance complaints within DIFI jurisdiction; existing litigation or representation can limit assistance."
    }
  ]
} satisfies StateGuideContent;
