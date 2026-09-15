begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local storage.allow_delete_query='true';
select no_plan();

-- Synthetic trusted calculation fixture; full calculated evidence is covered by offline application tests.
create function pg_temp.strict_review_fixture(c uuid,u uuid,classification text default 'POTENTIAL_UNDERVALUE',strength text default 'MODERATE') returns jsonb
language plpgsql as $$
declare ctx jsonb; w uuid; token uuid:=gen_random_uuid(); calc jsonb; result jsonb; reviewed uuid:=gen_random_uuid();
begin
 ctx:=public.get_total_loss_full_review_context(c,u);
 w:=public.enqueue_total_loss_full_review(c,u,(ctx->'report'->>'id')::uuid,(ctx->'report'->>'revision')::bigint);
 result:=public.claim_total_loss_full_review_work(w,token);
 if result->>'state'<>'claimed' then raise exception 'Fixture work not claimed'; end if;
 calc:=jsonb_build_object('newProviderRequests',0,'artifact',jsonb_build_object('runId',reviewed,
   'result',jsonb_build_object('discrepancyResult',jsonb_build_object('classification',classification,'evidenceStrength',strength),
    'preliminaryQualification',jsonb_build_object('qualificationVersion','1','marketClassification',classification,
      'outcome','CLEAR_MARKET_VALUE_GAP','unresolvedMaterialChecks','[]'::jsonb,'applicableMaterialReviewComplete',true))),
   'presentation',jsonb_build_object('runId',reviewed,'assessment',jsonb_build_object('classification',classification,'evidenceStrength',strength)));
 if not public.complete_total_loss_full_review_work(w,token,(ctx->'report'->>'revision')::bigint,calc,repeat('e',64)) then raise exception 'Fixture review not completed'; end if;
 return public.get_total_loss_full_review_context(c,u)->'strict_review';
end $$;


-- Synthetic completed analysis and trusted extraction boundary for SQL tests.
create function pg_temp.checkout_initialization_fixture(case_uuid uuid, owner_uuid uuid,
  result_outcome text default 'LISTING_CONTEXT', make_ready boolean default true,
  result_classification text default 'INSUFFICIENT_EVIDENCE')
returns jsonb language plpgsql as $$
declare
  input_uuid uuid := gen_random_uuid(); job_uuid uuid := gen_random_uuid();
  run_uuid uuid := gen_random_uuid(); report_uuid uuid := gen_random_uuid();
  token_uuid uuid := gen_random_uuid(); report jsonb; presentation jsonb; strict_review jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values(owner_uuid,'checkout-'||owner_uuid::text||'@example.test',now(),false) on conflict(id) do nothing;
  insert into public.appraisal_cases(id,user_id,service_type,status)
    values(case_uuid,owner_uuid,'total_loss','check_complete');
  insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,
    vehicle_trim,mileage_at_loss,postal_code,date_of_loss,intake_completed_at,analysis_input_revision,analysis_input_id)
    values(case_uuid,'manual',2024,'Honda','Accord','EX',32000,'60601',current_date-10,now(),1,input_uuid);
  insert into public.total_loss_case_contacts(case_id,full_name,email,service_terms_version,service_terms_acknowledged_at,
    privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,operational_follow_up_updated_at)
    values(case_uuid,'Fixture Driver','checkout-'||owner_uuid::text||'@example.test','2026-08-23',now(),'2026-08-23',now(),false,now());
  insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,attempt_count,
    processing_token,run_id,finished_at,source_intake_mode,source_analysis_input_revision,source_analysis_input_id)
    values(job_uuid,case_uuid,now(),'completed',1,token_uuid,run_uuid,now(),'manual',1,input_uuid);
  insert into public.analysis_runs(id,job_id,case_id,artifact,request_digest,analysis_run_schema_version,
    analysis_version,discrepancy_analysis_version,comparable_scoring_version)
    values(run_uuid,job_uuid,case_uuid,jsonb_build_object('runId',run_uuid,
      'result',jsonb_build_object('discrepancyResult',jsonb_build_object('classification',result_classification))),
      repeat('1',64),'12','4','1','1');
  presentation := jsonb_build_object('runId',run_uuid,'presentationVersion','8',
    'assessment',jsonb_build_object('classification',result_classification),
    'preliminaryResult',jsonb_build_object('outcome',result_outcome));
  report := public.begin_total_loss_full_review_report(case_uuid,owner_uuid,report_uuid,'fixture.pdf',repeat('a',64),123);
  insert into storage.objects(bucket_id,name,metadata)
    values('case-files',report->>'storage_object_name','{"size":123,"mimetype":"application/pdf"}');
  if make_ready then
    report := public.transition_total_loss_full_review_report(case_uuid,owner_uuid,report_uuid,1,'uploaded',null,null,null);
    report := public.transition_total_loss_full_review_report(case_uuid,owner_uuid,report_uuid,2,'extracting',token_uuid,null,null);
    report := public.transition_total_loss_full_review_report(case_uuid,owner_uuid,report_uuid,3,'ready',token_uuid,
      jsonb_build_object('documentSha256',repeat('a',64)),'{"stage":"full_review","ready":true,"issues":[]}');
  end if;
  if make_ready then strict_review:=pg_temp.strict_review_fixture(case_uuid,owner_uuid); end if;
  return jsonb_build_object('strictReview',coalesce(strict_review->>'id',gen_random_uuid()::text),'strictDigest',repeat('e',64),'case',case_uuid,'owner',owner_uuid,'input',input_uuid,'revision',1,'run',run_uuid,
    'report',report_uuid,'reportRevision',report->'revision','presentation',presentation,'digest',repeat('b',64));
