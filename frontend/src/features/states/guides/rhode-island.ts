import type { StateGuideContent } from "../guide-content";

export default {
  "code": "RI",
  "description": "Check Rhode Island total-loss value, taxes and deductions, replacement recourse, and salvage-title requirements.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Rhode Island’s cash-settlement rule uses fair market value. The insurer must explain that value and provide its valuation report; supporting information must also remain in the claim file.",
      "sources": [
        "claims"
      ]
    },
    {
      "text": "Check the report against your vehicle’s actual configuration and condition. Keep requests to correct the vehicle description separate from questions about taxes, deductible, or salvage."
    }
  ],
  "rules": [
    {
      "title": "Taxes, fees, and itemized deductions",
      "paragraphs": [
        {
          "text": "A cash settlement includes applicable taxes and title, registration, and transfer fees, less any applicable deductible. Deductions must be itemized, measurable, and appropriate; reconditioning or dealer-preparation deductions are prohibited.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Own-policy replacement recourse has conditions",
      "paragraphs": [
        {
          "text": "For an own-policy claim, notify the insurer within 35 calendar days of receiving payment if you cannot buy a comparable vehicle for its assessed fair market value before deductions. Specified reopening procedures apply unless the settlement already identified an available comparable at that value in writing, with VIN and location.",
          "sources": [
            "claims"
          ]
        }
      ]
    },
    {
      "title": "Keeping salvage means a separate title process",
      "paragraphs": [
        {
          "text": "Rhode Island DMV requires an owner-retained salvage application, the existing title, the insurer’s total-loss/retention letter identifying Class A (parts only) or Class B (repairable), a damage estimate, and the fee. For repairable Class B vehicles, a Rhode Island licensed salvage rebuilder must perform repairs, followed by a salvage inspection.",
          "sources": [
            "dmv"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Save the report, screenshots of comparable vehicles, dealer contact details, and the date you received payment. Explain which vehicles cannot actually be purchased at the proposed amount and which report entries need correction."
    },
    {
      "text": "For a salvage deduction, the insurer must identify a dealer willing to buy the vehicle for that amount, including the dealer’s name and address.",
      "sources": [
        "claims"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Can appraisal help with my Rhode Island claim?",
      "paragraphs": [
        {
          "text": "Rhode Island has a statutory independent appraisal process for amount-of-loss disagreements involving an insured or claimant. It uses disinterested Rhode Island licensed appraisers, with statutory selection, cost, and decision rules. Ask how it applies to your dispute before hiring anyone; a Venfour review does not invoke that process.",
          "sources": [
            "appraisal"
          ]
        }
      ]
    },
    {
      "title": "Who handles Rhode Island insurance complaints?",
      "paragraphs": [
        {
          "text": "The Rhode Island Department of Business Regulation’s Insurance Division provides consumer assistance and an online complaint route. Describe the unresolved issue and include your valuation report and correspondence.",
          "sources": [
            "consumer"
          ],
          "contact": {
            "label": "Call 401-462-9520",
            "href": "tel:4014629520"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims",
      "title": "Rhode Island: Unfair Property/Casualty Claims Settlement Practices",
      "url": "https://rules.sos.ri.gov/regulations/part/230-20-40-2",
      "locator": "230-RICR-20-40-2, §§ 2.3 and 2.8(A)–(B)",
      "claims": [
        "Valuation explanation and report",
        "Taxes, fees, deductions",
        "First-party 35-day recourse and exception",
        "Salvage bid support"
      ],
      "applicability": "General automobile claim standards; § 2.8(B) recourse is first-party only.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "dmv",
      "title": "Rhode Island DMV: Titles",
      "url": "https://dmv.ri.gov/registrations-plates-titles/titles",
      "locator": "Salvage section",
      "claims": [
        "Owner-retained salvage documents",
        "Licensed rebuilder and inspection"
      ],
      "applicability": "Rhode Island salvage-title process.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "consumer",
      "title": "Rhode Island DBR: Insurance consumers",
      "url": "https://dbr.ri.gov/insurance/consumers",
      "locator": "Consumer assistance introduction and automobile insurance",
      "claims": [
        "Complaint assistance and contact"
      ],
      "applicability": "Regulatory assistance, not a guaranteed valuation increase.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "appraisal",
      "title": "Rhode Island General Laws § 27-10.4-1",
      "url": "https://webserver.rilegislature.gov/Statutes/TITLE27/27-10.4/27-10.4-1.htm",
      "locator": "Subsections (a) and (b); current amendments effective July 2, 2025",
      "claims": [
        "Statutory independent appraisal",
        "Licensed, disinterested appraisers and procedure"
      ],
      "applicability": "Amount-of-loss disputes involving insureds or claimants; statutory conditions apply.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
