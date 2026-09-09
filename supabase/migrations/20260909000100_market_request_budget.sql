create table public.market_request_accounts (
  account_key text primary key check (account_key ~ '^[0-9a-f]{64}$'),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  blocked_until timestamptz,
  quota_exhausted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.market_request_cases (
  account_key text not null references public.market_request_accounts(account_key),
  case_id uuid primary key,
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (account_key, case_id)
);

create table public.market_request_attempts (
  reservation_id uuid primary key,
  account_key text not null,
  case_id uuid not null,
  endpoint text not null check (endpoint in ('active_inventory','historical_inventory','vin_history','vehicle_terms')),
  phase text not null check (phase in ('baseline','supporting','enrichment')),
  operation text not null check (operation in ('active_discovery','historical_discovery','vin_history','enrichment','vehicle_terms')),
  vin_key text check (vin_key ~ '^[0-9a-f]{64}$'),
  estimated_cost_micros bigint check (estimated_cost_micros between 0 and 1000000000000),
  reserved_at timestamptz not null default clock_timestamp(),
  foreign key (account_key, case_id) references public.market_request_cases(account_key, case_id),
  check (endpoint <> 'vin_history' or vin_key is not null)
);

create index market_request_attempts_account_time on public.market_request_attempts(account_key, reserved_at);
create index market_request_attempts_case on public.market_request_attempts(account_key, case_id);

alter table public.market_request_accounts enable row level security;
alter table public.market_request_cases enable row level security;
alter table public.market_request_attempts enable row level security;
revoke all on public.market_request_accounts, public.market_request_cases, public.market_request_attempts
  from public, anon, authenticated, service_role;

create function public.validate_market_request_internal(requested jsonb, requested_operation text)
returns void language plpgsql set search_path = '' as $$
declare
  p jsonb := requested->'policy';
  a jsonb := requested->'accountLimits';
  k text;
  extra_keys text[];
begin
  extra_keys := case requested_operation when 'reserve' then
    array['reservationId','endpoint','phase','vinKey','estimatedCostMicros']
    when 'state' then array['retryAfterSeconds','quotaExhausted'] else array[]::text[] end;
  if requested_operation='reserve' and requested ? 'executionFence' then
    extra_keys := extra_keys || array['executionFence'];
  end if;
  if requested is null or jsonb_typeof(requested) <> 'object'
    or requested - (array['accountKey','caseId','policy','accountLimits'] || extra_keys) <> '{}'::jsonb
    or not requested ?& (array['accountKey','caseId','policy','accountLimits'] || extra_keys)
    or coalesce(requested->>'accountKey','') !~ '^[0-9a-f]{64}$'
    or coalesce(requested->>'caseId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p) <> 'object' or jsonb_typeof(a) <> 'object' then
    raise exception 'market request accounting identity is invalid' using errcode = '22023';
  end if;
  if not p ?& array['totalAttempts','supportingAttempts','supportingDiscoveryAttempts','operationLimits',
    'perVinHistoryAttempts','monthlyReserveBasisPoints','optimizationTarget']
    or p - array['totalAttempts','supportingAttempts','supportingDiscoveryAttempts','operationLimits',
    'perVinHistoryAttempts','monthlyReserveBasisPoints','optimizationTarget'] <> '{}'::jsonb then
    raise exception 'market request policy is invalid' using errcode = '22023';
  end if;
  foreach k in array array['totalAttempts','supportingAttempts','supportingDiscoveryAttempts','perVinHistoryAttempts','monthlyReserveBasisPoints'] loop
    if jsonb_typeof(p->k) <> 'number' or coalesce(p->>k,'') !~ '^[0-9]{1,10}$'
      or (p->>k)::bigint > 2147483647 then
      raise exception 'market request policy is invalid' using errcode = '22023';
    end if;
  end loop;
  if (p->>'totalAttempts')::integer < 1 or (p->>'monthlyReserveBasisPoints')::integer >= 10000
    or (p->>'supportingDiscoveryAttempts')::integer > (p->>'supportingAttempts')::integer
    or jsonb_typeof(p->'operationLimits') <> 'object'
    or not (p->'operationLimits') ?& array['active_discovery','historical_discovery','vin_history','enrichment','vehicle_terms']
    or (p->'operationLimits') - array['active_discovery','historical_discovery','vin_history','enrichment','vehicle_terms'] <> '{}'::jsonb
    or jsonb_typeof(p->'optimizationTarget') <> 'array' or jsonb_array_length(p->'optimizationTarget') <> 2 then
    raise exception 'market request policy is invalid' using errcode = '22023';
  end if;
  foreach k in array array['active_discovery','historical_discovery','vin_history','enrichment','vehicle_terms'] loop
    if jsonb_typeof(p->'operationLimits'->k) <> 'number'
      or coalesce(p->'operationLimits'->>k,'') !~ '^[0-9]{1,10}$'
      or (p->'operationLimits'->>k)::bigint > 2147483647 then
      raise exception 'market endpoint allowance is invalid' using errcode = '22023';
    end if;
  end loop;
  if not a ?& array['monthlyAllowance','metered','requestsPerWindow','rateWindowSeconds','periodStart','periodEnd','priorMonthlyAttempts','reserveBasisPoints']
    or a - array['monthlyAllowance','metered','requestsPerWindow','rateWindowSeconds','periodStart','periodEnd','priorMonthlyAttempts','reserveBasisPoints'] <> '{}'::jsonb
    or jsonb_typeof(a->'metered') <> 'boolean'
    or a->'reserveBasisPoints' is distinct from p->'monthlyReserveBasisPoints' then
    raise exception 'market account limits are invalid' using errcode = '22023';
  end if;
  foreach k in array array['monthlyAllowance','requestsPerWindow','rateWindowSeconds','priorMonthlyAttempts'] loop
    if a->k <> 'null'::jsonb and (jsonb_typeof(a->k) <> 'number'
      or coalesce(a->>k,'') !~ '^[0-9]{1,10}$' or (a->>k)::bigint > 2147483647
      or ((a->>k)::bigint < 1 and k <> 'priorMonthlyAttempts')) then
      raise exception 'market account limits are invalid' using errcode = '22023';
    end if;
  end loop;
  foreach k in array array['periodStart','periodEnd'] loop
    if a->k <> 'null'::jsonb and (jsonb_typeof(a->k) <> 'string'
      or coalesce(a->>k,'') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then
      raise exception 'market quota period is invalid' using errcode = '22023';
    end if;
    perform (a->>k)::timestamptz;
  end loop;
  if a->>'periodStart' is not null and a->>'periodEnd' is not null
    and (a->>'periodStart')::timestamptz >= (a->>'periodEnd')::timestamptz then
    raise exception 'market quota period is invalid' using errcode = '22023';
  end if;
  if requested_operation = 'reserve' then
    if requested ? 'executionFence' and (
      jsonb_typeof(requested->'executionFence') is distinct from 'object'
      or not (requested->'executionFence') ?& array['jobId','processingToken']
      or (requested->'executionFence') - array['jobId','processingToken'] <> '{}'::jsonb
      or coalesce(requested->'executionFence'->>'jobId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(requested->'executionFence'->>'processingToken','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'market execution lease is invalid' using errcode = '22023';
    end if;
    if coalesce(requested->>'reservationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(requested->>'endpoint','') not in ('active_inventory','historical_inventory','vin_history','vehicle_terms')
      or coalesce(requested->>'phase','') not in ('baseline','supporting','enrichment')
      or (requested->>'vinKey' is not null and requested->>'vinKey' !~ '^[0-9a-f]{64}$')
      or (requested->>'endpoint' = 'vin_history' and requested->>'vinKey' is null)
      or (requested->>'estimatedCostMicros' is not null and
        (coalesce(requested->>'estimatedCostMicros','') !~ '^[0-9]{1,13}$'
        or (requested->>'estimatedCostMicros')::bigint > 1000000000000)) then
      raise exception 'market reservation is invalid' using errcode = '22023';
    end if;
  elsif requested_operation = 'state' then
    if jsonb_typeof(requested->'quotaExhausted') <> 'boolean'
      or (requested->>'retryAfterSeconds' is not null and
        (jsonb_typeof(requested->'retryAfterSeconds') <> 'number'
          or (requested->>'retryAfterSeconds')::numeric < 0)) then
      raise exception 'market account state is invalid' using errcode = '22023';
    end if;
  elsif requested_operation <> 'read' then
    raise exception 'market accounting operation is invalid' using errcode = '22023';
  end if;
end;
$$;

create function public.market_request_usage_internal(requested jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  p jsonb;
  a jsonb;
  case_total integer;
  priced_total integer;
  priced_micros numeric;
  monthly_total bigint;
  monthly_limit bigint;
  rate_total integer;
  support_discovery integer;
  phases jsonb;
  endpoints jsonb;
  operations jsonb;
  accounting_time timestamptz := clock_timestamp();
begin
  select c.policy into p from public.market_request_cases c
    where c.account_key = requested->>'accountKey' and c.case_id = (requested->>'caseId')::uuid;
  p := coalesce(p, requested->'policy');
  select ac.configuration into a from public.market_request_accounts ac where ac.account_key = requested->>'accountKey';
  a := coalesce(a, requested->'accountLimits');
  select count(*)::integer, count(r.estimated_cost_micros)::integer, coalesce(sum(r.estimated_cost_micros),0),
    count(*) filter (where r.phase='supporting' and r.operation in ('active_discovery','historical_discovery'))::integer
    into case_total, priced_total, priced_micros, support_discovery
    from public.market_request_attempts r
    where r.account_key = requested->>'accountKey' and r.case_id = (requested->>'caseId')::uuid;
  select jsonb_object_agg(x.key, (select count(*) from public.market_request_attempts r
      where r.account_key=requested->>'accountKey' and r.case_id=(requested->>'caseId')::uuid and r.phase=x.key))
    into phases from unnest(array['baseline','supporting','enrichment']) x(key);
  select jsonb_object_agg(x.key, (select count(*) from public.market_request_attempts r
      where r.account_key=requested->>'accountKey' and r.case_id=(requested->>'caseId')::uuid and r.endpoint=x.key))
    into endpoints from unnest(array['active_inventory','historical_inventory','vin_history','vehicle_terms']) x(key);
  select jsonb_object_agg(x.key, (select count(*) from public.market_request_attempts r
      where r.account_key=requested->>'accountKey' and r.case_id=(requested->>'caseId')::uuid and r.operation=x.key))
    into operations from unnest(array['active_discovery','historical_discovery','vin_history','enrichment','vehicle_terms']) x(key);
  select count(*) + coalesce((a->>'priorMonthlyAttempts')::bigint,0) into monthly_total
    from public.market_request_attempts r where r.account_key=requested->>'accountKey'
      and r.reserved_at >= (a->>'periodStart')::timestamptz and r.reserved_at < (a->>'periodEnd')::timestamptz;
  monthly_limit := ((a->>'monthlyAllowance')::bigint * (10000-(a->>'reserveBasisPoints')::integer)) / 10000;
  select count(*)::integer into rate_total from public.market_request_attempts r
    where r.account_key=requested->>'accountKey'
      and r.reserved_at > accounting_time - make_interval(secs=>coalesce((a->>'rateWindowSeconds')::integer,0));
  return jsonb_build_object('schemaVersion','1','totalAttempts',case_total,
    'remainingAttempts',greatest(0,(p->>'totalAttempts')::integer-case_total),
    'phaseAttempts',phases,'endpointAttempts',endpoints,'operationAttempts',operations,
    'supportingDiscoveryAttempts',support_discovery,'monthlyAttempts',monthly_total,'monthlyRoutineLimit',monthly_limit,
    'monthlyRemainingRoutineAttempts',case when monthly_limit is null then null else greatest(0,monthly_limit-monthly_total) end,
    'rateWindowAttempts',rate_total,
    'estimatedBillableUsd',case when priced_total=case_total then to_char(priced_micros/1000000,'FM999999999999999990.000000') else null end,
    'estimatedPricedAttemptsUsd',to_char(priced_micros/1000000,'FM999999999999999990.000000'),
    'pricedAttempts',priced_total,'unpricedAttempts',case_total-priced_total,'policy',p);
end;
$$;

create function public.get_market_request_usage(requested jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.validate_market_request_internal(requested,'read');
  return public.market_request_usage_internal(requested);
end;
$$;

create function public.reserve_market_request_attempt(requested jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a jsonb := requested->'accountLimits';
  p jsonb := requested->'policy';
  account_row public.market_request_accounts%rowtype;
  saved_policy jsonb;
  saved_case_account text;
  usage jsonb;
  op text;
  reason text;
  delay double precision;
  accounting_time timestamptz := clock_timestamp();
  vin_attempts integer;
  oldest_request timestamptz;
  execution_job public.total_loss_analysis_jobs%rowtype;
begin
  perform public.validate_market_request_internal(requested,'reserve');
  if requested ? 'executionFence' then
    -- The existing job lease also fences work when checkpoint retention is off.
    select * into execution_job from public.total_loss_analysis_jobs j
      where j.id=(requested->'executionFence'->>'jobId')::uuid
        and j.case_id=(requested->>'caseId')::uuid for update;
    if not found or execution_job.processing_token is distinct from (requested->'executionFence'->>'processingToken')::uuid
      or execution_job.status <> 'processing' or execution_job.processing_expires_at is null
      or execution_job.processing_expires_at <= clock_timestamp() then
      return jsonb_build_object('allowed',false,'reasonCode','MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE',
        'retryAfterSeconds',null,'usage',public.market_request_usage_internal(requested));
    end if;
  end if;
  if a->>'requestsPerWindow' is null or a->>'rateWindowSeconds' is null then
    reason := 'MARKET_ACCOUNT_RATE_LIMIT_UNCONFIGURED';
  elsif a->>'monthlyAllowance' is null then
    reason := 'MARKET_ACCOUNT_MONTHLY_ALLOWANCE_UNCONFIGURED';
  elsif a->>'monthlyAllowance' is not null and (a->>'periodStart' is null or a->>'periodEnd' is null) then
    reason := 'MARKET_ACCOUNT_QUOTA_PERIOD_UNCONFIGURED';
  elsif a->>'monthlyAllowance' is not null and a->>'priorMonthlyAttempts' is null then
    reason := 'MARKET_ACCOUNT_PRIOR_USAGE_UNCONFIGURED';
  elsif a->>'monthlyAllowance' is not null and not
    ((a->>'periodStart')::timestamptz <= accounting_time and accounting_time < (a->>'periodEnd')::timestamptz) then
    reason := 'MARKET_ACCOUNT_QUOTA_PERIOD_INACTIVE';
  end if;
  if reason is not null then
    return jsonb_build_object('allowed',false,'reasonCode',reason,'retryAfterSeconds',null,'usage',public.market_request_usage_internal(requested));
  end if;

  insert into public.market_request_accounts(account_key,configuration)
    values(requested->>'accountKey',a) on conflict (account_key) do nothing;
  select ac.* into account_row from public.market_request_accounts ac
    where ac.account_key=requested->>'accountKey' for update;
  accounting_time := clock_timestamp();
  if requested ? 'executionFence' and (execution_job.processing_expires_at <= accounting_time
    or not exists(select 1 from public.total_loss_case_details d
      join public.appraisal_cases c on c.id=d.case_id
      where d.case_id=execution_job.case_id and c.status='checking'
        and d.intake_mode is not distinct from execution_job.source_intake_mode
        and d.analysis_input_revision is not distinct from execution_job.source_analysis_input_revision
        and d.analysis_input_id is not distinct from execution_job.source_analysis_input_id
        and (d.intake_mode='manual' or d.report_last_upload_id is not distinct from execution_job.source_report_upload_id))) then
    return jsonb_build_object('allowed',false,'reasonCode','MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE',
      'retryAfterSeconds',null,'usage',public.market_request_usage_internal(requested));
  end if;
  if a->>'monthlyAllowance' is not null and not
    ((a->>'periodStart')::timestamptz <= accounting_time and accounting_time < (a->>'periodEnd')::timestamptz) then
    return jsonb_build_object('allowed',false,'reasonCode','MARKET_ACCOUNT_QUOTA_PERIOD_INACTIVE',
      'retryAfterSeconds',null,'usage',public.market_request_usage_internal(requested));
  end if;
  -- Every worker sharing an account locks this row before any allowance check.
  -- A new case, process restart, or new input revision cannot reset its usage.
  if account_row.configuration <> a then
    if ((account_row.configuration-'priorMonthlyAttempts')=(a-'priorMonthlyAttempts')
      and account_row.configuration->>'priorMonthlyAttempts' is not null and a->>'priorMonthlyAttempts' is not null
      and (a->>'priorMonthlyAttempts')::bigint >= (account_row.configuration->>'priorMonthlyAttempts')::bigint)
      or (account_row.configuration->>'periodEnd' is not null and a->>'periodStart' is not null
      and (account_row.configuration->>'periodEnd')::timestamptz <= accounting_time
      and (a->>'periodStart')::timestamptz >= (account_row.configuration->>'periodEnd')::timestamptz) then
      update public.market_request_accounts set configuration=a,updated_at=accounting_time
        where account_key=requested->>'accountKey';
    else
      reason := 'MARKET_ACCOUNT_CONFIGURATION_CHANGED';
    end if;
  end if;
  if reason is null then
    insert into public.market_request_cases(account_key,case_id,policy)
      values(requested->>'accountKey',(requested->>'caseId')::uuid,p) on conflict (case_id) do nothing;
    select c.policy,c.account_key into saved_policy,saved_case_account from public.market_request_cases c
      where c.case_id=(requested->>'caseId')::uuid;
    if saved_case_account <> requested->>'accountKey' then reason := 'MARKET_CASE_ACCOUNT_CHANGED';
    elsif saved_policy <> p then reason := 'MARKET_CASE_POLICY_CHANGED'; end if;
  end if;
  if reason is null and account_row.quota_exhausted_at is not null
    and (a->>'periodStart' is null or account_row.quota_exhausted_at >= (a->>'periodStart')::timestamptz) then
    reason := 'MARKET_ACCOUNT_QUOTA_EXHAUSTED';
  end if;
  if reason is null and account_row.blocked_until > accounting_time then
    reason := 'MARKET_ACCOUNT_THROTTLED';
    delay := extract(epoch from account_row.blocked_until-accounting_time);
  end if;
  if reason is null and exists(select 1 from public.market_request_attempts r where r.reservation_id=(requested->>'reservationId')::uuid) then
    reason := 'MARKET_ATTEMPT_ALREADY_RESERVED';
  end if;
  usage := public.market_request_usage_internal(requested);
  op := case requested->>'endpoint'
    when 'active_inventory' then case when requested->>'vinKey' is not null or requested->>'phase'='enrichment'
      then 'enrichment' else 'active_discovery' end
    when 'historical_inventory' then 'historical_discovery'
    else requested->>'endpoint' end;
  if reason is null and (usage->>'remainingAttempts')::integer=0 then reason := 'MARKET_CASE_BUDGET_EXHAUSTED'; end if;
  if reason is null and (usage->'operationAttempts'->>op)::integer >= (p->'operationLimits'->>op)::integer then
    reason := 'MARKET_ENDPOINT_BUDGET_EXHAUSTED';
  end if;
  if reason is null and requested->>'phase'='supporting' then
    if (usage->'phaseAttempts'->>'supporting')::integer >= (p->>'supportingAttempts')::integer then
      reason := 'MARKET_SUPPORTING_BUDGET_EXHAUSTED';
    elsif op in ('active_discovery','historical_discovery')
      and (usage->>'supportingDiscoveryAttempts')::integer >= (p->>'supportingDiscoveryAttempts')::integer then
      reason := 'MARKET_SUPPORTING_DISCOVERY_BUDGET_EXHAUSTED';
    end if;
  end if;
  if reason is null and requested->>'endpoint'='vin_history' then
    select count(*)::integer into vin_attempts from public.market_request_attempts r
      where r.account_key=requested->>'accountKey' and r.case_id=(requested->>'caseId')::uuid
        and r.endpoint='vin_history' and r.vin_key=requested->>'vinKey';
    if vin_attempts >= (p->>'perVinHistoryAttempts')::integer then reason := 'MARKET_VIN_HISTORY_BUDGET_EXHAUSTED'; end if;
  end if;
  if reason is null and usage->>'monthlyRoutineLimit' is not null
    and (usage->>'monthlyAttempts')::bigint >= (usage->>'monthlyRoutineLimit')::bigint then reason := 'MARKET_MONTHLY_RESERVE_REACHED'; end if;
  if reason is null and (usage->>'rateWindowAttempts')::integer >= (a->>'requestsPerWindow')::integer then
    reason := 'MARKET_ACCOUNT_RATE_LIMIT_REACHED';
    select min(r.reserved_at) into oldest_request from public.market_request_attempts r
      where r.account_key=requested->>'accountKey'
        and r.reserved_at > accounting_time-make_interval(secs=>(a->>'rateWindowSeconds')::integer);
    delay := greatest(0,extract(epoch from oldest_request+make_interval(secs=>(a->>'rateWindowSeconds')::integer)-accounting_time));
  end if;
  if reason is not null then
    return jsonb_build_object('allowed',false,'reasonCode',reason,'retryAfterSeconds',delay,'usage',usage);
  end if;
  insert into public.market_request_attempts(reservation_id,account_key,case_id,endpoint,phase,operation,vin_key,estimated_cost_micros,reserved_at)
    values((requested->>'reservationId')::uuid,requested->>'accountKey',(requested->>'caseId')::uuid,
      requested->>'endpoint',requested->>'phase',op,requested->>'vinKey',(requested->>'estimatedCostMicros')::bigint,accounting_time);
  return jsonb_build_object('allowed',true,'reservationId',requested->>'reservationId','reasonCode','MARKET_REQUEST_RESERVED',
    'usage',public.market_request_usage_internal(requested));
end;
$$;

create function public.record_market_request_account_state(requested jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare accounting_time timestamptz := clock_timestamp();
begin
  perform public.validate_market_request_internal(requested,'state');
  insert into public.market_request_accounts(account_key,configuration)
    values(requested->>'accountKey',requested->'accountLimits') on conflict (account_key) do nothing;
  perform 1 from public.market_request_accounts a where a.account_key=requested->>'accountKey' for update;
  update public.market_request_accounts set
    blocked_until=case when requested->>'retryAfterSeconds' is null then blocked_until
      else greatest(blocked_until,accounting_time+make_interval(secs=>(requested->>'retryAfterSeconds')::double precision)) end,
    quota_exhausted_at=case when (requested->>'quotaExhausted')::boolean then accounting_time else quota_exhausted_at end,
    updated_at=accounting_time where account_key=requested->>'accountKey';
  return jsonb_build_object('recorded',true);
end;
$$;

revoke all on function public.validate_market_request_internal(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.market_request_usage_internal(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.reserve_market_request_attempt(jsonb) from public,anon,authenticated;
revoke all on function public.get_market_request_usage(jsonb) from public,anon,authenticated;
revoke all on function public.record_market_request_account_state(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_market_request_attempt(jsonb) to service_role;
grant execute on function public.get_market_request_usage(jsonb) to service_role;
grant execute on function public.record_market_request_account_state(jsonb) to service_role;

comment on table public.market_request_attempts is
  'Cumulative physical request reservations, including failures and retries. Contains no provider payload, API key, raw VIN, or market evidence.';
comment on function public.reserve_market_request_attempt(jsonb) is
  'Atomic account, rate-window, monthly-reserve, case, optional-pass, endpoint and VIN allowance enforcement. Configuration is pinned; nonoverlapping verified quota periods may advance.';
