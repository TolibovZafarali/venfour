import type { StateGuideContent } from "../guide-content";

export default {
  "code": "DE",
  "description": "Understand Delaware total-loss value, replacement-vehicle document-fee credits, salvage retention, and arbitration. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Delaware’s insurance guide explains that collision coverage addresses the vehicle’s value rather than guaranteeing the cost of a new car. If repair costs exceed the vehicle’s value, the insurer may pay what it was worth. A remaining loan can be higher; any GAP protection is a separate coverage question.",
      "sources": [
        "de-auto"
      ]
    },
    {
      "text": "Review the year, configuration, mileage, condition, and comparable vehicles used to reach that figure. Request a worksheet separating the vehicle value, deductible, any retention deduction, and other settlement components. Correcting an input is more useful than pointing only to the cost of a different replacement."
    }
  ],
  "rules": [
    {
      "title": "A replacement purchase may qualify for a document-fee credit.",
      "paragraphs": [
        {
          "text": "Delaware DMV’s MV347 has a separate total-loss provision. Apply no later than 30 days after titling the replacement. Confirm the replacement-purchase window for your situation with DMV before relying on the credit. Both vehicles must be Delaware titled, with the credit vehicle in the applicant’s name and the applicant on the new title.",
          "sources": [
            "de-credit"
          ]
        }
      ]
    },
    {
      "title": "Keep the insurer’s credit documentation.",
      "paragraphs": [
        {
          "text": "For a total loss, MV347 requires a signed insurer letter showing the owner, vehicle description and VIN, and actual cash value before the deductible. Only one credit vehicle is allowed, and a credit already taken at titling cannot be claimed again. Ask DMV about eligibility and required documents before the replacement transaction; this is a document-fee credit, separate from the insurer’s base valuation.",
          "sources": [
            "de-credit"
          ]
        }
      ]
    },
    {
      "title": "Plan the salvage process before deciding to keep the car.",
      "paragraphs": [
        {
          "text": "Delaware DMV’s salvage instructions require photographs before repairs and receipts for major parts. Reconstructed vehicles go through the state police auto-theft inspection and DMV safety/titling process. Temporary-tag eligibility has separate conditions. Check these steps and the proposed salvage deduction before assuming the retained vehicle can immediately return to ordinary road use.",
          "sources": [
            "de-salvage"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Request a written response to each vehicle-data or comparable correction. Preserve the insurer’s original valuation and the final settlement letter, especially if you will seek a replacement-vehicle document-fee credit."
    },
    {
      "text": "Delaware’s insurance department recommends contacting the insurer or adjuster before filing a complaint. If the answer remains unsatisfactory, provide copies of the important documents and explain the specific unresolved issue.",
      "sources": [
        "de-complaint"
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
      "title": "Is there a state arbitration option?",
      "paragraphs": [
        {
          "text": "Delaware’s Department of Insurance offers arbitration for eligible automobile disputes after informal efforts have failed. The current program page lists a $50 filing fee and describes a three-person panel. Ask the department to confirm the claim’s eligibility, applicable rules, and what the decision would mean before filing.",
          "sources": [
            "de-arbitration"
          ]
        }
      ]
    },
    {
      "title": "What can Delaware’s insurance department do?",
      "paragraphs": [
        {
          "text": "Consumer Services can obtain an insurer’s explanation, review compliance with statutes, regulations, and policy terms, and explain coverage language. It cannot serve as your lawyer or intervene in a pending lawsuit. Use its complaint guidance to submit the valuation and the correspondence about your corrections.",
          "sources": [
            "de-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "de-auto",
      "title": "Delaware automobile insurance guide",
      "url": "https://insurance.delaware.gov/wp-content/uploads/sites/15/2022/09/Auto-Insurance-Guide.pdf#page=6",
      "locator": "PDF page 6: Collision; GAP coverage discussion",
      "checkedOn": "2026-09-26",
      "claims": [
        "Vehicle-value coverage",
        "Loan balance distinction"
      ],
      "applicability": "Consumer automobile coverage guidance; policy terms control coverage."
    },
    {
      "id": "de-credit",
      "title": "Delaware DMV document-fee credit form MV347",
      "url": "https://dmv.de.gov/forms/veh_serv_forms/pdfs/ve_frm_mv347.pdf#page=2",
      "locator": "Revised 9/12/2025; page 2, eligibility 1(c), 2–5 and Required Documentation 3",
      "checkedOn": "2026-09-26",
      "claims": [
        "Total-loss one-year replacement period",
        "30 days after titling",
        "Common ownership",
        "Insurer ACV letter"
      ],
      "applicability": "Total-loss document-fee credit requirements, distinct from ordinary sale/trade timing and settlement taxation."
    },
    {
      "id": "de-salvage",
      "title": "Delaware DMV salvage vehicles",
      "url": "https://dmv.de.gov/VehicleServices/titles/index.shtml?dc=ve_title_salvage",
      "locator": "Salvage retention, reconstruction, photographs, inspections, and temporary tags",
      "checkedOn": "2026-09-26",
      "claims": [
        "Repair documentation",
        "Inspection and title process"
      ],
      "applicability": "Vehicles requiring Delaware salvage/reconstructed processing; temporary tags have separate conditions."
    },
    {
      "id": "de-arbitration",
      "title": "Delaware insurance arbitration program",
      "url": "https://insurance.delaware.gov/services/arbitration/",
      "locator": "Automobile / Homeowners claims arbitration",
      "checkedOn": "2026-09-26",
      "claims": [
        "Program after informal resolution efforts",
        "Current $50 fee",
        "Three-person panel"
      ],
      "applicability": "Eligible disputes subject to program rules; no blanket arbitration entitlement asserted."
    },
    {
      "id": "de-complaint",
      "title": "Delaware insurance complaint assistance",
      "url": "https://insurance.delaware.gov/services/filecomplaint/",
      "locator": "What We Can Do / What We Cannot Do; filing instructions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Compliance review",
        "Contact insurer first",
        "No legal representation"
      ],
      "applicability": "Complaints within Delaware jurisdiction; out-of-state-issued policy and litigation limits apply."
    }
  ]
} satisfies StateGuideContent;
