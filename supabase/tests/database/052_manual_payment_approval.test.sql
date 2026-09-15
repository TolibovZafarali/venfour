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

create temp table approval_fixture(name text primary key,f jsonb,lineage jsonb);
insert into approval_fixture(name,f)
select name,pg_temp.checkout_initialization_fixture(
  ('53100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('53200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)
from unnest(array['ready','input','report','hold','decline','missing','other','insufficient']) with ordinality names(name,n);
update approval_fixture set lineage=public.payment_approval_lineage_internal(
  public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid));
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
  values('53300000-0000-4000-8000-000000000001','launch-reviewer@example.test',now(),false);
insert into public.staff_members(user_id) values('53300000-0000-4000-8000-000000000001');

select ok((select not manual_approval_required from public.total_loss_payment_approval_settings),'manual payment approval is disabled on installation');
-- Exercise retained decision history and access controls in an isolated transaction.
update public.total_loss_payment_approval_settings set manual_approval_required=true;
select ok((select relrowsecurity from pg_class where oid=('public.'||name)::regclass),'RLS enabled for '||name)
from unnest(array['total_loss_payment_approval_settings','total_loss_payment_approval_decisions']) name;
select ok(not has_table_privilege(role,'public.'||name,'INSERT,UPDATE,DELETE'),'direct writes denied to '||role||' on '||name)
from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['total_loss_payment_approval_settings','total_loss_payment_approval_decisions']) name;
select ok(not has_function_privilege(role,p.oid,'EXECUTE'),'renamed bypass denied to '||role||': '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) role
where n.nspname='public' and p.proname in ('checkout_preflight_before_approval_internal','reserve_checkout_before_approval_internal','initialize_post_continue_before_approval_internal');
select ok(not has_function_privilege('anon','public.staff_payment_approval_decide(uuid,jsonb,text,uuid)','EXECUTE'),'anonymous role cannot approve');

select ok(public.total_loss_full_review_ready((f->>'case')::uuid,(f->>'owner')::uuid),'strict readiness passes independently') from approval_fixture where name='ready';
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'strict-ready but unapproved cannot pay') from approval_fixture where name='ready';
select is(pg_temp.initialize_checkout(f),'not_ready','direct continuation is blocked without approval') from approval_fixture where name='ready';
select throws_ok($$select public.reserve_total_loss_checkout('53100000-0000-4000-8000-000000000001','53200000-0000-4000-8000-000000000001',gen_random_uuid(),'total_loss_advisory_package','v1','price_fixture',19900,'USD','terms','refund',false)$$,
  'P0001','PAYMENT_APPROVAL_REQUIRED','direct reservation is blocked without approval');

