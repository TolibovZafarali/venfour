import type { StateGuideContent } from "../guide-content";

export default {
  "code": "SC",
  "description": "Review South Carolina total-loss market value, rental and claim timing, salvage titles, and insurance complaint options.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "South Carolina’s Insurance Department says a guidebook figure is only a guide: the relevant amount is what the used vehicle was worth immediately before the crash. Research nearby vehicles with matching make, model, year, and mileage.",
      "sources": [
        "faq"
      ]
    },
    {
      "text": "Check trim, options, drivetrain, mileage, condition, and the location of the comparison vehicles. A correction supported by records is more useful than an unsupported request for a higher number."
    }
  ],
  "rules": [
    {
      "title": "Rental and loss of use depend on the claim",
      "paragraphs": [
        {
          "text": "For a claim against the other driver’s insurer, South Carolina’s FAQ describes reimbursement for reasonable and necessary loss of use. It says many insurers stop total-loss rental payments when they offer settlement. Ask for the covered dates and rate before extending a rental.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "Claim timing depends on the investigation",
      "paragraphs": [
        {
          "text": "The Department describes a prompt and reasonable payment standard, with timing affected by the investigation, coverage issues, weather, and other facts. Ask what remains outstanding and when the adjuster expects to respond; do not treat every unresolved claim as subject to one fixed payment deadline.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "A total loss can change the title",
      "paragraphs": [
        {
          "text": "SCDMV generally brands an insurer-declared total loss as salvage, with exceptions for junk vehicles, damage below 75% without water or fire damage, vehicles worth less than $2,000, and vehicles titled as antiques. These are title-classification rules, not a formula for your settlement.",
          "sources": [
            "dmv"
          ]
        },
        {
          "text": "If you keep a vehicle requiring salvage paperwork, the insurer or its representative submits the owner’s application, title, fee, and retention letter. Follow SCDMV’s rebuilding documentation process before retitling a salvage vehicle as rebuilt.",
          "sources": [
            "dmv"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send the adjuster an organized list of inaccurate report entries and the records supporting each change. Save comparison listings with their date, VIN, mileage, seller, and availability, and ask how the insurer accounted for differences."
    },
    {
      "text": "Ask separately for the treatment of taxes and fees, your deductible, retained salvage, and any rental or storage cutoff. Preserve the insurer’s written explanation and the dates of your follow-up messages."
    }
  ],
  "faqs": [
    {
      "title": "Can I invoke appraisal in South Carolina?",
      "paragraphs": [
        {
          "text": "If your own policy includes an appraisal clause, review its scope, costs, and requirements before using it. South Carolina’s policy guidance recommends reading the contract and asking your insurer to explain unclear terms. A valuation review alone does not start policy appraisal.",
          "sources": [
            "consumer"
          ]
        }
      ]
    },
    {
      "title": "Who can help with a South Carolina claim concern?",
      "paragraphs": [
        {
          "text": "The South Carolina Department of Insurance’s Office of Consumer Services answers insurance questions and accepts complaints about insurers and adjusters. Send the valuation, your supporting evidence, and the response you received.",
          "sources": [
            "consumer"
          ],
          "contact": {
            "label": "Call 800-768-3467",
            "href": "tel:8007683467"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "faq",
      "title": "South Carolina Department of Insurance: Auto FAQs",
      "url": "https://doi.sc.gov/982/FAQ-Auto-Insurance",
      "locator": "Questions 4, 6, and 7",
      "claims": [
        "Pre-crash market value",
        "Third-party loss of use",
        "Claim-dependent timing"
      ],
      "applicability": "Consumer guidance; rental discussion is explicitly third-party.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "dmv",
      "title": "South Carolina DMV: Total Loss Claim",
      "url": "https://dmv.sc.gov/vehicle-owners/titles/total-loss-claim",
      "locator": "Salvage exceptions and vehicles kept by owner",
      "claims": [
        "Title-brand exceptions",
        "Owner-retention documents and rebuilt process"
      ],
      "applicability": "Title treatment, not a settlement-value threshold.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "consumer",
      "title": "South Carolina Department of Insurance: Automobile Insurance",
      "url": "https://www.doi.sc.gov/588/Automobile-Insurance",
      "locator": "Read Your Policy Carefully; Consumer Services and complaint sections",
      "claims": [
        "Policy review",
        "Consumer help and complaint route"
      ],
      "applicability": "Policy-specific guidance; no universal appraisal entitlement asserted.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
