import type { StateGuideContent } from "../guide-content";

export default {
  "code": "CO",
  "description": "Understand Colorado total-loss market value, taxes and title fees, hail-loss distinctions, and dispute options. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Colorado’s insurance division explains that a total-loss valuation concerns actual cash value at the time of loss. The remaining loan is a separate amount: a market-value payment may leave a balance owed to the lender. Check any GAP coverage separately.",
      "sources": [
        "co-hail"
      ]
    },
    {
      "text": "Start with the exact vehicle the report describes and the market evidence supporting it. List each disputed input, such as a missing option or incorrect mileage, with a document that shows the correction. Ask the adjuster how the selected vehicles were adjusted to match yours."
    }
  ],
  "rules": [
    {
      "title": "Check sales tax, including whether you keep the vehicle.",
      "paragraphs": [
        {
          "text": "The division’s hail-claim guidance says an insurer that pays a total loss and takes the vehicle pays the sales tax associated with that purchase. Its guidance distinguishes owner retention, where that sales tax is not incurred. Ask how the settlement’s ownership arrangement affects the tax line.",
          "sources": [
            "co-hail"
          ]
        }
      ]
    },
    {
      "title": "Title and registration fees deserve a separate review.",
      "paragraphs": [
        {
          "text": "Colorado’s Court of Appeals describes § 10-4-639(1) as imposing a duty to pay insureds title and registration fees associated with a motor-vehicle total loss. Request an itemized explanation of those amounts. The same decision rejects an implied private right of action under that subsection; it is not a promise that a fee disagreement creates a lawsuit.",
          "sources": [
            "co-fees"
          ]
        }
      ]
    },
    {
      "title": "Confirm the title consequences, especially after hail.",
      "paragraphs": [
        {
          "text": "Colorado’s insurance division distinguishes hail total losses from the salvage definition. An insurer’s economic decision to total the vehicle and its title classification therefore need separate review.",
          "sources": [
            "co-hail"
          ]
        },
        {
          "text": "DMV says a retained salvage vehicle requires a salvage title, and a vehicle bearing that title cannot be driven until repaired and issued a rebuilt-from-salvage title. Rebuilt status requires a certified roadworthiness inspection and the DR 2415 checklist. Confirm the classification with your county motor vehicle office before planning repairs.",
          "sources": [
            "co-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Request the complete value calculation, comparable vehicles, adjustments, and settlement-fee breakdown. If hail damage is involved, ask the insurer to explain both its total-loss decision and the proposed title treatment."
    },
    {
      "text": "Provide the insurance division with your own factual chronology and the relevant documents if the insurer does not address the concern. Its complaint portal permits supporting-document uploads and continued correspondence after submission.",
      "sources": [
        "co-complaints"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can I use an appraisal clause?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, ask your insurer for its requirements, costs, and effect before choosing that process. Check whether the disagreement concerns the vehicle’s value or a separate coverage issue."
        },
        {
          "text": "Venfour’s valuation review is separate from a formal policy appraisal. Venfour does not act as your appointed appraiser."
        }
      ]
    },
    {
      "title": "Does the total-loss decision establish my settlement value?",
      "paragraphs": [
        {
          "text": "No. Colorado’s insurance division explains that insurers use their own claim-handling and valuation methods in deciding whether a vehicle is a total loss. Ask for the evidence behind the market-value figure even when you agree that repair is uneconomical.",
          "sources": [
            "co-hail"
          ]
        }
      ]
    },
    {
      "title": "Where can I ask Colorado’s regulator for help?",
      "paragraphs": [
        {
          "text": "The Division of Insurance’s Consumer Services team answers insurance questions and investigates complaints. Its complaint page links to the consumer portal and a printable form. Submit the valuation report, the correction you requested, and the insurer’s response so the issue can be reviewed.",
          "sources": [
            "co-complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "co-hail",
      "title": "Colorado insurance division: hail and auto claim questions",
      "url": "https://doi.colorado.gov/insurance-products/homeowners/renters-insurance/being-prepared/after-a-hail-storm-insurance-faqs",
      "locator": "Auto Insurance questions on value, loans, sales tax, salvage, and total-loss decisions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Loss-date value",
        "Owner-retention tax distinction",
        "Hail classification",
        "Insurer decision and value distinction"
      ],
      "applicability": "Consumer guidance in the hail-claim context; individual policy coverage and title classification require review."
    },
    {
      "id": "co-fees",
      "title": "Colorado Court of Appeals: Trudgian v. LM General",
      "url": "https://www.coloradojudicial.gov/system/files/opinions-2024-08/23CA1141-PD.pdf#page=3",
      "locator": "2024 COA 87, paragraph 1; PDF page 3",
      "checkedOn": "2026-09-26",
      "claims": [
        "Title and registration fee duty",
        "No implied private action under subsection"
      ],
      "applicability": "Judicial interpretation of § 10-4-639(1) in an insured’s total-loss dispute; no advice on other causes of action."
    },
    {
      "id": "co-title",
      "title": "Colorado DMV title information",
      "url": "https://dmv.colorado.gov/title#heading-accordion-28276-2",
      "locator": "Branded Titles and Junked Vehicles → Salvage Vehicle",
      "checkedOn": "2026-09-26",
      "claims": [
        "Retained salvage title",
        "Rebuilt title and inspection before road use"
      ],
      "applicability": "Vehicles classified as salvage; Colorado separately excludes specified classic vehicles and has damage-type qualifications."
    },
    {
      "id": "co-complaints",
      "title": "Colorado insurance complaint assistance",
      "url": "https://doi.colorado.gov/for-consumers/file-a-complaint",
      "locator": "Asking Questions & Filing Complaints",
      "checkedOn": "2026-09-26",
      "claims": [
        "Consumer Services help",
        "Portal and supporting documents"
      ],
      "applicability": "Insurance matters within the division’s jurisdiction."
    }
  ]
} satisfies StateGuideContent;
