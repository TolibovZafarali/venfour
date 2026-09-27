import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "liberty-mutual",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Liberty Mutual says a Total Loss Adjuster will explain its evaluation. Ask that adjuster for the complete valuation report and written settlement calculation so you can review the details behind the figure.",
      "sources": [
        "claims-faq"
      ]
    },
    {
      "text": "Its online account supports claim updates and document uploads. Keep a copy of each submitted record and use your existing claim reference when asking whether the adjuster received it.",
      "sources": [
        "claims-faq"
      ]
    },
    {
      "text": "If you are claiming against someone insured by Liberty Mutual, use the third-party guidance. That page also describes contact from a total-loss specialist, while explaining that payment depends on its policyholder’s legal obligations under the applicable state law.",
      "sources": [
        "third-party"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Liberty Mutual’s listed total-loss considerations include damage severity, age, condition, pre-accident market value, salvage value and state requirements. Ask which consideration led to the total-loss decision and then review the separate calculation of the vehicle’s value.",
      "sources": [
        "claims-faq"
      ]
    },
    {
      "text": "The repair estimate, vehicle valuation and salvage figure answer different questions. If the explanation combines them, request an itemized breakdown that lets you see the pre-loss vehicle value separately from other amounts. A decision that repairs are uneconomical does not, by itself, explain the valuation."
    },
    {
      "text": "Check that the report reflects your vehicle’s trim, drivetrain, mileage and installed equipment. Then examine how each comparable differs and which adjustments account for the differences. If the report gives a condition rating without supporting detail, ask for the inspection notes or photographs behind it."
    },
    {
      "text": "When preparing additional market evidence, favor a small set of well-matched vehicles with identifiable sellers, dates and locations. Explain differences openly. Listings show asking prices; they do not establish completed sale prices or the amount the insurer must pay."
    }
  ],
  "reconsideration": [
    {
      "text": "Address the request to the Total Loss Adjuster handling the evaluation. Group corrections by vehicle details, comparable evidence and adjustments. For each item, give the report page, your reason for questioning it and the supporting record."
    },
    {
      "text": "Ask the adjuster to explain any item that remains unchanged and to send a revised report when a correction affects the calculation. Keep a dated record of the original offer, your submission and the response. If the disagreement is about coverage or liability rather than value, ask for that issue to be explained separately."
    }
  ],
  "faqs": [
    {
      "title": "Do the policyholder instructions also apply to a third-party claim?",
      "paragraphs": [
        {
          "text": "Do not assume that they do. Liberty Mutual publishes separate third-party guidance. Confirm the claim pathway and applicable coverage before relying on a policy deductible, rental benefit or appraisal provision.",
          "sources": [
            "third-party"
          ]
        }
      ]
    },
    {
      "title": "Will rental coverage continue while I question the value?",
      "paragraphs": [
        {
          "text": "Liberty Mutual ties the rental end to a reasonable period after valuation notice or exhaustion of the rental limit, whichever comes first. Ask your representative for the date and limit that apply to your claim.",
          "sources": [
            "claims-faq"
          ]
        }
      ]
    },
    {
      "title": "What if the valuation report is not in my online account?",
      "paragraphs": [
        {
          "text": "Ask the Total Loss Adjuster to send the complete report and explain how to submit your response. Document-upload access does not establish that every valuation report is available through a particular download screen. Keep working from the actual documents provided for your claim."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims-faq",
      "title": "Liberty Mutual claims FAQ",
      "url": "https://www.libertymutual.com/claims-center/claims-faq",
      "locator": "Claim management; What if my vehicle is a total loss?; How is a total loss determined?; Total-loss rental period",
      "checkedOn": "2026-09-26",
      "claims": [
        "Evaluation explanation by a Total Loss Adjuster",
        "Online document uploads",
        "Total-loss factors",
        "Rental cutoff depends on notice and limits"
      ],
      "applicability": "General Liberty Mutual claims guidance. The policy, claim circumstances and applicable state requirements control; cited for process rather than its state-law summaries."
    },
    {
      "id": "third-party",
      "title": "Liberty Mutual third-party claims FAQ",
      "url": "https://www.libertymutual.com/claims-center/claims-third-party-faqs",
      "locator": "What if my car is a total loss?; How is payment made?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Total-loss specialist contact for third-party claims",
        "Payment basis differs from own-policy coverage"
      ],
      "applicability": "Claims against a Liberty Mutual policyholder. State-specific portions of the page should not be generalized to every claim."
    }
  ]
} satisfies InsurerGuideContent;
