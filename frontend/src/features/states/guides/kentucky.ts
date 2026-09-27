import type { StateGuideContent } from "../guide-content";

export default {
  "code": "KY",
  "description": "Understand Kentucky total-loss valuations, taxes, replacement-value recourse, salvage-title qualifications, and insurance review options.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Kentucky’s first-party total-loss rule bases a cash settlement on comparable-vehicle cost, less the policy deductible. Permitted valuation methods include local comparisons, qualified dealer quotations, and qualifying statistical sources; database values must account for otherwise unrecognized enhancements.",
      "sources": [
        "claims-rule"
      ]
    },
    {
      "text": "Check the report’s trim, options, mileage, and condition before focusing on the bottom line. Explain why your selected local comparisons match the vehicle you lost, and separate a market-value disagreement from a coverage question."
    }
  ],
  "rules": [
    {
      "title": "Taxes and transfer costs are part of the comparison",
      "paragraphs": [
        {
          "text": "The first-party rule includes applicable taxes and ownership-transfer fees. License fees are included if they cannot be refunded by the Transportation Cabinet.",
          "sources": [
            "claims-rule"
          ]
        }
      ]
    },
    {
      "title": "Replacement-value recourse has a defined deadline",
      "paragraphs": [
        {
          "text": "For a valuation using the rule’s statistical-source method, notify the insurer within 35 days after receiving the settlement check if you cannot buy a comparable for its fair market value. Here, “days” means Monday through Friday, excluding holidays. The insurer must reopen and use a specified remedy, which can involve a comparable replacement, the price difference or purchase, or policy appraisal.",
          "sources": [
            "claims-rule"
          ]
        }
      ]
    },
    {
      "title": "Salvage classification has qualifications",
      "paragraphs": [
        {
          "text": "Kentucky’s salvage definition includes repair costs exceeding 75% of retail value, excluding deployed-airbag reinstallation from that calculation. Parts use the specified retail-cost basis, and labor uses reasonable local rates and time allowances. Airbag costs still belong in the physical-damage estimate under the policy, subject to the statutory value cap. The definition also covers vehicles exempted from title surrender under KRS 186A.295(3).",
          "sources": [
            "salvage-law"
          ]
        },
        {
          "text": "The 2026 title-surrender rule limits that separate repair calculation to specified mechanical and structural damage and excludes cosmetic damage. It expressly preserves existing insurance obligations for cosmetic repairs. Do not treat that title rule as permission to omit covered cosmetic damage from a claim.",
          "sources": [
            "destroyed-title"
          ]
        },
        {
          "text": "A separate hail-only provision applies when the vehicle remains legally operable and the owner keeps it: qualifying damage exceeding 75% of retail value leads to a hail-damage brand after the required insurer statement and inspection. These branding rules do not calculate the settlement amount.",
          "sources": [
            "hail-title"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Send a concise correction request with vehicle records and matched listings. Identify the valuation method and the date the settlement check arrived. Ask the adjuster to respond to each material item and keep the response with your claim documents."
    }
  ],
  "faqs": [
    {
      "title": "What if my Kentucky policy has no appraisal clause?",
      "paragraphs": [
        {
          "text": "If your policy includes appraisal, review its terms first. Without an appraisal provision, Kentucky’s rule requires consideration of a higher local value demonstrated by two independent appraisals using measurable factors when challenging a database valuation.",
          "sources": [
            "claims-rule"
          ]
        }
      ]
    },
    {
      "title": "Where can I get help with a Kentucky insurance complaint?",
      "paragraphs": [
        {
          "text": "Kentucky’s Department of Insurance Consumer Protection Division handles auto-insurance complaints. Its complaint page offers online filing and written forms. Include the valuation, your objections, the insurer’s response, and the outcome you are requesting so the concern can be reviewed.",
          "sources": [
            "complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims-rule",
      "title": "Kentucky claims settlement regulation",
      "url": "https://apps.legislature.ky.gov/law/kar/titles/806/012/095/",
      "locator": "806 KAR 12:095 §§1(5), 7(1)",
      "checkedOn": "2026-09-26",
      "claims": [
        "First-party valuation",
        "Fees",
        "35-day recourse",
        "Appraisal conditions"
      ],
      "applicability": "Specified first-party claims; business-day definition applies."
    },
    {
      "id": "salvage-law",
      "title": "Kentucky salvage-title statute",
      "url": "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=57592",
      "locator": "KRS 186A.520(1), effective July 15, 2026",
      "checkedOn": "2026-09-26",
      "claims": [
        "Exceeds 75%",
        "Airbag and title-surrender qualifications"
      ],
      "applicability": "Salvage classification; hail exception applies."
    },
    {
      "id": "destroyed-title",
      "title": "Kentucky destroyed-vehicle title surrender",
      "url": "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=57591",
      "locator": "KRS 186A.295(1)(c), (3)",
      "checkedOn": "2026-09-26",
      "claims": [
        "Cosmetic-damage qualification"
      ],
      "applicability": "Separate title-surrender calculation, effective July 15, 2026."
    },
    {
      "id": "hail-title",
      "title": "Kentucky hail-damaged vehicle titles",
      "url": "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=57819",
      "locator": "KRS 186A.555(1)–(3), version effective until January 1, 2027",
      "checkedOn": "2026-09-26",
      "claims": [
        "Hail-only owner retention"
      ],
      "applicability": "Current version on the review date."
    },
    {
      "id": "complaints",
      "title": "Kentucky insurance complaint process",
      "url": "https://insurance.ky.gov/ppc/forms/complaints_home.aspx",
      "locator": "Online complaints and written forms",
      "checkedOn": "2026-09-26",
      "claims": [
        "Regulator assistance"
      ],
      "applicability": "Consumer Protection insurance complaints."
    }
  ]
} satisfies StateGuideContent;

