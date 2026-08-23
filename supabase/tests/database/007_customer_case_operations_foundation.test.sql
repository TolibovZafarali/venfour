begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

select ok(
  to_regtype('public.case_operation_stage') is not null,
  'case_operation_stage exists'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.case_operation_stage'::regtype
  ),
  array[
    'intake_not_started',
    'intake_in_progress',
    'report_uploaded',
    'report_required',
    'ready_for_analysis',
    'analysis_processing',
    'analysis_failed',
    'analysis_complete',
    'submitted',
    'closed',
    'needs_attention'
  ]::text[],
  'case_operation_stage contains only the current computed read-model stages'
);

select columns_are(
  'public',
  'profiles',
  array[
    'id',
    'display_name',
    'created_at',
    'updated_at',
    'full_name_confirmed_at',
    'service_terms_version',
    'service_terms_acknowledged_at',
    'privacy_notice_version',
    'privacy_notice_acknowledged_at',
    'operational_follow_up_allowed',
    'operational_follow_up_updated_at'
  ],
  'profiles contains the minimal confirmed-name, acknowledgement, and follow-up fields'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.confirm_customer_profile(text,text,text,boolean)'::regprocedure
  ),
  'profile confirmation is a volatile search-path-pinned SECURITY DEFINER function'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.has_current_customer_profile()'::regprocedure
  ),
  'profile readiness is a stable search-path-pinned SECURITY DEFINER check'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and 'search_path=""' = any(procedure.proconfig)
      and pg_get_functiondef(procedure.oid) like '%pg_advisory_xact_lock%'
    from pg_proc as procedure
    where procedure.oid =
      'public.get_or_create_total_loss_draft()'::regprocedure
  ),
  'the Total-Loss draft resolver is volatile, locked, pinned, and SECURITY DEFINER'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.list_owned_case_operations()'::regprocedure
  ),
  'the owner caseStage projection is stable, pinned, and SECURITY DEFINER'
);

select ok(
  (
    select bool_and(
      procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    )
    from pg_proc as procedure
    where procedure.oid in (
      'public.staff_list_case_operations()'::regprocedure,
      'public.staff_get_total_loss_case_operation(uuid)'::regprocedure
    )
  ),
  'both staff projections are stable, pinned, and SECURITY DEFINER'
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
  'the broad internal operation view is not browser- or service-role-readable'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.protect_confirmed_customer_name()'::regprocedure,
      'public.has_current_customer_profile()'::regprocedure,
      'public.confirm_customer_profile(text,text,text,boolean)'::regprocedure,
      'public.get_or_create_total_loss_draft()'::regprocedure,
      'public.list_owned_case_operations()'::regprocedure,
      'public.staff_list_case_operations()'::regprocedure,
      'public.staff_get_total_loss_case_operation(uuid)'::regprocedure
    )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any customer-operations function'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.has_current_customer_profile()',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.confirm_customer_profile(text,text,text,boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.get_or_create_total_loss_draft()',
      'EXECUTE'
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
  'authenticated clients receive only the intended RPC surface'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.has_current_customer_profile()',
    'EXECUTE'
  )
    and not has_function_privilege(
      'service_role',
      'public.confirm_customer_profile(text,text,text,boolean)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.get_or_create_total_loss_draft()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.list_owned_case_operations()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.staff_list_case_operations()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.staff_get_total_loss_case_operation(uuid)',
      'EXECUTE'
    ),
  'service credentials cannot impersonate the customer or browser staff RPC surface'
);

select ok(
  (
    select policy.cmd = 'INSERT'
      and policy.roles = array['authenticated']::name[]
      and policy.with_check like '%auth.uid()%user_id%'
      and policy.with_check not like '%service_type%'
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'appraisal_cases'
      and policy.policyname = 'Customers can create their own cases'
  ),
  'the legacy owned direct-insert policy remains rollout-compatible for both services'
);

