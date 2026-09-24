# Complete production release — September 24, 2026

**PASS — all current intended Venfour changes are live in production.**

This coordinated release covers the entire intended repository delta, including work completed before and after the earlier nationwide release. The source of truth was the full checkout and deployed-state comparison, not the marketing report. The detailed inventory below accounts for every pending path. No intended source was omitted.

## Source and service identities

Runtime source: **`e2ae5729bd018eebcf08177ae60c3be7e38e2520`** on `main`. Previous production source: **`3b10a43d37e9fe85b7132343eed5f83ca5b1b43c`**. The release documentation is committed separately and changes no runtime code.

| Component | Previous | Released/current |
| --- | --- | --- |
| Customer and partner Worker | `7ad93a89-fcef-45bc-aa97-0d6bd6cacb96` | `b0467bdd-4f60-484e-9b1b-24782f001c1f`, 100% traffic |
| Public Worker | `4786ab2b-bef4-4bb0-bb02-f0c3c74a5e7b` | `15e50143-9c23-49a4-b345-d6ab286bb60d`, 100% traffic |
| Backend, 100% traffic | `venfour-api-production-release-0924-3b10a43` | Same revision; all current backend source already deployed |
| Database | 88 migrations through `20260923000000` | 89 migrations through `20260924000000` |

Customer/partner deployment `54181d46-96ac-4fd0-9205-850f41f17ea7` completed at `2026-09-24T17:24:50.572819Z`. Public deployment `9ade0c89-30bf-4c7a-a530-93903cdf1779` completed at `2026-09-24T17:25:30.397974Z`. Both version annotations name the full source commit.

The backend was not redeployed because its complete current source/configuration has no delta. All **182 files** in the immutable uploaded archive match the frozen release source byte for byte. Project `venfour-prod`, region `us-east4`; image `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:be418a75d6e437440e303da4cc130a920258ccc1a561446dc20b3cadac3279ed`; successful Cloud Build `6e5373b6-cc84-455c-abb8-bd65fcb42f7a`. Source archive generation `1790264121155144`, SHA-256 `0b22f9ac450362b8a99e3e9a2d81019318e5737ef5e8c7b35438f04d2e55a744`.

Both Workers are built from a clean archive of the full source commit with explicit production/public environment files. The application build serves customers and partners; there is no separate partner build. Public configuration excludes customer credentials/configuration. Google IDs are blank, enhanced conversions are false, and the optional Worker CSP switch is false. The application API origin and proxy secret binding remain intact. Worker code and served assets were compared with the retained release bundles after deployment. Both 18,822-byte Worker bundles match SHA-256 `4cabc4f42d31888b5750946ad375f3855fe968f1a803bb69156021b188785d84`. All 20 served-asset comparisons passed: customer 7, partner 7, public 6. Public exclusion of the email-logo path remains intentional.

## Complete production delta

- Shared business lifecycle hooks in the existing homepage, owned intake, successful report upload, authoritative quote, checkout creation, and owner receipt loading.
- Validated campaign/click attribution, first paid touch, parent-domain persistence where advertising consent permits it, and owner-only case association. Existing partner attribution remains independent.
- Separate optional analytics/advertising preferences, version-2 consent, Global Privacy Control, shared consent cookie, withdrawal handling, and Consent Mode preparation.
- Inactive direct Google purchase adapter with stable order IDs, actual paid USD value, private-data exclusion, optional consented purchaser email, and exact future CSP configuration.
- General Terms/Privacy/Cookies improvements and public sitemap/robots support.
- Removal of the obsolete advertising route and page-specific implementation. The existing homepage and customer journey remain the destination; no homepage redesign or replacement page is shipped.
- One additive database migration described below. No backend, provider, email, staff/admin, partner economics, payment-processing, refund, jurisdiction enforcement, or report-generation code/configuration delta was left pending.

## Database migration and safety

Applied **`20260924000000_search_measurement.sql`**, the only locally present migration missing from production. The preceding 88 versions were already present, in canonical order, with no remote-only version. Final comparison has no pending migration.

