create or replace function public.preserve_market_fact_cache_conflict(
  requested_lookup_key text, expected_evidence_digest text, requested_result jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  observed_time timestamptz := clock_timestamp();
  updated_rows integer;
begin
  if requested_lookup_key is null or requested_lookup_key !~ '^[0-9a-f]{64}$'
    or expected_evidence_digest is null or expected_evidence_digest !~ '^[0-9a-f]{64}$'
    or requested_result is null or jsonb_typeof(requested_result) <> 'object'
    or octet_length(requested_result::text) > 65536
    or requested_result->>'provider' is distinct from 'marketcheck'
    or requested_result->>'resolverVersion' is distinct from '1'
    or requested_result->>'status' is distinct from 'CONFLICT'
    or requested_result->'drivetrain' is distinct from 'null'::jsonb
    or coalesce(requested_result->>'vin','') !~ '^[A-HJ-NPR-Z0-9]{17}$'
    or jsonb_typeof(requested_result->'vehicle') is distinct from 'object'
    or jsonb_typeof(requested_result->'evidence') is distinct from 'array'
    or coalesce(requested_result->>'evidenceDigest','') !~ '^[0-9a-f]{64}$' then
    raise exception 'market fact cache conflict is invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(requested_result->'evidence') > 50
    or (select count(distinct fact->>'drivetrain') from jsonb_array_elements(requested_result->'evidence') fact
        where fact->>'drivetrain' in ('FWD','RWD','AWD','4WD')) < 2 then
    raise exception 'market fact cache conflict is invalid' using errcode = '22023';
  end if;

  update public.market_fact_cache cache set result = requested_result,
    result_expires_at = observed_time + interval '1 day', updated_at = observed_time
    where cache.lookup_key = requested_lookup_key
      and cache.result is not null and cache.result_expires_at > observed_time
      and cache.result->>'evidenceDigest' = expected_evidence_digest
      and cache.result->>'vin' = requested_result->>'vin'
      and cache.result->'vehicle' = requested_result->'vehicle'
      and (requested_result->'evidence') @> (cache.result->'evidence');
  get diagnostics updated_rows = row_count;
  if updated_rows = 1 then return true; end if;
  return exists(select 1 from public.market_fact_cache cache
    where cache.lookup_key = requested_lookup_key and cache.result = requested_result
      and cache.result_expires_at > observed_time);
end;
$$;

revoke all on function public.preserve_market_fact_cache_conflict(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.preserve_market_fact_cache_conflict(text, text, jsonb) to service_role;
