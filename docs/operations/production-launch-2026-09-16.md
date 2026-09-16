# Production launch — September 16, 2026

The current public/customer/partner frontend, qualified backend and nine database migrations are deployed. The reviewed production-data reset is complete, all three domains respond correctly, and the local showcase is ready. **Commissioned partner onboarding remains blocked by missing sending credentials and the deliberately held agreement/operating requirements.** A full hosted valuation-to-paid-fulfillment journey remains unverified.

## Deployed services

| Address | Established service | Result |
| --- | --- | --- |
| `https://venfour.com` and `https://www.venfour.com` | Cloudflare Worker `venfour-public-site` | Current public site deployed; `www` redirects to the canonical site. |
| `https://app.venfour.com` | Cloudflare Worker `venfour-frontend-production` | Current customer application deployed. |
| `https://partners.venfour.com` | The same production application Worker | New custom domain and valid TLS; host-specific partner application. |
| Production API | Cloud Run `venfour-api-production`, `us-east4`, project `venfour-prod` | `venfour-api-production-launch-review4-20260916` serves 100%; health and readiness both 200. |
| Database, Auth and private files | Existing Supabase project `bjvsgaqitehtwasugvla` | Reset completed; all 82 repository migrations applied. |

The public Worker version is `9d73a925-855f-4e61-b87b-7395561aa52b`. Exact final application and backend versions are recorded in the release evidence below.

Staging uses the same Supabase project. The reset and migrations therefore also affect staging data/schema. Its Worker and backend deployment were preserved; no parallel production infrastructure was created. The final 20:59 UTC check matched the original staging backend revision/image and all 26 traffic/tag entries, plus the unchanged staging Worker version `69d628cf-0aed-4a9d-9872-36b5d369411c`.

## Partner domain and authorization

- Added the partner custom domain to the existing production Worker, the exact partner callback to Supabase Auth's redirect allowlist, and the partner hostname to the existing Turnstile widget. Existing hosts and callbacks remain configured.
- Configured the production backend's partner origin as `https://partners.venfour.com`. API requests use the existing same-origin proxy and private backend authentication.
- Restricted the partner host to its three existing partner API route shapes. Customer APIs, staff APIs, admin, internal routes and payment webhooks are inaccessible through that hostname. Existing customer-host staff/admin Cloudflare Access protection remains effective.
- Preserved the existing owner's staff access and granted that same owner the separate partner-manager membership. No other account received administrative permission.
- Corrected partner callback return paths, canonical public policy links and customer session-hint cookie scope. Partner recovery behavior was checked separately from customer sign-in.

## Production data reset

A private logical database export and all six stored objects were captured before deletion. A network-isolated restore reproduced all 113 exported table counts, and the deletion plan was rehearsed with foreign-key enforcement before execution. No blind truncation was used.

Exactly **200 transactional rows across 20 public tables** were cleared:

| Table | Rows |
| --- | ---: |
| `appraisal_cases` | 25 |
| `analysis_runs` | 13 |
| `total_loss_analysis_jobs` | 20 |
| `commerce_orders` | 3 |
| `checkout_attempts` | 3 |
| `stripe_webhook_events` — expired checkout events only | 4 |
| `diminished_value_case_details` | 1 |
| `total_loss_case_access_recovery_rate_limits` | 3 |
| `total_loss_case_contacts` | 16 |
| `total_loss_case_details` | 20 |
| `total_loss_case_identity_claims` | 18 |
| `total_loss_checkout_review_reports` | 3 |
| `total_loss_claim_workflows` | 3 |
| `total_loss_full_review_reports` | 5 |
| `total_loss_market_search_journal` | 51 |
| `total_loss_preliminary_snapshots` | 3 |
| `total_loss_preview_emails` | 3 |
| `total_loss_report_extractions` | 2 |
| `total_loss_workflow_events` | 3 |
| `workflow_work_items` | 1 |

Also deleted six private files (1,950,666 backed-up bytes), 18 anonymous Auth identities and three explicit test-domain identities, including their associated Auth/profile records. All three orders were unpaid; checkout attempts were expired. No real paid transaction or entitlement existed.

Preserved schema, migration history, RLS, functions, triggers, secrets, private buckets, pricing, payment configuration, caches, service configuration, operational audit records, the product-update webhook audit, and four established accounts/profiles, including the owner. Three established non-staff accounts were retained because their disposable-test status was uncertain. Provider accounting remains 63 attempts, nine case budgets and one account. All 58 untouched public table hashes and retained Auth access records matched the backup immediately after reset.

