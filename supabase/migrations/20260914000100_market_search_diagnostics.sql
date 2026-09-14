-- Aggregate diagnostics do not grant permission to retain provider evidence.
create function public.market_search_summary_is_valid(summary jsonb)
returns boolean language plpgsql immutable strict security invoker set search_path = '' as $$
declare
  name text;
  group_name text;
  allowed text[];
  total integer;
begin
  if jsonb_typeof(summary) <> 'object' then return false; end if;
  if octet_length(summary::text) > 4096
    or (select array_agg(key order by key) from jsonb_object_keys(summary) key) is distinct from
      (select array_agg(key order by key) from unnest(array['version','kind','stream','purpose','centerId','pageStart',
        'requestedRows','returnedRows','parseableObservations','recordedObservations','distinctIdentities','newIdentities',
        'duplicateObservations','unidentifiedObservations','screenedCandidates','baselineCandidates','requestAttemptsConsumed','rejectedByCategory',
        'tierCounts','historyVerificationNecessary','scoringCompleted','stopReason']) key)
    or summary->>'version' <> '1' or summary->>'kind' <> 'discovery'
    or summary->>'stream' not in ('current','historical') or summary->>'purpose' not in ('baseline','supporting')
    or (summary->>'centerId' not in ('customer','alternate') and summary->>'centerId' !~ '^cbsa:[0-9]{5}$')
    or jsonb_typeof(summary->'historyVerificationNecessary') <> 'boolean'
    or jsonb_typeof(summary->'scoringCompleted') <> 'boolean'
    or summary->>'stopReason' not in ('CONTINUE','EXHAUSTED','UNPRODUCTIVE','DUPLICATE_HEAVY','BUDGET_OR_QUOTA_LIMITED',
      'PROVIDER_FAILURE','OBSERVATION_LIMIT','SUFFICIENT_STRONG_EVIDENCE','GEOGRAPHIC_SCOPE_LIMITED',
      'CUSTOMER_LOCATION_UNAVAILABLE','HISTORICAL_BASELINE_SUFFICIENT_CURRENT_CONTEXT_ONLY','INTERRUPTED')
  then return false; end if;
  foreach name in array array['version','kind','stream','purpose','centerId','stopReason'] loop
    if jsonb_typeof(summary->name) <> 'string' then return false; end if;
  end loop;
  foreach name in array array['pageStart','requestedRows','returnedRows','parseableObservations','recordedObservations',
    'distinctIdentities','newIdentities','duplicateObservations','unidentifiedObservations','screenedCandidates','baselineCandidates','requestAttemptsConsumed'] loop
    if jsonb_typeof(summary->name) <> 'number' or summary->>name !~ '^(0|[1-9][0-9]{0,6})$'
      or (summary->>name)::integer > 1000000 then return false; end if;
  end loop;
  if (summary->>'pageStart')::integer >= 10000 or (summary->>'requestedRows')::integer not between 1 and 50
    or (summary->>'returnedRows')::integer > (summary->>'requestedRows')::integer
    or (summary->>'parseableObservations')::integer > (summary->>'returnedRows')::integer
    or (summary->>'recordedObservations')::integer > (summary->>'parseableObservations')::integer
    or (summary->>'newIdentities')::integer + (summary->>'duplicateObservations')::integer + (summary->>'unidentifiedObservations')::integer <> (summary->>'recordedObservations')::integer
  then return false; end if;
  foreach name in array array['distinctIdentities','screenedCandidates','baselineCandidates'] loop
    if (summary->>name)::integer > (summary->>'recordedObservations')::integer then return false; end if;
  end loop;
  foreach group_name in array array['tierCounts','rejectedByCategory'] loop
    allowed := case when group_name='tierCounts' then array['STRONG','GOOD','WEAK','INELIGIBLE']
      else array['IDENTITY','CONFIGURATION','MILEAGE','DISTANCE','TEMPORAL','CONFLICT','QUALITY','OTHER'] end;
    if jsonb_typeof(summary->group_name) <> 'object' then return false; end if;
    if (select array_agg(key order by key) from jsonb_object_keys(summary->group_name) key) is distinct from
         (select array_agg(key order by key) from unnest(allowed) key)
    then return false; end if;
    total := 0;
    foreach name in array allowed loop
      if jsonb_typeof(summary->group_name->name) <> 'number' or summary->group_name->>name !~ '^(0|[1-9][0-9]{0,2})$'
        or (summary->group_name->>name)::integer > (summary->>'recordedObservations')::integer then return false; end if;
      total := total + (summary->group_name->>name)::integer;
    end loop;
    if group_name='tierCounts' and total <> (summary->>'recordedObservations')::integer then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.market_search_summary_is_valid(jsonb) from public, anon, authenticated;
grant execute on function public.market_search_summary_is_valid(jsonb) to service_role;

alter table public.total_loss_market_search_journal add column summary jsonb
  check (summary is null or public.market_search_summary_is_valid(summary));
comment on column public.total_loss_market_search_journal.summary is
  'Bounded operational counts and stage identifiers only; no provider records, listing identities, prices, dealer data, or authorization to reconstruct evidence.';

create function public.record_case_market_search_summary(
  requested_case_id uuid, requested_job_id uuid, requested_processing_token uuid,
  requested_input_digest text, requested_execution_id uuid, requested_event_index integer,
  requested_operation_digest text, requested_summary jsonb
) returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '500ms' as $$
begin
  if requested_summary is null or not public.market_search_summary_is_valid(requested_summary)
    or requested_event_index is null or requested_event_index not between 0 and 199
    or requested_operation_digest is null or requested_operation_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Invalid market search summary' using errcode='22023'; end if;
  -- Reuse the exact case, current input, lease, and token check under its job lock.
  perform public.access_case_market_search_journal(requested_case_id,requested_job_id,requested_processing_token,
    requested_input_digest,'read',requested_execution_id);
  update public.total_loss_market_search_journal set summary=requested_summary
    where case_id=requested_case_id and input_digest=requested_input_digest and event_index=requested_event_index
      and operation_digest=requested_operation_digest and execution_id=requested_execution_id
      and processing_token=requested_processing_token and status='completed'
      and attempts_after=(requested_summary->>'requestAttemptsConsumed')::integer;
  if not found then raise exception 'Market search summary operation is unavailable' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function public.record_case_market_search_summary(uuid,uuid,uuid,text,uuid,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_case_market_search_summary(uuid,uuid,uuid,text,uuid,integer,text,jsonb) to service_role;
