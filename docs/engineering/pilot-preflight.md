# Pilot preflight — September 23, 2026

## Owner answer

**Not yet ready to accept the first supervised real payment.** The generic product remains implemented for all 51 jurisdictions, with no demonstrated state-specific product defect and no unsupported state/DC. The stale report-processing fake is repaired. Template 5 has now completed genuine 28/28 provider qualification and formal repository acceptance, with the prior artifact preserved; this acceptance does not install a compatible hosted release. The follow-up hosted audit verified the live $199 price/webhook and production provider/queue configuration. Four migrations and the compatible product deployment remain pending; staging lacks its market-provider binding. See the dated hosted follow-up below for the current findings.

The remaining work is isolated operational acceptance, deployment/schema alignment, configuration verification and owner readiness. No new product feature or second genuine qualification run is justified for this unchanged accepted candidate. An owner decision on the actual Missouri operating scope remains external to the software review. None of these findings approves Missouri or another jurisdiction.

Evidence is against checkout `29e97e5` plus the two test changes below. That commit added the prior readiness document; nationwide product code is from `e5b54b6`. Hosted observations are a point-in-time snapshot, not an assurance about later configuration.

## Changes and local release evidence

- [test_report_processing.py](../../tests/test_report_processing.py): `_FakeReportDatabase` now implements `capture_report_product_facts`, required by the runtime-checkable `ReportProcessingDatabaseGateway`. It raises if unexpectedly called while the product is disabled. The enabled test continues to install its own capture implementation. Existing release, immutability, evidence, refund and delivery assertions remain intact. The actual `SupabaseHttpGateway` already implements the method; this was a test-contract defect.
- [test_nationwide_report.py](../../tests/test_nationwide_report.py): adds five fictional variants in one test: supportable, no-support, conflicting evidence/location facts, unknown facts and third-party claims. It checks frozen monetary/evidence equality with the previous format, canonical validation, byte-identical replay, PDF validation, disclosure text, bounds, fonts and link safety.
- This document records the preflight. No application, migration, provider prompt, qualification artifact, price or policy implementation changed.

| Check | Final result |
| --- | --- |
| Main offline backend release batch, 30 selectors listed below | **640 passed**, zero failures/errors/skips; zero unexpected network attempts |
| Additional package dispatch/API, response API and preliminary qualification batch | **88 passed**, zero failures/errors/skips; zero unexpected network attempts |
| New template-5 variant test, run separately after the main batch loaded its modules | **1 passed, five subtest variants**, zero unexpected network attempts; not included in the main batch count |
| Frontend: intake/product facts, checkout/workflow, analysis/results/history, attribution/earnings, edge and environment contracts | **502 passed across 11 files** |
| Database release suites | **1,319 assertions across 27 suites passed after test-environment corrections described below** |
| Partner earnings database integration | **3 tests passed**, containing **272 additional SQL assertions** |
| Migration preservation rehearsal | **88 migrations passed**: 29 baseline and 59 subsequent; synthetic baseline/backfill preservation passed |
| Typecheck and generated-contract freshness | Passed |
| Local application build | Passed; existing large-chunk warning only |
| PDF visual inspection | Three fictional PDFs, three pages each: **all nine pages inspected**, plus representative grayscale page |
| Scope review, document links and `git diff --check` | Passed |

Totals without counting reruns twice: **729 offline backend tests**, **502 frontend tests**, and **1,591 SQL assertions** (1,319 release assertions plus 272 inside three earnings integration tests). These are local/offline or isolated-database results. A plain local build is not a validated production-environment build. Non-failing test-DOM `window.scrollTo` notices are not browser acceptance evidence.

The database suites initially ran against the preservation rehearsal's seeded financial records. Suites 052/053 expect an empty fixture database and failed their global-zero assertions. They passed unchanged in a second fresh database. Suite 057 then exposed PostgreSQL 17's automatic creator membership: `postgres` had `ADMIN=true`, `INHERIT=false`, `SET=false` on the two new no-login roles. The grantor was `supabase_admin`; revoking as `postgres` had no effect. Revoking those memberships **only in the disposable target as the grantor**, then verifying zero memberships, made the unchanged 23-assertion authority suite pass. This is a deployment role-graph prerequisite, not proof that the migration alone produces zero memberships on every host. No application grant, review key, publisher identity or operating authority was installed.

Both new rehearsal containers used `network=none`, no exposed ports and disabled cron execution. Only schema-only Auth/Storage definitions were read from the existing local database. They are now stopped and retained; existing local services were left alone. The preservation rehearsal and the empty-fixture tests are separate evidence, not interchangeable environments.

### Reproduction and evidence locations

Main batch, using the repository's network-denying runner:

