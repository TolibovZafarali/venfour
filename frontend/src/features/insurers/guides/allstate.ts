import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "allstate",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "Allstate’s MyClaim service lets you share claim documents and communicate with the claims team. Start with the written offer, then ask your adjuster for the complete valuation report and settlement breakdown if those are missing.",
      "sources": [
        "auto-claims"
      ]
    },
    {
      "text": "Save the original report before preparing corrections. Include any comparable-vehicle pages, condition notes and photographs that came with it. A repair estimate explains damage and repair costs; ask separately for the report used to value the vehicle before the loss."
    },
    {
      "text": "Allstate identifies Copart as its salvage partner and Copart Title Express as the service providing document instructions, shipping labels and lienholder payoff coordination. Keep those instructions with your claim records, while directing valuation questions to your adjuster.",
      "sources": [
        "auto-claims"
      ]
    }
  ],
  "valuation": [
    {
      "text": "Allstate describes actual cash value as the vehicle’s value before the claim. Its stated inputs include age, condition, mileage, options and prices of similar local vehicles.",
      "sources": [
        "auto-claims"
      ]
    },
    {
      "text": "Start with the description of your own vehicle. For example, if a package is missing, attach a window sticker or other vehicle-specific record and identify the affected report page. For a condition disagreement, use dated photographs or records that show the condition before the loss."
    },
    {
      "text": "Then follow each comparable through the adjustments shown in the report. Note differences in trim, drivetrain, equipment, mileage and condition. Ask how a particular difference was handled rather than assuming every different vehicle must be excluded."
    },
    {
      "text": "Keep vehicle value separate from the amount that reaches you. Allstate’s general guidance explains that an outstanding loan may exceed a total-loss payout. The loan balance alone does not show that the vehicle valuation is incorrect.",
      "sources": [
        "totaled-cars"
      ]
    }
  ],
  "reconsideration": [
    {
      "text": "Use a short message in the claim conversation to identify each requested correction, its report page and the attached evidence. Ask your adjuster to confirm whether the detail changes the valuation and to provide an updated report or an explanation if it does not."
    },
    {
      "text": "If you receive a revised figure, compare the entire calculation with the original. Check whether the requested vehicle details changed, which comparable or adjustment changed, and whether the settlement breakdown uses the revised value. Retain both versions."
    }
  ],
  "faqs": [
    {
      "title": "Does Copart Title Express decide my valuation?",
      "paragraphs": [
        {
          "text": "The Allstate guidance cited here identifies Copart Title Express for title documents and lienholder payoff information. It does not identify that service as the valuation-report provider. Ask your Allstate adjuster who prepared your report and who will respond to valuation corrections.",
          "sources": [
            "auto-claims"
          ]
        }
      ]
    },
    {
      "title": "Will my rental continue until payment arrives?",
      "paragraphs": [
        {
          "text": "Allstate says a rental may end before payment is received. Its policyholders should check their rental or transportation-expense coverage; for non-policyholders, Allstate explains the rental process during the claim. Ask for the last covered day and any remaining limit in writing.",
          "sources": [
            "auto-claims"
          ]
        }
      ]
    },
    {
      "title": "What if I am claiming through the other driver’s insurance?",
      "paragraphs": [
        {
          "text": "Allstate’s general total-loss guidance distinguishes a claim under your own coverage from one against an at-fault driver’s property-damage liability coverage. Confirm which claim is being handled before applying a deductible, coverage benefit or policy process to your situation.",
          "sources": [
            "totaled-cars"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "auto-claims",
      "title": "Allstate auto and motorcycle claims",
      "url": "https://www.allstate.com/claims/auto-motorcycle",
      "locator": "File and track; Total Loss FAQs: vehicle value, title processing, lienholders and rental cutoff",
      "checkedOn": "2026-09-26",
      "claims": [
        "MyClaim document sharing and communication",
        "ACV inputs",
        "Copart Title Express responsibilities",
        "Rental and payment timing distinction"
      ],
      "applicability": "Allstate’s published auto-claims process. Coverage and rental handling differ between policyholders and non-policyholders; claim-specific instructions and policy terms apply."
    },
    {
      "id": "totaled-cars",
      "title": "Allstate: Understanding totaled cars",
      "url": "https://www.allstate.com/resources/car-insurance/what-if-car-totaled",
      "locator": "Do I still have to pay a loan on a totaled car?; What if the total loss wasn’t my fault?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Loan balance can exceed payout",
        "Own-policy versus other-driver coverage"
      ],
      "applicability": "General consumer education published by Allstate; not the terms of any individual policy or a determination of liability."
    }
  ]
} satisfies InsurerGuideContent;
