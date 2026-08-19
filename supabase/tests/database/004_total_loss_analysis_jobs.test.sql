begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(63);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.total_loss_analysis_status'::regtype
  ),
  array['processing', 'completed', 'failed']::text[],
  'analysis jobs have the three contracted states'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.total_loss_analysis_outcome'::regtype
  ),
  array[
    'claimed',
    'not_submitted',
    'processing',
    'completed',
    'failed',
    'not_found',
    'report_intake_required',
    'intake_not_ready',
    'postal_code_required',
    'invalid_postal_code',
    'report_required',
    'case_not_ready'
  ]::text[],
  'analysis RPC outcomes are closed and typed'
);

select is(
  (
    select array_agg(attribute.attname::text order by attribute.attnum)
    from pg_type as composite_type
    join pg_attribute as attribute
      on attribute.attrelid = composite_type.typrelid
    where composite_type.oid = 'public.total_loss_analysis_result'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  array[
    'outcome',
    'job_id',
    'status',
    'attempt_count',
    'run_id',
    'postal_code',
    'failure_code',
    'retryable',
    'processing_expires_at'
  ]::text[],
  'claim and status expose exactly the contracted row keys'
);

select has_table('public', 'total_loss_analysis_jobs', 'analysis jobs table exists');
select has_table('public', 'analysis_runs', 'immutable analysis runs table exists');

select ok(
  (select relation.relrowsecurity from pg_class as relation where relation.oid = 'public.total_loss_analysis_jobs'::regclass),
  'analysis jobs have RLS enabled'
);

select ok(
  (select relation.relrowsecurity from pg_class as relation where relation.oid = 'public.analysis_runs'::regclass),
  'analysis runs have RLS enabled'
);

select has_index(
  'public',
  'total_loss_analysis_jobs',
  'total_loss_analysis_jobs_case_source_key',
  'case and finalized report upload form the natural idempotency key'
);

select has_index(
  'public',
  'total_loss_analysis_jobs',
  'total_loss_analysis_jobs_one_processing_per_case_idx',
  'only one processing job is permitted per case'
);

select ok(
  not has_table_privilege('anon', 'public.total_loss_analysis_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.total_loss_analysis_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.total_loss_analysis_jobs', 'INSERT')
    and not has_table_privilege('authenticated', 'public.total_loss_analysis_jobs', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.total_loss_analysis_jobs', 'DELETE'),
  'browser roles have no analysis-job table surface'
);

select ok(
  not has_table_privilege('anon', 'public.analysis_runs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.analysis_runs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.analysis_runs', 'INSERT')
    and not has_table_privilege('authenticated', 'public.analysis_runs', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.analysis_runs', 'DELETE'),
  'browser roles cannot read or mutate raw analysis artifacts'
);

select ok(
  has_table_privilege('service_role', 'public.total_loss_analysis_jobs', 'SELECT')
    and has_table_privilege('service_role', 'public.analysis_runs', 'SELECT')
    and not has_table_privilege('service_role', 'public.analysis_runs', 'UPDATE'),
  'the service role can inspect coordination state but cannot update immutable runs'
);

select ok(
  to_regprocedure('public.claim_total_loss_analysis(uuid,uuid,uuid)') is not null
    and to_regprocedure('public.get_total_loss_analysis_status(uuid,uuid)') is not null
    and to_regprocedure('public.complete_total_loss_analysis(uuid,uuid,uuid,jsonb)') is not null
    and to_regprocedure('public.fail_total_loss_analysis(uuid,uuid,text,boolean)') is not null
    and to_regprocedure('public.get_owned_analysis_run(uuid,uuid)') is not null,
  'all five trusted analysis RPCs exist with the contracted signatures'
);

select ok(
  (
    select bool_and(procedure.prosecdef)
    from pg_proc as procedure
    where procedure.oid in (
      'public.claim_total_loss_analysis(uuid,uuid,uuid)'::regprocedure,
      'public.get_total_loss_analysis_status(uuid,uuid)'::regprocedure,
      'public.complete_total_loss_analysis(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.fail_total_loss_analysis(uuid,uuid,text,boolean)'::regprocedure,
      'public.get_owned_analysis_run(uuid,uuid)'::regprocedure
    )
  ),
  'analysis RPCs are SECURITY DEFINER'
);

select ok(
  (
    select bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid in (
      'public.claim_total_loss_analysis(uuid,uuid,uuid)'::regprocedure,
      'public.get_total_loss_analysis_status(uuid,uuid)'::regprocedure,
      'public.complete_total_loss_analysis(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.fail_total_loss_analysis(uuid,uuid,text,boolean)'::regprocedure,
      'public.get_owned_analysis_run(uuid,uuid)'::regprocedure
    )
  ),
  'analysis RPCs pin an empty search path'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.claim_total_loss_analysis(uuid,uuid,uuid)'::regprocedure,
      'public.get_total_loss_analysis_status(uuid,uuid)'::regprocedure,
      'public.complete_total_loss_analysis(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.fail_total_loss_analysis(uuid,uuid,text,boolean)'::regprocedure,
      'public.get_owned_analysis_run(uuid,uuid)'::regprocedure
    )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE privilege on analysis RPCs'
);

select ok(
  not has_function_privilege('anon', 'public.claim_total_loss_analysis(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_total_loss_analysis(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_owned_analysis_run(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_owned_analysis_run(uuid,uuid)', 'EXECUTE'),
  'browser roles cannot invoke analysis coordination or artifact RPCs'
);

select ok(
  has_function_privilege('service_role', 'public.claim_total_loss_analysis(uuid,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_total_loss_analysis_status(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.complete_total_loss_analysis(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.fail_total_loss_analysis(uuid,uuid,text,boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_owned_analysis_run(uuid,uuid)', 'EXECUTE'),
  'only the trusted service role receives the analysis RPC surface'
);

insert into auth.users (id, email)
values
  ('41111111-1111-4111-8111-111111111111', 'analysis-owner@example.test'),
  ('42222222-2222-4222-8222-222222222222', 'analysis-other@example.test');

insert into public.appraisal_cases (id, user_id, service_type, status)
values
  ('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('4ddddddd-dddd-4ddd-8ddd-ddddddddddd4', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('4fffffff-ffff-4fff-8fff-fffffffffff6', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('40000000-0000-4000-8000-000000000007', '41111111-1111-4111-8111-111111111111', 'total_loss', 'paid'),
  ('40000000-0000-4000-8000-000000000008', '41111111-1111-4111-8111-111111111111', 'diminished_value', 'draft'),
  ('40000000-0000-4000-8000-000000000009', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft'),
  ('40000000-0000-4000-8000-000000000010', '41111111-1111-4111-8111-111111111111', 'total_loss', 'draft');

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  postal_code,
  report_original_filename,
  report_uploaded_at,
  report_last_upload_id,
  intake_completed_at,
  created_at,
  updated_at
)
values
  ('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'report', '60601', 'valid.pdf', '2026-08-19 01:00:00+00', 'aaaaaaaa-2000-4000-8000-000000000001', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'manual', '60601', null, null, null, '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'report', '60601', 'incomplete.pdf', '2026-08-19 01:00:00+00', 'aaaaaaaa-2000-4000-8000-000000000003', null, '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('4ddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'report', null, null, null, null, '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', 'report', 'ABCDE', null, null, null, '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('4fffffff-ffff-4fff-8fff-fffffffffff6', 'report', '60601', null, null, null, '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('40000000-0000-4000-8000-000000000007', 'report', '60601', 'paid.pdf', '2026-08-19 01:00:00+00', 'aaaaaaaa-2000-4000-8000-000000000007', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00'),
  ('40000000-0000-4000-8000-000000000010', 'report', '60601-1234', 'replacement.pdf', '2026-08-19 01:00:00+00', 'aaaaaaaa-2000-4000-8000-000000000010', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00', '2026-08-19 01:01:00+00');

insert into storage.objects (bucket_id, name, user_metadata)
values
  ('case-files', '41111111-1111-4111-8111-111111111111/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/valuation-report.pdf', '{"uploadId":"aaaaaaaa-2000-4000-8000-000000000001"}'::jsonb),
  ('case-files', '41111111-1111-4111-8111-111111111111/40000000-0000-4000-8000-000000000007/valuation-report.pdf', '{"uploadId":"aaaaaaaa-2000-4000-8000-000000000007"}'::jsonb),
  ('case-files', '41111111-1111-4111-8111-111111111111/40000000-0000-4000-8000-000000000010/valuation-report.pdf', '{"uploadId":"aaaaaaaa-2000-4000-8000-000000000010"}'::jsonb);

set local role service_role;

select is(
  (select outcome::text from public.claim_total_loss_analysis('40000000-0000-4000-8000-000000000009', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000009')),
  'report_intake_required',
  'claim treats absent details as a report-intake conflict, not an unsubmitted job'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000002')),
  'report_intake_required',
  'claim rejects manual intake for the report analysis pipeline'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000003')),
  'intake_not_ready',
  'claim requires the persisted intake completion marker'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('4ddddddd-dddd-4ddd-8ddd-ddddddddddd4', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000004')),
  'postal_code_required',
  'claim requires a ZIP code'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000005')),
  'invalid_postal_code',
  'claim validates five-digit and ZIP+4 formats'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('4fffffff-ffff-4fff-8fff-fffffffffff6', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000006')),
  'report_required',
  'claim requires finalized report metadata and the canonical object'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('40000000-0000-4000-8000-000000000007', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000007')),
  'case_not_ready',
  'claim rejects a non-draft case with no reusable job'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('40000000-0000-4000-8000-000000000008', '41111111-1111-4111-8111-111111111111', 'bbbbbbbb-2000-4000-8000-000000000008')),
  'not_found',
  'claim does not expose a diminished-value case through the total-loss surface'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '42222222-2222-4222-8222-222222222222', 'bbbbbbbb-2000-4000-8000-000000000001')),
  'not_found',
  'claim verifies the explicit trusted owner ID'
);

select results_eq(
  $$
    select outcome::text, status::text, attempt_count, postal_code,
      run_id is not null, processing_expires_at > statement_timestamp() + interval '119 minutes'
    from public.claim_total_loss_analysis(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000001'
    )
  $$,
  $$values ('claimed'::text, 'processing'::text, 1, '60601'::text, true, true)$$,
  'a valid report claim reserves a stable run and a two-hour processing lease'
);

reset role;

select is(
  (select status::text from public.appraisal_cases where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'checking',
  'claim atomically advances the case to checking'
);

select ok(
  (
    select source_report_upload_id = 'aaaaaaaa-2000-4000-8000-000000000001'::uuid
      and source_details_updated_at = '2026-08-19 01:01:00+00'::timestamptz
    from public.total_loss_analysis_jobs
    where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'the job snapshots the finalized upload identity and details version'
);

set local role service_role;

select results_eq(
  $$
    select outcome::text, attempt_count
    from public.claim_total_loss_analysis(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000001'
    )
  $$,
  $$values ('claimed'::text, 1)$$,
  'replaying the same live processing token is idempotent'
);

select results_eq(
  $$
    select outcome::text, attempt_count
    from public.claim_total_loss_analysis(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000011'
    )
  $$,
  $$values ('processing'::text, 1)$$,
  'a competing token observes active work without stealing its lease'
);

select results_eq(
  $$
    select outcome::text, status::text, attempt_count, postal_code
    from public.get_total_loss_analysis_status(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111'
    )
  $$,
  $$values ('processing'::text, 'processing'::text, 1, '60601'::text)$$,
  'status returns the owned current-source processing job'
);

select is(
  (select outcome::text from public.get_total_loss_analysis_status('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '42222222-2222-4222-8222-222222222222')),
  'not_found',
  'status does not expose a job to another owner'
);

select is(
  (select outcome::text from public.get_total_loss_analysis_status('40000000-0000-4000-8000-000000000009', '41111111-1111-4111-8111-111111111111')),
  'not_submitted',
  'status reserves not_submitted for an owned case without a current-source job'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '41111111-1111-4111-8111-111111111111';

select throws_ok(
  $$select * from public.total_loss_analysis_jobs$$,
  '42501',
  null,
  'authenticated code cannot bypass RPCs to inspect processing tokens'
);

select throws_ok(
  $$select * from public.get_owned_analysis_run('aaaaaaaa-3000-4000-8000-000000000001', '41111111-1111-4111-8111-111111111111')$$,
  '42501',
  null,
  'authenticated code cannot call the raw artifact RPC'
);

select results_eq(
  $$
    with changed as (
      update public.total_loss_case_details
      set postal_code = '60602'
      where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'customer intake writes are blocked while the case is checking'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    select public.fail_total_loss_analysis(
      (select id from public.total_loss_analysis_jobs where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
      'bbbbbbbb-2000-4000-8000-000000000001',
      'unsafe provider message',
      true
    )
  $$,
  '22023',
  null,
  'failure transition rejects free-form error text'
);

select is(
  public.fail_total_loss_analysis(
    (select id from public.total_loss_analysis_jobs where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    'bbbbbbbb-2000-4000-8000-000000000099',
    'REPORT_UNAVAILABLE',
    true
  ),
  false,
  'a wrong processing token cannot fail a job'
);

select is(
  public.fail_total_loss_analysis(
    (select id from public.total_loss_analysis_jobs where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    'bbbbbbbb-2000-4000-8000-000000000001',
    'REPORT_UNAVAILABLE',
    true
  ),
  true,
  'the active token records a safe retryable failure'
);

select is(
  public.fail_total_loss_analysis(
    (select id from public.total_loss_analysis_jobs where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    'bbbbbbbb-2000-4000-8000-000000000001',
    'REPORT_UNAVAILABLE',
    true
  ),
  true,
  'an exact failure replay is idempotent'
);

select results_eq(
  $$
    select outcome::text, status::text, failure_code, retryable
    from public.get_total_loss_analysis_status(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111'
    )
  $$,
  $$values ('failed'::text, 'failed'::text, 'REPORT_UNAVAILABLE'::text, true)$$,
  'status exposes only the safe failure contract'
);

select results_eq(
  $$
    select outcome::text, attempt_count
    from public.claim_total_loss_analysis(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000012'
    )
  $$,
  $$values ('claimed'::text, 2)$$,
  'a retryable failed job is reclaimed as its next attempt'
);

reset role;

select is(
  (select status::text from public.appraisal_cases where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'checking',
  'retry atomically restores checking state'
);

create temporary table analysis_identity as
select id as job_id, run_id
from public.total_loss_analysis_jobs
where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

grant select on table pg_temp.analysis_identity to service_role;

update public.total_loss_analysis_jobs
set processing_expires_at = statement_timestamp() - interval '1 second'
where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

set local role service_role;

select results_eq(
  $$
    select outcome::text, attempt_count,
      run_id = (select run_id from pg_temp.analysis_identity)
    from public.claim_total_loss_analysis(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000013'
    )
  $$,
  $$values ('claimed'::text, 3, true)$$,
  'an expired lease rotates its token while preserving the reserved run ID'
);

select is(
  public.complete_total_loss_analysis(
    (select job_id from pg_temp.analysis_identity),
    'bbbbbbbb-2000-4000-8000-000000000012',
    (select run_id from pg_temp.analysis_identity),
    '{}'::jsonb
  ),
  false,
  'lease takeover fences the prior worker token'
);

reset role;

create temporary table analysis_artifact as
select
  identity.job_id,
  identity.run_id,
  jsonb_build_object(
    'analysisRunSchemaVersion', '4',
    'runId', identity.run_id::text,
    'createdAt', '2026-08-19T02:00:00Z',
    'analysisVersion', '4',
    'discrepancyAnalysisVersion', '1',
    'comparableScoringVersion', '1',
    'requestDigest', repeat('a', 64),
    'searchDiagnosticsDigest', repeat('b', 64),
    'providers', '{}'::jsonb,
    'request', '{}'::jsonb,
    'result', '{}'::jsonb
  ) as artifact
from pg_temp.analysis_identity as identity;

grant select on table pg_temp.analysis_artifact to service_role;

update public.total_loss_analysis_jobs
set processing_expires_at = statement_timestamp() - interval '1 second'
where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

set local role service_role;

select is(
  public.complete_total_loss_analysis(
    (select job_id from pg_temp.analysis_artifact),
    'bbbbbbbb-2000-4000-8000-000000000013',
    (select run_id from pg_temp.analysis_artifact),
    (select artifact from pg_temp.analysis_artifact)
  ),
  true,
  'an un-reclaimed current token may finish after expiry under the row lock'
);

select is(
  public.complete_total_loss_analysis(
    (select job_id from pg_temp.analysis_artifact),
    'bbbbbbbb-2000-4000-8000-000000000013',
    (select run_id from pg_temp.analysis_artifact),
    (select artifact from pg_temp.analysis_artifact)
  ),
  true,
  'exact completion replay is idempotent'
);

select is(
  public.complete_total_loss_analysis(
    (select job_id from pg_temp.analysis_artifact),
    'bbbbbbbb-2000-4000-8000-000000000013',
    (select run_id from pg_temp.analysis_artifact),
    (select artifact || '{"unexpected":true}'::jsonb from pg_temp.analysis_artifact)
  ),
  false,
  'a conflicting terminal replay is rejected'
);

select is(
  (select outcome::text from public.get_total_loss_analysis_status('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '41111111-1111-4111-8111-111111111111')),
  'completed',
  'status reports completed for the current source'
);

select is(
  public.get_owned_analysis_run(
    (select run_id from pg_temp.analysis_artifact),
    '41111111-1111-4111-8111-111111111111'
  ),
  (select artifact from pg_temp.analysis_artifact),
  'the trusted backend can retrieve an artifact for its verified owner'
);

select is(
  public.get_owned_analysis_run(
    (select run_id from pg_temp.analysis_artifact),
    '42222222-2222-4222-8222-222222222222'
  ),
  null::jsonb,
  'artifact retrieval returns null for a different owner'
);

reset role;

select results_eq(
  $$
    select request_digest, search_diagnostics_digest,
      analysis_run_schema_version, analysis_version,
      discrepancy_analysis_version, comparable_scoring_version
    from public.analysis_runs
    where case_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$values (repeat('a', 64), repeat('b', 64), '4'::text, '4'::text, '1'::text, '1'::text)$$,
  'completion extracts digest and version metadata from the artifact'
);

select is(
  (select status::text from public.appraisal_cases where id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'check_complete',
  'completion atomically advances the case'
);

select throws_ok(
  $$update public.analysis_runs set artifact = artifact || '{"tampered":true}'::jsonb$$,
  '55000',
  'Analysis runs are immutable.',
  'even a privileged direct update is blocked by the immutable-run trigger'
);

set local role authenticated;
set local request.jwt.claim.sub = '41111111-1111-4111-8111-111111111111';

select is(
  public.authorize_total_loss_report_backup_delete(
    '41111111-1111-4111-8111-111111111111/4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/valuation-report-backup.pdf',
    '{"uploadId":"aaaaaaaa-2000-4000-8000-000000000001"}'::jsonb
  ),
  false,
  'reserved report backup writes are not authorized after draft state'
);

reset role;

create temporary table replacement_claim (
  outcome text not null,
  run_id uuid not null
);

grant insert, select on table pg_temp.replacement_claim to service_role;

set local role service_role;

select results_eq(
  $$
    select outcome::text, run_id = (select run_id from pg_temp.analysis_artifact)
    from public.claim_total_loss_analysis(
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000014'
    )
  $$,
  $$values ('completed'::text, true)$$,
  'claim reuses the completed current-source job and stable run ID'
);

insert into pg_temp.replacement_claim (outcome, run_id)
select outcome::text, run_id
from public.claim_total_loss_analysis(
  '40000000-0000-4000-8000-000000000010',
  '41111111-1111-4111-8111-111111111111',
  'bbbbbbbb-2000-4000-8000-000000000020'
);

select results_eq(
  $$
    select replacement.outcome, replacement.run_id = analysis_job.run_id
    from pg_temp.replacement_claim as replacement
    join public.total_loss_analysis_jobs as analysis_job
      on analysis_job.case_id = '40000000-0000-4000-8000-000000000010'
  $$,
  $$values ('claimed'::text, true)$$,
  'a second valid case can be claimed for replacement-source coverage'
);

select is(
  public.fail_total_loss_analysis(
    (select id from public.total_loss_analysis_jobs where case_id = '40000000-0000-4000-8000-000000000010'),
    'bbbbbbbb-2000-4000-8000-000000000020',
    'INVALID_REPORT',
    false
  ),
  true,
  'a non-retryable report failure releases the case to draft'
);

reset role;

update public.total_loss_case_details
set report_last_upload_id = 'aaaaaaaa-2000-4000-8000-000000000011'
where case_id = '40000000-0000-4000-8000-000000000010';

update storage.objects
set user_metadata = '{"uploadId":"aaaaaaaa-2000-4000-8000-000000000011"}'::jsonb
where bucket_id = 'case-files'
  and name = '41111111-1111-4111-8111-111111111111/40000000-0000-4000-8000-000000000010/valuation-report.pdf';

set local role service_role;

select is(
  (select outcome::text from public.get_total_loss_analysis_status('40000000-0000-4000-8000-000000000010', '41111111-1111-4111-8111-111111111111')),
  'not_submitted',
  'status ignores an old failed job after the finalized report source changes'
);

select results_eq(
  $$
    select outcome::text, status::text, attempt_count
    from public.claim_total_loss_analysis(
      '40000000-0000-4000-8000-000000000010',
      '41111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2000-4000-8000-000000000021'
    )
  $$,
  $$values ('claimed'::text, 'processing'::text, 1)$$,
  'a replacement finalized report receives a new natural-keyed job'
);

reset role;

select is(
  (select count(*) from public.total_loss_analysis_jobs where case_id = '40000000-0000-4000-8000-000000000010'),
  2::bigint,
  'replacement history retains the prior failed job without blocking new work'
);

select * from finish();
rollback;
