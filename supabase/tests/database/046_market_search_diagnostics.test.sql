begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  ('49000000-0000-4000-8000-000000000001','search-summary-fixture@example.test',statement_timestamp(),false);
insert into public.appraisal_cases(id,user_id,service_type,status) values
  ('49100000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001','total_loss','checking'),
  ('49100000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000001','total_loss','checking');
insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,
  vehicle_trim,mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,
  intake_completed_at,analysis_input_revision,analysis_input_id) values
  ('49100000-0000-4000-8000-000000000001','manual',2022,'Honda','Accord','EX-L',32000,'60601',current_date-10,
    'Example Insurance',18000,statement_timestamp(),1,'49400000-0000-4000-8000-000000000001'),
  ('49100000-0000-4000-8000-000000000002','manual',2022,'Honda','Accord','EX-L',32000,'60601',current_date-10,
    'Example Insurance',18000,statement_timestamp(),1,'49400000-0000-4000-8000-000000000002');
insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,processing_token,
  processing_expires_at,source_intake_mode,source_analysis_input_revision,source_analysis_input_id) values
  ('49200000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001',statement_timestamp(),'processing',
    '49300000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 hour','manual',1,'49400000-0000-4000-8000-000000000001');

create function pg_temp.journal(action text, idx integer default null, digest text default null,
  executor uuid default '49500000-0000-4000-8000-000000000001',
  lease uuid default '49300000-0000-4000-8000-000000000001') returns jsonb language sql as $$
  select public.access_case_market_search_journal('49100000-0000-4000-8000-000000000001',
    '49200000-0000-4000-8000-000000000001',lease,repeat('a',64),action,executor,idx,digest);
$$;

create function pg_temp.summary() returns jsonb language sql as $$select '{"version": "1", "kind": "discovery", "stream": "historical", "purpose": "baseline", "centerId": "customer", "pageStart": 0, "requestedRows": 50, "returnedRows": 6, "parseableObservations": 6, "recordedObservations": 6, "distinctIdentities": 5, "newIdentities": 5, "duplicateObservations": 1, "unidentifiedObservations": 0, "screenedCandidates": 4, "baselineCandidates": 0, "requestAttemptsConsumed": 0, "rejectedByCategory": {"IDENTITY": 0, "CONFIGURATION": 0, "MILEAGE": 0, "DISTANCE": 0, "TEMPORAL": 0, "CONFLICT": 0, "QUALITY": 0, "OTHER": 0}, "tierCounts": {"STRONG": 0, "GOOD": 0, "WEAK": 4, "INELIGIBLE": 2}, "historyVerificationNecessary": true, "scoringCompleted": true, "stopReason": "EXHAUSTED"}'::jsonb$$;
create function pg_temp.save_summary(value jsonb default pg_temp.summary(),
  executor uuid default '49500000-0000-4000-8000-000000000001',
  lease uuid default '49300000-0000-4000-8000-000000000001', digest text default repeat('b',64))
returns boolean language sql as $$
  select public.record_case_market_search_summary('49100000-0000-4000-8000-000000000001',
    '49200000-0000-4000-8000-000000000001',lease,repeat('a',64),executor,0,digest,value);
$$;
select has_column('public','total_loss_market_search_journal','summary','aggregate column exists');
select ok((select relrowsecurity from pg_class where oid='public.total_loss_market_search_journal'::regclass),'RLS preserved');
select ok(not has_table_privilege(role,'public.total_loss_market_search_journal','SELECT,INSERT,UPDATE,DELETE'),'no direct journal access for '||role)
  from unnest(array['anon','authenticated','service_role']) role;
select ok(has_function_privilege('service_role','public.record_case_market_search_summary(uuid,uuid,uuid,text,uuid,integer,text,jsonb)','EXECUTE'),'worker RPC enabled');
select ok(not has_function_privilege(role,'public.record_case_market_search_summary(uuid,uuid,uuid,text,uuid,integer,text,jsonb)','EXECUTE'),'RPC denied for '||role)
  from unnest(array['anon','authenticated']) role;
select ok((select prosecdef and 'search_path=""'=any(proconfig) and 'lock_timeout=500ms'=any(proconfig)
  from pg_proc where oid='public.record_case_market_search_summary(uuid,uuid,uuid,text,uuid,integer,text,jsonb)'::regprocedure),'definer search path and lock timeout hardened');
