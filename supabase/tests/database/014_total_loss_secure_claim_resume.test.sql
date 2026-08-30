begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(51);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid =
      'public.total_loss_case_identity_claim_purpose'::regtype
  ),
  array['intake', 'post_continue']::text[],
  'identity claims use an explicit stable purpose enum'
);

select ok(
  not has_type_privilege(
    'anon',
    'public.total_loss_case_identity_claim_purpose',
    'USAGE'
  )
    and has_type_privilege(
      'authenticated',
      'public.total_loss_case_identity_claim_purpose',
      'USAGE'
    )
    and has_type_privilege(
      'service_role',
      'public.total_loss_case_identity_claim_purpose',
      'USAGE'
    ),
  'claim-purpose type usage is limited to trusted API roles'
);

select ok(
  (
    select attribute.attnotnull
      and pg_get_expr(default_value.adbin, default_value.adrelid)
        = '''intake''::total_loss_case_identity_claim_purpose'
    from pg_attribute as attribute
    join pg_attrdef as default_value
      on default_value.adrelid = attribute.attrelid
      and default_value.adnum = attribute.attnum
    where attribute.attrelid =
      'public.total_loss_case_identity_claims'::regclass
      and attribute.attname = 'purpose'
  ),
  'purpose is required and historical inserts default to intake'
);

select matches(
  (
    select pg_get_indexdef(index_record.indexrelid)
    from pg_index as index_record
    where index_record.indexrelid =
      'public.total_loss_case_identity_claims_one_live_idx'::regclass
  ),
  '\(case_id, purpose\).*WHERE.*claimed_at IS NULL.*revoked_at IS NULL',
  'one live capability is allowed per case and purpose'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid =
      'public.total_loss_case_access_recovery_rate_limits'::regclass
  )
    and not has_table_privilege(
      'authenticated',
      'public.total_loss_case_access_recovery_rate_limits',
      'SELECT'
    )
    and not has_table_privilege(
      'service_role',
      'public.total_loss_case_access_recovery_rate_limits',
      'SELECT'
    ),
  'the keyed-fingerprint throttle table has RLS and no direct API surface'
);

select ok(
  to_regprocedure('public.resolve_total_loss_case_claim(uuid)') is not null
    and to_regprocedure('public.renew_total_loss_case_claim(uuid)') is not null
    and to_regprocedure(
      'public.prepare_total_loss_case_access_recovery(uuid,text,text,text)'
    ) is not null
    and to_regprocedure(
      'public.complete_total_loss_case_claim_with_context(uuid)'
    ) is not null,
  'the secure/resume RPC signatures are stable'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_total_loss_case_claim(uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.renew_total_loss_case_claim(uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.complete_total_loss_case_claim_with_context(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.resolve_total_loss_case_claim(uuid)',
      'EXECUTE'
    ),
  'authenticated identities alone receive the owner-scoped secure/resume RPCs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.prepare_total_loss_case_access_recovery(uuid,text,text,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.prepare_total_loss_case_access_recovery(uuid,text,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.prepare_total_loss_case_access_recovery(uuid,text,text,text)',
      'EXECUTE'
    ),
  'only service_role can prepare enumeration-safe lost-session recovery'
);

select ok(
  (
    select count(*) = 4
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid = any (array[
      'public.resolve_total_loss_case_claim(uuid)'::regprocedure,
      'public.renew_total_loss_case_claim(uuid)'::regprocedure,
      'public.prepare_total_loss_case_access_recovery(uuid,text,text,text)'::regprocedure,
      'public.complete_total_loss_case_claim_with_context(uuid)'::regprocedure
    ])
  ),
  'all four exposed contracts are SECURITY DEFINER with a pinned empty search path'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.total_loss_post_continue_case_is_eligible_internal(uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'service_role',
      'public.complete_total_loss_case_claim_internal(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.consume_total_loss_recovery_rate_limit_internal(text,text,integer,interval)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.guard_total_loss_commerce_order_identity()',
      'EXECUTE'
    ),
  'internal eligibility, completion, and throttle helpers are not API-callable'
);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('c1000000-0000-4000-8000-000000000001', null, null, true),
  ('c1000000-0000-4000-8000-000000000002', null, null, true),
  (
    'c1000000-0000-4000-8000-000000000003',
    'secure@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-000000000004',
    'wrong@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-000000000005',
    'owned@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-000000000006',
    'owner-auth@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-000000000007',
    'intake@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-000000000008',
    'expired@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-000000000009',
    'changed@example.test', statement_timestamp(), false
  ),
  (
    'c1000000-0000-4000-8000-00000000000a',
    'commerce@example.test', statement_timestamp(), false
  );

create function pg_temp.create_secure_claim_case(
  requested_case_id uuid,
  requested_owner_id uuid,
  requested_email text,
  requested_classification text,
  include_snapshot boolean,
  requested_workflow_task text
)
returns void
language plpgsql
as $$
declare
  details_input_id uuid := gen_random_uuid();
  analysis_job_id uuid := gen_random_uuid();
  analysis_run_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  digest_value text :=
    replace(requested_case_id::text, '-', '')
      || replace(requested_case_id::text, '-', '');
begin
  insert into public.appraisal_cases (id, user_id, service_type, status)
  values (
    requested_case_id,
    requested_owner_id,
    'total_loss',
    'check_complete'
  );

  insert into public.total_loss_case_details (
    case_id,
    intake_mode,
    vin,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vehicle_trim,
    mileage_at_loss,
    postal_code,
    date_of_loss,
    insurer_name,
    insurer_vehicle_valuation,
    intake_completed_at,
    analysis_input_revision,
    analysis_input_id
  )
  values (
    requested_case_id,
    'manual',
    '1HGCM82633A004352',
    2022,
    'Honda',
    'Accord',
    'EX-L',
    32000,
    '60601',
    '2026-08-20',
    'Example Insurance',
    18000,
    statement_timestamp(),
    1,
    details_input_id
  );

  insert into public.total_loss_case_contacts (
    case_id,
    full_name,
    email,
    service_terms_version,
    service_terms_acknowledged_at,
    privacy_notice_version,
    privacy_notice_acknowledged_at,
    operational_follow_up_allowed,
    operational_follow_up_updated_at
  )
  values (
    requested_case_id,
    'Secure Claim Customer',
    requested_email,
    '2026-08-23',
    statement_timestamp(),
    '2026-08-23',
    statement_timestamp(),
    false,
    statement_timestamp()
  );

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
    finished_at,
    source_intake_mode,
    source_analysis_input_revision,
    source_analysis_input_id
  )
  values (
    analysis_job_id,
    requested_case_id,
    null,
    statement_timestamp(),
    'completed',
    1,
    gen_random_uuid(),
    null,
    analysis_run_id,
    null,
    null,
    statement_timestamp(),
    'manual',
    1,
    details_input_id
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
  values (
    analysis_run_id,
    analysis_job_id,
    requested_case_id,
    jsonb_build_object(
      'runId', analysis_run_id::text,
      'result', jsonb_build_object(
        'discrepancyResult', jsonb_build_object(
          'classification', requested_classification
        )
      )
    ),
    digest_value,
    '4',
    '4',
    '1',
    '1'
  );

  if include_snapshot then
    insert into public.total_loss_preliminary_snapshots (
      id,
      case_id,
      analysis_job_id,
      analysis_run_id,
      owner_user_id_at_snapshot,
      source_intake_mode,
      source_report_upload_id,
      source_analysis_input_revision,
      source_analysis_input_id,
      preliminary_classification,
      insurer_valuation_minor_units,
      supported_range_low_minor_units,
      supported_range_median_minor_units,
      supported_range_high_minor_units,
      currency,
      analysis_run_schema_version,
      analysis_version,
      discrepancy_analysis_version,
      comparable_scoring_version,
      presentation_schema_version,
      snapshot_schema_version,
      source_references,
      snapshot,
      snapshot_digest
    )
    values (
      snapshot_id,
      requested_case_id,
      analysis_job_id,
      analysis_run_id,
      requested_owner_id,
      'manual',
      null,
      1,
      details_input_id,
      requested_classification,
      1800000,
      2000000,
      2100000,
      2200000,
      'USD',
      '4',
      '4',
      '1',
      '1',
      '1',
      '1',
      jsonb_build_object('analysisRun', analysis_run_id::text),
      jsonb_build_object('classification', requested_classification),
      digest_value
    );

    if requested_workflow_task is not null then
      insert into public.total_loss_claim_workflows (
        case_id,
        preliminary_snapshot_id,
        phase,
        current_task
      )
      values (
        requested_case_id,
        snapshot_id,
        'review',
        requested_workflow_task
      );
    end if;
  end if;
end;
$$;

select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'secure@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  true,
  'secure_claim'
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000001',
  'not-worthwhile@example.test',
  'NO_MATERIAL_UNDERVALUE',
  true,
  null
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000003',
  'c1000000-0000-4000-8000-000000000001',
  'no-snapshot@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  false,
  null
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000004',
  'c1000000-0000-4000-8000-000000000005',
  'owned@example.test',
  'POTENTIAL_UNDERVALUE',
  true,
  null
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000005',
  'c1000000-0000-4000-8000-000000000006',
  'saved@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  true,
  null
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000006',
  'c1000000-0000-4000-8000-000000000001',
  'advanced@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  true,
  'review_result'
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000007',
  'c1000000-0000-4000-8000-00000000000a',
  'commerce@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  true,
  'secure_claim'
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000008',
  'c1000000-0000-4000-8000-000000000001',
  'expired@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  true,
  null
);
select pg_temp.create_secure_claim_case(
  'c2000000-0000-4000-8000-000000000009',
  'c1000000-0000-4000-8000-000000000001',
  'changed@example.test',
  'MATERIAL_UNDERVALUE_SIGNAL',
  true,
  null
);

update public.total_loss_analysis_jobs
set source_analysis_input_id = null
where case_id = 'c2000000-0000-4000-8000-000000000003';

insert into public.total_loss_preliminary_snapshots (
  id,
  case_id,
  analysis_job_id,
  analysis_run_id,
  owner_user_id_at_snapshot,
  source_intake_mode,
  source_report_upload_id,
  source_analysis_input_revision,
  source_analysis_input_id,
  preliminary_classification,
  insurer_valuation_minor_units,
  supported_range_low_minor_units,
  supported_range_median_minor_units,
  supported_range_high_minor_units,
  currency,
  analysis_run_schema_version,
  analysis_version,
  discrepancy_analysis_version,
  comparable_scoring_version,
  presentation_schema_version,
  snapshot_schema_version,
  source_references,
  snapshot,
  snapshot_digest
)
select
  'c5000000-0000-4000-8000-000000000003',
  analysis_job.case_id,
  analysis_job.id,
  analysis_job.run_id,
  appraisal_case.user_id,
  'manual',
  null,
  analysis_job.source_analysis_input_revision,
  null,
  'MATERIAL_UNDERVALUE_SIGNAL',
  1800000,
  2000000,
  2100000,
  2200000,
  'USD',
  '4',
  '4',
  '1',
  '1',
  '1',
  '1',
  jsonb_build_object('analysisRun', analysis_job.run_id::text),
  '{"classification":"MATERIAL_UNDERVALUE_SIGNAL"}'::jsonb,
  repeat('d', 64)
from public.total_loss_analysis_jobs as analysis_job
join public.appraisal_cases as appraisal_case
  on appraisal_case.id = analysis_job.case_id
where analysis_job.case_id = 'c2000000-0000-4000-8000-000000000003';

insert into public.appraisal_cases (id, user_id, service_type, status)
values (
  'c2000000-0000-4000-8000-00000000000a',
  'c1000000-0000-4000-8000-000000000001',
  'total_loss',
  'draft'
);

insert into public.total_loss_case_details (case_id, intake_mode)
values ('c2000000-0000-4000-8000-00000000000a', 'manual');

insert into public.total_loss_case_identity_claims (
  id,
  case_id,
  source_user_id,
  requested_email,
  expires_at
)
values (
  'c3000000-0000-4000-8000-00000000000a',
  'c2000000-0000-4000-8000-00000000000a',
  'c1000000-0000-4000-8000-000000000001',
  'intake@example.test',
  statement_timestamp() + interval '30 minutes'
);

insert into public.total_loss_case_identity_claims (
  id,
  case_id,
  source_user_id,
  requested_email,
  purpose,
  expires_at
)
values (
  'c3000000-0000-4000-8000-00000000000b',
  'c2000000-0000-4000-8000-00000000000a',
  'c1000000-0000-4000-8000-000000000001',
  'intake@example.test',
  'post_continue',
  statement_timestamp() + interval '30 minutes'
);

select is(
  (
    select purpose::text
    from public.total_loss_case_identity_claims
    where id = 'c3000000-0000-4000-8000-00000000000a'
  ),
  'intake'::text,
  'legacy-shaped claim inserts retain intake purpose'
);

select is(
  (
    select count(*)
    from public.total_loss_case_identity_claims
    where case_id = 'c2000000-0000-4000-8000-00000000000a'
      and claimed_at is null
      and revoked_at is null
  ),
  2::bigint,
  'one live intake and one live post-Continue claim can coexist'
);

select throws_ok(
  $$
    insert into public.total_loss_case_identity_claims (
      case_id, source_user_id, requested_email, purpose, expires_at
    )
    values (
      'c2000000-0000-4000-8000-00000000000a',
      'c1000000-0000-4000-8000-000000000001',
      'intake@example.test',
      'post_continue',
      statement_timestamp() + interval '30 minutes'
    )
  $$,
  '23505',
  null,
  'a second live claim for the same case and purpose is rejected'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select claim_id, email
    from public.save_total_loss_contact_and_begin_claim(
      'c2000000-0000-4000-8000-00000000000a',
      'Intake Customer',
      'intake@example.test',
      '2026-08-23',
      '2026-08-23',
      false
    )
  $$,
  $$
    values (
      'c3000000-0000-4000-8000-00000000000a'::uuid,
      'intake@example.test'::text
    )
  $$,
  'the existing intake save RPC reuses only the live intake-purpose claim'
);

reset role;

select is(
  (
    select count(*)
    from public.total_loss_case_identity_claims
    where case_id = 'c2000000-0000-4000-8000-00000000000a'
      and claimed_at is null
      and revoked_at is null
  ),
  2::bigint,
  'intake save leaves a distinct live post-Continue claim untouched'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000007';

select results_eq(
  $$
    select outcome, ownership_transferred
    from public.complete_total_loss_case_claim(
      'c3000000-0000-4000-8000-00000000000a'
    )
  $$,
  $$values ('claimed'::text, true)$$,
  'the legacy completion RPC still consumes and transfers an intake claim'
);

select results_eq(
  $$
    select outcome, claim_purpose::text, ownership_transferred
    from public.complete_total_loss_case_claim_with_context(
      'c3000000-0000-4000-8000-00000000000a'
    )
  $$,
  $$values ('already_claimed'::text, 'intake'::text, false)$$,
  'the purpose-aware completion projection reports trusted intake context on replay'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select
      state,
      case_id,
      contact_email,
      workflow_phase,
      workflow_current_task,
      workflow_revision
    from public.resolve_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  $$
    values (
      'secure_required'::text,
      'c2000000-0000-4000-8000-000000000001'::uuid,
      'secure@example.test'::text,
      'review'::text,
      'secure_claim'::text,
      1::bigint
    )
  $$,
  'the eligible anonymous owner receives authoritative secure-required state'
);

select is(
  (
    select count(*)
    from public.total_loss_claim_workflows
    where case_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'anonymous owners remain denied direct post-Continue workflow records'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000002';

select is(
  (
    select count(*)
    from public.resolve_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'another anonymous user receives owner-safe absence'
);

select is(
  (
    select count(*)
    from public.renew_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000001'
    )
  ),
  0::bigint,
  'a lost-session visitor cannot retrieve the saved email or verification capability'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000004';

select results_eq(
  $$
    select
      (
        select count(*)
        from public.resolve_total_loss_case_claim(
          'c2000000-0000-4000-8000-000000000001'
        )
      ),
      (
        select count(*)
        from public.renew_total_loss_case_claim(
          'c2000000-0000-4000-8000-000000000001'
        )
      )
  $$,
  $$values (0::bigint, 0::bigint)$$,
  'a wrong permanent account cannot discover the saved email or request its access link'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select state, case_id, contact_email, claim_id is not null,
      claim_expires_at > statement_timestamp()
    from public.renew_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000001'
    )
  $$,
  $$
    values (
      'secure_required'::text,
      'c2000000-0000-4000-8000-000000000001'::uuid,
      'secure@example.test'::text,
      true,
      true
    )
  $$,
  'eligible anonymous renewal issues a bounded post-Continue capability'
);

reset role;

select is(
  (
    select purpose::text
    from public.total_loss_case_identity_claims
    where case_id = 'c2000000-0000-4000-8000-000000000001'
      and claimed_at is null
      and revoked_at is null
  ),
  'post_continue'::text,
  'anonymous renewal stores the trusted post-Continue purpose'
);

select set_config(
  'test.post_continue_claim_id',
  (
    select id::text
    from public.total_loss_case_identity_claims
    where case_id = 'c2000000-0000-4000-8000-000000000001'
      and purpose = 'post_continue'
      and claimed_at is null
      and revoked_at is null
  ),
  true
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select is(
  (
    select claim_id
    from public.renew_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000001'
    )
  ),
  current_setting('test.post_continue_claim_id')::uuid,
  'renewal preserves an already-live valid magic-link capability'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000005';

select results_eq(
  $$
    select state, contact_email, workflow_phase
    from public.resolve_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000004'
    )
  $$,
  $$values ('secured'::text, 'owned@example.test'::text, null::text)$$,
  'a permanent exact-email owner is secured without relying on contact verification state'
);

select results_eq(
  $$
    select state, claim_id is null, claim_expires_at is null
    from public.renew_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000004'
    )
  $$,
  $$values ('secured'::text, true, true)$$,
  'a permanent exact-email owner is not asked to verify again'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000006';

select results_eq(
  $$
    select state, contact_email
    from public.resolve_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000005'
    )
  $$,
  $$values ('account_mismatch'::text, null::text)$$,
  'a permanent owner with a mismatched verified Auth email receives no saved email'
);

select results_eq(
  $$
    select state, contact_email, claim_id is null
    from public.renew_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000005'
    )
  $$,
  $$values ('account_mismatch'::text, null::text, true)$$,
  'a mismatched permanent owner cannot retrieve the saved email or mint a replacement transfer claim'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select
      (
        select count(*)
        from public.resolve_total_loss_case_claim(
          'c2000000-0000-4000-8000-000000000002'
        )
      ),
      (
        select count(*)
        from public.resolve_total_loss_case_claim(
          'c2000000-0000-4000-8000-000000000003'
        )
      )
  $$,
  $$values (0::bigint, 0::bigint)$$,
  'non-worthwhile results and legacy null-identity snapshots cannot bypass the exact current input fence'
);

select is(
  (
    select count(*)
    from public.resolve_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000006'
    )
  ),
  0::bigint,
  'an anonymous case whose workflow crossed secure-claim is unavailable'
);

select is(
  (
    select count(*)
    from public.renew_total_loss_case_claim(
      'c2000000-0000-4000-8000-000000000006'
    )
  ),
  0::bigint,
  'workflow advancement also prevents post-Continue capability renewal'
);

reset role;
set local role service_role;

select results_eq(
  $$
    select send_allowed, claim_id is null, claim_expires_at is null,
      requested_email is null
    from public.prepare_total_loss_case_access_recovery(
      'c2000000-0000-4000-8000-000000000001',
      'not-the-contact@example.test',
      repeat('1', 64),
      repeat('2', 64)
    )
  $$,
  $$values (false, true, true, true)$$,
  'a recovery non-match returns the same bounded non-sending shape'
);

select results_eq(
  $$
    select send_allowed, claim_id is not null,
      claim_expires_at > statement_timestamp(), requested_email
    from public.prepare_total_loss_case_access_recovery(
      'c2000000-0000-4000-8000-000000000001',
      ' Secure@Example.Test ',
      repeat('3', 64),
      repeat('4', 64)
    )
  $$,
  $$values (true, true, true, 'secure@example.test'::text)$$,
  'an exact eligible recovery match returns service-only delivery material'
);

select is(
  (
    select send_allowed
    from public.prepare_total_loss_case_access_recovery(
      'c2000000-0000-4000-8000-000000000001',
      'secure@example.test',
      repeat('3', 64),
      repeat('4', 64)
    )
  ),
  true,
  'the second target-window recovery request remains allowed'
);

select is(
  (
    select send_allowed
    from public.prepare_total_loss_case_access_recovery(
      'c2000000-0000-4000-8000-000000000001',
      'secure@example.test',
      repeat('3', 64),
      repeat('4', 64)
    )
  ),
  true,
  'the third target-window recovery request remains allowed'
);

select results_eq(
  $$
    select send_allowed, claim_id is null, requested_email is null
    from public.prepare_total_loss_case_access_recovery(
      'c2000000-0000-4000-8000-000000000001',
      'secure@example.test',
      repeat('3', 64),
      repeat('4', 64)
    )
  $$,
  $$values (false, true, true)$$,
  'the fourth target-window request is neutrally throttled'
);

reset role;

select ok(
  not exists (
    select 1
    from information_schema.columns as column_record
    where column_record.table_schema = 'public'
      and column_record.table_name =
        'total_loss_case_access_recovery_rate_limits'
      and column_record.column_name in (
        'email', 'requested_email', 'case_id', 'ip_address'
      )
  )
    and (
      select bool_and(fingerprint ~ '^[0-9a-f]{64}$')
      from public.total_loss_case_access_recovery_rate_limits
    ),
  'recovery throttles persist only opaque keyed fingerprints, never raw target data'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000004';

select throws_ok(
  $$
    select public.complete_total_loss_case_claim_with_context(
      current_setting('test.post_continue_claim_id')::uuid
    )
  $$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'a verified wrong email cannot consume the case-bound capability'
);

reset role;
update auth.users
set email_confirmed_at = null
where id = 'c1000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000003';

select throws_ok(
  $$
    select public.complete_total_loss_case_claim_with_context(
      current_setting('test.post_continue_claim_id')::uuid
    )
  $$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'an exact but unverified destination cannot consume the capability'
);

reset role;
update auth.users
set email_confirmed_at = statement_timestamp()
where id = 'c1000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000003';

select results_eq(
  $$
    select outcome, case_id, owner_user_id, contact_email,
      email_verified_at is not null, ownership_transferred,
      claim_purpose::text
    from public.complete_total_loss_case_claim_with_context(
      current_setting('test.post_continue_claim_id')::uuid
    )
  $$,
  $$
    values (
      'claimed'::text,
      'c2000000-0000-4000-8000-000000000001'::uuid,
      'c1000000-0000-4000-8000-000000000003'::uuid,
      'secure@example.test'::text,
      true,
      true,
      'post_continue'::text
    )
  $$,
  'a valid live post-Continue link transfers ownership without the old anonymous JWT'
);

select results_eq(
  $$
    select outcome, ownership_transferred, claim_purpose::text
    from public.complete_total_loss_case_claim_with_context(
      current_setting('test.post_continue_claim_id')::uuid
    )
  $$,
  $$values ('already_claimed'::text, false, 'post_continue'::text)$$,
  'an exact completed-link replay is idempotent and retains trusted purpose'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000004';

select throws_ok(
  $$
    select public.complete_total_loss_case_claim_with_context(
      current_setting('test.post_continue_claim_id')::uuid
    )
  $$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'a completed verification capability cannot be replayed by another permanent account'
);

set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select
      (
        select count(*)
        from public.resolve_total_loss_case_claim(
          'c2000000-0000-4000-8000-000000000001'
        )
      ),
      (
        select count(*)
        from public.renew_total_loss_case_claim(
          'c2000000-0000-4000-8000-000000000001'
        )
      )
  $$,
  $$values (0::bigint, 0::bigint)$$,
  'the former anonymous session loses email and verification-link access after ownership transfer'
);

reset role;

select ok(
  (
    select appraisal_case.user_id =
      'c1000000-0000-4000-8000-000000000003'::uuid
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = 'c2000000-0000-4000-8000-000000000001'
  )
    and (
      select contact.email_verified_at is not null
      from public.total_loss_case_contacts as contact
      where contact.case_id = 'c2000000-0000-4000-8000-000000000001'
    ),
  'successful completion atomically changes case ownership and verifies case contact'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000003';

select is(
  (
    select count(*)
    from public.total_loss_claim_workflows
    where case_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the new permanent owner resumes through the resolver, not the raw workflow table'
);

reset role;

insert into public.total_loss_case_identity_claims (
  id, case_id, source_user_id, requested_email, purpose,
  created_at, expires_at
)
values (
  'c3000000-0000-4000-8000-000000000008',
  'c2000000-0000-4000-8000-000000000008',
  'c1000000-0000-4000-8000-000000000001',
  'expired@example.test',
  'post_continue',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '30 minutes'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000008';

select throws_ok(
  $$
    select public.complete_total_loss_case_claim_with_context(
      'c3000000-0000-4000-8000-000000000008'
    )
  $$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'an expired post-Continue claim remains unusable'
);

reset role;

insert into public.total_loss_case_identity_claims (
  id, case_id, source_user_id, requested_email, purpose, expires_at
)
values (
  'c3000000-0000-4000-8000-000000000009',
  'c2000000-0000-4000-8000-000000000009',
  'c1000000-0000-4000-8000-000000000001',
  'changed@example.test',
  'post_continue',
  statement_timestamp() + interval '30 minutes'
);

update public.appraisal_cases
set user_id = 'c1000000-0000-4000-8000-000000000002'
where id = 'c2000000-0000-4000-8000-000000000009';

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000009';

select throws_ok(
  $$
    select public.complete_total_loss_case_claim_with_context(
      'c3000000-0000-4000-8000-000000000009'
    )
  $$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'a source-owner change invalidates an otherwise live exact-email claim'
);

reset role;

insert into public.commerce_orders (
  id,
  case_id,
  purchaser_user_id,
  preliminary_snapshot_id,
  product_identifier,
  product_version,
  amount_minor_units,
  currency,
  status,
  terms_version,
  refund_policy_version
)
select
  'c4000000-0000-4000-8000-000000000007',
  snapshot.case_id,
  'c1000000-0000-4000-8000-00000000000a',
  snapshot.id,
  'total-loss-package',
  '1',
  9900,
  'USD',
  'pending',
  '1',
  '1'
from public.total_loss_preliminary_snapshots as snapshot
where snapshot.case_id = 'c2000000-0000-4000-8000-000000000007';

update public.appraisal_cases
set user_id = 'c1000000-0000-4000-8000-000000000001'
where id = 'c2000000-0000-4000-8000-000000000007';

insert into public.total_loss_case_identity_claims (
  id, case_id, source_user_id, requested_email, purpose, expires_at
)
values (
  'c3000000-0000-4000-8000-000000000007',
  'c2000000-0000-4000-8000-000000000007',
  'c1000000-0000-4000-8000-000000000001',
  'commerce@example.test',
  'post_continue',
  statement_timestamp() + interval '30 minutes'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-00000000000a';

select throws_ok(
  $$
    select public.complete_total_loss_case_claim_with_context(
      'c3000000-0000-4000-8000-000000000007'
    )
  $$,
  '42501',
  'The Total-Loss case claim is unavailable.',
  'any existing commerce order permanently fences ordinary ownership transfer'
);

reset role;

select throws_ok(
  $$
    insert into public.commerce_orders (
      case_id,
      purchaser_user_id,
      preliminary_snapshot_id,
      product_identifier,
      product_version,
      amount_minor_units,
      currency,
      status,
      terms_version,
      refund_policy_version
    )
    select
      snapshot.case_id,
      'c1000000-0000-4000-8000-00000000000a',
      snapshot.id,
      'total-loss-package',
      '1',
      9900,
      'USD',
      'pending',
      '1',
      '1'
    from public.total_loss_preliminary_snapshots as snapshot
    where snapshot.case_id = 'c2000000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'Commerce orders require the verified permanent current case owner.',
  'commerce creation rejects a stale or non-owner permanent purchaser'
);

select throws_ok(
  $$
    insert into public.total_loss_case_identity_claims (
      case_id, source_user_id, requested_email, purpose, expires_at
    )
    values (
      'c2000000-0000-4000-8000-000000000002',
      'c1000000-0000-4000-8000-000000000001',
      'not-worthwhile@example.test',
      'future_purpose',
      statement_timestamp() + interval '30 minutes'
    )
  $$,
  '22P02',
  null,
  'unrecognized claim purposes cannot enter the trusted identity table'
);

select * from finish();
rollback;
