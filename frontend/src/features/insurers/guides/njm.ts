import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "njm",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "NJM’s auto-claims page provides online and phone reporting and identifies the claim representative as a source of help. For an existing loss, use your claim number to ask that representative for the complete valuation, written offer and settlement breakdown.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "NJM’s total-loss guide describes inspecting the vehicle and obtaining a valuation before discussing it with you. Ask for the supporting pages so you can review the vehicle factors and comparable adjustments. Keep title or lender records in a separate group from your valuation evidence.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Retain the first offer and every revised report with their dates. If a portal or message shows only a payment amount, request the calculation behind it. A document showing who is paid does not substitute for a report explaining how the vehicle was valued."
    }
  ],
  "valuation": [
    {
      "text": "NJM identifies year, make, model, mileage, options and condition as valuation factors. Its guide says comparable vehicles are adjusted for differences. Check those inputs against your vehicle, then ask how each important difference affected the report’s value.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "For equipment, attach a record tied to your vehicle and point to the place where the report differs. For condition, use pre-loss photos or service records that explain a specific observation. Ask whether the evidence changes the rating instead of assuming a recent expense should be added in full."
    },
    {
      "text": "Keep the price and specification of any alternative listing together. Explain why its location, mileage, configuration and date make it relevant. Asking-price evidence can help frame a question, but it is not a verified sale or a guaranteed settlement amount."
    }
  ],
  "reconsideration": [
    {
      "text": "Send the claims representative a concise correction request organized by report page. Lead with objective errors before more judgment-based comparable or condition questions. Attach a small, clearly labeled set of records and ask for a response to each item."
    },
    {
      "text": "Request the revised report if NJM changes an input or adjustment. Compare it with the previous version and confirm that the settlement explanation reflects the new value. Keep lender paperwork and transportation arrangements on your follow-up list as separate items."
    }
  ],
  "faqs": [
    {
      "title": "Does my loan balance determine NJM’s vehicle valuation?",
      "paragraphs": [
        {
          "text": "NJM’s guide distinguishes actual cash value from the amount owed and explains that the financial institution has first-payment rights. Ask for a separate explanation of the valuation, lender payment and any amount payable to you.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "What should I gather for the total-loss paperwork?",
      "paragraphs": [
        {
          "text": "The NJM guide recommends locating the title or gathering lender information for a financed or leased vehicle. Ask the representative for the specific documents and instructions that apply to your ownership situation.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Are transportation costs unlimited while the offer is reviewed?",
      "paragraphs": [
        {
          "text": "No. NJM’s auto-claims page qualifies transportation reimbursement by covered loss and policy limits. Confirm the applicable daily and total limits and the authorized end date with the representative.",
          "sources": [
            "claims"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "NJM auto insurance claims",
      "url": "https://www.njm.com/insurance/auto/claims",
      "locator": "Report an Auto Insurance Claim; Transportation Expense Reimbursement and footnotes",
      "checkedOn": "2026-09-26",
      "claims": [
        "Online and phone claim contact",
        "Conditional transportation reimbursement"
      ],
      "applicability": "Personal auto claims overview. Coverage depends on the actual policy and loss; no rental extension is promised."
    },
    {
      "id": "total-loss",
      "title": "NJM total-loss process guide (PDF)",
      "url": "https://www.njm.com/-/media/pdf/insurance-products/auto/claims/faqs/gc-optimization-total-loss-infographic.pdf",
      "locator": "Page 1: actual cash value; total-loss to-do list; financed or leased vehicles",
      "checkedOn": "2026-09-26",
      "claims": [
        "Vehicle factors and comparable adjustments",
        "Title or lender information",
        "Loan balance distinct from value"
      ],
      "applicability": "Official guide linked from NJM’s current auto claims FAQ. Its response-time estimate is not presented as a universal deadline."
    }
  ]
} satisfies InsurerGuideContent;
