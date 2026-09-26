# Product and sample verification

Reviewed September 25, 2026 against local source revision
`cfba4325758520edbc84dbfbadd86063e1a64bb7` in
`/Users/zafaralitolibov/Documents/venfour`.

## Current product references

Paths below are relative to the repository root. Line numbers describe the
reviewed version and may move as the codebase changes.

| Sample claim | Implementation inspected |
| --- | --- |
| Review vehicle details, insurer comparables and adjustments; downloadable report; supported customer request; response guidance | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx:115-139` |
| $199 advertised full review, one time, no subscription | `frontend/src/config/review-price.ts:2`; `venfour/commerce.py:31`; checkout component `:81` |
| Start with a free valuation, with report or vehicle details | `frontend/src/pages/appraisal-start-page.tsx:150-167` |
| Public customer-start URL | `frontend/src/pages/home-page.tsx:73`; `frontend/src/app/site-boundary.ts:3-5,24-26`; `frontend/src/app/router.tsx:99-105` |
| Automatic refund for a completed review without reasonable support for a dispute; report retained; no final response required | `frontend/src/pages/refund-policy-page.tsx:23-35` |
| Supported-dispute manual refund, under $1,000 final verified vehicle-value increase, process/documentation requirements and 30-day deadline | Refund policy `:38-126` |
| No direct carrier negotiation; customer sends | Refund policy `:136-144`; `frontend/src/features/total-loss-claim/components/follow-up-preparation.tsx:61-139` |
| Asking-price range and median are evidence comparisons, not an independently adjusted appraisal or settlement entitlement | `venfour/valuation_review.py:369-384,474-479` |
| Similarity ranking; price is not a selection criterion | `venfour/valuation_review.py:104-108`; `venfour/discrepancy.py:1-7` |
| Loss-date historical evidence versus current listings | `venfour/valuation_review.py:418-419` |
| Insurer adjustment display without independent endorsement; no invented mileage/condition adjustments | `venfour/valuation_review.py:440-454,474` |
| Customer can save response text, an original file and revised offer | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:275,407-433` |
| Response analysis uses saved evidence without replacing the original valuation or calculating a new one | `venfour/insurer_response_analysis.py:245-259` |
| New amount or unresolved reasoning can prevent an accept-or-reject recommendation | `venfour/insurer_response_recommendation.py:330-375` |
| Customer may choose to continue independently of the recommendation state | `frontend/src/features/total-loss-claim/components/insurer-response.tsx:809-817,875-892` |
| Follow-up uses exact saved sources and requires the customer's continue decision | `venfour/customer_delivery.py:1873-1927`; `venfour/insurer_response_followup.py:212-372` |
| Prepared follow-up can ask how deductions were determined | `venfour/insurer_response_followup.py:346-365` |
| Follow-up can be edited and must be sent and marked sent by the customer | `frontend/src/features/total-loss-claim/components/follow-up-preparation.tsx:108-139` |
| Brand mark, mixed-case wordmark and restrained palette | `assets/brand/venfour-mark.svg`; `frontend/src/components/brand-link.tsx`; `frontend/src/styles/brand-foundations.css`; `frontend/src/styles/app-tokens.css` |

## Why the revised-offer example can prepare a follow-up

The recommendation policy and the follow-up preparation gate are separate.
The policy can return `NO_CLEAR_RECOMMENDATION` for a changed offer or unresolved
reasoning. The follow-up builder does not require a recommendation to reject the
offer. It does require an explicit `CONTINUE_CHALLENGING` customer decision, a
current recommendation, exact saved source identities and an eligible original
assessment.

Specifically, the existing builder verifies the saved assessment supports
continuation with moderate or strong evidence, no validation issues or unresolved
assessment assumptions, primary market evidence, the original sent request,
usable sending details, and an interpretable response with a remaining issue.
It blocks when those sources are missing, stale, insufficient or unclear.

The hypothetical packet supplies a readable written reply, revised-report extract,
consistent $21,300 amount, saved original request/evidence and a customer choice
to continue. It stipulates a qualified original review supporting continuation;
its fictional historical records are a scenario premise, not verified archives.
The remaining adjustment question supports clarification, not rejection of the
revised offer. No fresh appraisal or automatic recalculation is implied.

The follow-up wording is a concise, customer-reviewed editorial example of the
existing adjustment-question template. The product permits editing before the
customer sends it. The packet does not claim that this exact prose is produced
unchanged for every case or that the illustrative case was run through the
production release pipeline.

## Focused offline checks

These existing tests passed with credentials cleared and zero unexpected
network attempts:

- `test_insurer_response_followup.InsurerResponseFollowupTests.test_offer_inside_advertised_range_does_not_become_settlement_target`
- `test_insurer_response_followup.InsurerResponseFollowupTests.test_known_adjustment_question_reuses_descriptive_assessment_finding`
- `test_insurer_response_followup.InsurerResponseFollowupTests.test_only_explicit_continue_allows_generation`

An initial invocation used an incorrect test-class name and failed during test
selection. The corrected invocation above ran all three tests successfully.
No application files were edited. These are focused local code checks, not proof
of the complete hypothetical case or of hosted delivery.

## Public link verification

Both destinations were opened in the browser and their visible content checked:

- `https://app.venfour.com/start?service=total-loss`: selected Total Loss,
  "Start with a free valuation", insurer-report or vehicle-details entry,
  and $199 one-time full-review pricing.
- `https://venfour.com/refund-policy`: Fair-Result Refund Policy, effective
  September 15, 2026, with both protections and the stated key conditions.

These links are embedded as actual PDF URI annotations, not just printed text.
No intake, payment or email was submitted during verification.

## Evidence boundaries

All claim data, listings, correspondence and outcomes are hypothetical. Source
IDs R1/R2 and I1-I3/H1-H5 identify only the illustrative records reproduced in the
packet. There are no fabricated live listing links, customer testimonials or
measured savings claims. The $2,400 gap is a median asking-price comparison and
is never added to the $1,100 deduction. The revised insurer figures reconcile,
but do not replace the original Venfour report or establish a recoverable amount.

The six-page edition consolidates the explanation without reducing main body
text. Legal advice, appraisal, direct negotiation, jurisdiction-specific rights,
taxes/fees and other settlement components remain outside its stated scope.
