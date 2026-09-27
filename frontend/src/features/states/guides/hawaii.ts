import type { StateGuideContent } from "../guide-content";

export default {
  "code": "HI",
  "description": "Understand Hawaii total-loss valuations, replacement-vehicle tax deadlines, salvage requirements, and options for reviewing an offer.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "For first-party cash settlements under an actual-cash-value or replacement policy, Hawaii requires a source that reflects the retail market. If the usual source is unavailable or does not reflect value, the statute provides alternative evidence methods.",
      "sources": [
        "cash-rule"
      ]
    },
    {
      "text": "Hawaii’s Insurance Division advises checking the vehicle’s pre-loss condition and mileage and supporting a disputed offer with local comparisons. A recent safety-check record can help document mileage. Match the island market and vehicle configuration carefully, and explain why each listing is relevant.",
      "sources": [
        "consumer-guide"
      ]
    }
  ],
  "rules": [
    {
      "title": "A 30-day replacement-value review",
      "paragraphs": [
        {
          "text": "For a cash settlement under your own policy, notify your insurer within 30 days after receiving payment if you cannot buy a comparable vehicle for its valuation before deductions and have located, but not purchased, a more expensive comparable. The insurer must reopen the file and use a statutory resolution option: locate a comparable, address the difference or purchase, or use the policy’s appraisal process. The insurer must explain this recourse in writing at settlement.",
          "sources": [
            "cash-rule"
          ]
        }
      ]
    },
    {
      "title": "Replacement taxes have two separate deadlines",
      "paragraphs": [
        {
          "text": "After a cash settlement under your own policy, Hawaii’s reimbursement provision generally requires purchasing a replacement within 30 days after receipt and providing purchase and payment proof within 33 days after receipt. It covers general excise tax and ownership fees; the tax cannot exceed the tax calculated on the lost vehicle’s value. A cheaper replacement uses the actual tax paid. An insurer may pay upfront instead. Request the written reimbursement procedure before buying.",
          "sources": [
            "tax-rule"
          ]
        }
      ]
    },
    {
      "title": "Owner-retained salvage requires a separate process",
      "paragraphs": [
        {
          "text": "When a salvage vehicle remains with its owner following a first-party or third-party settlement, the insurer must notify the county finance director within 10 days after the settlement date and notify the owner in writing about recertification. A rebuilt salvage vehicle requires the prescribed documents and qualified repair certification before it can be licensed for road use. Confirm the county’s requirements before keeping or repairing it.",
          "sources": [
            "salvage-rule"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Keep the settlement receipt date and any replacement search in your claim notes. Send the insurer the exact vehicle corrections, local listings, and supporting mileage or condition records you want reviewed. If you are relying on the replacement-value procedure, state that clearly instead of sending only a general disagreement.",
      "sources": [
        "cash-rule",
        "consumer-guide"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can I request appraisal in Hawaii?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, review its procedure and costs before invoking it. Hawaii’s Insurance Division identifies policy appraisal as a possible route when negotiation does not resolve a value disagreement. A clause in your own policy should not be assumed to apply to someone else’s insurer.",
          "sources": [
            "consumer-guide"
          ]
        }
      ]
    },
    {
      "title": "Who can help with an insurance complaint?",
      "paragraphs": [
        {
          "text": "The Hawaii Insurance Division recommends discussing the concern with its investigators before filing a formal complaint; some issues can be resolved informally. Its complaint page explains the next steps and links to the complaint form. Include the offer, valuation documents, and your written request for correction.",
          "sources": [
            "complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "cash-rule",
      "title": "Hawaii cash-settlement requirements",
      "url": "https://data.capitol.hawaii.gov/hrscurrent/Vol09_Ch0431-0435H/HRS0431/HRS_0431-0010C-0311.htm",
      "locator": "HRS §431:10C-311",
      "checkedOn": "2026-09-26",
      "claims": [
        "Market valuation",
        "30-day recourse"
      ],
      "applicability": "First-party cash settlements under the specified policy basis."
    },
    {
      "id": "tax-rule",
      "title": "Hawaii total-loss tax and fee reimbursement",
      "url": "https://data.capitol.hawaii.gov/hrscurrent/Vol09_Ch0431-0435H/HRS0431/HRS_0431-0010C-0312.htm",
      "locator": "HRS §431:10C-312",
      "checkedOn": "2026-09-26",
      "claims": [
        "30-day purchase",
        "33-day documentation"
      ],
      "applicability": "Cash settlements; upfront payment alternative."
    },
    {
      "id": "salvage-rule",
      "title": "Hawaii salvage and rebuilt vehicles",
      "url": "https://data.capitol.hawaii.gov/hrscurrent/Vol05_Ch0261-0319/HRS0286/HRS_0286-0048.htm",
      "locator": "HRS §286-48",
      "checkedOn": "2026-09-26",
      "claims": [
        "Owner retention",
        "Recertification"
      ],
      "applicability": "Salvage titling; owner retention after first- or third-party settlement."
    },
    {
      "id": "consumer-guide",
      "title": "Hawaii automobile fire and storm claims guidance",
      "url": "https://www.cca.hawaii.gov/ins/automobile-fire-and-storm-damage-claims-2/",
      "locator": "Total-loss valuation and disagreement guidance",
      "checkedOn": "2026-09-26",
      "claims": [
        "Local evidence",
        "Policy appraisal"
      ],
      "applicability": "Consumer guidance in the fire and storm claims context."
    },
    {
      "id": "complaints",
      "title": "Hawaii Insurance Division complaints",
      "url": "https://cca.hawaii.gov/ins/complaint/",
      "locator": "Complaint process",
      "checkedOn": "2026-09-26",
      "claims": [
        "Investigator assistance"
      ],
      "applicability": "Insurance complaints within Hawaii jurisdiction."
    }
  ]
} satisfies StateGuideContent;