select ok(
  not exists (
    select 1
    from pg_policies as policy
    where policy.policyname like 'Staff can %'
      and policy.tablename in (
        'profiles',
        'total_loss_case_details',
        'total_loss_analysis_jobs',
        'analysis_runs'
      )
  ),
  'new staff projections add no broad direct-table RLS policy'
);

select ok(
  position(
    'artifact' in lower(
      pg_get_function_result(
        'public.staff_get_total_loss_case_operation(uuid)'::regprocedure
      )
    )
  ) = 0
    and position(
      'report_upload_id' in lower(
        pg_get_function_result(
          'public.staff_get_total_loss_case_operation(uuid)'::regprocedure
        )
      )
    ) = 0
    and position(
      'processing_token' in lower(
        pg_get_function_result(
          'public.staff_get_total_loss_case_operation(uuid)'::regprocedure
        )
      )
    ) = 0,
  'staff detail exposes no raw artifact, report token, or worker lease token'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '71111111-1111-4111-8111-111111111111',
    'owner-one@example.test',
    statement_timestamp(),
    '{"full_name":"OAuth Suggested Name"}'::jsonb
  ),
  (
    '72222222-2222-4222-8222-222222222222',
    'owner-two@example.test',
    statement_timestamp(),
    '{}'::jsonb
  ),
  (
    '73333333-3333-4333-8333-333333333333',
    'staff-reviewer@example.test',
    statement_timestamp(),
    '{}'::jsonb
  ),
  (
    '74444444-4444-4444-8444-444444444444',
    'unverified@example.test',
    null,
    '{}'::jsonb
  );

set local role authenticated;
set local request.jwt.claim.sub = '71111111-1111-4111-8111-111111111111';

select is(
  public.has_current_customer_profile(),
  false,
  'Auth metadata alone does not silently confirm a customer profile'
);

select throws_ok(
  $$
    select public.confirm_customer_profile(
      'Owner One',
      '2026-08-22',
      '2026-08-23',
      false
    )
  $$,
  '22023',
  'The current service and privacy versions must be acknowledged.',
  'profile confirmation rejects a stale service-terms version'
);

select lives_ok(
  $$
    select public.confirm_customer_profile(
      '  Owner   One  ',
      '2026-08-23',
      '2026-08-23',
      false
    )
  $$,
  'a verified customer can confirm their full name, acknowledgements, and explicit opt-out'
);

select is(
  public.has_current_customer_profile(),
  true,
  'the completed current profile is immediately recognized'
);

select results_eq(
  $$
    select
      display_name,
      full_name_confirmed_at is not null,
      service_terms_version,
      service_terms_acknowledged_at is not null,
      privacy_notice_version,
      privacy_notice_acknowledged_at is not null,
      operational_follow_up_allowed,
      operational_follow_up_updated_at is not null
    from public.profiles
    where id = '71111111-1111-4111-8111-111111111111'
  $$,
  $$
    values (
      'Owner One'::text,
      true,
      '2026-08-23'::text,
      true,
      '2026-08-23'::text,
      true,
      false,
      true
    )
  $$,
  'the profile stores normalized confirmed identity and separately timestamped policy/preference facts'
);

select throws_ok(
  $$
    update public.profiles
    set display_name = 'OAuth Replacement'
    where id = '71111111-1111-4111-8111-111111111111'
  $$,
  '42501',
  'A confirmed customer name must be changed through the profile-confirmation workflow.',
  'a confirmed name cannot be silently replaced through the old direct profile column grant'
);

reset role;

update auth.users
set raw_user_meta_data = '{"full_name":"Changed OAuth Metadata"}'::jsonb
where id = '71111111-1111-4111-8111-111111111111';

select is(
  (
    select display_name
    from public.profiles
    where id = '71111111-1111-4111-8111-111111111111'
  ),
  'Owner One',
  'later OAuth metadata cannot override the persisted confirmed name'
);

