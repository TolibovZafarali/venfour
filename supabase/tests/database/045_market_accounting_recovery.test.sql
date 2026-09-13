begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  ('39000000-0000-4000-8000-000000000001','search-progress-fixture@example.test',statement_timestamp(),false);
insert into public.appraisal_cases(id,user_id,service_type,status) values
  ('39100000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','total_loss','checking'),
  ('39100000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000001','total_loss','checking');
insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,
  vehicle_trim,mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,
  intake_completed_at,analysis_input_revision,analysis_input_id) values
  ('39100000-0000-4000-8000-000000000001','manual',2022,'Honda','Accord','EX-L',32000,'60601',current_date-10,
    'Example Insurance',18000,statement_timestamp(),1,'39400000-0000-4000-8000-000000000001'),
  ('39100000-0000-4000-8000-000000000002','manual',2022,'Honda','Accord','EX-L',32000,'60601',current_date-10,
    'Example Insurance',18000,statement_timestamp(),1,'39400000-0000-4000-8000-000000000002');
insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,processing_token,
  processing_expires_at,source_intake_mode,source_analysis_input_revision,source_analysis_input_id) values
  ('39200000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000001',statement_timestamp(),'processing',
    '39300000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 hour','manual',1,'39400000-0000-4000-8000-000000000001');


select has_table('public','total_loss_market_search_journal','operational journal exists');
select ok((select relrowsecurity from pg_class where oid='public.total_loss_market_search_journal'::regclass),'journal enables RLS');
select ok(not has_table_privilege('anon','public.total_loss_market_search_journal','SELECT')
  and not has_table_privilege('authenticated','public.total_loss_market_search_journal','SELECT')
  and not has_table_privilege('service_role','public.total_loss_market_search_journal','SELECT'),'no direct table access');
select ok(has_function_privilege('service_role','public.access_case_market_search_journal(uuid,uuid,uuid,text,text,uuid,integer,text)','EXECUTE')
  and not has_function_privilege('anon','public.access_case_market_search_journal(uuid,uuid,uuid,text,text,uuid,integer,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.access_case_market_search_journal(uuid,uuid,uuid,text,text,uuid,integer,text)','EXECUTE'),'only workers can access the journal');
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.access_case_market_search_journal(uuid,uuid,uuid,text,text,uuid,integer,text)'::regprocedure),'journal uses restricted definer search path');
select ok((select 'lock_timeout=500ms'=any(proconfig) from pg_proc where oid='public.reserve_market_request_attempt(jsonb)'::regprocedure),'reservation lock waits are bounded');
select ok(not exists(select 1 from information_schema.columns where table_name='total_loss_market_search_journal'
  and column_name in ('payload','checkpoint','vin','price','listing','headers','vehicle_facts')),'journal cannot contain provider evidence');
create function pg_temp.journal(action text, idx integer default null, digest text default null,
  executor uuid default '39500000-0000-4000-8000-000000000001',
  lease uuid default '39300000-0000-4000-8000-000000000001') returns jsonb language sql as $$
  select public.access_case_market_search_journal('39100000-0000-4000-8000-000000000001',
    '39200000-0000-4000-8000-000000000001',lease,repeat('a',64),action,executor,idx,digest);
$$;
select is(pg_temp.journal('read')->'events','[]'::jsonb,'new case has no recorded operations');
select is(pg_temp.journal('begin',0,repeat('b',64))->'events'->0->>'status','started','operation is journaled before provider transport');
select is(jsonb_array_length(pg_temp.journal('begin',0,repeat('b',64))->'events'),1,'identical begin retry is idempotent');
select throws_ok($$select pg_temp.journal('begin',0,repeat('b',64),'39500000-0000-4000-8000-000000000002')$$,
  '55000','Market search operation already has an executor','duplicate worker cannot execute same operation');
select throws_ok($$select pg_temp.journal('complete',0,repeat('c',64))$$,
  '22023','Market search operation changed','operation digest cannot change');
select is(pg_temp.journal('complete',0,repeat('b',64))->'events'->0->>'status','completed','batch completion is durable');
select is(pg_temp.journal('complete',0,repeat('b',64))->'events'->0->>'attemptsAfter','0','completion retry keeps exact ledger count');
select throws_ok($$select pg_temp.journal('begin',0,repeat('b',64))$$,
  '55000','Market search evidence recovery is required','completed discovery cannot start over');
select throws_ok($$select pg_temp.journal('resume',0,repeat('b',64))$$,
  '55000','Market search evidence recovery is required','resume requires retained incomplete evidence');
select throws_ok($$select pg_temp.journal('read',lease=>'39300000-0000-4000-8000-000000000009')$$,
  '42501','Market search processing lease is unavailable','stale worker cannot read journal');
select throws_ok($$select pg_temp.journal('begin',200,repeat('b',64))$$,
  '22023','Invalid market search journal operation','journal stays bounded');
select throws_ok($$select pg_temp.journal('read',lease=>null)$$,
  '42501','Market search processing lease is unavailable','null token is rejected');
select lives_ok($$select pg_temp.journal('begin',1,repeat('c',64))$$,'next operation can begin');
select is(pg_temp.journal('halt',1,repeat('c',64))->'events'->1->>'requiresReconciliation','true','unpersisted account constraints require reconciliation');
update public.total_loss_analysis_jobs set processing_expires_at=clock_timestamp()-interval '1 second'
  where id='39200000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.journal('read')$$,'42501','Market search processing lease is unavailable','expired lease cannot inspect or change progress');
select * from finish();
rollback;
