# Consolidated production release — September 23, 2026

## Disposition

**The zero-membership blocker is resolved. Release validation is finishing; production rollout has not started.**

The owner explicitly authorized this resumed consolidated release after correcting the security invariant and passing the release checks. No broader hosted platform privilege or `supabase_admin` credential was obtained. The full offline backend run is still pending completion; all other results below describe completed checks.

## Cause and corrected security boundary

PostgreSQL 17 grants a non-superuser role creator administrative membership in the new role. The actual local and hosted-compatible pattern is:

| Role | Member | Grantor | ADMIN | INHERIT | SET |
| --- | --- | --- | --- | --- | --- |
| `jurisdiction_publisher` | `postgres` | `supabase_admin` | true | false | false |
| `jurisdiction_attestor` | `postgres` | `supabase_admin` | true | false | false |

The prior assertion rejected every `pg_auth_members` row, including these infrastructure grants. Its attempted grantor-specific revocation was unavailable to production `postgres`. Removing those grants locally as the platform superuser was not a supported production procedure. That earlier result is superseded, not relabeled as a pass.

The corrected invariant is no unauthorized or application-accessible direct or transitive ability to assume or administer either restricted role. The previously unapplied authority migration now installs an owner-only, invoker-rights audit and refuses installation if it reports violations. No applied production migration was rewritten.

The audit follows every incoming membership edge from the restricted roles and their infrastructure administrators, regardless of ADMIN/SET/INHERIT values. Only the exact creator grants above and Supabase's exact expiring administrative CLI path are accepted. Root identity is checked through bootstrap-superuser OID, role attributes, existing application-table ownership, grantor/options, and CLI credential lifetime. Unknown superusers, admin-like names, application bridges into administrators, changed restricted-role attributes, and unexpected future memberships fail. Full details and official [PostgreSQL](https://www.postgresql.org/docs/17/role-attributes.html) and [Supabase](https://supabase.com/docs/guides/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role-808bae) sources are in [the authority boundary](jurisdiction-authority.md#dormant-release-role-boundary).

Fresh hosted inspection found 84 migrations, neither restricted role, and 25 membership edges. Venfour's deployed backend has no SQL connection/admin credential configuration: its gateway uses customer JWTs and `service_role` through PostgREST. Auth/Storage/Realtime roles have no restricted path. The owner/platform administrator and infrastructure read-all/replication access remain explicit trust roots; SQL cannot protect database-held keys from those administrators. No signing keys, approved publishers, credentials, operating epochs or live enrollment are installed by this release.

## Source and actual production identity

- Original checkout was `caa37beae0b35bbf775ad4235c42c5af3a5165f6`. The resumed checkout was clean `main` at `c920b105169fad3023f8ae285e234038d2779d8f`, matching freshly fetched `origin/main`. That intervening commit already preserved the manifest inclusion, both corrected public tests and the original release report.
- Current production Cloud Run: project `venfour-prod`, active account `zafar@venfour.com`, region `us-east4`, runtime service account `venfour-api-production@venfour-prod.iam.gserviceaccount.com`.
- Serving revision: `venfour-api-production-admin-release-20260917`, 100% service traffic. Existing tagged revisions remain addressable; traffic/tag configuration was saved.
- Image: `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:c97acb85fbbbcf58949aaa565d3517f7e0c5fef9cc4045d5ee583fda96c84b80`.
- Cloud Build `2b340dca-c890-43a2-b908-5aab444a1d78` produced that exact image. Its resolved source archive generation is `1789700092868122`; archive SHA-256 `ef8d2f9453cdb1c6d4e66231ef256ef1edb72c7e622056a80fa0c71570e730bd` matches the build provenance.
- All **161 packaged source files** in the retrieved archive match repository commit `2480200`. This establishes exact equivalence for the uploaded backend files, not a full Git-tree identity for omitted files.
- App/partner Worker remains `66b01f33-3bdb-41dd-aae1-b26751f584f6`; public Worker remains `a71a8f0c-a92a-4584-8fff-f17c4fc23916`; each has 100% traffic.
- Those Worker versions have no verified Git revision annotation. Their deployed version/route identities are verified; exact frontend source-tree equivalence is not established. The repository inventory below compares against the independently verified backend source baseline and is not presented as an exact reverse mapping of minified frontend assets.
- The identities above are the verified pre-release rollback targets. The final source commit, image and deployed versions will be recorded after the gated rollout.

## Intended delta discovered beyond nationwide work

The repository comparison against `2480200` has 151 changed/added paths across 16 commits. Significant intended changes include:

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

The prior admin/intake/source-PDF/email-history release is already in the verified backend baseline. This pending delta adds the staff product panel, rather than treating all earlier admin work as newly undeployed. Backend email/support implementation, Stripe economics, existing commission calculations, queue configuration and frontend dependencies have no additional source changes relative to that baseline unless itemized in the appendix.