set local role authenticated;
set local request.jwt.claim.sub = '74444444-4444-4444-8444-444444444444';

select throws_ok(
  $$
    select public.confirm_customer_profile(
      'Unverified User',
      '2026-08-23',
      '2026-08-23',
      true
    )
  $$,
  '42501',
  'A verified Auth email is required to confirm a customer profile.',
  'an unverified Auth email cannot complete a customer profile'
);

set local request.jwt.claim.sub = '71111111-1111-4111-8111-111111111111';

create temporary table first_total_loss_draft as
select (public.get_or_create_total_loss_draft()).id as case_id;

select is(
  (
    select count(*)
    from public.appraisal_cases
    where user_id = '71111111-1111-4111-8111-111111111111'
      and service_type = 'total_loss'
      and status = 'draft'
  ),
  1::bigint,
  'the atomic resolver creates one owned Total-Loss draft before intake or upload'
);

select is(
  (select (public.get_or_create_total_loss_draft()).id),
  (select case_id from first_total_loss_draft),
  'refresh or re-entry resolves the same server draft'
);

select is(
  (
    select count(*)
    from public.appraisal_cases
    where user_id = '71111111-1111-4111-8111-111111111111'
      and service_type = 'total_loss'
      and status = 'draft'
  ),
  1::bigint,
  'repeated resolution does not create duplicate drafts'
);

select lives_ok(
  $$
    insert into public.appraisal_cases (
      id,
      user_id,
      service_type
    )
    values (
      '79000000-0000-4000-8000-000000000001',
      '71111111-1111-4111-8111-111111111111',
      'total_loss'
    )
  $$,
  'the legacy owned Total-Loss direct-insert policy remains available during the staged rollout'
);

-- Management API preflights may execute this entire file as one command, so
-- statement_timestamp() cannot establish insertion order between the drafts.
update public.appraisal_cases
set last_activity_at = '2099-01-01 00:00:00+00'
where id = '79000000-0000-4000-8000-000000000001';

select is(
  (select (public.get_or_create_total_loss_draft()).id),
  '79000000-0000-4000-8000-000000000001'::uuid,
  'the resolver deterministically selects the newest preexisting duplicate draft'
);

select results_eq(
  $$
    select case_id, owner_user_id
    from public.list_owned_case_operations()
    where case_id = (select case_id from first_total_loss_draft)
      or case_id = '79000000-0000-4000-8000-000000000001'
  $$,
  $$
    values (
      '79000000-0000-4000-8000-000000000001'::uuid,
      '71111111-1111-4111-8111-111111111111'::uuid
    )
  $$,
  'the owner read model exposes only the same newest recoverable duplicate and states its owner explicitly'
);

select is(
  (
    select count(*)
    from public.appraisal_cases
    where user_id = '71111111-1111-4111-8111-111111111111'
      and service_type = 'total_loss'
      and status = 'draft'
  ),
  2::bigint,
  'duplicate canonicalization is non-destructive'
);

select lives_ok(
  $$
    insert into public.appraisal_cases (
      id,
      user_id,
      service_type
    )
    values (
      '7e000000-0000-4000-8000-000000000001',
      '71111111-1111-4111-8111-111111111111',
      'diminished_value'
    )
  $$,
  'the existing owned Diminished Value direct-insert contract remains available'
);

set local request.jwt.claim.sub = '72222222-2222-4222-8222-222222222222';

select throws_ok(
  $$select public.get_or_create_total_loss_draft()$$,
  '42501',
  'A current confirmed customer profile is required to prepare a total-loss draft.',
  'draft creation is blocked until the authenticated customer confirms the required profile facts'
);

reset role;