The migration adds RLS-protected `case_acquisition` and `case_measurement_events`, three owner-authorized RPCs with fixed empty search paths, and the service-readable `financial_measurement_events` view. It depends on the existing case, order, payment, and refund contracts. It does not update historical rows, replace existing functions, create payment triggers, or change payment/refund processing. Browser roles cannot directly read or write any of the three measurement relations. Only authenticated owners may call the RPCs; progress writes cannot manufacture purchase/refund records.

All **89 migrations** were rehearsed in a new disposable container with no network, no published port, and no production application data. All **60 database test files / 2,906 assertions** passed. The linked production dry run listed exactly this migration. The normal migration command executed it and recorded history; Vault updates, seeds, and custom-role replay were excluded. No migration history was fabricated and no privilege check was bypassed.

The deployed schema preserves all **390 existing functions, 197 triggers, and 103 existing relations with their grants**, adding only three functions and three relations. Existing row counts/hashes across 104 tables were exactly unchanged immediately after migration. Final post-smoke preservation, including the separately identified background Auth refresh, is recorded below. Role-path violations remain zero; no public application table lacks RLS; all three storage buckets remain private.

Recovery preserves the additive database schema and financial/audit history. If a frontend rollback becomes necessary, use the recorded previous Worker versions; do not drop measurement tables or rewrite migration history. The retained backend revision requires no rollback for this release.

## Validation

| Check | Result |
| --- | --- |
| Complete frontend suite | 2,469 passed, 14 skipped; 146 passed files and one skipped file |
| Separate Worker/environment suite | 144 passed in three files |
| Complete offline backend suite | 2,320 tests run in 1,993.369 seconds; zero failures/errors, four skipped, zero unexpected network attempts, three deliberate blocked guard probes |
| Complete isolated database assertions | 2,906 passed in 60 files |
| Complete migration rehearsal | All 89 applied successfully |
| Production/app build and Worker dry run | Passed environment validation, generated-contract freshness, TypeScript, Vite, and Worker packaging |
| Public-site build and Worker dry run | Passed the corresponding public-only validation and checks |
| Production source lint | Passed across `src`, `worker`, `scripts`, and `vite.config.ts` |
| Full lint | Four pre-existing errors in local showcase files; details below |
| Secret/build inventory | No server credential detected in the pending inventory or release assets; no dedicated landing-page asset |
| Source/diff/route checks | Passed; source frozen before deployment, full diff reviewed, removed route absent, final documentation diff checked |

Full lint still reports `frontend/preview/showcase/main.tsx:15`, `frontend/preview/showcase/payment.tsx:6` and `:7` (refresh export rules), and `frontend/preview/showcase/records.ts:52` (unused `_policyInput`). Those files are byte-identical to the deployed baseline and excluded from production. The repository release procedure permits reporting unchanged baseline issues without unrelated edits. No production lint error was ignored. Existing large-bundle advisories and test-environment canvas/scroll diagnostics remain non-failing.

## Production smoke and customer journey

All **33 HTTP smoke assertions** passed, followed by **six additional role/referral boundary checks**. Coverage includes public/home/resource/policy routes, canonical redirects, sitemap/robots, retired-page 404, customer entry/sign-in, partner entry/invitation route, health/readiness, unauthenticated checkout/product/partner requests, direct-backend protection, webhook method restrictions, and public/partner API isolation. Admin and staff routes correctly redirect to the existing Cloudflare Access application; that boundary was asserted by exact host/path, not an expected public 200 response. Application/public/partner security-header checks passed, including CSP, HSTS, frame restrictions, nosniff, inactive Google CSP destinations, and app/partner noindex. Ten public informational/policy pages rendered with their expected headings and support links; Terms includes Venfour LLC and $199. Desktop/mobile homepage, mobile navigation, and the embedded customer sign-in form were checked.

