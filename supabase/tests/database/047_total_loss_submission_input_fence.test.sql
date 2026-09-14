begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(has_function_privilege('service_role','public.claim_total_loss_analysis_input(uuid,uuid,uuid,uuid,bigint)','EXECUTE'),'service worker can claim an exact input');
select ok(not has_function_privilege(role,'public.claim_total_loss_analysis_input(uuid,uuid,uuid,uuid,bigint)','EXECUTE'),'untrusted role cannot claim: '||role)
  from unnest(array['anon','authenticated']) role;
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc
  where oid='public.claim_total_loss_analysis_input(uuid,uuid,uuid,uuid,bigint)'::regprocedure),'definer has empty search path');
select ok(has_function_privilege('authenticated','public.confirm_total_loss_intake(uuid,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.confirm_total_loss_intake(uuid,timestamptz)','EXECUTE'),'confirmation permissions unchanged');
select ok((select relrowsecurity from pg_class where oid='public.total_loss_analysis_jobs'::regclass)
  and not has_table_privilege('authenticated','public.total_loss_analysis_jobs','INSERT'),'job RLS and direct write restriction preserved');

insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  ('47000000-0000-4000-8000-000000000001','input-fence-fixture@example.test',statement_timestamp(),true);
insert into public.appraisal_cases(id,user_id,service_type,status) values
  ('47100000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','total_loss','draft');
insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,
  vehicle_trim,mileage_at_loss,postal_code,date_of_loss,analysis_input_revision,analysis_input_id) values
  ('47100000-0000-4000-8000-000000000001','manual',2024,'Hyundai','Elantra','SEL',50000,'63026',current_date-10,1,'47400000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"47000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
set local role authenticated;
select lives_ok($$select public.save_total_loss_contact_details_and_begin_claim(
  '47100000-0000-4000-8000-000000000001','Fixture','Driver','input-fence-fixture@example.test',
  null,'2026-08-23','2026-08-23',false)$$,'normal guest contact saves without technical facts');
select lives_ok($$select public.confirm_total_loss_intake('47100000-0000-4000-8000-000000000001',
  (select updated_at from public.total_loss_case_details where case_id='47100000-0000-4000-8000-000000000001'))$$,
  'manual basics confirm without insurer name or offer');
reset role;
select ok((select public.total_loss_manual_input_is_complete(d) and insurer_name is null
  and insurer_vehicle_valuation is null and vehicle_facts is null from public.total_loss_case_details d
  where case_id='47100000-0000-4000-8000-000000000001'),'no hidden technical or insurer facts needed');

create function pg_temp.claim(expected_id uuid default null,
  expected_revision bigint default null, token uuid default '47300000-0000-4000-8000-000000000001',
  owner_id uuid default '47000000-0000-4000-8000-000000000001') returns text language sql as $$
  select outcome::text from public.claim_total_loss_analysis_input('47100000-0000-4000-8000-000000000001',
    owner_id,token,
    coalesce(expected_id,(select analysis_input_id from public.total_loss_case_details where case_id='47100000-0000-4000-8000-000000000001')),
    coalesce(expected_revision,(select analysis_input_revision from public.total_loss_case_details where case_id='47100000-0000-4000-8000-000000000001')));
$$;
select is(pg_temp.claim(expected_id=>'47400000-0000-4000-8000-000000000002'),'case_not_ready','stale input ID is fenced');
select is(pg_temp.claim(expected_revision=>2147483646),'case_not_ready','stale revision is fenced');
select is(pg_temp.claim(owner_id=>'47000000-0000-4000-8000-000000000002'),'not_found','another owner cannot inspect or claim');
select throws_ok($$select pg_temp.claim(expected_revision=>0)$$,'22023','Case, owner, processing token, and expected input are required.','invalid revision rejected');
select is((select count(*) from public.total_loss_analysis_jobs where case_id='47100000-0000-4000-8000-000000000001'),0::bigint,'invalid and stale submissions create no job');
select is((select status::text from public.appraisal_cases where id='47100000-0000-4000-8000-000000000001'),'draft','stale submissions do not mutate case');
select is(pg_temp.claim(),'claimed','exact saved input claims normally');
select is(pg_temp.claim(),'claimed','same-token ambiguous response retry is idempotent');
select is(pg_temp.claim(token=>'47300000-0000-4000-8000-000000000002'),'processing','concurrent other-token caller reuses in-flight job');
select is((select count(*) from public.total_loss_analysis_jobs where case_id='47100000-0000-4000-8000-000000000001'),1::bigint,'only one job exists for input');
select is((select attempt_count from public.total_loss_analysis_jobs where case_id='47100000-0000-4000-8000-000000000001'),1,'duplicate submissions do not retry analysis');
select ok((select j.source_analysis_input_id=d.analysis_input_id
  and j.source_analysis_input_revision=d.analysis_input_revision from public.total_loss_analysis_jobs j join public.total_loss_case_details d using(case_id) where case_id='47100000-0000-4000-8000-000000000001'),'job uses exact confirmed input');
select is(pg_temp.claim(expected_revision=>2147483646),'case_not_ready','stale request cannot reenter running analysis');
select * from finish();
rollback;
