begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

select has_column('public', 'total_loss_case_details', 'vehicle_facts','confirmed subject fact storage exists');
select has_column('public', 'total_loss_analysis_jobs', 'subject_readiness','durable readiness guidance exists');
select ok(public.subject_vehicle_facts_are_valid('{"bodyType":"Sedan","drivetrain":"FWD","engine":"2.0L I4"}'), 'partial explicit facts can be saved before confirmation');
select ok(not public.subject_vehicle_facts_are_valid('{"apiKey":"secret"}'), 'unknown fields rejected');
select ok(not public.subject_vehicle_facts_are_valid('{"drivetrain":"unknown"}'), 'drive values bounded');
select ok(not public.subject_vehicle_facts_are_valid('{"engine":true}'), 'wrong fact types rejected');
select ok(not public.subject_vehicle_facts_are_valid(jsonb_build_object('engine', repeat('x', 201))), 'fact length bounded');
select ok(not has_column_privilege('anon','public.total_loss_case_details','vehicle_facts','SELECT'), 'unauthenticated reads denied');
select ok(has_column_privilege('authenticated','public.total_loss_case_details','vehicle_facts','UPDATE'), 'owned draft facts editable');
select ok(not has_function_privilege('authenticated','public.fail_total_loss_analysis_subject_readiness(uuid,uuid,jsonb)','EXECUTE'), 'customer cannot forge a readiness failure');
select ok(has_function_privilege('service_role','public.fail_total_loss_analysis_subject_readiness(uuid,uuid,jsonb)','EXECUTE'), 'worker can persist fenced readiness');

insert into auth.users(id,email,is_anonymous,email_confirmed_at) values
 ('41111111-1111-4111-8111-111111111111','subject-owner@example.test',false,statement_timestamp()),
 ('41222222-2222-4222-8222-222222222222',null,true,null);
insert into public.appraisal_cases(id,user_id,service_type,status) values
 ('41a11111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111','total_loss','draft'),
 ('41a22222-2222-4222-8222-222222222222','41222222-2222-4222-8222-222222222222','total_loss','draft');
insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,
 mileage_at_loss,postal_code,date_of_loss,insurer_name,analysis_input_revision,analysis_input_id,intake_completed_at) values
 ('41a11111-1111-4111-8111-111111111111','manual',2025,'Hyundai','Elantra','SEL',32000,'63123','2026-08-03','Example',1,'41b11111-1111-4111-8111-111111111111',statement_timestamp()),
 ('41a22222-2222-4222-8222-222222222222','manual',2025,'Hyundai','Elantra','SEL',32000,'63123','2026-08-03','Example',1,'41b22222-2222-4222-8222-222222222222',null);
create temp table original_subject_snapshot as select public.build_total_loss_analysis_input_snapshot(d) as snapshot
 from public.total_loss_case_details d where case_id='41a11111-1111-4111-8111-111111111111';

set local role authenticated;
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
select lives_ok($$update public.total_loss_case_details set vehicle_facts='{"bodyType":"Sedan","drivetrain":"FWD"}' where case_id='41a11111-1111-4111-8111-111111111111'$$, 'owner saves explicit facts');
select is((select count(*) from public.total_loss_case_details where case_id='41a22222-2222-4222-8222-222222222222'),0::bigint,'other customer facts remain hidden');
reset role;
select is((select analysis_input_revision from public.total_loss_case_details where case_id='41a11111-1111-4111-8111-111111111111'),2::bigint,'fact edit advances input revision');
select ok((select intake_completed_at is null and analysis_input_id <> '41b11111-1111-4111-8111-111111111111'::uuid from public.total_loss_case_details where case_id='41a11111-1111-4111-8111-111111111111'),'fact edit clears confirmation and rotates fence');
select is((select snapshot->'vehicle_facts' from original_subject_snapshot),'null'::jsonb,'earlier snapshot remains unchanged');
select is((select public.build_total_loss_analysis_input_snapshot(d)->'vehicle_facts' from public.total_loss_case_details d where case_id='41a11111-1111-4111-8111-111111111111'),'{"bodyType":"Sedan","drivetrain":"FWD"}'::jsonb,'new snapshot carries exact confirmed facts');
update public.total_loss_case_details set vehicle_facts='{"drivetrain":"FWD","bodyType":"Sedan"}' where case_id='41a11111-1111-4111-8111-111111111111';
select is((select analysis_input_revision from public.total_loss_case_details where case_id='41a11111-1111-4111-8111-111111111111'),2::bigint,'unchanged facts do not rotate input');
update public.total_loss_case_details set vehicle_trim='Limited' where case_id='41a11111-1111-4111-8111-111111111111';
select ok((select vehicle_facts is null from public.total_loss_case_details where case_id='41a11111-1111-4111-8111-111111111111'),'identity change clears stale facts');

set local role authenticated;
select set_config('request.jwt.claim.sub','41222222-2222-4222-8222-222222222222',true);
select lives_ok($$update public.total_loss_case_details set vehicle_facts='{"drivetrain":"FWD"}' where case_id='41a22222-2222-4222-8222-222222222222'$$,'guest uses the same owned fact editing path');
reset role;
update public.appraisal_cases set status='checking' where id='41a22222-2222-4222-8222-222222222222';
insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,attempt_count,processing_token,run_id,
 processing_expires_at,source_intake_mode,source_analysis_input_revision,source_analysis_input_id)
select '41c22222-2222-4222-8222-222222222222',case_id,updated_at,'processing',1,'41d22222-2222-4222-8222-222222222222','41e22222-2222-4222-8222-222222222222',
 statement_timestamp()+interval '15 minutes','manual',analysis_input_revision,analysis_input_id
from public.total_loss_case_details where case_id='41a22222-2222-4222-8222-222222222222';
select ok(not public.fail_total_loss_analysis_subject_readiness('41c22222-2222-4222-8222-222222222222','41d11111-1111-4111-8111-111111111111','{"ready":false,"issues":[]}'),'stale worker cannot write readiness');
select ok(public.fail_total_loss_analysis_subject_readiness('41c22222-2222-4222-8222-222222222222','41d22222-2222-4222-8222-222222222222','{"ready":false,"issues":[{"field":"engine"}]}'),'current worker records failed readiness atomically');
select is((select subject_readiness from public.get_total_loss_analysis_status('41a22222-2222-4222-8222-222222222222','41222222-2222-4222-8222-222222222222')),'{"ready":false,"issues":[{"field":"engine"}]}'::jsonb,'resume exposes the exact failed job readiness');
select is((select status::text from public.appraisal_cases where id='41a22222-2222-4222-8222-222222222222'),'draft','failed readiness releases the same case for correction');
select * from finish();
rollback;
