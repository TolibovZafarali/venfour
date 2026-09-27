import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "geico",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "GEICO’s total-loss page directs you to Claims Center to message your assigned Auto Damage Adjuster or find their phone number. Ask that adjuster for the complete valuation report, the written offer and a breakdown of the proposed payment.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "GEICO also describes uploading supporting claim documents through its claims tools. Use the existing claim to provide vehicle records or photographs, and ask the adjuster to confirm the best submission method if the upload you need is not available.",
      "sources": [
        "claims-center"
      ]
    },
    {
      "text": "Keep all report pages, even if the first page appears to show the whole offer. The later pages may explain the comparable vehicles or adjustments you need to understand. Save the original version and date any additional evidence you send."
    }
  ],
  "valuation": [
    {
      "text": "GEICO lists mileage, features and modifications, earlier damage, and recent prices of similar local vehicles among its ACV inputs. Check the report for how those details were recorded for your vehicle.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Separate damage from the claim incident from any deduction described as prior damage. If a report appears to mix the two, identify the entry and provide dated photographs or a repair record. Ask for the evidence and calculation behind the deduction; a label by itself does not explain the amount."
    },
    {
      "text": "For a missing feature or modification, show that it was installed on your vehicle before the loss. A receipt can establish the item and date, but does not automatically establish the value it adds. Ask how the item was considered and whether any policy limitation is involved."
    },
    {
      "text": "Review local comparables for matching configuration and reasonable mileage differences, then read the adjustments. When you supply additional listings, identify them as advertised asking prices unless you have evidence of a completed sale. A higher listing is a reason to examine the comparison, not proof of a higher settlement."
    }
  ],
  "reconsideration": [
    {
      "text": "Send the Auto Damage Adjuster a focused request with the report page, the detail you believe needs correction and the supporting attachment. State what you want checked, such as a missing package or a condition rating, rather than asking only for a higher number."
    },
    {
      "text": "Ask for a written explanation of the response and a revised report if the calculation changes. If the response refers you to another claim specialist, keep the same correction list and original documents together so the outstanding question remains clear."
    }
  ],
  "faqs": [
    {
      "title": "Who receives GEICO’s total-loss payment?",
      "paragraphs": [
        {
          "text": "GEICO describes different payment paths for vehicles you own outright, finance or lease. A listed finance company is paid first, with any remaining balance going to the titled owner; a leased vehicle’s payment goes to the lease company. Ask for the payoff and owner-payment amounts separately.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Can I keep the totaled vehicle?",
      "paragraphs": [
        {
          "text": "GEICO says this depends on your state and that retaining the vehicle changes the settlement amount. Ask the assigned adjuster about your specific retention option and obtain the revised breakdown before deciding.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Is the rental end date the same for every claim?",
      "paragraphs": [
        {
          "text": "No. GEICO’s process says rental availability depends on applicable coverage and claim circumstances. Ask the adjuster to confirm the covered end date and any remaining limit; do not assume a valuation question extends rental coverage.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "total-loss",
      "title": "GEICO total-loss process",
      "url": "https://www.geico.com/claims/claimsprocess/total-loss-process/",
      "locator": "Assigned Auto Damage Adjuster; Total Loss Questions: ACV, ownership, retention and rental coverage",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claims Center contact with assigned adjuster",
        "Published ACV inputs",
        "Owned, financed and leased payment paths",
        "State-dependent retention and claim-dependent rental"
      ],
      "applicability": "GEICO’s general total-loss process; policy terms, state rules, ownership and the circumstances of the claim determine applicability."
    },
    {
      "id": "claims-center",
      "title": "GEICO Claims Center",
      "url": "https://www.geico.com/claims/",
      "locator": "Handle your claim your way: Photos and documents; Track your claim from start to finish",
      "checkedOn": "2026-09-26",
      "claims": [
        "Upload supporting claim documents",
        "Track claim progress"
      ],
      "applicability": "Public guidance on GEICO claim-management tools; available tasks vary by claim. It does not promise a particular report-download screen."
    }
  ]
} satisfies InsurerGuideContent;