select ok(public.market_search_summary_is_valid(pg_temp.summary()),'closed summary accepted');
select ok(not public.market_search_summary_is_valid(value),'malformed outer structure rejected')
  from unnest(array['[]'::jsonb,'null'::jsonb,'1'::jsonb,'"string"'::jsonb,'{}'::jsonb]) value;
select ok(not public.market_search_summary_is_valid(pg_temp.summary()||jsonb_build_object(key,'private-content')),'unknown content key rejected: '||key)
  from unnest(array['vin','price','dealer','payload','headers','rawResponse','listing']) key;
select ok(not public.market_search_summary_is_valid(pg_temp.summary()-key),'required field rejected when missing: '||key)
  from jsonb_object_keys(pg_temp.summary()) key;
select ok(not public.market_search_summary_is_valid(jsonb_set(pg_temp.summary(),array[key],'null')),'null field rejected: '||key)
  from jsonb_object_keys(pg_temp.summary()) key;
select ok(not public.market_search_summary_is_valid(pg_temp.summary()||value),'invalid bounds and categories rejected')
  from unnest(array['{"returnedRows":51}'::jsonb,'{"pageStart":10000}'::jsonb,'{"newIdentities":6}'::jsonb,
    '{"screenedCandidates":7}'::jsonb,'{"requestedRows":0}'::jsonb,'{"requestAttemptsConsumed":1.5}'::jsonb,
    '{"centerId":"private-zip"}'::jsonb,'{"tierCounts":[]}'::jsonb,'{"rejectedByCategory":null}'::jsonb,
    '{"stream":"unknown"}'::jsonb,'{"stopReason":"private-provider-message"}'::jsonb]) value;
select throws_ok($$select pg_temp.save_summary()$$,'42501','Market search summary operation is unavailable','no unexecuted batch summary');
select lives_ok($$select pg_temp.journal('begin',0,repeat('b',64))$$,'batch begins');
select throws_ok($$select pg_temp.save_summary()$$,'42501','Market search summary operation is unavailable','incomplete batch cannot receive summary');
select lives_ok($$select pg_temp.journal('complete',0,repeat('b',64))$$,'batch completion acknowledged');
select ok(pg_temp.save_summary(),'aggregate save succeeds');
select ok(pg_temp.save_summary(),'identical aggregate write is idempotent');
select is((select summary from public.total_loss_market_search_journal where case_id='49100000-0000-4000-8000-000000000001'),pg_temp.summary(),'only reviewed aggregate persisted');
select throws_ok($$select pg_temp.save_summary(pg_temp.summary()||'{"price":25704}')$$,'22023','Invalid market search summary','raw evidence rejected by RPC');
select throws_ok($$select pg_temp.save_summary(pg_temp.summary()||'{"requestAttemptsConsumed":1}')$$,'42501','Market search summary operation is unavailable','summary accounting must equal operation ledger snapshot');
select throws_ok($$select pg_temp.save_summary(executor=>'49500000-0000-4000-8000-000000000009')$$,'42501','Market search summary operation is unavailable','other executor fenced');
select throws_ok($$select pg_temp.save_summary(lease=>'49300000-0000-4000-8000-000000000009')$$,'42501','Market search processing lease is unavailable','stale token fenced');
select throws_ok($$select pg_temp.save_summary(digest=>repeat('c',64))$$,'42501','Market search summary operation is unavailable','operation identity fenced');
select ok(pg_temp.save_summary(pg_temp.summary()||'{"stopReason":"BUDGET_OR_QUOTA_LIMITED"}'),'final stage reason can be recorded');
select throws_ok($$select pg_temp.journal('begin',0,repeat('b',64))$$,'55000','Market search evidence recovery is required','summary never authorizes repeating completed provider work');
select is((select count(*) from public.total_loss_market_search_progress where case_id='49100000-0000-4000-8000-000000000001'),0::bigint,'no retained provider checkpoint');
update public.total_loss_analysis_jobs set status='failed',failure_code='ANALYSIS_CREATION_FAILED',retryable=true,processing_expires_at=null,finished_at=clock_timestamp()
  where id='49200000-0000-4000-8000-000000000001';
select is((select summary->>'stopReason' from public.total_loss_market_search_journal where case_id='49100000-0000-4000-8000-000000000001'),'BUDGET_OR_QUOTA_LIMITED','journal survives terminal failure');
select throws_ok($$select pg_temp.save_summary()$$,'42501','Market search processing lease is unavailable','terminal job cannot overwrite journal');
select * from finish();
rollback;
