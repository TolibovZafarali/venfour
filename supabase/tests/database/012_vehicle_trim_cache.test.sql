begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

select has_table(
  'public',
  'vehicle_trim_cache',
  'the persistent vehicle trim cache exists'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'vehicle_trim_cache'
  ),
  11,
  'the cache stores only its bounded lookup, result, claim, and timestamp fields'
);

select ok(
  (
    select class_info.relrowsecurity
    from pg_class as class_info
    where class_info.oid = 'public.vehicle_trim_cache'::regclass
  ),
  'row level security is enabled on the private cache'
);

select is(
  (
    select count(*)::integer
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'vehicle_trim_cache'
  ),
  0,
  'the private cache has no browser-facing RLS policies'
);

select ok(
  not has_table_privilege('anon', 'public.vehicle_trim_cache', 'SELECT')
    and not has_table_privilege(
      'authenticated', 'public.vehicle_trim_cache', 'SELECT'
    )
    and not has_table_privilege(
      'service_role', 'public.vehicle_trim_cache', 'SELECT'
    )
    and not has_table_privilege(
      'service_role', 'public.vehicle_trim_cache', 'INSERT'
    )
    and not has_table_privilege(
      'service_role', 'public.vehicle_trim_cache', 'UPDATE'
    )
    and not has_table_privilege(
      'service_role', 'public.vehicle_trim_cache', 'DELETE'
    ),
  'all application roles are fenced away from direct cache table access'
);

select has_function(
  'public',
  'claim_vehicle_trim_cache',
  array['text', 'smallint', 'text', 'text', 'uuid'],
  'the race-safe cache claim RPC exists'
);

select has_function(
  'public',
  'complete_vehicle_trim_cache',
  array['text', 'uuid', 'text', 'jsonb'],
  'the token-bound cache completion RPC exists'
);

select has_function(
  'public',
  'release_vehicle_trim_cache',
  array['text', 'uuid'],
  'the token-bound cache release RPC exists'
);

select ok(
  (
    select count(*) = 3
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid in (
      'public.claim_vehicle_trim_cache(text,smallint,text,text,uuid)'::regprocedure,
      'public.complete_vehicle_trim_cache(text,uuid,text,jsonb)'::regprocedure,
      'public.release_vehicle_trim_cache(text,uuid)'::regprocedure
    )
  ),
  'cache RPCs are security-definer functions with an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_vehicle_trim_cache(text,smallint,text,text,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'service_role',
      'public.complete_vehicle_trim_cache(text,uuid,text,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.release_vehicle_trim_cache(text,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.claim_vehicle_trim_cache(text,smallint,text,text,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.complete_vehicle_trim_cache(text,uuid,text,jsonb)',
      'EXECUTE'
    ),
  'only the server service role can invoke the cache RPC surface'
);

truncate table public.vehicle_trim_cache;

set local role service_role;

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '2019|tesla|model 3',
      2019::smallint,
      'Tesla',
      'Model 3',
      '10000000-0000-4000-8000-000000000001'::uuid
    )
  ),
  'claimed',
  'the first request atomically claims an unseen vehicle'
);

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '2019|tesla|model 3',
      2019::smallint,
      'Tesla',
      'Model 3',
      '10000000-0000-4000-8000-000000000001'::uuid
    )
  ),
  'claimed',
  'an ambiguous retry with the same token remains idempotently claimed'
);

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '2019|tesla|model 3',
      2019::smallint,
      'Tesla',
      'Model 3',
      '20000000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'pending',
  'a concurrent token cannot start duplicate generation'
);

select is(
  public.complete_vehicle_trim_cache(
    '2019|tesla|model 3',
    '20000000-0000-4000-8000-000000000002'::uuid,
    'gpt-5.6-luna',
    '["Long Range", "Performance"]'::jsonb
  ),
  false,
  'a non-owner token cannot complete another request claim'
);

select is(
  public.complete_vehicle_trim_cache(
    '2019|tesla|model 3',
    '10000000-0000-4000-8000-000000000001'::uuid,
    'gpt-5.6-luna',
    '["Long Range", "Performance"]'::jsonb
  ),
  true,
  'the claim owner can persist the generated trim list'
);

select is(
  public.complete_vehicle_trim_cache(
    '2019|tesla|model 3',
    '10000000-0000-4000-8000-000000000001'::uuid,
    'gpt-5.6-luna',
    '["Long Range", "Performance"]'::jsonb
  ),
  true,
  'completion is idempotent after an ambiguous response'
);

select is(
  (
    select concat_ws('|', outcome, model_identifier, trims::text)
    from public.claim_vehicle_trim_cache(
      '2019|tesla|model 3',
      2019::smallint,
      'Tesla',
      'Model 3',
      '30000000-0000-4000-8000-000000000003'::uuid
    )
  ),
  'ready|gpt-5.6-luna|["Long Range", "Performance"]',
  'later requests receive the stored result immediately'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.vehicle_trim_cache
    where lookup_key = '2019|tesla|model 3'
  ),
  1,
  'the normalized primary key prevents duplicate cache rows'
);

set local role service_role;

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '1992|geo|storm',
      1992::smallint,
      'Geo',
      'Storm',
      '40000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  'claimed',
  'an unknown lineup can be claimed normally'
);

select is(
  public.complete_vehicle_trim_cache(
    '1992|geo|storm',
    '40000000-0000-4000-8000-000000000004'::uuid,
    'gpt-5.6-luna',
    '[]'::jsonb
  ),
  true,
  'an empty high-confidence result is persistently cached'
);

select is(
  (
    select concat_ws('|', outcome, trims::text)
    from public.claim_vehicle_trim_cache(
      '1992|geo|storm',
      1992::smallint,
      'Geo',
      'Storm',
      '50000000-0000-4000-8000-000000000005'::uuid
    )
  ),
  'ready|[]',
  'cached empty results also prevent repeat generation'
);

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '2024|honda|accord',
      2024::smallint,
      'Honda',
      'Accord',
      '60000000-0000-4000-8000-000000000006'::uuid
    )
  ),
  'claimed',
  'a separate vehicle receives its own claim'
);

select is(
  public.release_vehicle_trim_cache(
    '2024|honda|accord',
    '70000000-0000-4000-8000-000000000007'::uuid
  ),
  false,
  'a non-owner token cannot release a claim'
);

select is(
  public.release_vehicle_trim_cache(
    '2024|honda|accord',
    '60000000-0000-4000-8000-000000000006'::uuid
  ),
  true,
  'a failed generator can release its own pending claim'
);

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '2024|honda|accord',
      2024::smallint,
      'Honda',
      'Accord',
      '70000000-0000-4000-8000-000000000007'::uuid
    )
  ),
  'claimed',
  'a released failed claim can be retried later'
);

reset role;

update public.vehicle_trim_cache
set generation_expires_at = clock_timestamp() - interval '1 second'
where lookup_key = '2024|honda|accord';

set local role service_role;

select is(
  (
    select outcome
    from public.claim_vehicle_trim_cache(
      '2024|honda|accord',
      2024::smallint,
      'Honda',
      'Accord',
      '80000000-0000-4000-8000-000000000008'::uuid
    )
  ),
  'claimed',
  'an expired abandoned claim can be recovered without a duplicate row'
);

select * from finish();
rollback;
