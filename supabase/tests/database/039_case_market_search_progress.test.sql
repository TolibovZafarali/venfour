begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

select has_table('public','total_loss_market_search_progress','normalized case checkpoints exist');
select ok((select relrowsecurity from pg_class where oid='public.total_loss_market_search_progress'::regclass),'checkpoints use RLS');
select ok(not has_table_privilege('anon','public.total_loss_market_search_progress','SELECT')
  and not has_table_privilege('authenticated','public.total_loss_market_search_progress','SELECT')
  and not has_table_privilege('service_role','public.total_loss_market_search_progress','SELECT'), 'checkpoint table is not directly readable');
select ok(has_function_privilege('service_role','public.get_case_market_search_progress(uuid,uuid,uuid,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_case_market_search_progress(uuid,uuid,uuid,text,integer)','EXECUTE'), 'only service workers load checkpoints');
select ok(has_function_privilege('service_role','public.save_case_market_search_progress(uuid,uuid,uuid,text,jsonb,integer)','EXECUTE')
  and not has_function_privilege('anon','public.save_case_market_search_progress(uuid,uuid,uuid,text,jsonb,integer)','EXECUTE'), 'only service workers save checkpoints');
select ok(not has_function_privilege('service_role','public.market_search_checkpoint_is_safe(jsonb)','EXECUTE'), 'checkpoint safety helper remains internal');

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

create temporary table search_progress_fixture as select jsonb_build_object('version','1',
  'inputDigest',encode(sha256(convert_to('{"scope":"current"}','UTF8')),'hex'),
  'input','{"scope":"current"}'::jsonb,'events','[]'::jsonb,'geography','{}'::jsonb,
  'origin',null,'providers','{}'::jsonb,'usageBefore','{"totalAttempts":0}'::jsonb,'historicalTemplate',null) as checkpoint;
create function pg_temp.save_progress(payload jsonb default null,
  lease_token uuid default '39300000-0000-4000-8000-000000000001', days integer default 7,
  input_hash text default null, case_identity uuid default '39100000-0000-4000-8000-000000000001')
returns boolean language sql as $$
  select public.save_case_market_search_progress(case_identity,'39200000-0000-4000-8000-000000000001',lease_token,
    coalesce(input_hash,checkpoint->>'inputDigest'),coalesce(payload,checkpoint),days) from search_progress_fixture;
$$;
create function pg_temp.load_progress(input_hash text default null,
  lease_token uuid default '39300000-0000-4000-8000-000000000001', days integer default 7)
returns jsonb language sql as $$
  select public.get_case_market_search_progress('39100000-0000-4000-8000-000000000001',
    '39200000-0000-4000-8000-000000000001',lease_token,coalesce(input_hash,checkpoint->>'inputDigest'),days)
    from search_progress_fixture;
$$;

select is(pg_temp.load_progress(),null::jsonb,'no checkpoint means new bounded work');
select is(pg_temp.save_progress(),true,'lease owner persists normalized evidence');
select is(pg_temp.load_progress(),(select checkpoint from search_progress_fixture),'same input resumes saved work exactly');
select is(pg_temp.save_progress(case_identity=>'39100000-0000-4000-8000-000000000002'),false,'job cannot save another case');
select is(pg_temp.save_progress(lease_token=>'39300000-0000-4000-8000-000000000009'),false,'other token cannot save');
select is(pg_temp.save_progress(lease_token=>null),false,'null token cannot bypass the processing fence');
select throws_ok($$select pg_temp.load_progress(lease_token=>'39300000-0000-4000-8000-000000000009')$$,
  '42501','Market search processing lease is unavailable','other token cannot load');
select throws_ok($$select pg_temp.load_progress(lease_token=>null)$$,
  '42501','Market search processing lease is unavailable','null token cannot load');
select is(pg_temp.load_progress(input_hash=>repeat('b',64)),null::jsonb,'changed input cannot reuse the old search');
select throws_ok($$select pg_temp.save_progress(input_hash=>repeat('b',64))$$,
  '22023','Invalid bounded market search checkpoint','checkpoint input must match the requested identity');
