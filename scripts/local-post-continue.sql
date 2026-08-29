-- Installed only by the guarded local development harness; never a migration.
-- Empty canonical price statistics have no display value. Project them as absent.
create or replace function public.total_loss_customer_stat_money_projection_internal(
  value jsonb, fallback_currency text
) returns jsonb language sql immutable set search_path = '' as $$
  select case when $1 is null or jsonb_typeof($1) <> 'object'
    or $1->>'cents' is null then null::jsonb
    else jsonb_build_object('amountMinorUnits', $1->'cents',
      'currency', $2, 'formatted', $1->>'display') end;
$$;
create schema if not exists local_claim_testing;
revoke all on schema local_claim_testing from public, anon, authenticated;
create table if not exists local_claim_testing.cases (
  case_id uuid primary key references public.appraisal_cases(id),
  mode text not null check (mode in ('supportable', 'no-dispute', 'exception')),
  created_at timestamptz not null default now()
);

create or replace function public.local_post_continue_context(
  requested_case_id uuid, requested_user_id uuid
) returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('artifact', run.artifact,
    'initialized', exists(select 1 from public.total_loss_claim_workflows w
      where w.case_id = c.id))
  from public.appraisal_cases c
  join public.total_loss_case_operations_internal o on o.case_id = c.id
  left join public.analysis_runs run on run.id = o.analysis_run_id
  where c.id = requested_case_id and c.user_id = requested_user_id
    and c.service_type = 'total_loss';
$$;

create or replace function public.local_initialize_post_continue(
  requested_case_id uuid, requested_user_id uuid, expected_run_id uuid,
  frozen_presentation jsonb, frozen_digest text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  operation record;
  run public.analysis_runs%rowtype;
  snapshot_id uuid;
begin
  -- The case lock serializes tabs and also coordinates identity transfer.
  perform 1 from public.appraisal_cases c
    where c.id = requested_case_id and c.user_id = requested_user_id
      and c.service_type = 'total_loss' for update;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.total_loss_claim_workflows w
    where w.case_id = requested_case_id) then return 'existing'; end if;
  perform 1 from public.total_loss_case_details d
    where d.case_id = requested_case_id for update;
  select * into operation from public.total_loss_case_operations_internal o
    where o.case_id = requested_case_id;
  if operation.case_stage is distinct from 'analysis_complete'
    or operation.analysis_run_id is distinct from expected_run_id
    or operation.analysis_classification not in
      ('MATERIAL_UNDERVALUE_SIGNAL', 'POTENTIAL_UNDERVALUE')
    or operation.analysis_classification is null
  then return 'ineligible'; end if;
  select * into strict run from public.analysis_runs where id = expected_run_id;
  if frozen_presentation->>'runId' is distinct from expected_run_id::text
    or frozen_presentation #>> '{assessment,classification}'
      is distinct from operation.analysis_classification
  then return 'ineligible'; end if;
  insert into public.total_loss_preliminary_snapshots (
    case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
    source_intake_mode, source_report_upload_id, source_analysis_input_revision,
    source_analysis_input_id, preliminary_classification,
    insurer_valuation_minor_units, supported_range_low_minor_units,
    supported_range_median_minor_units, supported_range_high_minor_units,
    currency, analysis_run_schema_version, analysis_version,
    discrepancy_analysis_version, comparable_scoring_version,
    presentation_schema_version, snapshot_schema_version,
    source_references, snapshot, snapshot_digest
  ) values (
    requested_case_id, operation.analysis_job_id, expected_run_id, requested_user_id,
    operation.intake_mode, case when operation.intake_mode = 'report'
      then operation.report_last_upload_id end, operation.analysis_input_revision,
    operation.analysis_input_id, operation.analysis_classification,
    (frozen_presentation #>> '{insurerValuation,value,cents}')::bigint,
    (frozen_presentation #>> '{primaryExternalEvidence,prices,minimumPrice,cents}')::bigint,
    (frozen_presentation #>> '{primaryExternalEvidence,prices,medianPrice,cents}')::bigint,
    (frozen_presentation #>> '{primaryExternalEvidence,prices,maximumPrice,cents}')::bigint,
    'USD', run.analysis_run_schema_version, run.analysis_version,
    run.discrepancy_analysis_version, run.comparable_scoring_version,
    frozen_presentation->>'presentationVersion', '1',
    jsonb_build_object('analysisRunId', expected_run_id, 'analysisJobId', operation.analysis_job_id),
    jsonb_build_object('schemaVersion', '1', 'presentation', frozen_presentation), frozen_digest
  ) on conflict (case_id, analysis_run_id) do nothing returning id into snapshot_id;
  if snapshot_id is null then
    select id into strict snapshot_id from public.total_loss_preliminary_snapshots
      where case_id = requested_case_id and analysis_run_id = expected_run_id;
  end if;
  insert into public.total_loss_claim_workflows
    (case_id, preliminary_snapshot_id, phase, current_task)
    values(requested_case_id, snapshot_id, 'review', 'secure_claim');
  return 'created';
end;
$$;
revoke all on function public.local_post_continue_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.local_post_continue_context(uuid, uuid) to service_role;
revoke all on function public.local_initialize_post_continue(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.local_initialize_post_continue(uuid, uuid, uuid, jsonb, text) to service_role;
notify pgrst, 'reload schema';
