import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "aaa-auto-club-group",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "The Auto Club Group’s claims-services page identifies the insurance companies behind its AAA-branded products. Match the company on your policy or claim letter before using these resources. Ask the assigned Claim Representative for the full valuation and written settlement explanation.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Its auto-claims guide says the representative explains how current market value was determined. The total-loss checklist includes title and lien-release records, keys, and receipts for non-original equipment or repairs that may bear on value. Keep copies of supporting records for your review.",
      "sources": [
        "guide"
      ]
    },
    {
      "text": "The claims-services page publishes different mailing addresses by claim type and asks for the adjuster’s name and claim number on mail. For electronic delivery or sensitive documents, ask your representative which channel to use rather than sending material to a general membership contact.",
      "sources": [
        "claims"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Check the report’s equipment description before relying on receipts. For a non-original item, show what was installed and when, and ask whether it is reflected in the calculation. A purchase or repair cost does not automatically translate into an equal increase in the vehicle’s market value."
    },
    {
      "text": "For condition questions, gather dated evidence of the vehicle before the loss. Identify what each photograph or record establishes and point to the report’s rating or deduction. Ask for an explanation when a description is vague, rather than guessing what the representative observed."
    },
    {
      "text": "Compare market vehicles on configuration, mileage, location and date. Explain material differences and preserve seller details so a comparison can be checked. Keep advertised prices distinct from verified sale prices, and ask where the report accounts for the differences."
    }
  ],
  "reconsideration": [
    {
      "text": "Send a brief request to the assigned representative with a numbered list of report corrections and matching attachments. Distinguish records needed to transfer ownership from evidence supporting a value question. That makes it clearer what you are asking the representative to reconsider."
    },
    {
      "text": "Ask for an updated report when an input changes and a written explanation for remaining adjustments. Compare the value with the settlement breakdown, including any lender allocation. Confirm that your review request reached the claim file and keep the correspondence together."
    }
  ],
  "faqs": [
    {
      "title": "Does this apply to every AAA-branded insurance policy?",
      "paragraphs": [
        {
          "text": "No. The Auto Club Group’s claims page names its underwriting companies and describes AAA Insurance as a collection of products and programs. Check the name on your policy or claim correspondence; CSAA and Auto Club Enterprises have separate guides here.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Are receipts for non-original equipment useful?",
      "paragraphs": [
        {
          "text": "The Auto Club Group’s total-loss checklist specifically asks for receipts for non-original equipment or repairs that may affect value. Explain the relevant item and ask how it is considered; a receipt does not guarantee an increase.",
          "sources": [
            "guide"
          ]
        }
      ]
    },
    {
      "title": "Who should answer a question about the market valuation?",
      "paragraphs": [
        {
          "text": "The auto-claims guide points to the assigned Claim Representative for the settlement explanation and further questions. Ask that person to identify the inputs and comparisons behind the value you received.",
          "sources": [
            "guide"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "AAA The Auto Club Group claims services",
      "url": "https://www.acg.aaa.com/insurance/claim-services.html",
      "locator": "Submitting claim forms and supporting materials; underwriting disclosures",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claims document routing",
        "Adjuster and claim-number identification",
        "AAA insurer identity"
      ],
      "applicability": "The Auto Club Group resources; insurer identity must be checked against the individual policy or claim."
    },
    {
      "id": "guide",
      "title": "AAA The Auto Club Group auto claims guide (PDF)",
      "url": "https://www.acg.aaa.com/content/dam/oneacg/pdfs/insurance/claim-services/AAA-Auto-Insurance-Claims.pdf",
      "locator": "Page 2: My vehicle was a total loss; additional questions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Representative explains market value",
        "Title and lien-release records",
        "Equipment and repair receipts"
      ],
      "applicability": "Older guide still linked by the current official claims-services page. Used for document preparation and representative contact, not nationwide coverage or timing rules."
    }
  ]
} satisfies InsurerGuideContent;
