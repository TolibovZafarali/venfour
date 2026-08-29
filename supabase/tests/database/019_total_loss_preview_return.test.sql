begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(51);

select ok((select relrowsecurity from pg_class where oid = 'public.total_loss_preview_emails'::regclass),
  'preview email jobs have RLS enabled');
select ok(not has_table_privilege(role_name, 'public.total_loss_preview_emails', 'SELECT,INSERT,UPDATE,DELETE'),
  role_name || ' cannot directly read or mutate the email queue')
from unnest(array['anon', 'authenticated', 'service_role']) as role_name;
select ok(has_function_privilege('service_role', function_name, 'EXECUTE')
  and not has_function_privilege('anon', function_name, 'EXECUTE')
  and not has_function_privilege('authenticated', function_name, 'EXECUTE'),
  function_name || ' is service-only')
from unnest(array[
  'public.request_total_loss_preview_recovery(uuid,text,text,text)',
  'public.reserve_total_loss_preview_email(uuid,uuid)',
  'public.finish_total_loss_preview_email(uuid,uuid,boolean)'
]) as function_name;
select ok(not has_function_privilege('service_role', function_name, 'EXECUTE')
  and not has_function_privilege('authenticated', function_name, 'EXECUTE')
  and not has_function_privilege('anon', function_name, 'EXECUTE'),
  function_name || ' remains internal')
from unnest(array[
  'public.total_loss_preview_access_allowed_internal(uuid,text)',
  'public.enqueue_total_loss_preview_completion()',
  'public.record_total_loss_analysis_guest_origin()',
  'public.dispatch_total_loss_preview_emails()'
]) as function_name;

insert into auth.users(id, email, email_confirmed_at, is_anonymous) values
  ('f1000000-0000-4000-8000-000000000001', null, null, true),
  ('f1000000-0000-4000-8000-000000000002', null, null, true),
  ('f1000000-0000-4000-8000-000000000003', 'preview@example.test', statement_timestamp(), false),
  ('f1000000-0000-4000-8000-000000000004', 'other@example.test', statement_timestamp(), false);

create function pg_temp.preview_case(case_id uuid, owner_id uuid, email text,
  classification text default null) returns void language plpgsql as $$
declare
  input_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  run_id uuid := gen_random_uuid();
  token uuid := gen_random_uuid();
begin
  insert into public.appraisal_cases(id, user_id, service_type, status)
    values ($1, $2, 'total_loss', 'checking');
  insert into public.total_loss_case_details(case_id, intake_mode, vin,
    vehicle_year, vehicle_make, vehicle_model, vehicle_trim, mileage_at_loss,
    postal_code, date_of_loss, insurer_name, insurer_vehicle_valuation,
    intake_completed_at, analysis_input_revision, analysis_input_id)
  values ($1, 'manual', '1HGCM82633A004352', 2022, 'Honda', 'Accord', 'EX-L',
    32000, '60601', '2026-08-20', 'Example Insurance', 18000,
    statement_timestamp(), 1, input_id);
  insert into public.total_loss_case_contacts(case_id, full_name, email,
    service_terms_version, service_terms_acknowledged_at, privacy_notice_version,
    privacy_notice_acknowledged_at, operational_follow_up_allowed, operational_follow_up_updated_at)
  values ($1, 'Preview Customer', $3, '2026-08-23', statement_timestamp(),
    '2026-08-23', statement_timestamp(), false, statement_timestamp());
  insert into public.total_loss_analysis_jobs(id, case_id, source_report_upload_id,
    source_details_updated_at, status, attempt_count, processing_token,
    processing_expires_at, run_id, source_intake_mode,
    source_analysis_input_revision, source_analysis_input_id, started_as_guest)
  values (job_id, $1, null, statement_timestamp(), 'processing', 1, token,
    statement_timestamp() + interval '5 minutes', run_id, 'manual', 1, input_id, false);
  if $4 is not null then
    if not public.complete_total_loss_analysis(job_id, token, run_id,
      jsonb_build_object('runId', run_id::text, 'requestDigest', repeat('a', 64),
        'analysisRunSchemaVersion', '4', 'analysisVersion', '4',
        'discrepancyAnalysisVersion', '1', 'comparableScoringVersion', '1',
        'result', jsonb_build_object('discrepancyResult', jsonb_build_object('classification', $4))))
    then raise exception 'The fixture analysis did not complete.'; end if;
  end if;
