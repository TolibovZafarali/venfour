begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

insert into auth.users (id, email, email_confirmed_at)
values (
  '29111111-1111-4111-8111-111111111111',
  'intake-recovery@example.test',
  statement_timestamp()
);

insert into public.appraisal_cases (id, user_id, service_type)
values (
  '29a11111-1111-4111-8111-111111111111',
  '29111111-1111-4111-8111-111111111111',
  'total_loss'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name
)
values (
  '29a11111-1111-4111-8111-111111111111',
  'manual', 2020, 'Toyota', 'Camry', 'SE', 51000, '60601',
  '2026-08-19', 'Example Insurance'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
)
values (
  '29a11111-1111-4111-8111-111111111111',
  'Recovery Customer', 'intake-recovery@example.test', '2026-08-23',
  statement_timestamp(), '2026-08-23', statement_timestamp(), false,
  statement_timestamp()
);

create temporary table intake_recovery_identity (
  label text primary key,
  details_updated_at timestamptz,
  analysis_input_revision bigint,
  analysis_input_id uuid,
  job_id uuid,
  run_id uuid
);
grant select, insert on table pg_temp.intake_recovery_identity
to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = '29111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select public.confirm_total_loss_intake(
    '29a11111-1111-4111-8111-111111111111',
    (select updated_at from public.total_loss_case_details
      where case_id = '29a11111-1111-4111-8111-111111111111')
  )$$,
  'the existing manual confirmation contract permits an omitted insurer offer'
);

insert into pg_temp.intake_recovery_identity
  (label, details_updated_at, analysis_input_revision, analysis_input_id)
select 'original', updated_at, analysis_input_revision, analysis_input_id
from public.total_loss_case_details
where case_id = '29a11111-1111-4111-8111-111111111111';

reset role;
set local role service_role;

select is(
  (select outcome::text from public.claim_total_loss_analysis(
    '29a11111-1111-4111-8111-111111111111',
    '29111111-1111-4111-8111-111111111111',
    '29b11111-1111-4111-8111-111111111111'
  )),
  'claimed',
  'confirmed intake starts its original analysis'
);

reset role;
update pg_temp.intake_recovery_identity as identity
set job_id = job.id, run_id = job.run_id
from public.total_loss_analysis_jobs as job
where identity.label = 'original'
  and job.case_id = '29a11111-1111-4111-8111-111111111111';
set local role service_role;

select ok(
  public.fail_total_loss_analysis(
    (select job_id from pg_temp.intake_recovery_identity where label = 'original'),
    '29b11111-1111-4111-8111-111111111111',
    'ANALYSIS_INPUT_INVALID', false
  ),
  'a nonretryable failure returns the case to its editable draft lifecycle'
);

select results_eq(
  $$select outcome::text, attempt_count
    from public.claim_total_loss_analysis(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111',
      '29b22222-2222-4222-8222-222222222222'
    )$$,
  $$values ('failed'::text, 1)$$,
  'unchanged nonretryable input does not automatically rerun analysis'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '29111111-1111-4111-8111-111111111111';

select results_eq(
  $$select details.analysis_input_revision = identity.analysis_input_revision,
      details.analysis_input_id = identity.analysis_input_id,
      details.intake_completed_at is not null, details.vehicle_make,
      details.vehicle_model, contact.email
    from public.total_loss_case_details as details
    join public.total_loss_case_contacts as contact using (case_id)
    cross join pg_temp.intake_recovery_identity as identity
    where details.case_id = '29a11111-1111-4111-8111-111111111111'
      and identity.label = 'original'$$,
  $$values (true, true, true, 'Toyota'::text, 'Camry'::text,
    'intake-recovery@example.test'::text)$$,
  'reading completed intake restores facts and contact without clearing completion or lineage'
);

select lives_ok(
  $$update public.total_loss_case_details
    set insurer_vehicle_valuation = 18500
    where case_id = '29a11111-1111-4111-8111-111111111111'
      and updated_at = (select details_updated_at
        from pg_temp.intake_recovery_identity where label = 'original')$$,
  'the owner persists a corrected offer through the existing version-fenced update'
);

select results_eq(
  $$select details.insurer_vehicle_valuation,
      details.intake_completed_at is null,
      details.analysis_input_revision > identity.analysis_input_revision,
      details.analysis_input_id <> identity.analysis_input_id,
      details.vehicle_make, details.vehicle_model, contact.email
    from public.total_loss_case_details as details
    join public.total_loss_case_contacts as contact using (case_id)
    cross join pg_temp.intake_recovery_identity as identity
    where details.case_id = '29a11111-1111-4111-8111-111111111111'
      and identity.label = 'original'$$,
  $$values (18500::numeric, true, true, true, 'Toyota'::text, 'Camry'::text,
    'intake-recovery@example.test'::text)$$,
  'material correction rotates both input fences and clears completion without losing saved facts'
);

reset role;
set local role service_role;

select results_eq(
  $$select outcome::text, job_id is null, run_id is null
    from public.get_total_loss_analysis_status(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111'
    )$$,
  $$values ('not_submitted'::text, true, true)$$,
  'changed inputs cannot resolve the prior failed analysis as their current result'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis(
    '29a11111-1111-4111-8111-111111111111',
    '29111111-1111-4111-8111-111111111111',
    '29b22222-2222-4222-8222-222222222222'
  )),
  'intake_not_ready',
  'saving corrected fields alone cannot run analysis before explicit confirmation'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '29111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select public.confirm_total_loss_intake(
    '29a11111-1111-4111-8111-111111111111',
    (select updated_at from public.total_loss_case_details
      where case_id = '29a11111-1111-4111-8111-111111111111')
  )$$,
  'explicit resubmission confirms the corrected intake on the same case'
);

