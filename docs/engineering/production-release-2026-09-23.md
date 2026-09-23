# Consolidated production release — September 23, 2026

## Disposition

**Completed: all four migrations and the consolidated backend, app, partner and public-site release are deployed.**

Runtime source is `0cbf7e7dff8037f9a787ce70fdeea9b7ed7d6a03`, committed and pushed to `main`. Cloud Run and both Workers serve their new versions at 100%. The 21 safe HTTP smoke checks, browser entry/routing checks, live database security audit and scheduled recovery checks passed. This report's completion update is documentation-only and does not change the deployed runtime source.

The owner authorized this bounded release. No broader hosted platform privilege or `supabase_admin` credential was obtained. Nationwide activation and the first supervised paid customer remain separate admission decisions; their unresolved prerequisites are below. No hosted payment/provider/customer-delivery journey is claimed.

## Cause and corrected security boundary

PostgreSQL 17 grants a non-superuser role creator administrative membership in the new role. The actual local and hosted-compatible pattern is:

| Role | Member | Grantor | ADMIN | INHERIT | SET |
| --- | --- | --- | --- | --- | --- |
| `jurisdiction_publisher` | `postgres` | `supabase_admin` | true | false | false |
| `jurisdiction_attestor` | `postgres` | `supabase_admin` | true | false | false |

The prior assertion rejected every `pg_auth_members` row, including these infrastructure grants. Its attempted grantor-specific revocation was unavailable to production `postgres`. Removing those grants locally as the platform superuser was not a supported production procedure. That earlier result is superseded, not relabeled as a pass.

The corrected invariant is no unauthorized or application-accessible direct or transitive ability to assume or administer either restricted role. The previously unapplied authority migration now installs an owner-only, invoker-rights audit and refuses installation if it reports violations. No applied production migration was rewritten.

The audit follows every incoming membership edge from the restricted roles and their infrastructure administrators, regardless of ADMIN/SET/INHERIT values. Only the exact creator grants above and Supabase's exact expiring administrative CLI path are accepted. Root identity is checked through bootstrap-superuser OID, role attributes, existing application-table ownership, grantor/options, and CLI credential lifetime. Unknown superusers, admin-like names, application bridges into administrators, changed restricted-role attributes, and unexpected future memberships fail. Full details and official [PostgreSQL](https://www.postgresql.org/docs/17/role-attributes.html) and [Supabase](https://supabase.com/docs/guides/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role-808bae) sources are in [the authority boundary](jurisdiction-authority.md#dormant-release-role-boundary).

Before rollout, fresh hosted inspection found 84 migrations, neither restricted role, and 25 membership edges. After rollout, production has all 88 migrations, the exact two creator memberships above, and zero audit violations. Venfour's deployed backend has no SQL connection/admin credential configuration: its gateway uses customer JWTs and `service_role` through PostgREST. Auth/Storage/Realtime roles have no restricted path. The owner/platform administrator and infrastructure read-all/replication access remain explicit trust roots; SQL cannot protect database-held keys from those administrators. No signing keys, approved publishers, credentials, operating epochs or live enrollment are installed by this release.

## Source and actual production identity

The original checkout was `caa37beae0b35bbf775ad4235c42c5af3a5165f6`. The resumed checkout was clean `main` at `c920b105169fad3023f8ae285e234038d2779d8f`, which preserved the manifest inclusion, both corrected public tests and the original report. The validated release commit is **`0cbf7e7dff8037f9a787ce70fdeea9b7ed7d6a03`**.

| Deployed component | Exact identity |
| --- | --- |
| Cloud Run project / region / service | `venfour-prod` / `us-east4` / `venfour-api-production` |
| Backend serving revision | `venfour-api-production-release-0923-0cbf7e7`, 100% service traffic |
| Backend image | `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:40039ed1d6bac4f76784494e2875eeaddcf54690d8ae160dbc2937e5891d6782` |
| Cloud Build | `469b7cb8-1ea1-4c95-a18b-7958f475066a`, SUCCESS |
| Resolved source archive | `gs://venfour-prod_cloudbuild/source/1790189044.850335-fd4587fbe21c4276a0cbabe62b789035.tgz`, generation `1790189046151016` |
| Source archive SHA-256 | `67ceac4aa93beaba8c66aca6b2bafb3b75d5216a5ab2f4fffa0b235728c07116` |
| App and partner Worker | `venfour-frontend-production`, version `af89bc0e-d323-4f7e-85ca-df241682a94b`, 100% |
| Public Worker | `venfour-public-site`, version `0c8006e1-ec7d-444f-811c-bea613cabd5a`, 100% |