end;
$$;

create function pg_temp.initialize_checkout(f jsonb) returns text language sql as $$
  select public.initialize_total_loss_post_continue((f->>'case')::uuid,(f->>'owner')::uuid,
    (f->>'run')::uuid,(f->>'input')::uuid,(f->>'revision')::bigint,
    (f->>'report')::uuid,(f->>'reportRevision')::bigint,f->'presentation',f->>'digest',
    (f->>'strictReview')::uuid,'1',f->>'strictDigest');
$$;


insert into auth.users(id,email,email_confirmed_at,is_anonymous)
values('54100000-0000-4000-8000-000000000001','navigation-owner@example.test',now(),false),
('54100000-0000-4000-8000-000000000002','navigation-other@example.test',now(),false);
select set_config('request.jwt.claim.sub','54100000-0000-4000-8000-000000000001',true);
select is(public.get_account_workspace_role(),'customer','an ordinary owner remains a customer');
select is((select count(*) from public.list_owned_case_operations()),0::bigint,'zero cases remain empty after navigation');
select ok(not has_function_privilege('authenticated','public.owned_case_operations_before_navigation_internal()','execute'),'internal list is not browser callable');
select ok(not has_function_privilege('anon','public.list_owned_case_operations()','execute'),'unauthenticated list access is denied');
select ok(not has_function_privilege('anon','public.get_account_workspace_role()','execute'),'unauthenticated role lookup is denied');

create temp table navigation_fixture(name text,f jsonb);
insert into navigation_fixture values
('ready',pg_temp.checkout_initialization_fixture('54200000-0000-4000-8000-000000000001','54100000-0000-4000-8000-000000000001')),
('upload',pg_temp.checkout_initialization_fixture('54200000-0000-4000-8000-000000000002','54100000-0000-4000-8000-000000000001','ESTIMATE',false)),
('other',pg_temp.checkout_initialization_fixture('54200000-0000-4000-8000-000000000003','54100000-0000-4000-8000-000000000002'));
select is((select count(*) from public.list_owned_case_operations()),2::bigint,'all owned appraisals are available to the switcher');
select is((select count(*) from public.list_owned_case_operations() where owner_user_id <> auth.uid()),0::bigint,'other owners are excluded');
select ok((select bool_and(vehicle_label='2024 Honda Accord' and has_full_review_report) from public.list_owned_case_operations()),'vehicle identity and report continuation are projected');
select is((select workspace_status from public.list_owned_case_operations() where case_id='54200000-0000-4000-8000-000000000001'),'review_prepared','prepared review remains a report workspace before checkout');
select is((select workspace_status from public.list_owned_case_operations() where case_id='54200000-0000-4000-8000-000000000002'),'uploading','unfinished upload is resumed');
select ok(not public.total_loss_payment_approved('54200000-0000-4000-8000-000000000001','54100000-0000-4000-8000-000000000001'),'navigation never grants manual payment approval');

create function pg_temp.navigation_fingerprint() returns text language plpgsql as $$
declare item record; digest text; combined text := '';
begin
 for item in select tablename from pg_tables where schemaname='public' order by tablename loop
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, chr(10) order by to_jsonb(t)::text), %L)) from public.%I t','',''||item.tablename) into digest;
  combined := combined || item.tablename || digest;
 end loop;
 return md5(combined);
end $$;
create temp table navigation_before as select pg_temp.navigation_fingerprint() digest;
select count(*) from public.list_owned_case_operations();
select count(*) from public.list_owned_case_operations();
select public.get_account_workspace_role();
select is(pg_temp.navigation_fingerprint(),(select digest from navigation_before),'opening and reopening leaves every public table byte-identical');
select ok((select manual_approval_required from public.total_loss_payment_approval_settings),'manual first-payment supervision remains required');
select is((select count(*) from public.commerce_orders),0::bigint,'no checkout or payment created');

insert into public.staff_members(user_id) values('54100000-0000-4000-8000-000000000001');
select is(public.get_account_workspace_role(),'staff','database membership selects staff destination');
delete from public.staff_members where user_id='54100000-0000-4000-8000-000000000001';
select is(public.get_account_workspace_role(),'customer','revocation takes effect with the same token');
update auth.users set raw_user_meta_data='{"role":"admin","is_staff":true}' where id='54100000-0000-4000-8000-000000000001';
select is(public.get_account_workspace_role(),'customer','browser metadata cannot select staff access');
select set_config('request.jwt.claim.sub','54100000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.list_owned_case_operations()),1::bigint,'switching owner exposes only the new account');
select is((select count(*) from public.list_owned_case_operations() where case_id='54200000-0000-4000-8000-000000000001'),0::bigint,'previous owner data cannot be fetched');
select * from finish();
rollback;