insert into pg_temp.intake_recovery_identity
  (label, details_updated_at, analysis_input_revision, analysis_input_id)
select 'corrected', updated_at, analysis_input_revision, analysis_input_id
from public.total_loss_case_details
where case_id = '29a11111-1111-4111-8111-111111111111';

reset role;
set local role service_role;

select results_eq(
  $$select outcome::text, intake_mode::text, job_id is null, run_id is null,
      analysis_input_id = (select analysis_input_id
        from pg_temp.intake_recovery_identity where label = 'corrected'),
      input_snapshot ->> 'insurer_vehicle_valuation'
    from public.get_total_loss_analysis_status(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111'
    )$$,
  $$values ('not_submitted'::text, 'manual'::text, true, true, true, '18500.00'::text)$$,
  'corrected manual confirmation can be resumed safely before its analysis request arrives'
);

select results_eq(
  $$select outcome::text, attempt_count,
      job_id <> (select job_id from pg_temp.intake_recovery_identity
        where label = 'original'),
      run_id <> (select run_id from pg_temp.intake_recovery_identity
        where label = 'original'),
      input_snapshot ->> 'insurer_vehicle_valuation',
      analysis_input_id = (select analysis_input_id
        from pg_temp.intake_recovery_identity where label = 'corrected')
    from public.claim_total_loss_analysis(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111',
      '29b22222-2222-4222-8222-222222222222'
    )$$,
  $$values ('claimed'::text, 1, true, true, '18500.00'::text, true)$$,
  'corrected confirmation creates a new run and job for the corrected authoritative snapshot'
);

reset role;
update pg_temp.intake_recovery_identity as identity
set job_id = job.id, run_id = job.run_id
from public.total_loss_analysis_jobs as job
where identity.label = 'corrected'
  and job.case_id = '29a11111-1111-4111-8111-111111111111'
  and job.source_analysis_input_id = identity.analysis_input_id;

select is(
  (select count(*) from public.appraisal_cases
    where user_id = '29111111-1111-4111-8111-111111111111'),
  1::bigint,
  'correction never creates a duplicate appraisal case'
);

select results_eq(
  $$select status::text, failure_code, retryable, attempt_count
    from public.total_loss_analysis_jobs
    where id = (select job_id from pg_temp.intake_recovery_identity
      where label = 'original')$$,
  $$values ('failed'::text, 'ANALYSIS_INPUT_INVALID'::text, false, 1)$$,
  'the original nonretryable job remains intact as historical input lineage'
);

set local role service_role;

select results_eq(
  $$select outcome::text, attempt_count,
      job_id = (select job_id from pg_temp.intake_recovery_identity
        where label = 'corrected')
    from public.claim_total_loss_analysis(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111',
      '29b33333-3333-4333-8333-333333333333'
    )$$,
  $$values ('processing'::text, 1, true)$$,
  'a duplicate resubmission observes the single current processing job'
);

select ok(
  public.complete_total_loss_analysis(
    (select job_id from pg_temp.intake_recovery_identity where label = 'corrected'),
    '29b22222-2222-4222-8222-222222222222',
    (select run_id from pg_temp.intake_recovery_identity where label = 'corrected'),
    jsonb_build_object(
      'analysisRunSchemaVersion', '4',
      'runId', (select run_id::text from pg_temp.intake_recovery_identity
        where label = 'corrected'),
      'analysisVersion', '4', 'discrepancyAnalysisVersion', '1',
      'comparableScoringVersion', '1', 'requestDigest', repeat('a', 64)
    )
  ),
  'the corrected analysis completes under its own processing token and run identity'
);

select results_eq(
  $$select outcome::text,
      run_id = (select run_id from pg_temp.intake_recovery_identity
        where label = 'corrected')
    from public.get_total_loss_analysis_status(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111'
    )$$,
  $$values ('completed'::text, true)$$,
  'ordinary completed-intake status resumes the corrected current result'
);

