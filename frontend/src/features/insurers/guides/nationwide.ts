import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "nationwide",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Nationwide says you will receive a detailed report explaining the vehicle’s value. Request it from the total-loss adjuster if you only have a payment figure, and save the complete report alongside the written offer.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Nationwide’s auto-claims page describes inspection as the step that determines repair or total-loss handling. Ask whether a document is a damage estimate, inspection record or valuation report so you review the right material.",
      "sources": [
        "auto-claims"
      ]
    },
    {
      "text": "Its total-loss guidance says to retain your physical title until instructed. For a lender-held title, it describes a power of attorney and odometer disclosure, with possible additional state requirements. Keep title instructions separate from your valuation questions.",
      "sources": [
        "total-loss"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Nationwide lists vehicle configuration, mileage, condition, major options or refurbishments, and the local comparable market as valuation inputs. It describes using a third-party vendor without naming a universal report provider.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Match those inputs against your records before judging the final number. For example, if a refurbishment is relevant, provide its date and details and ask how it was considered. Do not assume the cost of the work is added to the vehicle value dollar for dollar."
    },
    {
      "text": "Read the detailed report from the selected vehicles through to the adjusted figures. Look for configuration or condition differences that the report does not explain. For each question, identify the affected vehicle or line item so the adjuster can respond to the calculation itself."
    },
    {
      "text": "Use any additional listings as supporting market context. Preserve the date, location and vehicle details, and identify the prices as advertised asking prices. They can help explain a comparison question, but do not establish verified sales or guarantee a revised offer."
    }
  ],
  "reconsideration": [
    {
      "text": "Send the total-loss adjuster a small, organized set of questions about the detailed report. Separate factual corrections, such as mileage or equipment, from questions about comparable selection and adjustment amounts. Attach only the evidence relevant to each request."
    },
    {
      "text": "Ask for an updated report if an input changes and compare it with the original before reviewing the payment breakdown. Keep lender payoff, title-processing and rental questions in their own part of the conversation, so each has a clear answer and next step."
    }
  ],
  "faqs": [
    {
      "title": "What does Copart do in Nationwide’s Total Loss Express process?",
      "paragraphs": [
        {
          "text": "Nationwide describes towing the vehicle to Copart for inspection after you authorize its release. The total-loss adjuster then discusses the findings and next steps. This does not identify Copart as the valuation-report vendor.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Where should I check my rental coverage?",
      "paragraphs": [
        {
          "text": "Nationwide directs customers to the claim tracker for rental coverage, including daily and overall limits. Ask the adjuster for the last covered day as well as the remaining amount.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Does a pending valuation question stop other claim tasks?",
      "paragraphs": [
        {
          "text": "Do not assume it does. Ask the adjuster to identify what is still needed for the review and what other tasks are due. Keep copies of title instructions and lender communications, and ask for an explanation of any document you do not understand before signing it."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "total-loss",
      "title": "Nationwide total-loss process",
      "url": "https://www.nationwide.com/personal/insurance/claims/auto/pages/total-loss",
      "locator": "What to expect; FAQs on value, rental, Total Loss Express and payment paperwork",
      "checkedOn": "2026-09-26",
      "claims": [
        "Detailed valuation report",
        "Valuation inputs and unnamed third-party vendor",
        "Title-document instructions",
        "Copart inspection",
        "Claim tracker rental limits"
      ],
      "applicability": "Nationwide’s published personal-auto process. Title requirements vary by state; rental coverage and other steps depend on the claim and policy."
    },
    {
      "id": "auto-claims",
      "title": "Nationwide auto claims",
      "url": "https://www.nationwide.com/personal/insurance/claims/auto/",
      "locator": "What to expect in most claims processes: Inspect the damage",
      "checkedOn": "2026-09-26",
      "claims": [
        "Inspection informs repair versus total-loss handling"
      ],
      "applicability": "General auto-claims guidance; individual facts, policy conditions and applicable law control."
    }
  ]
} satisfies InsurerGuideContent;
