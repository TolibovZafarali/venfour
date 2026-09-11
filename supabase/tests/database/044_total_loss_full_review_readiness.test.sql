begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local storage.allow_delete_query = 'true';

select plan(30);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('44100000-0000-4000-8000-000000000001', 'review-owner@example.test', statement_timestamp(), false),
  ('44100000-0000-4000-8000-000000000002', 'review-other@example.test', statement_timestamp(), false),
  ('44100000-0000-4000-8000-000000000003', 'review-anonymous@example.test', null, true);

insert into public.appraisal_cases (id, user_id, service_type, status)
values (
  '44200000-0000-4000-8000-000000000001',
  '44100000-0000-4000-8000-000000000001',
  'total_loss', 'check_complete'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
  analysis_input_id
) values (
  '44200000-0000-4000-8000-000000000001', 'manual',
  '1HGCM82633A004352', 2022, 'Honda', 'Accord', 'EX-L', 32000,
  '60601', '2026-08-20', 'Example Insurance', 18000,
  statement_timestamp(), 1, '44300000-0000-4000-8000-000000000001'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
) values (
  '44200000-0000-4000-8000-000000000001', 'Delivery Customer',
  'review-owner@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
) values (
  '44400000-0000-4000-8000-000000000001',
  '44200000-0000-4000-8000-000000000001', statement_timestamp(),
  'completed', 1, gen_random_uuid(),
  '44500000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual', 1, '44300000-0000-4000-8000-000000000001'
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  '44500000-0000-4000-8000-000000000001',
  '44400000-0000-4000-8000-000000000001',
  '44200000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'runId', '44500000-0000-4000-8000-000000000001',
    'result', jsonb_build_object(
      'discrepancyResult', jsonb_build_object(
        'classification', 'MATERIAL_UNDERVALUE_SIGNAL'
      )
    )
  ), repeat('1', 64), '4', '4', '1', '1'
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
) values (
  '44600000-0000-4000-8000-000000000001',
  '44200000-0000-4000-8000-000000000001',
  '44400000-0000-4000-8000-000000000001',
  '44500000-0000-4000-8000-000000000001',
  '44100000-0000-4000-8000-000000000001', 'manual', 1,
  '44300000-0000-4000-8000-000000000001',
  'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object('analysisRunId', '44500000-0000-4000-8000-000000000001'),
  jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
  repeat('2', 64)
);

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
) values (
  '44200000-0000-4000-8000-000000000001',
  '44600000-0000-4000-8000-000000000001',
  'review', 'secure_claim'
);


