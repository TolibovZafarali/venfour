begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  (
    '30111111-1111-4111-8111-111111111111',
    'successful-correction-owner@example.test',
    statement_timestamp(),
    false
  ),
  (
    '30222222-2222-4222-8222-222222222222',
    'successful-correction-other@example.test',
    statement_timestamp(),
    false
  );

insert into public.appraisal_cases (id, user_id, service_type, status)
values
  (
    '30a11111-1111-4111-8111-111111111111',
    '30111111-1111-4111-8111-111111111111',
    'total_loss',
    'check_complete'
  ),
  (
    '30a22222-2222-4222-8222-222222222222',
    '30111111-1111-4111-8111-111111111111',
    'total_loss',
    'check_complete'
  );

insert into public.total_loss_case_details (
  case_id, intake_mode, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
  analysis_input_id
)
values
  (
    '30a11111-1111-4111-8111-111111111111', 'manual', 2022,
    'Honda', 'Accord', 'EX-L', 32000, '60601', '2026-08-20',
    'Example Insurance', 18000, statement_timestamp(), 2,
    '30b11111-1111-4111-8111-111111111111'
  ),
  (
    '30a22222-2222-4222-8222-222222222222', 'manual', 2021,
    'Toyota', 'Camry', 'SE', 41000, '60602', '2026-08-21',
    'Example Insurance', 17000, statement_timestamp(), 3,
    '30b22222-2222-4222-8222-222222222222'
  );

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
)
values
  (
    '30c11111-1111-4111-8111-111111111111',
    '30a11111-1111-4111-8111-111111111111',
    (select updated_at from public.total_loss_case_details
      where case_id = '30a11111-1111-4111-8111-111111111111'),
    'completed', 1, '30d11111-1111-4111-8111-111111111111',
    '30e11111-1111-4111-8111-111111111111', statement_timestamp(),
    'manual', 2, '30b11111-1111-4111-8111-111111111111'
  ),
  (
    '30c22222-2222-4222-8222-222222222222',
    '30a22222-2222-4222-8222-222222222222',
    (select updated_at from public.total_loss_case_details
      where case_id = '30a22222-2222-4222-8222-222222222222'),
    'completed', 1, '30d22222-2222-4222-8222-222222222222',
    '30e22222-2222-4222-8222-222222222222', statement_timestamp(),
    'manual', 3, '30b22222-2222-4222-8222-222222222222'
  );

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
)
values
  (
    '30e11111-1111-4111-8111-111111111111',
    '30c11111-1111-4111-8111-111111111111',
    '30a11111-1111-4111-8111-111111111111',
    jsonb_build_object(
      'runId', '30e11111-1111-4111-8111-111111111111',
      'result', jsonb_build_object(
        'discrepancyResult', jsonb_build_object(
          'classification', 'POTENTIAL_UNDERVALUE'
        )
      )
    ),
    repeat('1', 64), '4', '4', '1', '1'
  ),
  (
    '30e22222-2222-4222-8222-222222222222',
    '30c22222-2222-4222-8222-222222222222',
    '30a22222-2222-4222-8222-222222222222',
    jsonb_build_object(
      'runId', '30e22222-2222-4222-8222-222222222222',
      'result', jsonb_build_object(
        'discrepancyResult', jsonb_build_object(
          'classification', 'POTENTIAL_UNDERVALUE'
        )
      )
    ),
    repeat('2', 64), '4', '4', '1', '1'
  );

create temporary table successful_correction_versions (
  label text primary key,
  case_updated_at timestamptz,
  details_updated_at timestamptz,
  analysis_input_revision bigint,
  analysis_input_id uuid
);

grant select on table pg_temp.successful_correction_versions to service_role;

insert into pg_temp.successful_correction_versions
select
  'eligible', appraisal_case.updated_at, details.updated_at,
  details.analysis_input_revision, details.analysis_input_id
from public.appraisal_cases as appraisal_case
join public.total_loss_case_details as details
  on details.case_id = appraisal_case.id
where appraisal_case.id = '30a11111-1111-4111-8111-111111111111';

