# Consolidated production release — September 23, 2026

## Disposition

**BLOCKED before application deployment or business-schema migration. No release was deployed.**

The clean migration rehearsal failed the required empty-membership contract for the new jurisdiction publication/attestation roles. The available production database identity cannot execute the documented privileged cleanup. Do not weaken the assertion, provision reviewer keys, enable enforcement, or apply a partially validated release.

This report records current inspection and local validation, not a completed release or permission to admit a real customer. The owner authorized deployment subject to the gates in the release request; this gate has not passed.

## Concrete blocker

The exact current 88-migration chain was installed in a fresh PostgreSQL 17.6 rehearsal using the repository controller, network `none`, no published ports and disabled scheduled execution. Suite `057_jurisdiction_authority.test.sql` fails assertion 23: **no release role memberships provisioned**. The other 57 SQL suites pass.

Migration `20260922000200_jurisdiction_trusted_authority.sql` creates two NOLOGIN/NOINHERIT roles. PostgreSQL automatically produces these memberships when the non-superuser `postgres` role creates them:

| Role | Member | Grantor | ADMIN | INHERIT | SET |
| --- | --- | --- | --- | --- | --- |
| `jurisdiction_publisher` | `postgres` | `supabase_admin` | true | false | false |
| `jurisdiction_attestor` | `postgres` | `supabase_admin` | true | false | false |

The local transaction-only probe `REVOKE jurisdiction_publisher FROM postgres GRANTED BY supabase_admin` fails with `permission denied to revoke privileges granted by role "supabase_admin"`. No grant was changed. Production read-only catalog inspection establishes `current_user=postgres`, `session_user=postgres`, `rolsuper=false`, `rolcreaterole=true`, and `pg_has_role(current_user,'supabase_admin','SET')=false`.

Earlier local verification removed these memberships as `supabase_admin`; that is not a proven executable production procedure. The current production roles are absent, so production has not been left with a partially installed authority system. The grants do not by themselves constitute operating approval: the empty authority configuration and independent signatures remain separate checks. Nevertheless, the required zero-membership security contract does not pass and must not be reported green.

PostgreSQL's [REVOKE rules](https://www.postgresql.org/docs/17/sql-revoke.html) explain grantor-specific revocation authority. Required next action: establish a supported privileged provisioning/cleanup procedure with Supabase, or review a revised migration design that preserves the intended trust boundary under hosted privileges. Rehearse the exact approved procedure and obtain a passing unchanged assertion before applying production migrations.

## Source and actual production identity

- Initial checkout: clean `main`, HEAD and freshly fetched `origin/main` both `caa37beae0b35bbf775ad4235c42c5af3a5165f6`. No initial tracked modifications or untracked files.
- Current production Cloud Run: project `venfour-prod`, active account `zafar@venfour.com`, region `us-east4`, runtime service account `venfour-api-production@venfour-prod.iam.gserviceaccount.com`.
- Serving revision: `venfour-api-production-admin-release-20260917`, 100% service traffic. Existing tagged revisions remain addressable; traffic/tag configuration was saved.
- Image: `us-east4-docker.pkg.dev/venfour-prod/venfour/venfour-api@sha256:c97acb85fbbbcf58949aaa565d3517f7e0c5fef9cc4045d5ee583fda96c84b80`.
- Cloud Build `2b340dca-c890-43a2-b908-5aab444a1d78` produced that exact image. Its resolved source archive generation is `1789700092868122`; archive SHA-256 `ef8d2f9453cdb1c6d4e66231ef256ef1edb72c7e622056a80fa0c71570e730bd` matches the build provenance.
- All **161 packaged source files** in the retrieved archive match repository commit `2480200`. This establishes exact equivalence for the uploaded backend files, not a full Git-tree identity for omitted files.
- App/partner Worker remains `66b01f33-3bdb-41dd-aae1-b26751f584f6`; public Worker remains `a71a8f0c-a92a-4584-8fff-f17c4fc23916`; each has 100% traffic.
- Those Worker versions have no verified Git revision annotation. Their deployed version/route identities are verified; exact frontend source-tree equivalence is not established. The repository inventory below compares against the independently verified backend source baseline and is not presented as an exact reverse mapping of minified frontend assets.
- No release commit/image/version was produced. Release-preparation changes listed below remain local for review and the next attempt.

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

