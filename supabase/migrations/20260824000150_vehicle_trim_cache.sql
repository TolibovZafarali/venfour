create table public.vehicle_trim_cache (
  lookup_key text primary key,
  vehicle_year smallint not null,
  vehicle_make text not null,
  vehicle_model text not null,
  status text not null default 'pending',
  trims jsonb,
  model_identifier text,
  generation_token uuid not null,
  generation_expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint vehicle_trim_cache_lookup_key_valid check (
    char_length(lookup_key) between 1 and 512
    and lookup_key = btrim(lookup_key)
    and lookup_key !~ '[[:cntrl:]]'
  ),
  constraint vehicle_trim_cache_year_valid check (
    vehicle_year between 1981 and 9999
  ),
  constraint vehicle_trim_cache_make_valid check (
    char_length(vehicle_make) between 1 and 100
    and vehicle_make = btrim(vehicle_make)
    and vehicle_make !~ '[[:cntrl:]]'
  ),
  constraint vehicle_trim_cache_model_valid check (
    char_length(vehicle_model) between 1 and 100
    and vehicle_model = btrim(vehicle_model)
    and vehicle_model !~ '[[:cntrl:]]'
  ),
  constraint vehicle_trim_cache_status_valid check (
    status in ('pending', 'ready')
  ),
  constraint vehicle_trim_cache_payload_valid check (
    case
      when status = 'pending' then
        trims is null
        and model_identifier is null
        and generation_expires_at is not null
      when status = 'ready' then
        jsonb_typeof(trims) = 'array'
        and jsonb_array_length(trims) <= 50
        and char_length(model_identifier) between 1 and 100
        and model_identifier = btrim(model_identifier)
        and model_identifier !~ '[[:cntrl:]]'
        and generation_expires_at is null
      else false
    end
  ),
  constraint vehicle_trim_cache_timestamps_valid check (
    updated_at >= created_at
  )
);

alter table public.vehicle_trim_cache enable row level security;

revoke all on table public.vehicle_trim_cache
from public, anon, authenticated, service_role;

