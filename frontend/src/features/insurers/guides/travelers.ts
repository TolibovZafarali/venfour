import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "travelers",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Travelers’ claims center offers claim tracking, file uploads and secure messages to your Claim professional. Use your existing claim to ask for the complete valuation, including the vehicle description, comparable vehicles and adjustments. Save the report and the written offer together.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Travelers directs total-loss valuation questions to your Claim professional. Its guide also asks for title and lease or lien information. Keep those administrative documents in a separate folder so a request for missing title paperwork does not get confused with your request to review the value.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "When asking for the report, include the claim number and the date of the offer. If several people have handled the claim, ask who is responsible for the valuation and where that person wants supporting evidence sent. Request a readable copy of every page, rather than relying on a payment screenshot."
    }
  ],
  "valuation": [
    {
      "text": "Travelers describes a market evaluation using similar vehicles and says enhancements can sometimes add value, while routine maintenance typically does not. Check how the report describes your vehicle before treating a receipt as a proposed increase.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "For an equipment correction, identify the feature, where the report records it, and the record showing what was installed. For a condition question, use dated photographs or service records from before the loss. Explain what the evidence establishes instead of adding the invoice total to the offer."
    },
    {
      "text": "Compare listings on configuration, mileage, location and date. A more expensive example with a different engine or trim needs an explanation. Keep the advertised price visible and describe it as an asking price; a listing alone does not prove what a buyer paid."
    }
  ],
  "reconsideration": [
    {
      "text": "Send one organized message through the claim channel. Start with the strongest factual correction, attach its evidence and ask whether the correction changes the valuation. A short numbered list makes it easier for the Claim professional to answer each point."
    },
    {
      "text": "Ask for the revised report if an input changes. If the answer is that an item is already included, request the page or adjustment that shows it. Separately confirm any upcoming paperwork or transportation steps while the valuation questions are being considered."
    }
  ],
  "faqs": [
    {
      "title": "Should I sign the title before discussing it with Travelers?",
      "paragraphs": [
        {
          "text": "Travelers instructs customers to consult their Claim professional before entering mileage or signing title and ownership-transfer documents. Request the instructions for your vehicle and state.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Can I upload evidence instead of mailing it?",
      "paragraphs": [
        {
          "text": "The claims center includes a file-upload route. Confirm it is linked to the existing claim, keep a copy of the submission, and ask which additional records would help resolve each valuation question.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Does a valuation review extend my rental?",
      "paragraphs": [
        {
          "text": "Do not assume it does. Travelers’ total-loss guide makes rental assistance conditional on rental coverage. Ask the Claim professional to confirm the authorized period and any limits for your claim.",
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
      "title": "Travelers claims center",
      "url": "https://www.travelers.com/claims",
      "locator": "Check claim status; Upload a file; Send a secure message",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claim tracking",
        "Document upload and secure communication"
      ],
      "applicability": "Travelers public claims tools; availability and access depend on the claim."
    },
    {
      "id": "total-loss",
      "title": "Travelers: Understanding Total Loss",
      "url": "https://www.travelers.com/claims/guides/understanding-total-loss",
      "locator": "Steps 4, 6 and 7",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claim professional contact",
        "Title instructions",
        "Similar-vehicle evaluation and enhancements",
        "Conditional rental coverage"
      ],
      "applicability": "General Travelers total-loss guidance. State-specific signing instructions and individual rental periods are not generalized."
    }
  ]
} satisfies InsurerGuideContent;
