# Nationwide total-loss product

Implemented against repository baseline `b10cd95`, September 22, 2026. This is product
implementation, with separately controlled activation flags. No jurisdiction is approved by a
product record. The research inventory supplies source references and unresolved
questions, not verified valuation or settlement rules.

## Current integration map

| Step | Current implementation |
| --- | --- |
| Public CTA | `frontend/src/pages/home-page.tsx`, routes in `frontend/src/app/router.tsx` |
| Intake, VIN/YMM/trim, mileage, market ZIP, loss date, insurer value | `frontend/src/pages/total-loss-start-page.tsx`, `frontend/src/features/total-loss/intake-steps.tsx`, `types.ts`; confirmed case details and immutable analysis-input revisions |
| Insurer report upload/extraction | Intake report step, `venfour/api.py`, `venfour/report_ingestion.py`, `venfour/supabase_gateway.py`; accepted report revisions remain authoritative |
| Preliminary analysis / free result | `venfour/case_analyses.py`, `venfour/creation.py`, `venfour/presentation.py`; `frontend/src/pages/total-loss-analysis-page.tsx`, `features/analyses/components/total-loss-analysis-experience.tsx` |
| Strict/full review | `venfour/full_review.py`, `full_review_processing.py`, `full_review_payment.py`, `full_review_package.py`; accepted insurer report, matching immutable lineage, strict evidence gate |
| Checkout | `venfour/commerce.py`, checkout handlers in `api.py`, `features/total-loss-claim/components/checkout-experience.tsx` and `pages/total-loss-claim-workflow-page.tsx` |
| Paid assessment | `venfour/package_processing.py`, `package_assessment.py`; existing delivery fence and source/assessment digests |
| Comparable discovery | `venfour/efficient_search.py`, `search_geography.py`, `market_search_runtime.py`, `market_request_budget.py` |
| Report | `venfour/report_processing.py`, `valuation_evidence_report.py`, `valuation_review.py`; immutable version, private PDF, deterministic validation |
| Release and delivery | `venfour/report_release_gate.py`, `staff_release.py`, `customer_delivery.py`, `paid_delivery.py`; existing publication, ownership, and access rules |
| Customer request / insurer response / follow-up | `venfour/customer_delivery.py`, the existing reconsideration generation RPCs, `insurer_response_processing.py`, `insurer_response_followup.py`; customer-controlled send preparation and saved response lineage |
| Outcome / refunds / history | `venfour/commerce.py`, case-resolution and history RPCs in `supabase/migrations/`, `features/total-loss-claim/components/case-record.tsx`; signed payment events and historical access remain independent of new-delivery permission |

Existing intake supplied ZIP and loss date, not reliable registration, garaging,
policy issue, or loss states. Neither report city text nor search ZIP is promoted
to a legal fact. No reliable structured state extractor was present to reuse.
Already saved fact assertions are prefilled with confirmation; no new extraction
or geolocation service was added.

## Product records and deterministic method

`venfour/data/nationwide_product_v1.json` has 51 explicit records; typed loading,
projection and scope checks live in `venfour/nationwide_product.py`. Product
version `2026-09-22.1` is immutable for report replay. Its sections are presentation,
valuation, settlement, workflow, and provenance. Research sources have URL,
locator, research-only status, and null verification/effective dates. Missing
research does not establish absence of a requirement.

All records use `PRODUCT_READY_WITH_GENERIC_RULES` and the **Total-Loss Valuation
Report** label. All have `appraisal_label_allowed=false`. Case status separately
reflects unknown facts, conflicting assertions, multiple state candidates,
commercial use, or unsupported territory/country/location codes. It never selects
one state as controlling law. Product status is descriptive, not checkout or
release authorization; existing gates continue to decide admission.

The implemented value comparison remains the existing deterministic advertised-price
range and median compared with the insurer valuation. It does not become an
independently adjusted point ACV, appraisal, or settlement amount. No dollar
adjustments or vehicle attributes are invented. The same evidence eligibility,
matching, ranking, mileage treatment, historical verification, and calculations
are preserved. Unsupported locations have no configured generic product; unknown
or multistate facts can retain the generic method while state-specific application
requires review.

The existing strategy starts locally, widens for insufficient evidence, and
records operations, reasons, centers, distances, and actual search footprint.
The default 100-mile local radius, 250-mile outer bound, four additional centers,
existing page/observation limits, and provider ledger budgets are unchanged.
These are method settings, not claims about state law. Current and loss-date
streams remain separate. Supplemental high-price examples cannot change the
baseline. ZIP continues to select market geography through the existing ZCTA/CBSA
dataset. No new provider work is introduced by product configuration.

`VerifiedOverride` carries jurisdiction, claim type, policy use, loss-date interval
(inclusive start/exclusive end), verification date, official source URL/reference,
and reviewed interpretation reference. Selection rejects ambiguous/incomplete
facts, conflicting loss dates, scope mismatch, future verification and conflicting
overrides. Its search adapter can only narrow existing bounds; it cannot raise a
budget or bias ranking by price. `search_policy_from_environment` accepts an
internal selected-rule tuple; there is no customer-supplied rule parameter.
Production selects no overrides in this version. Synthetic overrides exercise the
adapter and separate settlement notes; they cannot enter this shipped report
version. A real reviewed override requires a new versioned registry, replay
validator, applicable tests, and connection of the reviewed selector to the case
search configuration. Arbitrary numeric adjustment rules are intentionally not
implemented without a verified method to execute.

## State facts and customer experience