All **180 uploaded backend files** match the release commit byte for byte. Both Worker version annotations name the same full commit and tag `release-0923-0cbf7e7`. Downloaded Worker JavaScript matches the validated local bundle byte for byte (SHA-256 `f953552b5c415a16530dfe0809d4eaa25ccde9ed53e7c1f09bbdb55f15610b4b`). Deployed assets match retained builds: app 7/7, partner 7/7, public 6/6 allowed routes. The shared email-logo file and direct `/index.html` route remain intentionally excluded by the public-host allowlist; homepage HTML was compared through `/`.

The runtime service account remains `venfour-api-production@venfour-prod.iam.gserviceaccount.com`. API origin, proxy secret binding, existing secret-version references, resource settings and existing revision tags are preserved. The public Worker has only assets and its environment binding; no application credentials or API origin were introduced.

The verified pre-release backend was `venfour-api-production-admin-release-20260917`, image digest `c97acb85fbbbcf58949aaa565d3517f7e0c5fef9cc4045d5ee583fda96c84b80`. Build `2b340dca-c890-43a2-b908-5aab444a1d78` and archive generation `1789700092868122` bind its 161 uploaded files exactly to repository baseline `2480200`. The archive SHA-256 was `ef8d2f9453cdb1c6d4e66231ef256ef1edb72c7e622056a80fa0c71570e730bd`. Previous app/partner version `66b01f33-3bdb-41dd-aae1-b26751f584f6` and public version `a71a8f0c-a92a-4584-8fff-f17c4fc23916` had no verified Git annotation; no historical frontend source equivalence is invented.

## Intended delta discovered beyond nationwide work

The original repository comparison against `2480200` had 151 changed/added paths across 16 commits. All 151 remain in the final 157-path release inventory; six supplemental release files are classified below. Significant intended changes include:

1. Embedded public sign-in, dedicated app-host sign-in route, origin/source-checked message handling, full-page fallback, and scoped Worker frame policy.
2. Public-only cookie-consent presentation; header hover/focus styling; homepage simplification and service-anchor behavior.
3. Redesigned public footer, About page, report-explanation resource, valuation checklist and their public-host routing.
4. Preliminary-versus-paid-report wording, intake confirmation, saved-result location/claim editing, and checkout product presentation.
5. Shared partner-header interaction styling and commission marketing copy; deterministic commission and attribution implementation is unchanged in this delta.
6. Optional state/claim fact intake, owner/staff product panels, generic product records, frozen report facts and Template-5 presentation.
7. Dormant jurisdiction observation, paid-delivery holds, restricted publication/attestation foundations and recovery fences.
8. Accepted Template-5 qualification, matching runtime report fixtures, schemas, gate regression coverage and packaging.
9. Research/review packets and operational documentation; these do not approve any jurisdiction and are not runtime release payloads.

Commit `f7121fe` is titled as a saved-case-data fix, but its actual diff changes only a browser console log. No saved-case-data behavior fix is attributed to that commit, and the log is excluded.

The prior admin/intake/source-PDF/email-history release is already in the verified backend baseline. This delta adds the staff product panel, rather than treating all earlier admin work as newly undeployed. Backend email/support implementation, Stripe economics, existing commission calculations, queue configuration and frontend dependencies have no additional source changes relative to that baseline unless itemized in the appendix.

Classification: A = intended source or supporting regression coverage; B = generated build output; C = local test/debug artifact; D = documentation/reference only; E = suspicious/needs review. Tests in A are intended versioned verification, not production test execution. Required report-evaluation fixtures are runtime dependencies. The committed qualification archive remains retained history and is excluded from upload; its provider ledger/authorization files are not deployed.

There were no initial uncommitted differences to classify in either attempt. The appendix retains every path in the original 151-file committed delta and classifies all six supplemental paths. No tracked generated build delta (B) was found. The tracked browser console log and fictional preview changes are C. Ignored `frontend/dist`, cache/preview output, local environment files, `supabase/.temp`, and temporary evidence stay outside release packaging. The migration role behavior is the E release-safety finding described above; the manifest packaging defect is preserved in `c920b10`. The original E finding is resolved by the reviewed role-boundary correction.

## Local release-preparation fixes

