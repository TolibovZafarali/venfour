import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "erie",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Erie’s claim-monitoring page says the online account and mobile app can show claim status, payment history and the contact information for claims representatives, when applicable. Find the person handling your vehicle and ask for the complete valuation report and written offer.",
      "sources": [
        "tracking"
      ]
    },
    {
      "text": "Erie’s auto-claims instructions recommend keeping the claim number, policy details, representative contacts, estimates, emails and notes of phone conversations together. Add the valuation report to that file, keeping it separate from any earlier estimate of repair costs.",
      "sources": [
        "auto"
      ]
    },
    {
      "text": "If you need help reaching the handler, the monitoring page identifies a contact option for previously reported claims. Use your existing claim number and explain that you want the documents supporting the total-loss value. Ask how to send supporting records and receive a written reply.",
      "sources": [
        "tracking"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Read the vehicle description before focusing on the offer amount. Compare the trim, engine, drivetrain, mileage and equipment with records for your vehicle. If a feature is missing, identify it precisely and supply a document or photograph that establishes it was present before the loss."
    },
    {
      "text": "For a condition adjustment, ask what observation supports the rating. Dated photos can help explain the pre-loss condition of the interior or exterior. Maintenance records can provide context, but the amount spent on upkeep is not automatically an equal increase in market value."
    },
    {
      "text": "Keep a comparable worksheet with the year, trim, mileage, location, seller and listing date. Explain any differences from your vehicle, including differences that could reduce its usefulness as a comparison. Treat listings as asking-price evidence and ask how the report adjusted them."
    }
  ],
  "reconsideration": [
    {
      "text": "Write to the claims handler with your strongest corrections first. Include the report page and attachment for each point, then ask whether the evidence changes the input, adjustment or resulting value. A concise request is easier to answer than a long list of prices without vehicle details."
    },
    {
      "text": "After a phone discussion, send a brief recap through the agreed claim channel. Ask for a corrected report when the calculation changes and an explanation for items that stay the same. Keep title, rental and payment questions listed separately so you can follow up on each."
    }
  ],
  "faqs": [
    {
      "title": "Should I contact my Erie agent or claims handler?",
      "paragraphs": [
        {
          "text": "Erie’s auto-claims page directs claim questions to the adjuster or local agent. For a valuation review, ask who is responsible for the calculation and send the supporting records to that person.",
          "sources": [
            "auto"
          ]
        }
      ]
    },
    {
      "title": "Can I see claim payments online?",
      "paragraphs": [
        {
          "text": "Erie says its online account and app can show payment status and history when applicable. Compare any payment entry with the settlement explanation; the payment record alone does not explain vehicle inputs or adjustments.",
          "sources": [
            "tracking"
          ]
        }
      ]
    },
    {
      "title": "What if the claim started with a repair estimate?",
      "paragraphs": [
        {
          "text": "Retain that estimate, but ask for the later valuation used for the total-loss offer. Identify which document and version you are questioning so the handler can respond to the value calculation you actually received."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "tracking",
      "title": "Erie: How to File and Monitor Your Claim",
      "url": "https://www.erieinsurance.com/support-center/claims",
      "locator": "Checking on your claim; previously reported claim contact",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claim tracking and payment history",
        "Claims representative contact information"
      ],
      "applicability": "Verified in a normal browser. Online features are described as available when applicable."
    },
    {
      "id": "auto",
      "title": "Erie auto insurance claims",
      "url": "https://www.erieinsurance.com/support-center/claims/auto",
      "locator": "Step 2: Get in touch with your claims handler; Step 4",
      "checkedOn": "2026-09-26",
      "claims": [
        "Recommended claim records",
        "Adjuster and agent contact"
      ],
      "applicability": "Verified in a normal browser. This is general auto claims guidance, not a published total-loss valuation formula."
    }
  ]
} satisfies InsurerGuideContent;
