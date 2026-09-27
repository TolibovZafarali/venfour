import type { StateGuideContent } from "../guide-content";

export default {
  "code": "MO",
  "description": "Understand Missouri total-loss valuations, deductions, replacement-vehicle tax allowances, and your options. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Missouri’s insurance department explains that book values and dealer quotes can help establish value. When that value is disputed, similar vehicles available in the market become especially relevant.",
      "sources": [
        "auto-faq"
      ]
    }
  ],
  "rules": [
    {
      "title": "Depreciation deductions should have an explanation.",
      "paragraphs": [
        {
          "text": "Missouri’s automobile claims regulation requires reductions for betterment or depreciation to be itemized and appropriate in amount. Information supporting the reduction must be kept in the claim file.",
          "sources": [
            "claims-rule"
          ]
        },
        {
          "text": "If a deduction is unclear, ask your adjuster what it represents, how it was calculated, and what information supports it. Photographs, maintenance records, or documentation of your vehicle’s equipment may help clarify a disagreement."
        }
      ]
    },
    {
      "title": "The 80% figure needs context.",
      "paragraphs": [
        {
          "text": "Missouri’s salvage-vehicle definition includes a test under which the cost of specified repairs exceeds 80% of the vehicle’s pre-loss fair market value. That provision applies to vehicles damaged during a year no more than six years after their model-year designation. It also excludes certain repair costs, including hail damage and inflatable safety restraints.",
          "sources": [
            "salvage-definition"
          ]
        },
        {
          "text": "The statute includes other ways a vehicle can be classified as salvage. The percentage is therefore not a universal rule for every total-loss decision, and it does not determine your settlement amount.",
          "sources": [
            "salvage-definition"
          ]
        },
        {
          "text": "Ask your insurer to explain the basis for its decision and provide the repair estimate and vehicle valuation it used."
        }
      ]
    },
    {
      "title": "A replacement vehicle may qualify for a sales-tax allowance.",
      "paragraphs": [
        {
          "text": "Missouri’s Department of Revenue allows qualifying buyers to deduct the insurance settlement amount plus the owner’s deductible from the purchase price used to calculate tax on a replacement vehicle of the same general type.",
          "sources": [
            "tax-allowance"
          ]
        },
        {
          "text": "The replacement must be purchased or contracted for after the loss and no later than 180 days after the total-loss payment. At least one owner of the totaled vehicle must also be listed on the replacement vehicle’s title application.",
          "sources": [
            "tax-allowance"
          ]
        },
        {
          "text": "Ask your insurer for a total-loss statement with the vehicle details, payment date, settlement amount, and deductible. The statement must be notarized unless the insurance agent certifies that the information is true and accurate.",
          "sources": [
            "tax-allowance"
          ]
        },
        {
          "text": "Check the requirements before titling your replacement vehicle. This allowance concerns the replacement purchase’s taxable price; it does not increase the underlying valuation of your totaled vehicle.",
          "sources": [
            "tax-allowance"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Keep a record of what you submitted and the response you received. Missouri’s insurance department also recommends documenting calls and retaining written communications.",
      "sources": [
        "complaints"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can an appraisal clause help resolve a disagreement?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, review it and any endorsements for the appointment requirements, costs, and effect of the outcome. Ask your insurer to identify the applicable wording before deciding whether to proceed. Missouri’s policy-reading guidance explains how to review your policy’s terms.",
          "sources": [
            "policy"
          ]
        },
        {
          "text": "Venfour’s valuation review is a separate service from that formal appraisal process."
        }
      ]
    },
    {
      "title": "Can Missouri’s insurance department help?",
      "paragraphs": [
        {
          "text": "The Missouri Department of Commerce and Insurance can investigate complaints and review an insurer’s response for compliance with applicable law and policy requirements. It cannot determine the value of your claim or the amount owed to you.",
          "sources": [
            "complaints"
          ]
        },
        {
          "text": "Use the department’s insurance complaint process or call its consumer hotline:",
          "contact": { "label": "800-726-7390", "href": "tel:8007267390" },
          "sources": [
            "complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "auto-faq",
      "title": "Missouri auto insurance FAQs",
      "url": "https://insurance.mo.gov/consumer-faqs/auto-insurance-faqs",
      "locator": "Claims: disputed total-loss value",
      "checkedOn": "2026-09-26",
      "claims": [
        "Book values, dealer quotes, available comparable vehicles, condition, mileage and options inform vehicle value."
      ],
      "applicability": "Consumer explanation of automobile claims."
    },
    {
      "id": "claims-rule",
      "title": "20 CSR 100-1.050(2)(E)",
      "url": "https://s1.sos.mo.gov/cmsimages/adrules/csr/current/20csr/20c100-1.pdf#page=4",
      "locator": "Automobile insurance, subsection (2)(E); PDF page 4 (printed page 5)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Betterment/depreciation reductions must be itemized and appropriate; supporting information retained in claim file."
      ],
      "applicability": "Automobile claims; record retention is distinct from a customer request for explanation."
    },
    {
      "id": "salvage-definition",
      "title": "Missouri Revised Statutes § 301.010(55)",
      "url": "https://revisor.mo.gov/main/OneSection.aspx?section=301.010",
      "locator": "Subdivision (55), salvage vehicle",
      "checkedOn": "2026-09-26",
      "claims": [
        "Repair cost exceeds 80%, model-year limitation, excluded hail and inflatable-restraint repair costs, and other salvage classifications."
      ],
      "applicability": "Vehicle-title definition; not a universal total-loss decision or settlement formula."
    },
    {
      "id": "tax-allowance",
      "title": "Missouri sales-tax allowance requirements",
      "url": "https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13",
      "locator": "Total-loss allowance question, #q13",
      "checkedOn": "2026-09-26",
      "claims": [
        "Like replacement vehicle, settlement plus deductible, 180 days after payment, overlapping owner, notarized or agent-certified statement."
      ],
      "applicability": "Qualifying replacement purchase after loss; taxable purchase price, not underlying vehicle valuation."
    },
    {
      "id": "complaints",
      "title": "Consumer complaint guidance",
      "url": "https://insurance.mo.gov/consumer-complaints/insurance-complaints",
      "locator": "Before filing; Department powers and limitations; consumer hotline",
      "checkedOn": "2026-09-26",
      "claims": [
        "Maintain communication records; department investigates complaints but cannot determine claim value or amount owed."
      ],
      "applicability": "Missouri insurance complaints."
    },
    {
      "id": "policy",
      "title": "Understanding your automobile insurance policy",
      "url": "https://insurance.mo.gov/understanding-your-automobile-insurance-policy",
      "locator": "Understanding Your Automobile Insurance Policy",
      "checkedOn": "2026-09-26",
      "claims": [
        "Read the policy, declarations, conditions, exclusions and endorsements."
      ],
      "applicability": "Policy-reading guidance only; does not establish a statewide appraisal entitlement."
    }
  ]
} satisfies StateGuideContent;
