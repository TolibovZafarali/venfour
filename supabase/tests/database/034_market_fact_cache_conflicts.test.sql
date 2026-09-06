begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

select ok(not has_function_privilege('anon','public.preserve_market_fact_cache_conflict(text,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.preserve_market_fact_cache_conflict(text,text,jsonb)','EXECUTE'),
  'browser roles cannot preserve provider facts');
select ok(has_function_privilege('service_role','public.preserve_market_fact_cache_conflict(text,text,jsonb)','EXECUTE'),
  'service role can preserve a conflict');

create temporary table cache_conflict_fixture as select
  jsonb_build_object('provider','marketcheck','resolverVersion','1','vin','KM8HACABXTU436557',
    'vehicle',jsonb_build_object('year',2026,'make','Hyundai','model','Kona'),
    'status','RESOLVED','drivetrain','4WD','evidenceDigest',repeat('b',64),
    'evidence',jsonb_build_array(jsonb_build_object('listingId','first','drivetrain','4WD'))) as initial;
alter table cache_conflict_fixture add column conflicting jsonb;
update cache_conflict_fixture set conflicting=initial || jsonb_build_object(
  'status','CONFLICT','drivetrain',null,'evidenceDigest',repeat('c',64),
  'evidence',(initial->'evidence') || jsonb_build_array(jsonb_build_object('listingId','second','drivetrain','FWD')));

select is((select outcome from public.claim_market_fact_cache(repeat('d',64),'10000000-0000-4000-8000-000000000001')),
  'claimed','initial lookup can claim');
select is(public.complete_market_fact_cache(repeat('d',64),'10000000-0000-4000-8000-000000000001',
  (select initial from cache_conflict_fixture)),true,'initial explicit fact is cached');
select throws_ok($$select public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('b',64),'{}'::jsonb)$$,
  '22023','market fact cache conflict is invalid','invalid conflict fails');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('e',64),
  (select conflicting from cache_conflict_fixture)),false,'stale expected digest cannot replace facts');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('b',64),
  (select conflicting || '{"vin":"KM8HACAB7TU435365"}'::jsonb from cache_conflict_fixture)),false,'VIN must remain bound');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('b',64),
  (select jsonb_set(conflicting,'{vehicle,year}','2025'::jsonb) from cache_conflict_fixture)),false,'vehicle facts must remain bound');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('b',64),
  (select jsonb_set(conflicting,'{evidence,0,listingId}','"replacement"'::jsonb) from cache_conflict_fixture)),false,
  'prior contradictory observations cannot disappear');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('b',64),
  (select conflicting from cache_conflict_fixture)),true,'additional contradictory evidence is retained');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('b',64),
  (select conflicting from cache_conflict_fixture)),true,'ambiguous retry is idempotent');
select is((select result->>'status' from public.claim_market_fact_cache(repeat('d',64),'20000000-0000-4000-8000-000000000002')),
  'CONFLICT','later analysis receives the conflict');
select is((select result from public.claim_market_fact_cache(repeat('d',64),'20000000-0000-4000-8000-000000000002')),
  (select conflicting from cache_conflict_fixture),'all conflicting evidence stays exact');
select ok((select result_expires_at > clock_timestamp()+interval '23 hours'
  and result_expires_at <= clock_timestamp()+interval '1 day' from public.market_fact_cache where lookup_key=repeat('d',64)),
  'conflicts use the existing one-day cache lifetime');
select throws_ok($$select public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('c',64),
  (select initial from cache_conflict_fixture))$$,'22023','market fact cache conflict is invalid','conflict cannot be reassured by this RPC');
update public.market_fact_cache set result_expires_at=clock_timestamp()-interval '1 second' where lookup_key=repeat('d',64);
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('c',64),
  (select conflicting from cache_conflict_fixture)),false,'expired evidence is not revived');
select * from public.claim_market_fact_cache(repeat('d',64),'20000000-0000-4000-8000-000000000002');
select is(public.preserve_market_fact_cache_conflict(repeat('d',64),repeat('c',64),
  (select conflicting from cache_conflict_fixture)),false,'pending generation cannot be replaced');
select is((select outcome from public.claim_market_fact_cache(repeat('d',64),'10000000-0000-4000-8000-000000000001')),
  'pending','claim fencing remains effective');

select * from finish();
rollback;
