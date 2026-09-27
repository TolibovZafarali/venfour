import type { StateGuideContent } from "../guide-content";

export default {
  "code": "IN",
  "description": "Understand Indiana total-loss offers, settlement sales tax, salvage-title steps, vehicle excise refunds, and insurance review options.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Indiana’s Department of Insurance recommends reading the policy, checking the deductible and covered losses, and asking the adjuster for an itemized explanation of an offer. For a total-loss dispute, request the valuation report so you can separate the vehicle value from taxes, fees, and other adjustments.",
      "sources": [
        "claim-tips"
      ]
    },
    {
      "text": "Compare the report’s mileage, trim, equipment, and pre-loss condition with your records. Use similar vehicles and explain each material difference. A precise correction request gives the insurer something concrete to review."
    }
  ],
  "rules": [
    {
      "title": "Sales tax is addressed when the loss is paid",
      "paragraphs": [
        {
          "text": "Indiana’s Bulletin 82 directs auto insurers to include sales tax in addition to the amount paid for the totaled vehicle when compensating the insured. The tax is based on the vehicle amount; the bulletin rejects waiting to see whether the insured buys a replacement. Ask the insurer to show this calculation separately.",
          "sources": [
            "tax-bulletin"
          ]
        }
      ]
    },
    {
      "title": "Keeping salvage requires title paperwork",
      "paragraphs": [
        {
          "text": "For vehicles that qualify for salvage titling, the BMV’s application checklist distinguishes vehicles manufactured within the last seven model years, for which a salvage title is required, from older vehicles, for which it may be requested. If you retain a vehicle subject to salvage titling after settlement, the checklist requires applying within 45 days of the settlement date, with supporting settlement documentation.",
          "sources": [
            "salvage-packet"
          ]
        },
        {
          "text": "Ask the BMV about the vehicle’s particular classification and rebuilding requirements before authorizing repairs. A salvage filing rule does not tell you what the undamaged vehicle was worth."
        }
      ]
    },
    {
      "title": "Check for a separate vehicle-excise credit or refund",
      "paragraphs": [
        {
          "text": "Indiana’s BMV lists a totaled or destroyed vehicle as a potential reason for an eligible vehicle-excise tax credit or refund. Its instructions identify Form 55296 and supporting proof, such as an insurer statement identifying the vehicle. This concerns vehicle-excise taxes associated with registration; it is a separate question from sales tax included in the insurance settlement.",
          "sources": [
            "excise-guide"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask which policy provision and facts explain any disputed reduction or denial. Indiana’s claim tips recommend obtaining the basis for a denial in writing, keeping call notes, and preserving correspondence. Organize your request around the vehicle details, value evidence, and settlement breakdown.",
      "sources": [
        "claim-tips"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can appraisal help with an Indiana value dispute?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, ask the insurer for that wording and review its costs, deadlines, and effect before choosing that route. Indiana’s policy-reading guidance is a starting point; whether appraisal is available in your claim depends on the actual contract.",
          "sources": [
            "claim-tips"
          ]
        }
      ]
    },
    {
      "title": "What can the Indiana Department of Insurance do?",
      "paragraphs": [
        {
          "text": "IDOI can request information from the company, review compliance with insurance law and policy terms, and explain relevant provisions. It cannot act as your legal representative. Try the company first, then submit copies of the offer, policy, and correspondence through the complaint process if the concern remains unresolved.",
          "sources": [
            "complaint-authority"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claim-tips",
      "title": "Indiana insurance claim tips",
      "url": "https://www.in.gov/idoi/consumer-services/insurance-claim-tips/",
      "locator": "Policy review, settlement offers, and disagreements",
      "checkedOn": "2026-09-26",
      "claims": [
        "Itemization",
        "Written explanation",
        "Policy review"
      ],
      "applicability": "General consumer guidance; appraisal is conditional."
    },
    {
      "id": "tax-bulletin",
      "title": "Indiana Bulletin 82: automobile sales tax",
      "url": "https://www.in.gov/idoi/files/Bulletin_82.pdf#page=1",
      "locator": "Page 1",
      "checkedOn": "2026-09-26",
      "claims": [
        "Sales tax timing and basis"
      ],
      "applicability": "Insured automobile total-loss payments."
    },
    {
      "id": "salvage-packet",
      "title": "Indiana salvage title application checklist",
      "url": "https://www.in.gov/bmv/titles/files/Salvage_Title_Application_Packet.pdf#page=1",
      "locator": "Salvage title requirements",
      "checkedOn": "2026-09-26",
      "claims": [
        "Model-year scope",
        "Owner-retained filing deadline"
      ],
      "applicability": "Vehicles qualifying for salvage titling."
    },
    {
      "id": "excise-guide",
      "title": "Indiana registration fees and taxes",
      "url": "https://www.in.gov/bmv/fees-taxes/vehicle-registration-fees-and-taxes/",
      "locator": "Excise tax credits and refunds",
      "checkedOn": "2026-09-26",
      "claims": [
        "Destroyed-vehicle excise credit or refund"
      ],
      "applicability": "Eligible registration-related taxes; application and proof required."
    },
    {
      "id": "complaint-authority",
      "title": "Indiana insurance assistance and limits",
      "url": "https://www.in.gov/idoi/consumer-services/we-can-or-cannot-do/",
      "locator": "What IDOI can and cannot do",
      "checkedOn": "2026-09-26",
      "claims": [
        "Regulator authority",
        "Complaint preparation"
      ],
      "applicability": "Matters within Indiana insurance jurisdiction."
    }
  ]
} satisfies StateGuideContent;

