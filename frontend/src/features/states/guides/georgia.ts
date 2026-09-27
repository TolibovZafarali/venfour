import type { StateGuideContent } from "../guide-content";

export default {
  "code": "GA",
  "description": "Understand Georgia total-loss valuations, local comparables, taxes, salvage titles, and options for requesting a review.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Georgia’s total-loss valuation rule applies to first-party property-damage claims under personal private-passenger policies. For a cash settlement, the rule starts with the cost of a comparable vehicle, with the policy deductible and applicable taxes and fees addressed separately. Comparability includes manufacturer, model year, body style, options, and mileage.",
      "sources": [
        "claims-rule"
      ]
    },
    {
      "text": "Look closely at the vehicle description before comparing prices. A missing equipment package or an incorrect mileage reading can affect the comparison even when the make and model are correct. Keep listings, photos, and records together so each requested correction has supporting evidence."
    }
  ],
  "rules": [
    {
      "title": "Local comparables depend on the valuation method",
      "paragraphs": [
        {
          "text": "The rule permits several valuation methods. Its local-listing method uses at least two comparables available now or within the last 30 days, within 50 miles of the county seat where the vehicle was principally garaged. If those are unavailable, it permits specified wider-market or dealer-quote alternatives. A qualifying statistical source is another permitted method; the 50-mile listing rule is not a blanket limit on every valuation.",
          "sources": [
            "claims-rule"
          ]
        },
        {
          "text": "Ask which method produced the offer, which vehicles or market data supported it, and how differences were adjusted. Save the asking price and availability date for each listing you submit."
        }
      ]
    },
    {
      "title": "Check the tax calculation",
      "paragraphs": [
        {
          "text": "For first-party cash-equivalent total-loss settlements, Georgia’s insurance commissioner directs insurers to calculate applicable replacement-vehicle taxes using the agreed cash value of the lost vehicle. Review the tax line separately from the vehicle value and deductible, and ask for the calculation if it is unclear.",
          "sources": [
            "tax-directive"
          ]
        }
      ]
    },
    {
      "title": "Keeping the vehicle changes the title process",
      "paragraphs": [
        {
          "text": "Georgia’s salvage classification has several triggers, including damage requiring replacement of two or more major component parts and an unrepaired vehicle for which an insurer paid a total-loss claim. Cosmetic-only damage is excluded unless caused by fire or flood; other exceptions can apply. This title classification does not establish your settlement value.",
          "sources": [
            "salvage-manual"
          ]
        },
        {
          "text": "If you retain a vehicle that requires a salvage title after settlement, Georgia’s Department of Revenue says to apply for that title within 30 days of the settlement. Confirm the title and rebuilding requirements before deciding to keep the vehicle.",
          "sources": [
            "owner-retention"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send a written request that separates vehicle-description corrections, comparable-vehicle objections, and the tax calculation. Georgia’s complaint guidance recommends first trying to resolve the issue with the company and keeping dated correspondence and a record of whom you contacted.",
      "sources": [
        "complaints"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can I use an appraisal clause in Georgia?",
      "paragraphs": [
        {
          "text": "If your policy includes an appraisal clause, read its requirements before hiring an appraiser. Georgia’s consumer guidance explains that many policies use separate appraisers and an umpire, with costs allocated under the policy. Ask about the scope, fees, and binding effect of your particular provision.",
          "sources": [
            "policy-guidance"
          ]
        }
      ]
    },
    {
      "title": "Where can I raise an unresolved insurance concern?",
      "paragraphs": [
        {
          "text": "The Georgia Office of Commissioner of Insurance and Safety Fire accepts insurance complaints and reviews the company’s response for compliance. Submit the offer, your written objections, and supporting records. The office explains that it cannot itself determine the value of damaged property.",
          "sources": [
            "complaints",
            "policy-guidance"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims-rule",
      "title": "Georgia automobile claims settlement rules",
      "url": "https://rules.sos.ga.gov/gac/120-2-52",
      "locator": "Rules 120-2-52-.02 and .06",
      "checkedOn": "2026-09-26",
      "claims": [
        "Claim scope",
        "Comparable valuation methods"
      ],
      "applicability": "First-party personal private-passenger property claims."
    },
    {
      "id": "tax-directive",
      "title": "Georgia Directive 22-EX-2",
      "url": "https://oci.georgia.gov/document/directive/directive-22-ex-2-calculation-taxes-when-auto-insurers-pay-first-party-claims/download",
      "locator": "Page 1",
      "checkedOn": "2026-09-26",
      "claims": [
        "Tax calculation"
      ],
      "applicability": "First-party cash-equivalent total losses."
    },
    {
      "id": "salvage-manual",
      "title": "Georgia Motor Vehicle Online Manual",
      "url": "https://dor.georgia.gov/document/document/motor-vehicle-online-manual/download#page=131",
      "locator": "Salvage definitions, pages 130–131",
      "checkedOn": "2026-09-26",
      "claims": [
        "Title classification and exceptions"
      ],
      "applicability": "Georgia salvage titling."
    },
    {
      "id": "owner-retention",
      "title": "Georgia owner-retained salvage process",
      "url": "https://dor.georgia.gov/total-loss-insurance-claim-salvage-vehicle-electronic-signature-process",
      "locator": "Owner-retained salvage title instructions",
      "checkedOn": "2026-09-26",
      "claims": [
        "Owner application deadline"
      ],
      "applicability": "Owners retaining salvage vehicles."
    },
    {
      "id": "complaints",
      "title": "Georgia insurance complaint instructions",
      "url": "https://oci.georgia.gov/file-consumer-insurance-complaint",
      "locator": "Before filing and complaint review",
      "checkedOn": "2026-09-26",
      "claims": [
        "Written dispute",
        "Regulator assistance"
      ],
      "applicability": "Insurance complaints within Georgia jurisdiction."
    },
    {
      "id": "policy-guidance",
      "title": "Georgia consumer insurance questions",
      "url": "https://ociapp.oci.ga.gov/ConsumerService/Complaint.aspx",
      "locator": "Appraisal clauses and limits of assistance",
      "checkedOn": "2026-09-26",
      "claims": [
        "Policy-conditional appraisal",
        "Value disputes"
      ],
      "applicability": "General guidance; actual policy controls appraisal."
    }
  ]
} satisfies StateGuideContent;