select throws_ok($$select pg_temp.save_progress(days=>31)$$,
  '22023','Invalid bounded market search checkpoint','retention above the confirmed bound fails');
select throws_ok($$select pg_temp.save_progress(payload=>(select jsonb_set(checkpoint,'{events}','[{"rawResponse":{"listings":[]}}]') from search_progress_fixture))$$,
  '22023','Invalid bounded market search checkpoint','raw provider responses are not checkpoints');
select throws_ok($$select pg_temp.save_progress(payload=>(select jsonb_set(checkpoint,'{events}','[{"api_key":"fixture-sensitive-value"}]') from search_progress_fixture))$$,
  '22023','Invalid bounded market search checkpoint','nested credentials cannot be persisted through the RPC');
select throws_ok($$select pg_temp.save_progress(payload=>(select jsonb_set(checkpoint,'{events}','[{"url":"https://example.test/listing?api_key=fixture-sensitive-value"}]') from search_progress_fixture))$$,
  '22023','Invalid bounded market search checkpoint','credential-bearing URLs cannot be persisted through the RPC');

create temporary table original_progress_expiry as select expires_at from public.total_loss_market_search_progress
  where case_id='39100000-0000-4000-8000-000000000001';
select is(pg_temp.save_progress(days=>30),true,'same lease can checkpoint more completed work');
select is((select expires_at from public.total_loss_market_search_progress where case_id='39100000-0000-4000-8000-000000000001'),
  (select expires_at from original_progress_expiry),'repeated saves cannot renew the original retention period');

update public.total_loss_analysis_jobs set processing_token='39300000-0000-4000-8000-000000000002'
  where id='39200000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.load_progress()$$,'42501','Market search processing lease is unavailable','superseded worker cannot resume');
select is(pg_temp.save_progress(),false,'superseded worker cannot overwrite progress');
select is(pg_temp.load_progress(lease_token=>'39300000-0000-4000-8000-000000000002'),(select checkpoint from search_progress_fixture),
  'new lease owner reuses the existing case evidence');
update public.total_loss_analysis_jobs set processing_expires_at=clock_timestamp()-interval '1 second'
  where id='39200000-0000-4000-8000-000000000001';
select is(pg_temp.save_progress(lease_token=>'39300000-0000-4000-8000-000000000002'),false,'expired lease cannot save');
select throws_ok($$select pg_temp.load_progress(lease_token=>'39300000-0000-4000-8000-000000000002')$$,
  '42501','Market search processing lease is unavailable','expired lease cannot resume');
update public.total_loss_analysis_jobs set processing_token='39300000-0000-4000-8000-000000000001',
  processing_expires_at=clock_timestamp()+interval '1 hour' where id='39200000-0000-4000-8000-000000000001';
update public.total_loss_market_search_progress set created_at=clock_timestamp()-interval '2 days',
  expires_at=clock_timestamp()+interval '5 days' where case_id='39100000-0000-4000-8000-000000000001';
select is(pg_temp.load_progress(days=>1),null::jsonb,'shorter confirmed retention immediately prevents old evidence reuse');
select is((select count(*)::integer from public.total_loss_market_search_progress where case_id='39100000-0000-4000-8000-000000000001'),0,
  'expired normalized evidence is purged within the case');
select is(pg_temp.save_progress(days=>1),true,'fresh bounded work can be checkpointed after expiry');
update public.total_loss_market_search_progress set expires_at=clock_timestamp()-interval '1 second'
  where case_id='39100000-0000-4000-8000-000000000001';
select is(pg_temp.load_progress(),null::jsonb,'naturally expired checkpoints cannot resume');
select is(pg_temp.save_progress(),true,'fresh work can start after natural expiry');
update search_progress_fixture set checkpoint=jsonb_set(checkpoint,'{inputDigest}',to_jsonb(repeat('b',64)));
select is(pg_temp.save_progress(),true,'different input stores a separate current checkpoint');
select is(pg_temp.load_progress(input_hash=>encode(sha256(convert_to('{"scope":"current"}','UTF8')),'hex')),null::jsonb,
  'new input checkpoint removes obsolete prior-input evidence');

select * from finish();
rollback;
