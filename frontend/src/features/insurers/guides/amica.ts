import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "amica",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Amica’s Claim Center lets customers log in to track claims and upload or view claim documents. Use the existing claim to locate your records, and ask the representative for the full total-loss valuation if only an estimate or payment summary appears.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "The same page provides a separate upload route for people who are not Amica customers. If your claim involves an Amica policyholder, use that official non-customer pathway and confirm the claim details before sending your supporting records.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Amica’s auto process describes an appraiser inspecting damage, sometimes through photos, and preparing an estimate. When the vehicle is treated as a total loss, request the valuation supporting that offer separately from the earlier damage estimate.",
      "sources": [
        "process"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Organize the review around the vehicle as it was before the loss. Verify the report’s trim, equipment and mileage, then compare any condition rating with dated records. If the report lists a feature but its effect on value is unclear, ask where it is included before treating it as missing."
    },
    {
      "text": "For each comparable, record the location, configuration, mileage and date. A listing with similar appearance may have different equipment or a different drivetrain. Explain the relevant similarities and differences, and keep asking prices distinct from confirmed sales."
    },
    {
      "text": "Separate the value review from questions about fault or coverage. Amica’s process describes an investigation of liability and a payment process with an applicable deductible. Ask which calculation and coverage apply to your offer, especially if you are claiming against another person’s policy.",
      "sources": [
        "process"
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Upload a short request with a table or numbered list of corrections. Name each attachment clearly and point to the matching report page. A receipt is most useful when you explain whether it establishes equipment, condition or another specific fact."
    },
    {
      "text": "Ask the representative to confirm the files are attached to your claim, explain any disputed adjustment and provide a revised valuation if inputs change. Save the submitted files and confirmation so you can follow up without reconstructing the evidence."
    }
  ],
  "faqs": [
    {
      "title": "Can I upload supporting files without being an Amica customer?",
      "paragraphs": [
        {
          "text": "Yes. Amica’s Claim Center explicitly includes a non-customer upload option. Follow that route for a claim involving an Amica customer and use the claim identifiers it requests.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Is the appraiser’s damage estimate the total-loss valuation?",
      "paragraphs": [
        {
          "text": "Do not assume so. Amica describes the inspection estimate as an assessment of visible damage. Ask which report supplies the vehicle value used for the total-loss offer.",
          "sources": [
            "process"
          ]
        }
      ]
    },
    {
      "title": "Will uploading evidence change the offer automatically?",
      "paragraphs": [
        {
          "text": "No. Ask for a review and a response to the specific corrections you propose. The evidence may support a change, explain an existing adjustment or show that the original vehicle details were already accurate."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "Amica Claim Center",
      "url": "https://www.amica.com/en/claim-center.html",
      "locator": "Amica customers; Not an Amica customer?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Customer document access",
        "Separate non-customer upload pathway"
      ],
      "applicability": "Official access instructions for existing and new claims; uploading does not establish entitlement to payment."
    },
    {
      "id": "process",
      "title": "Amica auto claims process",
      "url": "https://www.amica.com/en/claim-center/claims-frequent-questions/auto-claims-process.html",
      "locator": "Inspection; Investigation; Claim Payment; Liability",
      "checkedOn": "2026-09-26",
      "claims": [
        "Damage inspection and estimate",
        "Liability investigation",
        "Applicable deductible"
      ],
      "applicability": "General auto claim stages, not a total-loss report specification or guaranteed payment."
    }
  ]
} satisfies InsurerGuideContent;