end;
$$;

select pg_temp.preview_case(('f2000000-0000-4000-8000-00000000000' || ordinal)::uuid,
  'f1000000-0000-4000-8000-000000000001', 'preview@example.test', classification)
from unnest(array['MATERIAL_UNDERVALUE_SIGNAL', 'POTENTIAL_UNDERVALUE',
  'NO_MATERIAL_DISCREPANCY', 'CONFLICTING_EVIDENCE', 'INSUFFICIENT_EVIDENCE'])
  with ordinality as outcomes(classification, ordinal);
select is((select count(*)::integer from public.total_loss_preview_emails
  where case_id::text like 'f2000000-%' and kind = 'ready'), 5,
  'every completed guest result queues an email, including neutral and insufficient outcomes');
select ok((select bool_and(started_as_guest) from public.total_loss_analysis_jobs
  where case_id::text like 'f2000000-%'), 'guest origin is derived from ownership rather than caller input');
select is((select count(*)::integer from public.total_loss_preliminary_snapshots
  where case_id::text like 'f2000000-%'), 0,
  'preview return does not require a paid-review snapshot');

select pg_temp.preview_case('f2000000-0000-4000-8000-000000000006',
  'f1000000-0000-4000-8000-000000000003', 'preview@example.test', 'MATERIAL_UNDERVALUE_SIGNAL');
select is((select count(*)::integer from public.total_loss_preview_emails
  where case_id = 'f2000000-0000-4000-8000-000000000006'), 0,
  'an analysis started by a permanent account does not receive the guest completion email');
select pg_temp.preview_case('f2000000-0000-4000-8000-000000000007',
  'f1000000-0000-4000-8000-000000000001', 'processing@example.test');
select is((select count(*)::integer from public.total_loss_preview_emails
  where case_id = 'f2000000-0000-4000-8000-000000000007'), 0,
  'processing alone does not send a ready email');

select pg_temp.preview_case('f2000000-0000-4000-8000-000000000009',
  'f1000000-0000-4000-8000-000000000001', 'preview@example.test');
update public.appraisal_cases set user_id = 'f1000000-0000-4000-8000-000000000003'
  where id = 'f2000000-0000-4000-8000-000000000009';
select ok(public.complete_total_loss_analysis(job.id, job.processing_token, job.run_id,
  jsonb_set(run.artifact, '{runId}', to_jsonb(job.run_id::text))),
  'an analysis can finish after its original guest verifies their email')
from public.total_loss_analysis_jobs as job cross join public.analysis_runs as run
where job.case_id = 'f2000000-0000-4000-8000-000000000009'
  and run.case_id = 'f2000000-0000-4000-8000-000000000006';
select is((select count(*)::integer from public.total_loss_preview_emails
  where case_id = 'f2000000-0000-4000-8000-000000000009'), 1,
  'guest-origin completion is retained after identity verification');
select is((select count(*)::integer from public.reserve_total_loss_preview_email(
  gen_random_uuid(), 'f2000000-0000-4000-8000-000000000009')), 1,
  'the verified current owner can receive the original guest completion email');

select ok(public.complete_total_loss_analysis(job.id, job.processing_token, job.run_id, run.artifact),
  'repeating successful completion remains idempotent')
from public.total_loss_analysis_jobs as job join public.analysis_runs as run on run.id = job.run_id
where job.case_id = 'f2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.total_loss_preview_emails
  where case_id = 'f2000000-0000-4000-8000-000000000001'), 1,
  'repeating completion never duplicates the ready email');