select results_eq(
  $$select outcome::text, attempt_count,
      run_id = (select run_id from pg_temp.intake_recovery_identity
        where label = 'corrected')
    from public.claim_total_loss_analysis(
      '29a11111-1111-4111-8111-111111111111',
      '29111111-1111-4111-8111-111111111111',
      '29b44444-4444-4444-8444-444444444444'
    )$$,
  $$values ('completed'::text, 1, true)$$,
  'ordinary completed-intake submit is still idempotent and does not rerun analysis'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '29111111-1111-4111-8111-111111111111';

select results_eq(
  $$with changed as (
    update public.total_loss_case_details
    set insurer_vehicle_valuation = 19000
    where case_id = '29a11111-1111-4111-8111-111111111111'
    returning 1
  ) select count(*) from changed$$,
  $$values (0::bigint)$$,
  'ordinary completed intake remains immutable without explicit recovery authority'
);

reset role;

select is(
  (select count(*) from public.total_loss_analysis_jobs
    where case_id = '29a11111-1111-4111-8111-111111111111'),
  2::bigint,
  'only the historical failed job and one corrected-input job exist'
);

select is(
  (select count(*) from public.analysis_runs
    where case_id = '29a11111-1111-4111-8111-111111111111'),
  1::bigint,
  'only the corrected-input immutable result was persisted'
);

insert into public.appraisal_cases (id, user_id, service_type)
values (
  '29a22222-2222-4222-8222-222222222222',
  '29111111-1111-4111-8111-111111111111', 'total_loss'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, postal_code, report_original_filename,
  report_uploaded_at, report_last_upload_id
)
values (
  '29a22222-2222-4222-8222-222222222222', 'report', '60601',
  'original-report.pdf', statement_timestamp(),
  '29c11111-1111-4111-8111-111111111111'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
)
values (
  '29a22222-2222-4222-8222-222222222222', 'Recovery Customer',
  'intake-recovery@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into storage.objects (bucket_id, name, user_metadata)
values (
  'case-files',
  '29111111-1111-4111-8111-111111111111/29a22222-2222-4222-8222-222222222222/valuation-report.pdf',
  '{"uploadId":"29c11111-1111-4111-8111-111111111111"}'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '29111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select public.confirm_total_loss_intake(
    '29a22222-2222-4222-8222-222222222222',
    (select updated_at from public.total_loss_case_details
      where case_id = '29a22222-2222-4222-8222-222222222222')
  )$$,
  'a finalized report can be confirmed before its first analysis claim'
);

insert into pg_temp.intake_recovery_identity
  (label, details_updated_at, analysis_input_revision, analysis_input_id)
select 'original-report', updated_at, analysis_input_revision, analysis_input_id
from public.total_loss_case_details
where case_id = '29a22222-2222-4222-8222-222222222222';

select lives_ok(
  $$select public.acquire_total_loss_report_upload(
    '29a22222-2222-4222-8222-222222222222',
    (select details_updated_at from pg_temp.intake_recovery_identity
      where label = 'original-report'),
    '29c22222-2222-4222-8222-222222222222'
  )$$,
  'the confirmed draft can acquire a replacement report upload lease'
);

reset role;

select results_eq(
  $$select details.intake_completed_at is not null,
      details.analysis_input_id = identity.analysis_input_id,
      details.analysis_input_revision = identity.analysis_input_revision,
      details.updated_at = identity.details_updated_at,
      details.report_upload_id = '29c22222-2222-4222-8222-222222222222'::uuid
    from public.total_loss_case_details as details
    cross join pg_temp.intake_recovery_identity as identity
    where details.case_id = '29a22222-2222-4222-8222-222222222222'
      and identity.label = 'original-report'$$,
  $$values (true, true, true, true, true)$$,
  'replacement lease coordination retains completion and current input identity'
);

set local role service_role;

select results_eq(
  $$select outcome::text, intake_mode::text, job_id is null, run_id is null,
      analysis_input_id = (select analysis_input_id
        from pg_temp.intake_recovery_identity where label = 'original-report')
    from public.get_total_loss_analysis_status(
      '29a22222-2222-4222-8222-222222222222',
      '29111111-1111-4111-8111-111111111111'
    )$$,
  $$values ('not_submitted'::text, 'report'::text, true, true, true)$$,
  'a confirmed report with an active replacement lease legitimately has no current job'
);

select is(
  (select outcome::text from public.claim_total_loss_analysis(
    '29a22222-2222-4222-8222-222222222222',
    '29111111-1111-4111-8111-111111111111',
    '29b55555-5555-4555-8555-555555555555'
  )),
  'report_required',
  'analysis safely offers report recovery while the replacement upload is pending'
);

reset role;

select results_eq(
  $$select status::text,
      (select count(*) from public.total_loss_analysis_jobs
        where case_id = '29a22222-2222-4222-8222-222222222222')
    from public.appraisal_cases
    where id = '29a22222-2222-4222-8222-222222222222'$$,
  $$values ('draft'::text, 0::bigint)$$,
  'report recovery leaves the owned draft editable without claiming analysis'
);

select * from finish();
rollback;
