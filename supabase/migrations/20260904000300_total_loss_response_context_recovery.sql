-- Restore owner-requested retry only for the legacy report vehicle-context defect.
-- The failed attempt and its immutable response remain authoritative history.
create or replace function public.total_loss_legacy_response_context_retry_eligible(
  requested_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row record;
begin
  select job.case_id, job.source_report_version_id, workflow.preliminary_snapshot_id
  into source_row
  from public.total_loss_insurer_response_analysis_jobs as job
  join public.total_loss_insurer_response_analysis_runs as run
    on run.id = job.current_run_id
    and run.job_id = job.id
    and run.case_id = job.case_id
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = job.case_id
    and workflow.current_response_analysis_job_id = job.id
    and workflow.current_report_version_id = job.source_report_version_id
    and workflow.current_negotiation_round_id = job.negotiation_round_id
  join public.total_loss_preliminary_snapshots as preliminary
    on preliminary.id = workflow.preliminary_snapshot_id
    and preliminary.case_id = job.case_id
    and preliminary.source_intake_mode = 'report'
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = job.case_id
  join public.total_loss_case_details as legacy_details
    on legacy_details.case_id = job.case_id
  join public.total_loss_negotiation_rounds as negotiation_round
    on negotiation_round.id = job.negotiation_round_id
    and negotiation_round.case_id = job.case_id
    and negotiation_round.status = 'response_received'
  join public.total_loss_communications as response
    on response.id = job.response_communication_id
    and response.case_id = job.case_id
    and response.negotiation_round_id = job.negotiation_round_id
    and response.direction = 'inbound'
    and response.communication_type = 'insurer_response'
    and response.status = 'confirmed'
  join public.total_loss_message_versions as sent_message
    on sent_message.id = job.source_message_version_id
    and sent_message.case_id = job.case_id
    and sent_message.report_version_id = job.source_report_version_id
    and sent_message.message_state = 'customer_reported_sent'
  where job.id = requested_job_id
    and job.status = 'terminal_failed'
    and job.failure_code = 'INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID'
    and job.retryable = false
    and run.status = 'terminal_failed'
    and run.failure_code = 'INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID'
    and run.context_version = '1'
    and run.input_digest is null
    and run.output_digest is null
    and run.returned_model_identifier is null
    and (
      legacy_details.vehicle_year is null
      or legacy_details.vehicle_make is null
      or legacy_details.vehicle_model is null
    )
    and workflow.phase = 'negotiation'
    and workflow.current_task = 'insurer_response_received'
    and workflow.resolution_code is null
    and workflow.resolved_at is null
    and public.total_loss_customer_report_access_for_user_internal(
      job.case_id, job.source_report_version_id, appraisal_case.user_id
    )
    and not exists (
      select 1 from public.total_loss_insurer_response_analysis_results as result
      where result.job_id = job.id
    )
    and not exists (
      select 1 from public.total_loss_communications as successor
      where successor.case_id = response.case_id
        and successor.supersedes_communication_id = response.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed'
    )
    and (
      job.source_document_id is null
      or exists (
        select 1 from public.total_loss_claim_documents as document
        where document.id = job.source_document_id
          and document.case_id = job.case_id
          and document.document_kind = 'insurer_response'
          and document.status = 'ready'
          and document.sealed_at is not null
      )
    );

  if not found then
    return false;
  end if;

  perform public.total_loss_frozen_response_vehicle(
    source_row.source_report_version_id,
    source_row.case_id,
    source_row.preliminary_snapshot_id
  );
  return true;
exception
  when sqlstate '55000' then
    return false;
end;
$$;

revoke execute on function public.total_loss_legacy_response_context_retry_eligible(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.protect_total_loss_response_analysis_job()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Insurer-response analysis jobs cannot be deleted.';
  end if;

  if row(
    new.id, new.case_id, new.negotiation_round_id,
    new.response_communication_id, new.source_document_id,
    new.source_report_version_id, new.source_message_version_id,
    new.created_at
  ) is distinct from row(
    old.id, old.case_id, old.negotiation_round_id,
    old.response_communication_id, old.source_document_id,
    old.source_report_version_id, old.source_message_version_id,
    old.created_at
  ) then
    raise exception using errcode = '55000', message = 'Insurer-response analysis job identity is immutable.';
  end if;

  if old.status = 'superseded' then
    raise exception using errcode = '55000', message = 'Superseded insurer-response analysis jobs are immutable.';
  end if;

  if old.status in ('completed', 'terminal_failed', 'unsupported')
    and new.status <> 'superseded'
    and not (
      old.status = 'terminal_failed'
      and new.status = 'retryable_failed'
      and new.retryable = true
      and (to_jsonb(new) - array['status', 'retryable', 'updated_at'])
        = (to_jsonb(old) - array['status', 'retryable', 'updated_at'])
      and public.total_loss_legacy_response_context_retry_eligible(old.id)
    )
  then
    raise exception using errcode = '55000', message = 'Terminal insurer-response analysis jobs are immutable.';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_total_loss_response_analysis_job()
  from public, anon, authenticated, service_role;

create or replace function public.recover_total_loss_legacy_response_context(
  requested_job_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_case_id uuid;
  workflow_row public.total_loss_claim_workflows%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
begin
  select case_id into source_case_id
  from public.total_loss_insurer_response_analysis_jobs
  where id = requested_job_id;
  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_insurer_response_analysis'),
    pg_catalog.hashtext(source_case_id::text)
  );
  select * into workflow_row
  from public.total_loss_claim_workflows
  where case_id = source_case_id
  for update;
  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs
  where id = requested_job_id
  for update;

  if not public.total_loss_legacy_response_context_retry_eligible(job_row.id) then
    return false;
  end if;

  update public.total_loss_insurer_response_analysis_jobs
  set status = 'retryable_failed', retryable = true
  where id = job_row.id;

  update public.total_loss_claim_workflows
  set revision = revision + 1
  where case_id = job_row.case_id
    and current_response_analysis_job_id = job_row.id
  returning * into workflow_row;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, details
  ) values (
    job_row.case_id, 'insurer_response.context_retry_available', 'system',
    'total_loss_insurer_response_analysis_job', job_row.id,
    jsonb_build_object(
      'responseId', job_row.response_communication_id,
      'failedRunId', job_row.current_run_id,
      'previousContextVersion', '1',
      'retryContextVersion', '2',
      'workflowRevision', workflow_row.revision
    )
  );
  return true;
end;
$$;

revoke execute on function public.recover_total_loss_legacy_response_context(uuid)
  from public, anon, authenticated, service_role;

do $$
declare
  candidate record;
begin
  for candidate in
    select job.id
    from public.total_loss_insurer_response_analysis_jobs as job
    where job.status = 'terminal_failed'
      and job.failure_code = 'INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID'
    order by job.case_id, job.id
  loop
    perform public.recover_total_loss_legacy_response_context(candidate.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