create temporary table delivery as select * from public.reserve_total_loss_preview_email(
  'f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from delivery), 1, 'a ready email can be reserved for an insufficient-evidence result');
select is((select purpose::text from public.total_loss_case_identity_claims where id = (select claim_id from delivery)),
  'intake', 'preview recovery reuses the existing email-bound identity claim contract');
select is((select count(*)::integer from public.reserve_total_loss_preview_email(
  'f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000005')), 0,
  'a second worker cannot deliver a live leased email');
select is(public.finish_total_loss_preview_email((select email_id from delivery),
  'f3000000-0000-4000-8000-000000000002', true), false,
  'a different lease cannot acknowledge the email');
select is(public.finish_total_loss_preview_email((select email_id from delivery),
  'f3000000-0000-4000-8000-000000000001', false), true,
  'delivery failure records a retry');
select ok((select status = 'pending' and attempt_count = 1 and next_attempt_at > statement_timestamp()
  and last_error_code = 'EMAIL_UNAVAILABLE' from public.total_loss_preview_emails
  where id = (select email_id from delivery)), 'failed delivery backs off without storing provider details');
select is((select status::text from public.total_loss_analysis_jobs
  where case_id = 'f2000000-0000-4000-8000-000000000005'), 'completed',
  'email failure never changes the completed analysis');
update public.total_loss_preview_emails set next_attempt_at = statement_timestamp() - interval '1 second'
  where id = (select email_id from delivery);
select is((select claim_id from public.reserve_total_loss_preview_email(
  'f3000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000005')),
  (select claim_id from delivery), 'retry reuses a still-valid claim');
select is(public.finish_total_loss_preview_email((select email_id from delivery),
  'f3000000-0000-4000-8000-000000000003', true), true, 'successful delivery is recorded');
select is((select count(*)::integer from public.reserve_total_loss_preview_email(
  gen_random_uuid(), 'f2000000-0000-4000-8000-000000000005')), 0, 'sent emails are never reserved again');

grant select on delivery to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select * from public.complete_total_loss_case_claim_with_context((select claim_id from delivery))$$,
  '42501', 'The Total-Loss case claim is unavailable.', 'a verified different email cannot claim the preview');
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}', true);
select is((select case_id from public.complete_total_loss_case_claim_with_context((select claim_id from delivery))),
  'f2000000-0000-4000-8000-000000000005'::uuid, 'verifying the Contact Details email recovers the exact result');
select is((select count(*)::integer from public.appraisal_cases where id = 'f2000000-0000-4000-8000-000000000005'), 1,
  'the verified owner can read the same saved case');
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select is((select count(*)::integer from public.appraisal_cases where id = 'f2000000-0000-4000-8000-000000000005'), 0,
  'the old anonymous session cannot read the transferred case');
reset role;
select is((select run_id from public.total_loss_analysis_jobs where case_id = 'f2000000-0000-4000-8000-000000000005'),
  (select run_id from public.total_loss_preview_emails where id = (select email_id from delivery)),
  'recovery preserves the original saved analysis run');

select public.request_total_loss_preview_recovery('f2000000-0000-4000-8000-000000000005',
  'wrong@example.test', repeat('1', 64), repeat('2', 64));
select is((select count(*)::integer from public.total_loss_preview_emails
  where kind = 'recovery' and case_id::text like 'f2000000-%'), 0, 'an unknown email creates no recovery job');
select public.request_total_loss_preview_recovery('f2000000-0000-4000-8000-000000000005',
  ' PREVIEW@EXAMPLE.TEST ', repeat('3', 64), repeat('4', 64));
select is((select count(*)::integer from public.total_loss_preview_emails
  where kind = 'recovery' and case_id::text like 'f2000000-%'), 1, 'the verified current owner can request a fresh link without their session');
select public.request_total_loss_preview_recovery('f2000000-0000-4000-8000-000000000005',
  'preview@example.test', repeat('3', 64), repeat('4', 64));
select is((select count(*)::integer from public.total_loss_preview_emails
  where kind = 'recovery' and case_id::text like 'f2000000-%'), 1, 'repeated recovery requests do not duplicate a pending email');

-- Make the originally emailed claim unusable, then prove recovery rotates it.
update public.total_loss_case_identity_claims set created_at = statement_timestamp() - interval '1 hour',
  expires_at = statement_timestamp() - interval '1 second'
  where id = (select claim_id from delivery);
create temporary table renewed as select * from public.reserve_total_loss_preview_email(
  'f3000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000005');
select isnt((select claim_id from renewed), (select claim_id from delivery), 'an expired or consumed claim gets a fresh identity claim');
select is(public.finish_total_loss_preview_email((select email_id from renewed),
  'f3000000-0000-4000-8000-000000000004', true), true, 'fresh recovery can be delivered');

-- General recovery selects an analysis, never a newer unfinished draft.
insert into public.appraisal_cases(id, user_id, service_type, status, last_activity_at)
  values ('f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000001',
    'total_loss', 'draft', statement_timestamp() + interval '1 hour');
