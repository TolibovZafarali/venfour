import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "shelter",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Shelter’s claims contact page identifies its Auto Physical Damage team for repairable and total-loss vehicle claims, separately from liability and injury contacts. Use the total-loss contact for valuation documents, or ask your assigned adjuster to confirm who handles that part of the claim.",
      "sources": [
        "contact"
      ]
    },
    {
      "text": "The page provides a document and photo email route and asks that the claim number be included in the subject line. Use the address from that official page, confirm the recipient with your adjuster, and keep a copy of the material you send.",
      "sources": [
        "contact"
      ]
    },
    {
      "text": "Shelter’s FAQ directs non-customers to phone reporting, while customers can report a claim on their own policy online or by phone. Match the route to your role. For an existing claim, request the full valuation and settlement breakdown rather than creating another report.",
      "sources": [
        "faq"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Ask the adjuster which document supports the vehicle value. A repair estimate describes damage and proposed repairs; a valuation should let you inspect the vehicle description, market evidence and adjustments behind the total-loss offer. Keep both if the claim changed from repair to total loss."
    },
    {
      "text": "Compare the vehicle details with your own records, particularly trim, mileage, drivetrain and installed equipment. For condition questions, identify what was true before the incident and support it with dated photos or records. Do not assume that an unclear adjustment is an error before asking what it represents."
    },
    {
      "text": "If you find alternative vehicles, preserve their specifications, location, listing date and seller details. Explain why they are useful comparisons and identify differences openly. An advertised price is a starting point for a question, not proof of a completed sale or the amount owed on your claim."
    }
  ],
  "reconsideration": [
    {
      "text": "Send a brief request organized around individual report items. Give each attachment a descriptive name and connect it to the proposed correction. With the claim number in the subject, ask the adjuster to confirm receipt and explain how each item affects the valuation."
    },
    {
      "text": "Ask for a revised report when corrections change the calculation. Compare that report with the written offer and request an explanation of any remaining difference between value and payment. Keep administrative questions about title or transportation separate so you can follow their progress too."
    }
  ],
  "faqs": [
    {
      "title": "Which Shelter team handles total-loss vehicle questions?",
      "paragraphs": [
        {
          "text": "Shelter’s contact table lists Auto Physical Damage Claims for both repairable and total-loss auto claims. It lists liability and injury claims separately; use the entry matching the question or confirm it with your adjuster.",
          "sources": [
            "contact"
          ]
        }
      ]
    },
    {
      "title": "Can I use My Shelter to view someone else’s policy?",
      "paragraphs": [
        {
          "text": "Shelter’s FAQ says account policy access is for the named insured or policy owner. If you are claiming against a Shelter customer, use the non-customer phone pathway instead of trying to add their policy to your account.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "What should I include when emailing supporting documents?",
      "paragraphs": [
        {
          "text": "Shelter asks for the claim number in the subject line. Add a short explanation connecting each document to the report question, and retain the sent message and any reply.",
          "sources": [
            "contact"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "contact",
      "title": "Shelter claims contact information",
      "url": "https://support.shelterinsurance.com/claims/claimscontactinformation/",
      "locator": "Auto Physical Damage Claims; documents and photos instructions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Total-loss claims contact",
        "Document email and claim-number instructions"
      ],
      "applicability": "Contact routes for reported claims. Confirm the recipient and claim before transmitting personal documents."
    },
    {
      "id": "faq",
      "title": "Shelter frequently asked questions",
      "url": "https://www.shelterinsurance.com/faqs/",
      "locator": "How can I file a claim?; Why can’t I add someone else’s policy to My Shelter?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Non-customer phone reporting",
        "Customer online reporting",
        "Policy account access restrictions"
      ],
      "applicability": "General account and claim instructions; no report-download feature is inferred."
    }
  ]
} satisfies InsurerGuideContent;