insert into pg_temp.successful_correction_versions
select
  'frozen', appraisal_case.updated_at, details.updated_at,
  details.analysis_input_revision, details.analysis_input_id
from public.appraisal_cases as appraisal_case
join public.total_loss_case_details as details
  on details.case_id = appraisal_case.id
where appraisal_case.id = '30a22222-2222-4222-8222-222222222222';

select function_privs_are(
  'public',
  'prepare_total_loss_intake_correction',
  array['uuid', 'uuid', 'uuid', 'bigint', 'timestamp with time zone'],
  'service_role',
  array['EXECUTE'],
  'only the trusted service role can prepare successful-result correction'
);

set local role service_role;

select ok(
  public.prepare_total_loss_intake_correction(
    '30a11111-1111-4111-8111-111111111111',
    '30111111-1111-4111-8111-111111111111',
    '30b11111-1111-4111-8111-111111111111',
    2,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'eligible')
  ),
  'an owned successful preliminary result is prepared before its freeze'
);

reset role;

select is(
  (select status::text from public.appraisal_cases
    where id = '30a11111-1111-4111-8111-111111111111'),
  'draft',
  'preparing correction reopens the same appraisal case'
);

select results_eq(
  $$select details.analysis_input_id = versions.analysis_input_id,
      details.analysis_input_revision = versions.analysis_input_revision,
      details.updated_at = versions.details_updated_at,
      details.intake_completed_at is not null
    from public.total_loss_case_details as details
    cross join pg_temp.successful_correction_versions as versions
    where details.case_id = '30a11111-1111-4111-8111-111111111111'
      and versions.label = 'eligible'$$,
  $$values (true, true, true, true)$$,
  'preparation alone does not change the confirmed input or its revision fences'
);

select results_eq(
  $$select count(*)::bigint,
      count(*) filter (where job.status = 'completed')::bigint,
      count(run.id)::bigint
    from public.total_loss_analysis_jobs as job
    left join public.analysis_runs as run on run.job_id = job.id
    where job.case_id = '30a11111-1111-4111-8111-111111111111'$$,
  $$values (1::bigint, 1::bigint, 1::bigint)$$,
  'the prior completed job and immutable analysis run remain historical'
);

update pg_temp.successful_correction_versions
set case_updated_at = (
  select updated_at from public.appraisal_cases
  where id = '30a11111-1111-4111-8111-111111111111'
)
where label = 'eligible';

set local role service_role;

select ok(
  public.prepare_total_loss_intake_correction(
    '30a11111-1111-4111-8111-111111111111',
    '30111111-1111-4111-8111-111111111111',
    '30b11111-1111-4111-8111-111111111111',
    2,
    '2000-01-01T00:00:00Z'
  ),
  'replaying preparation for the same unchanged draft is idempotent'
);

reset role;

select is(
  (select updated_at from public.appraisal_cases
    where id = '30a11111-1111-4111-8111-111111111111'),
  (select case_updated_at from pg_temp.successful_correction_versions
    where label = 'eligible'),
  'idempotent draft preparation performs no additional case write'
);

set local role service_role;

select is(
  public.prepare_total_loss_intake_correction(
    '30a11111-1111-4111-8111-111111111111',
    '30222222-2222-4222-8222-222222222222',
    '30b11111-1111-4111-8111-111111111111',
    2,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'eligible')
  ),
  false,
  'another user cannot prepare correction'
);

select is(
  public.prepare_total_loss_intake_correction(
    '30a11111-1111-4111-8111-111111111111',
    '30111111-1111-4111-8111-111111111111',
    '30b99999-9999-4999-8999-999999999999',
    2,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'eligible')
  ),
  false,
  'a stale analysis input identity cannot prepare correction'
);

select is(
  public.prepare_total_loss_intake_correction(
    '30a11111-1111-4111-8111-111111111111',
    '30111111-1111-4111-8111-111111111111',
    '30b11111-1111-4111-8111-111111111111',
    1,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'eligible')
  ),
  false,
  'a stale analysis input revision cannot prepare correction'
);

reset role;

select is(
  (select status::text from public.appraisal_cases
    where id = '30a11111-1111-4111-8111-111111111111'),
  'draft',
  'rejected owner and input fences leave the case unchanged'
);

