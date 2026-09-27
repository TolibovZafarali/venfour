import type { StateGuideContent } from "../guide-content";

export default {
  "code": "ID",
  "description": "Understand Idaho total-loss valuations, settlement taxes, salvage buybacks, title requirements, and options for disputing an offer.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "Idaho’s Department of Insurance describes the usual total-loss payment as actual cash value: replacement cost adjusted for depreciation. Your offer should be evaluated against the vehicle you had immediately before the loss, including its condition and equipment.",
      "sources": [
        "claims-guide"
      ]
    },
    {
      "text": "Request the valuation report and identify the market area used. When you submit a replacement listing, record the seller, date, mileage, trim, options, and price so the adjuster can assess the comparison."
    }
  ],
  "rules": [
    {
      "title": "Separate the vehicle value from taxes and fees",
      "paragraphs": [
        {
          "text": "The Department’s claims guidance says total-loss settlements typically include sales tax on the vehicle’s value and title-transfer fees. Ask for these amounts as separate lines and check how the deductible affects the final payment.",
          "sources": [
            "claims-guide"
          ]
        }
      ]
    },
    {
      "title": "A salvage title is a separate decision",
      "paragraphs": [
        {
          "text": "Idaho’s motor-vehicle guidance describes total loss through an economic repair test and also includes vehicles for which an insurer has paid a total-loss settlement. It does not present a single percentage as the test for every vehicle. A salvage certificate is required before selling or otherwise disposing of a salvage vehicle; repaired vehicles go through the title process and retain a rebuilt-salvage brand.",
          "sources": [
            "salvage-guide"
          ]
        },
        {
          "text": "If you keep the vehicle, the Department of Insurance says its salvage value is usually deducted from the settlement. Request the salvage bid and compare the reduced payment with repair, inspection, registration, and insurance costs before agreeing.",
          "sources": [
            "claims-guide"
          ]
        }
      ]
    },
    {
      "title": "A buyback and a replacement purchase have different tax consequences",
      "paragraphs": [
        {
          "text": "Idaho’s Tax Commission explains that buying a totaled vehicle back from the insurer is taxable on the buyback price. It also explains that insurance proceeds used to buy a replacement are a cash payment, not a trade-in allowance reducing the replacement’s taxable price. These purchase-tax rules are separate from the tax amount included in an insurance settlement.",
          "sources": [
            "tax-guide"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Start with the insurer and describe each disputed item in writing. Idaho’s complaint instructions recommend trying to resolve the issue with the company first. Keep your offer, policy, valuation, and responses together if the issue needs to go to Consumer Affairs.",
      "sources": [
        "complaints"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Does Idaho offer appraisal for a value dispute?",
      "paragraphs": [
        {
          "text": "If your policy includes appraisal or arbitration, check the actual terms, selection process, and costs. Idaho’s insurance guidance says policies often provide such a process when the insured and insurer disagree. It does not make that process available under every policy or every third-party claim.",
          "sources": [
            "claims-guide"
          ]
        }
      ]
    },
    {
      "title": "Can the Idaho Department of Insurance set my vehicle’s value?",
      "paragraphs": [
        {
          "text": "The Department cannot determine a vehicle’s value or whether it should be totaled. Its Consumer Affairs team helps with insurance questions and complaints within Idaho’s jurisdiction. Submit the offer, your objections, and supporting records.",
          "sources": [
            "claims-guide",
            "complaints"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "claims-guide",
      "title": "Idaho common auto claims questions",
      "url": "https://doi.idaho.gov/consumers/auto-insurance/auto-claims/common-auto-claims-questions/",
      "locator": "Total loss, owner retention, appraisal, and Department limits",
      "checkedOn": "2026-09-26",
      "claims": [
        "Valuation",
        "Settlement components",
        "Policy dispute process"
      ],
      "applicability": "Consumer guidance; policy and claim circumstances matter."
    },
    {
      "id": "salvage-guide",
      "title": "Idaho salvage vehicle guidance",
      "url": "https://itd.idaho.gov/dmv/registrations-plates-titles/salvage-vehicles/",
      "locator": "Salvage vehicles and rebuilt salvage titles",
      "checkedOn": "2026-09-26",
      "claims": [
        "Titling consequences"
      ],
      "applicability": "Idaho salvage vehicles."
    },
    {
      "id": "tax-guide",
      "title": "Idaho vehicle transactions tax guide",
      "url": "https://tax.idaho.gov/document-mngr/sales-and-use-tax-guide-for-vehicle-transactions/",
      "locator": "Pages 16 and 20: buyback and insurance settlement",
      "checkedOn": "2026-09-26",
      "claims": [
        "Buyback tax",
        "Insurance proceeds are not a trade-in"
      ],
      "applicability": "Taxable vehicle purchases; separate from insurer obligations."
    },
    {
      "id": "complaints",
      "title": "Idaho insurance consumer complaints",
      "url": "https://doi.idaho.gov/consumers/file-a-complaint/",
      "locator": "Before filing and complaint assistance",
      "checkedOn": "2026-09-26",
      "claims": [
        "Regulator route"
      ],
      "applicability": "Policies or claims within Idaho jurisdiction."
    }
  ]
} satisfies StateGuideContent;
