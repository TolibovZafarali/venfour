import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "farmers",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Farmers’ claims FAQ provides routes for uploading receipts and documents both with a login and without one. Use the link for your existing claim, and ask the claims representative which documents are needed to review the vehicle’s value.",
      "sources": [
        "claims-faq"
      ]
    },
    {
      "text": "Farmers’ consumer guide recommends requesting the valuation report and gathering maintenance records, upgrade receipts or comparable local listings when you disagree with the value. Ask for every page so you can connect the vehicle description, comparables and adjustments to the offer.",
      "sources": [
        "review-guidance"
      ]
    },
    {
      "text": "Keep the valuation report, repair estimate and settlement explanation as separate records. If the claim began as a repair claim, check that the document you are reading is the later total-loss valuation. Label your attachments with the report item they support, rather than submitting an unexplained collection of receipts."
    }
  ],
  "valuation": [
    {
      "text": "Farmers’ general consumer guidance describes a pre-crash value based on mileage, condition, features and comparable vehicles. Read the actual report to see which inputs and evidence were used for your vehicle.",
      "sources": [
        "review-guidance"
      ]
    },
    {
      "text": "Make your first pass about accuracy: correct trim, engine, drivetrain, mileage and installed equipment. For a missing option, provide a record tied to your vehicle. If an option appears in the vehicle description but you cannot tell how it affected value, ask for an explanation before calling it an omission."
    },
    {
      "text": "Treat maintenance and upgrade records as context, not a dollar-for-dollar addition to the offer. Explain what each record establishes about condition or equipment, and ask whether the report already accounts for it. Recent spending alone is not a calculation of the vehicle’s market value."
    },
    {
      "text": "For comparable listings, preserve the listing date, seller, location, mileage and vehicle configuration. Explain both the similarities and important differences. An advertised asking price is not a verified sale price or a guaranteed settlement amount."
    }
  ],
  "reconsideration": [
    {
      "text": "Send the claims representative a concise list of corrections and supporting attachments. Farmers’ consumer guidance describes asking the insurer to reconsider and explains that policy appraisal depends on the policy’s terms.",
      "sources": [
        "review-guidance"
      ]
    },
    {
      "text": "Ask for a response to each item and an updated report if the value changes. If the disagreement remains, identify whether it is about a factual vehicle detail, a comparable, an adjustment or coverage. Keeping those questions separate helps you decide what further evidence would be useful."
    }
  ],
  "faqs": [
    {
      "title": "Can I send evidence without a Farmers login?",
      "paragraphs": [
        {
          "text": "Yes. The official claims FAQ includes a separate document-upload link for people without a login. Use that official entry point and the claim details it requests. Keep a copy of what you submitted and any confirmation.",
          "sources": [
            "claims-faq"
          ]
        }
      ]
    },
    {
      "title": "Does a second appraisal automatically apply to my claim?",
      "paragraphs": [
        {
          "text": "No. Farmers’ article qualifies appraisal as an option when the policy includes an appraisal clause. Ask for the applicable wording, requirements and costs before deciding whether to use it. Do not assume a clause in your own policy applies to a claim against another driver.",
          "sources": [
            "review-guidance"
          ]
        }
      ]
    },
    {
      "title": "Does it matter whether I use my own Farmers coverage?",
      "paragraphs": [
        {
          "text": "Farmers’ FAQ distinguishes filing under your own policy from filing with the other driver’s insurer. It describes a deductible under your Farmers policy and efforts to recover it from the other insurer when appropriate. Confirm the coverage and handling for your claim with the representative.",
          "sources": [
            "claims-faq"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims-faq",
      "title": "Farmers insurance claims FAQ",
      "url": "https://www.farmers.com/faq/claims/",
      "locator": "General Claims: How do I send receipts or documents?; Auto Claims: What if I’m not at fault for damage to my vehicle?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Document upload with or without a login",
        "Own-policy and other-insurer claim paths",
        "Deductible handling depends on claim path"
      ],
      "applicability": "Farmers’ general claims instructions; coverage, fault and recovery are determined for the individual claim."
    },
    {
      "id": "review-guidance",
      "title": "Farmers: What happens if your car is totaled but still drivable?",
      "url": "https://www.farmers.com/learn/insurance-questions/car-totaled-still-drivable/",
      "locator": "Totaled: step by step; What if you disagree with the total-loss valuation?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Request the valuation report",
        "Evidence supporting reconsideration",
        "Appraisal is conditional on policy wording",
        "General valuation inputs"
      ],
      "applicability": "General educational guidance, updated September 2026, not a specific policy. Cited for report review and reconsideration only; no nationwide title rule is adopted from the article."
    }
  ]
} satisfies InsurerGuideContent;
