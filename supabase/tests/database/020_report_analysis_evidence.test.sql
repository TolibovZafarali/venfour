begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok((select relrowsecurity from pg_class where oid='public.total_loss_analysis_report_evidence'::regclass), 'analysis evidence has RLS');
select ok(not exists(select 1 from pg_policies where tablename='total_loss_analysis_report_evidence'), 'no browser evidence policy exists');
select ok(not has_table_privilege('authenticated','public.total_loss_analysis_report_evidence','SELECT'), 'customers cannot read raw evidence');
select ok(not has_table_privilege('service_role','public.total_loss_analysis_report_evidence','INSERT,UPDATE,DELETE'), 'workers cannot bypass evidence RPCs');
select ok(not has_function_privilege('authenticated','public.complete_total_loss_report_analysis(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'), 'customers cannot complete report analysis');
select ok(has_function_privilege('service_role','public.complete_total_loss_report_analysis(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'), 'trusted workers can complete report analysis');

create temporary table evidence_test_ids as select
  gen_random_uuid() as owner,gen_random_uuid() as case_id,gen_random_uuid() as job,
  gen_random_uuid() as run,gen_random_uuid() as input,gen_random_uuid() as upload,gen_random_uuid() as token;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select owner,'report-evidence@example.test',now(),false from evidence_test_ids;
insert into appraisal_cases(id,user_id,service_type,status)
select case_id,owner,'total_loss','checking' from evidence_test_ids;
insert into total_loss_case_details(case_id,intake_mode,postal_code,intake_completed_at,
  analysis_input_revision,analysis_input_id,report_last_upload_id,report_storage_owner_id,
  report_original_filename,report_uploaded_at)
select case_id,'report','60601',now(),1,input,upload,owner,'test-report.pdf',now() from evidence_test_ids;
insert into storage.objects(bucket_id,name,metadata,user_metadata)
select 'case-files',owner::text||'/'||case_id::text||'/valuation-report.pdf',
  '{"mimetype":"application/pdf","size":100}'::jsonb,jsonb_build_object('uploadId',upload::text)
from evidence_test_ids;
insert into total_loss_analysis_jobs(id,case_id,source_report_upload_id,source_details_updated_at,
  status,attempt_count,processing_token,processing_expires_at,run_id,
  source_intake_mode,source_analysis_input_revision,source_analysis_input_id)
select job,case_id,upload,now(),'processing',1,token,now()+interval '5 minutes',run,'report',1,input
from evidence_test_ids;

create function pg_temp.complete_report(evidence jsonb, stale boolean default false)
returns boolean language sql as $$
select public.complete_total_loss_report_analysis(job,case when stale then gen_random_uuid() else token end,run,
  jsonb_build_object('runId',run::text,'requestDigest',repeat('1',64),
    'analysisRunSchemaVersion','4','analysisVersion','4','discrepancyAnalysisVersion','1',
    'comparableScoringVersion','1','result',jsonb_build_object('discrepancyResult',
      jsonb_build_object('classification','POTENTIAL_UNDERVALUE'))),evidence)
from evidence_test_ids;
$$;
create function pg_temp.valid_evidence() returns jsonb language sql as $$
select jsonb_build_object('schemaVersion','1','documentSha256',repeat('a',64),'normalizedReport','{}'::jsonb);
$$;

select is(pg_temp.complete_report(pg_temp.valid_evidence(),true),false,'stale worker cannot persist evidence');
select is((select count(*) from total_loss_analysis_report_evidence where case_id=(select case_id from evidence_test_ids)),0::bigint,'stale attempt creates no evidence');
select throws_ok($$select pg_temp.complete_report('{}'::jsonb)$$,'23514',null,'invalid evidence rolls back the entire completion');
select is((select status from total_loss_analysis_jobs where id=(select job from evidence_test_ids)),'processing','failed evidence leaves analysis processing');
select is((select count(*) from analysis_runs where id=(select run from evidence_test_ids)),0::bigint,'failed evidence creates no orphan analysis');

select ok(pg_temp.complete_report(pg_temp.valid_evidence()),'valid analysis and evidence commit together');
select is((select status from total_loss_analysis_jobs where id=(select job from evidence_test_ids)),'completed','analysis completed');
select is((select evidence_origin from total_loss_analysis_report_evidence where analysis_run_id=(select run from evidence_test_ids)),'analysis','evidence provenance is explicit');
select ok((select vehicle_year is null and insurer_name is null and report_facts_confirmed_at is null from total_loss_case_details where case_id=(select case_id from evidence_test_ids)),'report evidence does not fabricate customer confirmation');
select ok(pg_temp.complete_report(pg_temp.valid_evidence()),'identical completion replay is idempotent');
select is(pg_temp.complete_report(pg_temp.valid_evidence()||'{"model":"different"}'::jsonb),false,'changed evidence cannot overwrite a completed run');
select throws_ok($$update total_loss_analysis_report_evidence set ingestion=ingestion||'{"model":"changed"}' where analysis_run_id=(select run from evidence_test_ids)$$,'55000',null,'evidence is immutable');
select throws_ok($$delete from total_loss_analysis_report_evidence where analysis_run_id=(select run from evidence_test_ids)$$,'55000',null,'evidence cannot be deleted');
select is((select public.get_owned_total_loss_report_evidence(run,owner) from evidence_test_ids),pg_temp.valid_evidence(),'owned read returns exact evidence');
select is((select public.get_owned_total_loss_report_evidence(run,gen_random_uuid()) from evidence_test_ids),null::jsonb,'wrong owner cannot read evidence');

