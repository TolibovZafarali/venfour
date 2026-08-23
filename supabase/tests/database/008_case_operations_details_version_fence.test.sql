begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

select is(
  regexp_count(
    pg_get_viewdef('public.total_loss_case_operations_internal'::regclass),
    'analysis_job.source_details_updated_at = details.updated_at'
  ),
  3,
  'completed, processing, and failed operation stages require the exact current details version'
);

select ok(
  (
    select 'security_invoker=true' = any(relation.reloptions)
    from pg_class as relation
    where relation.oid =
      'public.total_loss_case_operations_internal'::regclass
  ),
  'the replaced internal operations view remains security-invoker'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.total_loss_case_operations_internal',
    'SELECT'
  )
    and not has_table_privilege(
      'service_role',
      'public.total_loss_case_operations_internal',
      'SELECT'
    ),
  'the replaced internal view retains its bounded RPC-only access boundary'
);

select ok(
  (
    select count(*) = 3
      and bool_and(
        procedure.prosecdef
        and procedure.provolatile = 's'
        and 'search_path=""' = any(procedure.proconfig)
      )
    from pg_proc as procedure
    where procedure.oid in (
      'public.list_owned_case_operations()'::regprocedure,
      'public.staff_list_case_operations()'::regprocedure,
      'public.staff_get_total_loss_case_operation(uuid)'::regprocedure
    )
  )
    and has_function_privilege(
      'authenticated',
      'public.list_owned_case_operations()',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.staff_list_case_operations()',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.staff_get_total_loss_case_operation(uuid)',
      'EXECUTE'
    ),
  'the follow-up preserves all owner and staff RPC signatures, security, and grants'
);

insert into auth.users (id, email, email_confirmed_at)
values
  (
    '81111111-1111-4111-8111-111111111111',
    'details-version-owner@example.test',
    statement_timestamp()
  ),
  (
    '82222222-2222-4222-8222-222222222222',
    'details-version-staff@example.test',
    statement_timestamp()
  );

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status,
  last_activity_at
)
values
  (
    '8a000000-0000-4000-8000-000000000001',
    '81111111-1111-4111-8111-111111111111',
    'total_loss',
    'checking',
    '2026-08-23 08:01:00+00'
  ),
  (
    '8a000000-0000-4000-8000-000000000002',
    '81111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    '2026-08-23 08:02:00+00'
  ),
  (
    '8a000000-0000-4000-8000-000000000003',
    '81111111-1111-4111-8111-111111111111',
    'total_loss',
    'check_complete',
    '2026-08-23 08:03:00+00'
  ),
  (
    '8a000000-0000-4000-8000-000000000004',
    '81111111-1111-4111-8111-111111111111',
    'total_loss',
    'check_complete',
    '2026-08-23 08:04:00+00'
  );

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  postal_code,
  intake_completed_at,
  report_original_filename,
  report_uploaded_at,
  report_last_upload_id,
  updated_at
)
values
  (
    '8a000000-0000-4000-8000-000000000001',
    'report',
    '60601',
    '2026-08-23 07:01:00+00',
    'stale-processing.pdf',
    '2026-08-23 07:01:00+00',
    '8b000000-0000-4000-8000-000000000001',
    '2026-08-23 07:11:00+00'
  ),
  (
    '8a000000-0000-4000-8000-000000000002',
    'report',
    '60601',
    '2026-08-23 07:02:00+00',
    'stale-failed.pdf',
    '2026-08-23 07:02:00+00',
    '8b000000-0000-4000-8000-000000000002',
    '2026-08-23 07:12:00+00'
  ),
  (
    '8a000000-0000-4000-8000-000000000003',
    'report',
    '60601',
    '2026-08-23 07:03:00+00',
    'stale-completed.pdf',
    '2026-08-23 07:03:00+00',
    '8b000000-0000-4000-8000-000000000003',
    '2026-08-23 07:13:00+00'
  ),
  (
    '8a000000-0000-4000-8000-000000000004',
    'report',
    '60601',
    '2026-08-23 07:04:00+00',
    'fresh-completed.pdf',
    '2026-08-23 07:04:00+00',
    '8b000000-0000-4000-8000-000000000004',
    '2026-08-23 07:14:00+00'
  );

insert into storage.objects (bucket_id, name, user_metadata)
select
  'case-files',
  '81111111-1111-4111-8111-111111111111/'
    || source.case_id::text || '/valuation-report.pdf',
  jsonb_build_object('uploadId', source.upload_id::text)
from (
  values
    (
      '8a000000-0000-4000-8000-000000000001'::uuid,
      '8b000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '8a000000-0000-4000-8000-000000000002'::uuid,
      '8b000000-0000-4000-8000-000000000002'::uuid
    ),
    (
      '8a000000-0000-4000-8000-000000000003'::uuid,
      '8b000000-0000-4000-8000-000000000003'::uuid
    ),
    (
      '8a000000-0000-4000-8000-000000000004'::uuid,
      '8b000000-0000-4000-8000-000000000004'::uuid
    )
) as source(case_id, upload_id);