The actual homepage Start CTA reached the production application. A fresh normal anonymous session passed the existing security flow and created synthetic draft `01bbd0b4-9cd0-40c6-a882-7e9d870a8057`, owned by `5ea494d4-b5cf-4468-a34f-f64940958843`. The report branch displayed its private PDF/image upload boundary; no file was selected. Invalid VIN input was rejected locally. Manual entry accepted fictional 2020 Toyota Corolla details, 50,000 miles, market ZIP 63101, and a September 23 loss date. The metered trim lookup alone was intercepted with an empty result; ordinary vehicle catalog lookup was used. Location answers saved normally, then deliberately empty contact fields and unchecked acknowledgments stopped submission. Desktop and mobile forms rendered, with no horizontal overflow. Opening the customer workspace as this unclaimed guest returned to the existing intake and restored its draft. The owned quote endpoint returned the existing 404 `CASE_NOT_FOUND` refusal for a draft without a submitted claim/eligible report, before any payable state or Stripe session was created. This matches the deployed quote preflight/claim gate, not a successful checkout.

The result proves the exercised intake, ownership, report requirement, jurisdiction context, and checkout refusal boundaries. It does not claim a completed paid customer journey, live paid-provider analysis, payment webhook reconciliation, delivered report, or refund. No real charge, paid-provider request, insurer upload, production email, or manufactured entitlement was used to create that claim.

The partner homepage and dedicated business sign-in rendered, with Terms/Privacy/Cookies links and no advertising event or Google request. Public and partner referral paths redirect to the same `/r/<code>` on the customer host. Private agreement access returned 401; partner-host admin access returned 404; staff partner API/management paths required Cloudflare Access, whose browser email-authentication form was visible. No login code or invitation was sent. Production retains one partner and one invitation, with no active agreement/link available for a signing or referral-conversion canary. Authenticated dashboard, invitation, agreement, QR/referral, ownership and commission behavior is covered by the complete regression suites and unchanged source; no authenticated partner/staff mutation was claimed as a live test.

## Nationwide/jurisdiction state

| Setting | Live state |
| --- | --- |
| Configured jurisdictions | All 50 U.S. states plus D.C., 51 total |
| Backend nationwide product | `VENFOUR_NATIONWIDE_PRODUCT=true` |
| Customer build nationwide product | `VITE_NATIONWIDE_PRODUCT=true` |
| Enforcement | `VENFOUR_JURISDICTION_MODE=off` |
| Current shared product | Total-Loss Valuation Report, generic product method |
| Active paid-delivery holds | Zero |
| Manual payment approval required | False, unchanged |

The normal UI saved Missouri facts on the synthetic case. A subsequent owner-authenticated production API check saved and evaluated all **51 jurisdictions**, each returning HTTP 200, `PRODUCT_READY_WITH_GENERIC_RULES`, the same available generic method/report label, no applied overrides, and appraisal labels disabled. The test retained 52 append-only fact revisions in total. No state was rejected for lacking a state-specific override; no enforcement or authority configuration was activated.

State-specific overrides are not prerequisites for this generic product. Normal report, evidence, ownership, qualification, payment, processing, and delivery gates still apply. Unresolved settlement components remain excluded from vehicle value. Direct insurer negotiation/representation, appraisal-clause/umpire and assignment services, and appraisal labels remain disabled. Configuration and technical accessibility do not establish legal or operating approval.

## Measurement, financial authority, and Ads readiness

The [Google Ads readiness report](../marketing/google-ads-readiness.md) now reflects this deployed release. The intended destination is `https://venfour.com/` and its existing app entry. The retired `/total-loss-review` page is absent and is not a blocker.

Hosted browser checks verified no stored acquisition/event/tag before consent; after consent, all eight synthetic parameters and the homepage entry persisted using `Domain=.venfour.com`, `Path=/`, `Secure`, `SameSite=Lax`. A later paid touch did not overwrite the first. The actual public-to-app transition carried the same acquisition into the owner-restricted database row and emitted `review_started`. Repeated progress writes left one event. Owner receipt read returned an empty array for this unpaid case; cross-owner read/write returned 403; forged purchase/refund progress events returned 400. Rejecting non-essential purposes in the app cleared browser acquisition and the current case attribution while leaving the business event/history intact. A separate browser context with Global Privacy Control produced version-2 denied optional permissions and no acquisition/Google request. Eight explicit owner/commerce runtime checks passed. No Google request occurred during the smoke.

All eight supported parameters remain: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `gbraid`, `wbraid`. Local regression and hosted checks are distinguished above. Missing actual Google IDs safely disables the adapter. No account or conversion action was created; no fabricated Google ID was installed. Consent Mode and optional enhanced-email readiness remain implemented, with enhanced conversions disabled.