select set_config('request.jwt.claim.sub','53200000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.staff_payment_approval_queue()$$,'42501','Staff access required.','customer cannot read launch queue');
select throws_ok($$select public.staff_payment_approval_decide('53100000-0000-4000-8000-000000000001','{}','approved',gen_random_uuid())$$,
  '42501','Staff access required.','customer cannot self-approve');
reset role;
select set_config('request.jwt.claim.sub','53300000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.staff_payment_approval_queue()),8,'staff queue includes only current qualifying cases');
select throws_ok($$select public.staff_payment_approval_decide((f->>'case')::uuid,jsonb_set(lineage,'{reportId}',to_jsonb(gen_random_uuid())),'approved',gen_random_uuid()) from approval_fixture where name='ready'$$,
  'P0001','PAYMENT_APPROVAL_STALE','old or foreign report cannot be approved');
select throws_ok($$select public.staff_payment_approval_decide((f->>'case')::uuid,jsonb_set(lineage,'{inputRevision}','0'),'approved',gen_random_uuid()) from approval_fixture where name='ready'$$,
  'P0001','PAYMENT_APPROVAL_STALE','old input cannot be approved');
select throws_ok($$select public.staff_payment_approval_decide((f->>'case')::uuid,jsonb_set(lineage,'{assessmentDigest}',to_jsonb(repeat('c',64))),'approved',gen_random_uuid()) from approval_fixture where name='ready'$$,
  'P0001','PAYMENT_APPROVAL_STALE','old evidence digest cannot be approved');
select throws_ok($$select public.staff_payment_approval_decide('53100000-0000-4000-8000-000000000007',lineage,'approved',gen_random_uuid()) from approval_fixture where name='ready'$$,
  'P0001','PAYMENT_APPROVAL_STALE','approval cannot be reused across cases');

create temp table approval_result as select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'approved','53400000-0000-4000-8000-000000000001') result from approval_fixture where name='ready';
select is(public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'approved','53400000-0000-4000-8000-000000000001'),(select result from approval_result),'identical retry returns the same durable decision') from approval_fixture where name='ready';
select is((select count(*) from public.total_loss_payment_approval_decisions),1::bigint,'retry does not insert another decision');
select ok(public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'exact current approved synthetic lineage becomes eligible') from approval_fixture where name='ready';
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,'53300000-0000-4000-8000-000000000001'),'approval cannot bypass ownership') from approval_fixture where name='ready';
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'another strict-ready case remains blocked') from approval_fixture where name='other';
select ok((select staff_id='53300000-0000-4000-8000-000000000001' and created_at is not null and lineage=(select lineage from approval_fixture where name='ready') from public.total_loss_payment_approval_decisions),'decision records staff, time, and exact immutable lineage');
select throws_ok($$update public.total_loss_payment_approval_decisions set decision='held'$$,'P0001','PAYMENT_APPROVAL_IMMUTABLE','decision history cannot be rewritten');
select throws_ok($$delete from public.total_loss_payment_approval_decisions$$,'P0001','PAYMENT_APPROVAL_IMMUTABLE','decision history cannot be deleted');

-- Change each lineage component in the current context; no stale projection can authorize payment.
select ok(public.payment_approval_status_internal(jsonb_set(ctx,path,value))->'approved'='false'::jsonb,'current approval invalidates on '||label)
from (select public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid) ctx from approval_fixture where name='ready') s
cross join (values
 ('case',array['case_id'],to_jsonb(gen_random_uuid())),
 ('owner',array['user_id'],to_jsonb(gen_random_uuid())),
 ('input ID',array['source_input_id'],to_jsonb(gen_random_uuid())),
 ('input revision',array['source_input_revision'],'2'::jsonb),
 ('report ID',array['report','id'],to_jsonb(gen_random_uuid())),
 ('report revision',array['report','revision'],'99'::jsonb),
 ('document digest',array['report','document_sha256'],to_jsonb(repeat('b',64))),
 ('assessment ID',array['strict_review','id'],to_jsonb(gen_random_uuid())),
 ('assessment version',array['strict_review','review_version'],'"2"'::jsonb),
 ('evidence digest',array['strict_review','calculation_digest'],to_jsonb(repeat('b',64))),
 ('assessment payload',array['strict_review','calculation','newProviderRequests'],'1'::jsonb),
 ('source snapshot',array['artifact','runId'],to_jsonb(gen_random_uuid())),
 ('readiness recalculation',array['report','readiness','recalculated'],'true'::jsonb),
 ('input facts',array['input','vehicle_trim'],'"changed"'::jsonb)
) changes(label,path,value);

