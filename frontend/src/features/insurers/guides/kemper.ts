import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "kemper",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Kemper’s auto-claims FAQ directs existing claim questions to the adjuster and suggests asking about two-way texting for updates and document sharing. Confirm whether that channel is available for your claim, then request the complete valuation and written offer.",
      "sources": [
        "faq"
      ]
    },
    {
      "text": "The reporting page lists separate contacts for new and existing claims and a distinct American Access Casualty contact. Match the company on your claim correspondence to the correct entry rather than assuming one number handles every Kemper-related policy.",
      "sources": [
        "contacts"
      ]
    },
    {
      "text": "Kemper describes several inspection options, including an adjuster-provided photo link. If you received a damage estimate through that process, keep it, but also ask for the report used to calculate the total-loss vehicle value.",
      "sources": [
        "faq"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Check the vehicle description against your own records before comparing the final amount. Verify the year, trim, engine, drivetrain, mileage and equipment. If the inspection occurred after the incident, identify which photos or records establish the condition beforehand."
    },
    {
      "text": "Make questions about comparables specific. Ask why a different trim or a vehicle from a different market was selected, and where the report accounts for that difference. When proposing another listing, include its date, seller, mileage and configuration, not just the asking price."
    },
    {
      "text": "Separate valuation from payment eligibility. Kemper’s FAQ says payment follows coverage confirmation and completion of the investigation, with an applicable deductible and possible payment to a lender or leasing company. Ask for the calculation and payment allocation that apply to your claim.",
      "sources": [
        "faq"
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send the adjuster a numbered request with an attachment for each factual correction. If using document-sharing texts, keep copies of the files and messages, and confirm that the material reached the claim. Avoid sending several nearly identical listings without explaining their relevance."
    },
    {
      "text": "Request a written answer to each question and an updated report when a correction changes the value. If the response concerns coverage rather than the vehicle calculation, ask which issue remains unresolved and who can explain that part of the decision."
    }
  ],
  "faqs": [
    {
      "title": "Can I send evidence by text?",
      "paragraphs": [
        {
          "text": "Kemper invites auto claimants to ask their adjuster about two-way texting for document sharing. Confirm availability and the correct thread with the adjuster; do not assume any text number is connected to your claim.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "Which contact should I use for an existing American Access Casualty claim?",
      "paragraphs": [
        {
          "text": "Kemper’s reporting page publishes an American Access Casualty entry separately from its other auto claims contacts. Use that official listing and the company name on your correspondence to reach the appropriate team.",
          "sources": [
            "contacts"
          ]
        }
      ]
    },
    {
      "title": "Is there one timetable for every Kemper valuation review?",
      "paragraphs": [
        {
          "text": "No timetable is promised here. Ask the assigned adjuster when to expect a response to your evidence and what remains outstanding, then keep that information with your review request."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "faq",
      "title": "Kemper auto claims help",
      "url": "https://www.kemper.com/claims/auto-claims-help",
      "locator": "Claim status; inspection options; payment",
      "checkedOn": "2026-09-26",
      "claims": [
        "Adjuster contact and optional texting",
        "Photo inspection options",
        "Coverage confirmation and payment allocation"
      ],
      "applicability": "General auto guidance; document channels and payment conditions must be confirmed for the claim."
    },
    {
      "id": "contacts",
      "title": "Kemper: Report a Claim",
      "url": "https://www.kemper.com/claims/report-a-claim",
      "locator": "Call In Your Claim: New Claims; Existing Claims",
      "checkedOn": "2026-09-26",
      "claims": [
        "Separate new and existing claim contacts",
        "American Access Casualty contact"
      ],
      "applicability": "Contact routing only; no assumption about which Kemper company issued an individual policy."
    }
  ]
} satisfies InsurerGuideContent;
