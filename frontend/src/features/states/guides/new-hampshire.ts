import type { StateGuideContent } from "../guide-content";

export default {
  "code": "NH",
  "description": "Understand New Hampshire total-loss valuations, report access, qualified reconsideration rights, and salvage rules. Start with Venfour’s free preliminary valuation.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "New Hampshire’s rule uses local fair market value for covered liability and collision or comprehensive total losses. It allows an accepted statistical method, documented recent comparable sales, or qualifying local dealer quotations. Review the actual vehicle description and local evidence behind the result.",
      "sources": [
        "nh-rule"
      ]
    }
  ],
  "rules": [
    {
      "title": "The valuation report accompanies the offer.",
      "paragraphs": [
        {
          "text": "The insurer must provide its valuation report when it presents the offer. Relevant condition, mileage, accessories, and options require consideration; customary dealer document-preparation fees also enter the valuation. Keep those items distinct from any deductible or owner-retained salvage.",
          "sources": [
            "nh-rule"
          ]
        }
      ]
    },
    {
      "title": "A qualified 20-day reconsideration route exists.",
      "paragraphs": [
        {
          "text": "Within 20 days after receiving settlement payment, a claimant can provide two reliable sources supporting a higher local market value and request recalculation. Sources must satisfy the rule’s comparable-sale or dealer-quotation requirements, including permitted market exceptions. An exception applies if, at settlement, the insurer identified an available comparable purchasable for no more than its valuation and supplied the location and VIN in writing. The comparable must meet the rule’s manufacturer, year, body, options, and condition requirements.",
          "sources": [
            "nh-rule"
          ]
        }
      ]
    },
    {
      "title": "Title classification has separate tests and exceptions.",
      "paragraphs": [
        {
          "text": "New Hampshire’s total-loss definition includes unrecovered theft and a vehicle the insurer considers physically or economically impractical to repair. A separate 75%-or-more repair-cost test applies during the vehicle’s model year and four subsequent calendar years, excluding inflatable restraints, tires, and sound or entertainment systems from that repair calculation. The salvage-title requirement has statutory title-exemption qualifications. It does not set a settlement percentage.",
          "sources": [
            "nh-title"
          ]
        },
        {
          "text": "If you plan to retain the vehicle, confirm its title and inspection requirements before repair. The rebuilt process includes verification of identification and parts records.",
          "sources": [
            "nh-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Ask which valuation method was used, then submit vehicle corrections and stronger local evidence together. Record the settlement-payment receipt date and whether the insurer supplied a specific available replacement; those facts affect the reconsideration route described above."
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
      "title": "Can the insurance department decide the claim?",
      "paragraphs": [
        {
          "text": "New Hampshire’s consumer-services program investigates complaints and can seek appropriate relief or mediate, but the statute does not give the commissioner power to adjudicate claims. Submit your report, correspondence, and chronology so the handling concern is clear.",
          "sources": [
            "nh-complaint"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "nh-rule",
      "title": "New Hampshire total-loss settlement rules",
      "url": "https://gc.nh.gov/rules/state_agencies/ins1000.html",
      "locator": "Ins 1002.15(a)–(h)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Local valuation methods",
        "Report with offer",
        "Qualified 20-day recourse"
      ],
      "applicability": "Property-damage liability and collision/comprehensive total-loss claims; available-comparable exception applies."
    },
    {
      "id": "nh-title",
      "title": "New Hampshire salvage certificates",
      "url": "https://gc.nh.gov/rsa/html/XXI/261/261-22.htm",
      "locator": "RSA 261:22(II), (IV), (VI)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Alternative total-loss definitions",
        "Age-qualified 75% test",
        "Repair-cost exclusions",
        "Rebuilt inspection"
      ],
      "applicability": "Title law, subject to RSA 261:3 exemptions; distinct from settlement valuation."
    },
    {
      "id": "nh-complaint",
      "title": "New Hampshire consumer-services authority",
      "url": "https://www.gc.nh.gov/rsa/html/XXXVII/400-A/400-A-15-e.htm",
      "locator": "RSA 400-A:15-e(I), especially (d)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Investigation and mediation",
        "No claims adjudication"
      ],
      "applicability": "Insurance entities within commissioner jurisdiction."
    }
  ]
} satisfies StateGuideContent;
