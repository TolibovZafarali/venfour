import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "mercury",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Mercury has an official Find your Claims Representative page that accepts a claim number or policy number. Use it to locate the person handling your loss, then ask for the complete valuation report and the written breakdown of the settlement offer.",
      "sources": [
        "contact"
      ]
    },
    {
      "text": "Mercury’s total-loss article recommends asking about required documentation and how the settlement is calculated. It also suggests gathering maintenance and upgrade records and retaining copies of claim documents. Organize those records around the particular report inputs you want checked.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "If you have only a repair estimate, request the later valuation used for the total-loss offer. Keep both documents and label the dates. For a claim involving someone else’s policy, explain your role and ask the representative which documents and submission method are appropriate for you."
    }
  ],
  "valuation": [
    {
      "text": "Begin with the correct vehicle configuration and mileage. Check whether the report identifies the same trim, engine, drivetrain and equipment as your vehicle. For a missing feature, provide a specific supporting record rather than a general description such as fully loaded."
    },
    {
      "text": "Review condition separately from spending on the vehicle. A repair receipt may help show that an earlier problem was resolved before the loss, but the invoice amount is not automatically an addition to value. Explain the fact each record supports and ask how the report treats it."
    },
    {
      "text": "Mercury’s article distinguishes vehicle value from the effect of a deductible and discusses lender or lease payment questions. Ask for those items to be explained separately on your own offer; do not assume the amount payable to you is the report’s vehicle value.",
      "sources": [
        "total-loss"
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Write to the assigned representative with a short list of report pages, requested corrections and supporting files. If proposing comparable listings, preserve the location, date, seller and vehicle specifications. A higher asking price needs a relevant vehicle comparison to be useful."
    },
    {
      "text": "Request an explanation of adjustments you cannot follow and an updated report if the inputs change. Keep the response with the original documents. Ask separately how any open review affects the next administrative steps, rather than assuming title or rental arrangements are paused."
    }
  ],
  "faqs": [
    {
      "title": "How do I find the Mercury representative assigned to my claim?",
      "paragraphs": [
        {
          "text": "Start with Mercury’s Find your Claims Representative tool. It provides claim-number and policy-number search options and a claims contact if you need assistance. Use the claim correspondence to confirm the details before sharing evidence.",
          "sources": [
            "contact"
          ]
        }
      ]
    },
    {
      "title": "Should I send maintenance and upgrade receipts?",
      "paragraphs": [
        {
          "text": "Mercury’s article recommends gathering those records. Explain what each receipt establishes about the vehicle before the loss and ask whether the report already reflects it; spending alone does not prove an equal change in value.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Should I follow the same title steps in every state?",
      "paragraphs": [
        {
          "text": "Get instructions for your vehicle and jurisdiction from the claims representative and relevant motor vehicle authority. The valuation review and the requirements for transferring or retaining the vehicle are separate questions."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "contact",
      "title": "Mercury: Find your Claims Representative",
      "url": "https://www.mercuryinsurance.com/claims/find-claims-representative.html",
      "locator": "Claim Number and Policy Number search; claims contact",
      "checkedOn": "2026-09-26",
      "claims": [
        "Representative lookup options"
      ],
      "applicability": "Official lookup entry point, reviewed without entering personal or claim information."
    },
    {
      "id": "total-loss",
      "title": "Mercury: What Happens When Your Car is Totaled?",
      "url": "https://www.mercuryinsurance.com/resources/auto/when-is-a-car-considered-totaled.html",
      "locator": "Contacting Your Insurance Company; Understanding Your Policy; Handling the Vehicle’s Title and Paperwork",
      "checkedOn": "2026-09-26",
      "claims": [
        "Ask about calculation and documents",
        "Maintenance and upgrade records",
        "Distinguishing value from payment"
      ],
      "applicability": "General consumer article dated September 19, 2024. Its generalized title directions and total-loss thresholds are not adopted as nationwide rules."
    }
  ]
} satisfies InsurerGuideContent;