update public.appraisal_cases
set status = 'check_complete'
where id = '30a11111-1111-4111-8111-111111111111';

set local role service_role;

select is(
  public.prepare_total_loss_intake_correction(
    '30a11111-1111-4111-8111-111111111111',
    '30111111-1111-4111-8111-111111111111',
    '30b11111-1111-4111-8111-111111111111',
    2,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'eligible')
  ),
  false,
  'a stale case version cannot reopen a completed result'
);

reset role;

select is(
  (select status::text from public.appraisal_cases
    where id = '30a11111-1111-4111-8111-111111111111'),
  'check_complete',
  'stale case-version rejection performs no parent transition'
);

insert into public.total_loss_preliminary_snapshots (
  id, case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
  source_intake_mode, source_analysis_input_revision, source_analysis_input_id,
  preliminary_classification, insurer_valuation_minor_units,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, currency, analysis_run_schema_version,
  analysis_version, discrepancy_analysis_version, comparable_scoring_version,
  presentation_schema_version, snapshot_schema_version, source_references,
  snapshot, snapshot_digest
)
values (
  '30f22222-2222-4222-8222-222222222222',
  '30a22222-2222-4222-8222-222222222222',
  '30c22222-2222-4222-8222-222222222222',
  '30e22222-2222-4222-8222-222222222222',
  '30111111-1111-4111-8111-111111111111', 'manual', 3,
  '30b22222-2222-4222-8222-222222222222',
  'POTENTIAL_UNDERVALUE', 1700000, 1800000, 1900000, 2000000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object(
    'analysisRunId', '30e22222-2222-4222-8222-222222222222'
  ),
  jsonb_build_object('classification', 'POTENTIAL_UNDERVALUE'),
  repeat('3', 64)
);

set local role service_role;

select is(
  public.prepare_total_loss_intake_correction(
    '30a22222-2222-4222-8222-222222222222',
    '30111111-1111-4111-8111-111111111111',
    '30b22222-2222-4222-8222-222222222222',
    3,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'frozen')
  ),
  false,
  'the first immutable preliminary snapshot freezes intake correction'
);

reset role;

select results_eq(
  $$select appraisal_case.status::text,
      details.analysis_input_id = versions.analysis_input_id,
      details.analysis_input_revision = versions.analysis_input_revision,
      details.updated_at = versions.details_updated_at
    from public.appraisal_cases as appraisal_case
    join public.total_loss_case_details as details
      on details.case_id = appraisal_case.id
    cross join pg_temp.successful_correction_versions as versions
    where appraisal_case.id = '30a22222-2222-4222-8222-222222222222'
      and versions.label = 'frozen'$$,
  $$values ('check_complete'::text, true, true, true)$$,
  'snapshot-frozen rejection leaves foundational case input unchanged'
);

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
)
values (
  '30a22222-2222-4222-8222-222222222222',
  '30f22222-2222-4222-8222-222222222222',
  'review',
  'secure_claim'
);

set local role service_role;

select is(
  public.prepare_total_loss_intake_correction(
    '30a22222-2222-4222-8222-222222222222',
    '30111111-1111-4111-8111-111111111111',
    '30b22222-2222-4222-8222-222222222222',
    3,
    (select case_updated_at from pg_temp.successful_correction_versions
      where label = 'frozen')
  ),
  false,
  'a paid claim workflow also denies stale correction requests'
);

reset role;

select is(
  (select count(*) from public.appraisal_cases
    where user_id = '30111111-1111-4111-8111-111111111111'),
  2::bigint,
  'correction preparation never creates another appraisal case'
);

select results_eq(
  $$select count(*)::bigint, count(run.id)::bigint
    from public.total_loss_analysis_jobs as job
    left join public.analysis_runs as run on run.job_id = job.id
    where job.case_id in (
      '30a11111-1111-4111-8111-111111111111',
      '30a22222-2222-4222-8222-222222222222'
    )$$,
  $$values (2::bigint, 2::bigint)$$,
  'all completed analysis lineage remains immutable after allowed and denied preparation'
);

select * from finish();
rollback;