The deployed financial view reads immutable Stripe transactions joined to the actual order. A payment supplies one event keyed by its ledger UUID, with a stable order UUID, actual minor-unit amount divided by 100, and USD. A succeeded refund qualifies only when its refund transaction is linked and not reversed. Clicking checkout, visiting a success URL, refreshing, or sending a progress RPC cannot write an authoritative payment. No new trigger participates in financial processing. The price remains the active live **$199 USD** one-time price; its Stripe webhook configuration is unchanged. Existing refund policy, automatic no-support refunds, under-$1,000 and exact-$1,000 behavior, and partner commissions remain unchanged.

Production currently has no financial transaction to exercise as a real purchase/refund canary. Database fixture tests cover ledger-derived values, stable IDs, refund status/reversal filtering, and owner isolation. Browser deduplication is supplementary; the durable ledger supplies authority. Actual Google delivery/attribution requires the real account, consent, a returning browser, and network access; this implementation does not promise server-side conversion delivery or automatic refund adjustments.

## Security, preservation, and observability

Final hosted audit confirms zero role-path violations, no application table without RLS, private storage buckets, restricted publisher/attestor roles without login/superuser/role-creation/RLS-bypass, unchanged existing schema/grants, and preserved Worker API/proxy-secret bindings. Actual application forwarding and customer/partner/staff boundaries passed. Existing CSRF, ownership, Turnstile, private-document, immutable-history, and financial gates remain covered by the full frontend/backend/database suites. Turnstile was not bypassed to create the synthetic owner.

No VIN, insurer PDF, document content, claim narrative, generated analysis, market comparison, valuation/settlement amount, or other sensitive claim field is included in the advertising payload. The generic business-event builder uses an allowlist. Google receives only configured conversion metadata, a stable opaque order ID, actual paid value/USD, validated click IDs on a fixed public URL, and purchaser email only if separately enabled and consented. Customer case IDs and private route URLs are excluded from Google.

Immediately after migration, all **364 existing rows across 104 tables** had identical counts and aggregate hashes. After browser smoke, all application/private-storage rows still match; **363 of 364 pre-existing whole-row hashes** remain exact. One existing anonymous Auth user changed at `17:33:14Z`, contemporaneous with its old refresh token being revoked and a replacement token created; its prior sign-in timestamp is unchanged. This background Auth rotation is recorded as an exception, not falsely reported as exact whole-database equality. The synthetic run added one anonymous user, one profile, one case, one case-detail row, 52 immutable location revisions, one acquisition row (now withdrawn), and one progress event. No contact row, financial record, entitlement, package job, report version, workflow work item, or communication delivery was created. Provider attempts remain **73**. Both stored objects, totaling **391,637 bytes**, match their original hashes and have protected retained backups.

No backend error-severity/5xx entry appeared in the sampled rollout window beginning `17:24:00Z`. Both error-filtered Worker tails recorded no exception during smoke. The public tail briefly reconnected; subsequent websocket pongs confirmed recovery. Browser checks found no uncaught page error, server 5xx, failed network request, Google request, or CSP violation on Venfour pages. Two diagnostic console messages came from the third-party Turnstile challenge frame; the provider-owned Cloudflare Access login page blocked one decorative data-image under its own CSP. The Access authentication form remained available. These provider-page diagnostics were not hidden or attributed to Venfour code. Scheduled recovery succeeded at 17:30, 17:35 and 17:40 UTC with dispatcher configured and zero reserved/dispatched/failed work. Static asset hashes and live page rendering passed.

Provider and support configuration, pinned backend secret references, private storage, processing queue limits/retries, and the five-minute recovery scheduler remain unchanged. The queue is running and empty. No hosted IAM, Access policy, legal authority, price, refund policy, or commission configuration was altered.

## Known limits and remaining account work

No intended runtime code or legitimate migration remains accidentally undeployed. The existing local lint errors, large bundle advisory, and older service-acknowledgment constants versus later policy publication dates are recorded without being silently declared resolved. Advertising consent version 2 is independent and does not infer advertising permission from older service acknowledgments.

