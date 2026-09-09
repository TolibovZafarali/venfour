# Production migration backlog: rehearsal and rollout

Prepared 2026-09-09. **Ready for a controlled maintenance rollout; not applied to production.**
All database writes in this preparation were to disposable, network-disabled local containers.
No hosted connection, hosted write, deployment, secret binding, or live MarketCheck request occurred.
The hosted cutoff is the supplied, previously audited cutoff; it was not re-read in this task.

## Changes

- Added `20260909000400_referral_guest_cleanup_protection.sql`. Submitted attribution protects the current owner, retained report owner, claim-source identity, and snapshotted cleanup identity. Eligibility, lease claiming, and the storage-start boundary all check protection before file removal. Older protected retries are cancelled or quarantined. Referral submission shares the existing cleanup advisory lock, so it cannot race a claimed cleanup. Submitted attribution remains immutable; ordinary and unsubmitted abandoned drafts remain removable. RPC and RLS boundaries are unchanged.
- Necessarily repaired **still-unapplied** `20260901000200_total_loss_insurer_response_analysis.sql`: the legacy workflow pointer backfill now advances `revision` exactly once; RLS enablement occurs before the backfill queues deferred constraint checks. A populated cutoff reproduced both failures. A later forward migration cannot repair an earlier migration that fails before reaching it. No previously applied migration was edited.
- Added focused database, cleanup-handler, concurrency, and populated-cutoff tests. Existing cleanup-suite assertions now account for unrelated committed fixtures while retaining the global dry-run no-mutation guarantee.
- Preserved the already-present geography packaging fix. Search behavior and application-controlled MarketCheck defaults were not changed.

## Evidence

The final rehearsal used `venfour-migration-rehearsal-proof`, cached Supabase PostgreSQL 17.6, Docker network `none`, no published ports, PostgreSQL TCP listening disabled, and scheduled execution disabled. Auth/Storage definitions came from a **schema-only** dump of the existing local Supabase stack. No hosted records, secrets, Vault contents, or migration history were copied. Managed Storage definitions were restored intact into the disposable foundation; none were normalized or rewritten.

The controller applied all 29 migrations through `20260829000000_total_loss_customer_delivery.sql`, then committed synthetic production-era data, then applied every pending migration in order. Each migration ran in its own transaction with its actual source recorded. All 63 stored sources match the reviewed local files byte-for-byte.

The cutoff contained nine users, eight guest/authenticated cases, three analysis jobs, two completed analysis artifacts, a paid order/payment/entitlement, a published report, an active negotiation round, an insurer-response correction chain, pending/ready documents, cleanup candidates, seven storage objects, and corresponding local file bytes. Referral tables did not exist at that cutoff: a signed active partner was seeded immediately after onboarding, before the referral-link backfill; submitted/unsubmitted attribution was then seeded before cleanup protection.

All pre-existing rows and original columns were preserved except the explicitly asserted backfill changes: one processing guest-origin flag, one pending-upload expiry, and one workflow pointer/revision update. Latest-response selection produced exactly one job, skipped its superseded response, and preserved both communications. Two upload-source rows and one partner link were backfilled. Submitted attribution was compared in full before/after protection. All seven file hashes remained unchanged by migration.

| Verification | Result |
| --- | --- |
| Exact migration path | 29 baseline + 30 older pending + 3 MarketCheck + 1 protection = **63 passed** |
| Full database suites on that migrated database | **41 files / 2,201 assertions passed** |
| Additional checks on pre-migration customer records | **10 assertions passed**: owner resume, paid entitlement/report reuse, free result, owner isolation, pending-response closure guard |
| Full offline backend suite | **1,861 passed**, zero unexpected network attempts |
| Full frontend suite | **109 files / 1,745 tests passed** |
| Cleanup-handler suite | **11 passed**, network denied |
| Real cleanup handler + isolated database | Two unprotected guests/two files removed; submitted referral and all five retained files preserved byte-for-byte |
| Independent-session cleanup races | Submission-first excludes cleanup; cleanup-first rejects late submission |
| Ledger races | Cumulative 60-attempt ceiling; shared monthly reserve; shared rate limit; stale processing lease rejected |
| Production provider adapter + real local ledger | **60 mocked transport attempts**, attempt 61 blocked before transport; **zero live requests** |
| Catalog | Required tables/columns, validated constraints, valid indexes, enabled triggers, RPC grants, RLS, and report projection passed |

