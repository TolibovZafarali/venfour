import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "aaa-csaa",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Confirm that your policy or claim letter identifies CSAA Insurance Group before using this guide’s contact information. CSAA’s official contact page publishes a claims-assistance route. Ask the claims representative for the full valuation, written offer and the correct channel for sending your evidence.",
      "sources": [
        "contact"
      ]
    },
    {
      "text": "CSAA’s MyPolicy guidance describes access to insurance policy documents. Those can help you check your coverage, but if the vehicle valuation is not present, request it from the claims representative. Do not treat a policy document or insurance ID card as the valuation report.",
      "sources": [
        "account"
      ]
    },
    {
      "text": "If you are claiming against a CSAA customer, explain that when contacting claims assistance and ask how your documents should be submitted. Keep the claim reference and representative’s details. Use the contact details supplied for your own claim."
    }
  ],
  "valuation": [
    {
      "text": "In its recovery guide for comprehensive auto losses, CSAA describes valuing the vehicle immediately before the damage using comparable automobiles in the local area. This source concerns that claim context; ask which valuation basis applies to your particular loss and policy.",
      "sources": [
        "recovery"
      ]
    },
    {
      "text": "Check the report’s vehicle description and compare mileage, trim, drivetrain and equipment with your records. For a wildfire or other extensive damage, pre-loss photos may be especially useful in explaining condition that can no longer be inspected directly. Identify the date and what each image establishes."
    },
    {
      "text": "For comparable vehicles, save configuration, location, seller and listing date alongside the price. Explain differences that matter to your vehicle. A local asking price provides market context, but it should not be represented as the price of a completed sale without evidence."
    }
  ],
  "reconsideration": [
    {
      "text": "Ask the assigned representative to review a concise list of factual corrections. Refer to the relevant report page and explain each attachment. If a condition rating is based on limited inspection information, ask what additional pre-loss evidence would help clarify it."
    },
    {
      "text": "Request a written explanation of disputed comparisons and an updated report when the calculation changes. Check the revised offer against that report, then ask separately about any deductible, lender allocation or transportation arrangement. Retain the original and revised documents."
    }
  ],
  "faqs": [
    {
      "title": "Is CSAA the same claim channel as every AAA club?",
      "paragraphs": [
        {
          "text": "Use the CSAA contact page only after matching it to the insurer on your policy or claim letter. Other AAA insurance organizations have separate guides in this directory; the shared AAA name alone is not enough to select a contact."
        }
      ]
    },
    {
      "title": "Can I get policy documents online?",
      "paragraphs": [
        {
          "text": "CSAA’s MyPolicy guide lists access to important insurance policy documents among its account features. Ask the representative separately for any valuation pages you cannot locate.",
          "sources": [
            "account"
          ]
        }
      ]
    },
    {
      "title": "Does the recovery guide describe every collision claim?",
      "paragraphs": [
        {
          "text": "No. The cited auto section addresses policyholders with comprehensive coverage after events such as wildfire or hail. It provides useful valuation context, but your representative should confirm the basis and coverage for your specific claim.",
          "sources": [
            "recovery"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "contact",
      "title": "CSAA Insurance Group contact information",
      "url": "https://csaa-insurance.aaa.com/content/aaa-ie/b2c/en/primary-nav/contact-us.html",
      "locator": "For claims assistance",
      "checkedOn": "2026-09-26",
      "claims": [
        "CSAA claims contact"
      ],
      "applicability": "CSAA contact route; does not establish which insurer issued any particular AAA policy."
    },
    {
      "id": "account",
      "title": "CSAA: Manage Your Policy Online",
      "url": "https://www.csaainsurance.aaa.com/content/aaa-ie/b2c/en/misc/manage-mypolicy.html/",
      "locator": "MyPolicy features",
      "checkedOn": "2026-09-26",
      "claims": [
        "Policy document access"
      ],
      "applicability": "Policyholder account guidance. Access to a complete total-loss valuation is not promised."
    },
    {
      "id": "recovery",
      "title": "CSAA: Help is here",
      "url": "https://csaa-insurance.aaa.com/content/aaa-ie/b2c/en/misc/help-is-here.html",
      "locator": "Auto insurance claims: what to expect; How will the value of my vehicle be determined?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Pre-damage market value",
        "Local comparable automobiles",
        "Comprehensive-loss context"
      ],
      "applicability": "Only the auto section is used. The recovery guidance addresses comprehensive coverage and is not generalized to all collision or third-party claims."
    }
  ]
} satisfies InsurerGuideContent;