A supervised real customer journey remains a separate operational exercise. Partner/staff authenticated workflows and financial/provider behavior are covered by regression tests and deployed source/configuration checks to the extent described; no customer or partner activity is fabricated for stronger evidence.

The remaining Ads-side work requires opening the actual account: business/billing verification and campaign choices; a purchase conversion action and real destination ID/label; an explicit enhanced-conversions decision; release of those actual build values and the exact CSP switch; then consent/cross-host/conversion diagnostics with an explicitly authorized transaction before campaign spend. Use the stable order reference for any later conversion adjustment. No dedicated advertising page is required.

## Final repository and evidence state

The runtime source was clean and matched `origin/main` before deployment. The only follow-up changes are this complete release record, a successor link in the earlier September 24 record, and the updated marketing readiness assessment. They are committed and pushed separately through the normal documentation process; they do not change the runtime source above. Final repository, remote-commit, migration and deployed-version comparisons are recorded with the completion handoff.

Protected build inputs, source archive, migration output, database/storage fingerprints, HTTP/browser evidence, and deployment logs are retained locally under `~/.venfour-releases/2026-09-24-current`. Secret-bearing configuration, session state, and stored-object backups are excluded from committed documentation. All existing repository work is retained. The file appendix explicitly identifies documentation, regression coverage, generated output, and local artifacts excluded from runtime deployment.


## Complete pending file inventory

Compared with deployed source `3b10a43d37e9fe85b7132343eed5f83ca5b1b43c`, the frozen release source `e2ae5729bd018eebcf08177ae60c3be7e38e2520` changes 181 paths. Initial branch was `main`, identical to `origin/main`; tracked, staged, and untracked working-tree deltas were empty. All intervening commits and the complete diff were inspected. No genuinely unfinished work was found.

| Classification | Paths |
| --- | ---: |
| local/test-only artifact | 143 |
| intended production documentation | 2 |
| intended production configuration | 6 |
| intended production source | 19 |
| generated/build artifact that should not be committed | 10 |
| intended production migration | 1 |

Every source/configuration change is included in the fresh builds or database release. Documentation remains versioned release evidence. Regression tests are retained and executed locally. Committed `.playwright-cli/` and `output/` screenshots, snapshots, logs, and obsolete build output are retained in repository history but excluded from the production bundles; no work was reverted, stashed, or discarded. In particular, the old generated landing-page HTML under `output/search-readiness/` is not a deployment input. Fresh app/public assets were built only from the frozen `frontend/` source. No separate partner bundle, backend code change, email change, admin code change, or jurisdiction configuration change was pending.