update public.appraisal_cases set last_activity_at = statement_timestamp() + interval '30 minutes'
  where id = 'f2000000-0000-4000-8000-000000000005';
select public.request_total_loss_preview_recovery(null, 'preview@example.test', repeat('5', 64), repeat('6', 64));
select is((select case_id from public.total_loss_preview_emails
  where kind = 'recovery' and status = 'pending' and case_id::text like 'f2000000-%'),
  'f2000000-0000-4000-8000-000000000005'::uuid, 'email-only recovery chooses the most recent eligible result');

-- A queued recipient must still be entitled when delivery actually runs.
update public.total_loss_case_contacts set email = 'changed@example.test'
  where case_id = 'f2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.reserve_total_loss_preview_email(
  gen_random_uuid(), 'f2000000-0000-4000-8000-000000000001')), 0, 'contact changes prevent delivery to the old address');
select is((select status from public.total_loss_preview_emails where case_id = 'f2000000-0000-4000-8000-000000000001'),
  'cancelled', 'an unauthorized queued email is cancelled');

update public.total_loss_analysis_jobs set status = 'processing', finished_at = null,
  processing_expires_at = statement_timestamp() + interval '5 minutes'
  where case_id = 'f2000000-0000-4000-8000-000000000003';
select is((select count(*)::integer from public.reserve_total_loss_preview_email(
  gen_random_uuid(), 'f2000000-0000-4000-8000-000000000003')), 0,
  'a delayed ready email cannot describe an analysis that is now processing');
select is((select status from public.total_loss_preview_emails where case_id = 'f2000000-0000-4000-8000-000000000003'),
  'cancelled', 'superseded completion messages are cancelled');

-- Leases recover after a crashed worker, but a stale acknowledgement is fenced.
create temporary table crashed as select * from public.reserve_total_loss_preview_email(
  'f3000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000002');
update public.total_loss_preview_emails set lease_expires_at = statement_timestamp() - interval '1 second'
  where id = (select email_id from crashed);
select is((select email_id from public.reserve_total_loss_preview_email(
  'f3000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000002')),
  (select email_id from crashed), 'a new worker can resume an expired lease');
select is(public.finish_total_loss_preview_email((select email_id from crashed),
  'f3000000-0000-4000-8000-000000000005', true), false, 'a crashed worker cannot acknowledge the replacement lease');
update public.total_loss_preview_emails set attempt_count = 8,
  lease_expires_at = statement_timestamp() - interval '1 second' where id = (select email_id from crashed);
select is((select count(*)::integer from public.reserve_total_loss_preview_email(
  gen_random_uuid(), 'f2000000-0000-4000-8000-000000000002')), 0, 'delivery attempts are bounded');
select is((select status from public.total_loss_preview_emails where id = (select email_id from crashed)),
  'failed', 'an exhausted delivery is retained for safe operational review');

-- All requests, including non-matches, consume the same target budget.
select public.request_total_loss_preview_recovery(null, 'processing@example.test', repeat('7', 64), repeat('8', 64));
update public.total_loss_preview_emails set status = 'cancelled' where kind = 'recovery' and status = 'pending'
  and case_id = 'f2000000-0000-4000-8000-000000000007';
select public.request_total_loss_preview_recovery(null, 'processing@example.test', repeat('7', 64), repeat('8', 64));
update public.total_loss_preview_emails set status = 'cancelled' where kind = 'recovery' and status = 'pending'
  and case_id = 'f2000000-0000-4000-8000-000000000007';
select public.request_total_loss_preview_recovery(null, 'processing@example.test', repeat('7', 64), repeat('8', 64));
update public.total_loss_preview_emails set status = 'cancelled' where kind = 'recovery' and status = 'pending'
  and case_id = 'f2000000-0000-4000-8000-000000000007';
select public.request_total_loss_preview_recovery(null, 'processing@example.test', repeat('7', 64), repeat('8', 64));
select is((select count(*)::integer from public.total_loss_preview_emails
  where case_id = 'f2000000-0000-4000-8000-000000000007' and kind = 'recovery'), 3,
  'target throttling bounds recovery mail requests even when queue entries are consumed');

select * from finish();
rollback;