There were no initial uncommitted differences to classify. The appendix classifies every path in the 151-file committed delta. No tracked generated build delta (B) was found. The tracked browser console log and fictional preview changes are C. Ignored `frontend/dist`, cache/preview output, local environment files, `supabase/.temp`, and temporary evidence stay outside release packaging. The migration role behavior is the E release-safety finding described above; the manifest packaging defect was corrected locally.

## Local release-preparation fixes

- `.gcloudignore`: include the existing required `tests/fixtures/report_review/template5_manifest.json`, matching the Dockerfile and `.dockerignore`. Without it the supported Cloud Build upload cannot satisfy the current Docker COPY instruction.
- `frontend/src/app/public-intake.test.tsx`: replace the obsolete removed-card badge expectation with the actual intake destination and visible homepage heading checks.
- `frontend/src/app/public-site.test.tsx`: verify the new sign-in button and absence of an unrequested embedded form. Preserve public credential isolation and application-route denial assertions.
- This report: record the failed gate, actual production state and complete inventory.

No report runtime, qualification artifact, migration, economic policy, deployment configuration value or test gate was weakened. The upload inventory now contains 180 paths and includes the required manifest. Inspection found no environment files, temporary outputs, screenshots, provider ledgers, authorization files or qualification archives in that inventory.

## Template-5 binding

- Qualified revision: `83116c81e3bb947158e4abcaf83549a14d627b04`.
- Candidate digest: `85860df17538cc226a59d335ff6eab13ac9cfb6fa162f158bbbb219d8b6f7f46`, independently recomputed and matched.
- Installed attestation is exactly the archived candidate's `releaseAttestation`.
- Archive SHA-256: `8de70f171a5740116236c0acfa77e8398e45d16ca063405821679b8af0199fff`, matched.
- Current runtime code, schemas, report fixtures, Dockerfile, dependency list and Docker exclusions have no differences from the qualified revision. The accepted attestation/tests/documentation are the later qualification acceptance changes. Local release-preparation edits do not change report behavior.
- Formal acceptance is retained in `qualification-evidence/template5-acceptance-2026-09-23.json`; the original candidate's historical `CANDIDATE_REQUIRES_OWNER_ACCEPTANCE` status was correctly left unchanged in the archive.
- Production still has prompt 4/schema 1/old-suite pins. A future compatible release must install prompt 5/schema 1/suite `ba668548f88123ece29b45f4807d2e33133d9c67086774f950da862841d336b0` with the accepted artifact. No pin was changed in this attempt.

## Actual pending migration chain

Fresh production history contains 84 versions through `20260917000100`; the checkout contains 88, with no unexpected hosted version. **None was applied.**

| Order and filename | Purpose / dependency | Compatibility and rollback |
| --- | --- | --- |
| `20260922000000_jurisdiction_foundation.sql` | Immutable facts/private decisions and RPCs; foundation for the next three | Additive, no customer backfill or permission approval. Old application paths remain. Retain history on rollback. |
| `20260922000100_paid_delivery_holds.sql` | Dormant enrollment, hold history and work/publication fences; depends on foundation and existing paid lifecycle | Additive tables/triggers and guarded replacements of existing functions. Unenrolled cases preserve prior behavior; financial reconciliation/refunds/history remain. Required before current backend fence calls even with product flag off. Keep tables/fences on rollback. |
| `20260922000200_jurisdiction_trusted_authority.sql` | Empty trust roots, private keys schema, restricted roles and signed publication checks; depends on both above | Additive, no installed reviewers/keys/approvals. **Blocked by unremovable creator memberships under current production identity.** Keep immutable authority history; no destructive down migration. |
| `20260923000000_nationwide_product_context.sql` | Owner/staff product reads and immutable per-report facts; depends on prior chain | Additive private RLS table/functions/triggers; no historical backfill. Needed before enabled product capture/Template 5. Keep saved readers and captures on rollback. |

