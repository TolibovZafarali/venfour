import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NJ",
  "description": "Understand New Jersey total-loss offers, itemized reports, sales tax, written reconsideration, and salvage options. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "For collision and comprehensive claims, New Jersey’s rule treats the insured as a retail buyer. Cash methods include approved valuation manuals, an available comparable dealer vehicle, or an approved market database. The ordinary dealer-quotation radius is 25 miles unless the insured agrees otherwise.",
      "sources": [
        "nj-rule"
      ]
    },
    {
      "text": "Compare the report’s trim, options, mileage, and condition with photographs and vehicle records. A nearby listing helps most when its equipment and history make it a meaningful substitute, not merely a vehicle with the same model name."
    }
  ],
  "rules": [
    {
      "title": "Get the itemized value and sales-tax calculation.",
      "paragraphs": [
        {
          "text": "The written, itemized valuation must show options and deductions and be provided no later than payment. A cash offer includes applicable sales tax. Ask the adjuster to separate the retail vehicle amount, tax, deductible, and any other deductions.",
          "sources": [
            "nj-rule"
          ]
        }
      ]
    },
    {
      "title": "Written notice can trigger a reopened claim.",
      "paragraphs": [
        {
          "text": "If you cannot purchase a comparable vehicle for the established value, notify the insurer in writing within 30 calendar days after receiving the claim draft. The rule requires reopening the file, with alternatives including locating a qualifying replacement, addressing the cost difference, or using the policy’s appraisal process. The insurer must explain this recourse in writing when issuing the draft.",
          "sources": [
            "nj-rule"
          ]
        }
      ]
    },
    {
      "title": "Keeping the car depends on agreement and title requirements.",
      "paragraphs": [
        {
          "text": "The department explains that an insurer need not offer owner retention. If it agrees, salvage value is deducted before the policy deductible. Ask for both amounts before deciding.",
          "sources": [
            "nj-consumer"
          ]
        },
        {
          "text": "For a vehicle with a salvage title, MVC’s restoration process requires pre-repair photographs, repair records, and inspection. Confirm the classification applicable to your model year with MVC before starting work; title and inspection requirements are separate from the agreed market value.",
          "sources": [
            "nj-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Give the adjuster a short list of factual corrections and a realistic replacement example. If you are using the written recourse route, retain the check receipt date and proof that your notice was delivered."
    }
  ],
  "faqs": [
    {
      "title": "Can appraisal resolve the value disagreement?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, check its procedure and costs. New Jersey’s consumer guidance describes each side selecting an appraiser, sharing an umpire’s expense, and a decision by two participants binding the parties. Venfour’s review is separate from that formal appointment.",
          "sources": [
            "nj-consumer"
          ]
        }
      ]
    },
    {
      "title": "What if the insurer’s internal review does not help?",
      "paragraphs": [
        {
          "text": "The department describes an internal insurer appeal followed by a request to the Insurance Claims Ombudsman. Include the valuation, your evidence, and the internal decision so the remaining disagreement is easy to identify.",
          "sources": [
            "nj-consumer"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "nj-rule",
      "title": "New Jersey auto physical-damage claims regulation",
      "url": "https://www.state.nj.us/dobi/division_consumers/insurance/11_3_10.pdf#page=2",
      "locator": "11:3-10.1; 11:3-10.4(a)–(c), PDF pages 1–4",
      "checkedOn": "2026-09-26",
      "claims": [
        "Retail valuation methods",
        "Itemized report and tax",
        "30-day written recourse"
      ],
      "applicability": "Claims under collision and comprehensive coverage; not an unqualified third-party entitlement."
    },
    {
      "id": "nj-consumer",
      "title": "Filing an auto claim with your own New Jersey insurer",
      "url": "https://nj.gov/dobi/ins_ombudsman/wysk1.htm",
      "locator": "Questions 17, 20, 22",
      "checkedOn": "2026-09-26",
      "claims": [
        "Owner retention by agreement",
        "Policy appraisal",
        "Internal appeal and Ombudsman"
      ],
      "applicability": "First-party physical-damage claims; policy process and costs apply."
    },
    {
      "id": "nj-title",
      "title": "New Jersey MVC salvage and restoration",
      "url": "https://www.nj.gov/mvc/vehicles/salvage.htm",
      "locator": "Restored salvage vehicles and salvage inspections",
      "checkedOn": "2026-09-26",
      "claims": [
        "Pre-repair photographs",
        "Restoration inspection"
      ],
      "applicability": "Vehicles subject to salvage-title and restoration requirements; confirm model-year applicability."
    }
  ]
} satisfies StateGuideContent;
