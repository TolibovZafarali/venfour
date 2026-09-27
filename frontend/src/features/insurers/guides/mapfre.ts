import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "mapfre",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "MAPFRE’s auto-claims page says a total-loss claim transfers from the original Claim Representative to a Total Loss Claim Representative. Confirm who now handles the valuation and ask that person for the complete report and written settlement explanation.",
      "sources": [
        "auto"
      ]
    },
    {
      "text": "MAPFRE’s contact page includes a Send Claim Documents entry point. Use the official link for your existing claim, and confirm the claim number and intended recipient before uploading corrections or vehicle records. Keep a copy of the files and any submission confirmation.",
      "sources": [
        "contact"
      ]
    },
    {
      "text": "The total-loss guide describes title and lender paperwork as part of completing the claim. Gather those administrative records separately from the valuation report and evidence so each request can be tracked without losing the questions about vehicle value.",
      "sources": [
        "total-loss"
      ]
    }
  ],
  "valuation": [
    {
      "text": "MAPFRE’s total-loss FAQ identifies pre-loss condition, age, make, model and mileage among valuation inputs, alongside similar-vehicle value. Compare the actual report with your vehicle records and ask which evidence supports any input that seems inaccurate.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Check installed equipment and trim carefully before gathering alternative listings. For each comparison, keep the listing date, seller, location, mileage and specifications together. Explain important differences; a similar model name alone does not establish a close match."
    },
    {
      "text": "Review the vehicle value and settlement payment on separate lines. Ask which deductible or other adjustments apply to this claim and how any lender payment is allocated. A loan payoff document helps explain the payment destination, but it does not establish the vehicle’s market value."
    }
  ],
  "reconsideration": [
    {
      "text": "Address the review request to the Total Loss Claim Representative, including the report version and the page for each correction. If the claim changed hands recently, ask whether your earlier attachments transferred with it before sending duplicate copies."
    },
    {
      "text": "Keep the message focused on evidence: the recorded input, the proposed correction and the supporting document. Ask for a revised report when the calculation changes and a written explanation of remaining differences. Confirm receipt so an upload is not mistaken for a completed review."
    }
  ],
  "faqs": [
    {
      "title": "Why is a different representative contacting me?",
      "paragraphs": [
        {
          "text": "MAPFRE’s auto-claims page describes a transfer to a Total Loss Claim Representative after the vehicle is determined to be a total loss. Confirm that person’s contact details through your existing claim channel.",
          "sources": [
            "auto"
          ]
        }
      ]
    },
    {
      "title": "Does a rental automatically last until I accept an offer?",
      "paragraphs": [
        {
          "text": "Do not assume that. MAPFRE’s total-loss guidance makes rental support conditional on coverage and unexhausted limits, and ties it to the offer stage. Ask for your specific authorized dates before extending the rental.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Are title requirements the same for every MAPFRE claim?",
      "paragraphs": [
        {
          "text": "MAPFRE notes that title requirements differ by state and that lender-held titles need coordination with the lender. Get the instructions for your claim before signing or mailing ownership documents.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "auto",
      "title": "MAPFRE auto claims",
      "url": "https://www.mapfreinsurance.com/auto-claims/",
      "locator": "Who is handling my claim?; What if my vehicle is deemed a Total Loss?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Transfer to a Total Loss Claim Representative"
      ],
      "applicability": "General auto process. Repair payment estimates are not applied to total-loss claims."
    },
    {
      "id": "contact",
      "title": "MAPFRE contact and document services",
      "url": "https://www.mapfreinsurance.com/contact/",
      "locator": "Quick Access Services: Send Claim Documents",
      "checkedOn": "2026-09-26",
      "claims": [
        "Official document submission entry point"
      ],
      "applicability": "Document access entry point; the appropriate company and claim details must be confirmed."
    },
    {
      "id": "total-loss",
      "title": "MAPFRE: When Your Vehicle is a Total Loss",
      "url": "https://www.mapfreinsurance.com/blog/total-loss-next-steps/",
      "locator": "Rental; value determination; paperwork before payment",
      "checkedOn": "2026-09-26",
      "claims": [
        "Pre-loss valuation factors",
        "Conditional rental arrangements",
        "State-dependent title requirements"
      ],
      "applicability": "General total-loss guide. No universal rental deadline, storage allowance or vehicle-retention rule is adopted."
    }
  ]
} satisfies InsurerGuideContent;
