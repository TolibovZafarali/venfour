import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "auto-owners",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Auto-Owners asks customers to report a claim through their independent insurance agent. For an existing claim, its instructions explain how to find the assigned claims representative in Online Access. If you cannot find the claim, ask your agent to connect you with the person reviewing the vehicle’s value.",
      "sources": [
        "report"
      ]
    },
    {
      "text": "The claim tracker has separate entry points for policyholders and people involved in an incident with an Auto-Owners policyholder. Choose the path that matches your role. Once connected, request the complete valuation and settlement explanation from the claims representative.",
      "sources": [
        "tracker"
      ]
    },
    {
      "text": "Keep the claim number, representative’s contact details and date of the offer with the downloaded documents. If the tracker shows progress but no report, ask how the report can be delivered. Do not assume a claim-status screen contains all of the evidence supporting the offer."
    }
  ],
  "valuation": [
    {
      "text": "Use the report itself to identify the vehicle and the valuation method applied to your claim. Check the model year, trim, drivetrain, options and mileage against your records. An insurance ID card confirms a policy relationship; it is not a substitute for checking the detailed vehicle description."
    },
    {
      "text": "Review each comparable for meaningful differences. For example, a lower equipment level or substantially different mileage deserves an explanation of the adjustment. Keep questions about whether a comparable is suitable separate from questions about whether its advertised price is accurate."
    },
    {
      "text": "If the payment differs from the value shown, ask for an itemized reconciliation. Confirm any deductible, lender allocation or other adjustment with the representative. For a claim against another driver, ask which parts of the explanation apply to that claim instead of assuming your own policy terms control it."
    }
  ],
  "reconsideration": [
    {
      "text": "Address your review request to the claims representative handling the valuation. Your agent can help you locate the right contact, but make sure the evidence reaches the claim file. Use a numbered list that connects each requested correction to a report page and an attachment."
    },
    {
      "text": "Ask the representative to explain any item that remains unchanged and provide an updated valuation when corrections are made. Keep both versions and check whether the update addresses all of your questions, including comparable selection and condition adjustments."
    }
  ],
  "faqs": [
    {
      "title": "Where can I find my Auto-Owners claims representative?",
      "paragraphs": [
        {
          "text": "The reporting instructions say to open the claim from the relevant policy in Online Access to see the assigned representative. Your independent agent can also help if you do not have online access.",
          "sources": [
            "report"
          ]
        }
      ]
    },
    {
      "title": "Can I track a claim if I am not an Auto-Owners policyholder?",
      "paragraphs": [
        {
          "text": "The official claim tracker includes a separate option for someone involved in an incident with an Auto-Owners policyholder. Follow that route and the details it requests; do not use another person’s policyholder login.",
          "sources": [
            "tracker"
          ]
        }
      ]
    },
    {
      "title": "Does the online tracker replace the valuation report?",
      "paragraphs": [
        {
          "text": "No. Use tracking information to follow progress, then obtain the actual report used for the offer. You need the underlying vehicle details and market evidence to make a specific request for review."
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "report",
      "title": "Auto-Owners: Report a Claim",
      "url": "https://www.auto-owners.com/claims/report-a-claim",
      "locator": "Reporting a claim; Checking the status of your claim",
      "checkedOn": "2026-09-26",
      "claims": [
        "Independent agent reporting",
        "Online Access claims representative details"
      ],
      "applicability": "Auto-Owners reporting and existing-claim instructions; no report-download capability is assumed."
    },
    {
      "id": "tracker",
      "title": "Auto-Owners claim tracker",
      "url": "https://www.auto-owners.com/claim-tracker",
      "locator": "Policyholder and incident-with-policyholder entry points",
      "checkedOn": "2026-09-26",
      "claims": [
        "Separate policyholder and third-party tracking routes"
      ],
      "applicability": "The tracker provides access pathways, not a promise of coverage or claim outcome."
    }
  ]
} satisfies InsurerGuideContent;
