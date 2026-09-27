import type { StateGuideContent } from "../guide-content";

export default {
  "code": "SD",
  "description": "Understand South Dakota total-loss value, nonbinding appraisal, salvage titles, and the conditional tax credit for a replacement lease.",
  "checkedOn": "2026-09-26",
  "valuation": [
    {
      "text": "South Dakota’s Division of Insurance describes a total-loss vehicle’s actual cash value as its market value on the accident date. Its guidance suggests doing your own market survey if the insurer’s offer appears different from the market.",
      "sources": [
        "consumer"
      ]
    },
    {
      "text": "Check how the report describes your vehicle before selecting comparisons. Record the exact trim, drivetrain, options, mileage, and pre-loss condition, then identify evidence for each proposed correction."
    }
  ],
  "rules": [
    {
      "title": "Appraisal is consensual and nonbinding",
      "paragraphs": [
        {
          "text": "South Dakota’s insurance filing guidance prohibits binding appraisal provisions. Its approved approach requires both parties to agree, and the result cannot bind either side. Each selects an appraiser, with an umpire available for disagreements.",
          "sources": [
            "filing"
          ]
        }
      ]
    },
    {
      "title": "Salvage rules include age and weight exceptions",
      "paragraphs": [
        {
          "text": "The statutory salvage definition includes vehicles an insurer or self-insurer determines are total losses from specified causes, including theft, collision, weather, and flood. It excludes vehicles more than ten model years old or with a gross vehicle weight rating over 16,000 pounds.",
          "sources": [
            "salvage"
          ]
        },
        {
          "text": "When the insurer declares a total loss but you keep ownership, the owner-retention statute requires a salvage title and written notice from the insurer about that obligation before sale or transfer. The same age and weight exceptions apply.",
          "sources": [
            "retention"
          ]
        }
      ]
    },
    {
      "title": "A replacement lease may qualify for a tax credit",
      "paragraphs": [
        {
          "text": "A qualifying leased vehicle destroyed as a total loss before the lease ends may qualify for credit for prepaid lease tax attributable to the remaining period. Replacement must be with the same lessor and lessee, a same or similar make, model, year, and options, the same remaining period and price, and unchanged lease terms. Ask your lessor and county treasurer to confirm eligibility.",
          "sources": [
            "tax"
          ]
        }
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Use local market evidence to explain the requested value, and distinguish a wrong vehicle description from an unsupported adjustment. Keep a dated copy of the report, your evidence, and the adjuster’s response."
    },
    {
      "text": "If a deduction is described as betterment from repair or replacement, ask for its policy basis and proof that the entire vehicle’s value increased. The Division requires both. This is a different question from describing your vehicle’s condition before the loss.",
      "sources": [
        "filing"
      ]
    }
  ],
  "faqs": [
    {
      "title": "Who pays for a South Dakota appraisal?",
      "paragraphs": [
        {
          "text": "Under the Division’s approved nonbinding language, each party pays its selected appraiser and shares appraisal and umpire expenses equally. Confirm the exact policy wording and mutual agreement before spending money.",
          "sources": [
            "filing"
          ]
        }
      ]
    },
    {
      "title": "Where can I raise a South Dakota insurance complaint?",
      "paragraphs": [
        {
          "text": "The Division of Insurance recommends contacting the company first. If the issue remains unresolved, its complaint page offers online filing and telephone assistance. Include your report and correspondence so the issue can be reviewed.",
          "sources": [
            "complaint"
          ],
          "contact": {
            "label": "Call 605-773-3563",
            "href": "tel:6057733563"
          }
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "consumer",
      "title": "South Dakota Division of Insurance: Automobile Insurance",
      "url": "https://dlr.sd.gov/insurance/general_guidance/auto.aspx",
      "locator": "Total Loss section",
      "claims": [
        "Accident-date market value and market survey"
      ],
      "applicability": "Consumer valuation guidance.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "filing",
      "title": "South Dakota Division of Insurance: Property/Casualty Filing Requirements",
      "url": "https://dlr.sd.gov/insurance/companies/property_casualty_filing_requirements.aspx",
      "locator": "Appraisal/Arbitration; Personal Auto and Commercial Auto",
      "claims": [
        "Consensual nonbinding appraisal and expenses",
        "Betterment conditions"
      ],
      "applicability": "Approved policy language; not a compulsory binding appraisal right.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "salvage",
      "title": "South Dakota Codified Laws § 32-3-51.19",
      "url": "https://sdlegislature.gov/api/Statutes/32-3-51.19.html",
      "locator": "Salvage definition and exclusions",
      "claims": [
        "Salvage classification",
        "Age and weight exclusions"
      ],
      "applicability": "Title classification only.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "retention",
      "title": "South Dakota Codified Laws § 32-3-51.21",
      "url": "https://sdlegislature.gov/api/Statutes/32-3-51.21.html?all=true",
      "locator": "Owner-retained salvage and notice",
      "claims": [
        "Salvage title before transfer",
        "Age and weight exclusions"
      ],
      "applicability": "Owner retains a total-loss vehicle.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "tax",
      "title": "South Dakota Codified Laws § 32-5B-24",
      "url": "https://sdlegislature.gov/api/Statutes/32-5B-24.html?all=true",
      "locator": "Qualifying replacement-lease credit",
      "claims": [
        "Conditional remaining-lease tax credit"
      ],
      "applicability": "Qualifying leases only; not a general replacement-purchase allowance.",
      "checkedOn": "2026-09-26"
    },
    {
      "id": "complaint",
      "title": "South Dakota Division of Insurance: Complaint Process",
      "url": "https://dlr.sd.gov/insurance/doi_complaint.aspx",
      "locator": "Contact the company first; complaint filing and telephone assistance",
      "claims": [
        "Consumer complaint route"
      ],
      "applicability": "Insurance complaints.",
      "checkedOn": "2026-09-26"
    }
  ]
} satisfies StateGuideContent;
