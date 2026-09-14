begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local storage.allow_delete_query='true';
select no_plan();

-- Synthetic completed analysis and trusted extraction boundary for SQL tests.
create function pg_temp.checkout_initialization_fixture(case_uuid uuid, owner_uuid uuid,
  result_outcome text default 'LISTING_CONTEXT', make_ready boolean default true,
  result_classification text default 'INSUFFICIENT_EVIDENCE')
returns jsonb language plpgsql as $$
declare
  input_uuid uuid := gen_random_uuid(); job_uuid uuid := gen_random_uuid();
  run_uuid uuid := gen_random_uuid(); report_uuid uuid := gen_random_uuid();
  token_uuid uuid := gen_random_uuid(); report jsonb; presentation jsonb;
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
  return jsonb_build_object('case',case_uuid,'owner',owner_uuid,'input',input_uuid,'revision',1,'run',run_uuid,
    'report',report_uuid,'reportRevision',report->'revision','presentation',presentation,'digest',repeat('b',64));
end;
$$;

create function pg_temp.initialize_checkout(f jsonb) returns text language sql as $$
  select public.initialize_total_loss_post_continue((f->>'case')::uuid,(f->>'owner')::uuid,
    (f->>'run')::uuid,(f->>'input')::uuid,(f->>'revision')::bigint,
    (f->>'report')::uuid,(f->>'reportRevision')::bigint,f->'presentation',f->>'digest');
$$;
create temp table initialization_fixtures(name text primary key,f jsonb);
insert into initialization_fixtures values
 ('context',pg_temp.checkout_initialization_fixture('48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001')),
 ('estimate',pg_temp.checkout_initialization_fixture('48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002','ESTIMATE')),
 ('insufficient',pg_temp.checkout_initialization_fixture('48100000-0000-4000-8000-000000000003','48200000-0000-4000-8000-000000000003','INSUFFICIENT')),
 ('not_ready',pg_temp.checkout_initialization_fixture('48100000-0000-4000-8000-000000000004','48200000-0000-4000-8000-000000000004','LISTING_CONTEXT',false)),
 ('signal',pg_temp.checkout_initialization_fixture('48100000-0000-4000-8000-000000000005','48200000-0000-4000-8000-000000000005','ESTIMATE',true,'MATERIAL_UNDERVALUE_SIGNAL'));

select ok(has_function_privilege('service_role',
  'public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text)','EXECUTE'),'initializer is available to service workers');
select ok(not has_function_privilege(role,
  'public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text)','EXECUTE'),'initializer denies '||role)
  from unnest(array['anon','authenticated']) role;
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc
  where oid='public.initialize_total_loss_post_continue(uuid,uuid,uuid,uuid,bigint,uuid,bigint,jsonb,text)'::regprocedure),'initializer has definer isolation');
select ok(not has_function_privilege(role,'public.total_loss_preliminary_checkout_eligible_internal(uuid)','EXECUTE'),'eligibility helper is private for '||role)
  from unnest(array['anon','authenticated','service_role']) role;
select ok((select relrowsecurity from pg_class where oid='public.total_loss_preliminary_snapshots'::regclass)
  and not has_table_privilege('authenticated','public.total_loss_preliminary_snapshots','INSERT'),'snapshot RLS and direct-write restrictions retained');
select is((public.get_total_loss_full_review_context('48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001')->>'source_input_revision')::bigint,1::bigint,'context exposes the exact completed input revision');
select is(pg_temp.initialize_checkout(f||jsonb_build_object('owner','48200000-0000-4000-8000-000000000004')),'not_found','different owner is rejected') from initialization_fixtures where name='context';
select is(pg_temp.initialize_checkout(f||jsonb_build_object(key,value)),'stale','stale '||key||' is rejected')
  from initialization_fixtures cross join (values
    ('run',to_jsonb('48300000-0000-4000-8000-000000000099'::text)),
    ('input',to_jsonb('48300000-0000-4000-8000-000000000099'::text)),
    ('revision','2'::jsonb),('report',to_jsonb('48300000-0000-4000-8000-000000000099'::text)),
    ('reportRevision','99'::jsonb)) bad(key,value) where name='context';