Database suites also exercise Storage authorization, staff/non-staff access, insurer-response intake and analysis, repeatable follow-up rounds, resolution and immutable history, referral onboarding/attribution, checkpoints, and supporting-listing delivery. Full catalog evidence records 283 indexes, 749 constraints, 153 application/Storage triggers, 278 public functions, and 29 policies.

Limits: these are isolated SQL/RPC and application tests, not hosted browser/Auth/Storage service smoke tests. Cleanup uses the real handler and database with local file/Auth adapters. The small synthetic dataset proves correctness, not production throughput or lock duration. The legacy failed-response recovery function is covered by its database suite; that migration's recovery loop had no failed-job rows in the cutoff fixture. Review that row count before production.

## Operational risk

**Moderate coordination risk.** The local 34-migration batch took about two seconds; this is not a production duration estimate. Existing-table locks and populated backfills dominate production risk. No wholesale existing-table rewrite is intentionally requested, but column/constraint changes, ordinary index builds, trigger DDL, and row updates can block writers and generate WAL.

| Migration(s) | Operational concern |
| --- | --- |
| `20260829000100` | Updates processing analysis jobs; builds contact index; installs preview-email cron. |
| `20260830000100` | Adds package lineage/FK and replaces its uniqueness index. |
| `20260901000000` | Drops/recreates the owned-case RPC with a different return shape; coordinate application compatibility. |
| `20260901000100` | Builds two uniqueness indexes over existing response communications; changes Storage policies and resume type. Duplicate chains must be resolved before rollout, never silently deleted. |
| `20260901000200` | Backfills response jobs and workflow pointers; validates new relationships. Requires the repaired file. |
| `20260901000300` | Installs response-analysis dispatch cron. |
| `20260902000100` | Updates pending response-document expiry and builds an index. |
| `20260902000300`, `20260902000500` | Adds recommendation constraints; replaces message-draft uniqueness and adds sent-message uniqueness. |
| `20260902000600` | Builds round/response unique indexes, backfills upload provenance, replaces guards, extends resume type. |
| `20260902000700`, `20260903000100`, `20260905000000` | Workflow columns/constraints, resolution guards across many tables, stored-function changes. |
| `20260904000300` | Row-by-row recovery of terminal `INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID` jobs; count before starting. |
| `20260908000000`, `20260908000100` | Referral tables/constraints, private bucket/policies, cron, active-partner link backfill, checkout wrapper. |
| `20260909000100`–`20260909000300` | New empty private ledger/checkpoint tables and customer report projection; low data-volume cost. |
| `20260909000400` | Function replacement and referral trigger installation; no data backfill. |

Do not split this backlog around serving traffic. Apply it in one maintenance window, preserving per-file transactions. Keep cleanup paused across the entire sequence and through verification. If preflight volumes imply a long index build/backfill, stop and plan a separately rehearsed operational split; do not substitute concurrent indexes or reorder migrations ad hoc.

## Exact production order and procedure

These steps are for a later authorized rollout; none was executed against production.

1. Freeze the reviewed release and hashes. Verify the target project is `bjvsgaqitehtwasugvla`, history is still exactly the 29-migration cutoff, and no unexpected schema/migration changes occurred. Stop if it differs. Never use migration-history repair or mark the backlog applied.
2. Confirm a usable backup/PITR restore point and file recovery coverage. Record baseline row counts, workflow revisions/current pointers, Storage object counts, and hashes/inventory for important retained files. A database restore alone does not restore deleted file bytes.
3. Enter maintenance; drain customer writes/uploads, analysis/package/response workers, payment/webhook processing through the existing durable retry procedure, and all cleanup invocations. Pause scheduler dispatch and wait for in-flight cleanup/storage deletes to finish. Record which cron jobs were active so only those are resumed later. Newly installed preview/response/referral cron can run every minute: verify its corresponding Vault origin/secret pairs are absent or its destination is stopped before the batch starts. Do not add scheduler secrets during migration installation.
4. Run the preflight queries below. Inspect duplicates, table sizes, long transactions/locks, and queued work. Review legacy failed-response recovery candidates once the response schema exists if there could be interim data. Keep `MARKETCHECK_API_KEY` absent and `VENFOUR_ENABLE_LEGACY_ANALYSIS_API=0` in every application revision.
5. With the intended project already linked, run `supabase migration list --linked` and `supabase db push --linked --dry-run`. The pending list must match the following **34 files exactly**, using the repaired response-analysis file. CLI connection setup may perform administrative login-role work; this is an authorized rollout operation, not a zero-write audit.
6. Apply `supabase db push --linked`. Stop on the first failure; inspect the last committed version before any retry. Do not use `--include-all`, migration repair, fixture seeds, or the rehearsal controller on production.