```sh
.venv/bin/python scripts/run_offline_tests.py \
  test_report_processing test_nationwide_product test_nationwide_report \
  test_report_release_gate test_report_review test_report_review_evals \
  test_valuation_evidence_report test_valuation_review test_staff_release \
  test_customer_delivery test_follow_up_delivery \
  test_insurer_response_processing test_insurer_response_dispatch \
  test_insurer_response_analysis test_insurer_response_decision \
  test_insurer_response_followup test_full_review test_full_review_processing \
  test_commerce test_paid_recovery test_market_request_budget \
  test_efficient_search test_search_geography test_paid_delivery \
  test_jurisdiction test_jurisdiction_integration test_jurisdiction_authority \
  test_partner_commissions test_partner_earnings test_partner_outcomes

.venv/bin/python scripts/run_offline_tests.py \
  test_package_processing test_package_processing_api \
  test_insurer_response_analysis_api test_preliminary_qualification

.venv/bin/python scripts/run_offline_tests.py \
  test_nationwide_report.NationwideReportTests.test_release_variants_preserve_evidence_replay_and_presentation

npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Frontend selectors after `npm --prefix frontend test --`: `src/features/nationwide/product-panel.test.tsx`, `src/pages/total-loss-start-page.test.tsx`, `src/pages/total-loss-claim-workflow-page.test.tsx`, `src/pages/total-loss-analysis-page.test.tsx`, `src/features/total-loss-claim/components/completed-analysis.test.tsx`, `src/features/total-loss-claim/case-workspace.test.ts`, `src/features/referral-partners/referral-tracking.test.tsx`, `src/features/referral-partners/earnings.test.tsx`, `worker/index.test.ts`, `scripts/production-environment.test.mjs`, `scripts/staging-environment.test.mjs`.

Local logs are `/tmp/venfour-preflight-{backend,dispatch,report-variants,frontend,typecheck,build,earnings}.log`. SQL results and exact suite names are in `/tmp/venfour-preflight-db-clean/database-test-results.json`; suite 057's final result is in `/tmp/venfour-preflight-db-authority/database-test-results.json`. Preservation results and migration hashes are in `/tmp/venfour-preflight-migrations/`. These temporary files are machine-local evidence, not committed durable release artifacts. Archive the non-secret evidence before an authorized release.

## Template-5 qualification: what passed and what did not

[nationwide_product.py](../../venfour/nationwide_product.py) selects **Total-Loss Valuation Report**, template/renderer **5**, product configuration version **2026-09-22.1**. Existing templates remain supported.

| Required property | Observed evidence |
| --- | --- |
| Vehicle, insurer value, comparables, calculations and supported conclusion | Five variants retain the complete corresponding template-4 fields and immutable lineage. The PDF displays asking-price statistics, not a newly invented point ACV or guaranteed settlement. |
| Methodology and limitations | Visible historical/current distinction, no independent dollar adjustments, no inspection, advertised prices distinguished from completed sales; no change to deterministic methodology. |
| State/settlement treatment | Separate location page; four unresolved components: sales tax, title, registration transfer, replacement credit. No tax/fee amount added. Conflicting sources remain visible; no state is selected over another. Unknown/third-party variants validate. |
| Scope and terminology | Default title is correct; no formal appraisal title. The explicit statement that this is not an independent appraisal remains. Customer controls all insurer communications; no promise of representation or negotiation. |
| Layout and rendering | All nine representative pages are legible, with repeated table headers, readable values, page numbering and unclipped context/qualification text. Fonts present, no replacement glyphs; representative grayscale table remains readable. |
| Links and replay | Links have HTTPS destinations without credential-bearing query text; external listing availability was not requested or tested. Object/serialized input produces identical PDF bytes for all five variants. |
| Release qualification | **Incomplete.** Local content/visual validation does not establish provider-backed release qualification for template 5. |

The three samples are in `/tmp/venfour-preflight-pdf/`, rendered with the existing `scripts/preview_valuation_review.py` helper from synthetic fixtures under the offline guard. No customer documents were used. SHA-256:

| PDF | Digest |
| --- | --- |
| `fictional-supportable.pdf` | `0b6567229363373705037c94165d7bc6a84e85346402c4bd980e690eeae63d38` |
| `fictional-no-support.pdf` | `a7d22bd90e8020b1cb3f7e0f2483eb2eb7042c0dce065814cfb2f624fd5d33d5` |
| `fictional-conflicting.pdf` | `41d85a06eb3459a64515edba4666be98bb8c9b498cc979dbb556e63a873ea2a7` |

The existing process is [report_review_provider_eval.py](../../tests/report_review_provider_eval.py), not successful PDF generation alone. Its `SyntheticReportReviewEvalMaterializer` currently constructs template 4. Review prompt version 4 describes templates 2–4. [report-review-eval-attestation-v1.json](../../config/report-review-eval-attestation-v1.json) is an existing genuine 20/20 provider evaluation from September 16, for model `gpt-5.6-sol`, prompt 4, schema 1 and suite digest `e21eddff7a987662ac6bbfcdefd314ce77f56b1391f3c7f14da5dfc0602a2f24`. That artifact has not been relabeled or replaced. Its acceptance by the current gate does not prove that the evaluation exercised the new location/settlement section.

Smallest remaining qualification step: extend the existing materializer and human-labeled suite to cover template 5 and its adverse state-context cases, retaining existing required/adversarial expectations; align the review rubric and version/digest pins; run the existing genuine evaluation process with an explicitly authorized budget; archive all case results and update the artifact only when the complete suite passes. The existing command is `.venv/bin/python -m tests.report_review_provider_eval`; **running it unchanged would still evaluate template 4**. This task did not run that paid command. Do not replace its artifact with a mocked success, disable the release gate, or use staff release to evade this missing format qualification.

## Initial hosted audit: verified versus unverified

Read-only deployment metadata, read-only SQL transaction/catalog queries, static asset reads and health/readiness GETs were used. No customer records or stored documents were inspected. Secret bindings/names were recorded without values.

| Area | Verified September 23 | Remaining verification / implication |
| --- | --- | --- |
| Production application Worker | Version `66b01f33-3bdb-41dd-aae1-b26751f584f6`, 100% traffic, deployed September 18; `ASSETS` and secret `API_PROXY_SECRET` bindings present. API origin `https://venfour-api-production-usmgwdpgqq-uk.a.run.app`. | Source Git SHA/build-time flags are not exposed by this version metadata. Static asset `index-j8d9KfAL.js` lacks the new product references and predates implementation; this is the pre-feature bundle. A Worker ETag is not a source revision. |
| Staging application Worker | Version `69d628cf-0aed-4a9d-9872-36b5d369411c`, 100%, September 14. Proxy secret and assets present. | Its actual API origin is `https://checkout-disabled---venfour-api-staging-usmgwdpgqq-uk.a.run.app`, different from checked-in staging configuration. Establish why that tag is selected; do not silently overwrite an intentional checkout restriction. |
| Public Worker and domains | Public version `a71a8f0c-a92a-4584-8fff-f17c4fc23916`, 100%, September 18. `venfour.com`, app and partner hosts return 200; `www` redirects 308 to canonical site. Staging returns a Cloudflare Access redirect. | Owner must verify authenticated customer/staff routes, Auth return URLs and Turnstile. No browser sign-in or email was triggered. |
| Backend liveness/readiness | Production `/health` 200; direct production `/ready` 200 `ready`. Actual staging-tag `/ready` **503 `not_ready`**. | Cloud Run serving revisions/images/source revisions, traffic/tag map, environment values and secret version bindings are unverified: gcloud requires reauthentication. Readiness alone does not prove payment, provider or end-to-end processing. |
| Database project and migrations | Supabase `bjvsgaqitehtwasugvla`, Venfour, us-east-1, healthy, PostgreSQL 17.6. Production asset points to this project. **84 migrations**, latest `20260917000100`; four pending below. | Current staging project binding is unverified. Historical deployment used the same project, so do not run synthetic writes/reset against staging until isolation is proven. Stored migration checksums/full hosted schema equivalence were not established. No unexpected version or destructive mismatch was demonstrated. |
| RPC/schema | Existing checkout authorization, payment fulfillment, due-work reservation and staff payment approval RPCs present. New foundation/hold/authority/product schema/RPCs absent. | Current backend code requires the pending migration chain even with product presentation off. Metadata presence does not prove every grant or authenticated invocation. |
| Storage/RLS | `case-files` and `case-deliverables` private, 50 MiB; `partner-agreements` private, 10 MiB. RLS enabled on six inspected commerce/payment/webhook/report/work/payment-setting tables. | Local RLS tests pass; real owner/nonowner download authorization and signed URL behavior still need an isolated hosted smoke. No objects were read. |
| Paid admission | `total_loss_payment_approval_settings.manual_approval_required=false`. | A one-case pilot needs an owner-selected admission plan. Existing staff approval can contain new paid checkout after an authorized setting change; it does not contain free previews, revoke prior sessions or approve service scope. |
| Stripe | CLI context is **New business sandbox**, not the intended live account. Read-only sandbox metadata lists two $1 QA prices (one active, one inactive) and zero webhook endpoints. | `--live` was refused by the sandbox context. This does not prove production is mispriced. Neither environment's actual backend Stripe mode, live $199 price, webhook, version pins or secret equality was verified. This accessible sandbox is not currently a $199 rehearsal setup. |
| Providers | Repository budgets/model requirements and offline failure handling verified. | Hosted MarketCheck and model credential presence, actual approved models, entitlement/radius, quota period/remaining usage and billing settings unverified. No provider endpoint called. |
| Background processing | Database cron has active preview-email and insurer-response dispatch (each minute), active partner dispatch and daily cleanup; communications cron inactive. Corresponding eight Vault setting names exist. | Actual Vault values/destination equality were not read. Cloud Tasks existence/state/routing/OIDC/IAM/retries/backlog, Cloud Scheduler paid recovery and worker revision are unverified. Cron presence does not prove successful work or email delivery. No recovery endpoint was invoked. |
| Email/support | Shared communications schedule is disabled; repository defaults keep that delivery system disabled. | Current Auth SMTP, sender/support inbox, shared/partner transport credentials and dispatcher equality unverified. Normal Auth/recovery delivery must work before the customer depends on it; optional lifecycle/partner mail need not be activated for a directly recruited supervised case. |

Sanitized local evidence: `/tmp/venfour-preflight-hosted.json`, `-worker-versions.json`, `-supabase-metadata.json`, `-http.json`, `-read-checks.json`, `-stripe-sandbox.json`. The early generic Stripe error label in `-read-checks.json` is superseded by the explicit sandbox-context finding above.

### Exact access steps for the owner

