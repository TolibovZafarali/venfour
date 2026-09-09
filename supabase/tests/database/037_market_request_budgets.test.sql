begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(48);

select has_table('public','market_request_accounts','account accounting exists');
select has_table('public','market_request_cases','case accounting survives new runs');
select has_table('public','market_request_attempts','physical reservations are durable');
select ok((select bool_and(relrowsecurity) from pg_class
  where oid in ('public.market_request_accounts'::regclass,'public.market_request_cases'::regclass,'public.market_request_attempts'::regclass)),
  'all accounting tables use RLS');
select ok(not has_table_privilege('anon','public.market_request_attempts','SELECT')
  and not has_table_privilege('authenticated','public.market_request_attempts','SELECT')
  and not has_table_privilege('service_role','public.market_request_attempts','SELECT'),
  'accounting rows cannot be read directly');
select ok(not has_function_privilege('authenticated','public.reserve_market_request_attempt(jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.get_market_request_usage(jsonb)','EXECUTE'),
  'browser roles cannot spend or inspect account quotas');
select ok(has_function_privilege('service_role','public.reserve_market_request_attempt(jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.market_request_usage_internal(jsonb)','EXECUTE'),
  'service role uses only checked RPCs');

create temporary table market_budget_fixture(request jsonb);
insert into market_budget_fixture select jsonb_build_object(
  'accountKey',repeat('e',64),'caseId','20000000-0000-4000-8000-000000000002',
  'policy',jsonb_build_object('totalAttempts',60,'supportingAttempts',5,'supportingDiscoveryAttempts',2,
    'operationLimits','{"active_discovery":8,"historical_discovery":8,"vin_history":40,"enrichment":9,"vehicle_terms":2}'::jsonb,
    'perVinHistoryAttempts',3,'monthlyReserveBasisPoints',2000,'optimizationTarget','[20,30]'::jsonb),
  'accountLimits',jsonb_build_object('monthlyAllowance',10,'metered',false,'requestsPerWindow',100,
    'rateWindowSeconds',60,'periodStart',date_trunc('month',clock_timestamp()),
    'periodEnd',date_trunc('month',clock_timestamp())+interval '1 month','priorMonthlyAttempts',3,'reserveBasisPoints',2000),
  'reservationId','10000000-0000-4000-8000-000000000001','endpoint','vin_history',
  'phase','baseline','vinKey',repeat('b',64),'estimatedCostMicros',null);

