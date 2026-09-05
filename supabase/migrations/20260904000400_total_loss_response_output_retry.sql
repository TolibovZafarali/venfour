-- Retry policy 1 distinguishes a rejected interpretation from invalid source material.
-- Failed runs remain immutable; recovery only changes the current job lifecycle.
create function public.total_loss_response_output_retry_source_valid(requested_job_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare source_row record;
begin
  select job.case_id, job.source_report_version_id, workflow.preliminary_snapshot_id
  into source_row
  from public.total_loss_insurer_response_analysis_jobs job
  join public.total_loss_claim_workflows workflow
    on workflow.case_id = job.case_id
    and workflow.current_response_analysis_job_id = job.id
    and workflow.current_report_version_id = job.source_report_version_id
    and workflow.current_negotiation_round_id = job.negotiation_round_id
  join public.appraisal_cases appraisal_case on appraisal_case.id = job.case_id
  join public.total_loss_negotiation_rounds negotiation_round
    on negotiation_round.id = job.negotiation_round_id
    and negotiation_round.case_id = job.case_id
    and negotiation_round.status = 'response_received'
  join public.total_loss_communications response
    on response.id = job.response_communication_id
    and response.case_id = job.case_id
    and response.negotiation_round_id = job.negotiation_round_id
    and response.direction = 'inbound'
    and response.communication_type = 'insurer_response'
    and response.status = 'confirmed'
  join public.total_loss_communications outbound
    on outbound.id = negotiation_round.originating_communication_id
    and outbound.case_id = job.case_id
    and outbound.negotiation_round_id = job.negotiation_round_id
    and outbound.message_version_id = job.source_message_version_id
    and outbound.direction = 'outbound' and outbound.status = 'confirmed'
  join public.total_loss_message_versions sent_message
    on sent_message.id = job.source_message_version_id
    and sent_message.case_id = job.case_id
    and sent_message.negotiation_round_id = job.negotiation_round_id
    and sent_message.report_version_id = job.source_report_version_id
    and sent_message.message_state = 'customer_reported_sent'
  where job.id = requested_job_id
    and workflow.phase = 'negotiation'
    and workflow.current_task = 'insurer_response_received'
    and workflow.resolution_code is null and workflow.resolved_at is null
    and public.total_loss_customer_report_access_for_user_internal(
      job.case_id, job.source_report_version_id, appraisal_case.user_id)
    and not exists (select 1 from public.total_loss_insurer_response_analysis_results result
      where result.job_id = job.id)
    and not exists (select 1 from public.total_loss_communications successor
      where successor.case_id = response.case_id
        and successor.supersedes_communication_id = response.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed')
    and (job.source_document_id is null or exists (
      select 1 from public.total_loss_claim_documents document
      join public.total_loss_communication_documents link
        on link.document_id = document.id and link.case_id = document.case_id
        and link.communication_id = response.id
      where document.id = job.source_document_id and document.case_id = job.case_id
        and document.document_kind = 'insurer_response'
        and document.status = 'ready' and document.sealed_at is not null
        and document.media_type in ('application/pdf','image/jpeg','image/png')));
  if not found then return false; end if;
  perform public.total_loss_frozen_response_vehicle(source_row.source_report_version_id,
    source_row.case_id, source_row.preliminary_snapshot_id);
  return true;
exception when sqlstate '55000' then return false;
end;
$$;
revoke execute on function public.total_loss_response_output_retry_source_valid(uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_legacy_response_output_retry_eligible(
  requested_job_id uuid, requested_run_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.total_loss_insurer_response_analysis_jobs job
    join public.total_loss_insurer_response_analysis_runs run
      on run.id = job.current_run_id and run.job_id = job.id and run.case_id = job.case_id
    where job.id = requested_job_id and run.id = requested_run_id
      and job.status = 'terminal_failed' and job.retryable = false
      and job.failure_code = 'INSURER_RESPONSE_ANALYSIS_OUTPUT_INVALID'
      and run.status = 'terminal_failed'
      and run.failure_code = 'INSURER_RESPONSE_ANALYSIS_OUTPUT_INVALID'
      and run.prompt_version in ('1','2') and run.schema_version = '1'
      and run.context_version in ('1','2') and run.output_digest is null
      and public.total_loss_response_output_retry_source_valid(job.id)
      and not exists (select 1 from public.total_loss_workflow_events event
        where event.case_id = job.case_id
          and event.associated_entity_id = job.id
          and event.event_type = 'insurer_response.output_retry_available')
  );
$$;
revoke execute on function public.total_loss_legacy_response_output_retry_eligible(uuid,uuid)
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
      and (public.total_loss_legacy_response_context_retry_eligible(old.id)
        or (old.failure_code = 'INSURER_RESPONSE_ANALYSIS_OUTPUT_INVALID'
          and public.total_loss_response_output_retry_source_valid(old.id)
          and exists (select 1 from public.total_loss_workflow_events event
            where event.case_id = old.case_id and event.associated_entity_id = old.id
              and event.event_type = 'insurer_response.output_retry_available'
              and event.details ->> 'failedRunId' = old.current_run_id::text
              and event.details ->> 'retryPolicyVersion' = '1'
              and event.details ->> 'validationReason' in (
                'PROVIDER_SEMANTIC_INVALID', 'LEGACY_OUTPUT_DIAGNOSTIC')
              and event.details ->> 'verifiedInputDigest' ~ '^[0-9a-f]{64}$'
              and event.details ->> 'classificationEvidenceDigest' ~ '^[0-9a-f]{64}$')))
    )
  then
    raise exception using errcode = '55000', message = 'Terminal insurer-response analysis jobs are immutable.';
  end if;

  return new;
end;
$$;

-- Restricted maintenance entry: callers must validate the unchanged input and
-- original document bytes before attesting their digest. Unknown historical
-- output may receive one explicitly audited diagnostic attempt, never a claimed
-- semantic classification. No migration promotes generic failures automatically.
create function public.recover_total_loss_legacy_response_output(
  requested_job_id uuid, requested_failed_run_id uuid,
  requested_validation_reason text, requested_verified_input_digest text,
  requested_classification_evidence_digest text
) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  source_case_id uuid;
  workflow_row public.total_loss_claim_workflows%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
begin
  if requested_job_id is null or requested_failed_run_id is null
    or requested_validation_reason is null
    or requested_validation_reason not in ('PROVIDER_SEMANTIC_INVALID','LEGACY_OUTPUT_DIAGNOSTIC')
    or requested_verified_input_digest is null
    or requested_verified_input_digest !~ '^[0-9a-f]{64}$'
    or requested_classification_evidence_digest is null
    or requested_classification_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception using errcode = '22023', message = 'Output recovery evidence is required.'; end if;
  select case_id into source_case_id from public.total_loss_insurer_response_analysis_jobs
    where id = requested_job_id;
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_insurer_response_analysis'), pg_catalog.hashtext(source_case_id::text));
  select * into workflow_row from public.total_loss_claim_workflows
    where case_id = source_case_id for update;
  select * into job_row from public.total_loss_insurer_response_analysis_jobs
    where id = requested_job_id for update;
  if not public.total_loss_legacy_response_output_retry_eligible(job_row.id, requested_failed_run_id)
    or (requested_validation_reason = 'LEGACY_OUTPUT_DIAGNOSTIC' and not exists (
      select 1 from public.total_loss_insurer_response_analysis_runs run
      where run.id = requested_failed_run_id and run.prompt_version = '2' and run.context_version = '2'))
  then return false; end if;
  insert into public.total_loss_workflow_events (
    case_id,event_type,actor_type,associated_entity_type,associated_entity_id,details
  ) values (job_row.case_id,'insurer_response.output_retry_available','system',
    'total_loss_insurer_response_analysis_job',job_row.id,jsonb_build_object(
      'responseId',job_row.response_communication_id,'failedRunId',job_row.current_run_id,
      'retryPolicyVersion','1','retryPromptVersion','4','validationReason',requested_validation_reason,
      'verifiedInputDigest',requested_verified_input_digest,
      'classificationEvidenceDigest',requested_classification_evidence_digest,
      'workflowRevision',workflow_row.revision + 1));
  update public.total_loss_insurer_response_analysis_jobs
    set status = 'retryable_failed', retryable = true where id = job_row.id;
  update public.total_loss_claim_workflows set revision = revision + 1
    where case_id = job_row.case_id and current_response_analysis_job_id = job_row.id;
  return true;
end;
$$;
revoke execute on function public.recover_total_loss_legacy_response_output(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.retry_total_loss_insurer_response_analysis(
  requested_case_id uuid,
  requested_client_request_id uuid,
  expected_workflow_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  workflow_row public.total_loss_claim_workflows%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
begin
  if authenticated_user_id is null
    or requested_case_id is null
    or requested_client_request_id is null
    or expected_workflow_revision is null
  then
    raise exception using errcode = '22023', message = 'Response-analysis retry identity is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_insurer_response_analysis'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  -- Match worker claims before the closure guard locks the workflow row.
  perform public.assert_total_loss_customer_case_open_internal(requested_case_id);

  if not public.is_permanent_total_loss_case_owner(requested_case_id) then
    raise exception using errcode = '42501', message = 'Response-analysis retry is unavailable.';
  end if;

  select * into event_row
  from public.total_loss_workflow_events as event
  where event.case_id = requested_case_id
    and event.client_request_id = requested_client_request_id;
  if found then
    if event_row.event_type <> 'insurer_response.analysis_retry_requested'
      or event_row.details ->> 'workflowRevision' !~ '^[1-9][0-9]*$'
    then
      raise exception using errcode = '55000', message = 'Client request identity was already used.';
    end if;
    return jsonb_build_object(
      'state', 'insurer_response_reviewing',
      'processingState', 'pending',
      'workflowRevision', (event_row.details ->> 'workflowRevision')::bigint
    );
  end if;

  select * into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id
  for update;
  if not found
    or workflow_row.revision <> expected_workflow_revision
    or workflow_row.current_response_analysis_job_id is null
  then
    -- This is a stale request, not a serialization failure for the gateway to retry.
    raise exception using errcode = '55000', message = 'Claim workflow changed before response-analysis retry.';
  end if;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.id = workflow_row.current_response_analysis_job_id
    and job.case_id = requested_case_id
  for update;
  if not found or job_row.status <> 'retryable_failed' then
    raise exception using errcode = '55000', message = 'Response analysis is not retryable.';
  end if;

  if job_row.failure_code in (
    'INSURER_RESPONSE_OUTPUT_SEMANTIC_INVALID','INSURER_RESPONSE_ANALYSIS_OUTPUT_INVALID') then
    if not public.total_loss_response_output_retry_source_valid(job_row.id)
      or (select count(*) from public.total_loss_insurer_response_analysis_runs run
        where run.job_id = job_row.id
          and run.failure_code = 'INSURER_RESPONSE_OUTPUT_SEMANTIC_INVALID') >= 3
    then raise exception using errcode = '55000', message = 'Response analysis is not retryable.'; end if;
    if job_row.next_attempt_at > statement_timestamp() then
      raise exception using errcode = '55000', message = 'Response-analysis retry is not due yet.';
    end if;
  end if;

  update public.total_loss_insurer_response_analysis_jobs
  set status = 'pending',
      processing_token = null,
      processing_expires_at = null,
      current_run_id = null,
      failure_code = null,
      retryable = null,
      failed_at = null,
      next_attempt_at = statement_timestamp()
  where id = job_row.id;

  update public.total_loss_claim_workflows as workflow
  set revision = workflow.revision + 1
  where workflow.case_id = requested_case_id
    and workflow.revision = expected_workflow_revision
  returning * into workflow_row;
  if not found then
    raise exception using errcode = '55000', message = 'Claim workflow changed before response-analysis retry.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, actor_user_id,
    associated_entity_type, associated_entity_id,
    client_request_id, details
  ) values (
    requested_case_id, 'insurer_response.analysis_retry_requested',
    'customer', authenticated_user_id,
    'total_loss_insurer_response_analysis_job', job_row.id,
    requested_client_request_id,
    jsonb_build_object('workflowRevision', workflow_row.revision)
  );

  return jsonb_build_object(
    'state', 'insurer_response_reviewing',
    'processingState', 'pending',
    'workflowRevision', workflow_row.revision
  );
end;
$$;

create or replace function public.fail_total_loss_insurer_response_analysis(
  requested_job_id uuid,
  requested_processing_token uuid,
  requested_run_id uuid,
  requested_failure_code text,
  requested_failure_kind text,
  requested_retry_delay_seconds integer
)
returns table (
  outcome text,
  status text,
  workflow_revision bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
  run_row public.total_loss_insurer_response_analysis_runs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  terminal_status text;
begin
  if requested_job_id is null
    or requested_processing_token is null
    or requested_run_id is null
    or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_failure_kind not in ('retryable', 'terminal', 'unsupported')
    or requested_retry_delay_seconds not between 0 and 86400
  then
    raise exception using errcode = '22023', message = 'Response-analysis failure is invalid.';
  end if;

  terminal_status := case requested_failure_kind
    when 'retryable' then 'retryable_failed'
    when 'terminal' then 'terminal_failed'
    else 'unsupported'
  end;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.id = requested_job_id
  for update;
  if not found then
    return query select 'not_found'::text, null::text, null::bigint;
    return;
  end if;

  if job_row.status = 'superseded' then
    return query select 'superseded'::text, job_row.status, null::bigint;
    return;
  end if;

  if (job_row.status = terminal_status or (
      requested_failure_code = 'INSURER_RESPONSE_OUTPUT_SEMANTIC_INVALID'
      and job_row.status = 'terminal_failed'))
    and job_row.processing_token = requested_processing_token
    and job_row.current_run_id = requested_run_id
    and job_row.failure_code = requested_failure_code
  then
    select * into workflow_row from public.total_loss_claim_workflows
    where case_id = job_row.case_id;
    return query select 'duplicate'::text, job_row.status, workflow_row.revision;
    return;
  end if;

  if job_row.status <> 'processing'
    or job_row.processing_token <> requested_processing_token
    or job_row.processing_expires_at <= statement_timestamp()
    or job_row.current_run_id <> requested_run_id
  then
    raise exception using errcode = '40001', message = 'Response-analysis lease is no longer active.';
  end if;

  select * into run_row
  from public.total_loss_insurer_response_analysis_runs as run
  where run.id = requested_run_id
    and run.job_id = job_row.id
    and run.status = 'processing'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'Response-analysis run is no longer active.';
  end if;

  select * into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = job_row.case_id
  for update;
  if not found or workflow_row.current_response_analysis_job_id <> job_row.id then
    update public.total_loss_insurer_response_analysis_runs
    set status = 'superseded', completed_at = statement_timestamp()
    where id = run_row.id;
    update public.total_loss_insurer_response_analysis_jobs
    set status = 'superseded', processing_expires_at = null,
        superseded_at = statement_timestamp()
    where id = job_row.id;
    return query select 'superseded'::text, 'superseded'::text, workflow_row.revision;
    return;
  end if;

  if requested_failure_code = 'INSURER_RESPONSE_OUTPUT_SEMANTIC_INVALID' then
    if requested_failure_kind <> 'retryable' then
      raise exception using errcode = '22023', message = 'Semantic output failure classification is invalid.';
    end if;
    if (select count(*) from public.total_loss_insurer_response_analysis_runs run
      where run.job_id = job_row.id
        and run.failure_code = 'INSURER_RESPONSE_OUTPUT_SEMANTIC_INVALID') >= 2
    then
      requested_failure_kind := 'terminal';
      terminal_status := 'terminal_failed';
    end if;
  end if;

  update public.total_loss_insurer_response_analysis_runs
  set status = terminal_status,
      failure_code = requested_failure_code,
      completed_at = statement_timestamp()
  where id = run_row.id;

  update public.total_loss_insurer_response_analysis_jobs
  set status = terminal_status,
      processing_expires_at = null,
      failure_code = requested_failure_code,
      retryable = requested_failure_kind = 'retryable',
      failed_at = statement_timestamp(),
      next_attempt_at = case
        when requested_failure_kind = 'retryable'
          then statement_timestamp()
            + pg_catalog.make_interval(secs => requested_retry_delay_seconds)
        else next_attempt_at
      end
  where id = job_row.id;

  update public.total_loss_claim_workflows as workflow
  set revision = workflow.revision + 1
  where workflow.case_id = job_row.case_id
    and workflow.current_response_analysis_job_id = job_row.id
  returning * into workflow_row;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, details
  ) values (
    job_row.case_id, 'insurer_response.analysis_failed', 'system',
    'total_loss_insurer_response_analysis_job', job_row.id,
    jsonb_build_object(
      'responseId', job_row.response_communication_id,
      'failureCode', requested_failure_code,
      'failureKind', requested_failure_kind,
      'retryPolicyVersion', case when requested_failure_code = 'INSURER_RESPONSE_OUTPUT_SEMANTIC_INVALID' then '1' end,
      'workflowRevision', workflow_row.revision
    )
  );

  return query select terminal_status, terminal_status, workflow_row.revision;
end;
$$;

notify pgrst, 'reload schema';
