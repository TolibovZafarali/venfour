import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "progressive",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Progressive’s claims page provides account and guest routes to view an existing claim. Use the route that applies to you, then ask the claims representative for the complete valuation report and a written breakdown of the offer.",
      "sources": [
        "claims-center"
      ]
    },
    {
      "text": "For total-loss payment paperwork, Progressive describes a signed title and odometer disclosure; a lender-held title also involves a power of attorney. Requirements can differ by state. Keep these documents together, separate from the evidence supporting a valuation correction.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "If you received a Photo Estimate earlier, ask whether a separate total-loss valuation has since been completed. Progressive describes Photo Estimate as an assessment of damage from submitted images. The document you need for this review should explain the pre-loss vehicle value, not just repair costs.",
      "sources": [
        "claims-center"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Progressive says it compares mileage, options and condition with comparable vehicles and uses a third party to help determine actual cash value. Its public FAQ does not name a valuation vendor for every claim.",
      "sources": [
        "total-loss"
      ]
    },
    {
      "text": "Check your vehicle’s configuration first, including trim, engine, drivetrain and factory packages. If a report lists the correct model but misses a package, tie the correction to vehicle-specific documentation and ask how that equipment affects the comparison."
    },
    {
      "text": "Next, examine the adjustments to each comparable. Note where the report accounts for mileage or condition and where the explanation is unclear. Ask about the reason for an adjustment and the evidence behind its amount rather than presuming it is wrong because it reduces a value."
    },
    {
      "text": "A loan payoff and a valuation answer different questions. Progressive notes that the vehicle value may be less than the outstanding loan or lease balance; any loan/lease payoff coverage has its own limits.",
      "sources": [
        "total-loss"
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Give the claims representative a page-by-page correction list with the relevant evidence. For additional vehicles, record the listing date, location, mileage and configuration, and explain why each comparison is useful. Label advertised asking prices accurately instead of presenting them as completed sales."
    },
    {
      "text": "Ask for a written response and a revised report if the calculation changes. Compare the new inputs and adjustments with the original rather than checking only the new total. If an item was rejected, ask what evidence would address the specific concern."
    }
  ],
  "faqs": [
    {
      "title": "Can I check a Progressive claim without signing into a policy account?",
      "paragraphs": [
        {
          "text": "Progressive’s public claims page includes a guest route to view a claim. Use the official entry point and the claim details it requests; the available tools may differ from a policyholder’s account.",
          "sources": [
            "claims-center"
          ]
        }
      ]
    },
    {
      "title": "How should I confirm the rental end date?",
      "paragraphs": [
        {
          "text": "Progressive’s total-loss FAQ describes a limited rental period after it communicates value for policyholders with rental coverage. It gives separate guidance for non-policyholders. Ask your claims representative for the exact end date and coverage limit that apply to you.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    },
    {
      "title": "Will the totaled vehicle automatically leave my policy?",
      "paragraphs": [
        {
          "text": "Progressive says policy changes are not automatic. Contact it about removing the totaled vehicle and arranging coverage for any replacement; confirm the appropriate timing for your situation.",
          "sources": [
            "total-loss"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "total-loss",
      "title": "Progressive total-loss claims FAQ",
      "url": "https://www.progressive.com/claims/faq/total-loss/",
      "locator": "Vehicle value; Payment paperwork; Loan or lease balance; Rental; Policy changes",
      "checkedOn": "2026-09-26",
      "claims": [
        "Comparable-vehicle valuation inputs",
        "Unnamed third-party valuation assistance",
        "Title and lender documents",
        "Loan/lease coverage limits",
        "Qualified rental and policy-change guidance"
      ],
      "applicability": "Progressive’s public auto total-loss guidance. State requirements, policy terms and policyholder versus non-policyholder status affect the process."
    },
    {
      "id": "claims-center",
      "title": "Progressive claims",
      "url": "https://www.progressive.com/claims/",
      "locator": "Progressive Photo Estimate; Report a new claim or view the status of an existing claim",
      "checkedOn": "2026-09-26",
      "claims": [
        "Account and guest claim-viewing routes",
        "Photo Estimate concerns vehicle damage"
      ],
      "applicability": "General claims access and eligible Photo Estimate workflows; no specific valuation-report download screen is promised."
    }
  ]
} satisfies InsurerGuideContent;
