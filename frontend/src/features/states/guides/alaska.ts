import type { StateGuideContent } from "../guide-content";

export default {
  "code": "AK",
  "description": "Understand Alaska total-loss comparisons, settlement deductions, required policy appraisal, and salvage titles. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Alaska’s claim guidance distinguishes a comparable replacement vehicle from a cash settlement based on the actual cost of a comparable vehicle. These options concern first-party coverage that settles at actual cash value or replaces with like kind and quality. Ask which method your insurer used before comparing the final check with dealer prices.",
      "sources": [
        "ak-rights"
      ]
    },
    {
      "text": "For an Alaska vehicle, make your comparison practical: identify where the proposed replacement is available and record its mileage, equipment, condition, and delivered cost. A distant listing is easier to assess when transportation and other differences are shown explicitly."
    }
  ],
  "rules": [
    {
      "title": "Account for replacement costs and explain deductions.",
      "paragraphs": [
        {
          "text": "Alaska’s current automobile-policy checklist describes settlement through an available comparable vehicle or its actual cost in cash. The replacement offer includes applicable taxes, license fees, destination or delivery charges, and other ownership-transfer fees. Deductions, including salvage, must be fair, appropriate, and fully explained.",
          "sources": [
            "ak-checklist"
          ]
        }
      ]
    },
    {
      "title": "The payment clock has a specific starting point.",
      "paragraphs": [
        {
          "text": "The division’s rights guide says an undisputed first-party amount must be paid within 30 working days after receipt of a properly executed claim statement, proof of loss, or other acceptable evidence of loss. This is not simply 30 days after the crash.",
          "sources": [
            "ak-rights"
          ]
        },
        {
          "text": "If an investigation remains incomplete after 30 working days and the claim is not in litigation, the guide describes a written explanation and expected completion date, followed by updates every 45 days. Keep a dated record of what you supplied and what is still requested.",
          "sources": [
            "ak-rights"
          ]
        }
      ]
    },
    {
      "title": "A salvage title is not permission to drive.",
      "paragraphs": [
        {
          "text": "Alaska DMV introduced salvage titles beginning August 1, 2025. A salvage title documents ownership of an incomplete vehicle; it does not authorize road use. A reconstructed title is required before registration. Check the DMV’s application and reconstruction requirements before deciding whether keeping and repairing the vehicle is worthwhile.",
          "sources": [
            "ak-salvage"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask the adjuster to identify the available replacement or the comparables used for the cash offer. Send corrections with photographs, equipment records, and dated listings, and ask that delivery-related differences be addressed explicitly."
    },
    {
      "text": "Keep requests about valuation separate from questions about payment timing. A written chronology makes it easier to identify whether the remaining issue is missing evidence, a disputed amount, or an unexplained delay."
    }
  ],
  "faqs": [
    {
      "title": "Does Alaska require an appraisal clause?",
      "paragraphs": [
        {
          "text": "Yes. Alaska’s August 2026 automobile-policy checklist identifies AS 21.96.035 as requiring motor-vehicle policies to include an appraisal clause for disagreements about value. The process must follow the statute’s procedures and timeframes. Ask for the policy clause and a written explanation of appraiser selection, the umpire, and expenses before invoking it.",
          "sources": [
            "ak-checklist"
          ]
        },
        {
          "text": "Venfour’s valuation review is separate from the policy’s formal appraisal process; Venfour does not serve as your appointed appraiser."
        }
      ]
    },
    {
      "title": "What can the Alaska Division of Insurance help with?",
      "paragraphs": [
        {
          "text": "The division accepts complaints involving claim delays, denials, and settlement handling within its jurisdiction. It cannot determine fault or negotiate a settlement for you. Include the valuation, your correction request, and the insurer’s response so the department can review the handling concern.",
          "sources": [
            "ak-complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "ak-rights",
      "title": "Alaska rights during an insurance claim",
      "url": "https://www.commerce.alaska.gov/web/ins/Consumers/Rights/Claims.aspx",
      "locator": "Total loss; timely payment and investigation notices",
      "checkedOn": "2026-09-26",
      "claims": [
        "Comparable replacement or cash",
        "30 working days after specified evidence",
        "Investigation updates"
      ],
      "applicability": "First-party payment and total-loss provisions; litigation and unresolved disputes affect applicability."
    },
    {
      "id": "ak-checklist",
      "title": "Alaska personal automobile forms checklist",
      "url": "https://www.commerce.alaska.gov/web/Portals/11/pub/RatesAndForms/Personal_Automobile_Forms_Checklist.pdf#page=1",
      "locator": "Revised 8/26: page 1 Appraisal; page 3 Claims Settlement",
      "checkedOn": "2026-09-26",
      "claims": [
        "Required appraisal clause",
        "Comparable settlement costs",
        "Explained deductions"
      ],
      "applicability": "Motor-vehicle policy requirements and 3 AAC 26.080 settlement provisions; appraisal expense allocation follows AS 21.96.035."
    },
    {
      "id": "ak-salvage",
      "title": "Alaska DMV salvage vehicle titles",
      "url": "https://dmv.alaska.gov/vehicle-services/salvage-vehicle-titles/",
      "locator": "Effective August 1, 2025; title and reconstruction instructions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Ownership-only salvage document",
        "Reconstructed title before registration"
      ],
      "applicability": "Incomplete vehicles subject to Alaska salvage titling; page excludes boats, manufactured homes, and off-highway vehicles."
    },
    {
      "id": "ak-complaints",
      "title": "Alaska insurance consumer complaints",
      "url": "https://www.commerce.alaska.gov/web/ins/Consumers/Complaints",
      "locator": "What we can and cannot do",
      "checkedOn": "2026-09-26",
      "claims": [
        "Complaint assistance",
        "No fault determination or settlement negotiation"
      ],
      "applicability": "Insurance matters within division jurisdiction."
    }
  ]
} satisfies StateGuideContent;