select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'approved',gen_random_uuid()) from approval_fixture where name in ('input','report','hold','decline','missing');
update public.total_loss_case_details set vehicle_trim='Sport' where case_id='53100000-0000-4000-8000-000000000002';
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'saved input edit invalidates prior approval') from approval_fixture where name='input';
select public.begin_total_loss_full_review_report((f->>'case')::uuid,(f->>'owner')::uuid,gen_random_uuid(),'replacement.pdf',repeat('b',64),124) from approval_fixture where name='report';
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'actual replacement PDF invalidates approval') from approval_fixture where name='report';
select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'held',gen_random_uuid()) from approval_fixture where name='hold';
select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'declined',gen_random_uuid()) from approval_fixture where name='decline';
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'latest hold or decline blocks approved lineage') from approval_fixture where name in ('hold','decline');
delete from public.total_loss_payment_approval_settings;
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),'missing setting blocks even an exact approval') from approval_fixture where name='missing';
insert into public.total_loss_payment_approval_settings values(true,true);
select throws_ok($$update public.total_loss_payment_approval_settings set manual_approval_required=null$$,'23502',null,'invalid setting cannot be stored');

-- Test a legacy nonqualifying strict result without altering valuation rules.
alter table public.total_loss_full_review_assessments disable trigger protect_full_review_assessment;
update public.total_loss_full_review_assessments set calculation=jsonb_set(calculation,'{artifact,result,discrepancyResult,evidenceStrength}','"LOW"')
  where case_id='53100000-0000-4000-8000-000000000008';
alter table public.total_loss_full_review_assessments enable trigger protect_full_review_assessment;
update approval_fixture set lineage=public.payment_approval_lineage_internal(public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid)) where name='insufficient';
select throws_ok($$select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'approved',gen_random_uuid()) from approval_fixture where name='insufficient'$$,
  'P0001','PAYMENT_APPROVAL_NOT_READY','staff cannot override insufficient evidence');
select ok(not exists(select 1 from jsonb_array_elements(public.staff_payment_approval_queue()) row where row->>'caseId'='53100000-0000-4000-8000-000000000008'),'insufficient case is excluded from approval queue');
insert into public.staff_members(user_id) values('53200000-0000-4000-8000-000000000007');
select set_config('request.jwt.claim.sub','53200000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'approved',gen_random_uuid()) from approval_fixture where name='other'$$,
  '42501','Payment review unavailable.','even staff cannot approve their own case');
select set_config('request.jwt.claim.sub','53300000-0000-4000-8000-000000000001',true);

select is(pg_temp.initialize_checkout(f),'created','exact approved lineage may initialize the existing checkout workflow') from approval_fixture where name='ready';
select ok((select checkout_available from public.authorize_total_loss_checkout_preflight((f->>'case')::uuid,(f->>'owner')::uuid)),'server preflight allows the approved synthetic lineage') from approval_fixture where name='ready';

-- Exercise the real guest claim transition after approval and before payment.
insert into approval_fixture(name,f) values('guest',pg_temp.checkout_initialization_fixture(
  '53100000-0000-4000-8000-000000000009','53200000-0000-4000-8000-000000000009'));
update auth.users set email=null,email_confirmed_at=null,is_anonymous=true
  where id='53200000-0000-4000-8000-000000000009';
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(
  '53500000-0000-4000-8000-000000000001','checkout-53200000-0000-4000-8000-000000000009@example.test',now(),false);
select set_config('request.jwt.claim.sub','53300000-0000-4000-8000-000000000001',true);
update approval_fixture set lineage=public.payment_approval_lineage_internal(
  public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid)) where name='guest';
select public.staff_payment_approval_decide((f->>'case')::uuid,lineage,'approved',gen_random_uuid()) from approval_fixture where name='guest';
select is(pg_temp.initialize_checkout(f),'created','approved guest can prepare the ordinary claim workflow') from approval_fixture where name='guest';
select set_config('request.jwt.claim.sub','53200000-0000-4000-8000-000000000009',true);
create temp table guest_approval_claim as select claim_id from public.renew_total_loss_case_claim('53100000-0000-4000-8000-000000000009');
select set_config('request.jwt.claim.sub','53500000-0000-4000-8000-000000000001',true);
select is((select outcome from public.complete_total_loss_case_claim_with_context((select claim_id from guest_approval_claim))),
  'claimed','approved guest case transfers through the existing claim function');