After migrations, customer cases, analysis jobs/results, orders, payments, entitlements, stored files, businesses, referral activity and communication activity remain empty. The held agreement proposal, owner manager grant and disabled communication definitions are intentional configuration.

The sign-in smoke later created two untouched entry drafts and one anonymous identity. A separate private export verified both exact rows had no details, contact, files, identity claim or other dependent activity. Those two rows and that one anonymous identity were then removed with guarded checks and the normal Auth Admin API. This cleanup is separate from the original 200-row reset: launch cleanup totals are 202 public transactional rows, six files and 22 disposable identities. The final postpromotion census at 20:58:35 UTC had zero cases, jobs, orders, payments, entitlements, files, partner activity and queued production tasks; four established identities/profiles, both owner permissions, all 82 migrations and the 63-entry provider ledger remained. Provider/staff hashes and the retained Auth identity set still matched the pre-reset records.

Recovery files are private and ignored by version control at `supabase/.temp/launch-backup-20260916/`. Read `RESET-REPORT.md` and verify `backup-manifest.json` before recovery. Reconstruct the pre-reset 73-migration snapshot in isolation and reconcile later migrations before any selective live restoration. Masked Auth configuration exports are evidence only and must never replace real secrets. The logical backup is restore-tested; managed backups were unavailable and point-in-time recovery was disabled.

## Migrations and configuration

Applied these nine existing migrations:

1. `20260911000200_communications.sql`
2. `20260915000300_automatic_payment_eligibility.sql`
3. `20260916000000_total_loss_adjuster_message_copy.sql`
4. `20260916000100_total_loss_reconsideration_template.sql`
5. `20260916000200_total_loss_reconsideration_generation.sql`
6. `20260916000300_referral_partner_agreement_proposal.sql`
7. `20260916000400_referral_partner_earnings.sql`
8. `20260916000500_referral_outcome_review.sql`
9. `20260916000600_referral_partner_readable_links.sql`

Automatic eligibility now matches the current repository: the extra manual-approval requirement is off, while strict evidence, ownership, review and lineage requirements remain enforced. No synthetic paid eligibility was introduced. Communications remain disabled; the ten installed definitions have no enrolled deliveries. The partner agreement remains an unpublished draft with `release_hold=true`. Referral compensation and refund rules were not changed for this launch.

Build packaging now includes the report-review qualification artifact and its evaluation suite, already required by the Dockerfile, and excludes the new local-showcase scripts. Production secrets were preserved.

## Local showcase

Run from the repository root:

```sh
node scripts/dev-showcase.mjs
```

Open `http://127.0.0.1:4187/_local/showcase`. Use **Start the walkthrough**, or **Unlock review sections** for a shorter visit. **Reset walkthrough** restarts its browser-local reading state; refresh preserves progress. Stop with `Ctrl+C`, run the command again to restart, then refresh the browser.

The showcase uses the pre-existing local 2024 Hyundai Elantra insurer report and validated saved analysis. It presents 12 insurer comparables, nine selected historical comparables and nine separate then-current comparables. Original insurer value: $19,046. Historical advertised-price median: $19,608, a $562/2.95% difference. Its preserved conclusion is **no material discrepancy**. No genuine saved material-undervalue case was found; this must not be described as a recovery or successful negotiation.

The original report excerpt is permanently redacted. The generated summary and simulated account/payment/progress state are visibly identified as local historical showcase material. The original ZIP mismatch (source 63026, legacy search 63123) is disclosed. Production customer data and backups were never used. The loopback-only preview loads no service credentials, blocks external requests and APIs, and never seeds a database. Source material remains unchanged. See `frontend/preview/showcase/README.md` for provenance and limits.

## Verification and remaining release state

The production application Worker version is `abb3d49e-3595-4234-80e1-697feffa8c40`. Generic staff sign-in now resolves the existing staff permission and opens `/admin` with a full document redirect through Cloudflare Access. Explicit case/partner return destinations retain precedence. The focused auth suite passed 86 tests, with lint and TypeScript checks passing. Actual owner navigation from `/app` automatically reached the working admin Overview in the production browser.

