begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

select has_table('public','market_fact_cache','provider fact cache exists');
select ok((select relrowsecurity from pg_class where oid='public.market_fact_cache'::regclass),'cache uses RLS');
select ok(not has_table_privilege('anon','public.market_fact_cache','SELECT')
  and not has_table_privilege('authenticated','public.market_fact_cache','SELECT')
  and not has_table_privilege('service_role','public.market_fact_cache','SELECT'),'table is not directly readable');
select ok(not has_function_privilege('anon','public.claim_market_fact_cache(text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_market_fact_cache(text,uuid,jsonb)','EXECUTE'),'browser roles cannot use cache RPCs');
select ok(has_function_privilege('service_role','public.claim_market_fact_cache(text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.complete_market_fact_cache(text,uuid,jsonb)','EXECUTE'),'service role can use cache RPCs');

select is((select outcome from public.claim_market_fact_cache(repeat('a',64),'10000000-0000-4000-8000-000000000001')),'claimed','first worker claims');
select is((select outcome from public.claim_market_fact_cache(repeat('a',64),'10000000-0000-4000-8000-000000000001')),'claimed','claim retry is idempotent');
select is((select outcome from public.claim_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002')),'pending','concurrent worker does not duplicate provider work');
select throws_ok($$select * from public.claim_market_fact_cache('bad','10000000-0000-4000-8000-000000000001')$$,'22023','market fact cache identity is invalid','invalid identity fails');

create temporary table fact_fixture as select '{"provider":"marketcheck","resolverVersion":"1","vin":"KM8HACABXTU436557","status":"RESOLVED","drivetrain":"4WD"}'::jsonb as result;
select is(public.complete_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002',(select result from fact_fixture)),false,'other worker cannot complete');
select is(public.complete_market_fact_cache(repeat('a',64),'10000000-0000-4000-8000-000000000001',(select result from fact_fixture)),true,'claim owner completes');
select is(public.complete_market_fact_cache(repeat('a',64),'10000000-0000-4000-8000-000000000001',(select result from fact_fixture)),true,'completion retry is idempotent');
select is(public.complete_market_fact_cache(repeat('a',64),'10000000-0000-4000-8000-000000000001',(select result || '{"drivetrain":"FWD"}'::jsonb from fact_fixture)),false,'completed source fact cannot be replaced');
select is((select outcome from public.claim_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002')),'ready','different analysis reuses result');
select is((select result from public.claim_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002')),(select result from fact_fixture),'cached evidence remains exact');
select ok((select result_expires_at > clock_timestamp()+interval '6 days' and result_expires_at <= clock_timestamp()+interval '7 days' from public.market_fact_cache where lookup_key=repeat('a',64)),'explicit specs expire in seven days');

update public.market_fact_cache set result_expires_at=clock_timestamp()-interval '1 second' where lookup_key=repeat('a',64);
select is((select outcome from public.claim_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002')),'claimed','expired result permits bounded refresh');
select is(public.complete_market_fact_cache(repeat('a',64),'10000000-0000-4000-8000-000000000001',(select result from fact_fixture)),false,'superseded token is fenced');
update fact_fixture set result=result || '{"status":"FAILED","drivetrain":null}'::jsonb;
select is(public.complete_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002',(select result from fact_fixture)),true,'failed lookup is cached too');
select ok((select result_expires_at > clock_timestamp()+interval '4 minutes' and result_expires_at <= clock_timestamp()+interval '5 minutes' from public.market_fact_cache where lookup_key=repeat('a',64)),'failures have a short retry window');

select * from public.claim_market_fact_cache(repeat('b',64),'10000000-0000-4000-8000-000000000001');
update public.market_fact_cache set generation_expires_at=clock_timestamp()-interval '1 second' where lookup_key=repeat('b',64);
select is(public.complete_market_fact_cache(repeat('b',64),'10000000-0000-4000-8000-000000000001',(select result from fact_fixture)),false,'expired lease cannot publish');
select throws_ok($$select public.complete_market_fact_cache(repeat('a',64),'20000000-0000-4000-8000-000000000002','{}'::jsonb)$$,'22023','market fact cache result is invalid','malformed provider result is rejected');

select * from finish();
rollback;
