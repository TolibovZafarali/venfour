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
create temp table gate_fixture(name text primary key,f jsonb);
insert into gate_fixture values
 ('pending',pg_temp.checkout_initialization_fixture('50100000-0000-4000-8000-000000000001','50200000-0000-4000-8000-000000000001','LISTING_CONTEXT',false)),
 ('retry',pg_temp.checkout_initialization_fixture('50100000-0000-4000-8000-000000000002','50200000-0000-4000-8000-000000000002','LISTING_CONTEXT',false)),
 ('delivery',pg_temp.checkout_initialization_fixture('50100000-0000-4000-8000-000000000003','50200000-0000-4000-8000-000000000003','LISTING_CONTEXT',false)),
 ('ready',pg_temp.checkout_initialization_fixture('50100000-0000-4000-8000-000000000004','50200000-0000-4000-8000-000000000004'));

select ok((select relrowsecurity from pg_class where oid='public.total_loss_full_review_assessments'::regclass),'strict results have RLS');
select ok(not has_table_privilege(role,'public.total_loss_full_review_assessments','INSERT,UPDATE,DELETE'),'strict results forbid direct writes for '||role)
 from unnest(array['anon','authenticated','service_role']) role;
select ok(not has_function_privilege(role,p.oid,'EXECUTE'),'preparation RPC denies '||role||': '||p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated']) role
 where n.nspname='public' and p.proname in ('enqueue_total_loss_full_review','claim_total_loss_full_review_work','complete_total_loss_full_review_work','fail_total_loss_full_review_work');
select ok(not has_function_privilege(role,p.oid,'EXECUTE'),'renamed bypass is private: '||p.proname||' for '||role)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) role
 where n.nspname='public' and p.proname in ('initialize_post_continue_before_strict_internal','full_review_facts_ready_internal','begin_full_review_before_dedup_internal');
select throws_ok($$update public.total_loss_full_review_assessments set review_version='1' where case_id='50100000-0000-4000-8000-000000000004'$$,'P0001','STRICT_REVIEW_IMMUTABLE','completed strict result is immutable');
select throws_ok($$delete from public.total_loss_full_review_assessments where case_id='50100000-0000-4000-8000-000000000004'$$,'P0001','STRICT_REVIEW_IMMUTABLE','completed strict result cannot be deleted');
select is(pg_temp.initialize_checkout(f||jsonb_build_object('strictReview',gen_random_uuid())),'not_ready','tampered strict identity cannot initialize') from gate_fixture where name='ready';
select is(pg_temp.initialize_checkout(f||jsonb_build_object('strictDigest',repeat('c',64))),'not_ready','tampered strict digest cannot initialize') from gate_fixture where name='ready';
select ok(not public.full_review_calculation_payment_eligible_internal(jsonb_set(a.calculation,'{artifact,result,discrepancyResult,evidenceStrength}','"LOW"')),'low strength never opens payment') from public.total_loss_full_review_assessments a where case_id='50100000-0000-4000-8000-000000000004';
select ok(not public.full_review_calculation_payment_eligible_internal(jsonb_set(a.calculation,'{artifact,result,preliminaryQualification,unresolvedMaterialChecks}','[{}]')),'materially unresolved result never opens payment') from public.total_loss_full_review_assessments a where case_id='50100000-0000-4000-8000-000000000004';