All four belong before compatible current backend deployment. The isolated preservation rehearsal succeeds, but the complete security validation does not; therefore the chain is not cleared for production.

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
| Exact 88-migration preservation rehearsal | Passed; baseline records and explicit backfill checks preserved |
| Fresh isolated SQL suites | 58 suites, 2,852 assertions: 57 suites passed; authority assertion 23 failed. This is a release blocker, not a waived test. |
| Full frontend suite, initial run | 2,273 passed, 14 skipped, 2 failed across 141 files; both failures were obsolete public presentation expectations |
| Focused frontend rerun after local test corrections | All 32 tests across 4 files passed; covers both failed tests and existing public authentication regressions |
| Typecheck and generated presentation contracts | Passed |
| Relevant source/test/Worker lint | Passed |
| Full-package lint | Four existing errors in unchanged `frontend/preview/showcase/{main.tsx,payment.tsx,records.ts}`; confirmed byte-identical to the source baseline. Reported, not edited or suppressed. |
| Qualification integrity/source comparison | Candidate/attestation/archive hashes match; 265 qualified source inventory files unchanged, only the accepted attestation and two acceptance regression files differ; none missing |
| Full offline backend and additional focused qualification checks | Started under the network-denying, credential-clearing runner; interrupted after the migration safety blocker was established. Neither run is claimed complete or green. |
| Backend upload packaging | Required manifest present in 180-path upload inventory; excluded artifacts checked |
| Source scope and whitespace | Local changes reviewed; `git diff --check` passed |

Production application/public builds, candidate Cloud Run smoke, postdeployment browser verification, all-domain/redirect validation and final deployed-source parity remain **not performed**, because the release stopped at the migration-security gate. No postdeployment smoke result is claimed.

## Recovery material and rollback targets

Private preflight evidence is stored at `/tmp/venfour-release-20260923/private/` (directory mode 0700; files 0600): backend service configuration/traffic, both Worker version records, exact old build source archive and a logical dump of public/migration schemas. Sanitized observations, upload inventory and rehearsal results are in the parent directory. Both dedicated rehearsal containers were stopped and retained; the existing local Supabase stack was not changed. This is **not** a complete production data/object backup or a restore-tested current recovery point. That work was not completed after the blocker and remains required before any mutation. Existing older backup documentation is not treated as a fresh backup.

No rollback is needed: no business migrations, deployment, traffic, feature flags, queue state or provider configuration were changed. Supabase CLI read operations may initialize its administrative login role; they are not claimed to be zero control-plane activity.

If a later authorized attempt changes these components, the pre-attempt targets are:

- Backend/traffic: `gcloud run services update-traffic venfour-api-production --project venfour-prod --region us-east4 --to-revisions=venfour-api-production-admin-release-20260917=100`. Restore the saved complete tag map if changed. This old revision is only an eligible rollback while no Template-5 work/history requires newer readers; assess that before executing.
- App/partner: from `frontend`, `./node_modules/.bin/wrangler rollback 66b01f33-3bdb-41dd-aae1-b26751f584f6 --env production`.
- Public: from `frontend`, `./node_modules/.bin/wrangler rollback a71a8f0c-a92a-4584-8fff-f17c4fc23916 --env public-site`.
- Flags: keep nationwide off in matching frontend/backend configurations and jurisdiction off; retain compatible Template-5 readers and accepted release pins if newer work exists. Do not restore old pins onto new qualified code.
- Queue: baseline RUNNING with untagged production service target; preserve or restore that target/audience using saved configuration. If temporarily paused during a future incident, resume only after the compatible target passes checks. Never replay old work or alter task identities to force progress.
- Database: retain additive migrations/audit/history. No down migration, reset, data deletion or automatic restore is authorized by this report.

## Owner next action and first-customer boundary

Resolve the restricted-role provisioning blocker through a supported privilege path or reviewed migration design, then repeat the clean rehearsal and unchanged authority assertion. Finish the production recovery point and remaining preflight, validate/commit the complete intended source, and restart the consolidated rollout from fresh production observations.

All intended current changes remain pending production; none was silently dropped. The local packaging/test fixes also need inclusion in the eventual validated source revision. First supervised-customer admission remains blocked by deployment/schema alignment, isolated operational acceptance, fresh provider headroom and the documented operating-scope/support/admission decisions. This attempt does not approve a jurisdiction.

No live Stripe payment/checkout, paid provider call, genuine qualification run, real test email, jurisdiction approval/enforcement, economic-policy change or production customer-data mutation/deletion was performed. The $199 price, no-support refund, under-$1,000 refund behavior, exactly-$1,000 unresolved behavior, commissions and attribution remain unchanged.

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