select is(pg_temp.initialize_checkout(f),'not_ready','upload without extraction cannot initialize') from initialization_fixtures where name='not_ready';
select is(pg_temp.initialize_checkout(jsonb_set(f,'{presentation,assessment,classification}','"MATERIAL_UNDERVALUE_SIGNAL"')),
  'not_ready','cannot fabricate an underpayment classification') from initialization_fixtures where name='context';
select is(pg_temp.initialize_checkout(jsonb_set(f,'{presentation,preliminaryResult}','null')),
  'not_ready','interrupted analysis cannot initialize') from initialization_fixtures where name='context';
select is(pg_temp.initialize_checkout(jsonb_set(f,'{presentation,presentationVersion}','"7"')),
  'not_ready','legacy unsupported classification does not create an unusable workflow') from initialization_fixtures where name='context';
select is((select count(*) from public.total_loss_preliminary_snapshots where case_id in
  (select (f->>'case')::uuid from initialization_fixtures)),0::bigint,'rejections create no snapshots');
select is((select count(*) from public.total_loss_claim_workflows where case_id in
  (select (f->>'case')::uuid from initialization_fixtures)),0::bigint,'rejections create no workflows');

create temp table immutable_initialization_before as select d.case_id,to_jsonb(d) details,a.artifact
  from public.total_loss_case_details d join public.analysis_runs a using(case_id)
  where d.case_id='48100000-0000-4000-8000-000000000001';
select is(pg_temp.initialize_checkout(f),'created',name||' initializes without changing methodology')
  from initialization_fixtures where name in ('context','estimate','insufficient','signal') order by name;
select is(pg_temp.initialize_checkout(f),'existing','identical initialization is idempotent') from initialization_fixtures where name='context';
select is(pg_temp.initialize_checkout(f||'{"digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'),
  'stale','changed frozen payload cannot replace existing history') from initialization_fixtures where name='context';
select ok(p.preliminary_classification='INSUFFICIENT_EVIDENCE'
  and p.snapshot->'presentation'=f->'presentation'
  and p.source_references->>'fullReviewReportId'=f->>'report'
  and p.source_references->>'fullReviewReportRevision'=f->>'reportRevision'
  and p.supported_range_low_minor_units is null and p.supported_range_median_minor_units is null
  and p.supported_range_high_minor_units is null,'listing context is frozen with exact report and no invented valuation')
  from initialization_fixtures join public.total_loss_preliminary_snapshots p on p.case_id=(f->>'case')::uuid where name='context';
select is((select to_jsonb(d) from public.total_loss_case_details d where case_id='48100000-0000-4000-8000-000000000001'),
  (select details from immutable_initialization_before),'initialization preserves sealed free input');
select is((select artifact from public.analysis_runs where case_id='48100000-0000-4000-8000-000000000001'),
  (select artifact from immutable_initialization_before),'initialization preserves free artifact');
select throws_ok($$update public.total_loss_preliminary_snapshots set preliminary_classification='POTENTIAL_UNDERVALUE'
  where case_id='48100000-0000-4000-8000-000000000001'$$,'55000',null,'preliminary history remains immutable');
select ok((select checkout_available from public.authorize_total_loss_checkout_preflight(
  '48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001')),'ready listing context can reach checkout');
select is((select count(*) from public.authorize_total_loss_checkout_preflight(
  '48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000002')),0::bigint,'checkout preflight rejects another owner');
select set_config('request.jwt.claim.sub','48200000-0000-4000-8000-000000000001',true);
set local role authenticated;
select ok((select state='secured' and checkout_available from public.resolve_total_loss_case_claim(
  '48100000-0000-4000-8000-000000000001')),'existing claim resolver exposes the secured continuation');
reset role;

create temp table initialization_order as select * from public.reserve_total_loss_checkout(
  '48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001',
  '48400000-0000-4000-8000-000000000001','total-loss-package','1','price_test_initialization',19900,'USD','terms-1','refund-1',false);
select is((select state::text from initialization_order),'reserved','review-ready context reserves the existing trusted price contract');
select ok((select amount_minor_units=19900 and currency='USD' from public.commerce_orders
  where case_id='48100000-0000-4000-8000-000000000001'),'trusted order is 199 USD');
select ok((select b.report_id::text=f->>'report' and b.report_revision::text=f->>'reportRevision'
  from public.total_loss_checkout_review_reports b join initialization_fixtures on b.case_id=(f->>'case')::uuid
  where name='context'),'existing report wrapper binds the exact accepted report');