insert into public.total_loss_analysis_jobs (
  id,
  case_id,
  source_report_upload_id,
  source_details_updated_at,
  status,
  attempt_count,
  processing_token,
  processing_expires_at,
  run_id,
  failure_code,
  retryable,
  finished_at
)
values
  (
    '8c000000-0000-4000-8000-000000000001',
    '8a000000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '2026-08-23 07:01:00+00',
    'processing',
    1,
    '8f000000-0000-4000-8000-000000000001',
    statement_timestamp() + interval '1 hour',
    '8d000000-0000-4000-8000-000000000001',
    null,
    null,
    null
  ),
  (
    '8c000000-0000-4000-8000-000000000002',
    '8a000000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000002',
    '2026-08-23 07:02:00+00',
    'failed',
    2,
    '8f000000-0000-4000-8000-000000000002',
    null,
    '8d000000-0000-4000-8000-000000000002',
    'STALE_INPUT',
    true,
    statement_timestamp()
  ),
  (
    '8c000000-0000-4000-8000-000000000003',
    '8a000000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000003',
    '2026-08-23 07:03:00+00',
    'completed',
    1,
    '8f000000-0000-4000-8000-000000000003',
    null,
    '8d000000-0000-4000-8000-000000000003',
    null,
    null,
    statement_timestamp()
  ),
  (
    '8c000000-0000-4000-8000-000000000004',
    '8a000000-0000-4000-8000-000000000004',
    '8b000000-0000-4000-8000-000000000004',
    '2026-08-23 07:14:00+00',
    'completed',
    1,
    '8f000000-0000-4000-8000-000000000004',
    null,
    '8d000000-0000-4000-8000-000000000004',
    null,
    null,
    statement_timestamp()
  );

insert into public.analysis_runs (
  id,
  job_id,
  case_id,
  artifact,
  request_digest,
  analysis_run_schema_version,
  analysis_version,
  discrepancy_analysis_version,
  comparable_scoring_version
)
values
  (
    '8d000000-0000-4000-8000-000000000003',
    '8c000000-0000-4000-8000-000000000003',
    '8a000000-0000-4000-8000-000000000003',
    '{"runId":"8d000000-0000-4000-8000-000000000003"}'::jsonb,
    repeat('c', 64),
    '4',
    '4',
    '1',
    '1'
  ),
  (
    '8d000000-0000-4000-8000-000000000004',
    '8c000000-0000-4000-8000-000000000004',
    '8a000000-0000-4000-8000-000000000004',
    '{"runId":"8d000000-0000-4000-8000-000000000004"}'::jsonb,
    repeat('d', 64),
    '4',
    '4',
    '1',
    '1'
  );

set local role authenticated;
set local request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';

select results_eq(
  $$
    select
      case_id,
      case_stage::text,
      needs_attention,
      analysis_status::text
    from public.list_owned_case_operations()
    where case_id between
      '8a000000-0000-4000-8000-000000000001'
      and '8a000000-0000-4000-8000-000000000004'
    order by case_id
  $$,
  $$
    values
      (
        '8a000000-0000-4000-8000-000000000001'::uuid,
        'needs_attention'::text,
        true,
        'processing'::text
      ),
      (
        '8a000000-0000-4000-8000-000000000002'::uuid,
        'needs_attention'::text,
        true,
        'failed'::text
      ),
      (
        '8a000000-0000-4000-8000-000000000003'::uuid,
        'needs_attention'::text,
        true,
        'completed'::text
      ),
      (
        '8a000000-0000-4000-8000-000000000004'::uuid,
        'analysis_complete'::text,
        false,
        'completed'::text
      )
  $$,
  'owner stages reject processing, failed, and completed jobs over stale details while preserving a fresh completion'
);

reset role;
set local role service_role;

insert into public.staff_members (user_id)
values ('82222222-2222-4222-8222-222222222222');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '82222222-2222-4222-8222-222222222222';

select results_eq(
  $$
    select case_id, case_stage::text, needs_attention
    from public.staff_list_case_operations()
    where case_id between
      '8a000000-0000-4000-8000-000000000001'
      and '8a000000-0000-4000-8000-000000000004'
    order by case_id
  $$,
  $$
    values
      (
        '8a000000-0000-4000-8000-000000000001'::uuid,
        'needs_attention'::text,
        true
      ),
      (
        '8a000000-0000-4000-8000-000000000002'::uuid,
        'needs_attention'::text,
        true
      ),
      (
        '8a000000-0000-4000-8000-000000000003'::uuid,
        'needs_attention'::text,
        true
      ),
      (
        '8a000000-0000-4000-8000-000000000004'::uuid,
        'analysis_complete'::text,
        false
      )
  $$,
  'staff list uses the same details-version-fenced stage projection'
);

select results_eq(
  $$
    select
      case_stage::text,
      needs_attention,
      analysis_status::text,
      analysis_run_id
    from public.staff_get_total_loss_case_operation(
      '8a000000-0000-4000-8000-000000000003'
    )
  $$,
  $$
    values (
      'needs_attention'::text,
      true,
      'completed'::text,
      '8d000000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  'staff detail retains bounded stale job/run evidence but never labels it complete'
);

select results_eq(
  $$
    select
      case_stage::text,
      needs_attention,
      analysis_status::text,
      analysis_run_id
    from public.staff_get_total_loss_case_operation(
      '8a000000-0000-4000-8000-000000000004'
    )
  $$,
  $$
    values (
      'analysis_complete'::text,
      false,
      'completed'::text,
      '8d000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  'an exact current details version still produces analysis_complete'
);

select * from finish();
rollback;
