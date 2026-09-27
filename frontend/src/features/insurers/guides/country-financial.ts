import type { InsurerGuideContent } from "../guide-content";

export default {
  "slug": "country-financial",
  "checkedOn": "2026-09-26",
  "documents": [
    {
      "text": "COUNTRY Financial’s car-claims page offers account, mobile-app and phone access for starting or checking a claim. It identifies the claims representative as the main contact and directs non-clients to call. Use the route that fits your role and ask for the complete valuation behind the offer.",
      "sources": [
        "auto"
      ]
    },
    {
      "text": "Its claims FAQ says an auto specialist contacts customers after a total-loss determination to discuss value in pre-claim condition. It also identifies a Total Loss Adjuster for lienholder information. Ask that adjuster for the report and a separate checklist of title or lender documents.",
      "sources": [
        "faq"
      ]
    },
    {
      "text": "Retain the valuation, the written offer and any repair estimate under distinct filenames. Record the date and version of each report. If the app shows only progress or a photo estimate, request the pages explaining comparable vehicles, condition and adjustments."
    }
  ],
  "valuation": [
    {
      "text": "Work through the vehicle description with the records available to you. Compare the trim, drivetrain, options and mileage, then identify any factual discrepancy. If the valuation was updated after additional inspection information arrived, check that you are reading the newest version."
    },
    {
      "text": "Ask for the basis of a condition deduction you cannot reconcile with the pre-loss vehicle. A photograph or service record should support a specific point, such as the condition of a particular panel or the presence of equipment. Recent maintenance spending does not by itself establish the market value."
    },
    {
      "text": "For market evidence, keep listing dates and seller details alongside vehicle specifications. Explain why a comparison is appropriate and what differences remain. Request the arithmetic connecting the vehicle value to the offered payment so coverage and lender items remain visible."
    }
  ],
  "reconsideration": [
    {
      "text": "Send the Total Loss Adjuster a focused request to review the identified inputs. Attach evidence in the same order as the questions and ask which additional records would resolve any remaining uncertainty. Keep a copy of your message and the documents sent."
    },
    {
      "text": "If the response changes only one part of the report, check whether that change flows through the final value. Ask for the updated calculation and an explanation of unchanged items. Confirm rental and paperwork arrangements separately instead of assuming a review puts them on hold."
    }
  ],
  "faqs": [
    {
      "title": "Who needs the lender information?",
      "paragraphs": [
        {
          "text": "COUNTRY Financial’s total-loss FAQ directs customers to have the lienholder’s name, phone number and account number ready for the Total Loss Adjuster if the lender holds the title.",
          "sources": [
            "faq"
          ]
        }
      ]
    },
    {
      "title": "Can I use the customer login for a claim against someone else?",
      "paragraphs": [
        {
          "text": "The public claims navigation directs people who are not clients to call COUNTRY Financial. Ask the claims team to connect you with the existing claim and explain the appropriate document-submission route.",
          "sources": [
            "auto"
          ]
        }
      ]
    },
    {
      "title": "Will my rental continue while I question the value?",
      "paragraphs": [
        {
          "text": "Do not assume so. The FAQ makes reimbursement conditional on rental coverage and describes events that end it, including an offer or payment. Ask for the authorized end date and limits that apply to your claim.",
          "sources": [
            "faq"
          ]
        }
      ]
    }
  ],
  "sources": [
    {
      "id": "auto",
      "title": "COUNTRY Financial car insurance claims",
      "url": "https://www.countryfinancial.com/en/insurance/auto/car/claims.html",
      "locator": "Claim access; Connect with your insurance claim representative; non-client navigation",
      "checkedOn": "2026-09-26",
      "claims": [
        "Account, app and phone access",
        "Claims representative role",
        "Non-client phone pathway"
      ],
      "applicability": "General auto claims instructions; photo-upload tools do not establish valuation-report availability."
    },
    {
      "id": "faq",
      "title": "COUNTRY Financial claims FAQs",
      "url": "https://www.countryfinancial.com/en/client-support/faqs/claims.html",
      "locator": "What if my vehicle is a total loss?; Can I get a rental car if I have a claim?",
      "checkedOn": "2026-09-26",
      "claims": [
        "Pre-claim vehicle condition",
        "Title and lienholder documents",
        "Conditional rental coverage"
      ],
      "applicability": "Individual policy and claim terms control. No general reporting deadline, rental allowance or payment timeframe is adopted."
    }
  ]
} satisfies InsurerGuideContent;
