# Owner launch-readiness review

Reviewed September 23, 2026 against repository commit `e5b54b6` and product configuration `2026-09-22.1`. This is a product and operations review, not a legal opinion or authorization to operate. Only this document was changed.

## 1. What actually remains before real customers?

**The generic product is implemented for all 50 states and D.C. No state-specific product defect or missing state implementation was established.** There are **51 GENERIC_PRODUCT_TECHNICALLY_READY**, **0 STATE_OVERRIDE_AVAILABLE**, **0 PRODUCT_FIX_REQUIRED**, and **0 PRODUCT_UNSUPPORTED** jurisdictions in the requested inventory. These are code-level coverage classifications, conditional on the shared prerequisites below; they are not 51 successful live customer journeys.

The remaining work is a bounded release exercise: verify the actual hosted configuration and migration gap, restore a clean report-processing regression check, qualify the new report presentation through the existing release process, deploy compatible database/backend/frontend versions in order, and supervise one eligible Missouri case through payment, delivery and response analysis. Separately, the owner needs an explicit decision about the activities offered in that pilot, informed by the existing regulatory review. Missouri is the preferred operational starting point, not a jurisdiction approved by this review.

**No additional nationwide product feature is demonstrated necessary for a controlled pilot.** Small verification-maintenance work remains: an older report-processing test double lacks the new capture method. The provider evaluation materializer currently builds template 4, so repeating its existing command alone would not establish template-5 qualification. Extending that evaluation coverage may also require a small test change. Neither is a request for more compliance infrastructure or a new valuation method. Do not charge the pilot customer while these release checks remain unresolved.

The product's actual output is a deterministic, evidence-grounded comparison with advertised market prices and disclosed limitations. It does not produce a newly adjusted point ACV, calculate the entire settlement, or promise recovery. Complete insurer-report acceptance and strict evidence qualification remain prerequisites for purchase; a state-ready record does not make every vehicle or case payable.

### Evidence boundary

Read: [product architecture](nationwide-product.md), [verification](nationwide-product-verification.md), [coverage](nationwide-product-coverage.md), [foundation](jurisdiction-foundation.md), [delivery holds](paid-delivery-holds.md), [authority](jurisdiction-authority.md), current configuration and the customer/backend paths below. Earlier documents sometimes group research, legal decisions and technical activation together as “hold” or “blockers.” That wording is not evidence that the current generic product fails in those states.

Current hosted settings **could not be verified**: read-only `gcloud run services describe` for the existing production service failed because credentials require reauthentication. This is an inspection limitation, not evidence the service is down. No login, hosted write or deployment was attempted. Repository flag defaults are confirmed; actual deployed flags, migration history, Stripe state and account quota remain unverified. The [September 16 launch record](../operations/production-launch-2026-09-16.md) is historical evidence only. It recorded a working deployment but no completed hosted paid valuation journey, and a shared staging/production Supabase project. Recheck that separation before any staging writes.

## 2. Product readiness in all 51 jurisdictions

**Yes** means the shared implementation supports this jurisdiction when correctly configured and when the particular case passes existing intake, evidence, ownership, payment and release checks. It does not mean enabled, legally reviewed, enough market comparables guaranteed, or independently exercised live in that state. The product matrix tests both first- and third-party facts across all 51 records. Report, checkout, draft and coaching are shared paths; they are not 51 separate implementations.

**U** in every row means the same explicitly unresolved product components: state comparable/methodology constraints, adjustments, required inclusions/exclusions, sales tax, title fees, registration/transfer fees, replacement credits, and special disclosures. Appraisal terminology is disabled. Section 4 classifies each item. The research also leaves a jurisdiction-specific activity-scope question open for every row; those questions remain in the [research seed](../../venfour/data/jurisdiction_research_seed.json), not converted into permissions here.