Classification: A = intended source or supporting regression coverage; B = generated build output; C = local test/debug artifact; D = documentation/reference only; E = suspicious/needs review. Tests in A are intended versioned verification, not production test execution. Required report-evaluation fixtures are runtime dependencies. The committed qualification archive remains retained history and is excluded from upload; its provider ledger/authorization files are not deployed.

There were no initial uncommitted differences to classify in either attempt. The appendix classifies every path in the 151-file committed delta. No tracked generated build delta (B) was found. The tracked browser console log and fictional preview changes are C. Ignored `frontend/dist`, cache/preview output, local environment files, `supabase/.temp`, and temporary evidence stay outside release packaging. The migration role behavior is the E release-safety finding described above; the manifest packaging defect is preserved in `c920b10`. The original E finding is resolved by the reviewed role-boundary correction.

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
- Production still has prompt 4/schema 1/old-suite pins. The compatible rollout must install prompt 5/schema 1/suite `ba668548f88123ece29b45f4807d2e33133d9c67086774f950da862841d336b0` with the accepted artifact. No pin has changed before the rollout.

## Actual pending migration chain

Fresh production history contains 84 versions through `20260917000100`; the checkout contains 88, with no unexpected hosted version. **None was applied.**

| Order and filename | Purpose / dependency | Compatibility and rollback |
| --- | --- | --- |
| `20260922000000_jurisdiction_foundation.sql` | Immutable facts/private decisions and RPCs; foundation for the next three | Additive, no customer backfill or permission approval. Old application paths remain. Retain history on rollback. |
| `20260922000100_paid_delivery_holds.sql` | Dormant enrollment, hold history and work/publication fences; depends on foundation and existing paid lifecycle | Additive tables/triggers and guarded replacements of existing functions. Unenrolled cases preserve prior behavior; financial reconciliation/refunds/history remain. Required before current backend fence calls even with product flag off. Keep tables/fences on rollback. |
| `20260922000200_jurisdiction_trusted_authority.sql` | Empty trust roots, private keys schema, restricted roles and signed publication checks; depends on both above | Additive, no installed reviewers/keys/approvals. Corrected graph audit accepts verified creator administration and fails on unauthorized paths. Keep immutable authority history; no destructive down migration. |
| `20260923000000_nationwide_product_context.sql` | Owner/staff product reads and immutable per-report facts; depends on prior chain | Additive private RLS table/functions/triggers; no historical backfill. Needed before enabled product capture/Template 5. Keep saved readers and captures on rollback. |

All four belong before compatible current backend deployment. Both fresh full-chain rehearsals and the complete SQL security suites pass. The migration dry run must still show exactly these four versions immediately before application.

## Fresh configuration and safety observations

| Area | Current verified state | Limit |
| --- | --- | --- |
| Backend | Existing production `/ready` returns 200; Cloud Run Ready condition true | No candidate revision deployed or checked |
| Public/app HTTP | `curl` confirms public homepage and app `/health` return 200 over TLS, with CSP and security headers | Some default Python-user-agent probes returned HTTP errors; those are not browser smoke passes |
| Database | Correct linked project `bjvsgaqitehtwasugvla`, PostgreSQL 17.6, responsive; RLS enabled on all 89 inspected public tables | No postmigration or candidate compatibility check in production |
| Storage | `case-files`, `case-deliverables`, `partner-agreements` remain private, limits 50 MiB/50 MiB/10 MiB | No customer document or signed download was opened |
| Baseline business state | 19 cases, 1 storage object, 0 orders/payments/report versions; no workflow work items | Counts are a point-in-time preflight, not a case-content audit |
| Stripe | Deployed credential identifies live `acct_1U8ownCJhANXFiZn`; charges/payouts enabled; active one-time USD 19900 price `price_1UFeIkCJhANXFiZnfJ3samsb` | Local CLI live context was stale; verified through read-only metadata requests using the existing deployed credential, without printing it |
| Stripe webhook | Enabled `we_1UFeIlCJhANXFiZn65i1yaHI`, `https://app.venfour.com/webhooks/stripe`, expected checkout/refund/dispute events, API version `2026-07-29.dahlia` | No checkout, payment, webhook replay or refund was created |
| Market provider | Credential reference present; 500 monthly allowance, 20% reserve, prior usage 4, September period through October 1; 60 attempts/case, 5 requests/second, 100-mile account radius; ledger has 63 attempts, no exhausted flag | No provider call; provider-side account/billing headroom was not freshly independently verified |
| Model provider | Credential reference present; response and review model `gpt-5.6-sol`; release gate enabled with old production prompt/suite pins | Fresh account credit/rate headroom not established; no inference or genuine qualification rerun |
| Queue | `venfour-case-processing-production` RUNNING and empty; 1 concurrent dispatch, 1/second, 5 max attempts | No work replay or synthetic task |
| Recovery | `venfour-paid-work-recovery-production` ENABLED every 5 minutes, successful recent status; target/audience match production service origin | Existing revision only |
| Mail/support | Partner transport `resend`, sender `auth@venfour.com`, reply-to `support@venfour.com`, credential/dispatch references present; preview/response/partner cron active, general communications cron inactive | No test email, no inbox-delivery claim |

