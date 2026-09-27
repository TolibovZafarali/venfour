import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "usaa",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "USAA’s My Claims Center supports reviewing and uploading documents, contacting the adjuster and checking claim status through its website or app. Start there to gather the report and offer for your existing claim.",
      "sources": [
        "claims-center"
      ]
    },
    {
      "text": "Its auto-claims FAQ says you can review a detailed inspection report before the settlement offer is finalized. Ask for the complete report, including the comparable-vehicle and adjustment details, if you have received only a summary.",
      "sources": [
        "auto-faq"
      ]
    },
    {
      "text": "Keep your original report and the documents you submit in one dated record. If you see more than one estimate, ask the adjuster which document supports the current total-loss offer. Do not assume a repair estimate contains the same information as the vehicle valuation."
    }
  ],
  "valuation": [
    {
      "text": "USAA says its vendor database finds similar vehicles recently offered for sale nearby and adjusts for mileage, condition and options. Those offered-for-sale prices should not be described as verified sale prices.",
      "sources": [
        "auto-faq"
      ]
    },
    {
      "text": "Start by checking the mileage and equipment recorded for your vehicle. Compare trim and packages with vehicle-specific records. If an option appears on one report page but seems absent from a comparison, ask the adjuster to show where its effect is included."
    },
    {
      "text": "For each comparable, examine the underlying vehicle details and the adjustments separately. A nearby vehicle may still differ in drivetrain, equipment or condition. Explain the specific mismatch or unclear adjustment instead of relying on a more expensive listing alone."
    },
    {
      "text": "If you provide additional market evidence, retain the listing date, location, seller and vehicle details. Identify the prices as advertised asking prices and explain why the vehicles help answer your particular report question. An advertised price does not establish the settlement you should receive."
    }
  ],
  "reconsideration": [
    {
      "text": "USAA’s FAQ explicitly directs you to tell the adjuster if something in the report looks wrong and to send supporting documents through My Claims Center. It says documents sent there receive a confirmation.",
      "sources": [
        "auto-faq"
      ]
    },
    {
      "text": "Submit a concise correction list alongside the evidence and retain that confirmation. Ask for a response to each item, an updated report where appropriate and an explanation of anything left unchanged. Keep valuation questions separate from lender payoff or coverage questions."
    }
  ],
  "faqs": [
    {
      "title": "Can I find my adjuster’s contact information in My Claims Center?",
      "paragraphs": [
        {
          "text": "Yes. USAA’s claims guidance identifies My Claims Center as the place to contact your adjuster and manage the claim. Use the contact shown for your existing claim when asking about the valuation.",
          "sources": [
            "claims-center"
          ]
        }
      ]
    },
    {
      "title": "What if USAA is the other driver’s insurer?",
      "paragraphs": [
        {
          "text": "USAA provides a separate third-party claim route for someone claiming against a policyholder. Confirm that you are using that route; benefits or provisions under your own policy do not automatically apply to the other driver’s policy.",
          "sources": [
            "claims-center"
          ]
        }
      ]
    },
    {
      "title": "Can I keep the vehicle after a total loss?",
      "paragraphs": [
        {
          "text": "USAA describes a salvage deduction if you retain the vehicle and cautions that title and registration requirements depend on the state. Check those requirements and the revised payment breakdown before deciding.",
          "sources": [
            "auto-faq"
          ]
        }
      ]
    },
    {
      "title": "Does USAA identify one valuation vendor for every claim?",
      "paragraphs": [
        {
          "text": "The public FAQ cited here describes a vendor database tool without naming a company. Check the provider name and report version on your own documents rather than assuming that every USAA claim uses the same report format.",
          "sources": [
            "auto-faq"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims-center",
      "title": "USAA auto and property claims center",
      "url": "https://www.usaa.com/support/insurance/claims/",
      "locator": "Managing your claim is easy; Get helpful claims information: Third party",
      "checkedOn": "2026-09-26",
      "claims": [
        "My Claims Center document access and adjuster contact",
        "Separate third-party claim route"
      ],
      "applicability": "USAA’s public claims guidance. Member and third-party claim paths differ; policy terms control coverage."
    },
    {
      "id": "auto-faq",
      "title": "USAA auto claims FAQ",
      "url": "https://www.usaa.com/support/insurance/claims/auto/faq/",
      "locator": "Claims process: document submission; Total loss: ACV and vehicle retention",
      "checkedOn": "2026-09-26",
      "claims": [
        "Comparable vehicles offered for sale",
        "Mileage, condition and option adjustments",
        "Review before finalizing settlement",
        "Supporting documents and confirmation",
        "State-dependent retention"
      ],
      "applicability": "USAA’s public auto-claims FAQ. It does not name a universal vendor; state rules and individual claim circumstances affect retention."
    }
  ]
} satisfies InsurerGuideContent;