- `.gcloudignore`: include the existing required `tests/fixtures/report_review/template5_manifest.json`, matching the Dockerfile and `.dockerignore`. Without it the supported Cloud Build upload cannot satisfy the current Docker COPY instruction.
- `frontend/src/app/public-intake.test.tsx`: replace the obsolete removed-card badge expectation with the actual intake destination and visible homepage heading checks.
- `frontend/src/app/public-site.test.tsx`: verify the new sign-in button and absence of an unrequested embedded form. Preserve public credential isolation and application-route denial assertions.
- Authority migration/tests: replace zero membership with the reviewed role-graph invariant; retain ownership, RLS, private keys, two independent signatures and immutable authority history.
- Concurrency harnesses: authenticate synthetic publisher/writer identities over narrowly scoped local Unix-socket rules, with network `none` and no exposed ports. The prior non-superuser `SET SESSION AUTHORIZATION` approach failed before the intended assertion. No hosted authentication rule or administrator credential changed.
- This report and authority/preflight documentation: record the corrected boundary, complete inventory, fresh evidence and rollout.

No report runtime, qualification artifact, economic policy or application security boundary was weakened. The unapplied authority migration and its incorrect assertion were corrected together. The upload inventory now contains 180 paths and includes the required manifest. Inspection found no environment files, temporary outputs, screenshots, provider ledgers, authorization files or qualification archives in that inventory.

## Template-5 binding

- Qualified revision: `83116c81e3bb947158e4abcaf83549a14d627b04`.
- Candidate digest: `85860df17538cc226a59d335ff6eab13ac9cfb6fa162f158bbbb219d8b6f7f46`, independently recomputed and matched.
- Installed attestation is exactly the archived candidate's `releaseAttestation`.
- Archive SHA-256: `8de70f171a5740116236c0acfa77e8398e45d16ca063405821679b8af0199fff`, matched.
- Current runtime code, schemas, report fixtures, Dockerfile, dependency list and Docker exclusions have no differences from the qualified revision. The accepted attestation/tests/documentation are the later qualification acceptance changes. Local release-preparation edits do not change report behavior.
- Formal acceptance is retained in `qualification-evidence/template5-acceptance-2026-09-23.json`; the original candidate's historical `CANDIDATE_REQUIRES_OWNER_ACCEPTANCE` status was correctly left unchanged in the archive.
- Production now has prompt 5/schema 1/suite `ba668548f88123ece29b45f4807d2e33133d9c67086774f950da862841d336b0` with the accepted artifact. The release gate remains enabled. `/ready` includes paid-release configuration validation and passed on the new revision before and after promotion. No report-affecting source changed and no genuine provider qualification was repeated.

## Applied production migration chain

Immediately before application, production contained 84 versions through `20260917000100`, with exactly the four expected pending migrations and no partial application. Normal linked `supabase db push` applied all four in the following order. Production now contains **88 versions through `20260923000000`**, matching the checkout.

| Order and filename | Purpose / dependency | Compatibility and rollback |
| --- | --- | --- |
| `20260922000000_jurisdiction_foundation.sql` | Immutable facts/private decisions and RPCs; foundation for the next three | Additive, no customer backfill or permission approval. Old application paths remain. Retain history on rollback. |
| `20260922000100_paid_delivery_holds.sql` | Dormant enrollment, hold history and work/publication fences; depends on foundation and existing paid lifecycle | Additive tables/triggers and guarded replacements of existing functions. Unenrolled cases preserve prior behavior; financial reconciliation/refunds/history remain. Required before current backend fence calls even with product flag off. Keep tables/fences on rollback. |
| `20260922000200_jurisdiction_trusted_authority.sql` | Empty trust roots, private keys schema, restricted roles and signed publication checks; depends on both above | Additive, no installed reviewers/keys/approvals. Corrected graph audit accepts verified creator administration and fails on unauthorized paths. Keep immutable authority history; no destructive down migration. |
| `20260923000000_nationwide_product_context.sql` | Owner/staff product reads and immutable per-report facts; depends on prior chain | Additive private RLS table/functions/triggers; no historical backfill. Needed before enabled product capture/Template 5. Keep saved readers and captures on rollback. |

All four were applied before the compatible backend deployment. The postmigration role/object/RLS audit passes, and the definitions, owners, security-definer settings and search paths of 42 affected functions exactly match the rehearsed database. No reviewer, key, publisher, attestation writer, authority publication, attestation or case enrollment was installed.

## Fresh configuration and safety observations