## Flags and activation

All production values remain unchanged:

- Nationwide backend variable absent (new-code default false); deployed frontend predates nationwide UI. On a resumed release, keep both product flags false until documented operating-scope/credential/document decisions, policy acceptance corrections and controlled admission/operational acceptance prerequisites are resolved. Qualification/deployment are not the only documented prerequisites.
- Jurisdiction variable absent (new-code default off); no enforce mode, reviewer, key, publication or live enrollment was added.
- Existing report release gate true with prompt-4 production pins. Must align pins with the accepted artifact as part of the eventual compatible rollout.
- Legacy analysis API false (`0`). Manual payment approval remains false; no pilot-admission setting was changed.
- Direct insurer sending/negotiation, formal appraisal representation and unreviewed appraisal labels remain unavailable. Diminished-value customer intake and shared lifecycle communications were not activated.

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
| Full offline backend suite | Running under credential clearing and network/subprocess denial; final result pending |
| Source/upload review | 180 backend upload paths, required manifest included; no environment files, backup/object data, temporary evidence, browser logs, authorization records or qualification archives |
| Whitespace/scope check | `git diff --check` passes |

These local and synthetic results do not prove a hosted customer payment/provider journey. Postdeployment identity, health/readiness, domains and nonbillable browser checks remain required.

## Recovery material and rollback targets

Fresh protected recovery material is retained at `/Users/zafaralitolibov/.venfour-releases/2026-09-23/` (directory 0700, files 0600). It includes current backend configuration/traffic, both Worker versions, public/auth/storage/migration schema and data exports, the one stored object's exact bytes, object manifest and SHA-256 manifest. Schema export is 1,905,647 bytes; data export is 2,322,652 bytes; the object is 32,275 bytes. Direct IPv6 export was unavailable; Supabase CLI successfully retried through its IPv4 pooler.

The data export notes existing cyclic foreign keys; a disaster restore must use the documented privileged trigger/constraint-aware restoration procedure. A destructive hosted restore was neither attempted nor authorized. The normal application rollback retains additive schema/history and does not restore or delete data. The preservation rehearsal validates compatibility and preservation, not a restore of production customer data.

Sanitized release evidence is in `/tmp/venfour-release-resume-20260923/`; protected originals are in its `private/` directory and the durable recovery directory. Prior inspection evidence remains at `/tmp/venfour-release-20260923/`. Supabase CLI operations may initialize its existing short-lived administrative login; no broader platform credential was obtained.

The recorded rollback targets and procedure are:

- Backend/traffic: `gcloud run services update-traffic venfour-api-production --project venfour-prod --region us-east4 --to-revisions=venfour-api-production-admin-release-20260917=100`. Restore the saved complete tag map if changed. This old revision is only an eligible rollback while no Template-5 work/history requires newer readers; assess that before executing.
- App/partner: from `frontend`, `./node_modules/.bin/wrangler rollback 66b01f33-3bdb-41dd-aae1-b26751f584f6 --env production`.
- Public: from `frontend`, `./node_modules/.bin/wrangler rollback a71a8f0c-a92a-4584-8fff-f17c4fc23916 --env public-site`.
- Flags: keep nationwide off in matching frontend/backend configurations and jurisdiction off; retain compatible Template-5 readers and accepted release pins if newer work exists. Do not restore old pins onto new qualified code.
- Queue: baseline RUNNING with untagged production service target; preserve or restore that target/audience using saved configuration. If temporarily paused during a future incident, resume only after the compatible target passes checks. Never replay old work or alter task identities to force progress.
- Database: retain additive migrations/audit/history. No down migration, reset, data deletion or automatic restore is authorized by this report.

## Owner next action and first-customer boundary

Finish the running offline backend checks, commit the complete validated source, and execute the already authorized migration/backend/frontend rollout. No new owner permission is needed for that bounded release. Record deployed identities and nonbillable smoke evidence here before declaring completion.

All intended changes in the original 151-file inventory are retained. Additional release files comprise the committed manifest packaging correction/report, the new role-boundary SQL/concurrency tests, and the local synthetic-login helper. Concurrency, authority and historical-preflight documentation edits remain in their original intended A/D categories. No report source or economic policy changed.

Nationwide frontend/backend flags remain false until the documented operating-scope, credentials/documents, policy acceptance and controlled admission prerequisites are resolved. Jurisdiction remains off with no approval/enrollment; direct insurer sending, negotiation, formal appraisal and unreviewed jurisdiction labels remain disabled. Deployment is separate from first supervised-customer admission.

No live Stripe checkout/payment, paid provider call, genuine qualification rerun, real test email, jurisdiction approval/enforcement, economic-policy change or production customer-data deletion was performed. The $199 price, no-support refund, under-$1,000 refund rule, unresolved exactly-$1,000 behavior, commissions and attribution remain unchanged.

## File classification appendix

The following is the full committed source comparison against the verified packaged-backend baseline `2480200`. Local release-preparation edits above are additional and explicitly listed.

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