```text
20260829000100_total_loss_preview_return.sql
20260829000200_total_loss_claim_identity_privacy.sql
20260830000100_report_analysis_evidence_handoff.sql
20260901000000_lightweight_owned_case_history.sql
20260901000100_total_loss_insurer_response_intake.sql
20260901000200_total_loss_insurer_response_analysis.sql
20260901000300_total_loss_insurer_response_dispatch.sql
20260901000400_total_loss_insurer_response_grounding.sql
20260901000500_total_loss_insurer_response_failure_reason.sql
20260902000100_total_loss_insurer_response_reliability.sql
20260902000200_total_loss_insurer_response_original_access.sql
20260902000300_total_loss_response_recommendation_decision.sql
20260902000400_ground_insurer_recommendation_in_assessment.sql
20260902000500_total_loss_follow_up_request.sql
20260902000600_total_loss_repeatable_response_rounds.sql
20260902000700_total_loss_case_resolution.sql
20260903000000_total_loss_superseded_follow_up_history.sql
20260903000100_total_loss_offer_provenance.sql
20260904000000_total_loss_insurer_response_upload_preflight.sql
20260904000100_total_loss_successful_intake_correction.sql
20260904000200_total_loss_response_vehicle_context.sql
20260904000300_total_loss_response_context_recovery.sql
20260904000400_total_loss_response_output_retry.sql
20260905000000_total_loss_resolution_conflicts.sql
20260905000100_total_loss_report_source_prices.sql
20260905000200_market_fact_cache.sql
20260905000300_market_fact_cache_conflicts.sql
20260907000000_staff_admin_workspace.sql
20260908000000_referral_partner_onboarding.sql
20260908000100_referral_partner_attribution.sql
20260909000100_market_request_budget.sql
20260909000200_case_market_search_progress.sql
20260909000300_supporting_listing_delivery.sql
20260909000400_referral_guest_cleanup_protection.sql
```

7. Keep traffic and cleanup paused. Run the checked-in read-only postflight:

```sh
# Use the existing approved database credential mechanism; do not print credentials.
psql "$VENFOUR_ROLLOUT_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f scripts/verify_migration_backlog.sql
```

The file asserts exact migration history, RLS, indexes, constraints, trigger presence, private-table permissions, service-only RPCs, referral protection, response backfill integrity, and supporting-listing projection. It lists scheduler states and protected queued/previously-started cleanup entries for review. Ledger/checkpoint counts should remain at their preflight values while MarketCheck is disabled. Recompare baseline immutable rows/files; verify Storage policies against the reviewed catalog. Do not call dispatch, cleanup, or provider RPCs as a production schema probe.

8. Complete the separately authorized compatible application release/smoke procedure before reopening traffic. Keep MarketCheck key absent; use `/health` for the disabled revision's startup/liveness. `/ready` may intentionally fail closed for missing account/key configuration. Verify existing free/paid case resume, downloads, staff access, and response/follow-up/resolution paths with approved test accounts. This rehearsal did not deploy or authorize traffic switching.
9. Resume traffic and ordinary workers only after compatibility checks. Resume only approved scheduler jobs. Resume abandoned-guest cleanup last, after its dry-run/review and no unresolved protected entries with prior file deletion. Cancelled/quarantined protected candidates must never be manually forced through deletion.
10. MarketCheck remains disabled. Live account readiness, key binding, and the first live canary require a separate task. Allowance, billing dates, usage-before-tracking, rate limits, tariffs, and retention permissions remain unresolved; no values were invented here.

