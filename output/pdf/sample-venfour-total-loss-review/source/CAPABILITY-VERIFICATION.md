# Product statement verification

Inspected local source: September 25, 2026.
Repository revision: `755d5d15f7549b72d2a29d027b006b163f64a7cb`.
Repository root: `/Users/zafaralitolibov/Documents/venfour`.

Paths below are relative to the repository root. Line references identify the
source inspected for this document and can move in later revisions.

| Statement in the sample | Current implementation reference |
| --- | --- |
| A self-service total-loss evidence review; not legal advice, an independent appraisal or a guaranteed settlement | `frontend/src/pages/terms-page.tsx:42-64`; `venfour/valuation_review.py:474` |
| Insurer vehicle details, comparables and adjustments are reviewed; the customer receives a PDF, a supported request and response guidance | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:115-133` |
| The standard package is $199, one time, with no subscription | `venfour/commerce.py:31`; `frontend/src/config/review-price.ts:2`; `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:81` |
| Automatic full refund if the completed review does not support a dispute; report access retained | `frontend/src/pages/refund-policy-page.tsx:23-35` |
| Separate manual refund path for a final verified vehicle-value increase under $1,000, following the process and applying with documentation within 30 days of the final written response | `frontend/src/pages/refund-policy-page.tsx:38-126` |
| Selected advertised-price range and median, compared with the insurer's vehicle value; asking prices are not sale prices or independently adjusted value | `venfour/valuation_review.py:369-384`; `frontend/src/features/total-loss-claim/components/completed-analysis.tsx:68-121` |
| Insurer adjustment figures can be displayed without being independently endorsed | `venfour/valuation_review.py:440-454` |
| Vehicle similarity guides ranking; price is not a selection criterion | `venfour/discrepancy.py:1-7`; `venfour/valuation_review.py:104-108` |
| Loss-date historical evidence is distinguished from current evidence | `venfour/valuation_review.py:418-419`; `venfour/presentation.py:299-315` |
| No independent dollar adjustments for mileage, condition, equipment, location, certification or warranty; no physical inspection | `venfour/valuation_review.py:474` |
| Customer-reported condition remains qualified | `venfour/valuation_review.py:403-409` |
| Taxes and fees remain outside the vehicle comparison when not verified | `venfour/valuation_review.py:487-503` |
| Review, prepare request, send, wait, response review, follow-up and case completion are workflow stages | `frontend/src/features/total-loss-claim/case-journey.ts:1-99` |
| Customer controls sending; Venfour does not directly negotiate with the insurer | `frontend/src/pages/refund-policy-page.tsx:136-144`; `frontend/src/features/total-loss-claim/components/insurer-response.tsx:863-872` |
| Customers can paste a reply, upload the original or enter a revised offer | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:275`; same file, `:407-433` |
| Reply analysis explains insurer reasoning and unresolved points against saved evidence; it does not recalculate the valuation or rewrite the report | `venfour/insurer_response_analysis.py:245-259` |
| A different revised vehicle value can produce no clear recommendation; the old asking-price range is not an acceptance target | `venfour/insurer_response_recommendation.py:59-62`; same file, `:372` |
| Supported, customer-selected follow-ups can be prepared using the response and saved evidence | `venfour/insurer_response_followup.py:212-372` |
| Original responses and prior corrections remain in case history | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:532-550`; same file, `:605-606` |
| The mark, mixed-case wordmark, sans-serif typography and grayscale palette reflect the product | `assets/brand/venfour-mark.svg`; `frontend/src/components/brand-link.tsx`; `frontend/src/styles/brand-foundations.css`; `frontend/src/styles/app-tokens.css` |

## Editorial decisions and limitations

The sample's dollar amounts and findings are an internally consistent fictional
scenario, not an output claimed to have passed the application's assessment or
report-release pipeline. No live market data, actual insurer report, customer
record or paid service was accessed to construct the scenario.

The original review supports reconsideration of the hypothetical $20,500
vehicle value. It does not assert that $22,900 is the vehicle's actual cash value
or that the insurer owes another $2,400. The $1,100 condition question is not
added to that gap. These distinctions reflect the current evidence model.

The insurer's hypothetical $21,300 reply is shown separately from the original
review. No fresh appraisal, revised market ranking or automatically selected
customer decision is implied. The response example deliberately states that
the saved conclusion did not assess the revised amount.

The customer request is an editorial sample of supported customer-controlled
correspondence, not a promise of identical wording in every generated message.
The packet combines the report, customer request and later response guidance
for attorney review; the cover explicitly states it is not an exact application
export. The note about reducing a referring firm's organization work describes
the packet's intended utility, not measured time savings or an additional
professional service.

The fee and refund summary is intentionally brief and links to the full policy.
It does not turn an interim increase into a final refund-eligibility finding.
No claim of hosted readiness, jurisdiction approval, formal appraisal,
insurer representation, guaranteed results or automatic insurer sending appears.
