import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "hanover",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Hanover’s auto-claims FAQ says an adjuster provides details of the evaluation when a vehicle is a total loss. Ask that adjuster for a complete copy, including the vehicle description and supporting market evidence, before preparing your questions about the offer.",
      "sources": [
        "faq"
      ]
    },
    {
      "text": "My Hanover Policy offers claim tracking and access to policy documents. Use it to locate your coverage information, but ask the adjuster separately for any valuation pages that are missing. Keep the policy documents, valuation and settlement explanation as distinct records.",
      "sources": [
        "faq"
      ]
    },
    {
      "text": "Gather the documents that establish your vehicle’s equipment and condition before the loss. Save the date of each offer and revision. If a representative changes, confirm who is now responsible for reviewing the value and where supporting files should go."
    }
  ],
  "valuation": [
    {
      "text": "Check which policy terms are being applied before comparing the offer with ordinary market listings. Hanover advertises newer-car replacement as a coverage option. That does not establish that your policy includes it or that it applies to a claim against another driver. Ask for the relevant policy wording.",
      "sources": [
        "coverage"
      ]
    },
    {
      "text": "For a market-value calculation, compare the vehicle’s model year, trim, drivetrain, options and mileage with your records. Look for differences among the comparables and ask how those differences were adjusted. Keep any alternative listing’s date, seller and asking price visible."
    },
    {
      "text": "Read the settlement breakdown separately from the vehicle description. If the amount payable is lower than the value, ask the adjuster to identify each line item. The balance on a loan and the evidence of the car’s value answer different questions."
    }
  ],
  "reconsideration": [
    {
      "text": "Send a concise request that identifies the report version, page and correction you want considered. Attach evidence that supports each item and ask the adjuster to explain the effect on the calculation. If a policy option is relevant, list that coverage question separately from factual vehicle corrections."
    },
    {
      "text": "Ask for a revised report if inputs change and a written explanation if they do not. Keep the original and revised calculations so you can trace what was resolved. Confirm the current title and transportation steps while awaiting the review."
    }
  ],
  "faqs": [
    {
      "title": "Does every Hanover policy include newer-car replacement?",
      "paragraphs": [
        {
          "text": "Do not assume it does. Hanover presents newer-car replacement among coverage options. Check your declarations and endorsement wording with the adjuster to understand whether and how it applies to this loss.",
          "sources": [
            "coverage"
          ]
        }
      ]
    },
    {
      "title": "What paperwork should I gather while reviewing the value?",
      "paragraphs": [
        {
          "text": "The total-loss FAQ recommends locating the title if there is no loan, or loan paperwork with the lender and account details. It also advises discussing rental options with the adjuster.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "Does My Hanover Policy contain everything needed for review?",
      "paragraphs": [
        {
          "text": "The FAQ describes claim tracking and policy-document access. If you cannot find the valuation itself, ask for it directly; a claim status or policy summary does not explain the comparable vehicles and adjustments.",
          "sources": [
            "faq"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "faq",
      "title": "Hanover auto claims FAQs",
      "url": "https://www.hanover.com/claims/hanover-claims/what-expect-your-claim/auto-claims-faqs",
      "locator": "Total-loss next steps; My Hanover Policy account benefits",
      "checkedOn": "2026-09-26",
      "claims": [
        "Adjuster evaluation details",
        "Title and loan records",
        "Claim tracking and policy-document access"
      ],
      "applicability": "Relevant answers verified in a normal browser. No universal timing or rental entitlement is inferred."
    },
    {
      "id": "coverage",
      "title": "Hanover auto insurance coverage options",
      "url": "https://www.hanover.com/individuals/products/auto-insurance",
      "locator": "Coverage to consider: Newer car replacement",
      "checkedOn": "2026-09-26",
      "claims": [
        "Newer-car replacement is a coverage option"
      ],
      "applicability": "Marketing overview of an optional coverage; applicability must be established from the individual policy, endorsements and claim."
    }
  ]
} satisfies InsurerGuideContent;