Final Cloud Build `d61ff9d6-2ddd-4187-b83f-a1074093fd91` succeeded and produced image `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:817ecc303fc98d6415a19e0c2d6f649c7614c820c0d959be70c7cdf6f7fe208f`. Revision `venfour-api-production-launch-review4-20260916` passed health/readiness with zero traffic before promotion, then was verified at 100%. Runtime changes consist only of the partner origin and the measured prompt/suite approval pins; secrets, service identity, resources, ingress and all other runtime configuration were preserved. The source upload contains 161 backend files and excludes raw reports, backups, environment files and the local showcase. The previous serving revision remains available for rollback.

The first backend candidate, `venfour-api-production-launch-20260916-24e9fbe`, correctly rejected stale prompt-1 qualification and received no production traffic. Its build was `4fb9703f-49e3-4702-a0ab-52d52f10bd68`, image `sha256:7efeafaa4d9b6e56a39b329fdc4611968085f9234e39eb1380b37210c7b38c41`. The final release uses the separately qualified report version described below.

A first genuine provider evaluation ran all 20 synthetic, human-labeled cases against prompt 3. Seventeen passed; `correct_package`, `missing_material_limitation` and `non_supportable_case_accurately_represented` failed their expected outcomes. That failed evaluation remains recorded and was never accepted as qualification.

Three separately recorded diagnostic reviews found a real presentation defect: the summary stated the historical radius without separately stating the different current-market radius in the frozen evidence. Report template/renderer 4 now states both scopes. The exact version-3 projector remains available for immutable historical replay, with its original PDF bytes verified. The missing-warning fixture now removes the warning from both structured report content and actual PDF bytes, extracts the modified PDF text, and retains the original stale validation manifest. All 20 human labels, expected decisions, rationales and release rules remain unchanged. Prompt 4 only adds recognition of template 4.

The corrected full provider evaluation completed at **20:51:20 UTC: 20/20 passed, zero operational retries**. The exact measured artifact is installed in `config/report-review-eval-attestation-v1.json`, digest `0a2ad93d844d6d68447adb1036f13dc06260b236288c6244e83cca15bc26f131`, with model `gpt-5.6-sol`, prompt 4, review schema 1 and suite digest `e21eddff7a987662ac6bbfcdefd314ce77f56b1391f3c7f14da5dfc0602a2f24`. A preceding private recorder attempt stopped after one call and zero graded cases because its metadata serializer rejected an immutable mapping; the recorder was repaired and tested offline before the full restart. That incomplete attempt contributes no qualification evidence. No semantic outcome was retried or cherry-picked. These checks used synthetic cases and the report-review provider, with no production case data, MarketCheck calls, Stripe sessions or charges.

Validation totals:

- Initial full offline backend discovery: 2,165 tests, two failures, nine errors, four skips, zero unexpected network attempts. Every failure/error traced to unavailable current qualification; the stale prompt pin in one test fixture was corrected to the current constant. After installing genuine qualification, all 40 tests in the affected qualification, local-composition and paid-recovery modules passed with zero unexpected network attempts, covering every original failing test/subtest. The entire discovery suite was not rerun.
- Database: all 54 suites / 2,750 assertions passed on a fresh, isolated migrated database; the migration-preservation rehearsal also passed.
- Frontend: initial full run had 2,191 passes, seven failures and 14 skips. Failed files were rerun, two fixture/style-contract issues were corrected, and all affected checks passed in bounded reruns. TypeScript and production builds passed. The focused partner recovery run passed 61 auth tests.
- Worker routing/security: 137 tests passed; changed-file lint and whitespace checks passed.
- Final report-version-4 integration: 91 tests passed across report processing, release gates, report review, package processing and its API, with zero unexpected network attempts. The separate measured provider qualification passed all 20 cases. Versioned-rendering checks and independent review also verified unchanged version-3 replay/PDF bytes and truthful version-4 scopes.
- Local showcase: all four review sections, evidence expansion, PDF downloads, refresh/reset, desktop/mobile and network isolation passed. No production bundle/source upload contains showcase assets.

Completed production evidence includes valid hostname-checked TLS on all three domains; all 22 final HTTP routing/security checks; desktop 1440×1000 and mobile 390×844 public/customer/partner screens; no layout overflow or application exceptions; private storage; migration parity; new-table RLS/function grants; and authenticated-role read-only owner staff/partner-manager RPC checks. All final HTTP checks used default DNS and ordinary TLS. Initial partner probes used its public address while a negative cache persisted; that cache had cleared by the final checks. Final downloaded application and partner assets exactly matched the local production build.