select throws_ok($$select public.begin_total_loss_full_review_report('50100000-0000-4000-8000-000000000001','50200000-0000-4000-8000-000000000001',gen_random_uuid(),'racing.pdf',repeat('b',64),124)$$,'P0001','FULL_REVIEW_BUSY','different PDF cannot overtake an accepted upload before Storage acknowledgement');
create temp table pending_work as select public.enqueue_total_loss_full_review((f->>'case')::uuid,(f->>'owner')::uuid,(f->>'report')::uuid,1) id,gen_random_uuid() token from gate_fixture where name='pending';
select is((select status from public.total_loss_full_review_reports where case_id='50100000-0000-4000-8000-000000000001'),'uploaded','durable acknowledgement precedes extraction');
select is(public.enqueue_total_loss_full_review((f->>'case')::uuid,(f->>'owner')::uuid,(f->>'report')::uuid,1),(select id from pending_work),'lost acknowledgement retry reuses one work identity') from gate_fixture where name='pending';
select is(public.begin_total_loss_full_review_report((f->>'case')::uuid,(f->>'owner')::uuid,gen_random_uuid(),'retry.pdf',repeat('a',64),123)->>'id',f->>'report','same accepted PDF reuses report revision') from gate_fixture where name='pending';
select is(public.claim_total_loss_full_review_work(id,token)->>'state','claimed','durable worker claims once') from pending_work;
select is(public.claim_total_loss_full_review_work(id,gen_random_uuid())->>'state','already_processing','concurrent delivery cannot duplicate extraction') from pending_work;
select is(pg_temp.initialize_checkout(f),'not_ready','processing upload cannot initialize checkout') from gate_fixture where name='pending';
select ok(not public.complete_total_loss_full_review_work(id,gen_random_uuid(),3,null,null),'wrong worker token cannot complete') from pending_work;
select is((public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid)->'report'->>'status'),'extracting','reopen observes persisted extraction') from gate_fixture where name='pending';
select public.transition_total_loss_full_review_report((f->>'case')::uuid,(f->>'owner')::uuid,(f->>'report')::uuid,3,'ready',(select token from pending_work),jsonb_build_object('documentSha256',repeat('a',64)),'{"stage":"full_review","ready":true,"issues":[]}') from gate_fixture where name='pending';
select ok(not public.total_loss_full_review_ready((f->>'case')::uuid,(f->>'owner')::uuid),'ready facts await strict evaluation') from gate_fixture where name='pending';
update public.workflow_work_items set processing_expires_at=clock_timestamp()-interval '1 second' where id=(select id from pending_work);
select ok(not public.complete_total_loss_full_review_work(id,token,4,null,null),'expired worker cannot persist strict result') from pending_work;
select public.reserve_due_workflow_work_items(gen_random_uuid(),100);
update pending_work set token=gen_random_uuid();
select is(public.claim_total_loss_full_review_work(id,token)->>'state','claimed','recovery claims interrupted preparation') from pending_work;
select is((select count(*) from public.total_loss_full_review_reports where case_id='50100000-0000-4000-8000-000000000001' and extraction is not null),1::bigint,'persisted extraction survives worker interruption');
select ok(public.complete_total_loss_full_review_work(w.id,w.token,4,
 jsonb_set(jsonb_set(a.calculation,'{artifact,result,discrepancyResult,classification}','"INSUFFICIENT_EVIDENCE"'),'{presentation,assessment,classification}','"INSUFFICIENT_EVIDENCE"'),repeat('f',64)),'insufficient strict outcome is saved, not promoted')
 from pending_work w cross join public.total_loss_full_review_assessments a where a.case_id='50100000-0000-4000-8000-000000000004';
select is(public.claim_total_loss_full_review_work(id,gen_random_uuid())->>'state','completed','completed delivery is a read-only reuse') from pending_work;
select ok(not public.total_loss_full_review_ready((f->>'case')::uuid,(f->>'owner')::uuid),'insufficient saved result blocks payment') from gate_fixture where name='pending';
select is(pg_temp.initialize_checkout(f),'not_ready','insufficient report cannot initialize directly') from gate_fixture where name='pending';
select is((select count(*) from storage.objects where name like '%50100000-0000-4000-8000-000000000001%'),1::bigint,'accepted PDF remains intact');

create temp table retry_work as select public.enqueue_total_loss_full_review((f->>'case')::uuid,(f->>'owner')::uuid,(f->>'report')::uuid,1) id from gate_fixture where name='retry';
do $$ declare w uuid; t uuid; i integer; begin
 select id into w from retry_work;
 for i in 1..3 loop
   update public.workflow_work_items set next_attempt_at=clock_timestamp()-interval '1 second' where id=w;
   t:=gen_random_uuid();perform public.claim_total_loss_full_review_work(w,t);
   if not public.fail_total_loss_full_review_work(w,t) then raise exception 'Retry failure fence invalid'; end if;
 end loop;
end $$;
select ok((select status='terminal_failed' and attempt_count=3 from public.workflow_work_items where id=(select id from retry_work)),'extraction retries are bounded at three');
select is(public.enqueue_total_loss_full_review((f->>'case')::uuid,(f->>'owner')::uuid,(f->>'report')::uuid,(public.get_total_loss_full_review_context((f->>'case')::uuid,(f->>'owner')::uuid)->'report'->>'revision')::bigint),(select id from retry_work),'same PDF cannot reset exhausted retries') from gate_fixture where name='retry';
create temp table delivery_work as select public.enqueue_total_loss_full_review((f->>'case')::uuid,(f->>'owner')::uuid,(f->>'report')::uuid,1) id from gate_fixture where name='delivery';
update public.workflow_work_items set delivery_generation=5 where id=(select id from delivery_work);
select ok(public.hold_exhausted_workflow_work_internal(id,'total_loss_full_review_prepare',true),'delivery exhaustion persists terminal state without a paid package') from delivery_work;
select is((select count(*) from public.total_loss_package_jobs where case_id in (select (f->>'case')::uuid from gate_fixture)),0::bigint,'unpaid preparation creates no package');
select is((select count(*) from public.case_entitlements where case_id in (select (f->>'case')::uuid from gate_fixture)),0::bigint,'unpaid preparation creates no entitlement');
select * from finish();
rollback;