| Area | Verified after rollout or preserved from fresh preflight | Evidence limit |
| --- | --- | --- |
| Backend | New revision Ready, 100%; candidate and service `/health` and `/ready` return 200 with `ok` / `ready` | Readiness includes configuration gates; it does not run a customer transaction |
| Domains / proxy | HTTPS works for `venfour.com`, canonical `www`, `app.venfour.com` and `partners.venfour.com`; same-origin API reaches the new backend; CSP and host boundaries pass | No DNS or TLS configuration change was necessary |
| Database | Linked project `bjvsgaqitehtwasugvla`, PostgreSQL 17.6; all 88 migrations; no role, RLS or authority ACL violations | Platform administrators remain explicit infrastructure trust roots |
| Storage / data | All three buckets private with unchanged 50 MiB/50 MiB/10 MiB limits; 19 cases, 1 object, 0 orders/payments/report versions and empty work ledger preserved | Final preservation details below; no customer document rendered |
| Auth / Turnstile | Live Auth settings enable email, Google, Apple and anonymous users; existing session reaches staff workspace. Managed Turnstile widget's allowed hosts include both app and partner production domains | Widget retains historical name `Venfour staging Auth`; settings cover production. No new OTP, CAPTCHA completion or fresh OAuth journey was executed |
| Stripe | Live `acct_1U8ownCJhANXFiZn`, charges/payouts enabled; active one-time USD 19900 price `price_1UFeIkCJhANXFiZnfJ3samsb` | Existing deployed credential used for metadata GETs only; no checkout/payment/refund |
| Stripe webhook | Enabled `we_1UFeIlCJhANXFiZn65i1yaHI`, `https://app.venfour.com/webhooks/stripe`, expected checkout/refund/dispute events, API `2026-07-29.dahlia` | No webhook replay; GET rejected with 405 |
| Market provider | Existing credential reference and account declarations intact: monthly 500, 20% reserve, 4 prior-use allowance, 63 ledger attempts, **333 declared attempts remaining** through October 1; 60/case, 5/second, 100-mile account radius; no exhausted flag | Provider-side billing balance/entitlement was not independently refreshed through a provider request; this is configuration and ledger evidence |
| Model provider | Existing credential reference, response/review model `gpt-5.6-sol`, accepted Template-5 pins, release gate enabled | Upstream credit/rate availability not live-probed; no inference or qualification rerun |
| Queue | `venfour-case-processing-production` RUNNING, empty; 1 concurrent dispatch, 1/second, 5 max attempts | No task manufactured, dispatched or replayed for testing |
| Recovery | Existing every-5-minute scheduler ENABLED; unchanged target/audience/service identity. New-revision runs at 19:00 and 19:05 UTC returned 200; dispatcher configured, reserved/dispatched/failed all zero | Automatic scheduled traffic, not a manually triggered job |
| Mail / support | Resend credential/dispatch references preserved; sender `auth@venfour.com`, reply-to `support@venfour.com`; preview/response/partner cron active, general communications cron inactive | No message sent, no inbox-delivery claim; partner agreement remains `release_hold` |

The operator could not mint the existing workload's OIDC token for a separate read-only internal configuration probe. No IAM permission was changed. Deployment configuration, successful runtime `/ready`, and actual scheduler OIDC requests on the new revision provide the stated verification; the unavailable operator probe is not represented as a pass.

## Flags and activation

The release explicitly sets matching backend/frontend nationwide flags **false** and jurisdiction mode **off**. The previous revision did not contain the new product feature; these values retain disabled activation on the new code.

- `VENFOUR_NATIONWIDE_PRODUCT=false` and `VITE_NATIONWIDE_PRODUCT=false`: product code and database support are deployed, while state/claim intake and product panels remain dormant. Product endpoint returns `404 PRODUCT_NOT_ENABLED`.
- `VENFOUR_JURISDICTION_MODE=off`: no enforce mode, reviewer, key, publication or live enrollment. The security correction creates no legal approval.
- Report release gate stays enabled with accepted prompt-5/schema-1/suite pins.
- Legacy analysis API remains false (`0`). Manual payment approval remains false; no pilot-admission setting changed.
- Direct insurer sending/negotiation, formal appraisal-clause services and unreviewed appraisal labels remain disabled. Diminished-value requests and general lifecycle communications were not activated.

