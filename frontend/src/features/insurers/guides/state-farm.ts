import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "state-farm",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "State Farm directs questions about the vehicle’s value to your claim associate. Ask for the complete valuation report and written settlement breakdown, including the comparable vehicles and any adjustments used in the calculation.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Its claims account and mobile app support document uploads, claim-status checks and communication with the claims team. Use your existing claim to submit supporting records and keep a copy of your message and attachments.",
      "sources": [
        "auto-claims"
      ]
    },
    {
      "text": "Request the actual report even if the offer was explained by phone. Write down which figure is the vehicle value, which is the proposed payment and which amount, if any, goes to a lender. This makes it easier to identify whether your question concerns the valuation or the payment calculation."
    }
  ],
  "valuation": [
    {
      "text": "State Farm lists age, condition, equipment and mileage at the time of loss among its ACV factors. Its total-loss guidance describes payment to the owner, lienholder or both, less any applicable policy deductible.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Compare the recorded equipment with a window sticker, build record or other evidence tied to your vehicle. If the report gives an unfamiliar trim or package description, ask the claim associate to explain it before assuming equipment was omitted."
    },
    {
      "text": "For condition differences, point to the specific rating or deduction and provide dated photographs or relevant repair records. Explain what the evidence establishes about the vehicle before the loss. An invoice amount is not automatically the value of a correction."
    },
    {
      "text": "Review the comparable vehicles independently of the final total. Check configuration, location, mileage and condition, then read how differences were adjusted. If you offer other listings, keep their dates and seller details and describe the prices as asking prices, not verified transactions."
    }
  ],
  "reconsideration": [
    {
      "text": "Use the claim conversation to send a short, numbered list of the report details you want reviewed. Make each request concrete: the recorded information, the correction you believe is supported and the document that supports it. Ask the claim associate for an explanation of how each accepted correction changes the calculation."
    },
    {
      "text": "Save any revised report alongside the original and compare both the vehicle details and the adjustments. If the value is unchanged, ask for a response to the unresolved evidence rather than repeating a general request for more money."
    }
  ],
  "faqs": [
    {
      "title": "Should I discuss valuation with my State Farm agent or claim associate?",
      "paragraphs": [
        {
          "text": "State Farm’s total-loss page directs valuation questions to the claim associate. It separately directs policy-option questions to your agent after title transfer and rental return. Use the claim associate for the report review.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "What paperwork should I locate?",
      "paragraphs": [
        {
          "text": "State Farm lists the title and all vehicle keys among the items to gather. It also asks customers to authorize a finance or leasing company to work with it on the claim. Follow the instructions provided for your vehicle’s ownership situation.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Does my rental have a standard end date?",
      "paragraphs": [
        {
          "text": "State Farm says it will explain rental availability when the policy includes rental reimbursement. Ask the claim associate for your covered end date and limit, especially while you are reviewing the valuation.",
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
      "title": "State Farm total-loss claims",
      "url": "https://www.statefarm.com/claims/auto/total-loss",
      "locator": "What happens next?; What is actual cash value and who gets the payment?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claim associate handles value questions",
        "ACV factors and payment recipients",
        "Title, keys and lender permission",
        "Rental availability and policy-option contact"
      ],
      "applicability": "State Farm’s published total-loss guidance, principally describing own-policy coverage. Applicable deductible, rental coverage and paperwork depend on the policy and claim."
    },
    {
      "id": "auto-claims",
      "title": "State Farm auto claims",
      "url": "https://www.statefarm.com/claims/auto",
      "locator": "Can I track and manage my claim after I file?; Online and mobile claim management",
      "checkedOn": "2026-09-26",
      "claims": [
        "Online and app document uploads",
        "Claim-team communication and status tracking"
      ],
      "applicability": "General State Farm claim-management capabilities; this source does not establish a particular valuation-report download path."
    }
  ]
} satisfies InsurerGuideContent;
