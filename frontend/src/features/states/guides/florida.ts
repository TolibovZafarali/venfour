import type { StateGuideContent } from "../guide-content";

export default {
  "code": "FL",
  "description": "Understand Florida total-loss comparables, itemized deductions, deferred sales tax, title rules, and mediation. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "For first-party actual-cash-value or like-kind claims, Florida permits cash valuations using qualifying local comparables available during the preceding 90 days, a recognized database or guide, or quotes from at least two licensed local dealers. Ask which permitted method and vehicle data support your offer.",
      "sources": [
        "fl-claims"
      ]
    },
    {
      "text": "Build your response around the report’s specific inputs. Confirm the trim, mileage, installed equipment, and pre-loss condition, then explain how each proposed comparable differs. Review tax, deductible, and salvage lines separately from the vehicle’s market value."
    }
  ],
  "rules": [
    {
      "title": "Keep the deduction explanation distinct from the claim file.",
      "paragraphs": [
        {
          "text": "Florida requires betterment or depreciation deductions to be itemized and supported in the claim file. A written explanation must be supplied if requested. When an insurer uses an alternate total-loss valuation method, deductions and the settlement basis also require documentation, with a written explanation on request.",
          "sources": [
            "fl-claims"
          ]
        }
      ]
    },
    {
      "title": "Sales tax may be paid after it is incurred.",
      "paragraphs": [
        {
          "text": "Section 626.9743(9) allows the insurer to defer sales tax necessarily incurred in repair or replacement until the obligation is actually incurred. Ask what purchase or repair evidence is required and how to request the additional payment.",
          "sources": [
            "fl-claims"
          ]
        }
      ]
    },
    {
      "title": "The 80% title test is not universal.",
      "paragraphs": [
        {
          "text": "Florida’s title statute distinguishes insured and uninsured vehicles. An insured vehicle can be a total loss when the insurer pays to replace the damaged vehicle with one of like kind and quality, or pays for theft. The 80%-or-more repair-cost test in § 319.30(3)(a) applies to an uninsured vehicle. Do not apply that percentage to every insured claim.",
          "sources": [
            "fl-title"
          ]
        },
        {
          "text": "The statute also addresses agreements to repair rather than replace, including a separate title-branding provision if actual insurer repair costs exceed 100% of replacement cost. Ask which statutory category applies before retaining the vehicle; a title classification does not establish the correct settlement value.",
          "sources": [
            "fl-title"
          ]
        }
      ]
    },
    {
      "title": "Keep track of authorized storage.",
      "paragraphs": [
        {
          "text": "Florida requires 72 hours’ notice before an insurer terminates storage payments it previously authorized. Confirm the storage arrangement and the notice date while the valuation is under review.",
          "sources": [
            "fl-claims"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask for the valuation method, the comparables or guide used, and the requested written explanation of adjustments. Send a compact correction list and ask which tax or replacement documents remain outstanding."
    },
    {
      "text": "If communication stalls, keep the settlement disagreement separate from storage and replacement logistics. A disputed vehicle value does not tell you when a particular storage authorization ends."
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
      "title": "Can Florida mediation help with a value dispute?",
      "paragraphs": [
        {
          "text": "Florida’s Department of Financial Services offers voluntary, nonbinding pre-suit mediation for eligible automobile disputes, including property damage of any amount. Its guidance covers both first-party and third-party claims; policy conditions and program rules still matter. A mediator helps the parties seek agreement rather than deciding the vehicle’s value.",
          "sources": [
            "fl-mediation"
          ]
        }
      ]
    },
    {
      "title": "Where can I request insurance assistance?",
      "paragraphs": [
        {
          "text": "Florida’s Division of Consumer Services accepts insurance questions, concerns, and formal complaints through its Consumer Assistance Portal. Provide the valuation, your written correction request, the insurer’s response, and a concise description of the issue you want reviewed.",
          "sources": [
            "fl-assistance"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "fl-claims",
      "title": "Florida Statutes § 626.9743",
      "url": "https://www.flsenate.gov/Laws/Statutes/2026/626.9743",
      "locator": "Subsections (5), (6), (8), and (9)",
      "checkedOn": "2026-09-26",
      "claims": [
        "First-party valuation methods",
        "Itemized deductions and requested explanations",
        "Deferred sales tax",
        "Authorized storage notice"
      ],
      "applicability": "First-party total-loss method rules and the specific motor-vehicle claim provisions cited; no universal third-party valuation formula asserted."
    },
    {
      "id": "fl-title",
      "title": "Florida Statutes § 319.30",
      "url": "https://www.flsenate.gov/Laws/Statutes/2026/319.30",
      "locator": "Subsection (3)(a)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Insured replacement/theft category",
        "Uninsured 80% test",
        "Separate repair-agreement category"
      ],
      "applicability": "Title and salvage classification; additional title/destruction conditions elsewhere in the statute are not summarized as settlement rules."
    },
    {
      "id": "fl-mediation",
      "title": "Florida automobile mediation guidance",
      "url": "https://www.myfloridacfo.com/division/consumers/mediation",
      "locator": "Automobile mediation: eligibility and process",
      "checkedOn": "2026-09-26",
      "claims": [
        "Voluntary nonbinding pre-suit process",
        "First-party and third-party property disputes"
      ],
      "applicability": "Eligible automobile disputes subject to policy conditions and program exclusions."
    },
    {
      "id": "fl-assistance",
      "title": "Florida Consumer Assistance Portal",
      "url": "https://assistcon.myfloridacfo.gov/en-US/",
      "locator": "Welcome to the Consumer Assistance Portal",
      "checkedOn": "2026-09-26",
      "claims": [
        "Insurance questions and formal complaints"
      ],
      "applicability": "Florida Division of Consumer Services assistance; account sign-in is required to submit."
    }
  ]
} satisfies StateGuideContent;