select has_table('public','total_loss_full_review_reports','report preparation has separate storage');
select ok((select relrowsecurity from pg_class where oid='public.total_loss_full_review_reports'::regclass),'report RLS enabled');
select ok(not has_table_privilege('authenticated','public.total_loss_full_review_reports','UPDATE'),'customer cannot mark report ready');
select ok(not has_function_privilege('authenticated','public.transition_total_loss_full_review_report(uuid,uuid,uuid,bigint,text,uuid,jsonb,jsonb)','EXECUTE'),'trusted transition RPC only');
select ok(public.get_total_loss_full_review_context('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000002') is null,'another owner cannot read report context');
select ok(not public.total_loss_full_review_ready('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001'),'free completion is not full readiness');
select ok(not (select checkout_available from public.authorize_total_loss_checkout_preflight('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001')),'checkout fails closed without report');
select throws_ok($$select public.reserve_total_loss_checkout('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44c00000-0000-4000-8000-000000000001','total-loss-package','1','price_test_total_loss_v1',9900,'USD','terms-1','refund-1',false)$$,'P0001','FULL_REVIEW_REPORT_REQUIRED','reservation enforces report gate');
create temp table review_original as select to_jsonb(d) details,(select artifact from public.analysis_runs where case_id=d.case_id) artifact from public.total_loss_case_details d where d.case_id='44200000-0000-4000-8000-000000000001';
create temp table review_document as select public.begin_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001','valuation.pdf',repeat('a',64),123) doc;
select is((select doc->>'status' from review_document),'uploading','upload is not implicitly ready');
select throws_ok($$select public.transition_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001',1,'uploaded',null,null,null)$$,'P0001','FULL_REVIEW_FILE_REQUIRED','cannot finalize a missing file');
grant select on review_document to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','44100000-0000-4000-8000-000000000002',true);
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) select 'case-files',doc->>'storage_object_name','{"size":123,"mimetype":"application/pdf"}'::jsonb from review_document$$,'42501',null,'another owner cannot upload into the report lease');
select set_config('request.jwt.claim.sub','44100000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) select 'case-files',doc->>'storage_object_name','{"size":124,"mimetype":"application/pdf"}'::jsonb from review_document$$,'42501',null,'incorrect upload size is rejected');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) select 'case-files',doc->>'storage_object_name','{"size":123,"mimetype":"text/plain"}'::jsonb from review_document$$,'42501',null,'non-PDF storage type is rejected');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) select 'case-files',doc->>'storage_object_name','{"size":123,"mimetype":"application/pdf"}'::jsonb from review_document$$,'owner can upload the exact prepared PDF');
update storage.objects set metadata='{"size":999}' where name=(select doc->>'storage_object_name' from review_document);
delete from storage.objects where name=(select doc->>'storage_object_name' from review_document);
reset role;
select is((select metadata->>'size' from storage.objects where name=(select doc->>'storage_object_name' from review_document)),'123','report bytes cannot be replaced or deleted by the owner');

update review_document set doc=public.transition_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001',1,'uploaded',null,null,null);
update review_document set doc=public.transition_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001',2,'extracting','44b00000-0000-4000-8000-000000000001',null,null);
select throws_ok($$select public.transition_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001',3,'ready','44b00000-0000-4000-8000-000000000002',null,null)$$,'P0001','FULL_REVIEW_TRANSITION_INVALID','stale extraction worker cannot confirm');
update review_document set doc=public.transition_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001',3,'needs_confirmation','44b00000-0000-4000-8000-000000000001',jsonb_build_object('documentSha256',repeat('a',64)),'{"stage":"full_review","ready":false,"issues":[{"field":"mileage"}]}'::jsonb);
select ok(not public.total_loss_full_review_ready('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001'),'unresolved conflict prevents payment');
select throws_ok($$update public.total_loss_full_review_reports set extraction='{}'$$,'P0001','FULL_REVIEW_SOURCE_IMMUTABLE','printed extraction cannot be rewritten');
update review_document set doc=public.transition_total_loss_full_review_report('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44a00000-0000-4000-8000-000000000001',4,'ready',null,null,'{"stage":"full_review","ready":true,"issues":[]}'::jsonb);
select ok(public.total_loss_full_review_ready('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001'),'resolved stored report becomes ready');
select is((select to_jsonb(d) from public.total_loss_case_details d where d.case_id='44200000-0000-4000-8000-000000000001'),(select details from review_original),'free input is unchanged');
select is((select artifact from public.analysis_runs where case_id='44200000-0000-4000-8000-000000000001'),(select artifact from review_original),'free result is unchanged');
create temp table review_order as select * from public.reserve_total_loss_checkout('44200000-0000-4000-8000-000000000001','44100000-0000-4000-8000-000000000001','44c00000-0000-4000-8000-000000000001','total-loss-package','1','price_test_total_loss_v1',9900,'USD','terms-1','refund-1',false);
select is((select count(*) from public.total_loss_checkout_review_reports where case_id='44200000-0000-4000-8000-000000000001'),1::bigint,'checkout atomically binds the accepted report');
select throws_ok($$update public.total_loss_full_review_reports set readiness='{}' where id='44a00000-0000-4000-8000-000000000001'$$,'P0001','FULL_REVIEW_REPORT_SEALED','purchased readiness is immutable');
select throws_ok($$delete from public.total_loss_checkout_review_reports where case_id='44200000-0000-4000-8000-000000000001'$$,'P0001','FULL_REVIEW_CHECKOUT_BINDING_IMMUTABLE','checkout source cannot disappear');
select ok(exists(select 1 from pg_policy where polname='Full review report updates are server owned' and not polpermissive),'owner storage updates cannot replace accepted report bytes');
select ok(not has_function_privilege('authenticated','public.get_total_loss_package_review_report(uuid,uuid)','EXECUTE'),'package report RPC is service only');
select ok(not has_function_privilege('service_role','public.full_review_package_source_guard_internal()','EXECUTE'),'service cannot call the source trigger directly');
select has_trigger('public','total_loss_source_snapshots','full_review_package_source_guard','new purchases must freeze the accepted report');
select has_trigger('public','total_loss_final_assessments','full_review_final_assessment_guard','paid assessments retain report calculation binding');
select ok((select extracted_at is not null from public.total_loss_full_review_reports where id='44a00000-0000-4000-8000-000000000001'),'extraction time is retained for immutable source provenance');
select * from finish();
rollback;
