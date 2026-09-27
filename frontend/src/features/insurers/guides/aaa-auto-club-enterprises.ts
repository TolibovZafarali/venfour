import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "aaa-auto-club-enterprises",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "This guide uses Auto Club Enterprises’ ace.aaa.com claims resources. Check the insurer named on your policy or claim letter before using them. The claims page has account access for viewing an existing claim; a AAA membership alone should not be used to choose your claim contact.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Its total-loss guide says a detailed evaluation report will be provided. Ask your claims service representative for every page and the written offer. The same guide includes a separate filing link for someone representing another person or an insurance company; confirm the pathway appropriate to your role.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Keep the evaluation, any damage estimate and the settlement explanation in separate files. Record which company and representative sent them, along with the claim number. If the correspondence names another AAA insurance organization, confirm its contact before sending documents."
    }
  ],
  "valuation": [
    {
      "text": "The total-loss guide describes local comparable vehicles and adjustments for the specific vehicle. It says comparable sales or listings must be verifiable with a VIN or stock number. Preserve those identifiers when preparing market evidence for review.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Compare year, trim, mileage, drivetrain and equipment carefully. If your evidence concerns a missing option, identify the feature and attach a record showing it was installed. For a condition question, explain what dated photographs or service records establish about the vehicle before the loss."
    },
    {
      "text": "Keep a listing’s asking price visible, and do not describe it as a completed sale unless that sale is established. Ask how differences between your vehicle and a comparable were adjusted. An expensive example with a different configuration may be less useful than a close match with a clear record."
    }
  ],
  "reconsideration": [
    {
      "text": "Send the assigned claims service representative a short list of corrections, identifying the report page and supporting file for each. For alternative comparables, include identifiers and specifications along with the price, seller and date. Ask for an explanation of any comparison that remains disputed."
    },
    {
      "text": "Request a revised evaluation if an input changes and compare its final value with the settlement explanation. Keep title, lender and rental questions separate. Confirm any administrative dates directly rather than assuming that a valuation review changes them."
    }
  ],
  "faqs": [
    {
      "title": "Does this guide apply to every AAA insurance claim?",
      "paragraphs": [
        {
          "text": "Use the company and contact shown on your policy or claim letter to confirm whether these ace.aaa.com resources apply. The directory has separate entries for CSAA Insurance Group and The Auto Club Group. Do not choose an insurer from the AAA name alone."
        }
      ]
    },
    {
      "title": "What identifiers should I keep for comparables?",
      "paragraphs": [
        {
          "text": "The Auto Club Enterprises total-loss guide calls for a VIN or stock number that allows a sale or listing to be verified. Keep the full listing details too, and label asking prices accurately.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Is rental assistance automatic?",
      "paragraphs": [
        {
          "text": "The total-loss guidance makes rental handling conditional on the policy including rental coverage. Ask the representative to confirm coverage, limits and authorized dates for your claim.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "AAA Auto Club Enterprises claims resources",
      "url": "https://www.ace.aaa.com/content/ace-www/en/insurance/claims.html",
      "locator": "View my claim; Auto insurance claims",
      "checkedOn": "2026-09-26",
      "claims": [
        "Existing claim account access"
      ],
      "applicability": "Resources on ace.aaa.com; customers should match their policy or claim correspondence to the appropriate AAA insurance organization."
    },
    {
      "id": "total-loss",
      "title": "AAA Auto Club Enterprises: Total loss auto claims",
      "url": "https://www.ace.aaa.com/insurance/claims/auto-insurance-claims/total-loss.html",
      "locator": "Detailed evaluation; comparable vehicle; representative and third-party links; rental coverage",
      "checkedOn": "2026-09-26",
      "claims": [
        "Detailed evaluation report",
        "Comparable VIN or stock number",
        "Representative contact",
        "Conditional rental coverage"
      ],
      "applicability": "Full guide verified in a normal browser. Regional and policy differences apply; this is not guidance for every AAA-branded insurer."
    }
  ]
} satisfies InsurerGuideContent;
