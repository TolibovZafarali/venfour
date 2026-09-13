-- Keep quota coordination atomic while bounding waits on busy worker/account rows.
-- Existing account/time and account/case indexes cover these predicates.
-- Aggregate case usage once rather than rescanning for each category.
create or replace function public.market_request_usage_internal(requested jsonb)
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
    count(*) filter (where r.phase='supporting' and r.operation in ('active_discovery','historical_discovery'))::integer,
    jsonb_build_object('baseline',count(*) filter (where r.phase='baseline'),
      'supporting',count(*) filter (where r.phase='supporting'),
      'enrichment',count(*) filter (where r.phase='enrichment')),
    jsonb_build_object('active_inventory',count(*) filter (where r.endpoint='active_inventory'),
      'historical_inventory',count(*) filter (where r.endpoint='historical_inventory'),
      'vin_history',count(*) filter (where r.endpoint='vin_history'),
      'vehicle_terms',count(*) filter (where r.endpoint='vehicle_terms')),
    jsonb_build_object('active_discovery',count(*) filter (where r.operation='active_discovery'),
      'historical_discovery',count(*) filter (where r.operation='historical_discovery'),
      'vin_history',count(*) filter (where r.operation='vin_history'),
      'enrichment',count(*) filter (where r.operation='enrichment'),
      'vehicle_terms',count(*) filter (where r.operation='vehicle_terms'))
    into case_total, priced_total, priced_micros, support_discovery, phases, endpoints, operations
    from public.market_request_attempts r
    where r.account_key = requested->>'accountKey' and r.case_id = (requested->>'caseId')::uuid;
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


alter function public.reserve_market_request_attempt(jsonb) set lock_timeout = '500ms';
alter function public.record_market_request_account_state(jsonb) set lock_timeout = '500ms';

-- This journal contains execution metadata only: no listings, VINs, prices,
-- locations, provider payloads, or authorization to retain provider evidence.
create table public.total_loss_market_search_journal (
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  event_index integer not null check (event_index between 0 and 199),
  operation_digest text not null check (operation_digest ~ '^[0-9a-f]{64}$'),
  execution_id uuid not null,
  processing_token uuid not null,
  requires_reconciliation boolean not null default false,
  status text not null check (status in ('started','completed')),
  attempts_before integer not null check (attempts_before >= 0),
  attempts_after integer check (attempts_after >= attempts_before),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key(case_id,input_digest,event_index),
  check ((status='started' and attempts_after is null and completed_at is null)
    or (status='completed' and attempts_after is not null and completed_at is not null))
);
alter table public.total_loss_market_search_journal enable row level security;
revoke all on public.total_loss_market_search_journal from public,anon,authenticated,service_role;

