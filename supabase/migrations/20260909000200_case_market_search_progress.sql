create table public.total_loss_market_search_progress (
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  checkpoint jsonb not null check (jsonb_typeof(checkpoint) = 'object' and octet_length(checkpoint::text) <= 8388608),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (case_id, input_digest)
);
alter table public.total_loss_market_search_progress enable row level security;
revoke all on public.total_loss_market_search_progress from public, anon, authenticated, service_role;

create function public.market_search_checkpoint_is_safe(requested jsonb)
returns boolean language sql immutable set search_path = '' as $$
  with recursive nodes(value, field_name) as (
    select requested, ''::text
    union all
    select child.value, child.field_name from nodes n cross join lateral (
      select obj.value, obj.key as field_name
      from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end) obj
      union all
      select arr.value, ''::text
      from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end) arr
    ) child
  )
  select not exists(select 1 from nodes n where
    regexp_replace(lower(n.field_name),'[^a-z0-9]','','g') in
      ('accesstoken','apikey','authorization','authorizationheader','clientsecret','credential','headers',
       'marketcheckapikey','openaiapikey','password','secret','token',
       'rawresponse','rawpayload','providerresponse','providerpayload','requestheaders','responseheaders')
    or (jsonb_typeof(n.value)='string' and (
      (n.value #>> '{}') ~* '(^|[[:space:]])(https?:)?//[^/?#[:space:]]*@'
      or (n.value #>> '{}') ~* '[?&#](api[_-]?key|access[_-]?token|authorization|password|secret|token|signature|credential)=')));
$$;
revoke all on function public.market_search_checkpoint_is_safe(jsonb) from public,anon,authenticated,service_role;

create function public.get_case_market_search_progress(
  requested_case_id uuid, requested_job_id uuid, requested_processing_token uuid,
  requested_input_digest text, requested_retention_days integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; job public.total_loss_analysis_jobs%rowtype;
begin
  if requested_input_digest is null or requested_input_digest !~ '^[0-9a-f]{64}$'
    or requested_retention_days is null or requested_retention_days not between 1 and 30 then
    raise exception 'Invalid market search input identity' using errcode = '22023';
  end if;
  select * into job from public.total_loss_analysis_jobs j
    where j.id = requested_job_id and j.case_id = requested_case_id for update;
  if not found or job.processing_token is distinct from requested_processing_token
    or job.status <> 'processing' or job.processing_expires_at <= clock_timestamp() then
    raise exception 'Market search processing lease is unavailable' using errcode = '42501';
  end if;
  delete from public.total_loss_market_search_progress p
    where p.case_id = requested_case_id and (p.expires_at <= clock_timestamp()
      or p.created_at + make_interval(days=>requested_retention_days) <= clock_timestamp());
  select p.checkpoint into saved from public.total_loss_market_search_progress p
    where p.case_id = requested_case_id and p.input_digest = requested_input_digest;
  return saved;
end $$;

create function public.save_case_market_search_progress(
  requested_case_id uuid, requested_job_id uuid, requested_processing_token uuid,
  requested_input_digest text, requested_checkpoint jsonb, requested_retention_days integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.total_loss_analysis_jobs%rowtype;
begin
  if requested_input_digest is null or requested_input_digest !~ '^[0-9a-f]{64}$'
    or requested_retention_days is null or requested_retention_days not between 1 and 30
    or requested_checkpoint is null or jsonb_typeof(requested_checkpoint) <> 'object'
    or requested_checkpoint->>'inputDigest' is distinct from requested_input_digest
    or requested_checkpoint->>'version' is distinct from '1'
    or not requested_checkpoint ?& array['version','inputDigest','input','events','geography','origin','providers','usageBefore','historicalTemplate']
    or requested_checkpoint - array['version','inputDigest','input','events','geography','origin','providers','usageBefore','historicalTemplate'] <> '{}'::jsonb
    or jsonb_typeof(requested_checkpoint->'events') is distinct from 'array'
    or jsonb_array_length(requested_checkpoint->'events') > 200
    or octet_length(requested_checkpoint::text) > 8388608
    or not public.market_search_checkpoint_is_safe(requested_checkpoint) then
    raise exception 'Invalid bounded market search checkpoint' using errcode = '22023';
  end if;
  select * into job from public.total_loss_analysis_jobs j
    where j.id = requested_job_id and j.case_id = requested_case_id for update;
  if not found or job.processing_token is distinct from requested_processing_token
    or job.status <> 'processing' or job.processing_expires_at <= clock_timestamp() then
    return false;
  end if;
  delete from public.total_loss_market_search_progress p
    where p.case_id = requested_case_id and (p.input_digest <> requested_input_digest or p.expires_at <= clock_timestamp());
  insert into public.total_loss_market_search_progress(case_id, input_digest, checkpoint, expires_at)
    values(requested_case_id, requested_input_digest, requested_checkpoint,
      clock_timestamp() + make_interval(days => requested_retention_days))
    on conflict(case_id, input_digest) do update set
      checkpoint = excluded.checkpoint,
      -- Repeated saves cannot extend the originally permitted retention period.
      expires_at = least(public.total_loss_market_search_progress.expires_at, excluded.expires_at,
        public.total_loss_market_search_progress.created_at + make_interval(days=>requested_retention_days)),
      updated_at = clock_timestamp();
  return true;
end $$;

revoke all on function public.get_case_market_search_progress(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.save_case_market_search_progress(uuid,uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.get_case_market_search_progress(uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.save_case_market_search_progress(uuid,uuid,uuid,text,jsonb,integer) to service_role;