Separate [documented activation prerequisites](nationwide-product.md#activation-and-rollback) still include reviewed operating scope, applicable authority/credential/document decisions, policy acceptance correction, and a controlled admission/operational acceptance plan. Migration parity and Template-5 qualification are now satisfied. The remaining prerequisites are not 51 missing state implementations or jurisdiction approvals that this release can invent.

## Validation status

| Check | Result |
| --- | --- |
| Complete 88-migration preservation rehearsal | Passed; baseline records, explicit backfills and stored synthetic file bytes preserved |
| Fresh empty PostgreSQL 17.6 chain | All 88 migrations pass without creator-membership removal |
| Production-shaped rehearsal | All 25 observed hosted membership edges reproduced exactly before applying all 88 migrations; graph audit passes |
| Complete SQL suites in both fresh environments | 59 suites / 2,875 assertions pass in each; no failed suites |
| Role-boundary negative tests | 23 pgTAP assertions plus 20 isolated administrative checks; direct/transitive, ADMIN-only, inherited and database-owner escalation denied; exact creator/CLI patterns accepted |
| Authority concurrency and signature scenarios | 58 checks pass with real synthetic session identities |
| Paid-delivery concurrency/recovery | 47 checks pass, including all 152 embedded commerce assertions, retained financial history and report access |
| Full frontend suite | 2,275 passed, 14 skipped across 141 files; no failures |
| Typecheck and generated contracts | Passed |
| Relevant frontend source/test/Worker lint | Passed |
| Full-package lint | Four pre-existing errors in unchanged local showcase files; byte-identical to the baseline and outside deployed assets. No suppression or unrelated edit. |
| Production app and public Worker dry runs/builds | Both pass environment validation, contract/type checks and bundling. Public build uses an explicit environment file to prevent local application variables leaking into the public build. |
| Template-5 qualification | Installed attestation exactly matches retained candidate; archive hash and all report-runtime/schema/fixture/Docker/dependency bytes match accepted qualification. No provider rerun. |
| Full offline backend suite | 2,309 tests, zero failures/errors, 4 skipped; zero unexpected network attempts and 3 intentionally blocked guard probes |
| Source/upload review | 180 backend upload paths, required manifest included; no environment files, backup/object data, temporary evidence, browser logs, authorization records or qualification archives |
| Whitespace/scope check | `git diff --check` passes |

The only full-package lint failures are four existing, unchanged local-showcase errors (three fast-refresh export rules and one unused `_policyInput`); changed production paths pass targeted lint. No suppression or unrelated change was introduced.

Local and synthetic results do not prove a hosted customer payment/provider journey. The following hosted checks were completed within the no-payment/no-provider/no-email boundary.

## Hosted smoke and preservation

- **21/21 HTTP checks pass:** public home/About/resources; canonical www redirect; public app/API denial; app/sign-in/intake/partner shells; proxy forwarding; backend health/readiness; unauthenticated checkout and partner denial; disabled product endpoint; partner/customer isolation; internal-route protection; webhook GET rejection; direct-backend proxy denial. The internal app route is intercepted by Cloudflare Access (302 to its login) before the Worker's own route guard; this is recorded explicitly, not mislabeled as a Worker 404.
- **Browser checks pass:** deployed homepage/footer, public sign-in entry with an existing authenticated session routing to the protected staff dashboard, partner landing/sign-in, About page, public cookie-preferences dialog, and intake entry. Public cookie controls are absent from the app. Inspected staff/partner/intake states showed no console errors or horizontal overflow. No form, upload, OTP, payment or provider action was submitted. Existing session recovery is not proof of a fresh customer email/OAuth/CAPTCHA journey.
- **Runtime recovery:** two successful scheduled reconciliation requests are recorded against the exact new revision. Each reported `dispatcherConfigured=true`, zero reservations, dispatches and failures. The inspected 94-entry new-revision log sample contained no error-severity records.
- **Database preservation:** immediately after the four migrations, all 91 pre-existing table fingerprints and all 252 rows exactly matched the preflight. After browser verification, all counts still match; 90 table fingerprints are identical. The sole change is one existing `auth.users.updated_at` timestamp. Per-column comparison of all 24 users confirms every other field unchanged, with no added or missing user. Case, payment, provider, report and authority history are unchanged.
- **Storage preservation:** the existing 32,275-byte object was read again after rollout and its SHA-256 exactly matches the protected pre-release backup. No object or customer data was deleted or replaced.
- **Security after rollout:** zero unauthorized direct/transitive role paths, unexpected publication/attestation execute grants, unexpected private authority ACLs or tables missing RLS. Both restricted roles remain NOLOGIN, non-superuser, non-CREATEROLE and non-BYPASSRLS; the full attribute/options audit passes. No authority keys, reviewers, writers, publishers, publications, attestations or enrolled cases exist.

This is the strongest completed nonbillable smoke within the owner's constraints. Fresh sign-in delivery, provider availability for a real eligible case, a signed payment event, released customer PDF, and insurer-response processing remain checkpoints for the separately supervised journey.

## Recovery material and rollback targets

Fresh protected recovery material is retained at `/Users/zafaralitolibov/.venfour-releases/2026-09-23/` (directory 0700, files 0600). It includes pre-release backend configuration/traffic, both prior Worker versions, public/auth/storage/migration schema and data exports, the one stored object's exact bytes, object manifest and SHA-256 manifest. Schema export is 1,905,647 bytes; data export is 2,322,652 bytes; the object is 32,275 bytes. Direct IPv6 export was unavailable; Supabase CLI successfully retried through its IPv4 pooler.

The data export notes existing cyclic foreign keys; a disaster restore must use the documented privileged trigger/constraint-aware restoration procedure. A destructive hosted restore was neither attempted nor authorized. The normal application rollback retains additive schema/history and does not restore or delete data. The preservation rehearsal validates compatibility and preservation, not a restore of production customer data.

Working release evidence is in `/tmp/venfour-release-resume-20260923/`; protected originals are in its `private/` directory. Final verification evidence and post-release control-plane snapshots are also retained under the durable recovery directory, separately from the untouched pre-release backups. Prior inspection evidence remains at `/tmp/venfour-release-20260923/`. Supabase CLI operations may initialize its existing short-lived administrative login; no broader platform credential was obtained.

The recorded rollback targets and procedure are:

- Backend/traffic: `gcloud run services update-traffic venfour-api-production --project venfour-prod --region us-east4 --to-revisions=venfour-api-production-admin-release-20260917=100`. Restore the saved complete tag map if changed. This old revision is only an eligible rollback while no Template-5 work/history requires newer readers; assess that before executing.
- App/partner: from `frontend`, `./node_modules/.bin/wrangler rollback 66b01f33-3bdb-41dd-aae1-b26751f584f6 --env production`.
- Public: from `frontend`, `./node_modules/.bin/wrangler rollback a71a8f0c-a92a-4584-8fff-f17c4fc23916 --env public-site`.
- Flags: keep nationwide off in matching frontend/backend configurations and jurisdiction off; retain compatible Template-5 readers and accepted release pins if newer work exists. Do not restore old pins onto new qualified code.
- Queue: baseline RUNNING with untagged production service target; preserve or restore that target/audience using saved configuration. If temporarily paused during a future incident, resume only after the compatible target passes checks. Never replay old work or alter task identities to force progress.
- Database: retain additive migrations/audit/history. No down migration, reset, data deletion or automatic restore is authorized by this report.

## Owner next action and first-customer boundary

The consolidated release is complete. No demonstrated migration, deployment, role-boundary or runtime-readiness defect remains. All original intended changes are retained and shipped to their appropriate runtime surface, except deliberately dormant feature paths and explicitly classified tests, local artifacts and documentation. Qualification and source parity are established; there was no unauthorized requalification or economic change.

**Next action:** complete the first-customer admission record before taking a payment: select one directly recruited, non-commissioned case and named operator; resolve applicable operating-scope/credential/document decisions and the reviewed policy/version acceptance transition; select the existing exact-lineage manual approval control or an explicitly accepted equivalent admission plan. Manual payment approval is currently false and was not changed by this release. Current Terms/Privacy dates versus the August 23 acknowledgment constants remain a documented acceptance-evidence issue, not silently repaired by redeployment.

Once that admission is authorized, supervise the chosen customer's fresh sign-in and report intake, verify current provider account headroom, and confirm strict owner/input/report/evidence eligibility before allowing the customer to initiate the existing $199 checkout. Reconcile the signed webhook, durable work, report release/private access and support/refund checkpoints; stop further admission on a failed checkpoint. Current configuration/readiness and accepted provider qualification do not substitute for that first actual journey.

Nationwide flags stay false until their separate documented prerequisites are met; jurisdiction remains off. These remaining admission and verification conditions prevent an unconditional first-paid-customer sign-off, but do not mean another consolidated deployment is pending. The unchanged exactly-$1,000 refund/commission boundary remains an owner policy question; no economic interpretation was invented here.

Explicit confirmations: no `supabase_admin` credential was obtained or created; no application role gained jurisdiction authority; no live Stripe checkout or payment, paid provider smoke request, genuine qualification rerun or real email was sent; no jurisdiction was approved or enforcement enabled; $199/refund/commission economics remain unchanged; no production customer data was lost. The original backups, customer history and storage object are preserved.

## File classification appendix

The original 151 paths below are retained against verified packaged-backend baseline `2480200`. Together with the six supplemental paths, they cover every path in `git diff --name-only 2480200 0cbf7e7dff8037f9a787ce70fdeea9b7ed7d6a03` (157 total, zero missing or unclassified).

| Supplemental class | Path | Disposition |
| --- | --- | --- |
| A | `.gcloudignore` | Build packaging correction; includes the required qualified report manifest |
| D | `docs/engineering/production-release-2026-09-23.md` | Release evidence and inventory; excluded from runtime upload |
| A | `frontend/src/app/public-intake.test.tsx` | Corrected intended regression coverage; not runtime payload |
| A | `supabase/tests/concurrency/jurisdiction_role_boundary.py` | Negative role-graph verification; local-only test execution |
| A | `supabase/tests/concurrency/local_authority_login.py` | Isolated synthetic session helper; never used against hosted authentication |
| A | `supabase/tests/database/059_jurisdiction_role_boundary.test.sql` | Restricted-role security regression assertions; not runtime execution |

Original inventory:

| Class | Path | Disposition |
| --- | --- | --- |
| A | `.dockerignore` | Intended release source or its regression coverage |
| D | `.env.example` | Documentation or configuration reference; no runtime behavior |
| C | `.playwright-mcp/console-2026-09-21T19-48-11-442Z.log` | Captured browser debug output; excluded from both deployment bundles |
| D | `.rgignore` | Documentation or configuration reference; no runtime behavior |
| D | `AGENTS.md` | Repository operating guidance; no runtime behavior |
| A | `Dockerfile` | Intended release source or its regression coverage |
| D | `README.md` | Documentation or configuration reference; no runtime behavior |
| A | `config/report-review-eval-attestation-v1.json` | Intended release source or its regression coverage |
| D | `docs/compliance/missouri-existing-service-claims.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/README.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/free-result.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/initial-request-template.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/no-support-review.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/no-support-review.pdf` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/no-support-review.txt` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/provenance.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/response-and-follow-up.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/supported-review.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/supported-review.pdf` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-examples/supported-review.txt` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-review-packet.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-review-worksheet.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/compliance/missouri-existing-service-search-coverage.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/development-efficiency-audit.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/jurisdiction-authority.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/jurisdiction-foundation.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/nationwide-launch-readiness.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/nationwide-product-coverage.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/nationwide-product-verification.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/nationwide-product.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/paid-delivery-holds.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/pilot-preflight.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/qualification-evidence/template4-attestation-2026-09-16.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/qualification-evidence/template5-2026-09-23.tar.gz` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/qualification-evidence/template5-acceptance-2026-09-23.json` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/repository-map.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/template5-provider-qualification.md` | Documentation or configuration reference; no runtime behavior |
| D | `docs/engineering/verification.md` | Documentation or configuration reference; no runtime behavior |
| D | `frontend/.env.example` | Documentation or configuration reference; no runtime behavior |
| D | `frontend/AGENTS.md` | Repository operating guidance; no runtime behavior |
| D | `frontend/preview/AGENTS.md` | Repository operating guidance; no runtime behavior |
| C | `frontend/preview/workspace/catalog.ts` | Fictional local preview; excluded from deployment entry points |
| A | `frontend/src/app/app.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/app/public-site.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/app/router.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/app/site-boundary.test.ts` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/app/site-boundary.ts` | Intended release source or its regression coverage |
| A | `frontend/src/components/app-shell.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/config/env.ts` | Intended release source or its regression coverage |
| A | `frontend/src/features/auth/account-control-public.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/features/auth/account-control.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/auth/public-sign-in-dialog.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/auth/public-sign-in-page.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/features/auth/public-sign-in-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/auth/public-sign-in.ts` | Intended release source or its regression coverage |
| A | `frontend/src/features/auth/sign-in-dialog-provider.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/auth/sign-in-dialog.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/nationwide/product-api.ts` | Intended release source or its regression coverage |
| A | `frontend/src/features/nationwide/product-panel.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/features/nationwide/product-panel.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/privacy/cookie-consent.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/features/referral-partners/pages.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/total-loss-claim/components/checkout-experience.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/features/total-loss/intake-steps.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/admin-total-loss-case-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/home-page.css` | Intended release source or its regression coverage |
| A | `frontend/src/pages/home-page.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/pages/home-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/public-resources.css` | Intended release source or its regression coverage |
| A | `frontend/src/pages/public-resources.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/pages/public-resources.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/referral-partners-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/route-error-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/total-loss-analysis-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/pages/total-loss-claim-workflow-page.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/pages/total-loss-start-page.test.tsx` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/src/pages/total-loss-start-page.tsx` | Intended release source or its regression coverage |
| A | `frontend/src/styles/header-navigation.css` | Intended release source or its regression coverage |
| A | `frontend/src/styles/index.css` | Intended release source or its regression coverage |
| A | `frontend/src/styles/public-footer.css` | Intended release source or its regression coverage |
| A | `frontend/src/styles/public-surfaces.css` | Intended release source or its regression coverage |
| D | `frontend/worker/AGENTS.md` | Repository operating guidance; no runtime behavior |
| A | `frontend/worker/index.test.ts` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `frontend/worker/index.ts` | Intended release source or its regression coverage |
| A | `schemas/jurisdiction/authority-attestation-v1.schema.json` | Intended release source or its regression coverage |
| A | `schemas/jurisdiction/case-facts-v1.schema.json` | Intended release source or its regression coverage |
| A | `schemas/jurisdiction/reviewed-authority-v1.schema.json` | Intended release source or its regression coverage |
| A | `schemas/jurisdiction/reviewer-authority-v2.schema.json` | Intended release source or its regression coverage |
| A | `schemas/package/report-review-eval-suite-v1.schema.json` | Intended release source or its regression coverage |
| A | `schemas/report/valuation-evidence-pdf-validation-v1.schema.json` | Intended release source or its regression coverage |
| A | `schemas/report/valuation-evidence-report-v1.schema.json` | Intended release source or its regression coverage |
| D | `scripts/AGENTS.md` | Repository operating guidance; no runtime behavior |
| A | `scripts/jurisdiction_authority.py` | Intended release source or its regression coverage |
| D | `supabase/AGENTS.md` | Repository operating guidance; no runtime behavior |
| A | `supabase/migrations/20260922000000_jurisdiction_foundation.sql` | Intended release source or its regression coverage |
| A | `supabase/migrations/20260922000100_paid_delivery_holds.sql` | Intended release source or its regression coverage |
| A | `supabase/migrations/20260922000200_jurisdiction_trusted_authority.sql` | Intended release source or its regression coverage |
| A | `supabase/migrations/20260923000000_nationwide_product_context.sql` | Intended release source or its regression coverage |
| A | `supabase/tests/concurrency/jurisdiction_authority.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `supabase/tests/concurrency/paid_delivery_holds.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `supabase/tests/database/017_total_loss_report_release.test.sql` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `supabase/tests/database/056_jurisdiction_foundation.test.sql` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `supabase/tests/database/057_jurisdiction_authority.test.sql` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `supabase/tests/database/058_nationwide_product.test.sql` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/fixtures/report_review/eval_cases_v1.json` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/fixtures/report_review/template5_manifest.json` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/jurisdiction_authority_fixtures.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/report_review_provider_eval.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/template5_qualification.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/template5_qualification_fixtures.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_customer_delivery.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_insurer_response_decision.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_insurer_response_processing.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_jurisdiction.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_jurisdiction_authority.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_jurisdiction_integration.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_nationwide_product.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_nationwide_report.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_package_processing.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_paid_delivery.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_report_processing.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_report_release_gate.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_report_review_evals.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| A | `tests/test_template5_qualification.py` | Intended regression/qualification coverage; only required report fixtures enter backend bundle |
| D | `venfour/AGENTS.md` | Repository operating guidance; no runtime behavior |
| A | `venfour/api.py` | Intended release source or its regression coverage |
| A | `venfour/case_analyses.py` | Intended release source or its regression coverage |
| A | `venfour/commerce.py` | Intended release source or its regression coverage |
| A | `venfour/customer_delivery.py` | Intended release source or its regression coverage |
| A | `venfour/data/jurisdiction_registry.json` | Intended release source or its regression coverage |
| A | `venfour/data/jurisdiction_research_seed.json` | Intended release source or its regression coverage |
| A | `venfour/data/jurisdiction_reviewers.json` | Intended release source or its regression coverage |
| A | `venfour/data/nationwide_product_v1.json` | Intended release source or its regression coverage |
| A | `venfour/full_review_processing.py` | Intended release source or its regression coverage |
| A | `venfour/insurer_response_processing.py` | Intended release source or its regression coverage |
| A | `venfour/jurisdiction.py` | Intended release source or its regression coverage |
| A | `venfour/jurisdiction_adapter.py` | Intended release source or its regression coverage |
| A | `venfour/jurisdiction_authority.py` | Intended release source or its regression coverage |
| A | `venfour/market_search_runtime.py` | Intended release source or its regression coverage |
| A | `venfour/nationwide_product.py` | Intended release source or its regression coverage |
| A | `venfour/nationwide_product_api.py` | Intended release source or its regression coverage |
| A | `venfour/package_processing.py` | Intended release source or its regression coverage |
| A | `venfour/paid_delivery.py` | Intended release source or its regression coverage |
| A | `venfour/paid_delivery_api.py` | Intended release source or its regression coverage |
| A | `venfour/report_processing.py` | Intended release source or its regression coverage |
| A | `venfour/report_review.py` | Intended release source or its regression coverage |
| A | `venfour/report_review_evals.py` | Intended release source or its regression coverage |
| A | `venfour/staff_release.py` | Intended release source or its regression coverage |
| A | `venfour/supabase_gateway.py` | Intended release source or its regression coverage |
| A | `venfour/valuation_evidence_report.py` | Intended release source or its regression coverage |
| A | `venfour/valuation_review.py` | Intended release source or its regression coverage |
