import type { StateGuideContent } from "../guide-content";

export default {
  "code": "OK",
  "description": "Understand Oklahoma total-loss cash settlements, taxes and deductions, rental questions, and salvage-title considerations.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Oklahoma’s Insurance Department describes a total-loss payment as actual cash value at the time of loss. Check local comparable vehicles and the report’s description of your car before focusing on the final check.",
      "sources": [
        "faq"
      ]
    },
    {
      "text": "For an own-policy total loss settled under the actual-cash-value or like-kind-and-quality provisions, Oklahoma law permits specified comparable-vehicle, dealer-quotation, and guidebook methods. Ask which method supports the offer.",
      "sources": [
        "statute"
      ]
    }
  ],
  "rules": [
    {
      "title": "Own-policy cash settlements include applicable transfer costs",
      "paragraphs": [
        {
          "text": "The statutory first-party cash-settlement method includes applicable taxes, license fees, and other ownership-transfer fees, less the policy deductible. Ask for these amounts to be shown separately from vehicle value.",
          "sources": [
            "statute"
          ]
        }
      ]
    },
    {
      "title": "Deductions need a specific explanation",
      "paragraphs": [
        {
          "text": "For a first-party settlement that departs from the statutory methods, the insurer must document the vehicle’s condition and explain the basis. Deductions, including salvage, must be measurable, itemized by dollar amount, and appropriate. Supporting betterment or depreciation information must remain in the claim file.",
          "sources": [
            "statute"
          ]
        }
      ]
    },
    {
      "title": "The total-loss calculation and title process differ",
      "paragraphs": [
        {
          "text": "The claims statute defines total loss when repair costs plus salvage value meet or exceed the vehicle’s pre-loss actual cash value under used-car guides. That calculation does not itself state your payment amount.",
          "sources": [
            "statute"
          ]
        },
        {
          "text": "Service Oklahoma now issues titles electronically by default, with exceptions. Its guidance confirms that the electronic-title transition does not remove rebuilt-inspection requirements. Before retaining a damaged vehicle, confirm its title classification and inspection needs with Service Oklahoma.",
          "sources": [
            "title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Compare the insurer’s vehicle description with your records, then submit a focused list of corrections and matching market evidence. Request a revised value and an itemized payment breakdown rather than combining every disagreement into one requested number."
    },
    {
      "text": "The Oklahoma Insurance Department recommends asking your insurer for an explanation and supplying requested information before filing a complaint. Keep copies of your policy, valuation, letters, and call notes.",
      "sources": [
        "complaint"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Does rental coverage continue while I dispute the offer?",
      "paragraphs": [
        {
          "text": "Oklahoma’s consumer FAQ says another driver’s insurer generally stops rental payment after making a total-loss offer. Your own insurer pays rental only if you purchased that coverage, subject to its terms. Confirm the last covered day and rate in writing.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "Can I use an appraisal clause in Oklahoma?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, ask for the procedure and fee responsibilities before invoking it. Read the complete policy and endorsements; Oklahoma’s policy guide emphasizes checking the actual contract and asking your insurer to explain unclear terms.",
          "sources": [
            "policy"
          ]
        }
      ]
    },
    {
      "title": "Can the Oklahoma Insurance Department set my vehicle’s value?",
      "paragraphs": [
        {
          "text": "The Department investigates complaints and evaluates compliance with Oklahoma law, but cannot determine the value of your claim or order payment. Its complaint page explains what to submit and when another state’s regulator may be appropriate.",
          "sources": [
            "complaint"
          ],
          "contact": {
            "label": "Call 800-522-0071",
            "href": "tel:8005220071"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "statute",
      "title": "Oklahoma Statutes, Title 36, § 1250.8",
      "url": "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os36.pdf#page=314",
      "locator": "Pages 314–316, subsections (A), (B), (G), and (M)",
      "claims": [
        "First-party valuation and transfer costs",
        "Deduction support",
        "Total-loss calculation"
      ],
      "applicability": "First-party valuation provisions; distinct statutory total-loss definition.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "faq",
      "title": "Oklahoma Insurance Department: Auto FAQs",
      "url": "https://www.oid.ok.gov/faqs/",
      "locator": "Automobile questions 16–17",
      "claims": [
        "Actual cash value",
        "Rental and claim-type distinction"
      ],
      "applicability": "Consumer guidance; coverage terms apply.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "title",
      "title": "Service Oklahoma: Electronic Titles",
      "url": "https://oklahoma.gov/service/all-services/auto-vehicle/electronic-titles.html",
      "locator": "Title issuance and salvage rebuilt-inspection FAQs",
      "claims": [
        "Electronic titles and continuing inspections"
      ],
      "applicability": "Current title process; no salvage percentage asserted.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "policy",
      "title": "Oklahoma Insurance Department: Choosing your Automobile Insurance Policy",
      "url": "https://www.oid.ok.gov/consumers/insurance-basics/choosing-your-automobile-insurance-policy/",
      "locator": "Policy-reading guidance",
      "claims": [
        "Policy review"
      ],
      "applicability": "Appraisal is conditional on applicable policy terms.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "complaint",
      "title": "Oklahoma Insurance Department: File an Online Complaint",
      "url": "https://www.oid.ok.gov/consumers/file-an-online-complaint/",
      "locator": "Before filing; limits of authority; required documents",
      "claims": [
        "Complaint preparation",
        "Regulatory authority limits"
      ],
      "applicability": "Consumer Assistance requests and complaints.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
