import type { StateGuideContent } from "../guide-content";

export default {
  "code": "IA",
  "description": "Understand Iowa total-loss valuations, comparable-vehicle recourse, taxes and registration fees, salvage titles, and review options.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "For first-party total losses under actual-cash-value or replacement coverage, Iowa’s rule permits cash settlement based on the cost of a comparable vehicle, less the deductible. Permitted methods include local comparables, qualified wider-market or dealer evidence, and qualifying statistical sources.",
      "sources": [
        "settlement-rule"
      ]
    },
    {
      "text": "Ask which method was used and whether the report has the correct equipment and condition. Keep evidence of listing dates and availability; a vehicle that differs materially from yours needs an explained adjustment."
    }
  ],
  "rules": [
    {
      "title": "A 35-day opportunity to raise a replacement-value problem",
      "paragraphs": [
        {
          "text": "Notify the insurer within 35 days after receiving the claim draft if you cannot purchase a comparable for its valuation. The rule requires reopening and specified resolution options. An exception applies if the settlement documentation identified an available, specifically comparable vehicle—including its VIN and location—that could be bought for the valuation before deductions.",
          "sources": [
            "settlement-rule"
          ]
        }
      ]
    },
    {
      "title": "Review taxes and registration fees separately",
      "paragraphs": [
        {
          "text": "The first-party cash-settlement rule includes applicable taxes, license fees, and ownership-transfer fees in the comparable-vehicle cost.",
          "sources": [
            "settlement-rule"
          ]
        },
        {
          "text": "Iowa’s Department of Revenue says vehicles subject to registration generally incur a 5% one-time registration fee rather than state sales tax; local-option sales tax does not apply to those vehicle purchases. Ask the adjuster to identify the applicable registration and transfer amounts rather than assuming the state’s ordinary sales-tax rate.",
          "sources": [
            "vehicle-tax"
          ]
        }
      ]
    },
    {
      "title": "Salvage classification does not set the settlement",
      "paragraphs": [
        {
          "text": "Iowa DOT describes a vehicle as wrecked or salvaged when repair costs exceed 70% of its pre-damage fair market value and that value was at least $500. The strict “exceed” wording matters. This title classification does not mean a settlement should equal 70% of vehicle value.",
          "sources": [
            "salvage-guide"
          ]
        },
        {
          "text": "A salvage vehicle cannot normally be driven on public roads; a permit is available for travel to and from its salvage inspection. Rebuilt titling requires repair and inspection, including verification of the vehicle and parts. Confirm the process and retain repair receipts before choosing to keep salvage.",
          "sources": [
            "salvage-guide"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send dated evidence and identify the comparison or adjustment you want corrected. If the offer is being treated as settled, state promptly whether you are asking for the replacement-value recourse described above. Keep the claim-draft receipt date, valuation, correspondence, and replacement search together."
    }
  ],
  "faqs": [
    {
      "title": "Is appraisal available in Iowa?",
      "paragraphs": [
        {
          "text": "If your policy contains an appraisal provision, examine its requirements and costs. Iowa’s first-party recourse rule recognizes the policy’s appraisal process as one possible resolution; that reference does not create an appraisal clause in every policy.",
          "sources": [
            "settlement-rule"
          ]
        }
      ]
    },
    {
      "title": "Where can I file an Iowa insurance complaint?",
      "paragraphs": [
        {
          "text": "The Iowa Insurance Division’s complaint process generally requires the policy to have been issued or purchased in Iowa. It asks for the policy and claim identifiers, dates, correspondence, and other relevant records. The Division sends the complaint to the company for a response and explains its review and available next steps.",
          "sources": [
            "complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "settlement-rule",
      "title": "Iowa automobile claim settlement standards",
      "url": "https://www.legis.iowa.gov/docs/iac/chapter/191.15.pdf#page=15",
      "locator": "191—15.43(1), printed pages 15–16",
      "checkedOn": "2026-09-26",
      "claims": [
        "Comparable cost",
        "35-day recourse and exception",
        "Policy appraisal"
      ],
      "applicability": "Specified first-party automobile total losses."
    },
    {
      "id": "vehicle-tax",
      "title": "Iowa motor-vehicle sales tax questions",
      "url": "https://revenue.iowa.gov/taxes/frequently-asked-questions/sales-tax",
      "locator": "Local-option taxes on cars and trucks",
      "checkedOn": "2026-09-26",
      "claims": [
        "One-time registration fee"
      ],
      "applicability": "Vehicles subject to registration; purchase-tax guidance."
    },
    {
      "id": "salvage-guide",
      "title": "Iowa salvage vehicle guidance",
      "url": "https://iowadot.gov/registration-plates/other-vehicle-services/salvage-vehicles",
      "locator": "Salvage definition and inspection process",
      "checkedOn": "2026-09-26",
      "claims": [
        "Exceeds 70% and $500 scope",
        "Rebuilt title process"
      ],
      "applicability": "Iowa vehicle titling and road use."
    },
    {
      "id": "complaints",
      "title": "Iowa insurance complaint instructions",
      "url": "https://iid.iowa.gov/consumers/filing-complaints/how-do-i-consumer-complaints",
      "locator": "Eligibility, documents, and review",
      "checkedOn": "2026-09-26",
      "claims": [
        "Regulator assistance"
      ],
      "applicability": "Policies within Iowa jurisdiction."
    }
  ]
} satisfies StateGuideContent;