create or replace function public.claim_vehicle_trim_cache(
  requested_lookup_key text,
  requested_vehicle_year smallint,
  requested_vehicle_make text,
  requested_vehicle_model text,
  requested_generation_token uuid
)
returns table (
  outcome text,
  trims jsonb,
  model_identifier text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_time timestamptz := clock_timestamp();
  inserted_rows integer := 0;
  cached_row public.vehicle_trim_cache%rowtype;
begin
  if requested_lookup_key is null
    or char_length(requested_lookup_key) not between 1 and 512
    or requested_lookup_key <> btrim(requested_lookup_key)
    or requested_lookup_key ~ '[[:cntrl:]]'
    or requested_vehicle_year not between 1981 and 9999
    or requested_vehicle_make is null
    or char_length(requested_vehicle_make) not between 1 and 100
    or requested_vehicle_make <> btrim(requested_vehicle_make)
    or requested_vehicle_make ~ '[[:cntrl:]]'
    or requested_vehicle_model is null
    or char_length(requested_vehicle_model) not between 1 and 100
    or requested_vehicle_model <> btrim(requested_vehicle_model)
    or requested_vehicle_model ~ '[[:cntrl:]]'
    or requested_generation_token is null
  then
    raise exception 'vehicle trim cache claim is invalid'
      using errcode = '22023';
  end if;

  insert into public.vehicle_trim_cache (
    lookup_key,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    status,
    generation_token,
    generation_expires_at,
    created_at,
    updated_at
  )
  values (
    requested_lookup_key,
    requested_vehicle_year,
    requested_vehicle_make,
    requested_vehicle_model,
    'pending',
    requested_generation_token,
    claim_time + interval '30 seconds',
    claim_time,
    claim_time
  )
  on conflict (lookup_key) do nothing;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    return query select 'claimed'::text, null::jsonb, null::text;
    return;
  end if;

  select cache.*
    into cached_row
  from public.vehicle_trim_cache as cache
  where cache.lookup_key = requested_lookup_key
  for update;

  if not found then
    raise exception 'vehicle trim cache claim could not be resolved'
      using errcode = '40001';
  end if;

  if cached_row.status = 'ready' then
    return query
      select
        'ready'::text,
        cached_row.trims,
        cached_row.model_identifier;
    return;
  end if;

  if cached_row.generation_token = requested_generation_token then
    return query select 'claimed'::text, null::jsonb, null::text;
    return;
  end if;

  if cached_row.generation_expires_at <= claim_time then
    update public.vehicle_trim_cache as cache
    set
      vehicle_year = requested_vehicle_year,
      vehicle_make = requested_vehicle_make,
      vehicle_model = requested_vehicle_model,
      generation_token = requested_generation_token,
      generation_expires_at = claim_time + interval '30 seconds',
      updated_at = claim_time
    where cache.lookup_key = requested_lookup_key;

    return query select 'claimed'::text, null::jsonb, null::text;
    return;
  end if;

  return query select 'pending'::text, null::jsonb, null::text;
end;
$$;

create or replace function public.complete_vehicle_trim_cache(
  requested_lookup_key text,
  requested_generation_token uuid,
  requested_model_identifier text,
  requested_trims jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_rows integer := 0;
  completion_time timestamptz := clock_timestamp();
begin
  if requested_lookup_key is null
    or char_length(requested_lookup_key) not between 1 and 512
    or requested_lookup_key <> btrim(requested_lookup_key)
    or requested_lookup_key ~ '[[:cntrl:]]'
    or requested_generation_token is null
    or requested_model_identifier is null
    or char_length(requested_model_identifier) not between 1 and 100
    or requested_model_identifier <> btrim(requested_model_identifier)
    or requested_model_identifier ~ '[[:cntrl:]]'
    or jsonb_typeof(requested_trims) <> 'array'
    or jsonb_array_length(requested_trims) > 50
    or exists (
      select 1
      from jsonb_array_elements(requested_trims) as trim_value
      where jsonb_typeof(trim_value) <> 'string'
        or char_length(trim_value #>> '{}') not between 1 and 100
        or (trim_value #>> '{}') <> btrim(trim_value #>> '{}')
        or (trim_value #>> '{}') ~ '[[:cntrl:]]'
    )
    or (
      select count(*) <> count(distinct lower(trim_value #>> '{}'))
      from jsonb_array_elements(requested_trims) as trim_value
    )
  then
    raise exception 'vehicle trim cache completion is invalid'
      using errcode = '22023';
  end if;

  update public.vehicle_trim_cache as cache
  set
    status = 'ready',
    trims = requested_trims,
    model_identifier = requested_model_identifier,
    generation_expires_at = null,
    updated_at = completion_time
  where cache.lookup_key = requested_lookup_key
    and cache.status = 'pending'
    and cache.generation_token = requested_generation_token;

  get diagnostics updated_rows = row_count;
  if updated_rows = 1 then
    return true;
  end if;

  return exists (
    select 1
    from public.vehicle_trim_cache as cache
    where cache.lookup_key = requested_lookup_key
      and cache.status = 'ready'
      and cache.generation_token = requested_generation_token
      and cache.model_identifier = requested_model_identifier
      and cache.trims = requested_trims
  );
end;
$$;

create or replace function public.release_vehicle_trim_cache(
  requested_lookup_key text,
  requested_generation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_rows integer := 0;
begin
  if requested_lookup_key is null
    or char_length(requested_lookup_key) not between 1 and 512
    or requested_lookup_key <> btrim(requested_lookup_key)
    or requested_lookup_key ~ '[[:cntrl:]]'
    or requested_generation_token is null
  then
    raise exception 'vehicle trim cache release is invalid'
      using errcode = '22023';
  end if;

  delete from public.vehicle_trim_cache as cache
  where cache.lookup_key = requested_lookup_key
    and cache.status = 'pending'
    and cache.generation_token = requested_generation_token;

  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

revoke all on function public.claim_vehicle_trim_cache(
  text, smallint, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.complete_vehicle_trim_cache(
  text, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.release_vehicle_trim_cache(
  text, uuid
) from public, anon, authenticated;

grant execute on function public.claim_vehicle_trim_cache(
  text, smallint, text, text, uuid
) to service_role;
grant execute on function public.complete_vehicle_trim_cache(
  text, uuid, text, jsonb
) to service_role;
grant execute on function public.release_vehicle_trim_cache(
  text, uuid
) to service_role;