create temporary table recovery_test_ids as select gen_random_uuid() as preliminary,
  gen_random_uuid() as entitlement,gen_random_uuid() as order_id,gen_random_uuid() as original,
  gen_random_uuid() as replacement,gen_random_uuid() as work;
insert into total_loss_preliminary_snapshots(
  id,case_id,analysis_job_id,analysis_run_id,owner_user_id_at_snapshot,source_intake_mode,
  source_report_upload_id,source_analysis_input_revision,source_analysis_input_id,
  preliminary_classification,insurer_valuation_minor_units,supported_range_low_minor_units,
  supported_range_median_minor_units,supported_range_high_minor_units,currency,
  analysis_run_schema_version,analysis_version,discrepancy_analysis_version,comparable_scoring_version,
  presentation_schema_version,snapshot_schema_version,source_references,snapshot,snapshot_digest)
select preliminary,case_id,job,run,owner,'report',upload,1,input,'POTENTIAL_UNDERVALUE',1800000,
  2000000,2100000,2200000,'USD','4','4','1','1','1','1','{}','{}',repeat('2',64)
from recovery_test_ids cross join evidence_test_ids;
insert into commerce_orders(id,case_id,purchaser_user_id,preliminary_snapshot_id,product_identifier,
  product_version,amount_minor_units,currency,payment_provider,external_price_identifier,
  provider_livemode,purchaser_email,status,terms_version,refund_policy_version,paid_at)
select order_id,case_id,owner,preliminary,'total-loss-package','1',9900,'USD','stripe',
  'price_test_report',false,'report-evidence@example.test','paid','terms-1','refund-1',now()
from recovery_test_ids cross join evidence_test_ids;
insert into case_entitlements(id,case_id,order_id,preliminary_snapshot_id,product_identifier,product_version,status)
select entitlement,case_id,order_id,preliminary,'total-loss-package','1','active'
from recovery_test_ids cross join evidence_test_ids;
insert into total_loss_package_jobs(id,case_id,entitlement_id,preliminary_snapshot_id,status,
  attempt_count,processing_token,failure_code,retryable,started_at,finished_at)
select original,case_id,entitlement,preliminary,'failed',1,gen_random_uuid(),'SOURCE_LINEAGE_CONFLICT',false,now(),now()
from recovery_test_ids cross join evidence_test_ids;
insert into total_loss_claim_workflows(case_id,preliminary_snapshot_id,phase,current_task,current_package_job_id)
select case_id,preliminary,'review','package_failed',original from recovery_test_ids cross join evidence_test_ids;
create function pg_temp.insert_replacement(prior uuid, replacement_id uuid) returns void language sql as $$
insert into total_loss_package_jobs(id,case_id,entitlement_id,preliminary_snapshot_id,status,supersedes_package_job_id)
select replacement_id,case_id,entitlement,preliminary,'queued',prior from recovery_test_ids cross join evidence_test_ids;
$$;

select throws_ok($$select pg_temp.insert_replacement(null,gen_random_uuid())$$,'23505',null,'a second original cannot duplicate a paid package');
select throws_ok($$select pg_temp.insert_replacement(gen_random_uuid(),gen_random_uuid())$$,'55000',null,'unrelated failed packages cannot authorize recovery');
select lives_ok($$select pg_temp.insert_replacement(original,replacement) from recovery_test_ids$$,'verified report evidence permits a successor');
select throws_ok($$select pg_temp.insert_replacement(original,gen_random_uuid()) from recovery_test_ids$$,'23505',null,'only one successor can replace a failed attempt');
select throws_ok($$update total_loss_package_jobs set status='queued' where id=(select original from recovery_test_ids)$$,'55000',null,'the original failure remains immutable');
select throws_ok($$update total_loss_package_jobs set supersedes_package_job_id=null where id=(select replacement from recovery_test_ids)$$,'55000',null,'successor identity is immutable');
update total_loss_claim_workflows set current_package_job_id=(select replacement from recovery_test_ids),current_task='package_queued',revision=revision+1
where case_id=(select case_id from evidence_test_ids);
select is((select package_job_id from enqueue_total_loss_package_job((select entitlement from recovery_test_ids))),
  (select replacement from recovery_test_ids),'duplicate enqueue resumes the current successor');
select is((select count(*) from workflow_work_items where package_job_id=(select replacement from recovery_test_ids)),1::bigint,'successor has exactly one durable work item');
select is((select count(*) from commerce_orders where case_id=(select case_id from evidence_test_ids)),1::bigint,'recovery does not create another payment');
select is((select count(*) from case_entitlements where case_id=(select case_id from evidence_test_ids)),1::bigint,'recovery reuses the existing entitlement');

select * from finish();
rollback;
