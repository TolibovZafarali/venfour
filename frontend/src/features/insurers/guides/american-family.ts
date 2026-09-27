import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "american-family",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "American Family’s claims center points customers to MyAccount and the MyAmFam app to follow a claim. It also provides a guest reporting pathway. If you already have a claim number, ask the assigned representative for the valuation behind the offer rather than opening a duplicate claim.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Its auto-claims overview describes sharing photos and other incident records and communicating with the claims team as the damage is assessed. Ask separately for the complete total-loss valuation report; the photos or initial damage estimate are only part of the record you need to review.",
      "sources": [
        "auto"
      ]
    },
    {
      "text": "Save the original offer, each version of the valuation and your correspondence. Note which representative sent each document and when. If the account shows only a summary, request the supporting pages with the vehicle details, comparable vehicles and adjustments in a format you can read and retain."
    }
  ],
  "valuation": [
    {
      "text": "Start with the vehicle description in the actual report. Compare trim, drivetrain, installed options and mileage with your own records. A vehicle identification number or purchase document can help locate the right configuration, but check the equipment shown in the report rather than assuming every feature was decoded correctly."
    },
    {
      "text": "For condition, distinguish damage from the incident from wear that existed beforehand. Point to a dated photo or a service record when it supports a correction. If an adjustment is unclear, ask what observation led to it and how that observation affected the calculation."
    },
    {
      "text": "Read the offer alongside the settlement breakdown. Ask the representative to identify the vehicle value separately from any deductible, lender payment or other line item. A different payment amount does not by itself show that a different vehicle value was used."
    }
  ],
  "reconsideration": [
    {
      "text": "Prepare a short list with a report page, the item to check and the evidence for each request. Send it through the channel the representative confirms for your claim. Avoid attaching unrelated incident photos when the question is about equipment or pre-loss condition."
    },
    {
      "text": "Ask for a written explanation of disputed inputs and a revised report if a correction changes the result. For comparable listings, include the seller, date, mileage and configuration, and explain why each is relevant. Label advertised prices accurately and keep a copy of your request."
    }
  ],
  "faqs": [
    {
      "title": "Do I need MyAccount to begin a claim?",
      "paragraphs": [
        {
          "text": "American Family’s claims center includes a guest claim route as well as customer account options. For a claim against someone else’s policy, use that official entry point or contact the claims team to confirm the correct pathway.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Does the app’s rental option confirm my rental coverage?",
      "paragraphs": [
        {
          "text": "The auto-claims overview lists rental assistance among its app and account tools. Confirm eligibility, authorized dates and limits with the claims team before relying on a reservation or extending a rental.",
          "sources": [
            "auto"
          ]
        }
      ]
    },
    {
      "title": "Is a photo estimate enough to review a total-loss offer?",
      "paragraphs": [
        {
          "text": "Ask for the valuation that supports the total-loss offer as well. A damage estimate can explain repair costs; your value questions need the vehicle description, market evidence and adjustments used for the offer."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "American Family claims center",
      "url": "https://www.amfam.com/claims",
      "locator": "Reporting a claim; MyAccount and MyAmFam; guest reporting",
      "checkedOn": "2026-09-26",
      "claims": [
        "Account and app claim access",
        "Guest reporting pathway"
      ],
      "applicability": "Public claim access instructions; guest reporting does not establish coverage or liability."
    },
    {
      "id": "auto",
      "title": "American Family auto insurance claims overview",
      "url": "https://www.amfam.com/claims/auto-insurance-claims-overview",
      "locator": "Filing an auto insurance claim; claims process; MyAmFam app",
      "checkedOn": "2026-09-26",
      "claims": [
        "Photos and supporting incident records",
        "Claim communication",
        "App and account tools"
      ],
      "applicability": "General auto claims overview, verified in a normal browser. No particular valuation methodology or rental entitlement is inferred."
    }
  ]
} satisfies InsurerGuideContent;