1. Run `gcloud auth login` for the existing authorized account, then repeat read-only `gcloud run services describe venfour-api-production --project venfour-prod --region us-east4 --format=json` and the equivalent `venfour-api-staging` command. Inspect environment **names/presence**, approved non-secret settings, service image/revision and traffic; never paste secret values into a report. Retrieve queue/scheduler metadata only after deriving their names from that service configuration.
2. Run `stripe switch context` and select the intended Venfour account. If unavailable, obtain access/authenticate with `stripe login`; do not create an unrelated account. Then use read-only `stripe prices list --live --limit 100` and `stripe webhook_endpoints list --live --limit 100`, or direct retrieval of the backend's configured price ID. Verify pagination if necessary, live/test identity, active USD 19900 price/product, expected events and endpoint; never print signing secrets. Separately select an appropriate test account for later authorized sandbox rehearsal.
3. Cloudflare/Supabase access already works. Repeat `frontend/node_modules/.bin/wrangler --cwd frontend deployments list --env production --json` (and staging), then inspect the selected current version. Repeat the read-only migration/catalog query with `frontend/node_modules/.bin/supabase db query --linked --project-ref bjvsgaqitehtwasugvla --file <read-only-metadata.sql> --output json`. Never substitute `db push`, reset or a deployment command for inspection. See [Wrangler command reference](https://developers.cloudflare.com/workers/wrangler/commands/).

## Ordered migration plan — not executed on hosted infrastructure

There are **four**, not three, pending migration files spanning the requested components. They are the exact difference between the hosted 84-version ledger and the repository's 88 files:

| Order | Migration | Compatibility and prerequisite |
| --- | --- | --- |
| 1 | `20260922000000_jurisdiction_foundation.sql` | Adds immutable fact/decision tables, RLS and RPCs. Existing reports unaffected. |
| 2 | `20260922000100_paid_delivery_holds.sql` | Depends on foundation; adds durable holds/fences around existing work and new artifacts. Existing unenrolled cases retain the legacy path. Installs triggers, so it is more than passive tables. |
| 3 | `20260922000200_jurisdiction_trusted_authority.sql` | Depends on holds; adds restricted empty authority infrastructure and signed publication functions. Requires extension/role-creation privileges; inspect PostgreSQL 17 creator memberships afterward. No approvals/enrollment/key provisioning is required for the generic product pilot. |
| 4 | `20260923000000_nationwide_product_context.sql` | Depends on fact/hold schema; adds owner/staff product-fact reads and immutable report-context capture/fencing. Install before the current backend, including when its product flag is false. |

All four preserve existing business records and have no destructive data reset. Installing in order before compatible application deployment is supported by the isolated preservation/legacy tests. That is **conditional migration readiness**, not a hosted execution guarantee: obtain a current backup, verify restore/recovery ownership and extension/role privileges, inspect in-flight work, then apply only still-missing versions under a separately authorized release. Historical reports must remain readable. Do not drop these tables or reverse immutable history as rollback. No migration itself approves service or enables enforcement.

## Feature/configuration activation map

This table preserves the **initial preflight snapshot**. The dated hosted follow-up below supersedes its unknown hosted values. Defaults were never treated as verified deployment values.

| Setting | Default / currently observed | Required pilot selection and dependency | Rollback and delivery impact |
| --- | --- | --- | --- |
| `VENFOUR_NATIONWIDE_PRODUCT` | Backend default `false`; hosted unknown | `true` only after schema, template-5 qualification and compatible API/workers. Enables product endpoints and immutable context capture/new template. | Redeploy/restart API and workers with `false` after managing in-flight template-5 work; preserve readers/history. |
| `VITE_NATIONWIDE_PRODUCT` | Frontend build default `false`; deployed app predates feature, exact build value unknown | Build with `true` after backend endpoint is ready. Enables customer/staff fact panels and required successful fact-save continuation. | Rebuild/deploy compatible frontend with `false` first. Runtime Worker variable changes do not change the bundle. |
| `VENFOUR_JURISDICTION_MODE` | `off`; hosted unknown | Keep `off`, or previously selected `shadow` for observation. There is no supported enforce mode. | Keep supported off/shadow setting; process restart for changes. Never use this as a paid-admission switch or legal permission. |
| `VENFOUR_ENABLE_LEGACY_ANALYSIS_API` | Disabled; Docker pins `0`; hosted unknown | `0` on hosted customer runtime. | Keep `0`; backend redeploy required. |
| `OPENAI_REPORT_RELEASE_GATE_ENABLED` | `false`; hosted unknown | Valid enabled `true` configuration with genuine qualification and matching model/prompt/schema/suite pins. Required by private paid recovery as well as automatic release. | **Do not disable to get a report through.** Stop admission/use compatible qualified revision; preserve review and refund recovery. |
| `OPENAI_REPORT_REVIEW_MODEL`, `OPENAI_REPORT_REVIEW_APPROVED_MODEL`, `OPENAI_REPORT_REVIEW_APPROVED_PROMPT_VERSION`, `OPENAI_REPORT_REVIEW_APPROVED_SCHEMA_VERSION`, `OPENAI_REPORT_REVIEW_APPROVED_EVAL_SUITE_DIGEST` | Model absent by default; example prompt 4/schema 1; hosted unknown | Exact genuinely evaluated combination and packaged artifact, including new-format qualification. | Roll back code/artifact/pins together to a compatible qualified release; backend redeploy. |
| `OPENAI_INSURER_RESPONSE_ANALYSIS_MODEL` and `OPENAI_API_KEY` presence | No usable default; hosted unknown | Explicit model and credential; full-flow readiness, uploaded response analysis and report review depend on them. | Preserve working configuration; no mock fallback; backend restart for binding changes. |
| `manual_approval_required` in payment settings | **Hosted false** | Recommended `true` for one supervised new paid case, only after owner authorizes impact; exact-lineage staff approval and no self-approval. | DB setting, no rebuild. Keep controlled admission during incident; don't automatically restore broad admission on rollback. |
| `VENFOUR_PACKAGE_TASKS_{PROJECT,LOCATION,QUEUE,OIDC_SERVICE_ACCOUNT,OIDC_AUDIENCE}`, `VENFOUR_PACKAGE_WORKER_ORIGIN` | Unset/dormant default; hosted unknown | Existing queue running, private worker target/audience/IAM coherent, recovery scheduler verified. Same contract supplies response dispatch. | Preserve compatible workers and financial recovery. Backend redeploy for env changes; queue changes separate. |
| `VENFOUR_INSURER_RESPONSE_DISPATCH_SECRET`, `VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET` | No default; matching Vault names present, value equality unknown | Match authorized dispatcher configuration; don't print secrets. | Preserve working old/new revision compatibility; backend restart if changed. |
| `VENFOUR_EMAIL_PROVIDER`, `VENFOUR_EMAIL_MODE`, `VENFOUR_AUTH_EMAIL_HOOK_ENABLED` | `disabled`, `disabled`, `0`; hosted unknown, communications cron inactive | Preserve functioning Supabase Auth/recovery transport. Shared lifecycle/partner mail is not required for this direct pilot; no Auth cutover needed. | Leave optional system disabled; backend restart if selected settings change. Do not remove established Auth SMTP. |
| Stripe price/mode/version/origin settings | No usable commerce default; source pins USD 19900; hosted unknown | Coherent keys, signed webhook, active $199 USD price, product/terms/refund versions and `VENFOUR_PUBLIC_APP_ORIGIN`. | Preserve reconciliation/refunds when pausing delivery. Never lower price to make a smoke pass. |
| Local fixture/full-flow/checkout shortcuts | Hosted must be unset, including `VENFOUR_LOCAL_FULL_FLOW` and `VENFOUR_LOCAL_STRIPE_CHECKOUT` | Never use local synthetic paths to authorize a real purchase. | Keep absent. |

Both product flags false preserve the old presentation path. Frontend true/backend false blocks fact saves; backend true/frontend false can produce missing-context reports. Stop new admission during the short ordered transition. A pilot also requires matching Supabase/Auth, same-origin frontend API configuration, Turnstile and customer/staff host boundaries. Product flags grant none of those prerequisites.

## Provider and payment readiness

### Provider/cost contract

- MarketCheck supplies active/historical inventory, VIN history and bounded enrichment/vehicle terms. The durable per-case ceiling is **60 physical attempts**, including retries; phase limits are supporting 5, supporting discovery 2, active discovery 8, historical discovery 8, history 40, enrichment 9, vehicle terms 2, and three history attempts per VIN. They are subordinate limits, not additive allowances. Monthly reserve is 20%; optimization target 20–30 is not a spending minimum.
- Geography is local-first (100-mile local radius, 250-mile outer boundary, up to four additional centers), constrained by the independently verified account radius. Current listings and loss-date historical evidence remain separate. Missing historical proof is not replaced with present asking prices or guessed sales.
- Verified account ID, rate window, monthly allowance, period start/end, starting usage and radius are required; metered billing does not bypass quota accounting. Unknown/stale allowance or exhausted budget fails closed. Rate-limit retries consume attempts; bounded cooldown waits do not justify unbounded retries or resetting the ledger. Saved evidence can be reused; an operator cannot manufacture missing evidence or refill the case budget to force checkout.
- Document extraction uses the existing configured provider and `gpt-5.6-sol`; review and insurer-response interpretation have explicit model contracts. The extraction input cap is 50 MiB. Report review uses a 90-second timeout, zero SDK retries and a 16,000-output-token cap; report work permits at most three attempts before its terminal/manual-review handling. Response dispatch has durable job identity and bounded recovery; verify deployed task retry settings rather than assuming defaults.
- Request limits are **not a verified dollar cap**. Hosted account balance/tariff/usage, model limits and selected model prices remain unverified. Before the real case, owner sets a spending ceiling and confirms available quota without a provider inference. A genuine format qualification run needs its own budget (the existing 20-case evaluation permits up to three operational attempts per case).
- Provider outage means retain the case/evidence, surface retry/review/failure state and use existing recovery within limits. The private `/internal/v1/paid-work/reconcile` path and staff remediation must be accessible to the operator through existing authorization. Never use `/health` as recovery proof or bypass quality checks. Reconcile/refund if delivery cannot be completed under existing rights.

Sources: [market_request_budget.py](../../venfour/market_request_budget.py), [search_geography.py](../../venfour/search_geography.py), [full_review_processing.py](../../venfour/full_review_processing.py), [report_processing.py](../../venfour/report_processing.py), [insurer_response_processing.py](../../venfour/insurer_response_processing.py).

### Payment and refund contract

| Boundary | Existing path and preflight conclusion |
| --- | --- |
| Price and eligibility | Canonical **$199 / USD 19900**; strict insurer report, owner, immutable evidence lineage, sufficient evidence and supported discrepancy remain prerequisites. Staff approval applies if configured. No price or eligibility bypass added. |
| Checkout | `GET /api/v1/appraisal-cases/{case_id}/checkout-quote`, `POST .../checkout-sessions`, `POST .../checkout-reconciliation`; backend [commerce.py](../../venfour/commerce.py) and SQL own the decision. Browser return alone is not payment authority. |
| Signed payment | `POST /webhooks/stripe`: validate signature/mode/amount/identity; claim event idempotently; record payment and entitlement; enqueue eligible package work. Duplicate events/reconciliation cannot duplicate entitlement or delivery. A hold does not discard a valid payment event. |
| Automatic no-support refund | Existing report-processing path requests the canonical full refund when completed review does not support a dispute, with retained completed-report access. Strict pre-checkout no-support cases should not purchase in the first place. |
| Manual outcome refund | Customer requests through the existing support/contact path and supplies the published final-outcome evidence. Authorized financial operation is `TotalLossCommerceService.refund(case_id, order_id, actor_user_id, request_key, reason_code, access_policy)` and its durable reserve/result RPCs. This is a service operation, **not a general staff refund-button UI**. Owner must demonstrate the intended authorized operator procedure in the correct sandbox before taking money; no new UI is needed to establish that procedure. |
| Held-delivery cancellation | Existing staff `POST /api/v1/staff/paid-delivery-holds/{case_id}/resolve`, `action=cancel_refund`, stable `requestId`; cancels fulfillment, reserves canonical refund with retained access, retries the same identity after interruption. Separate operator authorization is required; ordinary staff membership alone is insufficient. Ambiguous/multiple payments produce `support_required`, not an arbitrary refund. This is not a reason to enroll the live pilot in the dormant authority mechanism. |
| Failure/history | Pending/failed refunds remain durable and reconcilable; event/accounting history and customer access are retained according to the existing access policy. Refunds are not blocked by new-delivery authorization. Keep webhooks and financial recovery available during rollback. |

Local commerce, release, hold, recovery, customer-delivery and financial SQL tests cover duplicates, held work, no-support, refund failures and retained access. They do not prove live Stripe wiring. The exact-$1,000 policy gap, acknowledgment dates and commission thresholds are unchanged and are not newly demonstrated execution blockers.

## Future controlled-pilot deployment order — document only

1. Restore Cloud Run and correct Stripe-account access; complete the unverified metadata checks above. Establish actual staging/database/payment isolation. Diagnose the selected staging tag's 503 before treating staging as a rehearsal environment.
2. Name the founder/operator and directly recruited customer; resolve the external operating-scope decision. Prefer a personal first-party Missouri case with genuinely consistent facts. Do not represent that preference as legal approval. Exclude commissioned referral onboarding from this first case.
3. Complete template-5 qualification using the existing genuine evaluation process and reviewed pins/artifact. Recheck the tested release commit and archive evidence. This precedes accepting money or activating the new report for customers.
4. Obtain current backup/restore evidence; inventory existing orders, sessions and in-flight work with authorized privacy-preserving operational checks. Select compatible rollback revisions that can read template 5. Stop new pilot admission while leaving webhooks/history/refunds functioning.
5. Apply only the four still-pending migrations in the exact order above under separate authorization. Confirm ledger, RPC grants/RLS, immutable capture and empty operating authority. Inspect creator-role membership using the actual hosted installer identity; remediate only under the deployment authorization. Do not install keys, enroll live cases or turn on enforcement.
6. Deploy compatible backend/API and private workers with `VENFOUR_NATIONWIDE_PRODUCT=false`; preserve provider, Stripe, qualified release, OIDC and recovery configuration. Verify schema/readiness and that old customer history remains available.
7. Build/deploy compatible application frontend with `VITE_NATIONWIDE_PRODUCT=false`, validated environment/origin/host settings. No public availability campaign or public-site deployment is needed.
8. Verify actual queue running state, target revision, OIDC/IAM, retry settings and paid-work recovery schedule. Verify support access, working Auth/recovery delivery, provider quotas and the authorized refund procedure. A running cron row is insufficient.
9. Under separate authorization, rehearse the complete synthetic hosted journey in a genuinely isolated environment with the correct $199 Stripe **test** configuration. Verify duplicate signed events, return-before-webhook, no-support/refund and response processing without live financial effects. This task did not perform that rehearsal or provider calls.
10. Select the one-case admission plan, preferably existing exact-lineage staff payment approval, after accounting for existing users/sessions. Product flags are not an admission control.
11. Enable backend product flag on the compatible API/worker revisions; confirm owned fact endpoints. Then rebuild/deploy frontend with its flag true. Keep admission stopped between these steps. Keep jurisdiction mode off/shadow; no enforcement or appraisal terminology.
12. Confirm owner/nonowner access, facts persistence, private report download and release/response prerequisites in the isolated acceptance environment. Record a go/no-go decision; only then admit the selected real customer and authorize the single voluntary $199 purchase through normal checkout.
13. Supervise each transition below. Monitor case/work/event identifiers, queue age, failed/retryable jobs, release holds, payments versus entitlements, pending refunds and provider budget consumption. Use private logs and current serving revisions; do not record claim contents in public logs.
14. Stop new admission on unexplained charges, wrong-owner access, evidence/identity mismatch, misleading output, broken response processing or unrecoverable work. Preserve financial reconciliation and apply the rollback below. Admit no second case until the first outcome and failures are reviewed.

## One-customer founder runbook

**Order correction:** the strict workflow obtains eligible saved market evidence **before checkout**. Full/paid preparation reuses it; the strict path expects `newProviderRequests == 0`. Step 9 below is evidence loading/revalidation, not authorization for a second paid market search. Do not force a weak/no-support case through this itinerary.

| Step | Expected state / operator check | Failure signal | Recovery and proceed/stop rule |
| --- | --- | --- | --- |
| 1. Begin intake | One correctly owned/claimable case; personal total-loss service | Duplicate/wrong-owner case, unavailable Auth | Resolve access through existing recovery; **stop** until ownership verified. |
| 2. State/claim facts | Six fact fields saved at confirmed revision; actual Missouri facts and claim type | Save error, unknown/conflicting material facts | Correct from customer/document evidence, retaining provenance; **stop first-pilot admission** while unresolved; never infer governing law from ZIP. |
| 3. Insurer report | Genuine insurer valuation PDF uploaded privately, accepted and bound to the case | Wrong document, failed extraction, mismatched vehicle | Re-upload/correct through existing workflow; **stop** before payment. |
| 4. Readiness/evidence | Preliminary result clearly preliminary; saved historical/current evidence and strict full-review eligibility | Weak/conflicting evidence, missing source identity, no support, budget exhausted | Explain result and follow existing no-support/review path; **proceed only** on genuine eligibility. No new search merely to force a positive result. |
| 5. Checkout | Backend quote $199 USD with current lineage; staff approval if selected | Wrong amount, stale lineage, unauthorized or unavailable quote | Resolve exact config/evidence problem; **stop**, do not bypass DB gates. |
| 6. Pay | Customer voluntarily completes normal Stripe purchase for the one case | Cancellation, provider error, uncertain result | Reconcile existing session first; **no second purchase** to investigate uncertainty. |
| 7. Webhook | Signed event recorded once; payment, entitlement and correct work linkage | Paid browser return but unreconciled order; webhook failure | Inspect event/attempt identifiers and use existing reconciliation; **stop new payment**, preserve event even if held. |
| 8. Paid processing | Correct immutable package work claimed; queue/recovery functioning | Queued indefinitely, retry exhaustion, hold | Authorized recovery/remediation within limits; **stop release**, never manually set paid/delivered status. |
| 9. Reuse market evidence | Frozen saved evidence loaded; no extra market requests in strict preparation | Changed digest, new provider request, missing snapshot | Restore correct lineage or use review/failure path; **stop** until reconciled, no budget reset. |
| 10. Generate report | Immutable template-5 PDF and context; correct vehicle/value/comparables | PDF/validation/storage failure, wrong facts | Existing bounded retry or new reviewed version as appropriate; **stop release**, preserve prior versions. |
| 11. Release checks | Deterministic/PDF/reviewer/qualification gates pass for this exact artifact | Unsupported conclusion, identity drift, qualification mismatch | Staff remediation within existing controls; **stop**. Never waive required qualification or rewrite saved evidence. |
| 12. Deliver report | Customer can privately download Total-Loss Valuation Report; receipts/history intact | Wrong-owner access, missing file, held release | Stop admission on access failure; recover storage/delivery safely. **Proceed** only after actual owner access verified. |
| 13. Reconsideration draft | Customer sees concise evidence-grounded draft tied to released report | Unsupported promise, wrong version, no-support case | Use existing review/remediation; **do not send** unsupported draft. No-support follows existing refund path. |
| 14. Customer sends | Customer reviews and independently sends to insurer | Request for Venfour negotiation/representation | Clarify approved operational scope; **stop expanded activity**. No insurer email transport is implied. |
| 15. Record insurer response | Customer uploads actual response linked to current round | Wrong round/document or upload failure | Correct through response intake; **proceed only** with retained source and lineage. |
| 16. Analyze response | Durable response-analysis job completes with configured model and saved result | Model/queue error, malformed or unsupported result | Bounded retry/authorized recovery; **stop recommendations** until valid analysis. |
| 17. Follow-up if appropriate | Existing deterministic decision and customer-controlled draft; otherwise truthful no-follow-up state | Invented demands, stale evidence, draft-generation failure | Review/correct through existing workflow; **send nothing automatically**; proceed only if supported. |
| 18. Record final outcome | Actual documented insurer outcome/customer confirmation; immutable history | Missing proof, conflicting amount/status | Ask for evidence through ordinary support; **stop outcome-dependent financial decisions**, do not fabricate success. |
| 19. Refund if applicable | No-support automatic refund or documented manual request; canonical reservation/result and retained access | Pending/failed/ambiguous refund, missing support access | Operator uses existing refund/recovery procedure and verifies final accounting. **Stop further admission** until the obligation is handled; preserve exact-$1,000 policy gap for separate decision. |

## Rollback and non-blocking scope

Stop admission first. Keep Stripe webhook/reconciliation, receipts, historical downloads, refund rights and compatible recovery workers online. Rebuild/redeploy the compatible frontend with its product flag false, manage or drain in-flight template-5 work, then disable backend product capture on compatible code. Do not roll back to code incapable of reading saved template-5 reports. Preserve all migrations, immutable facts, reports, entitlements, attribution and accounting. Keep valid release configuration; disabling it is not a delivery bypass. Review/refund affected paid cases through the existing paths before resuming admission.

Optional state tax/fee refinements, special methodology/terminology overrides and formal appraisal-label support do not block this generic report while its limits remain truthful. Acknowledgment/version dates, broader policy wording and the exact-$1,000 refund/commission gap remain separate cleanup items. They were not changed. An actual external restriction on the specific pilot activity must be resolved by the owner; the 51-state research backlog is not 51 technical launch blockers.

## Hosted audit follow-up — September 23, 2026 (UTC)

**This section supersedes the initial hosted-unknown entries above.** Audit checkout: `d155c5a`. The prior local suites were not repeated; this follow-up changes only this document. Production configuration is substantially verified, but the new product remains undeployed and template-5 qualification is still incomplete. No real payment is authorized by this audit.

### Access and deployed identity

The owner completed Google reauthentication and authorized the existing Stripe account contexts. Active GCP identity is `zafar@venfour.com`; project `venfour-prod`, display name Venfour, number `640078527158`, state ACTIVE. No project switch, new service account, IAM grant or API enablement was performed. Stripe now exposes the existing Venfour LLC live account `acct_1U8ownCJhANXFiZn` and its sandboxes. The normal context selector was used for metadata reads and left on that live account. These were requested local authentication/context changes, not hosted configuration changes.

| Surface | Current serving identity and routing |
| --- | --- |
| Production API | `venfour-api-production`, `us-east4`; **100%** service traffic to `venfour-api-production-admin-release-20260917`. Image `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:c97acb85fbbbcf58949aaa565d3517f7e0c5fef9cc4045d5ee583fda96c84b80`. |
| Staging API service URL | `venfour-api-staging`, `us-east4`; **100%** untagged service traffic to `venfour-api-staging-turnstile-20260914-1829`. Image digest `sha256:d3a6e8a9f472527a91e575bf8a0b50409f1580d1254a0b7d684cc86cec1ac7c2` in the same repository. |
| Actual staging frontend target | Worker points to the **checkout-disabled tag**, which resolves to `venfour-api-staging-checkout-expiry-20260914-1612`, using that same staging image. Tag-specific requests reach it despite its 0% share of untagged service traffic. Queue work instead targets the untagged staging service; these are different revisions. |
| Production frontend | Worker `66b01f33-3bdb-41dd-aae1-b26751f584f6`, 100%; API origin `https://venfour-api-production-usmgwdpgqq-uk.a.run.app`. Proxy-secret binding present. |
| Staging frontend | Worker `69d628cf-0aed-4a9d-9872-36b5d369411c`, 100%; API origin `https://checkout-disabled---venfour-api-staging-usmgwdpgqq-uk.a.run.app`. Access protection remains. |
| Public site | Worker `a71a8f0c-a92a-4584-8fff-f17c4fc23916`, 100%; unchanged by this task. |

Both Cloud Run services have concurrency **1**, **900-second** request timeout, **1 CPU / 512 MiB**, service/revision maximum **1 instance**, no explicit positive minimum, request-billed CPU throttling and gen2 execution. Startup probe: `/health`, 5-second period, 2-second timeout, 12 failures. Liveness: `/health`, 30-second period, 2-second timeout, 3 failures, 10-second initial delay. There is no platform probe for the application's `/ready` contract. Ingress is `all`, and platform invoker-IAM checks are disabled; application proxy/OIDC checks remain the relevant boundaries. This was observed, not changed.

Production runtime service account is `venfour-api-production@venfour-prod.iam.gserviceaccount.com`; staging uses `venfour-api-staging@venfour-prod.iam.gserviceaccount.com`. Existing older tagged revisions remain addressable; a 100% traffic split does not delete them. The audit inspected both the staging tag actually used by its frontend and the revision used by its untagged worker target.

Cloud Build `2b340dca-c890-43a2-b908-5aab444a1d78` succeeded on September 18 and produced the exact production digest above. Its resolved source is the uploaded archive `venfour-prod_cloudbuild/source/1789700091.832456-b3a302556c094d2c86f37141959307af.tgz`, generation `1789700092868122`; no resolved Git commit was supplied. Staging build `190b245a-b299-46e1-b0c3-2d363c0e185b` (global build region) succeeded September 14 and produced the staging digest from `venfour-prod_cloudbuild/source/1789402211.981542-42a6ff8f737b4aa7955e2a470a932142.tgz`, generation `1789402213023664`, also without a resolved Git commit. Artifact Registry confirms both image digests. Additional Container Analysis provenance was unavailable because that API is not enabled; it was not enabled for this review. Thus the deployed image identity is verified, but an exact Git-tree equivalence is not claimed. These deployments predate nationwide product commit `e5b54b6` and current checked-out release `d155c5a`; they are not evidence that the new format or flags are deployed. Record the future release's source commit and image digest together.

### Staging 503: configuration cause, not a generic product defect

Fresh direct probes: production `/health` and `/ready` **200**; actual checkout-disabled staging tag `/health` **200**, `/ready` **503**, body `{"status":"not_ready"}`. Untagged staging `/ready` also returns **503**; its first health probe timed out and was not treated as a successful liveness check.

**Classification: missing provider readiness.** Both inspected staging revisions omit `MARKETCHECK_API_KEY` entirely. The existing default customer-runtime readiness contract requires both document/model and market-provider credentials. The non-secret market configuration itself passes the current pure local configuration validator; the missing credential is a concrete sufficient cause of the not-ready state. It is a missing binding, not a demonstrated provider outage. The `checkout-disabled` tag suggests deliberate prior containment, but a tag name alone does not prove the operator's intent.

Staging also has no configured report-release gate/model approval pins and no preview-dispatch secret. Its customer tag uses Turnstile secret version 1 while the untagged worker revision uses version 2; both versions currently remain enabled. Do not call that version difference a proven defect without checking the intended widget/binding. Adding one market key would not establish a ready pilot environment.

Both environments reference **the same Supabase URL and service credentials**, and the same declared MarketCheck account identity. Staging declares 200 prior monthly attempts while production and the durable account row declare 4. Activating staging market requests could raise the shared ledger's prior-use floor and subsequently make production's lower declaration fail `MARKET_ACCOUNT_CONFIGURATION_CHANGED`. Do not activate this staging configuration against production data. Choose a genuinely isolated rehearsal target or explicitly reconcile all shared-account settings in a later authorized configuration task.

### Environment flags, names and secret references

| Setting | Production | Staging tag and current worker revision | Meaning |
| --- | --- | --- | --- |
| `VENFOUR_NATIONWIDE_PRODUCT` | Absent | Absent | Older deployed code; new-code default is false. No nationwide activation verified. |
| `VITE_NATIONWIDE_PRODUCT` | No new-feature bundle deployed | No new-feature bundle deployed | Build-time value cannot be read as a Worker runtime flag. The unchanged Worker versions predate the feature. |
| `VENFOUR_JURISDICTION_MODE` | Absent | Absent | New-code default off; no enforcement is available or enabled. |
| `VENFOUR_ENABLE_LEGACY_ANALYSIS_API` | `0` | `0` | Legacy API disabled in inspected environment configuration. |
| `OPENAI_REPORT_RELEASE_GATE_ENABLED` | `true` | Absent | Production has the older genuine qualification contract; staging has no configured automatic-release approval. |
| `OPENAI_REPORT_REVIEW_MODEL` / `OPENAI_REPORT_REVIEW_APPROVED_MODEL` | Both `gpt-5.6-sol` | Absent | Exact review model pins present only in production. |
| Approved prompt/schema/suite | `4` / `1` / `e21eddff7a987662ac6bbfcdefd314ce77f56b1391f3c7f14da5dfc0602a2f24` | Absent | These are not template-5 qualification evidence. |
| `OPENAI_INSURER_RESPONSE_ANALYSIS_MODEL` | `gpt-5.6-sol` | `gpt-5.6-sol` | Response model is configured. No inference was made. |
| Shared mail flags | `VENFOUR_EMAIL_PROVIDER`, `VENFOUR_EMAIL_MODE`, `VENFOUR_AUTH_EMAIL_HOOK_ENABLED` absent | Absent | Shared lifecycle transport/Auth-hook cutover is not configured; do not infer that existing Supabase Auth mail is disabled. |
| Partner mail | `VENFOUR_PARTNER_EMAIL_PROVIDER=resend`, sender `Venfour <auth@venfour.com>`, reply-to `support@venfour.com` | Absent | Production's separate partner transport has a credential binding; this does not require partner onboarding in the pilot. |
| Manual payment approval | Database setting **false** | Same database | One-case admission still needs the owner's chosen operating control. |

All referenced versions below were read with **Secret Manager version-describe metadata**, never secret payload access. Every listed version was **ENABLED**. The table contains names/version numbers only.

| Environment variable | Production reference | Staging reference |
| --- | --- | --- |
| `SUPABASE_URL` | `venfour-supabase-url:1` | Same |
| `SUPABASE_PUBLISHABLE_KEY` | `venfour-supabase-publishable-key:1` | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | `venfour-supabase-service-role-key:1` | Same |
| `OPENAI_API_KEY` | `venfour-openai-api-key:1` | Same |
| `MARKETCHECK_API_KEY` | `venfour-marketcheck-api-key:1` | **Absent** |
| `STRIPE_SECRET_KEY` | `venfour-production-stripe-secret-key:1` | `venfour-staging-stripe-secret-key:1` |
| `STRIPE_PUBLISHABLE_KEY` | `venfour-production-stripe-publishable-key:1` | `venfour-staging-stripe-publishable-key:1` |
| `STRIPE_WEBHOOK_SECRET` | `venfour-production-stripe-webhook-secret:1` | `venfour-staging-stripe-webhook-secret:1` |
| `VENFOUR_STAGING_PROXY_SECRET` | `venfour-production-proxy-secret:1` | `venfour-staging-proxy-secret:1` |
| `VENFOUR_TURNSTILE_SECRET` | `venfour-turnstile-secret:2` | Tag `:1`; worker revision `:2` |
| `VENFOUR_CLAIM_RECOVERY_RATE_LIMIT_SECRET` | `venfour-claim-recovery-rate-limit-secret:1` | Same |
| `VENFOUR_INSURER_RESPONSE_DISPATCH_SECRET` | `venfour-production-insurer-response-dispatch-secret:1` | `venfour-insurer-response-dispatch-secret:1` |
| `VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET` | `venfour-production-preview-dispatch-secret:1` | Absent |
| `RESEND_API_KEY` | `venfour-resend-api-key:2` | Absent |
| `VENFOUR_PARTNER_EMAIL_DISPATCH_SECRET` | `venfour-partner-email-dispatch-secret:1` | Absent |

Other configured environment names are the `MARKETCHECK_ACCOUNT_*`, `MARKETCHECK_BUDGET_*`, `MARKETCHECK_SEARCH_*`, monthly/rate/quota/optimization settings described below; six `VENFOUR_PACKAGE_*` dispatch settings; `VENFOUR_TOTAL_LOSS_{STRIPE_PRICE_ID,EXPECTED_AMOUNT_MINOR_UNITS,EXPECTED_CURRENCY,PRODUCT_IDENTIFIER,PRODUCT_VERSION,TERMS_VERSION,REFUND_POLICY_VERSION}`; `VENFOUR_PUBLIC_APP_ORIGIN`; and `VENFOUR_PROVIDER_DIAGNOSTICS`. Production additionally has `VENFOUR_PARTNER_APP_ORIGIN` and the partner sender settings above. The complete exact name inventory is preserved in the sanitized backend evidence file. No hidden value was inferred from a secret's descriptive name.

### Migration delta and compatibility

Fresh hosted ledger: **84 versions**, latest `20260917000100`; repository: **88**. No unexpected hosted version was found. Exact future order:

| Order / filename | Purpose and dependency | Additive / compatibility | Required before this pilot's payment? |
| --- | --- | --- | --- |
| 1. `20260922000000_jurisdiction_foundation.sql` | Immutable facts/decisions and RPCs; base for the next three | Adds tables/RLS/functions; preserves existing records and legacy paths | **Yes**, for the intended current-code nationwide pilot. |
| 2. `20260922000100_paid_delivery_holds.sql` | Durable holds and checkout/work/artifact fences; depends on 1 | Adds tables/triggers/fences; unenrolled legacy cases retain their path | **Yes**; current backend calls its checks even with product presentation off. |
| 3. `20260922000200_jurisdiction_trusted_authority.sql` | Empty restricted authority infrastructure; depends on 1–2 | Adds no-login roles, schema/functions and signed publication rules, not permissions to operate | **Yes**, as part of the tested current-code migration chain; do not provision reviewers/keys or enroll the pilot. |
| 4. `20260923000000_nationwide_product_context.sql` | Frozen report facts, owner/staff reads and template-5 capture; depends on preceding chain | Adds private immutable capture/fences; no historical backfill | **Yes**, before template-5 generation/current backend composition. |

Install the ordered chain **before** deploying the compatible current backend. The old deployment can remain in service while the additive chain is installed under the documented backup/in-flight-work safeguards; the new backend must not arrive first. Frontend product activation follows both schema and backend. Installation does not have to be simultaneous with application deployment. This requirement describes the intended new pilot, not a claim that all existing legacy payments currently fail. Retain the PostgreSQL creator-role inspection prerequisite recorded in the local rehearsal. No hosted migration or compatibility trial was performed here.

### Stripe live configuration: verified, with a bounded runtime limit

The live account identifies Venfour, `https://venfour.com`, US/USD, **charges enabled**, **payouts enabled**, submitted details, no currently/past-due account requirements and no disabled reason. Card payments capability is active. This is the intended existing account, not the previously accessible $1 QA sandbox.

- Live price **`price_1UFeIkCJhANXFiZnfJ3samsb`** is active, **19900 USD**, **one_time**, `livemode=true`, lookup key `venfour_total_loss_live_199_usd_v1`.
- Its product **`prod_VGAezT4dwWbSxm`**, Venfour Total Loss Review, is active/live. A null product `default_price` does not block checkout because the backend explicitly pins the price ID.
- The actual production service pins that same price, amount **19900**, currency **USD**, product identifier `total_loss_advisory_package`, product version `product_sha256_250fe793edd567e4dbfd`, terms version `2026-08-23` and refund-policy version `fair_result_sha256_0b052f8876dd74b54e6e`. These historical policy pins were not rewritten.
- Live endpoint **`we_1UFeIlCJhANXFiZn65i1yaHI`** is enabled at **`https://app.venfour.com/webhooks/stripe`**, API version **`2026-07-29.dahlia`**. This matches the customer Worker path and its current production API origin.
- Its **12 subscriptions exactly equal** the current commerce code's supported events: four checkout events (`completed`, `async_payment_succeeded`, `async_payment_failed`, `expired`), three refund events (`created`, `updated`, `failed`), and five charge-dispute events (`created`, `updated`, `closed`, `funds_withdrawn`, `funds_reinstated`). No missing or extra subscription was found.
- Production binds the three production Stripe secret references listed above. Payloads/key prefixes/signing-secret equality were not read. Thus live price/account/endpoint/binding metadata is verified; a freshly exercised signed delivery and actual runtime key pairing are **not** claimed. No webhook test, Checkout Session or PaymentIntent was created.
- Signature verification, event claims, recorded transaction/entitlement, stable refund keys and duplicate recovery remain the existing Python/SQL contract. Stripe subscription configuration alone does not confer idempotency; the prior local tests establish that implementation behavior. Refund creation also depends on actual key permissions, available balance and provider response; charges/payouts-enabled flags alone do not prove a refund can complete. Demonstrate the existing operator procedure in an authorized sandbox, without changing customer refund rights.

The actual separate Venfour LLC sandbox **`acct_1U8owxCCn7Q3DY3e`** is now readable. Its active test price **`price_1UFUKrCCn7Q3DY3eiw4xCKzq`** is also one-time **19900 USD**, matching staging's configured ID. Its enabled test webhook **`we_1UFbONCCn7Q3DY3ew08BlZcs`** targets `https://staging.venfour.com/webhooks/stripe` with the same 12 events/API version. This corrects the earlier finding about the *other* $1-only sandbox. Test endpoint delivery through staging's Access/routing was not exercised; do not infer it works from an enabled endpoint row.

### Providers and one-case budget

Production has enabled model and MarketCheck credential references; response/review models are explicitly `gpt-5.6-sol`, and release gate/pins are configured as above. Missing credentials do not explain production readiness; they **do** explain staging readiness. Neither credential was used for a model/market request, so provider-side entitlement, billing balance, model access and remaining external quota were not verified.

| Non-secret configuration | Production | Staging |
| --- | --- | --- |
| Declared provider account | `venfour-prod:marketcheck:primary-subscription` | Same shared identity |
| Account radius / local / outer bound / extra centers | 100 / 100 / 250 miles / 4 | Same |
| Rate / period | 5 requests per 1 second; Sept 1 inclusive to Oct 1 exclusive, 2026 UTC | Same |
| Monthly allowance / prior usage / reserve | 500 / **4** / 20% | 500 / **200** / 20% |
| Case physical-attempt cap | **60** | **20** |
| Active / historical discovery; history; enrichment; terms | 8 / 8; 40; 9; 2 | 6 / 6; 12; 1; 1 |
| Supporting / supporting discovery / per-VIN history | 5 / 2 / 3 | 2 / 1 / 3 |
| Metered / tariff / evidence retention | `false`; no tariff or retention override configured | Same |

Both non-secret configurations pass `market_search_configuration_reason` for September 23 without contacting a provider. The durable hosted account row has the production declaration, **63 recorded attempts** in the current period, no quota-exhausted marker and only an expired September 14 cooldown. Configured admission headroom is `500 × 80% − 4 − 63 = 333` requests; one full 60-attempt case would leave **273** before the reserved 100. This is enough **under the recorded contract**, not a verified provider billing balance or assurance of sufficient evidence. Reconfirm the period/actual usage before admission, especially at October 1. Never reset existing usage to fund the pilot.

The pipeline retrieves market evidence before strict checkout and reuses the saved evidence for paid preparation. No extra paid search is authorized by collecting $199. Provider failure/exhaustion must retain evidence and follow bounded retry/review/refund handling, not invent a value. No new provider is required by nationwide presentation. Optional trim lookup and document extraction reuse the existing model provider; Stripe/Google/Supabase remain infrastructure dependencies.

### Queues, recovery and current work

| Component | Observed state and target | Limits / consequence |
| --- | --- | --- |
| Production queue `venfour-case-processing-production` | **RUNNING**, zero returned tasks; project `venfour-prod`, `us-east4` | 1 concurrent dispatch, 1/second, burst 10; maximum 5 attempts, min backoff 60s, max backoff 300s, max retry duration 300s, max doublings 16. |
| Staging queue `venfour-case-processing` | **RUNNING**, zero returned tasks; same region | 1 concurrent, 1/second, burst 10; maximum 5 attempts, 10s–300s backoff, max doublings 16; no explicit max-retry-duration returned. No queue needs resuming. |
| Task targets | Production worker origin/audience is its untagged service URL; staging uses its untagged service URL | Production reaches the current September 17 revision; staging reaches the September 14 Turnstile revision, not its frontend's checkout-disabled tag. |
| OIDC and access | Each queue uses its environment's runtime service account; matching `run.invoker` and self `iam.serviceAccountUser` grants exist. Google Tasks/Scheduler service-agent roles exist. | Production queue grants enqueuer **and viewer**, supporting create plus recovery `get_task`. Staging's direct queue grant is enqueuer only; no corresponding project grant appeared. Before using current recovery code there, verify effective task-read permission or grant only the needed permission in a later authorized change. No IAM changes made. |
| Paid recovery scheduler | `venfour-paid-work-recovery-production`, **ENABLED**, `*/5 * * * *`, UTC; POST to production `/internal/v1/paid-work/reconcile`, matching production OIDC identity/audience | 240s attempt deadline; five latest existing backend recovery records succeeded with `dispatcherConfigured=true`, zero reserved/dispatched/failed. Latest inspected run 05:45 UTC. No job was triggered by this audit. |
| Report/package execution | Hosted SQL leases for package, report generation and report review are **17 minutes**; dispatcher reservation is **5 minutes** | Current source task deadline 960s exceeds service timeout 900s but is below the lease. Report execution/review is bounded to three attempts; exhausted delivery goes to existing review/remediation, not silent deletion. |
| Insurer response | Active every-minute DB wake, model configured, same queue/OIDC contract; hosted response lease **30 minutes** | No response jobs currently present. Wake checks for due work before issuing HTTP; empty jobs explain the absence of recent dispatch HTTP logs. No provider execution proven. |
| Work backlog | Aggregate SQL returned no workflow or response-analysis jobs | There is no currently observed paid work to demonstrate end-to-end progression. Empty queues are not a delivery test. |

Vault origin comparisons returned true for the production service URL for preview, response and partner dispatch. Only comparison booleans were returned, never stored credential values. Their latest cron executions succeeded; shared communications remains inactive. Matching dispatch-secret names exist, but cross-system secret equality was not extracted. No `net` HTTP response rows appeared in the last hour; due-work guards can make healthy empty dispatchers inert.

Cloud Tasks has no separately demonstrated dead-letter queue here. Durable SQL statuses, expired-lease recovery, bounded delivery generations and staff release/remediation are the recovery mechanism. Preserve the scheduler, payment reconciliation and refunds during rollback. For a newly deployed pilot revision, repeat the configuration check and isolated work/retry/response smoke before treating these existing settings as proof for the new image.

### Supabase, private storage and support

Fresh catalog inspection reconfirmed project `bjvsgaqitehtwasugvla`, PostgreSQL 17.6, 84 migrations, the private `case-files`/`case-deliverables` 50 MiB buckets and `partner-agreements` 10 MiB bucket. No public application table was found with RLS disabled; `storage.objects` RLS is also enabled. Stored policies enforce owner namespaces/prepared uploads and staff source/deliverable authorization. Customer released-report downloads go through existing backend authorization and bounded signed URLs; no real object was opened.

Existing checkout authorization, payment fulfillment, work reservation, release, refund reservation/result and response-analysis RPCs are present. The new foundation/hold/authority/product schema and RPCs remain absent, consistent with the four missing versions. Metadata presence and prior local policy tests do not replace an authenticated owner/nonowner hosted smoke. The shared credential references mean staging must not be treated as a disposable data store.

Support configuration is partly verified:

- Source default and configured production reply-to are **`support@venfour.com`**. The live Stripe business profile has no support email/URL populated; that is optional metadata cleanup, not a checkout blocker.
- Domain DNS has Google MX, Google SPF, DMARC `p=none`, a Resend DKIM public-key record and an SES feedback MX at `send.venfour.com`. Public DNS records establish configuration presence, not mailbox existence, Resend's account-side verified status, or delivery.
- Production binds **`RESEND_API_KEY` → `venfour-resend-api-key:2`**, enabled, and partner sender/reply-to/dispatch configuration. This supersedes older documentation that said no sending credential was present. It does not prove the key is usable, and no Resend request or email was sent.
- The shared lifecycle-mail flags and Auth-hook flag are absent; communications cron is off. Preserve the established Supabase Auth mail route. Current hosted SMTP values/domain verification and actual login/recovery delivery were not inspected through secret payloads or exercised. A working customer Auth/recovery route and reachable founder support are required; extra lifecycle/marketing/partner automation is not.

Owner action is to confirm the support inbox is monitored and complete the already-required isolated customer login/recovery/refund-support smoke. An absent optional Stripe support-profile field or inactive lifecycle campaign is not a reason to block the generic valuation product.

### Exact template-5 qualification follow-up

The safest execution environment is a **dedicated local synthetic runner**, not current shared staging. It needs no Supabase, Stripe, Cloud Tasks, customer data, MarketCheck key or application deployment. Only the separately authorized report-review provider should be reachable. Keep the production artifact unchanged until the candidate passes.

| Requirement | Exact remaining work |
| --- | --- |
| Harness | `tests/report_review_provider_eval.py`, invoked as `.venv/bin/python -m tests.report_review_provider_eval`; uses `OpenAIReportReviewer` and the existing strict comparator/release gate. It currently materializes template 4. |
| Bounded code change | Materialize template-5 sources/context/PDFs; update the versioned rubric and digest-bound suite coherently, preserving every existing adversarial expectation. Add explicit human labels for new context content; archive per-case results/usage. These are qualification changes, not valuation or product features. None implemented in this audit. |
| Required fixtures | Existing fictional supportable, no-support and review-required bases and all 20 current scenarios; template-5 unknown/conflicting/third-party facts, settlement separation, and rejection of fabricated verified state rules/appraisal claims. No real insurer document or jurisdiction approval. |
| Provider requests | One actual `responses.create` review per evaluated case, with zero SDK retries; harness permits at most **3 attempts per case**, only for operational errors. Current 20-case suite: **20 normal / 60 maximum** calls. If new state cases increase the suite to `N`, approve the exact final manifest first and cap it at **N normal / 3N maximum**. Do not advertise 60 as the cap for an expanded suite. |
| Token/cost impact | Current review output limit **16,000 tokens per attempt**, timeout **90 seconds**; input contract caps serialized input at 4,000,000 bytes. For 20 cases, output allowance is at most 320,000 tokens without retries or 960,000 at 60 attempts, plus input/instruction/schema tokens. These are ceilings, not expected consumption. No trustworthy dollar estimate or provider remaining balance was obtained without provider access; actual model tariff and fixture token estimate must be attached to the separate spend authorization. Cost is billed input/output usage at that project's actual tariff; a request cap is not a dollar cap. MarketCheck impact is **zero**. |
| Success | Every human-labeled scenario matches its expected review checks and gate decision, with exact model/prompt/schema/suite identity, current digests and no unexplained operational failure. Correct/no-support reports pass as labeled; adverse reports must fail/hold for the correct reasons. Generation success or an unrelated hold is insufficient. |
| Evidence/artifact | Preserve manifest/fixture hashes, JSON/PDF/validation digests, sanitized provider responses/model IDs/token usage, per-case comparator results and complete run outcome. Existing entrypoint prints qualification JSON only on full success; it does not write the checked-in file automatically. Update `config/report-review-eval-attestation-v1.json` through that existing process only after the genuine complete pass. |
| Release binding | Align approved model, prompt, schema, suite digest and packaged artifact with the candidate; rerun focused qualification/contract tests after those changes. Do not alter the currently deployed pins in this audit or reuse the older 20/20 claim for template 5. |
| Failure/cleanup | Failed or incomplete run produces no accepted artifact; stop within the approved cap, retain adverse results and leave production unchanged. Retain only synthetic/non-secret evidence; close the dedicated runner and remove temporary credential exposure from its environment. No hosted rollback/migration/queue cleanup is needed because the harness must create none. |

### Future activation order, narrowed by this audit

1. Keep new pilot admission closed. Access restoration is complete; do not repeat it unless credentials expire. Confirm owner operating scope and supervision/support/refund responsibility without creating jurisdiction approval.
2. Complete the bounded template-5 qualification change and separately authorized genuine evaluation. This is the next implementation milestone; no nationwide feature build is needed.
3. Select a genuinely isolated hosted acceptance environment. Do not simply add a MarketCheck binding to current shared staging. Resolve database/account separation, current-code queue-read permissions, full release configuration, worker/frontend routing and test webhook reachability in a separately authorized setup. The correct $199 sandbox price already exists.
4. Rehearse the complete synthetic/test payment → immutable report → release/download/draft → insurer-response flow, plus duplicate/refund/recovery handling. Confirm Auth/recovery and the owner's refund procedure. This audit neither created test work nor sent messages.
5. Take a current backup/recovery snapshot, inventory in-flight sessions/work, and record compatible source/image rollback identities. Apply the exact four missing migrations in order under separate authorization; inspect role grants/RLS/RPCs afterward.
6. Deploy the qualified compatible backend/API/workers with product flag false. Preserve the verified production Stripe settings, provider ledger, OIDC identities, running queue and enabled recovery scheduler. No queue-resume action is required by the current snapshot.
7. Deploy compatible frontend with product flag false and validated environment/host settings; check history, private authorization, `/ready` and current worker/recovery configuration. No public marketing rollout is needed.
8. Select the one-case admission control (existing manual staff payment approval is available, currently off); account for outstanding sessions and existing users before any authorized setting change. Keep jurisdiction mode off/shadow and authority infrastructure unenrolled.
9. With admission still stopped, enable backend product capture on the compatible API/worker revisions, then rebuild/deploy frontend with its product flag true. Verify facts persist and new requests cannot reach an incompatible worker revision.
10. Reconfirm the provider period/remaining budget and monitored support. Record owner go/no-go, then admit only the selected real customer through ordinary strict eligibility and the unchanged $199 checkout. Supervise the 19-step runbook above.
11. On failure, stop new admission and use the existing compatible-code flag rollback. Retain migrations, template-5 readers, saved evidence, historical access, payment events, refunds, queues/recovery where safe and accounting. Do not roll back price/policy/commission history or disable webhooks.

### Follow-up verification and evidence limits

Read-only metadata was collected through gcloud service/revision, Secret Manager **describe**, IAM, queue/task-list, scheduler/log and build/image commands; Stripe account/price/product/endpoint GETs; Supabase read-only catalog/configuration/aggregate SQL; DNS and health/readiness GETs. No service/API was enabled. One metadata query had an extra closing parenthesis; it was corrected and rerun, with no write statements or data effects. No large local suite was repeated. Pure local budget-config validation, exact webhook-subscription comparison, document link checks and `git diff --check` are the scope-appropriate checks for this documentation-only follow-up.

Sanitized machine-local evidence is `/tmp/venfour-hosted-audit-{backends,frontends,workers,infra,progress,build,staging-build,stripe,stripe-staging,db-base,db,work,dispatch-metadata,dispatch-logs}.json`. Backend evidence preserves the full environment **name** inventory and whitelisted non-secret values; secret references have name/version only. Archive needed non-secret evidence with the eventual release. No authenticated customer content was inspected. Existing autonomous cron/scheduler runs were observed, not initiated.

## Final go/no-go checklist

### READY

- [x] **Technical:** prior local results remain 729 backend tests, 502 frontend tests, 1,591 SQL assertions and 88-migration rehearsal; no product behavior changed or large suite repeated.
- [x] **Access:** GCP owner/project and intended live Stripe account verified; access restoration is no longer a blocker.
- [x] **Payment metadata:** live account enabled, canonical active one-time USD 19900 price/product verified and matched to production; enabled webhook has exactly the 12 required events and aligned URL.
- [x] **Production configuration:** provider secret references/model pins, declared one-case quota headroom, running queue/OIDC grants and successful existing paid-recovery scheduler verified. This is configuration evidence, not provider/customer-flow execution.
- [x] **Database/storage:** exact four-version gap, private buckets, RLS, existing critical RPCs and empty current work aggregates verified without reading customer content.

### OWNER ACTION REQUIRED

- [ ] Name the supervised customer/operator, confirm monitored support and the exact manual refund procedure, and choose paid admission control. Existing manual approval is available; no new feature is required.
- [x] Bounded genuine qualification and formal repository acceptance are complete; see the acceptance follow-up below. This grants no authority for another provider run.
- [ ] Choose isolated acceptance infrastructure and authorize the later backup/migration/deployment window. Current shared staging is unsuitable for disposable synthetic work; its missing market binding is not a reason to modify production.
- [ ] Verify actual provider entitlement/billing headroom and refresh quota dates before admission; retain all saved usage. Confirm Auth/recovery operation in the authorized acceptance run.
- [ ] Optional: populate Stripe support-profile metadata, improve state refinements/lifecycle mail, reconcile policy acknowledgment dates and source-build traceability. None is a newly established generic-product runtime defect; economics and the exact-$1,000 gap remain unchanged.

### BLOCKING

- [x] **Repository release qualification cleared:** template 5 has a genuinely evaluated 28/28 artifact, independently reviewed and accepted with preserved Template-4 history. Matching example pins are documented. Hosted image/pin installation remains part of the separate deployment blocker.
- [ ] **Deployment/schema:** the intended product release is not installed; four migrations are absent and both frontend/backend are older. **Smallest clearing action:** apply the listed chain under a backed-up authorized release, deploy compatible qualified code, then activate the two product flags in order with admission controlled.
- [ ] **Operational acceptance:** the newly qualified image has not completed the isolated signed-payment/release/response/refund/Auth-recovery chain. **Smallest clearing action:** one controlled sandbox acceptance run against isolated data and coherent routing/worker configuration; confirm runtime Stripe pairing and owner refund/support procedure there. Do not use a real customer charge as the wiring test.
- [ ] **External operating-scope decision:** actual offered Missouri activities still need the owner's targeted decision/review. **Smallest clearing action:** settle the precise report/draft/coaching scope for the selected case; no 51-state legal-research completion or software jurisdiction approval is implied.

No deployment occurred; no hosted migration was applied; no hosted/product configuration changed; no live payment, checkout, webhook test, model/market provider request or email was initiated. No jurisdiction was approved or enforcement enabled. Price/refund/commission economics are unchanged. Only requested local authentication/context restoration and this documentation update occurred. Stop after the read-only hosted audit.

## Qualification preparation follow-up — September 23, 2026

The bounded implementation described in the hosted audit is now prepared in
[template5-provider-qualification.md](template5-provider-qualification.md).
The existing runner defaults to provider-disabled preparation, uses template 5
and prompt 5, and retains all 20 original scenarios plus eight focused cases.
The exact run is 28 normal model requests, at most 84 including retries, with
zero MarketCheck requests. Execution requires a single-use, expiring owner
budget authorization. The old genuine artifact remains unchanged and does not
qualify this candidate. No production pins, hosted state or feature flags were
changed; genuine qualification and the remaining hosted/pilot blockers still apply.


## Genuine qualification candidate — September 23, 2026

The single bounded run documented in
[template5-provider-qualification.md](template5-provider-qualification.md)
completed **28/28 qualification cases successfully**, using 28 model requests,
zero retries and zero MarketCheck requests. Actual calculated usage cost was
**$13.4259204**, within the authorized **$323.16** ceiling. The genuine evaluation
milestone is complete; its four reviewer passes and 24 expected holds matched
all labels. The single-use authorization was consumed once.

Candidate: `/tmp/venfour-template5-authorized-run/candidate.json`, canonical digest
`85860df17538cc226a59d335ff6eab13ac9cfb6fa162f158bbbb219d8b6f7f46`, evaluated against
revision `83116c81e3bb947158e4abcaf83549a14d627b04`, template/prompt 5 and schema 1.
The existing 12 safety tests, fresh offline preparation and post-run comparator,
digest, PDF-identity, request/token/cost and consumption checks passed.

**The full release-qualification blocker remains until formal owner acceptance
and matching packaged artifact/release pins.** Production qualification is
unchanged. The next smallest step is to review and accept this candidate through
the existing process, preserving the complete evidence; a second provider run is
not needed for this unchanged candidate. No deployment, migration, activation,
payment, email, customer mutation, operating approval or economics change occurred.
The separate hosted release, operational pilot and operating-scope requirements
above remain outstanding.

## Formal qualification acceptance — September 23, 2026

**The repository Template-5 qualification blocker is cleared.** The exact genuine
candidate was independently reconciled across all 28 raw responses, labeled
outcomes, source/report/PDF identities, authorization consumption, ledger and usage.
All 28 comparisons pass: four expected reviewer passes, 24 expected holds, zero
critical qualification failures. All 37 pages of the 12 distinct PDFs were visually
reviewed; the previously accepted sparse fourth page remains cosmetic.

The genuine `releaseAttestation` is installed in
[config/report-review-eval-attestation-v1.json](../../config/report-review-eval-attestation-v1.json),
artifact digest `adf7f327e00f368f0f98b1b013c8a97e7c74892058ac60a26e7082fc2f406c53`.
It qualifies source `83116c81e3bb947158e4abcaf83549a14d627b04`, candidate digest
`85860df17538cc226a59d335ff6eab13ac9cfb6fa162f158bbbb219d8b6f7f46`.
The complete run and previous Template-4 attestation are retained under
[qualification-evidence](qualification-evidence/). The
[formal acceptance record and checks](template5-provider-qualification.md#formal-repository-acceptance--september-23-2026)
document the exact bindings, local verification, release settings and withdrawal.
Earlier dated paragraphs saying qualification is pending are historical observations.
Post-acceptance verification passed **159 offline tests** (56 core and 103 workflow/
boundary checks), with zero failures/errors/skips or unexpected network attempts.

The commented example now specifies model `gpt-5.6-sol`, prompt 5, schema 1 and
suite `ba668548f88123ece29b45f4807d2e33133d9c67086774f950da862841d336b0`.
No live setting or flag changed. Repository-qualified, hosted-deployed and owner-
authorized to operate remain separate statuses.

**Still blocked before a real-customer pilot:** the compatible hosted release and
four migrations; a genuinely isolated signed-test-payment → report/release/download
→ draft/response → refund/recovery/Auth acceptance run; refreshed provider headroom;
and owner operating scope, admission, supervision, support and refund readiness.
No hosted observation was refreshed or treated as current execution proof here.

**Next action:** select the isolated acceptance target and authorize a bounded setup/
rehearsal with its exact data separation, deployment, migration, provider budget and
sandbox payment scope. Follow the existing activation order after that rehearsal.
Do not repeat qualification or use a real customer payment as the wiring test.
No second genuine run, provider request, deployment, hosted migration, payment,
email, customer mutation/publication, jurisdiction approval, enforcement, flag
activation or price/refund/commission change occurred during acceptance.