create function public.access_case_market_search_journal(
  requested_case_id uuid, requested_job_id uuid, requested_processing_token uuid,
  requested_input_digest text, requested_action text, requested_execution_id uuid,
  requested_event_index integer default null, requested_operation_digest text default null
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '500ms' as $$
declare
  job public.total_loss_analysis_jobs%rowtype;
  total integer;
  saved public.total_loss_market_search_journal%rowtype;
begin
  if requested_input_digest is null or requested_input_digest !~ '^[0-9a-f]{64}$'
    or requested_action is null or requested_action not in ('read','begin','resume','complete','halt') or requested_execution_id is null
    or (requested_action='read' and (requested_event_index is not null or requested_operation_digest is not null))
    or (requested_action<>'read' and (requested_event_index is null or requested_event_index not between 0 and 199
      or requested_operation_digest is null or requested_operation_digest !~ '^[0-9a-f]{64}$')) then
    raise exception 'Invalid market search journal operation' using errcode='22023';
  end if;
  select * into job from public.total_loss_analysis_jobs j
    where j.id = requested_job_id and j.case_id = requested_case_id for update;
  if not found or job.processing_token is distinct from requested_processing_token
    or job.status <> 'processing' or job.processing_expires_at is null
    or job.processing_expires_at <= clock_timestamp()
    or not exists(select 1 from public.total_loss_case_details d
      join public.appraisal_cases c on c.id=d.case_id
      where d.case_id=job.case_id and c.status='checking'
        and d.intake_mode is not distinct from job.source_intake_mode
        and d.analysis_input_revision is not distinct from job.source_analysis_input_revision
        and d.analysis_input_id is not distinct from job.source_analysis_input_id
        and (d.intake_mode='manual' or d.report_last_upload_id is not distinct from job.source_report_upload_id)) then
    raise exception 'Market search processing lease is unavailable' using errcode = '42501';
  end if;

  select count(*)::integer into total from public.market_request_attempts where case_id=requested_case_id
    and account_key=(select account_key from public.market_request_cases where case_id=requested_case_id);
  if requested_action<>'read' then
    select * into saved from public.total_loss_market_search_journal
      where case_id=requested_case_id and input_digest=requested_input_digest and event_index=requested_event_index;
    if found and saved.operation_digest is distinct from requested_operation_digest then
      raise exception 'Market search operation changed' using errcode='22023';
    end if;
    if found and (saved.requires_reconciliation or (saved.processing_token=requested_processing_token and saved.execution_id<>requested_execution_id)) then
      raise exception 'Market search operation already has an executor' using errcode='55000';
    end if;
    if requested_action in ('begin','resume') then
      if requested_action='resume' and (not found or not exists (
        select 1 from public.total_loss_market_search_progress e
        where e.case_id=requested_case_id and e.input_digest=requested_input_digest and e.expires_at>clock_timestamp()
          and e.checkpoint->'events'->requested_event_index->'payload'->>'failure' is not null
          and (e.checkpoint->'events'->requested_event_index->'usageAfter'->>'totalAttempts')::integer=total
      )) then
        raise exception 'Market search evidence recovery is required' using errcode='55000';
      end if;
      if found and requested_action<>'resume' and (saved.status='completed' or total>saved.attempts_before) then
        raise exception 'Market search evidence recovery is required' using errcode='55000';
      end if;
      insert into public.total_loss_market_search_journal
        (case_id,input_digest,event_index,operation_digest,status,attempts_before,execution_id,processing_token)
        values(requested_case_id,requested_input_digest,requested_event_index,requested_operation_digest,'started',total,requested_execution_id,requested_processing_token)
        on conflict(case_id,input_digest,event_index) do update
          set execution_id=excluded.execution_id,processing_token=excluded.processing_token,
              status='started',attempts_before=excluded.attempts_before,attempts_after=null,completed_at=null;
    else
      if not found or saved.execution_id<>requested_execution_id or saved.processing_token<>requested_processing_token then
        raise exception 'Market search operation was not started' using errcode='22023';
      end if;
      update public.total_loss_market_search_journal set status='completed',attempts_after=total,completed_at=clock_timestamp(),
          requires_reconciliation=(requested_action='halt')
        where case_id=requested_case_id and input_digest=requested_input_digest and event_index=requested_event_index
          and status='started';
    end if;
  end if;
  return jsonb_build_object('totalAttempts',total,'events',coalesce((
    select jsonb_agg(jsonb_build_object('index',event_index,'operationDigest',operation_digest,
      'status',status,'requiresReconciliation',requires_reconciliation,'attemptsBefore',attempts_before,'attemptsAfter',attempts_after) order by event_index)
    from public.total_loss_market_search_journal where case_id=requested_case_id and input_digest=requested_input_digest
  ),'[]'::jsonb),'knownAttempts',coalesce((select max(coalesce(attempts_after,attempts_before))
    from public.total_loss_market_search_journal where case_id=requested_case_id),0));
end $$;
revoke all on function public.access_case_market_search_journal(uuid,uuid,uuid,text,text,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.access_case_market_search_journal(uuid,uuid,uuid,text,text,uuid,integer,text) to service_role;
