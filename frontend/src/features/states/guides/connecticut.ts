import type { StateGuideContent } from "../guide-content";

export default {
  "code": "CT",
  "description": "Understand Connecticut’s total-loss valuation sources, calculation disclosure, taxes, salvage titles, and arbitration. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Connecticut’s insurance department reproduces § 38a-353, which sets a minimum valuation method for a totaled vehicle: the average retail value from NADA or another publicly available commissioner-approved source, and one other approved industry source. Ask which two sources and vehicle details produced the calculation.",
      "sources": [
        "ct-value"
      ]
    },
    {
      "text": "An average is only as useful as its inputs. Confirm the exact year, model, equipment, mileage, and condition before focusing on the arithmetic. Keep evidence of an incorrect input with the calculation that used it."
    }
  ],
  "rules": [
    {
      "title": "Review the calculation and supporting report.",
      "paragraphs": [
        {
          "text": "By the settlement-payment date, the insurer must provide the detailed vehicle-value calculation, the applicable valuation report if it is not publicly available, and written notice of the ability to dispute the value with the insurance department.",
          "sources": [
            "ct-value"
          ]
        }
      ]
    },
    {
      "title": "Separate tax and salvage from the base value.",
      "paragraphs": [
        {
          "text": "The department’s FAQ says a total-loss settlement includes applicable sales tax. If the owner keeps the vehicle, the salvage amount is subtracted; the insurer should identify where it can be sold for that amount. Ask to see these lines separately.",
          "sources": [
            "ct-value"
          ]
        }
      ]
    },
    {
      "title": "Repair economics and title status are separate questions.",
      "paragraphs": [
        {
          "text": "The statute reproduced by the department defines a constructive total loss when repair costs, salvage value, or both equal or exceed the vehicle’s total value at loss. That threshold does not itself establish the correct pre-loss value.",
          "sources": [
            "ct-value"
          ]
        },
        {
          "text": "Connecticut DMV says an insurance-totaled salvage vehicle cannot be operated on Connecticut roads, and its registration is cancelled. A repaired vehicle requires the DMV salvage inspection process before retitling. A parts-only or unrebuildable classification cannot be retitled. Check the assigned category before keeping the vehicle.",
          "sources": [
            "ct-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask the insurer to identify both approved valuation sources and correct any inaccurate vehicle data in each. Request the nonpublic valuation report with the calculation so the disagreement can be tied to specific entries."
    },
    {
      "text": "Keep a clear statement of the amount and issue in dispute. Connecticut’s arbitration brochure asks for supporting records such as itemized estimates or appraisals, photographs, bills, and correspondence.",
      "sources": [
        "ct-arbitration"
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
      "title": "Can Connecticut arbitration address vehicle value?",
      "paragraphs": [
        {
          "text": "Yes, eligible auto damage disputes can include the vehicle’s value. You must first file a complaint with the Insurance Department’s Consumer Affairs Division; arbitration is considered if it cannot resolve the matter. Coverage and liability must be undisputed. The program covers eligible first-party collision/comprehensive claims and claims by Connecticut owners or lessees against an at-fault driver’s insurer.",
          "sources": [
            "ct-arbitration"
          ]
        },
        {
          "text": "The brochure describes awards as binding, with only limited court-review grounds. Ask the department to confirm eligibility and current filing requirements before choosing that process.",
          "sources": [
            "ct-arbitration"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "ct-value",
      "title": "Connecticut insurance department: vehicle repair and total-loss questions",
      "url": "https://portal.ct.gov/cid/knowledge-base/articles/repairs-to-your-vehicle",
      "locator": "Questions 5, 8, and 10; reproduced § 38a-353",
      "checkedOn": "2026-09-26",
      "claims": [
        "Two approved valuation sources",
        "Calculation and report disclosure",
        "Sales tax and retention",
        "Constructive total loss"
      ],
      "applicability": "Connecticut automobile total-loss guidance and reproduced statutory requirements."
    },
    {
      "id": "ct-title",
      "title": "Connecticut DMV salvage and totaled vehicles",
      "url": "https://portal.ct.gov/dmv/vehicle-services/get-vehicle-inspection/salvaged-totaled-vehicles",
      "locator": "Salvage status, registration, inspection, and unrebuildable vehicles",
      "checkedOn": "2026-09-26",
      "claims": [
        "Road-use prohibition",
        "Inspection and title restoration",
        "Parts-only exclusion"
      ],
      "applicability": "Connecticut salvage-title and inspection requirements, distinct from valuation."
    },
    {
      "id": "ct-arbitration",
      "title": "Connecticut automobile arbitration brochure",
      "url": "https://portal.ct.gov/cid/-/media/cid-beta/pdf/knowledge-base/autoarbitrationbrochurepdf.pdf?hash=FD606830E85BAC39B2FCA81A413BBC08&rev=cccac39930a14bb2bbab08707801f38d#page=2",
      "locator": "PDF pages 2–4: eligibility, damages, filing, and appeals",
      "checkedOn": "2026-09-26",
      "claims": [
        "Prior complaint required",
        "Undisputed coverage and liability",
        "Vehicle-value disputes",
        "Binding awards and limited review"
      ],
      "applicability": "Eligible first-party policyholders and Connecticut owners/lessees making third-party auto damage claims."
    }
  ]
} satisfies StateGuideContent;