`features/nationwide/product-panel.tsx` adds registration state, an explicit
same-state confirmation for home/loss/policy issue state, and claim type/use.
Separate states appear when that confirmation is not selected. Each field has an
unknown choice; territories and foreign locations remain explicit unsupported
locations. No state, claim type or use is silently defaulted. Contact continuation
saves the confirmed facts first. Saved details can be reviewed and changed from
the analysis page. A failed or stale write requires reloading and confirming.

`GET/POST /api/v1/appraisal-cases/{case_id}/product` uses authenticated ownership;
POST calls the existing `append_case_jurisdiction_facts` optimistic revision RPC.
It adds no second intake store. Confirming a change replaces current customer
assertions for these six fields while preserving document assertions, unrelated
facts, and all earlier immutable versions. Document disagreement is displayed and
remains in the next version. This is confirmation of facts, not policy acceptance.
Existing fact-change triggers continue to hold enrolled delivery when facts change.
Unknown answers do not bypass evidence requirements.

The staff read route is `GET /api/v1/staff/appraisal-cases/{case_id}/product`.
`get_case_product_facts` independently checks the existing nonanonymous staff role.
The existing admin case's Vehicle & intake tab shows facts and provenance,
conflicts, applied product version/method, label, unresolved settlement items, and
recorded delivery state/authority revision/expiry. Unenrolled exposure is expressly
unreviewed. A staff read cannot approve, release, enroll, or modify a case. Recorded
hold state is not a fresh authority decision; release checks remain authoritative.

## Reports, settlement separation and immutable history

Flag-enabled new report generation uses template/renderer 5. Templates 1–4 retain
their original labels, projection and byte-replay behavior. The new template keeps
all existing subject, insurer, discrepancy, comparable and adjustment sections and
adds recorded location/claim facts, unresolved settlement items, and customer
next steps. It does not rename saved PDFs or recompute historical amounts.

The additive migration `20260923000000_nationwide_product_context.sql` introduces
one private RLS-protected table, `total_loss_report_product_facts`, and narrowly
scoped read/capture functions. Capture locks the case/report and stores raw facts
once per draft report version. Retry returns those exact inputs even after facts
change. Historical reports cannot be backfilled. The new report JSON contains a
versioned `productContext`, covered by its digest and replay validator. A database
trigger rejects template 5 facts that do not match the captured case/revision/
loss date. Customers and workers cannot directly update/delete the capture table.

Sales tax, title, registration/transfer and replacement credit are separate items.
All 51 records leave treatment unresolved and amounts/totals null. Nothing is
added to vehicle value. This does not claim that an item is unavailable or owed.
Future verified notes retain their own provenance and do not manufacture amounts.

Customer-submitted drafts and response coaching stay implemented. Direct insurer
sending, negotiation, formal appraisal-clause roles, umpire roles, claim-rights
assignment and settlement-proceeds assignment remain disabled. Product records do
not create permission for those capabilities. There is no insurer transport added.

## Copy and policy boundaries

Changed: home FAQ/introduction, resource-page description and manual-intake choice
now distinguish preliminary no-report estimates from the insurer-report requirement
for the paid service. Checkout uses the selected paid product name. Public partner
copy defers qualification and amounts to the signed agreement instead of claiming
that purchase alone earns a commission.

Unchanged for owner review: public Terms/Privacy effective dates differ from the
August 23 acknowledgment constants; fixing acceptance evidence requires a reviewed
policy/version transition, not retroactive labels. Terms still contain broader
no-report wording. Privacy wording about phone collection and any legal/economic
promise changes remain unresolved. Older policy documents retain their existing
package name. Exactly $1,000 remains excluded from both the under-$1,000 manual
refund and the newer greater-than-$1,000 commission-success condition. Agreement
publication status and operating scope remain separate owner decisions.

Price stays $199. No-support refund, under-$1,000 policy, commissions, attribution,
receipts, payment idempotency, refund rights, private storage, RLS and historical
customer access are unchanged. Signed payment events are still recorded and
reconciled even if new work is held. Payment does not grant delivery permission.

## Activation and rollback

- Backend `VENFOUR_NATIONWIDE_PRODUCT=false` by default. Off adds no product-fact
  reads/captures to report processing; product endpoints return 404.
- Frontend `VITE_NATIONWIDE_PRODUCT=false` by default. Off hides state intake and
  owner panels. The truthful copy corrections remain.
- `VENFOUR_JURISDICTION_MODE` remains the existing `off`/`shadow` setting; no enforce
  mode, authority reviewer/key, publication, enrollment or release is added.

The owner authorized generic nationwide activation on September 24, 2026, with
the same product, price, method and workflow in all 50 states and the District of
Columbia. Matching frontend/backend flags may be enabled after migration parity,
release validation and the accepted Template-5 qualification are verified.
Jurisdiction mode remains `off`; activation does not publish authority rules,
enroll cases, enable regulated capabilities or establish legal review of any state.
Unresolved state-specific settlement treatment, disclosures, terminology and
method enhancements remain unresolved. They are not additional admission gates
for the generic product. Existing explicit technical restrictions, ownership,
evidence, payment and report-release protections remain authoritative. Policy
review work remains separate and must not be represented as completed.
Local fixtures do not establish provider or hosted readiness. The dated release
report records actual deployed flags and verification; this authorization alone
does not establish deployment or a completed customer journey.

Rollback hides the new panels and disables new captures with the two flags. Keep
migration/history and the template-5 renderer/validator installed so existing
reports remain readable. Finish or explicitly hold in-flight template-5 report
attempts before reverting the backend flag; rebuilding an incomplete attempt as
legacy would change its expected PDF. Do not delete facts, report captures or
financial events. A flag change never restores revoked delivery authority.

See [51-jurisdiction coverage](nationwide-product-coverage.md) and
[verification results](nationwide-product-verification.md).
