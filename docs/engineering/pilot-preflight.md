# Pilot preflight — September 23, 2026

## Owner answer

**Not yet ready to accept the first supervised real payment.** The generic product remains implemented for all 51 jurisdictions, with no demonstrated state-specific product defect and no unsupported state/DC. The stale report-processing fake is repaired. Local report presentation checks pass, including visual inspection, but template 5 has not completed the existing provider-backed release qualification. Hosted inspection also found four pending migrations, an older application deployment, and a staging backend returning `503 not_ready`.

The remaining work is bounded release qualification, configuration verification, deployment and operator acceptance. No new product feature is justified by this preflight. A small qualification-harness change is still needed to exercise template 5 through the existing evaluation process; genuine provider evaluation requires separate authorization and a spending limit. An owner decision on the actual Missouri operating scope remains external to the software review. None of these findings approves Missouri or another jurisdiction.

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

## Hosted audit: verified versus unverified

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

Hosted backend values below are **unverified**, not assumed to equal defaults. No setting changed during this task.

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

## Final go/no-go checklist

### READY

- [x] **Technical:** stale fake repaired without weakened assertions; local release evidence and limitations recorded above.
- [x] **Technical:** all 51 generic product records remain implemented; no new state-specific product defect demonstrated.
- [x] **Technical:** template-5 deterministic/presentation checks and nine-page visual inspection complete; provider qualification explicitly separate.
- [x] **Technical:** isolated migration preservation, payment/refund/access and financial regression checks pass under the documented fixture prerequisites.
- [x] **Hosted metadata:** current Worker versions, actual API origins, 84-version database ledger, private buckets, inspected RLS and scheduler metadata recorded without changing them.

### OWNER ACTION REQUIRED

- [ ] Restore gcloud access and select the correct Stripe account; collect remaining non-secret configuration evidence.
- [ ] Authorize a bounded template-5 qualification follow-up and provider-evaluation budget; retain existing adverse-case standards.
- [ ] Choose genuinely isolated staging/rehearsal resources, diagnose the selected checkout-disabled tag, and prepare current backup/rollback evidence.
- [ ] Name the operator, support inbox/refund procedure and directly recruited customer; choose how existing paid approval controls will limit admission.
- [ ] Obtain the targeted external operating-scope decision for the actual service. This preflight supplies no legal approval.
- [ ] Keep optional state enhancements and non-blocking policy cleanup outside this pilot release.

### BLOCKING

- [ ] **Technical release evidence:** template 5 still lacks the existing genuine provider-backed qualification. Local rendering and the older 20/20 artifact do not close it.
- [ ] **Activation/infrastructure:** four hosted migrations and compatible backend/frontend activation remain unapplied. The currently routed staging backend is not ready; resolve it or verify an explicitly selected isolated replacement before relying on hosted rehearsal.
- [ ] **Hosted verification:** actual backend revisions/config, correct $199 Stripe mode/price/webhook, provider quota/model settings, worker queue/OIDC/recovery and required Auth/support/refund operation remain unverified. A single supervised paid case still needs these dependencies.
- [ ] **Operational acceptance:** complete the isolated signed-payment → released report/draft → insurer-response flow and refund/recovery checks, then record one-case authorization. Do not use the first real payment as the configuration test.
- [ ] **External owner decision:** settle the actual pilot operating scope before offering it. This is not a software defect and does not require resolving every nationwide research item.

No jurisdiction approved; no enforcement enabled; no production deployment; no hosted migration; no live payment; no paid provider request; no email sent; no price, refund or commission change. Stop after this preflight.