-- Replace the resolver-created case with deterministic operation fixtures.
delete from public.appraisal_cases
where id = (select case_id from first_total_loss_draft)
  or id = '79000000-0000-4000-8000-000000000001';

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status,
  last_activity_at
)
values
  ('7a000000-0000-4000-8000-000000000001', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:01:00+00'),
  ('7a000000-0000-4000-8000-000000000002', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:02:00+00'),
  ('7a000000-0000-4000-8000-000000000003', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:03:00+00'),
  ('7a000000-0000-4000-8000-000000000004', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:04:00+00'),
  ('7a000000-0000-4000-8000-000000000005', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:05:00+00'),
  ('7a000000-0000-4000-8000-000000000006', '71111111-1111-4111-8111-111111111111', 'total_loss', 'checking', '2026-08-23 01:06:00+00'),
  ('7a000000-0000-4000-8000-000000000007', '71111111-1111-4111-8111-111111111111', 'total_loss', 'checking', '2026-08-23 01:07:00+00'),
  ('7a000000-0000-4000-8000-000000000008', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:08:00+00'),
  ('7a000000-0000-4000-8000-000000000009', '71111111-1111-4111-8111-111111111111', 'total_loss', 'check_complete', '2026-08-23 01:09:00+00'),
  ('7a000000-0000-4000-8000-000000000010', '71111111-1111-4111-8111-111111111111', 'total_loss', 'check_complete', '2026-08-23 01:10:00+00'),
  ('7a000000-0000-4000-8000-000000000011', '71111111-1111-4111-8111-111111111111', 'total_loss', 'checking', '2026-08-23 01:11:00+00'),
  ('7a000000-0000-4000-8000-000000000012', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:12:00+00'),
  ('7a000000-0000-4000-8000-000000000013', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:13:00+00'),
  ('7a000000-0000-4000-8000-000000000014', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:14:00+00'),
  ('7a000000-0000-4000-8000-000000000015', '72222222-2222-4222-8222-222222222222', 'total_loss', 'draft', '2026-08-23 01:15:00+00'),
  ('7a000000-0000-4000-8000-000000000016', '71111111-1111-4111-8111-111111111111', 'total_loss', 'draft', '2026-08-23 01:16:00+00'),
  ('7e000000-0000-4000-8000-000000000002', '71111111-1111-4111-8111-111111111111', 'diminished_value', 'submitted', '2026-08-23 01:16:00+00'),
  ('7e000000-0000-4000-8000-000000000003', '71111111-1111-4111-8111-111111111111', 'diminished_value', 'draft', '2026-08-23 01:17:00+00');

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  postal_code,
  intake_completed_at,
  report_original_filename,
  report_uploaded_at,
  report_last_upload_id,
  report_upload_id,
  report_upload_expires_at,
  report_upload_details_updated_at,
  report_upload_phase
)
values
  ('7a000000-0000-4000-8000-000000000002', 'report', null, null, null, null, null, null, null, null, null),
  ('7a000000-0000-4000-8000-000000000003', 'report', '60601', null, 'uploaded.pdf', '2026-08-23 02:03:00+00', '7b000000-0000-4000-8000-000000000003', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000004', 'report', '60601', '2026-08-23 02:04:00+00', 'ready.pdf', '2026-08-23 02:04:00+00', '7b000000-0000-4000-8000-000000000004', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000005', 'manual', '60601', '2026-08-23 02:05:00+00', null, null, null, null, null, null, null),
  ('7a000000-0000-4000-8000-000000000006', 'report', '60601', '2026-08-23 02:06:00+00', 'processing.pdf', '2026-08-23 02:06:00+00', '7b000000-0000-4000-8000-000000000006', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000007', 'report', '60601', '2026-08-23 02:07:00+00', 'expired.pdf', '2026-08-23 02:07:00+00', '7b000000-0000-4000-8000-000000000007', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000008', 'report', '60601', '2026-08-23 02:08:00+00', 'failed.pdf', '2026-08-23 02:08:00+00', '7b000000-0000-4000-8000-000000000008', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000009', 'report', '60601', '2026-08-23 02:09:00+00', 'complete.pdf', '2026-08-23 02:09:00+00', '7b000000-0000-4000-8000-000000000009', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000010', 'report', '60601', '2026-08-23 02:10:00+00', 'missing-run.pdf', '2026-08-23 02:10:00+00', '7b000000-0000-4000-8000-000000000010', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000011', 'report', '60601', '2026-08-23 02:11:00+00', 'replacement.pdf', '2026-08-23 02:11:00+00', '7b000000-0000-4000-8000-000000000011', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000012', 'report', '60601', '2026-08-23 02:12:00+00', 'missing-object.pdf', '2026-08-23 02:12:00+00', '7b000000-0000-4000-8000-000000000012', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000013', 'report', 'ABCDE', '2026-08-23 02:13:00+00', 'invalid-postal.pdf', '2026-08-23 02:13:00+00', '7b000000-0000-4000-8000-000000000013', null, null, null, null),
  ('7a000000-0000-4000-8000-000000000014', 'report', null, null, null, null, null, '7b000000-0000-4000-8000-000000000014', statement_timestamp() - interval '1 minute', statement_timestamp(), 'preparing'),
  ('7a000000-0000-4000-8000-000000000016', 'report', '60601', '2026-08-23 02:16:00+00', 'partial.pdf', null, null, null, null, null, null);

insert into storage.objects (bucket_id, name, user_metadata)
select
  'case-files',
  '71111111-1111-4111-8111-111111111111/' || source.case_id::text || '/valuation-report.pdf',
  jsonb_build_object('uploadId', source.upload_id::text)
from (
  values
    ('7a000000-0000-4000-8000-000000000003'::uuid, '7b000000-0000-4000-8000-000000000003'::uuid),
    ('7a000000-0000-4000-8000-000000000004'::uuid, '7b000000-0000-4000-8000-000000000004'::uuid),
    ('7a000000-0000-4000-8000-000000000006'::uuid, '7b000000-0000-4000-8000-000000000006'::uuid),
    ('7a000000-0000-4000-8000-000000000007'::uuid, '7b000000-0000-4000-8000-000000000007'::uuid),
    ('7a000000-0000-4000-8000-000000000008'::uuid, '7b000000-0000-4000-8000-000000000008'::uuid),
    ('7a000000-0000-4000-8000-000000000009'::uuid, '7b000000-0000-4000-8000-000000000009'::uuid),
    ('7a000000-0000-4000-8000-000000000010'::uuid, '7b000000-0000-4000-8000-000000000010'::uuid),
    ('7a000000-0000-4000-8000-000000000011'::uuid, '7b000000-0000-4000-8000-000000000011'::uuid),
    ('7a000000-0000-4000-8000-000000000013'::uuid, '7b000000-0000-4000-8000-000000000013'::uuid)
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
  ('7c000000-0000-4000-8000-000000000006', '7a000000-0000-4000-8000-000000000006', '7b000000-0000-4000-8000-000000000006', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000006'), 'processing', 2, '7f000000-0000-4000-8000-000000000006', statement_timestamp() + interval '1 hour', '7d000000-0000-4000-8000-000000000006', null, null, null),
  ('7c000000-0000-4000-8000-000000000007', '7a000000-0000-4000-8000-000000000007', '7b000000-0000-4000-8000-000000000007', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000007'), 'processing', 1, '7f000000-0000-4000-8000-000000000007', statement_timestamp() - interval '1 minute', '7d000000-0000-4000-8000-000000000007', null, null, null),
  ('7c000000-0000-4000-8000-000000000008', '7a000000-0000-4000-8000-000000000008', '7b000000-0000-4000-8000-000000000008', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000008'), 'failed', 3, '7f000000-0000-4000-8000-000000000008', null, '7d000000-0000-4000-8000-000000000008', 'PROVIDER_TIMEOUT', true, statement_timestamp()),
  ('7c000000-0000-4000-8000-000000000009', '7a000000-0000-4000-8000-000000000009', '7b000000-0000-4000-8000-000000000009', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000009'), 'completed', 1, '7f000000-0000-4000-8000-000000000009', null, '7d000000-0000-4000-8000-000000000009', null, null, statement_timestamp()),
  ('7c000000-0000-4000-8000-000000000010', '7a000000-0000-4000-8000-000000000010', '7b000000-0000-4000-8000-000000000010', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000010'), 'completed', 1, '7f000000-0000-4000-8000-000000000010', null, '7d000000-0000-4000-8000-000000000010', null, null, statement_timestamp()),
  ('7c000000-0000-4000-8000-000000000110', '7a000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000110', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000011'), 'failed', 1, '7f000000-0000-4000-8000-000000000110', null, '7d000000-0000-4000-8000-000000000110', 'OLD_REPORT_FAILURE', false, statement_timestamp()),
  ('7c000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000011', '7b000000-0000-4000-8000-000000000011', (select updated_at from public.total_loss_case_details where case_id = '7a000000-0000-4000-8000-000000000011'), 'processing', 4, '7f000000-0000-4000-8000-000000000011', statement_timestamp() + interval '1 hour', '7d000000-0000-4000-8000-000000000011', null, null, null);

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
values (
  '7d000000-0000-4000-8000-000000000009',
  '7c000000-0000-4000-8000-000000000009',
  '7a000000-0000-4000-8000-000000000009',
  jsonb_build_object(
    'runId', '7d000000-0000-4000-8000-000000000009',
    'result', jsonb_build_object(
      'discrepancyResult', jsonb_build_object(
        'classification', 'MATERIAL_UNDERVALUE_SIGNAL',
        'evidenceStrength', 'STRONG',
        'evidenceBasis', 'LOSS_DATE_HISTORICAL'
      )
    )
  ),
  repeat('a', 64),
  '4',
  '4',
  '1',
  '1'
);

insert into public.diminished_value_case_details (
  case_id,
  full_name,
  email,
  submitted_at
)
values
  (
    '7e000000-0000-4000-8000-000000000002',
    'Submitted Case Name',
    'non-authoritative-case-email@example.test',
    statement_timestamp()
  ),
  (
    '7e000000-0000-4000-8000-000000000003',
    'Draft Case Name',
    'draft-case-email@example.test',
    null
  );

set local role service_role;

insert into public.staff_members (user_id)
values ('71111111-1111-4111-8111-111111111111');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '71111111-1111-4111-8111-111111111111';

select results_eq(
  $$
    select case_id, case_stage::text, needs_attention
    from public.staff_list_case_operations()
    where case_id in (
      '7a000000-0000-4000-8000-000000000001',
      '7a000000-0000-4000-8000-000000000002',
      '7a000000-0000-4000-8000-000000000003',
      '7a000000-0000-4000-8000-000000000004',
      '7a000000-0000-4000-8000-000000000005'
    )
    order by case_id
  $$,
  $$
    values
      ('7a000000-0000-4000-8000-000000000001'::uuid, 'intake_not_started'::text, false),
      ('7a000000-0000-4000-8000-000000000002'::uuid, 'intake_in_progress'::text, false),
      ('7a000000-0000-4000-8000-000000000003'::uuid, 'report_uploaded'::text, false),
      ('7a000000-0000-4000-8000-000000000004'::uuid, 'ready_for_analysis'::text, false),
      ('7a000000-0000-4000-8000-000000000005'::uuid, 'report_required'::text, false)
  $$,
  'pre-analysis facts map deterministically without using placeholder payment states'
);

select results_eq(
  $$
    select case_id, case_stage::text, needs_attention
    from public.staff_list_case_operations()
    where case_id in (
      '7a000000-0000-4000-8000-000000000006',
      '7a000000-0000-4000-8000-000000000007',
      '7a000000-0000-4000-8000-000000000008',
      '7a000000-0000-4000-8000-000000000009',
      '7a000000-0000-4000-8000-000000000010'
    )
    order by case_id
  $$,
  $$
    values
      ('7a000000-0000-4000-8000-000000000006'::uuid, 'analysis_processing'::text, false),
      ('7a000000-0000-4000-8000-000000000007'::uuid, 'needs_attention'::text, true),
      ('7a000000-0000-4000-8000-000000000008'::uuid, 'analysis_failed'::text, true),
      ('7a000000-0000-4000-8000-000000000009'::uuid, 'analysis_complete'::text, false),
      ('7a000000-0000-4000-8000-000000000010'::uuid, 'needs_attention'::text, true)
  $$,
  'processing, expired processing, failure, completion, and completed-without-run map safely'
);

select results_eq(
  $$
    select
      case_id,
      case_stage::text,
      needs_attention,
      analysis_status::text,
      analysis_attempt_count,
      analysis_failure_code
    from public.staff_list_case_operations()
    where case_id = '7a000000-0000-4000-8000-000000000011'
  $$,
  $$
    values (
      '7a000000-0000-4000-8000-000000000011'::uuid,
      'analysis_processing'::text,
      false,
      'processing'::text,
      4,
      null::text
    )
  $$,
  'caseStage follows only the job for the current finalized replacement upload'
);

select results_eq(
  $$
    select case_id, case_stage::text, needs_attention
    from public.staff_list_case_operations()
    where case_id in (
      '7a000000-0000-4000-8000-000000000012',
      '7a000000-0000-4000-8000-000000000013',
      '7a000000-0000-4000-8000-000000000014',
      '7a000000-0000-4000-8000-000000000016'
    )
    order by case_id
  $$,
  $$
    values
      ('7a000000-0000-4000-8000-000000000012'::uuid, 'needs_attention'::text, true),
      ('7a000000-0000-4000-8000-000000000013'::uuid, 'needs_attention'::text, true),
      ('7a000000-0000-4000-8000-000000000014'::uuid, 'needs_attention'::text, true),
      ('7a000000-0000-4000-8000-000000000016'::uuid, 'needs_attention'::text, true)
  $$,
  'missing canonical report, invalid postal, expired upload, and incomplete finalized triples surface attention'
);

select is(
  (
    select count(*)
    from public.staff_list_case_operations()
    where owner_user_id = '71111111-1111-4111-8111-111111111111'
      and service_type = 'total_loss'
      and case_status = 'draft'
  ),
  10::bigint,
  'staff retains visibility of every preexisting duplicate Total-Loss draft'
);

select results_eq(
  $$
    select count(*)
    from public.list_owned_case_operations()
    where case_id = '7a000000-0000-4000-8000-000000000015'
  $$,
  $$values (0::bigint)$$,
  'the owner projection never leaks another customer case identifier'
);

select results_eq(
  $$
    select case_id, case_stage::text
    from public.list_owned_case_operations()
    where case_id in (
      '7e000000-0000-4000-8000-000000000002',
      '7e000000-0000-4000-8000-000000000003'
    )
    order by case_id
  $$,
  $$
    values
      ('7e000000-0000-4000-8000-000000000002'::uuid, 'submitted'::text),
      ('7e000000-0000-4000-8000-000000000003'::uuid, 'intake_in_progress'::text)
  $$,
  'the owner projection preserves submitted and draft DV read behavior'
);

reset role;
set local role service_role;

delete from public.staff_members
where user_id = '71111111-1111-4111-8111-111111111111';

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '71111111-1111-4111-8111-111111111111';

select results_eq(
  $$select count(*) from public.staff_list_case_operations()$$,
  $$values (0::bigint)$$,
  'an ordinary customer cannot invoke the staff list projection'
);

select results_eq(
  $$
    select count(*)
    from public.staff_get_total_loss_case_operation(
      '7a000000-0000-4000-8000-000000000009'
    )
  $$,
  $$values (0::bigint)$$,
  'an ordinary customer cannot invoke staff detail even for their own case'
);

reset role;
set local role service_role;

insert into public.staff_members (user_id)
values ('73333333-3333-4333-8333-333333333333');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '73333333-3333-4333-8333-333333333333';

select is(
  public.is_venfour_staff(),
  true,
  'the database membership grants staff access'
);

select results_eq(
  $$
    select count(*)
    from public.staff_list_case_operations()
    where service_type = 'diminished_value'
  $$,
  $$values (1::bigint)$$,
  'the combined staff list preserves submitted-only DV scope and excludes DV drafts'
);

select results_eq(
  $$
    select customer_full_name, verified_email, case_stage::text
    from public.staff_list_case_operations()
    where case_id = '7e000000-0000-4000-8000-000000000002'
  $$,
  $$
    values (
      'Owner One'::text,
      'owner-one@example.test'::text,
      'submitted'::text
    )
  $$,
  'the staff list uses confirmed profile name and verified Auth email rather than the DV email copy'
);

select results_eq(
  $$
    select
      customer_full_name,
      verified_email,
      operational_follow_up_allowed,
      case_stage::text,
      analysis_status::text,
      analysis_attempt_count,
      analysis_run_id,
      analysis_run_schema_version,
      analysis_version,
      discrepancy_analysis_version,
      comparable_scoring_version,
      analysis_classification,
      analysis_evidence_strength,
      analysis_evidence_basis
    from public.staff_get_total_loss_case_operation(
      '7a000000-0000-4000-8000-000000000009'
    )
  $$,
  $$
    values (
      'Owner One'::text,
      'owner-one@example.test'::text,
      false,
      'analysis_complete'::text,
      'completed'::text,
      1,
      '7d000000-0000-4000-8000-000000000009'::uuid,
      '4'::text,
      '4'::text,
      '1'::text,
      '1'::text,
      'MATERIAL_UNDERVALUE_SIGNAL'::text,
      'STRONG'::text,
      'LOSS_DATE_HISTORICAL'::text
    )
  $$,
  'staff detail returns bounded identity, preference, job, run, and analysis-summary facts'
);

select results_eq(
  $$
    select count(*)
    from public.staff_get_total_loss_case_operation(
      '7e000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values (0::bigint)$$,
  'the Total-Loss staff detail returns no row for a DV identifier'
);

select results_eq(
  $$
    select count(*)
    from public.staff_get_total_loss_case_operation(
      '70000000-0000-4000-8000-000000000099'
    )
  $$,
  $$values (0::bigint)$$,
  'the staff detail returns no row for a nonexistent identifier'
);

select results_eq(
  $$select count(*) from public.profiles where id = '71111111-1111-4111-8111-111111111111'$$,
  $$values (0::bigint)$$,
  'staff receives no direct customer profile table access'
);

select results_eq(
  $$select count(*) from public.total_loss_case_details$$,
  $$values (0::bigint)$$,
  'staff receives no direct Total-Loss details table access'
);

select throws_ok(
  $$select * from public.total_loss_analysis_jobs$$,
  '42501',
  null,
  'staff receives no direct analysis-job table grant'
);

select throws_ok(
  $$select * from public.analysis_runs$$,
  '42501',
  null,
  'staff receives no direct immutable analysis-artifact table grant'
);

reset role;
set local role service_role;

delete from public.staff_members
where user_id = '73333333-3333-4333-8333-333333333333';

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '73333333-3333-4333-8333-333333333333';

select is(
  public.is_venfour_staff(),
  false,
  'same-token staff revocation is immediately authoritative'
);

select results_eq(
  $$select count(*) from public.staff_list_case_operations()$$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses the combined case list'
);

select results_eq(
  $$
    select count(*)
    from public.staff_get_total_loss_case_operation(
      '7a000000-0000-4000-8000-000000000009'
    )
  $$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses Total-Loss detail using the same token'
);

select * from finish();
rollback;