### Read-only preflight examples

Run under `BEGIN READ ONLY` using the approved database connection. Exact production volumes must be observed then; the local timings cannot supply them.

```sql
begin read only;
select version,name from supabase_migrations.schema_migrations order by version;
select relname,n_live_tup as estimated_rows,pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables where schemaname='public' order by pg_total_relation_size(relid) desc;
select case_id,negotiation_round_id,count(*) from public.total_loss_communications
where direction='inbound' and communication_type='insurer_response' and supersedes_communication_id is null
 group by case_id,negotiation_round_id having count(*)>1;
select case_id,supersedes_communication_id,count(*) from public.total_loss_communications
where direction='inbound' and communication_type='insurer_response' and supersedes_communication_id is not null
 group by case_id,supersedes_communication_id having count(*)>1;
select originating_communication_id,count(*) from public.total_loss_negotiation_rounds
where originating_communication_id is not null group by originating_communication_id having count(*)>1;
select message_draft_id,count(*) from public.total_loss_message_versions
where purpose='follow_up_reconsideration' and message_state='customer_reported_sent'
 group by message_draft_id having count(*)>1;
select current_task,count(*) from public.total_loss_claim_workflows group by current_task;
select status,count(*) from public.total_loss_claim_documents where document_kind='insurer_response' group by status;
select state,count(*) from public.anonymous_guest_cleanup_candidates group by state;
select pid,state,wait_event_type,wait_event,clock_timestamp()-xact_start as transaction_age
from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start is not null;
select jobname,active,schedule from cron.job where jobname like 'venfour-%' order by jobname;
rollback;
```

At the response-analysis stage, inspect `total_loss_insurer_response_analysis_jobs` for terminal `INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID` jobs before the recovery migration if that schema already has data. At the normal 29-migration cutoff this table does not yet exist.

## Recovery

The whole batch is **not** one transaction. Successful earlier migrations remain committed if a later file fails. Keep writers/cleanup stopped, save the error and migration history, and make a narrowly reviewed forward repair from the last committed state. Do not delete immutable records, drop new tables, reset migration history, or attempt an invented down migration. A database rollback/PITR requires an explicit recovery plan for writes since the restore point and coordination with file storage/payment side effects. An old application revision is not automatically compatible with changed RPC return types.

Any protected candidate whose file deletion had already started before protection is quarantined for manual investigation. This migration prevents future deletion; it cannot recreate previously removed bytes.

## Reproduce locally

Use a fresh container name and output directory. The controller requires the existing local Supabase stack and cached image; it rejects non-rehearsal target names and creates targets with network disabled. It never uses the linked Supabase CLI.

```sh
python3 -B scripts/rehearse_production_migrations.py \
  --container venfour-migration-rehearsal-check --output /tmp/venfour-rollout-check
node scripts/verify_rehearsal_cleanup.mjs venfour-migration-rehearsal-check /tmp/venfour-rollout-check
python3 -B scripts/run_isolated_database_tests.py \
  --container venfour-migration-rehearsal-check --output /tmp/venfour-rollout-check/database-tests
python3 -B scripts/run_isolated_database_tests.py \
  --container venfour-migration-rehearsal-check --output /tmp/venfour-rollout-check/customer-resume \
  supabase/tests/rehearsal/verify_customer_resume.sql
python3 -B supabase/tests/concurrency/referral_cleanup_races.py --container venfour-migration-rehearsal-check
python3 -B supabase/tests/concurrency/market_request_budget_races.py --container venfour-migration-rehearsal-check
.venv/bin/python -B scripts/verify_rehearsal_market_accounting.py --container venfour-migration-rehearsal-check
node scripts/run_cleanup_tests.mjs
.venv/bin/python -B scripts/run_offline_tests.py
npm --prefix frontend test -- --run --maxWorkers=2
```

The actual full backend/frontend/cleanup-unit runs additionally used macOS `sandbox-exec` with outbound networking denied. Each evidence directory contains migration logs/hashes, baseline/final snapshots, file hashes, backfill checks, and workflow results. Final raw evidence for this run is `/tmp/venfour-rollout-proof`; a persistent summary/log bundle accompanies the handoff.