select is(public.reserve_market_request_attempt((select jsonb_set(request,'{accountLimits,monthlyAllowance}','null') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_MONTHLY_ALLOWANCE_UNCONFIGURED','missing monthly allowance fails closed');
select is(public.reserve_market_request_attempt((select jsonb_set(jsonb_set(request,'{accountLimits,monthlyAllowance}','null'),'{accountLimits,metered}','true') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_MONTHLY_ALLOWANCE_UNCONFIGURED','metered billing does not bypass the monthly request ceiling');
select is(public.reserve_market_request_attempt((select jsonb_set(request,'{accountLimits,periodStart}','null') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_QUOTA_PERIOD_UNCONFIGURED','missing billing period start fails closed');
select is(public.reserve_market_request_attempt((select jsonb_set(request,'{accountLimits,periodEnd}','null') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_QUOTA_PERIOD_UNCONFIGURED','missing billing period end fails closed');
select is(public.reserve_market_request_attempt((select jsonb_set(request,'{accountLimits,priorMonthlyAttempts}','null') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_PRIOR_USAGE_UNCONFIGURED','missing prior usage fails closed');
select is((select count(*)::integer from public.market_request_attempts where account_key=repeat('e',64)),
  0,'missing account facts authorize no physical requests');

select is((public.reserve_market_request_attempt((select request from market_budget_fixture))->>'allowed')::boolean,true,'first request is reserved');
select is(public.reserve_market_request_attempt((select request from market_budget_fixture))->>'reasonCode',
  'MARKET_ATTEMPT_ALREADY_RESERVED','replaying a reservation cannot authorize uncounted work');
select is((public.get_market_request_usage((select request-array['reservationId','endpoint','phase','vinKey','estimatedCostMicros'] from market_budget_fixture))->>'totalAttempts')::integer,
  1,'duplicate reservation does not increment usage');

select is((public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'allowed')::boolean,true,
  'failed request retry consumes a second attempt');
select is((public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'allowed')::boolean,true,
  'third physical VIN attempt is allowed');
select is(public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'reasonCode',
  'MARKET_VIN_HISTORY_BUDGET_EXHAUSTED','one VIN cannot consume the history allowance');

update market_budget_fixture set request=request||jsonb_build_object('caseId','30000000-0000-4000-8000-000000000003',
  'reservationId',gen_random_uuid(),'endpoint','active_inventory','phase','supporting','vinKey',null);
select is((public.reserve_market_request_attempt((select request from market_budget_fixture))->>'allowed')::boolean,true,'new case shares account headroom');
select is((public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'allowed')::boolean,true,'last routine request preserves monthly reserve');
select is(public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid(),'phase','baseline') from market_budget_fixture))->>'reasonCode',
  'MARKET_MONTHLY_RESERVE_REACHED','prior provider usage plus current cases cannot spend the reserved twenty percent');
select is((public.get_market_request_usage((select request-array['reservationId','endpoint','phase','vinKey','estimatedCostMicros'] from market_budget_fixture))->>'monthlyAttempts')::integer,
  8,'monthly usage includes the configured pre-ledger consumption');
select is(public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'reasonCode',
  'MARKET_SUPPORTING_DISCOVERY_BUDGET_EXHAUSTED','optional discovery is independently bounded');
select is(public.reserve_market_request_attempt((select jsonb_set(request||jsonb_build_object('reservationId',gen_random_uuid()),'{policy,totalAttempts}','100') from market_budget_fixture))->>'reasonCode',
  'MARKET_CASE_POLICY_CHANGED','restarting with a larger limit cannot reset the case policy');

select is(public.reserve_market_request_attempt((select jsonb_set(request||jsonb_build_object('reservationId',gen_random_uuid()),'{accountKey}',to_jsonb(repeat('c',64))) from market_budget_fixture))->>'reasonCode',
  'MARKET_CASE_ACCOUNT_CHANGED','changing account identity cannot reset a case allowance');
update market_budget_fixture set request=jsonb_set(jsonb_set(request||jsonb_build_object('caseId','40000000-0000-4000-8000-000000000004'),'{accountKey}',to_jsonb(repeat('d',64))),'{accountLimits,monthlyAllowance}','100');
select is((public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'allowed')::boolean,true,
  'separate account has its own configured headroom');
select is((public.get_market_request_usage((select request-array['reservationId','endpoint','phase','vinKey','estimatedCostMicros'] from market_budget_fixture))->>'remainingAttempts')::integer,
  59,'case headroom is based on cumulative physical attempts');
update market_budget_fixture set request=jsonb_set(request,'{accountLimits,priorMonthlyAttempts}','79');
select is(public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid(),'phase','baseline') from market_budget_fixture))->>'reasonCode',
  'MARKET_MONTHLY_RESERVE_REACHED','monotonic reconciliation includes newly reported outside usage');
select is(public.reserve_market_request_attempt((select jsonb_set(request||jsonb_build_object('reservationId',gen_random_uuid()),'{accountLimits,priorMonthlyAttempts}','3') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_CONFIGURATION_CHANGED','stale workers cannot undo reconciled usage');
select is((public.get_market_request_usage((select request-array['reservationId','endpoint','phase','vinKey','estimatedCostMicros'] from market_budget_fixture))->>'monthlyAttempts')::integer,
  80,'reconciliation does not refund already counted requests');
select is((public.record_market_request_account_state((select (request-array['reservationId','endpoint','phase','vinKey','estimatedCostMicros'])
  ||'{"retryAfterSeconds":120,"quotaExhausted":false}'::jsonb from market_budget_fixture))->>'recorded')::boolean,true,'temporary throttle is shared durably');
select is(public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_THROTTLED','another request respects Retry-After');
select is((public.record_market_request_account_state((select (request-array['reservationId','endpoint','phase','vinKey','estimatedCostMicros'])
  ||'{"retryAfterSeconds":0,"quotaExhausted":true}'::jsonb from market_budget_fixture))->>'recorded')::boolean,true,'explicit exhausted quota is recorded separately');
select is(public.reserve_market_request_attempt((select request||jsonb_build_object('reservationId',gen_random_uuid()) from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_QUOTA_EXHAUSTED','quota exhaustion is not treated as a short throttle');
select is(public.reserve_market_request_attempt((select jsonb_set(request||jsonb_build_object('reservationId',gen_random_uuid()),'{accountLimits,requestsPerWindow}','null') from market_budget_fixture))->>'reasonCode',
  'MARKET_ACCOUNT_RATE_LIMIT_UNCONFIGURED','missing plan facts fail closed');

insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  ('37000000-0000-4000-8000-000000000001','market-budget-fixture@example.test',statement_timestamp(),false);
insert into public.appraisal_cases(id,user_id,service_type,status) values
  ('37100000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001','total_loss','checking');
insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,vehicle_model,
  vehicle_trim,mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,
  intake_completed_at,analysis_input_revision,analysis_input_id) values
  ('37100000-0000-4000-8000-000000000001','manual',2022,'Honda','Accord','EX-L',32000,'60601',current_date-10,
    'Example Insurance',18000,statement_timestamp(),1,'37400000-0000-4000-8000-000000000001');
insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,processing_token,
  processing_expires_at,source_intake_mode,source_analysis_input_revision,source_analysis_input_id) values
  ('37200000-0000-4000-8000-000000000001','37100000-0000-4000-8000-000000000001',statement_timestamp(),'processing',
    '37300000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 hour','manual',1,'37400000-0000-4000-8000-000000000001');
update market_budget_fixture set request=jsonb_set(request || jsonb_build_object(
  'accountKey',repeat('f',64),'caseId','37100000-0000-4000-8000-000000000001','phase','baseline',
  'executionFence','{"jobId":"37200000-0000-4000-8000-000000000001","processingToken":"37300000-0000-4000-8000-000000000001"}'::jsonb),
  '{accountLimits,priorMonthlyAttempts}','0');
create function pg_temp.reserve_fenced(token uuid default '37300000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select public.reserve_market_request_attempt(jsonb_set(request || jsonb_build_object('reservationId',gen_random_uuid()),
    '{executionFence,processingToken}',coalesce(to_jsonb(token),'null'::jsonb))) from market_budget_fixture;
$$;
select is((pg_temp.reserve_fenced()->>'allowed')::boolean,true,'current processing owner can reserve an attempt');
select is(pg_temp.reserve_fenced('37300000-0000-4000-8000-000000000009')->>'reasonCode',
  'MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE','stale token cannot authorize transport');
select is(public.reserve_market_request_attempt((select request || jsonb_build_object('reservationId',gen_random_uuid(),
  'caseId','37100000-0000-4000-8000-000000000009') from market_budget_fixture))->>'reasonCode',
  'MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE','job token cannot authorize another case');
select is(public.reserve_market_request_attempt((select jsonb_set(request || jsonb_build_object('reservationId',gen_random_uuid()),
  '{executionFence,jobId}','"37200000-0000-4000-8000-000000000009"') from market_budget_fixture))->>'reasonCode',
  'MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE','unknown job cannot authorize transport');
update public.total_loss_analysis_jobs set processing_expires_at=clock_timestamp()-interval '1 second'
  where id='37200000-0000-4000-8000-000000000001';
select is(pg_temp.reserve_fenced()->>'reasonCode','MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE',
  'expired lease cannot authorize transport even when its token matches');
select is((select count(*)::integer from public.market_request_attempts where case_id='37100000-0000-4000-8000-000000000001'),
  1,'lease denials consume no transport reservations');
update public.total_loss_analysis_jobs set processing_expires_at=clock_timestamp()+interval '1 hour',
  processing_token='37300000-0000-4000-8000-000000000002' where id='37200000-0000-4000-8000-000000000001';
select is(pg_temp.reserve_fenced()->>'reasonCode','MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE',
  'reclaimed job rejects the previous worker');
select is((pg_temp.reserve_fenced('37300000-0000-4000-8000-000000000002')->>'allowed')::boolean,true,
  'replacement owner resumes within the same cumulative case allowance');
update public.total_loss_case_details set mileage_at_loss=33000 where case_id='37100000-0000-4000-8000-000000000001';
select is(pg_temp.reserve_fenced('37300000-0000-4000-8000-000000000002')->>'reasonCode',
  'MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE','old input job cannot authorize work after intake changes');
select is((select count(*)::integer from public.market_request_attempts where case_id='37100000-0000-4000-8000-000000000001'),
  2,'reclaim and input revision do not reset cumulative reservations');
select throws_ok($$select pg_temp.reserve_fenced(null)$$,'22023','market execution lease is invalid',
  'null processing token is rejected before lease matching');
select throws_ok($$select public.reserve_market_request_attempt((select request || '{"executionFence":null}'::jsonb from market_budget_fixture))$$,
  '22023','market execution lease is invalid','null execution envelope cannot disable an explicit fence');

select * from finish();
rollback;
