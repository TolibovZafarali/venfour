create table public.market_fact_cache (
  lookup_key text primary key check (lookup_key ~ '^[0-9a-f]{64}$'),
  generation_token uuid not null,
  generation_expires_at timestamptz,
  result jsonb,
  result_expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint market_fact_cache_state_valid check (
    (result is null and result_expires_at is null and generation_expires_at is not null)
    or (jsonb_typeof(result) = 'object' and result_expires_at is not null and generation_expires_at is null)
  )
);

alter table public.market_fact_cache enable row level security;
revoke all on table public.market_fact_cache from public, anon, authenticated, service_role;

create function public.claim_market_fact_cache(requested_lookup_key text, requested_generation_token uuid)
returns table (outcome text, result jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  claim_time timestamptz := clock_timestamp();
  inserted_rows integer;
  cached public.market_fact_cache%rowtype;
begin
  if requested_lookup_key is null or requested_lookup_key !~ '^[0-9a-f]{64}$'
     or requested_generation_token is null then
    raise exception 'market fact cache identity is invalid' using errcode = '22023';
  end if;
  insert into public.market_fact_cache(lookup_key, generation_token, generation_expires_at)
    values(requested_lookup_key, requested_generation_token, claim_time + interval '90 seconds')
    on conflict (lookup_key) do nothing;
  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    return query select 'claimed'::text, null::jsonb;
    return;
  end if;
  select cache.* into cached from public.market_fact_cache cache
    where cache.lookup_key = requested_lookup_key for update;
  if cached.result is not null and cached.result_expires_at > claim_time then
    return query select 'ready'::text, cached.result;
    return;
  end if;
  if cached.result is null and cached.generation_expires_at > claim_time then
    return query select case when cached.generation_token = requested_generation_token
      then 'claimed'::text else 'pending'::text end, null::jsonb;
    return;
  end if;
  update public.market_fact_cache cache set generation_token = requested_generation_token,
    generation_expires_at = claim_time + interval '90 seconds', result = null,
    result_expires_at = null, updated_at = claim_time
    where cache.lookup_key = requested_lookup_key;
  return query select 'claimed'::text, null::jsonb;
end;
$$;

create function public.complete_market_fact_cache(
  requested_lookup_key text, requested_generation_token uuid, requested_result jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  completion_time timestamptz := clock_timestamp();
  ttl interval;
  updated_rows integer;
begin
  if requested_lookup_key is null or requested_lookup_key !~ '^[0-9a-f]{64}$'
    or requested_generation_token is null or requested_result is null
    or jsonb_typeof(requested_result) <> 'object'
    or octet_length(requested_result::text) > 65536
    or requested_result->>'provider' is distinct from 'marketcheck'
    or requested_result->>'resolverVersion' is distinct from '1'
    or coalesce(requested_result->>'status', '') not in ('RESOLVED','UNAVAILABLE','CONFLICT','FAILED')
    or coalesce(requested_result->>'vin','') !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    raise exception 'market fact cache result is invalid' using errcode = '22023';
  end if;
  ttl := case requested_result->>'status' when 'RESOLVED' then interval '7 days'
    when 'FAILED' then interval '5 minutes' else interval '1 day' end;
  update public.market_fact_cache cache set result = requested_result,
    result_expires_at = completion_time + ttl, generation_expires_at = null,
    updated_at = completion_time
    where cache.lookup_key = requested_lookup_key
      and cache.generation_token = requested_generation_token
      and cache.result is null and cache.generation_expires_at > completion_time;
  get diagnostics updated_rows = row_count;
  if updated_rows = 1 then return true; end if;
  return exists(select 1 from public.market_fact_cache cache
    where cache.lookup_key = requested_lookup_key and cache.generation_token = requested_generation_token
      and cache.result = requested_result);
end;
$$;

revoke all on function public.claim_market_fact_cache(text, uuid) from public, anon, authenticated;
revoke all on function public.complete_market_fact_cache(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_market_fact_cache(text, uuid) to service_role;
grant execute on function public.complete_market_fact_cache(text, uuid, jsonb) to service_role;