| Jurisdiction | Current product classification | Generic valuation | Report | Intake | Checkout | Generation | Customer draft | Response coaching | Unresolved | Prevent generic operation? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Alabama (AL) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Alaska (AK) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Arizona (AZ) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Arkansas (AR) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| California (CA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Colorado (CO) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Connecticut (CT) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Delaware (DE) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| District of Columbia (DC) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Florida (FL) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Georgia (GA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Hawaii (HI) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Idaho (ID) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Illinois (IL) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Indiana (IN) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Iowa (IA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Kansas (KS) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Kentucky (KY) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Louisiana (LA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Maine (ME) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Maryland (MD) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Massachusetts (MA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Michigan (MI) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Minnesota (MN) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Mississippi (MS) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Missouri (MO) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Montana (MT) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Nebraska (NE) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Nevada (NV) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| New Hampshire (NH) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| New Jersey (NJ) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| New Mexico (NM) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| New York (NY) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| North Carolina (NC) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| North Dakota (ND) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Ohio (OH) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Oklahoma (OK) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Oregon (OR) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Pennsylvania (PA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Rhode Island (RI) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| South Carolina (SC) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| South Dakota (SD) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Tennessee (TN) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Texas (TX) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Utah (UT) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Vermont (VT) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Virginia (VA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Washington (WA) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| West Virginia (WV) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Wisconsin (WI) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |
| Wyoming (WY) | GENERIC_PRODUCT_TECHNICALLY_READY | Yes | Yes | Yes | Yes | Yes | Yes | Yes | U | No technical dependency; scope review separate |

The source [inventory](../../venfour/data/nationwide_product_v1.json) has 51 generic records, zero verified overrides, null settlement treatments and verification/effective dates, and no appraisal labels. [Configuration validation](../../venfour/nationwide_product.py) enforces those facts. Unknown/conflicting/multiple-state facts and commercial use produce review reasons; they do not invent a controlling state. Foreign jurisdictions, territories and unknown location codes are outside this 51-record inventory and can return `PRODUCT_UNSUPPORTED`. ZIP identifies the market search origin, not governing law. Missing facts return review status. These descriptive statuses are **not a nationwide admission firewall**.

### Actual shared integration paths

| Customer step | Current implementation and limits |
| --- | --- |
| Intake and state facts | `frontend/src/pages/total-loss-start-page.tsx`, `frontend/src/features/nationwide/product-panel.tsx`, `venfour/nationwide_product_api.py`. Six explicit facts; unknowns and document conflicts retained; owner-authenticated revision-checked save. Contact continuation awaits the save when the panel is enabled. |
| Market evidence and insurer report | `venfour/efficient_search.py`, `market_search_runtime.py`, `full_review.py`, `full_review_processing.py`. Existing bounded local-first expansion and provider budgets; accepted report and material-fact review; saved evidence retained. No state-specific premium or invented tax adjustment. |
| Payment eligibility and payment | `venfour/full_review_payment.py`, `commerce.py`; `frontend/src/features/total-loss-claim/components/checkout-experience.tsx`. Matching saved assessment/report lineage, qualifying evidence, no unresolved material checks, owner/entitlement checks and optional staff approval. Price remains $199. |
| Report generation/release | `venfour/report_processing.py`, `valuation_evidence_report.py`, `valuation_review.py`, `report_release_gate.py`, `staff_release.py`. Per-version facts capture, template 5, deterministic PDF validation, independent review and staff remediation. Older report replay remains available. |
| Customer sends reconsideration | `venfour/customer_delivery.py` and existing database message-preparation functions; the claim workflow's customer-controlled draft/copy/email-client handoff and sent confirmation. No direct insurer transport or representation. |
| Insurer response and follow-up | `venfour/insurer_response_processing.py`, `insurer_response_followup.py`, and the claim workflow page. Owned upload, durable dispatch, bounded interpretation and customer-controlled follow-up. |
| Proxy and history | `frontend/worker/index.ts` forwards customer-host `/api/` paths, including the new product routes; partner/public hosts remain separate. `supabase_gateway.py` uses existing owner/service RPC boundaries. Payment reconciliation, historical downloads and retained-access refunds remain separate from new delivery permission. |

## 3. Real blockers and release conditions

### True product defects

**No confirmed customer-runtime calculation, payment, persistence or state-specific implementation defect was found in the inspected paths.** This is not a clean release sign-off: the verification failure below must not be hidden behind the earlier verification document. No state is reclassified as technically unsupported because a legal answer, deployment check or individual vehicle's evidence is missing.

### Concrete shared release and activation work

Severity P1 means resolve before taking the pilot payment. “Unverified” means inspect first, not assume broken or replace working configuration. All items affect the shared service across all states; none singles out Missouri as a code defect.

| ID / severity | Exact issue and location | Type / scope | Smallest required action |
| --- | --- | --- | --- |
| R1 / P1 verification | `ReportProcessingDatabaseGateway` now requires `capture_report_product_facts` (`venfour/report_processing.py:233`), but `tests/test_report_processing.py:_FakeReportDatabase` lacks it. Existing generation/release/refund tests error during processor construction, even with the product flag off. Only the new nationwide test attaches it dynamically. The real `SupabaseHttpGateway` implements it at line 589. | Test code / all states; not a demonstrated production-gateway defect | Complete the fake's protocol with a capture method that fails if unexpectedly used while disabled; rerun affected report tests. Preserve tests asserting no new reads with the flag off. No application-method change is justified by this error alone. |
| R2 / P1 release evidence | New report template is 5; `venfour/report_review.py:184` discusses templates 2–4. `tests/report_review_provider_eval.py:SyntheticReportReviewEvalMaterializer` uses the legacy report builder without product context. `config/report-review-eval-attestation-v1.json` records the September 16 template-4-era suite. The gate is not coded to reject template 5 merely because it is new, but the old artifact does not prove review quality for its new content. | Verification / operations; possibly bounded evaluation-fixture code / all states | Exercise a template-5 packet, including location conflicts and unresolved settlement notes, through deterministic validation and the existing release review. Use separately authorized provider qualification where needed; preserve existing adversarial expectations. If prompt/suite changes, regenerate genuine qualification and update matching pins. Do not relabel the old artifact or assume another run of the unchanged template-4 materializer covers template 5. |
| A1 / P1 | Latest code introduces database fence calls even when the product flag is false. Missing hold RPCs stop existing paid entry points; enabling product adds fact read/capture RPC dependencies. Current hosted migration parity is unknown. | Deployment / database / all states | Read hosted migration history, rehearse the exact missing ordered migrations, then apply them through a separately authorized release before compatible backend code. Keep history/RLS and private storage. |
| A2 / P1 | Both product flags default false. Frontend true/backend false makes the new intake panel request a 404 endpoint and prevents its confirmed save. Frontend build and backend/worker rollout state are unknown. | Configuration / deployment / all states | Deploy compatible code with both false, then backend true first and a frontend build with its flag true last, after prerequisites. Flags are global, not Missouri or single-case selectors. |
| A3 / P1 if absent/mismatched | `StripeCommerceConfiguration`, strict DB checkout functions, API proxy and `CloudTasksConfiguration` need coherent live mode, canonical price/version pins and durable dispatch. A successful charge without functioning workers can leave the customer waiting. Hosted state unverified. | Configuration / deployment / operations / all states | Verify existing Stripe price/product/mode/webhook and queue/OIDC/recovery settings; repair only identified gaps. Rehearse signed duplicate events and refund recovery in a separate sandbox. Do not collect the first live payment as a configuration test. |
| A4 / P1 if unavailable | `market_search_configuration_reason` rejects missing/expired account limits or quota periods. Auth, private uploads, extraction and response-analysis configuration are needed for the requested end-to-end path. The API builds explicit response-model/dispatch readiness reasons. Hosted/provider state unverified. | Configuration / provider operations / all states | Inspect account entitlements, quota/radius/rate declarations, model configuration, credentials, Storage/Auth and dispatch. `/health` alone is insufficient. Use current authorized account facts, not larger budgets to force completion. |
| A5 / P1 pilot control | Automatic checkout approval is the repository default (`20260915000300_automatic_payment_eligibility.sql`). Product flags and off/shadow jurisdiction modes do not contain a Missouri pilot. No production jurisdiction-enrollment path exists. | Operations / configuration / all states | Before activation, select a bounded admission plan using existing manual checkout approval for the intended case, with a named staff operator and no broad availability campaign. Inspect existing pending sessions/cases before changing a global setting. It controls paid admission, not public previews or previously paid work. |
| A6 / P1 operational acceptance | No current evidence completes the hosted insurer-report → eligible checkout → released PDF → customer draft → response-upload/analysis chain. Existing report/refund remediation and support must have an operator. | Operations / all states | Complete the isolated rehearsal and supervised pilot checkpoints below. Monitor durable work and payment reconciliation; stop new admission on a failed checkpoint. Do not bypass evidence or release gates to complete the itinerary. |

An inability to refresh local cloud credentials is not an extra customer-runtime defect. It currently prevents resolving A1–A4 from this workstation. Missing shared lifecycle/partner marketing email is also not automatically a blocker for a signed-in, directly recruited pilot; functioning chosen authentication/recovery and receipt access are required. Avoid a commissioned referral in the first pilot.

### Legal/compliance scope, separate from technical release

The registry contains zero operational rules and its reviewer/writer/publisher configuration is empty. That does **not** make the unenrolled generic runtime require 51 legal rules to execute. It also does **not** authorize existing exposure. `VENFOUR_JURISDICTION_MODE` accepts only `off`/`shadow`; shadow records proposals without enrollment. Delivery enrollment is restricted by database server marker and sandbox-order checks to isolated rehearsals. Do not change those protections or represent them as a live launch switch.

The owner must obtain a suitably qualified review of the actual Missouri pilot activities: factual preview/report, personalized value comparison, customer-submitted draft and response coaching, with the selected claim/policy circumstances. Resolve only applicable operating, credential, disclosure, payment/contract, privacy and tax/business obligations for that scope. No automatic finding of prohibition, exemption or permission is made here. Direct negotiation, formal appraisal-clause/umpire work and assignments stay outside the offered service.

## 4. Non-blocking unresolved items and state-specific decisions

This classification concerns whether the generic implementation can function honestly without the enhancement. **B is not a legal finding that the item can be ignored.** If external review identifies a mandatory requirement for the offered activity, satisfying it becomes an external launch condition for that scope. Research uncertainty alone is not a technical defect.

| Unresolved item, for every applicable record | A: required before generic use / B: can follow generic launch | Reason and boundary |
| --- | --- | --- |
| Special comparable geography, selection or state methodology | B as an enhancement; a specifically established mandatory constraint becomes A for that scope | Generic bounded search and deterministic evidence grading work. Do not describe them as a verified state-prescribed method. No verified override currently ships. |
| State-specific mileage/condition/equipment/location adjustments | B | Report discloses that no independent dollar adjustments were made. No missing adjustment amount is silently invented. |
| Required valuation inclusions/exclusions | B as product enrichment; A if a reviewed requirement makes the offered generic comparison misleading or impermissible | Current configuration is explicitly unresolved and report is limited to the shown vehicle evidence, not total entitlement. |
| Sales tax | B | Separate unresolved settlement component; amount null and not added to vehicle value. No claim it is unavailable or owed. |
| Title fees | B | Same separate-component treatment. |
| Registration/transfer fees | B | Same separate-component treatment. |
| Replacement tax/fee credits | B | Same separate-component treatment; customer-specific replacement conditions are not inferred. |
| Special disclosures and terminology | B for optional explanations; A only for a specifically applicable mandatory disclosure | Generic limitations already appear. No verified state disclosure exists; legal necessity remains unknown. |
| Appraisal labels, formal clause rights, appraiser/umpire roles | B for future capability work | Default report label remains Total-Loss Valuation Report; formal roles are disabled. Their absence is not a failure of the generic evidence product. |
| Unknown/conflicting location, claim type, commercial use or multiple jurisdictions | A to review the selected pilot case's scope, not to implement a universal choice-of-law rule | Intake preserves these states; generic computation can still work. Use a simple, fully confirmed pilot case and do not infer jurisdiction from ZIP/IP. Unknowns are not approvals. |
| Exact individual/entity licensing and activity applicability | Separate external decision before the relevant offer; no technical implementation prerequisite established | This is the research seed's state-by-state scope question. Review actual report/draft/coaching behavior, not just its label. Do not assume customer self-submission establishes an exemption. |
| First/third-party and personal/commercial legal distinctions | Separate external scope decision; generic first/third-party product works | Both claim types are represented; commercial/mixed facts need review. A personal first-party case is operationally simpler for the first pilot. |
| Marketing, solicitation and paid referrals | B for capabilities excluded from the direct pilot; external review before using them | Keep partner attribution and commission rules intact; do not enable an unreviewed compensated channel. |
| Service taxability/nexus, business qualification and privacy/data rights | Separate external/operations determination for actual activity; not a defect inferred from incomplete research | This concerns operating the business, including possible tax on Venfour's fee, distinct from vehicle settlement tax. Verify applicable obligations without changing $199 here. |
| Price/refund/contract wording | Non-blocking cleanup unless external review identifies an applicable restriction or an actual runtime mismatch | Keep existing economics and customer rights. No state record requires an invented fee or refund formula. |

Those rows cover all seven unresolved research workstreams in the seed, as well as every null/unverified product treatment. The source's distinct jurisdiction-specific legal questions remain unanswered; they are not collapsed into a nationwide legal conclusion.

### Existing policy cleanup

- Terms/refund pages show September 15 and Privacy September 7, while intake acknowledgment constants retain August 23 versions. Current unenrolled checkout does not require the dormant exact-document authority catalog, so this is not a newly discovered hard runtime gate. Plan a reviewed prospective version transition; never relabel historical consent.
- Exactly $1,000 remains outside the under-$1,000 manual-refund and greater-than-$1,000 commission conditions. It does not crash or prevent generic checkout/report generation. Preserve the published rights and calculations; obtain an owner policy decision separately. No resolution is proposed here.
- Broader Terms no-report wording, older package naming, optional-phone privacy wording and referral-policy review remain cleanup/external review items. They do not justify replacing the existing workflow.

### Copy and promise check

| Topic | Exact current wording / location | Finding and smallest correction |
| --- | --- | --- |
| Insurer report requirement | “The paid Total-Loss Valuation Report requires a complete insurer valuation report…” — `frontend/src/pages/home-page.tsx:46`; same distinction in `public-resources.tsx:47` | Matches the paid gate. No change needed. |
| Preliminary versus paid | “Start with your insurer’s report, or enter details for a preliminary estimate. The paid report requires your insurer’s valuation report.” — `home-page.tsx:27` | Clear distinction. Terms lines 24–30 still describe accepting details “without a report”; add the single sentence that no-report results are preliminary and a complete report is required for purchase in the next policy revision. Not a runtime blocker. |
| Nationwide availability | No unqualified all-states availability promise found in the inspected home/resources/intake/checkout/report paths. The 51-record configuration is internal product coverage. | Do not add a public nationwide claim at the Missouri stage. Reassess public wording against the scope actually offered before Stage C. |
| Appraisal terminology | Report title is “Total-Loss Valuation Report.” Legacy intake still says “vehicle appraisal” (`intake-steps.tsx:363`), “private appraisal” (560), “Saved appraisal” (998), and “Continue your saved appraisal?” (1001); analysis access/error states also say “appraisal.” | Inconsistent customer vocabulary, not a missing appraisal service or proven runtime blocker. Smallest cleanup: “vehicle valuation,” “private case,” “Saved case,” “Continue your saved case?” and “case” in access/error text. Keep database/API identifiers unchanged. Do not call the current experience terminology-clean or enable formal appraisal labels. |
| Representation | “Venfour helps you understand the evidence; it does not negotiate on your behalf, determine what you are legally owed, or guarantee a higher payment.” — `public-resources.tsx:54` | Consistent with customer sending. No change required. This disclaimer does not decide regulatory classification. |
| Taxes and fees | “No tax or fee amount has been added to the vehicle comparison. These separate settlement items remain unresolved; this does not mean they are unavailable or legally owed.” — `venfour/valuation_review.py:502` | Honest generic scope. No state-tax implementation required just to remove uncertainty. |
| Outcomes | “Payment does not guarantee a higher insurer valuation or settlement.” — `checkout-experience.tsx:140`; refund page preserves two distinct protections | No guaranteed recovery found in these paths. Keep refund rights, threshold and $199 unchanged. |

## 5. Feature-flag activation map

| Flag | Default / layer | Enabled behavior | Dependencies | Rollback |
| --- | --- | --- | --- | --- |
| `VENFOUR_NATIONWIDE_PRODUCT` | `false`; backend process environment, exact string `true` enables | Exposes customer/staff product endpoints; captures immutable product facts for new report versions; generates template 5 with location/settlement context | Current product inventory, fact/hold/product migrations, full gateway implementation, existing report/release services. Set consistently on API and any worker revisions receiving work. | Set false on compatible backend after draining or explicitly managing in-flight template-5 work. Product endpoints return 404; new processing reverts to the legacy presentation path. Does not remove already saved facts/reports. |
| `VITE_NATIONWIDE_PRODUCT` | `false`; frontend **build-time** setting | Shows six-fact intake/editing and staff inspection panels; enabled contact continuation awaits a confirmed fact save | Backend flag true and endpoints working; matching Supabase/Auth ownership; rebuilt application bundle | Build/deploy compatible frontend with false. Hides panels, preserves facts and saved reports. Changing a Worker runtime variable alone does not rebuild the bundle. |

Neither flag changes price, calculations, eligibility, licensed activity, refunds, commission formulas, partner attribution or legal authority. Both false preserves legacy behavior; frontend true/backend false is an invalid rollout combination. Backend true/frontend false can generate template-5 reports with missing facts, so it is only a short deployment interval with new admission stopped, not the intended pilot configuration.

| Environment | Suitability of enabling the two product flags |
| --- | --- |
| Local | Suitable with a migrated isolated database and synthetic/offline providers. A mock walkthrough is not full-flow proof. |
| Staging | Suitable after confirming it is genuinely isolated from live data/payment/provider work, with the schema and backend first. The historical shared Supabase setup must not be assumed safe for fixture writes. |
| Controlled pilot | Conditional on sections 3 and 6, a reviewed operating scope, controlled paid admission and a named operator. Flags alone are not sufficient. |
| General production | Not an unconditional go-ahead. Enable only as a deliberate release after pilot acceptance and scope decisions. Expand availability separately from switching presentation flags. |

Leave `VENFOUR_JURISDICTION_MODE` at its currently selected supported setting (`off` by default); no `enforce` mode exists. Shadow is optional observation, not a pilot dependency or permission. Keep local mock/fixture flags out of hosted builds. Existing report-release configuration and evidence gates remain in force; do not switch them off as a qualification workaround. In particular, the private paid-work recovery endpoint requires a valid enabled release configuration.

## 6. Controlled Missouri pilot checklist

### Before deployment or taking money

- [ ] Owner names one operator and one directly recruited customer, with no commissioned referral. Document the exact report/draft/coaching scope and obtain the targeted external review needed for that offer. Missouri location and the prior review starting there do not supply approval.
- [ ] Prefer a personal, first-party loss with registration, garaging, loss location and policy-issued facts all actually Missouri; confirm the loss date. Do not manufacture matching facts. Defer a mixed-jurisdiction or commercial case from the first operational rehearsal.
- [ ] Resolve R1 and obtain the template-5 release evidence in R2. Retain the current valuation/evidence rules and adverse-case fixtures. A genuine provider test needs separate authorization and a cost limit; none was run for this review.
- [ ] Restore read-only deployment access; record actual serving revisions, frontend build flags, backend non-secret settings, database migration history, queue/scheduler status and price identity. Obtain a current recovery snapshot and identify compatible rollback revisions without exporting secrets or unnecessary customer records.
- [ ] Verify staging/database separation. Rehearse against a disposable or genuinely isolated database and Stripe test mode. Never run fixtures or resets against the historically shared project.
- [ ] Choose controlled paid admission. The existing `total_loss_payment_approval_settings.manual_approval_required` can require approval; `staff_payment_approval_decide` binds a decision to the exact case/owner/evidence lineage and prevents self-approval. Enabling that existing setting requires an authorized database configuration change, not a new migration or feature. Inspect pending checkout sessions and impact on existing customers first. It does not disable previews or grant legal authority.

### Exact eventual deployment order

1. **Freeze new pilot admission and inventory in-flight work.** Preserve signed webhooks, customer history/access and financial recovery. Do not stop the whole application or delete pending orders as a convenience.
2. **Rehearse then apply only missing migrations in repository timestamp order.** The current repository contains 88 migration files. If the target still matches the historical 82-migration September 16 baseline, the missing sequence is:
   - `20260917000000_customer_scope_and_incomplete_intakes.sql`
   - `20260917000100_staff_email_history.sql`
   - `20260922000000_jurisdiction_foundation.sql`
   - `20260922000100_paid_delivery_holds.sql`
   - `20260922000200_jurisdiction_trusted_authority.sql`
   - `20260923000000_nationwide_product_context.sql`
   Read the actual ledger first; do not replay applied migrations. The direct nationwide product delta is the last file, depending on the preceding foundation/hold schema. No operating approval, enrollment, credential or authority publication is part of this deployment.
3. **Deploy compatible backend/API and worker code with the product flag false.** Database first matters even with the flag false because paid-delivery fences are unconditional dependencies. Keep template-1–5 reading/rendering support and package the existing genuine release qualification artifact. Check readiness and authenticated private recovery configuration.
4. **Enable backend product capture** only after R2 and migration/RPC checks pass. Keep admission stopped until matching frontend is ready. Verify an owned product GET and staff boundary in the isolated rehearsal; no synthetic production case is implied.
5. **Build and deploy the application frontend with `VITE_NATIONWIDE_PRODUCT=true`.** Preserve the same-origin API, Auth/Turnstile, customer/staff/partner host boundaries and public site. Backend must already understand the new endpoints. A public marketing launch is unnecessary.
6. **Run the hosted boundary checks and admit only the selected case.** Resume appropriate dispatch/recovery schedules with verified identities. Staff grants checkout approval only after strict eligibility and the selected operating-scope checks. Do not grant an exemption to force a payment.

### System acceptance checks

| System | Required concrete check before accepting the pilot payment |
| --- | --- |
| Environment / proxy | Backend Supabase URL and frontend project pin agree; server-only service credentials remain private. Production frontend uses empty `VITE_API_BASE_URL`, `https://app.venfour.com`, correct public origin and a real Turnstile site key. Worker `API_ORIGIN`/`API_PROXY_SECRET` match the backend's proxy boundary. Direct internal routes remain protected. Run `/ready` through the intended authenticated backend boundary, not merely public `/health`. |
| Database | Confirm all pending migrations and routine signatures, `get_case_product_facts`, `append_case_jurisdiction_facts`, `capture_report_product_facts`, and `check_paid_delivery`. Verify owner/staff/service grants, RLS and immutable capture/report history. Confirm no unexpected jurisdiction delivery enrollment; do not insert any. Check manual-payment-approval configuration and pending orders/work before the admission change. |
| Supabase | Real customer sign-in and recovery work through the chosen Auth route and allowed callback hosts; anonymous-to-owned case recovery preserves data. Insurer PDFs and `case-deliverables` are private, wrong-user access denied, signed download links bounded. Storage permissions and PDF upload limits work. Keep the existing Auth mail route; do not require a new marketing-mail system for this pilot. |
| Stripe | Read-only verify active canonical USD 19900 price and product identity, mode-compatible keys, current product/terms/refund version pins, exact return origin and signed endpoint `/webhooks/stripe`. In isolated test mode, demonstrate duplicate and out-of-order events, browser return before webhook, reconciliation after refresh, refund pending/failure recovery and retained report access. Keep the live webhook available regardless of delivery state. Live mode is selected only for the genuine approved pilot purchase, not a readiness probe. |
| Durable processing | Configure all six `VENFOUR_PACKAGE_TASKS_*`/`VENFOUR_PACKAGE_WORKER_ORIGIN` settings from `CloudTasksConfiguration`, queue and OIDC service identity/audience; verify invoker and enqueue permissions, bounded attempts and recovery schedule. Check the private paid-work configuration endpoint without dispatching work. Do not treat an empty queue as end-to-end proof. |
| Market provider | Confirm account access to the required inventory/history data, provider radius, rate/allowance/prior-usage/quota-period declarations and any permitted retention. Respect existing per-case budgets and ledger. Validate the current period; do not call paid endpoints merely to test credentials in this task. Sparse/unsupported evidence must stop or qualify the case truthfully. |
| Extraction / report review / response | Confirm server-only provider credentials and configured extraction/response models. Report review needs matching approved model, prompt, schema and suite digest plus genuine packaged qualification. `OPENAI_INSURER_RESPONSE_ANALYSIS_MODEL`, private tasks/OIDC and `VENFOUR_INSURER_RESPONSE_DISPATCH_SECRET` must be configured; Vault dispatch origin/secret and wake schedule must agree. These are existing configuration names, not new features. |
| PDF and release | Template-5 capture binds the exact report version, fact revision, case and loss date. Check vehicle/insurer identity, all primary comparables, unchanged arithmetic, advertised-price limits, no invented tax amounts, pagination, private PDF download and report/review digests. A held report needs the existing staff review process; do not force-publish it. |
| Support / refunds | Founder can see failed work and release-review queues, reconcile receipts/orders and execute the existing refund process. Monitor the support address for manual claims and preserve both automatic no-support and manual outcome-refund rights. Do not silently leave a paid case waiting for an absent operator. |

### The one-customer run

1. Customer signs in/owns the case, supplies truthful location/claim facts and uploads a complete real insurer report. Confirm original source and parsed vehicle/report data; resolve material mismatches.
2. Run the existing evidence search within authorized cost limits. Save and inspect evidence and strict review. **If the case does not qualify, stop without payment.** Selecting another genuine case is acceptable; changing the calculation or evidence thresholds is not.
3. Staff approves only the qualified, correctly owned and scoped case under the selected admission plan. Customer sees $199 and existing terms/refund rights and voluntarily pays through normal checkout.
4. Verify signed event → one recorded payment/order/entitlement → durable package work. Browser success alone is not payment proof. Confirm no duplicate charge/work on refresh and recovery.
5. Generate, review and release the actual immutable valuation report through existing gates. Check the report and private customer download; retain receipts and all evidence. If no support or delivery failure occurs, follow the existing appropriate refund/remediation path, not forced release.
6. Customer reviews the reconsideration draft, selects evidence, sends it using their own channel and records that action. Venfour does not send or negotiate for them.
7. When a real insurer response arrives, customer uploads it; verify private storage, durable response job, evidence-bound interpretation and next-step coaching/follow-up draft. The pilot remains incomplete until this stage has real evidence; do not substitute a synthetic insurer reply as production proof.
8. Founder closes the case only with the actual customer/insurer outcome, checks any refund request against the existing policy and records issues before admitting the next case. A higher payout is not an acceptance criterion; faithful analysis and correct rights are.

### Monitoring and responsibility

The founder owns admission, scope decisions, source corrections, staff release/remediation, customer support, insurer-response follow-through and refunds. During the pilot, inspect failed/retryable work, queue age, report holds, payment events versus entitlements, refund pending states, response jobs and provider budget consumption after each transition. Record case/work/event identifiers in private operational evidence, not claim contents in public logs. The checked-in Worker config disables observability logs, so do not assume edge alerts exist; use verified backend/database/provider monitoring and the staff workspace, with privacy-preserving alerts added operationally if needed. Any unexplained charge, wrong-owner access, identity mismatch, misleading report or unrecoverable processing error stops new admission.

## 7. Nationwide rollout stages

| Stage | Smallest scope | Exit condition and architectural constraint |
| --- | --- | --- |
| A | Controlled Missouri cases, one at a time | Complete the entire supervised path with current release/config evidence and scoped operating review. Neither flag provides a state allowlist. |
| B | A small, intentionally chosen multi-state pilot | Repeat with documented claim/location facts and actual data coverage; review the offered activities for those scopes. Use existing staff checkout admission and include a different claim type only deliberately. No arbitrary number of states is a prerequisite. |
| C | Generic valuation availability across the supported US inventory, excluding explicitly restricted scopes | Product can reuse the same engine/report. Before public self-service expansion, establish a reliable admission mechanism for any actual exclusions and a support/refund operating model. The shipped status table and off/shadow adapter cannot enforce exclusions. Manual checkout review can contain a small paid pilot; automated nationwide exclusions would be a separately scoped later implementation if needed. It must also address previews/new work where the actual restriction applies. |
| D | Verified tax/fee/methodology refinements progressively | Add only sourced, reviewed, date/scope-bound rules. Current version validates that zero real overrides exist and frozen replay reconstructs that version. Existing override primitives are a seam, not a turnkey live rule editor: a future version needs deliberate configuration/consumer wiring and historical replay support. Preserve totals and budgets unless an actual reviewed change is authorized. |
| E | Appraisal terminology or regulated services, selectively | Separate scope/credential review and explicit implementation/activation. Generic product operation does not depend on enabling these. No negotiation, formal role or referral compensation becomes permitted through a wording change. |

This staging matches the shared architecture. A–B do not need a 51-state methodology project. C cannot honestly promise enforced exclusions using the present product flags. D–E are subsequent capability work, not prerequisites invented for the first generic case.

## 8. Rollback plan

1. Stop **new** paid admission using the approved operational control; inspect and explicitly manage outstanding open Checkout Sessions. Changing product flags does not expire a session or reverse a payment. Do not disable signed webhooks or financial reconciliation.
2. Rebuild/deploy the frontend flag false first. Preserve routes for saved reports, drafts, receipts and account recovery. Notify/support affected customers through the established operator process when authorized; no message was sent for this review.
3. Drain or deliberately pause affected in-flight template-5 generation/review using supported queue/operations procedures before setting the backend product flag false. A retry that began writing template-5 bytes must not regenerate the same immutable report version as template 4. Retain compatible code to finish or remediate it.
4. Roll back to a **compatible** backend revision that retains the new database fences and template-5 validation/renderer. Do not blindly restore the pre-foundation image once new reports exist. Product false stops new capture; it is not a delivery revocation or legal-approval rollback.
5. Keep additive migrations, fact captures, original documents, report versions, delivery holds and financial records. No down migration, purge, reset or historical backfill. Jurisdiction mode off does not release a held case.
6. Reconcile every paid case: continue safely through existing release gates, staff remediation or the applicable refund process. Preserve customer history/access, receipts, accounting and refund rights. Restart admission only after the specific failed condition is resolved and checked.

## 9. Owner decisions still required

- What exact Missouri activities and claim/policy scope will be offered, and who provides the targeted external review? The product status does not answer that question.
- Who supervises the first case, accepts the release evidence, monitors support and handles refunds? Is temporarily requiring staff payment approval acceptable for the current footprint, including any pending customers?
- Approve a bounded follow-up for R1 and template-5 qualification evidence, with separate authority for any provider cost. No new compliance machinery is needed to perform these checks.
- Authorize the later deployment/migration/configuration window after read-only hosted preflight; choose a verified isolated rehearsal environment and compatible rollback revision.
- Decide when to reconcile prospective policy versions and legacy “appraisal” wording. Do not rewrite history, change $199, amend refunds/commissions or resolve exactly $1,000 as part of activation.
- Before Stage C, decide actual offered scope and any exclusions, then choose the smallest admission control that can enforce those real decisions. Do not prebuild speculative state rules.

## 10. Meaning of ready, reviewed and activated

| Term | What this review establishes |
| --- | --- |
| Technically ready | The generic paths and configuration exist for 51 jurisdictions. No state-specific product fix or unsupported state found. Shared release verification and hosted activation still outstanding. |
| Legally reviewed | Research and a technical status are insufficient. No operating rule or jurisdiction approval was created; the current packaged registry contains zero approvals. The owner's external scope decision remains separate. |
| Activated | Both code/config deployment and operations must be confirmed in the actual environment. This review enabled nothing and cannot assert the current hosted flags from repository defaults. |

**Recommended next action:** one bounded pilot-preflight task: repair the report test fixture, establish template-5 release evidence, restore read-only hosted inspection and produce the exact missing configuration/migration list. Then seek a separate deployment decision for the controlled Missouri pilot. Do not start another nationwide feature build.

## Verification for this review

These checks were run on the inspected commit with no product edits. Detailed local logs are under `/tmp/venfour-launch-readiness-*.log`; temporary diagnostic files are outside the repository.

| Check | Current result |
| --- | --- |
| Offline backend batch: `test_nationwide_product test_nationwide_report test_report_processing test_report_release_gate test_paid_delivery test_full_review_payment test_commerce test_insurer_response_followup` | **Failed:** 211 test entries; 36 error records, zero assertion failures. 35 errors/subtest errors came from the missing fixture protocol method in R1. One loader error was this review's incorrect selector `test_full_review_payment` (no such module), not a product error. The batch had zero unexpected network attempts. |
| Passing methods within that failed batch | Product matrix/API 13; nationwide report 3; new nationwide worker test 1; release gate 10; paid delivery 17; commerce 120; response follow-up 21. These are 185 passing methods, not a claim that the batch passed. |
| Isolated existing generation test, unchanged fixture | Reproduced `TypeError: database must expose report-processing methods`; 1 error, zero unexpected network attempts. |
| Diagnostic generation test with the missing fake method supplied **in memory only** | 1 passed. The added method raises if called, proving disabled-flag generation does not need to capture facts. This isolates the fixture-contract defect; it does not repair the committed suite or prove every failed test would pass after repair. |
| Correct payment-readiness selector: `test_full_review_processing` | 5 passed; zero errors or unexpected network attempts. Includes missing/held/stale approvals, automatic eligibility and changed-report fencing. |
| Frontend: `product-panel.test.tsx`, `total-loss-start-page.test.tsx`, `worker/index.test.ts` | 199 passed across 3 files. The initial command also named a nonexistent standalone checkout test file; it contributed no tests. |
| Actual checkout/customer-flow file: `total-loss-claim-workflow-page.test.tsx -t 'payment\|checkout\|refund\|response\|draft'` | 21 passed; 58 other tests excluded by the name filter. Existing test-DOM `scrollTo` notices were non-failing. |
| Inventory and document checks | All 51 unique state/DC codes, common generic configuration and zero verified overrides inspected. New document's local links/paths and whitespace checked. |
| Hosted configuration | Read-only cloud inspection failed on credential reauthentication. No current hosted configuration, migration parity, live payment, inbox or provider-flow pass claimed. |

The earlier nationwide verification document records isolated database results (622 assertions plus the separate earnings checks), type/build checks and a fictional PDF review. Those checks were not rerun here; they are supporting historical evidence. Its broad report-processing pass cannot be treated as a current pass because R1 reproduces on this commit. This review did not apply even a local migration, rerun a provider evaluation, or weaken a gate.

No product source, prices, policies, commissions, authority rules, flags or hosted data were changed. No deployment, email, live payment, hosted migration or paid provider request occurred. No jurisdiction was approved or newly enabled.