select ok(public.total_loss_full_review_ready('53100000-0000-4000-8000-000000000009','53500000-0000-4000-8000-000000000001'),
  'guest transfer preserves strict evidence readiness');
select ok(not public.total_loss_payment_approved('53100000-0000-4000-8000-000000000009','53500000-0000-4000-8000-000000000001'),
  'actual ownership transfer invalidates the guest approval');
select ok(not (select checkout_available from public.authorize_total_loss_checkout_preflight(
  '53100000-0000-4000-8000-000000000009','53500000-0000-4000-8000-000000000001')),
  'claimed customer cannot pay using the former guest approval');
select set_config('request.jwt.claim.sub','53300000-0000-4000-8000-000000000001',true);
select ok(exists(select 1 from jsonb_array_elements(public.staff_payment_approval_queue()) item
  where item->>'caseId'='53100000-0000-4000-8000-000000000009'),
  'claimed customer returns to the staff queue for current-owner approval');
select public.staff_payment_approval_decide('53100000-0000-4000-8000-000000000009',
  public.payment_approval_lineage_internal(public.get_total_loss_full_review_context(
    '53100000-0000-4000-8000-000000000009','53500000-0000-4000-8000-000000000001')),'approved',gen_random_uuid());
select ok((select checkout_available from public.authorize_total_loss_checkout_preflight(
  '53100000-0000-4000-8000-000000000009','53500000-0000-4000-8000-000000000001')),
  'fresh staff approval restores checkout after the real guest claim transition');
select is((select count(*) from public.payment_transactions),0::bigint,'no payment created');
select is((select count(*) from public.case_entitlements),0::bigint,'no entitlement created');
select is((select count(*) from public.checkout_attempts),0::bigint,'no checkout session or reservation created');

-- Disabling launch supervision preserves strict eligibility and historical decisions.
update public.total_loss_payment_approval_settings set manual_approval_required=false;
create temp table previous_decisions as select count(*) total from public.total_loss_payment_approval_decisions;
select is(jsonb_array_length(public.staff_payment_approval_queue()),0,'disabled supervision has no approval queue');
select ok(public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),
  'qualifying case can pay without a current approval: '||name)
  from approval_fixture where name in ('other','hold','decline');
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,(f->>'owner')::uuid),
  'automated eligibility still blocks invalid evidence: '||name)
  from approval_fixture where name in ('input','report','insufficient');
select ok(not public.total_loss_payment_approved((f->>'case')::uuid,'53300000-0000-4000-8000-000000000001'),
  'disabling supervision does not bypass case ownership') from approval_fixture where name='other';
select is(public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid)#>>'{payment_approval,status}',
  'not_required','customer state declares no manual approval requirement') from approval_fixture where name='other';
select is(pg_temp.initialize_checkout(f),'created','unapproved qualifying case can initialize checkout') from approval_fixture where name='other';
select is(pg_temp.initialize_checkout(f),'existing','repeated automatic continuation is idempotent') from approval_fixture where name='other';
select ok((select checkout_available from public.authorize_total_loss_checkout_preflight((f->>'case')::uuid,(f->>'owner')::uuid)),
  'server preflight allows payment without staff approval') from approval_fixture where name='other';
select lives_ok($$select public.reserve_total_loss_checkout('53100000-0000-4000-8000-000000000007','53200000-0000-4000-8000-000000000007',
  gen_random_uuid(),'total_loss_advisory_package','v1','price_fixture',19900,'USD','terms','refund',false)$$,
  'existing checkout reservation succeeds without staff approval');
select is((select count(*) from public.total_loss_payment_approval_decisions),(select total from previous_decisions),
  'automatic checkout neither creates nor deletes historical approval decisions');
select is((select count(*) from public.payment_transactions),0::bigint,'automatic eligibility creates no payment');
select is((select count(*) from public.case_entitlements),0::bigint,'automatic eligibility creates no paid entitlement');
select * from finish();
rollback;