| Git change | Path | Classification |
| --- | --- | --- |
| A | `.playwright-cli/console-2026-09-24T15-32-42-897Z.log` | local/test-only artifact |
| A | `.playwright-cli/console-2026-09-24T16-05-56-938Z.log` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-32-43-926Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-34-00-081Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-34-01-670Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-35-03-244Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-37-12-595Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-37-13-193Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-38-04-510Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-39-19-626Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-39-21-262Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-39-56-426Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-40-50-576Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T15-40-51-620Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-00-49-901Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-03-05-747Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-03-23-493Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-04-08-274Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-05-57-916Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-09-01-882Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-09-36-838Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-10-23-974Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-11-55-299Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-11-56-474Z.yml` | local/test-only artifact |
| A | `.playwright-cli/page-2026-09-24T16-13-21-440Z.yml` | local/test-only artifact |
| A | `docs/engineering/production-release-2026-09-24.md` | intended production documentation |
| A | `docs/marketing/google-ads-readiness.md` | intended production documentation |
| M | `frontend/.env.example` | intended production configuration |
| M | `frontend/.env.production.example` | intended production configuration |
| M | `frontend/scripts/public-site-environment.mjs` | intended production configuration |
| M | `frontend/src/app/app.test.tsx` | local/test-only artifact |
| M | `frontend/src/app/router.tsx` | intended production source |
| M | `frontend/src/components/app-shell.tsx` | intended production source |
| A | `frontend/src/features/measurement/attribution.ts` | intended production source |
| A | `frontend/src/features/measurement/config.ts` | intended production source |
| A | `frontend/src/features/measurement/events.ts` | intended production source |
| A | `frontend/src/features/measurement/google.test.ts` | local/test-only artifact |
| A | `frontend/src/features/measurement/google.ts` | intended production source |
| A | `frontend/src/features/measurement/lifecycle.tsx` | intended production source |
| A | `frontend/src/features/measurement/measurement.test.ts` | local/test-only artifact |
| A | `frontend/src/features/measurement/service.ts` | intended production source |
| A | `frontend/src/features/measurement/use-case-measurement.ts` | intended production source |
| M | `frontend/src/features/privacy/consent.ts` | intended production source |
| M | `frontend/src/features/privacy/cookie-consent-context.ts` | intended production source |
| M | `frontend/src/features/privacy/cookie-consent-provider.tsx` | intended production source |
| M | `frontend/src/features/privacy/cookie-consent.test.tsx` | local/test-only artifact |
| M | `frontend/src/features/privacy/cookie-consent.tsx` | intended production source |
| M | `frontend/src/features/total-loss-claim/api.ts` | intended production source |
| M | `frontend/src/pages/cookie-policy-page.tsx` | intended production source |
| M | `frontend/src/pages/privacy-page.tsx` | intended production source |
| M | `frontend/src/pages/terms-page.tsx` | intended production source |
| M | `frontend/src/pages/total-loss-start-page.tsx` | intended production source |
| M | `frontend/src/vite-env.d.ts` | intended production configuration |
| M | `frontend/worker/environment.d.ts` | intended production configuration |
| M | `frontend/worker/index.test.ts` | local/test-only artifact |
| M | `frontend/worker/index.ts` | intended production source |
| M | `frontend/wrangler.jsonc` | intended production configuration |
| A | `output/playwright/search-readiness/desktop.png` | local/test-only artifact |
| A | `output/playwright/search-readiness/keyboard-focus.png` | local/test-only artifact |
| A | `output/playwright/search-readiness/mobile-clear.png` | local/test-only artifact |
| A | `output/playwright/search-readiness/mobile.png` | local/test-only artifact |
| A | `output/search-readiness/backend-tests.log` | local/test-only artifact |
| A | `output/search-readiness/bundle-comparison.json` | local/test-only artifact |
| A | `output/search-readiness/database-tests-final/015_total_loss_stripe_commerce.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests-final/056_jurisdiction_foundation.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests-final/057_jurisdiction_authority.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests-final/058_nationwide_product.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests-final/059_search_measurement.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests-final/database-test-results.json` | local/test-only artifact |
| A | `output/search-readiness/database-tests/015_total_loss_stripe_commerce.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests/058_nationwide_product.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests/059_search_measurement.test.sql.log` | local/test-only artifact |
| A | `output/search-readiness/database-tests/database-test-results.json` | local/test-only artifact |
| A | `output/search-readiness/database/20260818000000_auth_and_appraisal_cases.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260818000100_total_loss_case_details.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260819000000_total_loss_analysis_jobs.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260819000100_add_appraisal_case_submitted_status.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260819000200_diminished_value_case_submission.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260820000000_admin_diminished_value_review.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260823000000_customer_case_operations_foundation.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260823000100_fence_case_operations_to_current_details.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260823000200_guest_first_total_loss.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260823000300_fix_guest_total_loss_rpc_ambiguity.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260823000400_fix_total_loss_operation_postal_stage.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260823000500_harden_guest_total_loss_writes.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260824000000_abandoned_anonymous_guest_cleanup.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260824000100_allow_total_loss_storage_owner_insert.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260824000150_vehicle_trim_cache.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260824000200_total_loss_claim_details.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260824000300_simplify_total_loss_claim_requirements.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260824000400_total_loss_contact_details.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260825000000_total_loss_report_upload_recovery_flag.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260825000100_allow_total_loss_report_recovery_takeover.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260825000200_defer_total_loss_report_analysis.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260825000300_vehicle_configuration_identity.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260825000400_vehicle_configuration_integrity.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260825000500_total_loss_post_continue_foundation.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260826000000_total_loss_secure_claim_resume.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260826000100_total_loss_stripe_commerce.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260826000200_total_loss_package_processing.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260826000300_total_loss_report_release.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260829000000_total_loss_customer_delivery.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260829000100_total_loss_preview_return.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260829000200_total_loss_claim_identity_privacy.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260830000100_report_analysis_evidence_handoff.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260901000000_lightweight_owned_case_history.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260901000100_total_loss_insurer_response_intake.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260901000200_total_loss_insurer_response_analysis.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260901000300_total_loss_insurer_response_dispatch.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260901000400_total_loss_insurer_response_grounding.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260901000500_total_loss_insurer_response_failure_reason.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000100_total_loss_insurer_response_reliability.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000200_total_loss_insurer_response_original_access.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000300_total_loss_response_recommendation_decision.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000400_ground_insurer_recommendation_in_assessment.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000500_total_loss_follow_up_request.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000600_total_loss_repeatable_response_rounds.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260902000700_total_loss_case_resolution.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260903000000_total_loss_superseded_follow_up_history.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260903000100_total_loss_offer_provenance.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260904000000_total_loss_insurer_response_upload_preflight.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260904000100_total_loss_successful_intake_correction.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260904000200_total_loss_response_vehicle_context.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260904000300_total_loss_response_context_recovery.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260904000400_total_loss_response_output_retry.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260905000000_total_loss_resolution_conflicts.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260905000100_total_loss_report_source_prices.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260905000200_market_fact_cache.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260905000300_market_fact_cache_conflicts.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260907000000_staff_admin_workspace.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260908000000_referral_partner_onboarding.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260908000100_referral_partner_attribution.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260909000100_market_request_budget.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260909000200_case_market_search_progress.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260909000300_supporting_listing_delivery.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260909000400_referral_guest_cleanup_protection.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260911000100_total_loss_subject_vehicle_facts.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260911000200_communications.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260911000300_total_loss_full_review_readiness.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260913000100_market_accounting_recovery.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260914000100_market_search_diagnostics.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260914000200_total_loss_submission_input_fence.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260914000300_total_loss_checkout_initialization.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260914000400_paid_work_delivery_recovery.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260914000500_full_review_payment_gate.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260915000100_manual_payment_approval.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260915000200_customer_workspace_navigation.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260915000300_automatic_payment_eligibility.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000000_total_loss_adjuster_message_copy.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000100_total_loss_reconsideration_template.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000200_total_loss_reconsideration_generation.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000300_referral_partner_agreement_proposal.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000400_referral_partner_earnings.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000500_referral_outcome_review.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260916000600_referral_partner_readable_links.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260917000000_customer_scope_and_incomplete_intakes.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260917000100_staff_email_history.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260922000000_jurisdiction_foundation.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260922000100_paid_delivery_holds.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260922000200_jurisdiction_trusted_authority.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260923000000_nationwide_product_context.log` | local/test-only artifact |
| A | `output/search-readiness/database/20260924000000_search_measurement.log` | local/test-only artifact |
| A | `output/search-readiness/database/foundation.list` | local/test-only artifact |
| A | `output/search-readiness/database/managed-foundation.dump` | generated/build artifact that should not be committed |
| A | `output/search-readiness/database/migration-results.json` | local/test-only artifact |
| A | `output/search-readiness/final-focused-tests.log` | local/test-only artifact |
| A | `output/search-readiness/frontend-tests.log` | local/test-only artifact |
| A | `output/search-readiness/production-build.log` | local/test-only artifact |
| A | `output/search-readiness/production-public.json` | local/test-only artifact |
| A | `output/search-readiness/public-build/assets/blue-button-fluid-renderer-D8lZONA1.js` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/assets/browser-DAP68mDI.js` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/assets/index-CnebgmLK.js` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/assets/index-b72HX4-q.css` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/email/venfour-mark-v1.png` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/favicon.svg` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/index.html` | generated/build artifact that should not be committed |
| A | `output/search-readiness/public-build/total-loss-review.html` | generated/build artifact that should not be committed |
| A | `output/search-readiness/serve-public.mjs` | local/test-only artifact |
| A | `output/search-readiness/worker-preview.mjs` | generated/build artifact that should not be committed |
| A | `supabase/migrations/20260924000000_search_measurement.sql` | intended production migration |
| A | `supabase/tests/database/059_search_measurement.test.sql` | local/test-only artifact |