select is((select order_id from public.reserve_total_loss_checkout(
  '48100000-0000-4000-8000-000000000001','48200000-0000-4000-8000-000000000001',
  '48400000-0000-4000-8000-000000000002','total-loss-package','1','price_test_initialization',19900,'USD','terms-1','refund-1',false)),
  (select order_id from initialization_order),'repeated checkout reuses the order');
select is((select count(*) from public.commerce_orders where case_id='48100000-0000-4000-8000-000000000001'),1::bigint,'no duplicate order is created');
select is((select count(*) from public.case_entitlements where case_id='48100000-0000-4000-8000-000000000001'),0::bigint,'initialization and reservation do not grant entitlement');
select throws_ok($$update public.total_loss_full_review_reports set readiness='{}'
  where case_id='48100000-0000-4000-8000-000000000001'$$,'P0001','FULL_REVIEW_REPORT_SEALED','report remains immutable after reservation');

-- An unpaid customer can explicitly prepare a replacement without rewriting the
-- free result or silently carrying an old ready-report authorization forward.
create temp table original_replacement_snapshot as select to_jsonb(p) original
  from public.total_loss_preliminary_snapshots p where case_id='48100000-0000-4000-8000-000000000002';
create temp table replaced_initialization as select f from initialization_fixtures where name='estimate';
create temp table replacement_document as select public.begin_total_loss_full_review_report(
  '48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002',
  '48500000-0000-4000-8000-000000000002','replacement.pdf',repeat('c',64),124) doc;
select is(pg_temp.initialize_checkout(f),'stale','old prepared report cannot be silently reused') from replaced_initialization;
insert into storage.objects(bucket_id,name,metadata)
  select 'case-files',doc->>'storage_object_name','{"size":124,"mimetype":"application/pdf"}'::jsonb from replacement_document;
update replacement_document set doc=public.transition_total_loss_full_review_report(
  '48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002',
  '48500000-0000-4000-8000-000000000002',1,'uploaded',null,null,null);
update replacement_document set doc=public.transition_total_loss_full_review_report(
  '48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002',
  '48500000-0000-4000-8000-000000000002',2,'extracting','48600000-0000-4000-8000-000000000002',null,null);
update replacement_document set doc=public.transition_total_loss_full_review_report(
  '48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002',
  '48500000-0000-4000-8000-000000000002',3,'ready','48600000-0000-4000-8000-000000000002',
  jsonb_build_object('documentSha256',repeat('c',64)),'{"stage":"full_review","ready":true,"issues":[]}');
select is((select count(*) from public.authorize_total_loss_checkout_preflight(
  '48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002')),0::bigint,
  'new ready report requires explicit new preparation');
update replaced_initialization set f=f||jsonb_build_object('report',doc->>'id','reportRevision',doc->'revision') from replacement_document;
select is(pg_temp.initialize_checkout(f),'created','explicit current replacement gets a new preparation generation') from replaced_initialization;
select is(pg_temp.initialize_checkout(f),'existing','replacement preparation repeats idempotently') from replaced_initialization;
select ok((select checkout_available from public.authorize_total_loss_checkout_preflight(
  '48100000-0000-4000-8000-000000000002','48200000-0000-4000-8000-000000000002')),'replacement can continue to checkout without another free analysis');
select is((select to_jsonb(p) from public.total_loss_preliminary_snapshots p where case_id='48100000-0000-4000-8000-000000000002'),
  (select original from original_replacement_snapshot),'replacement preserves original immutable snapshot byte-for-byte');
select is((select count(*) from public.total_loss_workflow_events where case_id='48100000-0000-4000-8000-000000000002'
  and event_type='full_review.checkout_prepared'),2::bigint,'both report preparation generations remain in history');
select throws_ok($$delete from public.total_loss_workflow_events where case_id='48100000-0000-4000-8000-000000000002'
  and event_type='full_review.checkout_prepared'$$,'55000',null,'preparation history cannot be rewritten');
update public.total_loss_full_review_reports set readiness=readiness where case_id='48100000-0000-4000-8000-000000000005';
select is((select count(*) from public.authorize_total_loss_checkout_preflight(
  '48100000-0000-4000-8000-000000000005','48200000-0000-4000-8000-000000000005')),0::bigint,
  'new underpayment-classified snapshot still enforces its exact report revision');

select * from finish();
rollback;