The public referral path returned a 308 redirect to the customer host with its exact path and encoded query preserved; only raw HTTP was used, so no referral attribution was created. A signed-out partner invitation deep link retained its path, query and fragment while displaying inline business sign-in at both desktop and mobile sizes, with no generic dialog, overflow or console warnings/errors. No invitation was accepted or created.

Automated customer continuation stopped at the human-verification challenge. The owner subsequently completed normal production sign-in and Cloudflare Access. The browser initially held a separate retained Gmail customer session, which correctly received no staff access. After switching to the existing owner account, the actual protected admin Overview loaded zero active cases, zero processing jobs, four registered accounts and the partner-manager navigation. No permission was added to the Gmail account. Full inbox-delivery coverage, a hosted valuation and an eligible live checkout/fulfillment journey have not been completed by this smoke test. The existing live $199 Stripe price and webhook were inspected without creating a checkout or charge. No MarketCheck requests were made. Offline and isolated database tests support the critical path but do not substitute for a real customer journey.

After promotion, the actual owner browser loaded partner administration, its unconfigured-email notice, the held agreement with Publish disabled, and the 27-template communications library. Delivery transport and Auth hook remained disabled, with customer automations paused. These were read-only checks. The final Stripe snapshot retained zero PaymentIntents and exactly the same pre-existing expired Checkout Session. The production queue was running and empty. The 21:00 UTC paid-work recovery scheduler executed successfully on the exact new revision with zero reserved, dispatched or failed jobs. The new revision's observed startup/postpromotion log window contained zero errors or HTTP 5xx responses.

## Before commissioned partner onboarding

The portal can be demonstrated, but real commissioned onboarding remains blocked:

1. **Email delivery:** no usable Resend sending credential was found in the repository environment files or among the 18 Google Secret Manager secrets. The existing Supabase SMTP password is masked and cannot be reused from that export. Create a restricted sending API key for the verified `venfour.com` domain and save it privately in Secret Manager. Bind it to production as `RESEND_API_KEY`; configure `VENFOUR_PARTNER_EMAIL_PROVIDER=resend`, a verified `VENFOUR_PARTNER_EMAIL_FROM`, and a monitored `VENFOUR_PARTNER_EMAIL_REPLY_TO`. Configure a private `VENFOUR_PARTNER_EMAIL_DISPATCH_SECRET` (32–512 ASCII characters without whitespace/control characters) and matching Supabase Vault entries `venfour_referral_partner_api_origin` and `venfour_referral_partner_dispatch_secret`, using the direct trusted API origin. Configure/unpause the existing partner dispatch schedule only after validating those settings. If the shared `VENFOUR_EMAIL_PROVIDER` is configured later, its `VENFOUR_EMAIL_MODE` also controls partner delivery and must be deliberately selected. Preserve the current working Supabase Auth SMTP route; a shared Auth-hook cutover needs separate validation, including partner-origin redirects. Then verify invitation, retry, authenticated return and private signed-document delivery with an intended recipient. No invitation or customer message was sent by this task; the owner completed normal sign-in separately.
2. **Agreement release and operations:** the proposed contract is deliberately held. Resolve the owner decisions and operational requirements in `docs/agreements/referral-partner-owner-review.md`, including secure payee/tax collection, payment/statement reconciliation, and the applicable review procedures. Release requires a separate reviewed implementation; no hold was bypassed and no alternative contract was invented.
3. **Interactive acceptance:** complete the normal owner/partner sign-in and authorized invitation/signature/referral journey after those prerequisites are ready. A held draft and clean database cannot prove that full journey today.

The local genuine-data customer demonstration is ready for a collision-center visit, provided it is described accurately. Do not promise an active commissioned program or a demonstrated monetary recovery.

## Evidence locations

- Private deployment/test evidence: `/Users/zafaralitolibov/.venfour-launch/2026-09-16/`.
- Private backup, exact reset and postmigration permissions: `supabase/.temp/launch-backup-20260916/RESET-REPORT.md` and `POSTLAUNCH-CONFIG-REPORT.md`.
- Browser screenshots and results: `browser-production/` and `showcase-qa/` within the private evidence directory.

No repository commit was created by this launch task.
